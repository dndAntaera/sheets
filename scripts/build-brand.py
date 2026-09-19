"""Make the site's icons and logo images from the Antæra logo.

    python scripts/build-brand.py [path/to/antaera_Shared_Images]

Reads the two logos kept beside the repositories (default:
../antaera_Shared_Images):

    logo_Antaera.png      on a white background - for icons, and anywhere the
                          purple would run into the site's own purple
    logo_Antaera_02.png   transparent - for branding on the dark sky

and writes, sized for where they are shown:

    web/icons/icon-192.png, icon-512.png   the installed app, from the white one
    web/icons/maskable-512.png             the same, padded for shaped icons
    web/icons/apple-touch-icon.png         an iPhone's home screen (180)
    web/icons/favicon-48.png               the browser tab
    web/brand/logo-mark-96.png, -256.png   the transparent logo, header and pages
    web/brand/logo-disc-96.png             the white one on a disc, for the header
                                           bar - the wiki's header logo, made the
                                           same way
    web/brand/logo-badge-320.png           the white one, as a badge on purple

Plain Python, no imaging library: PNGs are decoded, averaged down, and written
back. Rerun it when the logo changes.
"""

import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / 'antaera_Shared_Images'


def read_png(path):
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', f'{path} is not a PNG'
    pos, idat, width, height, colortype = 8, b'', 0, 0, 0
    while pos < len(data):
        length = struct.unpack('>I', data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        if kind == b'IHDR':
            width, height, depth, colortype, _, _, interlace = struct.unpack('>IIBBBBB', body)
            assert depth == 8 and colortype in (2, 6) and interlace == 0, 'only 8-bit RGB or RGBA, not interlaced'
        elif kind == b'IDAT':
            idat += body
        pos += 12 + length
    channels = 4 if colortype == 6 else 3
    raw = zlib.decompress(idat)
    stride = width * channels
    pixels = bytearray(height * stride)
    prev = bytearray(stride)
    for y in range(height):
        f = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for x in range(stride):
            a = line[x - channels] if x >= channels else 0
            b = prev[x]
            c = prev[x - channels] if x >= channels else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        pixels[y * stride:(y + 1) * stride] = line
        prev = line
    if channels == 3:
        rgba = bytearray(width * height * 4)
        for i in range(width * height):
            rgba[i * 4:i * 4 + 3] = pixels[i * 3:i * 3 + 3]
            rgba[i * 4 + 3] = 255
        pixels = rgba
    return width, height, pixels


def write_png(path, width, height, rgba):
    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xffffffff)
    rows = b''.join(b'\x00' + bytes(rgba[y * width * 4:(y + 1) * width * 4]) for y in range(height))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))


def resize(width, height, rgba, size):
    """Area average, with colour weighted by alpha so transparent edges do not darken."""
    out = bytearray(size * size * 4)
    scale = width / size
    for oy in range(size):
        y0, y1 = int(oy * scale), max(int(oy * scale) + 1, int((oy + 1) * scale))
        for ox in range(size):
            x0, x1 = int(ox * scale), max(int(ox * scale) + 1, int((ox + 1) * scale))
            r = g = b = a = n = 0
            for y in range(y0, min(y1, height)):
                base = y * width
                for x in range(x0, min(x1, width)):
                    i = (base + x) * 4
                    alpha = rgba[i + 3]
                    r += rgba[i] * alpha
                    g += rgba[i + 1] * alpha
                    b += rgba[i + 2] * alpha
                    a += alpha
                    n += 1
            o = (oy * size + ox) * 4
            if a:
                out[o], out[o + 1], out[o + 2] = r // a, g // a, b // a
            out[o + 3] = a // n if n else 0
    return out


def on_white(size, rgba):
    """Flatten onto white: an icon has no transparency."""
    out = bytearray(rgba)
    for i in range(0, len(out), 4):
        alpha = out[i + 3]
        for k in range(3):
            out[i + k] = (out[i + k] * alpha + 255 * (255 - alpha)) // 255
        out[i + 3] = 255
    return out


def on_disc(size, rgba):
    """Flatten onto white and cut to a circle, its edge smoothed over a pixel."""
    out = on_white(size, rgba)
    r = size / 2
    for y in range(size):
        for x in range(size):
            # Four samples a pixel: enough that the rim does not step.
            inside = sum(((x + dx) - r) ** 2 + ((y + dy) - r) ** 2 <= r * r for dx in (.25, .75) for dy in (.25, .75))
            out[(y * size + x) * 4 + 3] = inside * 255 // 4
    return out


def padded(size, inner, rgba_inner):
    """`rgba_inner` (inner x inner) centred on a white square of `size`."""
    out = bytearray([255] * (size * size * 4))
    off = (size - inner) // 2
    for y in range(inner):
        start = ((off + y) * size + off) * 4
        out[start:start + inner * 4] = rgba_inner[y * inner * 4:(y + 1) * inner * 4]
    return out


def main():
    icon_src = SOURCE / 'logo_Antaera.png'
    mark_src = SOURCE / 'logo_Antaera_02.png'
    iw, ih, icon = read_png(icon_src)
    mw, mh, mark = read_png(mark_src)
    icons = ROOT / 'web' / 'icons'
    brand = ROOT / 'web' / 'brand'

    for name, size in [('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180), ('favicon-48.png', 48)]:
        write_png(icons / name, size, size, on_white(size, resize(iw, ih, icon, size)))
        print('wrote', name)
    # Shaped icons (Android) cut to a circle of 80%: the logo sits inside it.
    inner = 380
    write_png(icons / 'maskable-512.png', 512, 512, padded(512, inner, on_white(inner, resize(iw, ih, icon, inner))))
    print('wrote maskable-512.png')

    for name, size in [('logo-mark-96.png', 96), ('logo-mark-256.png', 256)]:
        write_png(brand / name, size, size, resize(mw, mh, mark, size))
        print('wrote', name)
    write_png(brand / 'logo-badge-320.png', 320, 320, on_white(320, resize(iw, ih, icon, 320)))
    print('wrote logo-badge-320.png')
    write_png(brand / 'logo-disc-96.png', 96, 96, on_disc(96, resize(iw, ih, icon, 96)))
    print('wrote logo-disc-96.png')


if __name__ == '__main__':
    main()
