#!/usr/bin/env bash
# Regenerate the Academicons webfont subset.
#
# The upstream Academicons build ships 146 icon rules and a 131 KB webfont. This
# site uses a handful of icons, so we subset the font to exactly the glyphs the
# markup references and emit a woff2. Run this after adding or removing any
# `ai-*` icon in index.html, then commit the regenerated files.
#
# Requires: python3 with fonttools and brotli
#   python3 -m pip install --user fonttools brotli
#
# Usage: tools/build-webfonts.sh

set -euo pipefail
cd "$(dirname "$0")/.."

SRC_FONT="fonts/academicons.woff"
SRC_CSS="vendor/academicons.min.css"
OUT_FONT="fonts/academicons-subset.woff2"
OUT_CSS="vendor/academicons-subset.min.css"

[[ -f "$SRC_FONT" ]] || { echo "ERROR: missing source font $SRC_FONT" >&2; exit 1; }
[[ -f "$SRC_CSS" ]]  || { echo "ERROR: missing source CSS $SRC_CSS" >&2; exit 1; }

# Which ai-* icons does the markup actually use?
# (bash 3.2 on macOS has no mapfile, so collect into a space-separated list.)
ICONS=$(grep -ho 'ai ai-[a-z0-9-]*' index.html | sed 's/.*ai-//' | sort -u | tr '\n' ' ')
[[ -n "${ICONS// /}" ]] || { echo "ERROR: no ai-* icons found in index.html" >&2; exit 1; }
echo "Icons in use: $ICONS"

# Map each icon name to its codepoint from the upstream CSS.
UNICODES=""
for icon in $ICONS; do
  cp=$(grep -o "\.ai-${icon}:before[^}]*}" "$SRC_CSS" \
       | grep -o '\\[0-9a-fA-F]\{3,6\}' | tr -d '\\' | head -1)
  [[ -n "$cp" ]] || { echo "ERROR: no codepoint for ai-$icon in $SRC_CSS" >&2; exit 1; }
  echo "  ai-$icon -> U+$(echo "$cp" | tr '[:lower:]' '[:upper:]')"
  UNICODES="${UNICODES:+$UNICODES,}U+${cp}"
done

echo "Subsetting $SRC_FONT to $UNICODES"
python3 -m fontTools.subset "$SRC_FONT" \
  --unicodes="$UNICODES" \
  --flavor=woff2 \
  --no-hinting \
  --desubroutinize \
  --output-file="$OUT_FONT"

# Fail rather than ship a font whose glyphs have no outlines.
python3 - "$OUT_FONT" "$UNICODES" <<'PY'
import sys
from fontTools.ttLib import TTFont
font, unicodes = sys.argv[1], sys.argv[2]
f = TTFont(font)
cmap = f.getBestCmap()
for token in unicodes.split(','):
    cp = int(token.replace('U+', ''), 16)
    name = cmap.get(cp)
    if not name:
        sys.exit(f'FAIL: U+{cp:04X} missing from subset cmap')
    if 'glyf' in f:
        g = f['glyf'][name]
        if not g.numberOfContours:
            sys.exit(f'FAIL: U+{cp:04X} ({name}) has no outlines')
    else:
        cs = f['CFF '].cff.topDictIndex[0].CharStrings[name]
        if len(cs.bytecode) < 10:
            sys.exit(f'FAIL: U+{cp:04X} ({name}) charstring looks empty')
    print(f'  OK U+{cp:04X} -> {name}')
PY

echo
echo "Source font : $(wc -c < "$SRC_FONT") bytes"
echo "Subset font : $(wc -c < "$OUT_FONT") bytes"
echo
echo "NOTE: $OUT_CSS declares the @font-face and the .ai-* rules by hand."
echo "If you added an icon, add its rule there too, e.g.:"
echo '  .ai-github:before{content:"\eXXX"}'
