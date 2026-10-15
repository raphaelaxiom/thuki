#!/bin/sh
# Build src-tauri/icons/icon.icns from src-tauri/icons/icon.iconset/.
# On macOS uses iconutil (native, JPEG 2000 payloads for large slots);
# elsewhere falls back to the pure-Python PNG-payload writer.
set -eu
cd "$(dirname "$0")/.."
if command -v iconutil >/dev/null 2>&1; then
  iconutil -c icns -o src-tauri/icons/icon.icns src-tauri/icons/icon.iconset
else
  python3 scripts/build-icns.py
fi
