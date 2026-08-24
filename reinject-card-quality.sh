#!/bin/sh
# Inject (or re-inject) card-quality.js into the Jellyfin web client.
# Jellyfin updates overwrite the jellyfin-web folder, so re-run this afterwards.
# Idempotent: safe to run any time. Bump VERSION to bust the browser cache.
#
# Override the web client location if auto-detection misses it, e.g.:
#   JELLYFIN_WEB=/usr/share/jellyfin/web ./reinject-card-quality.sh
set -e

VERSION="v1"
DIR="$(cd "$(dirname "$0")" && pwd)"
MASTER="$DIR/card-quality.js"

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
JS="card-quality.$VERSION.js"
TAG="<script defer src=\"$JS\"></script>"

if [ -z "$WEB" ] || [ ! -d "$WEB" ]; then
  echo "ERROR: jellyfin-web not found. Set JELLYFIN_WEB=/path/to/jellyfin-web"; exit 1
fi
if [ ! -f "$MASTER" ]; then
  echo "ERROR: card-quality.js not found next to this script"; exit 1
fi

# 1) (re)place the script (remove any stale copies first)
rm -f "$WEB"/card-quality.js "$WEB"/card-quality.v*.js
cp "$MASTER" "$WEB/$JS"
echo "✓ copied $JS into $WEB"

# 2) ensure the <script> tag is in index.html, pointing at the current $JS
if grep -q "$JS" "$INDEX"; then
  echo "✓ index.html already references $JS"
elif grep -q "card-quality" "$INDEX"; then
  tmp="$(mktemp)"
  sed -E "s#card-quality(\.v[0-9]+)?\.js(\?v=[0-9]+)?#$JS#g" "$INDEX" > "$tmp" && mv "$tmp" "$INDEX"
  echo "✓ updated index.html to reference $JS"
else
  tmp="$(mktemp)"
  sed "s#</body>#${TAG}</body>#" "$INDEX" > "$tmp" && mv "$tmp" "$INDEX"
  grep -q "$JS" "$INDEX" \
    && echo "✓ injected script tag into index.html" \
    || { echo "WARN: add this before </body> manually:"; echo "  $TAG"; }
fi

echo "Done. Hard-refresh Jellyfin (Cmd/Ctrl+Shift+R)."
