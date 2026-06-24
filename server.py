#!/usr/bin/env python3
"""Tiny local service that grabs a full-resolution frame from the movie a
Jellyfin client is currently playing, using Jellyfin's bundled ffmpeg.
Called by the 'Grab Frame' camera button injected into the Jellyfin web player
by grab-frame.js.

Configuration is read from environment variables so no secrets live in source:

  JELLYFIN_API_KEY  (required) Jellyfin API key. Create one at:
                    Dashboard -> Administration -> API Keys.
  GRAB_TOKEN        (required) Shared secret guarding this service. Must match
                    the TOKEN constant at the top of grab-frame.js.
  JELLYFIN_URL      Jellyfin base URL          (default http://127.0.0.1:8096)
  FFMPEG            Path to ffmpeg binary      (default "ffmpeg" on PATH)
  OUTDIR            Where PNGs are written     (default ~/jellyfin-screenshots)
  PORT              Port to listen on          (default 9009)
  BIND              Address to bind            (default 0.0.0.0)

The service binds 0.0.0.0 by default so a browser on another device can reach
it; that is why GRAB_TOKEN matters. Set a strong token and/or firewall the port.
"""
import http.server, socketserver, urllib.parse, urllib.request
import json, subprocess, os, re, sys, datetime

JELLYFIN = os.environ.get("JELLYFIN_URL", "http://127.0.0.1:8096").rstrip("/")
APIKEY   = os.environ.get("JELLYFIN_API_KEY", "")
TOKEN    = os.environ.get("GRAB_TOKEN", "")
FFMPEG   = os.environ.get("FFMPEG", "ffmpeg")
OUTDIR   = os.path.expanduser(os.environ.get("OUTDIR", "~/jellyfin-screenshots"))
PORT     = int(os.environ.get("PORT", "9009"))
BIND     = os.environ.get("BIND", "0.0.0.0")

if not APIKEY:
    sys.exit("ERROR: set JELLYFIN_API_KEY (Dashboard -> API Keys).")
if not TOKEN:
    sys.exit("ERROR: set GRAB_TOKEN to a secret that matches grab-frame.js.")
os.makedirs(OUTDIR, exist_ok=True)


def resolve_path(item_id):
    url = (f"{JELLYFIN}/Items?ids={urllib.parse.quote(item_id)}"
           f"&fields=Path,MediaSources&api_key={APIKEY}")
    with urllib.request.urlopen(url, timeout=10) as r:
        d = json.load(r)
    items = d.get("Items") or []
    if not items:
        return None, item_id
    it = items[0]
    p = it.get("Path")
    if not p:
        for ms in (it.get("MediaSources") or []):
            if ms.get("Path"):
                p = ms["Path"]; break
    return p, (it.get("Name") or item_id)


def safe(s):
    return re.sub(r'[^A-Za-z0-9._-]+', '_', s)[:80]


class H(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Expose-Headers", "Content-Disposition")

    def _err(self, code, msg):
        self.send_response(code); self._cors(); self.end_headers()
        self.wfile.write(msg.encode() if isinstance(msg, str) else msg)

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/health":
            return self._err(200, "ok")
        if u.path != "/grab":
            return self._err(404, "not found")
        if q.get("k", [""])[0] != TOKEN:
            return self._err(403, "forbidden")
        item_id = q.get("id", [""])[0]
        try:
            t = float(q.get("t", ["0"])[0])
        except ValueError:
            t = 0.0
        if not item_id:
            return self._err(400, "missing id")
        try:
            path, name = resolve_path(item_id)
        except Exception as e:
            return self._err(502, f"resolve failed: {e}")
        if not path or not os.path.exists(path):
            return self._err(404, f"file not found: {path}")
        stamp = str(datetime.timedelta(seconds=int(t))).replace(":", "-")
        outfile = os.path.join(OUTDIR, f"{safe(name)}_{stamp}.png")
        cmd = [FFMPEG, "-y", "-ss", str(t), "-i", path,
               "-frames:v", "1", "-q:v", "1", outfile]
        try:
            subprocess.run(cmd, capture_output=True, timeout=60, check=True)
        except subprocess.CalledProcessError as e:
            return self._err(500, b"ffmpeg failed: " + (e.stderr or b"")[-400:])
        except Exception as e:
            return self._err(500, f"error: {e}")
        with open(outfile, "rb") as f:
            data = f.read()
        self.send_response(200); self._cors()
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Disposition",
                         f'attachment; filename="{os.path.basename(outfile)}"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers(); self.wfile.write(data)

    def log_message(self, *a):
        pass


class Threaded(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    print(f"jellyfin frame-grab service on {BIND}:{PORT} -> {OUTDIR}")
    Threaded((BIND, PORT), H).serve_forever()
