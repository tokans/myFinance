import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Wifi, Check, Loader2, ShieldCheck, Smartphone, Monitor, RotateCw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isTauri } from "@/lib/environment";
import { useVaultStore } from "@/stores/vault.store";
import { exportEncryptedBundle, importEncryptedBundle, type ImportResult } from "@/sync";

// ── Tauri command wrappers ────────────────────────────────────────────────
// Bytes cross the IPC boundary as plain number[] (reliable Vec<u8> mapping).
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
const hostStart = (cipher: Uint8Array, deviceLabel: string) =>
  invoke<{ ip: string; port: number }>("sync_host_start", { cipher: Array.from(cipher), deviceLabel });
const hostReceived = () => invoke<number[] | null>("sync_host_received");
const hostStop = () => invoke<void>("sync_stop");
const discover = () => invoke<{ name: string; ip: string; port: number }[]>("sync_discover", { timeoutMs: 2500 });
const join = (ip: string, port: number, cipher: Uint8Array) =>
  invoke<number[]>("sync_join", { ip, port, cipher: Array.from(cipher) });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function genCode(): string {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1_000_000).padStart(6, "0");
}

async function deviceLabel(): Promise<string> {
  try {
    const os = await import("@tauri-apps/plugin-os");
    return `myFinance (${os.platform()})`;
  } catch {
    return "myFinance";
  }
}

type Mode = "idle" | "host" | "join";
type Phase = "setup" | "waiting" | "discover" | "connecting" | "done";

