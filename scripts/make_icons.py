"""Generate the app icons (PNG + SVG) with no dependencies.

    python scripts/make_icons.py

Draws a top-down quad: four rotor rings, X arms and a body, anti-aliased with
signed-distance shapes, then writes PNGs with zlib.
"""

import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "icons")

BG = (11, 15, 20)
ACCENT = (163, 230, 53)
RING = (96, 165, 250)


def sd_circle(px, py, cx, cy, r):
    return math.hypot(px - cx, py - cy) - r


def sd_segment(px, py, ax, ay, bx, by, r):
    pax, pay, bax, bay = px - ax, py - ay, bx - ax, by - ay
    h = max(0.0, min(1.0, (pax * bax + pay * bay) / (bax * bax + bay * bay)))
    return math.hypot(pax - bax * h, pay - bay * h) - r


def sd_round_rect(px, py, cx, cy, hw, hh, r):
    qx, qy = abs(px - cx) - hw + r, abs(py - cy) - hh + r
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r


def blend(dst, src, a):
    return tuple(int(d + (s - d) * a + 0.5) for d, s in zip(dst, src))


def render(size, scale=1.0, rounded=True):
    """Return RGBA rows. scale shrinks the drone (for maskable safe zone)."""
    rows = []
    c = size / 2
    u = size / 512 * scale  # design units are on a 512 grid
    rotor_off, rotor_r, ring_w = 132 * u, 78 * u, 14 * u
    arm_w, body_hw, body_hh = 17 * u, 46 * u, 62 * u
    corner = 112 * size / 512
    for y in range(size):
        row = bytearray()
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            if rounded:
                d_bg = sd_round_rect(px, py, c, c, size / 2, size / 2, corner)
                a_bg = max(0.0, min(1.0, 0.5 - d_bg))
            else:
                a_bg = 1.0
            col = BG
            # arms
            d_arm = min(
                sd_segment(px, py, c - rotor_off, c - rotor_off, c + rotor_off, c + rotor_off, arm_w / 2),
                sd_segment(px, py, c - rotor_off, c + rotor_off, c + rotor_off, c - rotor_off, arm_w / 2),
            )
            col = blend(col, ACCENT, max(0.0, min(1.0, 0.5 - d_arm)))
            # rotor rings + hubs
            for sx in (-1, 1):
                for sy in (-1, 1):
                    rx, ry = c + sx * rotor_off, c + sy * rotor_off
                    d_ring = abs(sd_circle(px, py, rx, ry, rotor_r)) - ring_w / 2
                    col = blend(col, RING, max(0.0, min(1.0, 0.5 - d_ring)))
                    d_hub = sd_circle(px, py, rx, ry, 20 * u)
                    col = blend(col, ACCENT, max(0.0, min(1.0, 0.5 - d_hub)))
            # body
            d_body = sd_round_rect(px, py, c, c, body_hw, body_hh, 18 * u)
            col = blend(col, ACCENT, max(0.0, min(1.0, 0.5 - d_body)))
            d_cam = sd_round_rect(px, py, c, c - 34 * u, 20 * u, 12 * u, 6 * u)
            col = blend(col, BG, max(0.0, min(1.0, 0.5 - d_cam)))
            row += bytes((*col, int(a_bg * 255 + 0.5)))
        rows.append(bytes(row))
    return rows


def write_png(path, rows, size):
    raw = b"".join(b"\x00" + r for r in rows)
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#0b0f14"/>
  <g stroke="#a3e635" stroke-width="17" stroke-linecap="round">
    <line x1="124" y1="124" x2="388" y2="388"/><line x1="124" y1="388" x2="388" y2="124"/>
  </g>
  <g fill="none" stroke="#60a5fa" stroke-width="14">
    <circle cx="124" cy="124" r="78"/><circle cx="388" cy="124" r="78"/>
    <circle cx="124" cy="388" r="78"/><circle cx="388" cy="388" r="78"/>
  </g>
  <g fill="#a3e635">
    <circle cx="124" cy="124" r="20"/><circle cx="388" cy="124" r="20"/>
    <circle cx="124" cy="388" r="20"/><circle cx="388" cy="388" r="20"/>
    <rect x="210" y="194" width="92" height="124" rx="18"/>
  </g>
  <rect x="236" y="210" width="40" height="24" rx="6" fill="#0b0f14"/>
</svg>
"""


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, size, scale, rounded in [
        ("icon-192.png", 192, 1.0, True),
        ("icon-512.png", 512, 1.0, True),
        ("maskable-512.png", 512, 0.78, False),
        ("apple-touch-icon.png", 180, 0.9, False),
    ]:
        write_png(os.path.join(OUT, name), render(size, scale, rounded), size)
        print("wrote", name)
    with open(os.path.join(OUT, "icon.svg"), "w", encoding="utf-8") as f:
        f.write(SVG)
    print("wrote icon.svg")


if __name__ == "__main__":
    main()
