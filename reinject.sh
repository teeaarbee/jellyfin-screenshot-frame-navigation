#!/bin/sh
# Inject (or re-inject) grab-frame.js into the Jellyfin web client.
# Jellyfin updates overwrite the jellyfin-web folder, so re-run this afterwards.
# Idempotent: safe to run any time. Bump VERSION to bust the browser cache.
#
# Override the web client location if auto-detection misses it, e.g.:
#   JELLYFIN_WEB=/usr/share/jellyfin/web ./reinject.sh
#
# Common locations:
#   macOS app : /Applications/Jellyfin.app/Contents/Resources/jellyfin-web
#   Debian/deb: /usr/share/jellyfin/web
#   Docker    : /jellyfin/jellyfin-web   (or your mounted web path)
set -e

VERSION="v1"
DIR="$(cd "$(dirname "$0")" && pwd)"
MASTER="$DIR/grab-frame.js"

# auto-detect web dir if not given
if [ -z "$JELLYFIN_WEB" ]; then
  for c in \
    "/Applications/Jellyfin.app/Contents/Resources/jellyfin-web" \
    "/usr/share/jellyfin/web" \
    "/usr/lib/jellyfin/bin/jellyfin-web" \
    "/jellyfin/jellyfin-web"; do
    [ -d "$c" ] && JELLYFIN_WEB="$c" && break
  done
fi

WEB="$JELLYFIN_WEB"
INDEX="$WEB/index.html"
JS="grab-frame.$VERSION.js"
TAG="<script defer src=\"$JS\"></script>"

if [ -z "$WEB" ] || [ ! -d "$WEB" ]; then
  echo "ERROR: jellyfin-web not found. Set JELLYFIN_WEB=/path/to/jellyfin-web"; exit 1
fi
if [ ! -f "$MASTER" ]; then
  echo "ERROR: grab-frame.js not found next to this script"; exit 1
fi

# 1) (re)place the button script (remove any stale copies first)
rm -f "$WEB"/grab-frame.js "$WEB"/grab-frame.v*.js
cp "$MASTER" "$WEB/$JS"
echo "✓ copied $JS into $WEB"

# 2) ensure the <script> tag is in index.html, pointing at the current $JS
if grep -q "$JS" "$INDEX"; then
  echo "✓ index.html already references $JS"
elif grep -q "grab-frame" "$INDEX"; then
  tmp="$(mktemp)"
  sed -E "s#grab-frame(\.v[0-9]+)?\.js(\?v=[0-9]+)?#$JS#g" "$INDEX" > "$tmp" && mv "$tmp" "$INDEX"
  echo "✓ updated index.html to reference $JS"
else
  tmp="$(mktemp)"
  sed "s#</body>#${TAG}</body>#" "$INDEX" > "$tmp" && mv "$tmp" "$INDEX"
  grep -q "$JS" "$INDEX" \
    && echo "✓ injected script tag into index.html" \
    || { echo "WARN: add this before </body> manually:"; echo "  $TAG"; }
fi

echo "Done. Make sure server.py is running, then hard-refresh Jellyfin (Cmd/Ctrl+Shift+R)."
