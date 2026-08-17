#!/usr/bin/env bash
# ─── make-icons.sh ───────────────────────────────────────────────────────
# Regenerates the app icons in site/assets/ from the ▸ brand mark.
#
# There is no image toolchain on this box (no ImageMagick / rsvg / PIL), so the
# rasterizer is headless Chrome, which is already installed. The mark is drawn
# as an SVG <polygon>, NOT the ▸ glyph, so the output doesn't depend on which
# fonts happen to be present.
#
# Two artworks, same mark, different scale:
#
#   any       shown as-is (Chrome's install prompt, the task switcher). Nothing
#             masks it, so the mark can run close to the edges.
#   maskable  re-cut by Android to the launcher's shape (a circle on a Pixel).
#             Anything outside a centre circle of 80% diameter can be shaved
#             off, so the mark is scaled down to sit well inside it. Bubblewrap
#             turns this one into the adaptive launcher icon.
#
#   ./tools/make-icons.sh
#
# Colour tracks styles.css: --accent #2563eb on the light theme.

set -euo pipefail

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "Google Chrome not found at $CHROME" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/site/assets"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Writes a 512x512 icon page to $2, with the mark scaled by $1 about the centre.
# The base triangle (200,150)-(200,362)-(360,256) is the ▸ from the site logo;
# the round stroke gives it the soft corners the glyph has.
emit() {
  awk -v s="$1" 'BEGIN {
    c = 256;
    split("200 150 200 362 360 256", p, " ");
    for (i = 1; i <= 6; i++) q[i] = c + (p[i] - c) * s;
    printf "<!DOCTYPE html><meta charset=\"utf-8\">\n";
    printf "<style>html,body{margin:0;padding:0;width:512px;height:512px;overflow:hidden}</style>\n";
    printf "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"512\" height=\"512\" viewBox=\"0 0 512 512\">\n";
    printf "  <rect width=\"512\" height=\"512\" fill=\"#2563eb\"/>\n";
    printf "  <polygon points=\"%.2f,%.2f %.2f,%.2f %.2f,%.2f\"\n", q[1], q[2], q[3], q[4], q[5], q[6];
    printf "           fill=\"#fff\" stroke=\"#fff\" stroke-width=\"%.2f\" stroke-linejoin=\"round\"/>\n", 26 * s;
    printf "</svg>\n";
  }' > "$2"
}

# Chrome always shoots the 512px page; sips downsamples for the smaller sizes.
shoot() {  # $1 = html, $2 = png, $3 = size
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
            --force-device-scale-factor=1 \
            --screenshot="$2" --window-size=512,512 \
            "file://$1" >/dev/null 2>&1
  [ "$3" = 512 ] || sips -z "$3" "$3" "$2" >/dev/null
}

emit 1.60 "$TMP/any.html"       # unmasked: mark runs near the edge
emit 1.30 "$TMP/maskable.html"  # masked: mark stays inside the safe circle

shoot "$TMP/any.html"      "$OUT/icon-512.png"          512
shoot "$TMP/any.html"      "$OUT/icon-192.png"          192
shoot "$TMP/maskable.html" "$OUT/icon-maskable-512.png" 512
shoot "$TMP/maskable.html" "$OUT/icon-maskable-192.png" 192

echo "Wrote:"
for f in icon-192.png icon-512.png icon-maskable-192.png icon-maskable-512.png; do
  printf '  site/assets/%-24s %s\n' "$f" \
    "$(sips -g pixelWidth -g pixelHeight "$OUT/$f" | awk '/pixel/ { printf "%s ", $2 }')"
done
