# Jellyfin Screenshot + Frame-by-Frame Navigation

Add a **full-resolution screenshot button** and **frame-by-frame navigation**
to the **Jellyfin web video player**.

While watching anything in Jellyfin's web player you get three extra buttons in
the on-screen player controls:

| Button | Action | Keyboard |
| --- | --- | --- |
| ◀ `navigate_before` | step back one frame | `,` |
| 📷 `photo_camera` | save a **full-resolution PNG** of the current frame | — |
| ▶ `navigate_next` | step forward one frame | `.` |

Frame stepping uses the file's real frame rate, so one press ≈ one true frame.
The screenshot is a clean grab straight from the source file via ffmpeg — **not**
a downscaled canvas capture of the `<video>` element, so you get the original
resolution regardless of your transcode/playback quality.

> Keywords: jellyfin screenshot, jellyfin frame by frame, jellyfin frame
> navigation, jellyfin capture frame, jellyfin full resolution screenshot,
> jellyfin web player snapshot, step frame.

## How it works

Two small pieces:

1. **`grab-frame.js`** — injected into the Jellyfin web client. Draws the three
   buttons, handles frame stepping client-side, and asks the helper service for
   a screenshot.
2. **`server.py`** — a tiny localhost helper that runs on the **Jellyfin server
   machine**. When the camera button is pressed it resolves the currently
   playing item to its file path (via the Jellyfin API) and uses Jellyfin's
   bundled ffmpeg to extract a full-resolution PNG of that exact timestamp.

The browser button calls `http://<jellyfin-host>:9009/grab`, the service returns
the PNG, and the browser downloads it. A shared `GRAB_TOKEN` guards the service.

```
[Jellyfin web player] --(button: grab-frame.js)--> [server.py :9009] --ffmpeg--> full-res PNG
```

## Requirements

- A Jellyfin server you can run a small Python script next to.
- Python 3 (standard library only — no pip installs).
- `ffmpeg` available (Jellyfin already ships one; you can point at it).
- Filesystem access from the helper to your media files (it reads them directly).

## Install

### 1. Get a Jellyfin API key

Jellyfin dashboard → **Administration → API Keys → +**. Copy the key.

### 2. Run the helper service

```sh
git clone https://github.com/<you>/jellyfin-screenshot-frame-navigation.git
cd jellyfin-screenshot-frame-navigation

export JELLYFIN_API_KEY="paste-your-api-key"
export GRAB_TOKEN="pick-a-long-random-string"     # keep this secret
# optional overrides:
# export JELLYFIN_URL="http://127.0.0.1:8096"
# export FFMPEG="/Applications/Jellyfin.app/Contents/MacOS/ffmpeg"
# export OUTDIR="$HOME/jellyfin-screenshots"
# export PORT=9009

python3 server.py
```

Check it: `curl http://localhost:9009/health` → `ok`.

To keep it running across reboots, see [`examples/`](examples) for a macOS
`launchd` plist and a Linux `systemd` unit.

### 3. Set the matching token in the browser script

Edit **`grab-frame.js`** and set `TOKEN` to the **same** value as `GRAB_TOKEN`:

```js
var TOKEN = "pick-a-long-random-string"; // must match GRAB_TOKEN on the server
```

(If you run the service on a non-default port, also update `PORT` near the top.)

### 4. Inject the script into the Jellyfin web client

```sh
./reinject.sh
```

It auto-detects the Jellyfin web folder (macOS app, Debian package, Docker). If
detection misses, point it at the right place:

```sh
JELLYFIN_WEB=/usr/share/jellyfin/web ./reinject.sh
```

Then **hard-refresh** the Jellyfin web page (`Cmd/Ctrl+Shift+R`) and start
playing something — the buttons appear in the player control bar.

> ⚠️ Jellyfin **updates overwrite the web folder**. Just re-run `./reinject.sh`
> after each update. Bump `VERSION` in the script to bust the browser cache.

## Configuration reference (`server.py`)

| Env var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `JELLYFIN_API_KEY` | ✅ | — | Jellyfin API key used to resolve the playing file |
| `GRAB_TOKEN` | ✅ | — | Shared secret; must match `TOKEN` in `grab-frame.js` |
| `JELLYFIN_URL` | | `http://127.0.0.1:8096` | Jellyfin base URL |
| `FFMPEG` | | `ffmpeg` | ffmpeg binary path |
| `OUTDIR` | | `~/jellyfin-screenshots` | where PNGs are written |
| `PORT` | | `9009` | listen port |
| `BIND` | | `0.0.0.0` | listen address |

## Security notes

- The helper binds `0.0.0.0` by default so a browser on **another device** can
  reach it. Because it's network-reachable, **set a strong `GRAB_TOKEN`** — it's
  the only thing gating screenshot requests. Consider firewalling the port to
  your LAN.
- The helper reads your media files directly and writes PNGs to `OUTDIR`. It
  only ever serves frames for the currently-playing item id you pass it.
- No secrets are stored in this repo. Your API key and token come from
  environment variables and the one line you edit in `grab-frame.js`.

## Platform notes

Developed on macOS (Jellyfin.app). The web-client injection and the helper are
plain HTML/JS + stdlib Python, so it works anywhere Jellyfin runs — you just
need the correct `jellyfin-web` path (`reinject.sh` covers the common ones) and
an ffmpeg path.

## License

MIT — see [LICENSE](LICENSE).