export function SyncPage() {
  const [mode, setMode] = useState<Mode>("idle");
  const [phase, setPhase] = useState<Phase>("setup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [hostInfo, setHostInfo] = useState<{ ip: string; port: number } | null>(null);
  const [peers, setPeers] = useState<{ name: string; ip: string; port: number }[]>([]);
  const [manualIp, setManualIp] = useState("");
  const [manualPort, setManualPort] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const polling = useRef(false);

  // A vault exists but is locked → credentials + document files will be skipped.
  const hasMasterPassword = useVaultStore((s) => s.hasMasterPassword);
  const unlocked = useVaultStore((s) => s.unlocked);
  const hydrateVault = useVaultStore((s) => s.hydrate);
  useEffect(() => {
    void hydrateVault();
  }, [hydrateVault]);
  const vaultLockedButPresent = hasMasterPassword === true && !unlocked;

  // Always stop hosting when leaving the screen.
  useEffect(() => {
    return () => {
      polling.current = false;
      if (isTauri()) void hostStop().catch(() => {});
    };
  }, []);

  const reset = async () => {
    polling.current = false;
    await hostStop().catch(() => {});
    setMode("idle");
    setPhase("setup");
    setError(null);
    setCode("");
    setHostInfo(null);
    setPeers([]);
    setManualIp("");
    setManualPort("");
    setResult(null);
  };

  // ── Host: show a code and wait for the other device to connect ───────────
  const startHost = async () => {
    setError(null);
    setBusy(true);
    try {
      const c = genCode();
      setCode(c);
      const cipher = await exportEncryptedBundle(c);
      const info = await hostStart(cipher, await deviceLabel());
      setHostInfo(info);
      setMode("host");
      setPhase("waiting");
      polling.current = true;
      void pollForPeer(c);
    } catch (e) {
      setError(msg(e));
      await hostStop().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const pollForPeer = async (c: string) => {
    while (polling.current) {
      const arr = await hostReceived().catch(() => null);
      if (arr && arr.length) {
        polling.current = false;
        try {
          const res = await importEncryptedBundle(new Uint8Array(arr), c);
          setResult(res);
          setPhase("done");
        } catch (e) {
          setError(msg(e));
        } finally {
          await hostStop().catch(() => {});
        }
        return;
      }
      await sleep(1000);
    }
  };

  // ── Join: discover a host (or enter ip:port) and connect with the code ───
  const startJoin = async () => {
    setError(null);
    setMode("join");
    setPhase("discover");
    setBusy(true);
    try {
      setPeers(await discover());
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  const doJoin = async (ip: string, port: number) => {
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code shown on the other device.");
      return;
    }
    setPhase("connecting");
    setBusy(true);
    try {
      const cipher = await exportEncryptedBundle(code);
      const arr = await join(ip, port, cipher);
      const res = await importEncryptedBundle(new Uint8Array(arr), code);
      setResult(res);
      setPhase("done");
    } catch (e) {
      setError(msg(e));
      setPhase("discover");
    } finally {
      setBusy(false);
    }
  };

  if (!isTauri()) {
    return (
      <div className="container max-w-2xl py-6">
        <Header />
        <Card className="border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-4 text-sm text-amber-900 dark:text-amber-200">
            Sync needs the installed desktop or mobile app (it reads the local database and vault).
            It isn&apos;t available in browser preview.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-6">
      <Header />

      <WifiNotice />

      {vaultLockedButPresent && phase !== "done" && (
        <Card className="mb-4 border-sky-300/60 bg-sky-50/40 dark:bg-sky-950/20">
          <CardContent className="py-3 text-xs text-sky-900 dark:text-sky-200">
            Your vault is locked, so <strong>passwords and document files won&apos;t be included</strong> in this sync.
            Unlock it on <em>both</em> devices to include those too — everything else syncs either way.{" "}
            <Link to="/settings" className="font-medium underline">Unlock in Settings</Link>.
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="mb-4 border-destructive/60">
          <CardContent className="py-3 text-xs text-destructive">{error}</CardContent>
        </Card>
      )}

      {phase === "done" && result ? (
        <DoneCard result={result} onAgain={reset} />
      ) : mode === "idle" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            icon={Monitor}
            title="Show a code"
            body="This device waits. The other device enters the code to sync."
            cta={busy ? "Preparing…" : "Show code"}
            disabled={busy}
            onClick={startHost}
          />
          <ChoiceCard
            icon={Smartphone}
            title="Enter a code"
            body="Connect to a device that is showing a code on the same Wi-Fi."
            cta="Enter code"
            disabled={busy}
            onClick={startJoin}
          />
        </div>
      ) : mode === "host" ? (
        <HostPanel code={code} info={hostInfo} onCancel={reset} />
      ) : (
        <JoinPanel
          code={code}
          setCode={setCode}
          peers={peers}
          busy={busy}
          phase={phase}
          manualIp={manualIp}
          manualPort={manualPort}
          setManualIp={setManualIp}
          setManualPort={setManualPort}
          onRescan={startJoin}
          onConnect={doJoin}
          onBack={reset}
        />
      )}
    </div>
  );
}

function Header() {
  return (
    <header className="mb-6">
      <h2 className="text-2xl font-semibold tracking-tight">Sync devices</h2>
      <p className="text-sm text-muted-foreground">
        Merge this device&apos;s data with another over your local Wi-Fi. Two-way: newer edits win, deletions carry across.
      </p>
    </header>
  );
}

function WifiNotice() {
  return (
    <Card className="mb-4 border-primary/30 bg-primary/5">
      <CardContent className="flex gap-3 py-3 text-xs">
        <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="space-y-1 text-muted-foreground">
          <p>
            Sync happens <strong className="text-foreground">directly between your devices over the same Wi-Fi</strong> —
            myFinance has no server, so nothing is uploaded anywhere.
          </p>
          <p>
            Both devices must be on the <strong className="text-foreground">same Wi-Fi network</strong>. On your phone,
            make sure you&apos;re on <strong className="text-foreground">Wi-Fi, not mobile data</strong>.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ChoiceCard({
  icon: Icon, title, body, cta, disabled, onClick,
}: {
  icon: typeof Monitor; title: string; body: string; cta: string; disabled?: boolean; onClick: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex h-full flex-col items-center gap-3 py-7 text-center">
        <Icon className="h-9 w-9 text-muted-foreground" />
        <div className="flex-1">
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{body}</p>
        </div>
        <Button onClick={onClick} disabled={disabled} className="w-full">{cta}</Button>
      </CardContent>
    </Card>
  );
}

function HostPanel({ code, info, onCancel }: { code: string; info: { ip: string; port: number } | null; onCancel: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Waiting for the other device…
        </CardTitle>
        <CardDescription>On the other device, choose “Enter a code” and type this:</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/40 py-5 text-center">
          <div className="font-mono text-4xl font-bold tracking-[0.4em]">{code}</div>
        </div>
        {info && (
          <p className="text-center text-xs text-muted-foreground">
            If the other device can&apos;t find this one automatically, enter{" "}
            <span className="font-mono text-foreground">{info.ip}:{info.port}</span> manually.
          </p>
        )}
        <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> The transfer is encrypted with this code.
        </div>
        <Button variant="outline" className="w-full" onClick={onCancel}>Cancel</Button>
      </CardContent>
    </Card>
  );
}

function JoinPanel({
  code, setCode, peers, busy, phase, manualIp, manualPort, setManualIp, setManualPort, onRescan, onConnect, onBack,
}: {
  code: string; setCode: (v: string) => void;
  peers: { name: string; ip: string; port: number }[];
  busy: boolean; phase: Phase;
  manualIp: string; manualPort: string; setManualIp: (v: string) => void; setManualPort: (v: string) => void;
  onRescan: () => void;
  onConnect: (ip: string, port: number) => void;
  onBack: () => void;
}) {
  const connecting = phase === "connecting";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Enter the code</CardTitle>
        <CardDescription>Type the 6-digit code shown on the other device, then pick it below.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="code">Pairing code</Label>
          <Input
            id="code"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="text-center font-mono text-2xl tracking-[0.3em]"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Devices on this Wi-Fi</Label>
            <Button variant="ghost" size="sm" onClick={onRescan} disabled={busy}>
              <RotateCw className={busy ? "mr-1 h-3.5 w-3.5 animate-spin" : "mr-1 h-3.5 w-3.5"} /> Rescan
            </Button>
          </div>
          {peers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {busy ? "Searching…" : "No devices found yet. Make sure the other device is showing a code, then rescan — or connect manually below."}
            </p>
          ) : (
            <div className="space-y-1.5">
              {peers.map((p) => (
                <button
                  key={`${p.ip}:${p.port}`}
                  type="button"
                  disabled={connecting}
                  onClick={() => onConnect(p.ip, p.port)}
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50"
                >
                  <span className="truncate">{p.name.replace(/\._myfinance\._tcp\.local\.$/, "")}</span>
                  <span className="font-mono text-xs text-muted-foreground">{p.ip}:{p.port}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2 rounded-md border border-dashed p-3">
          <Label className="text-xs text-muted-foreground">Or connect manually</Label>
          <div className="flex gap-2">
            <Input placeholder="192.168.1.42" value={manualIp} onChange={(e) => setManualIp(e.target.value)} />
            <Input placeholder="port" className="w-24" value={manualPort} onChange={(e) => setManualPort(e.target.value.replace(/\D/g, ""))} />
            <Button
              disabled={connecting || !manualIp || !manualPort}
              onClick={() => onConnect(manualIp.trim(), Number(manualPort))}
            >
              Connect
            </Button>
          </div>
        </div>

        {connecting && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Exchanging and merging…
          </p>
        )}

        <Button variant="outline" className="w-full" onClick={onBack} disabled={connecting}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
      </CardContent>
    </Card>
  );
}

function DoneCard({ result, onAgain }: { result: ImportResult; onAgain: () => void }) {
  const rows: { label: string; n: number }[] = [
    { label: "Added", n: result.added },
    { label: "Updated", n: result.updated },
    { label: "Deleted", n: result.deleted },
    { label: "Unchanged", n: result.skipped },
  ];
  return (
    <Card>
      <CardContent className="space-y-4 py-6">
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-emerald-100 p-1 dark:bg-emerald-950">
            <Check className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
          </div>
          <h3 className="text-base font-semibold">Synced</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Merged data from the other device. Both devices now match (run sync once more if you also edited there since).
        </p>
        <div className="grid grid-cols-4 gap-2 text-center">
          {rows.map((r) => (
            <div key={r.label} className="rounded-md border py-3">
              <div className="text-xl font-semibold">{r.n}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{r.label}</div>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={onAgain}>Sync again</Button>
      </CardContent>
    </Card>
  );
}
