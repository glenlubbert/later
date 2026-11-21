#!/usr/bin/env python3
"""Draws the Later icon (rust rounded square, cream bookmark) as PNGs with no
third-party libraries."""
import zlib, struct, pathlib

BG = (181, 73, 44)
FG = (250, 246, 238)

def inside_round_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1: return False
    cx = min(max(x, x0 + r), x1 - r); cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def pixel(u, v, rounded):
    """u, v in 0..1. Returns (r, g, b, a)."""
    if rounded and not inside_round_rect(u, v, 0, 0, 1, 1, 0.225): return (0, 0, 0, 0)
    # bookmark: tall rectangle with a V notch cut from the bottom
    if inside_round_rect(u, v, 0.32, 0.22, 0.68, 0.80, 0.045):
        notch = 0.80 - 0.17 * (1 - abs(u - 0.5) / 0.18)
        if v <= notch: return FG + (255,)
    return BG + (255,)

def render(size, rounded=True, ss=4):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    r, g, b, a = pixel((x + (sx + .5) / ss) / size, (y + (sy + .5) / ss) / size, rounded)
                    acc[0] += r * a; acc[1] += g * a; acc[2] += b * a; acc[3] += a
            n = ss * ss
            a = acc[3] / n
            if acc[3]: rows += bytes([round(acc[0] / acc[3]), round(acc[1] / acc[3]), round(acc[2] / acc[3]), round(a)])
            else: rows += b"\0\0\0\0"
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b""))

root = pathlib.Path(__file__).resolve().parent.parent
for size in (16, 32, 48, 128):
    (root / "extension" / "icons" / f"{size}.png").write_bytes(render(size))
for size in (192, 512):
    (root / "public" / "icons" / f"{size}.png").write_bytes(render(size))
# iOS home screen icons are masked by the system, so they must be full-bleed.
(root / "public" / "icons" / "apple-touch-icon.png").write_bytes(render(180, rounded=False))
(root / "public" / "icons" / "maskable-512.png").write_bytes(render(512, rounded=False))
(root / "public" / "icons" / "favicon.png").write_bytes(render(64))
print("icons written")
