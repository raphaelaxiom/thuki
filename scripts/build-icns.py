#!/usr/bin/env python3
"""Build src-tauri/icons/icon.icns from src-tauri/icons/icon.iconset/.

Pure-Python fallback for machines without macOS `iconutil` (e.g. Linux
CI / dev containers). Writes a standard `icns` container whose elements
carry PNG payloads — accepted by modern macOS (11+) for all icon slots.

Prefer the native tool when available: `scripts/build-icns.sh` uses
`iconutil -c icns` on macOS, which produces JPEG 2000 payloads for the
large slots, and falls back to this script otherwise. Before a release,
regenerate on macOS and verify with `sips -g all <file>` / Finder preview.

Usage: python3 scripts/build-icns.py [--iconset DIR] [--out FILE]
"""
import argparse
import struct
import sys
from pathlib import Path

# (icns element type, iconset file, expected pixel size)
ELEMENTS = [
    ("icp4", "icon_16x16.png", 16),
    ("icp5", "icon_32x32.png", 32),
    ("icp6", "icon_32x32@2x.png", 64),
    ("ic07", "icon_128x128.png", 128),
    ("ic08", "icon_256x256.png", 256),  # icon_128x128@2x
    ("ic09", "icon_512x512.png", 512),  # icon_256x256@2x
    ("ic10", "icon_512x512@2x.png", 1024),
    ("ic11", "icon_32x32@2x.png", 64),
    ("ic12", "icon_16x16@2x.png", 32),
    ("ic13", "icon_128x128@2x.png", 256),
    ("ic14", "icon_256x256@2x.png", 512),
]



def build(iconset: Path, out: Path) -> None:
    body = bytearray()
    for etype, filename, size in ELEMENTS:
        png = (iconset / filename).read_bytes()
        if png[:8] != b"\x89PNG\r\n\x1a\n":
            raise SystemExit(f"{filename}: not a PNG file")
        body += etype.encode("ascii")
        body += struct.pack(">I", 8 + len(png))
        body += png
    total = 8 + len(body)
    out.write_bytes(b"icns" + struct.pack(">I", total) + bytes(body))
    print(f"wrote {out} ({total} bytes, {len(ELEMENTS)} elements)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--iconset", default="src-tauri/icons/icon.iconset")
    ap.add_argument("--out", default="src-tauri/icons/icon.icns")
    args = ap.parse_args()
    build(Path(args.iconset), Path(args.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
