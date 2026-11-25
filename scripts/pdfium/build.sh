#!/usr/bin/env bash
# Links LiteParse's patched pdfium (run-llama/pdfium-binaries) into an ES module
# plus a wasm binary: .pdfium-build/pdfium.mjs and .pdfium-build/pdfium.wasm.
#
# Pinned inputs (change them together, and re-run tests/ocria/pdf-*.test.ts):
#   archive  pdfium-emscripten-wasm.tgz of release chromium/8172 (pdfium 160.0.8172.0)
#   emsdk    3.1.72, the version that release was built with
# Env: PDFIUM_CACHE (download and emsdk cache, default ~/.cache/ppu-ocria-nano-pdfium: outside the model cache, which `clear-cache` deletes and CI caches separately),
#      EMSDK_DIR (an existing emsdk checkout, default $PDFIUM_CACHE/emsdk).
set -euo pipefail

RELEASE="chromium/8172"
ARCHIVE="pdfium-emscripten-wasm.tgz"
SHA256="10ed1da77f367493f307770552fed25e296ba64e603a4f2ba5cae7ec38ac9668"
EMSDK_VERSION="3.1.72"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CACHE="${PDFIUM_CACHE:-$HOME/.cache/ppu-ocria-nano-pdfium}"
EMSDK_DIR="${EMSDK_DIR:-$CACHE/emsdk}"
OUT="$ROOT/.pdfium-build"
SRC="$CACHE/chromium-8172"

mkdir -p "$CACHE" "$OUT"

sha256_of() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# 1. The archive, checked against the pinned digest.
if [ ! -f "$CACHE/$ARCHIVE" ] || [ "$(sha256_of "$CACHE/$ARCHIVE")" != "$SHA256" ]; then
  curl -fsSL -o "$CACHE/$ARCHIVE" \
    "https://github.com/run-llama/pdfium-binaries/releases/download/$RELEASE/$ARCHIVE"
fi
if [ "$(sha256_of "$CACHE/$ARCHIVE")" != "$SHA256" ]; then
  echo "sha256 of $ARCHIVE does not match $SHA256" >&2
  exit 1
fi
if [ ! -f "$SRC/lib/libpdfium.a" ]; then
  rm -rf "$SRC" && mkdir -p "$SRC"
  tar -xzf "$CACHE/$ARCHIVE" -C "$SRC"
fi

# 2. emsdk at the pinned version.
if [ ! -d "$EMSDK_DIR" ]; then
  git clone --depth 1 --branch "$EMSDK_VERSION" https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
fi
if [ ! -d "$EMSDK_DIR/upstream/emscripten" ] || ! "$EMSDK_DIR/upstream/emscripten/emcc" --version 2>/dev/null | grep -q " $EMSDK_VERSION "; then
  "$EMSDK_DIR/emsdk" install "$EMSDK_VERSION"
  "$EMSDK_DIR/emsdk" activate "$EMSDK_VERSION"
fi
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1

# 3. Link. Every FPDF*/FORM_* function src/pdf/pdfium/ calls is listed in exports.txt.
#    addFunction and the growable function table let src/pdf/pdfium/system-fonts.ts give pdfium a
#    font provider written in JavaScript (the wasm build has no system fonts).
EXPORTS="$(grep -v '^#' "$HERE/exports.txt" | grep -v '^$' | sed 's/^/_/' | paste -sd, -)"
emcc "$SRC/lib/libpdfium.a" \
  -O2 \
  -o "$OUT/pdfium.mjs" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createPdfium \
  -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sALLOW_TABLE_GROWTH=1 -sINITIAL_MEMORY=33554432 -sSTACK_SIZE=1048576 \
  -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS="_malloc,_free,$EXPORTS" \
  -sEXPORTED_RUNTIME_METHODS=addFunction,HEAPU8,HEAP16,HEAPU16,HEAP32,HEAPU32,HEAPF32,HEAPF64 \
  -sWASM_BIGINT=0

# 4. Licenses: pdfium's and the third-party libraries it links.
rm -rf "$OUT/licenses" && mkdir -p "$OUT/licenses"
cp "$SRC/LICENSE" "$OUT/licenses/PDFIUM-BINARIES-LICENSE"
cp "$SRC"/licenses/* "$OUT/licenses/"
cp "$SRC/VERSION" "$OUT/VERSION"

ls -l "$OUT/pdfium.mjs" "$OUT/pdfium.wasm"
echo "emsdk $EMSDK_VERSION, pdfium $(tr '\n' '.' < "$SRC/VERSION" | sed 's/[A-Z]*=//g; s/\.$//')"
