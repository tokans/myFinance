//! LAN transport for device-to-device sync. This module is a *dumb pipe*: it
//! moves opaque, already-encrypted byte blobs between two devices on the same
//! Wi-Fi and never sees plaintext or the database. All bundling, encryption and
//! merge logic lives in the TypeScript layer (src/sync/*).
//!
//! Two roles, exchanged in a single round-trip so a two-way merge needs one
//! pairing:
//!   * host  — `sync_host_start` serves its encrypted bundle at `GET /bundle`,
//!             accepts the peer's at `POST /bundle`, and advertises itself over
//!             mDNS. `sync_host_received` hands the posted bundle back to the UI.
//!   * joiner — `sync_join` POSTs its bundle to the host and GETs the host's.
//!
//! `sync_discover` lists hosts seen via mDNS; if multicast is unavailable (some
//! mobile networks), the UI falls back to the host's printed `ip:port`.

use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::State;

const SERVICE_TYPE: &str = "_myfinance._tcp.local.";

#[derive(Default)]
pub struct SyncState(pub Mutex<Option<HostSession>>);

pub struct HostSession {
    stop: Arc<AtomicBool>,
    received: Arc<Mutex<Option<Vec<u8>>>>,
    handle: Option<JoinHandle<()>>,
    mdns: Option<mdns_sd::ServiceDaemon>,
    fullname: Option<String>,
}

#[derive(Serialize)]
pub struct HostInfo {
    ip: String,
    port: u16,
}

#[derive(Serialize)]
pub struct Peer {
    name: String,
    ip: String,
    port: u16,
}

/// Strip characters mDNS dislikes from a user-supplied device label.
fn sanitize(label: &str) -> String {
    let cleaned: String = label
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == ' ' { c } else { '-' })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() { "myFinance".to_string() } else { trimmed.to_string() }
}

fn stop_inner(state: &State<SyncState>) {
    if let Some(mut s) = state.0.lock().unwrap().take() {
        s.stop.store(true, Ordering::Relaxed);
        if let (Some(d), Some(fname)) = (s.mdns.as_ref(), s.fullname.as_ref()) {
            let _ = d.unregister(fname);
        }
        if let Some(h) = s.handle.take() {
            let _ = h.join();
        }
    }
}

/// Start serving `cipher` on an ephemeral LAN port and advertise over mDNS.
/// Returns the IP + port so the UI can show a manual-connect fallback.
#[tauri::command]
pub fn sync_host_start(
    state: State<SyncState>,
    cipher: Vec<u8>,
    device_label: String,
) -> Result<HostInfo, String> {
    stop_inner(&state);

    let server = tiny_http::Server::http("0.0.0.0:0").map_err(|e| e.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or_else(|| "could not determine listen port".to_string())?;
    let ip = local_ip_address::local_ip().map_err(|e| e.to_string())?.to_string();

    let stop = Arc::new(AtomicBool::new(false));
    let received = Arc::new(Mutex::new(None));
    let cipher = Arc::new(cipher);

    let stop_t = stop.clone();
    let received_t = received.clone();
    let cipher_t = cipher.clone();
    let handle = std::thread::spawn(move || {
        while !stop_t.load(Ordering::Relaxed) {
            match server.recv_timeout(Duration::from_millis(300)) {
                Ok(Some(mut req)) => {
                    let is_post = *req.method() == tiny_http::Method::Post;
                    if is_post {
                        let mut buf = Vec::new();
                        let _ = req.as_reader().read_to_end(&mut buf);
                        *received_t.lock().unwrap() = Some(buf);
                        let _ = req.respond(tiny_http::Response::from_string("ok"));
                    } else {
                        let data: Vec<u8> = cipher_t.as_ref().clone();
                        let _ = req.respond(tiny_http::Response::from_data(data));
                    }
                }
                Ok(None) => {}
                Err(_) => break,
            }
        }
    });

    // Best-effort mDNS advertisement; failure here just means discovery won't
    // work and the user connects manually with the returned ip:port.
    let mdns = mdns_sd::ServiceDaemon::new().ok();
    let mut fullname = None;
    if let Some(d) = &mdns {
        let instance = sanitize(&device_label);
        let host_name = format!("{}.local.", instance.replace(' ', "-"));
        if let Ok(info) = mdns_sd::ServiceInfo::new(
            SERVICE_TYPE,
            &instance,
            &host_name,
            ip.as_str(),
            port,
            &[("v", "1")][..],
        ) {
            fullname = Some(info.get_fullname().to_string());
            let _ = d.register(info);
        }
    }

    *state.0.lock().unwrap() = Some(HostSession {
        stop,
        received,
        handle: Some(handle),
        mdns,
        fullname,
    });
    Ok(HostInfo { ip, port })
}

/// Return (and clear) the peer's posted bundle, if it has arrived.
#[tauri::command]
pub fn sync_host_received(state: State<SyncState>) -> Option<Vec<u8>> {
    let guard = state.0.lock().unwrap();
    guard.as_ref().and_then(|s| s.received.lock().unwrap().take())
}

/// Stop hosting: shut the server down and withdraw the mDNS advertisement.
#[tauri::command]
pub fn sync_stop(state: State<SyncState>) {
    stop_inner(&state);
}

/// Browse the LAN for other myFinance hosts for `timeout_ms` (default 2s).
#[tauri::command]
pub fn sync_discover(timeout_ms: Option<u64>) -> Result<Vec<Peer>, String> {
    let daemon = mdns_sd::ServiceDaemon::new().map_err(|e| e.to_string())?;
    let receiver = daemon.browse(SERVICE_TYPE).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_millis(timeout_ms.unwrap_or(2000));

    let mut peers: Vec<Peer> = Vec::new();
    while Instant::now() < deadline {
        if let Ok(event) = receiver.recv_timeout(Duration::from_millis(200)) {
            if let mdns_sd::ServiceEvent::ServiceResolved(info) = event {
                if let Some(addr) = info.get_addresses().iter().next() {
                    let ip = addr.to_string();
                    if !peers.iter().any(|p| p.ip == ip && p.port == info.get_port()) {
                        peers.push(Peer {
                            name: info.get_fullname().to_string(),
                            ip,
                            port: info.get_port(),
                        });
                    }
                }
            }
        }
    }
    let _ = daemon.shutdown();
    Ok(peers)
}

/// As the joiner: POST our `cipher` to the host, then GET and return the host's.
///
/// Transport note: this hop is plaintext HTTP by design. `cipher` is already
/// AES-GCM sealed in the TypeScript layer (Rust is a dumb byte pipe), the peer is on
/// the same Wi-Fi LAN discovered via mDNS, and there is no server — invariant 1
/// sanctions opt-in device-to-device LAN sync. TLS here would only protect already-
/// encrypted bytes between two trusted devices and would force self-signed-cert
/// handling on the LAN. Hence the publisher-ci tls-only suppression below.
#[tauri::command]
pub fn sync_join(ip: String, port: u16, cipher: Vec<u8>) -> Result<Vec<u8>, String> {
    let url = format!("http://{}:{}/bundle", ip, port); // publisher-ci-ignore: tls-only — encrypted payload over no-server LAN (see fn doc)
    ureq::post(&url)
        .send_bytes(&cipher)
        .map_err(|e| format!("could not reach the other device: {e}"))?;
    let resp = ureq::get(&url)
        .call()
        .map_err(|e| format!("could not fetch the other device's data: {e}"))?;
    let mut buf = Vec::new();
    resp.into_reader()
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    Ok(buf)
}
