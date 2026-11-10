#!/usr/bin/env bash
# Builds ONE hand-off archive: bash scripts/make-handoff.sh <out.zip>
# Needs: node/npm (deps installed), git, python3, zip. Run from dev/snowcraft.
set -euo pipefail
OUT="${1:?usage: make-handoff.sh <out.zip>}"; OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
VER="$(node -p "require('./package.json').version")"; NAME="snowcraft-handoff-v$VER"
W="$(mktemp -d)"; D="$W/$NAME"; mkdir -p "$D/release" "$D/source"
npx tsc --noEmit
npx vite build >/dev/null; node scripts/artifact.mjs /dev/null dist/index.html >/dev/null 2>&1 || true
cp dist/index.html "$D/release/snowcraft-preview-v$VER.html"
npm run build:pg >/dev/null; cp release/snowcraft-playgama.zip "$D/release/snowcraft-playgama-v$VER.zip"
[ -d verify ] && cp -r verify "$D/verify"
for f in HANDOFF-PROMPT.md README-FIRST.md HANDOFF.md DESIGN.md SPEC.md TERRARIA_CONTROLS.md AGENTS_W5.md; do [ -f "$f" ] && cp "$f" "$D/"; done
for d in playgama design playtest; do [ -d "$d" ] && cp -r "$d" "$D/$d"; done
git ls-files -z . | xargs -0 -I{} cp --parents {} "$D/source/"
(cd "$W" && rm -f "$OUT" && zip -qr "$OUT" "$NAME")
echo "wrote $OUT ($(wc -c < "$OUT") bytes)"
