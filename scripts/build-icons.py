"""Draw the app's icons: a twenty-sided die on the night sky.

    python scripts/build-icons.py

Writes web/icons/: icon-192.png, icon-512.png, maskable-512.png (with the
padding Android's shaped icons cut into) and apple-touch-icon.png (180). Plain
Python, no imaging library: each icon is drawn at twice its size and averaged
down, which is enough anti-aliasing for straight edges.
"""

import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'web' / 'icons'

SKY = (6, 7, 15)
SKY_NEAR = (28, 22, 58)
FACE = (191, 0, 255)        # --accent
FACE_DARK = (143, 0, 191)   # --accent-dark
EDGE = (240, 220, 255)


def hexagon(cx, cy, r):
    return [(cx + r * math.sin(math.radians(a)), cy - r * math.cos(math.radians(a))) for a in range(0, 360, 60)]


def inside(px, py, poly):
    """Point in a convex polygon given clockwise on screen."""
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1) < 0:
            return False
    return True


def near_segment(px, py, a, b, width):
    (x1, y1), (x2, y2) = a, b
    dx, dy = x2 - x1, y2 - y1
    t = max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)) <= width


def draw(size, pad):
    scale = 2
    big = size * scale
    cx = cy = big / 2
    r = big / 2 * (1 - pad)
    outer = hexagon(cx, cy, r)
    # The die's front face: a triangle inside the hexagon, point up.
    tri = [(cx, cy - r * 0.62), (cx + r * 0.62 * math.sin(math.radians(60)), cy + r * 0.31), (cx - r * 0.62 * math.sin(math.radians(60)), cy + r * 0.31)]
    line = big * 0.012
    edges = [(outer[i], tri[j]) for i, j in [(0, 0), (1, 1), (2, 1), (3, 2), (4, 2), (5, 0)]] + [(outer[1], tri[0]), (outer[5], tri[2]), (outer[3], tri[1])]
    edges += [(tri[i], tri[(i + 1) % 3]) for i in range(3)] + [(outer[i], outer[(i + 1) % 6]) for i in range(6)]

    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            acc = [0, 0, 0]
            for sy in range(scale):
                for sx in range(scale):
                    px, py = x * scale + sx + .5, y * scale + sy + .5
                    glow = max(0.0, 1 - math.hypot(px - cx, py - cy * 0.7) / (big * 0.75))
                    c = tuple(int(SKY[k] + (SKY_NEAR[k] - SKY[k]) * glow) for k in range(3))
                    if inside(px, py, outer):
                        c = FACE if inside(px, py, tri) else FACE_DARK
                        if any(near_segment(px, py, a, b, line) for a, b in edges):
                            c = EDGE
                    for k in range(3):
                        acc[k] += c[k]
            row.extend(v // (scale * scale) for v in acc)
        rows.append(bytes(row))
    return rows


def png(size, rows):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    header = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b'')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, pad in [('icon-192.png', 192, .14), ('icon-512.png', 512, .14), ('maskable-512.png', 512, .3), ('apple-touch-icon.png', 180, .16)]:
        (OUT / name).write_bytes(png(size, draw(size, pad)))
        print('wrote', name)


if __name__ == '__main__':
    main()
