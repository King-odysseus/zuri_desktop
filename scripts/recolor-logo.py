"""Repaint the Zuri mark's plate to the logo navy.

The mark is the installed app icon: a flat rounded square behind a white speech
bubble. Every pixel is a blend between the plate colour and white, so the plate is
swapped by solving that blend per pixel and rebuilding it against the new colour.
That keeps the antialiased edges and the white bubble exactly as they were, which a
naive colour replace would jaggy.

Run it once whenever the brand navy changes:
    python scripts/recolor-logo.py
"""
from PIL import Image
import glob

PLATE = (13, 27, 58)       # the plate every copy currently uses, #0d1b3a
NAVY = (30, 58, 138)       # the logo navy, #1e3a8a: clearly navy, not black
TARGETS = [
    'web/public/zuri-logo.png',
    'src/renderer-react/assets/zuri-logo.png',
    'docs/mockups/assets/zuri-logo.png',
    'server/public/zuri-logo.png',
]


def repaint(image):
    out = Image.new('RGBA', image.size)
    src = image.load()
    dst = out.load()
    width, height = image.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = src[x, y]
            if a == 0:
                dst[x, y] = (0, 0, 0, 0)
                continue
            # How far this pixel sits from the plate toward white, read off the red
            # channel: it runs from the plate's red at the plate to 255 at white.
            t = min(1.0, max(0.0, (r - PLATE[0]) / (255.0 - PLATE[0])))
            dst[x, y] = (
                round(NAVY[0] + (255 - NAVY[0]) * t),
                round(NAVY[1] + (255 - NAVY[1]) * t),
                round(NAVY[2] + (255 - NAVY[2]) * t),
                a,
            )
    return out


for path in TARGETS:
    for found in glob.glob(path):
        im = Image.open(found).convert('RGBA')
        repaint(im).save(found)
        print('repainted', found, im.size)
