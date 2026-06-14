"""Tiny static file server for previewing the landing page locally.

Used by preview.bat. Binds to loopback (127.0.0.1) and tries a list of ports,
falling back to an OS-assigned free port — this avoids Windows WinError 10013
("forbidden by access permissions"), which happens when a preferred port is
reserved by http.sys or another app. Opens the browser once it's up.

Usage:  python serve.py <directory> [preferred_port]
"""
import http.server
import os
import socketserver
import sys
import threading
import webbrowser

directory = sys.argv[1] if len(sys.argv) > 1 else "."
preferred = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] else 8000

os.chdir(directory)

# Try the preferred port, then a few common alternates, then 0 = OS picks any
# free port (guaranteed to succeed).
candidates = [preferred, 8080, 8888, 5500, 3000, 4173, 0]
httpd = None
for port in candidates:
    try:
        httpd = socketserver.TCPServer(("127.0.0.1", port), http.server.SimpleHTTPRequestHandler)
        break
    except OSError:
        continue

if httpd is None:
    print("ERROR: could not bind any local port.")
    sys.exit(1)

actual_port = httpd.server_address[1]
url = "http://127.0.0.1:%d/" % actual_port
print("Serving %s" % os.getcwd())
print("  -> %s   (Ctrl+C to stop)" % url)

# Open the browser shortly after the server starts accepting connections.
threading.Timer(0.6, lambda: webbrowser.open(url)).start()

try:
    httpd.serve_forever()
except KeyboardInterrupt:
    print("\nStopped.")
    httpd.server_close()
