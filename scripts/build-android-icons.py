"""Redraw the Android launcher icons and splash screens from the one Zuri mark.

Every other surface (Windows exe, tray, window, overlay, Office add-in, the web
favicon) paints `src/main/assets/zuri-icon.png`. Android was the one surface still
wearing the stock Capacitor artwork: a grey cross on a white plate, and a blue
cross on the splash. That made the phone the only place the brand looked different.

This script derives all of it from the same master file, so the phone cannot drift
from the desktop again. It only changes colour and geometry, never the drawing.

    python scripts/build-android-icons.py

Android needs three different shapes of the same mark:

* `ic_launcher` and `ic_launcher_round` are used by Android 7 and older. They are
  the finished mark: navy plate, white bubble, alpha outside the plate.
* `ic_launcher_foreground` is the Android 8+ adaptive icon. The system draws the
  plate itself (`values/ic_launcher_background.xml`) and slides the foreground
  around, so this file must be the white bubble alone on transparency, sitting
  inside the 66dp safe zone of the 108dp canvas or a circular mask will clip it.
* `splash.png` is drawn straight to the screen at launch, so the mark is placed on
  the brand white page at the size the old splash used.
"""
from PIL import Image
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = os.path.join(ROOT, 'src', 'main', 'assets', 'zuri-icon.png')
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')

# Read from the mark itself so the script cannot disagree with the artwork.
# Luminance splits the two flat colours: the white bubble is far brighter than
# the navy plate, so no hex value has to be repeated here.
PLATE_LUMA = 128
# The system masks the adaptive foreground to a 72dp circle inside 108dp. Keeping
# the bubble inside 58dp of the canvas leaves room for that mask on every launcher.
SAFE_FRACTION = 0.58

# Android's density ladder. Each entry is (folder, launcher px, adaptive canvas px).
DENSITIES = [
    ('mdpi', 48, 108),
    ('hdpi', 72, 162),
    ('xhdpi', 96, 216),
    ('xxhdpi', 144, 324),
    ('xxxhdpi', 192, 432),
]

# The splash sizes Capacitor generated, kept identical so the theme that points at
# @drawable/splash still finds a file for every orientation and density.
SPLASHES = [
    ('drawable', 480, 320),
    ('drawable-land-mdpi', 480, 320),
    ('drawable-land-hdpi', 800, 480),
    ('drawable-land-xhdpi', 1280, 720),
    ('drawable-land-xxhdpi', 1600, 960),
    ('drawable-land-xxxhdpi', 1920, 1280),
    ('drawable-port-mdpi', 320, 480),
    ('drawable-port-hdpi', 480, 800),
    ('drawable-port-xhdpi', 720, 1280),
    ('drawable-port-xxhdpi', 960, 1600),
    ('drawable-port-xxxhdpi', 1280, 1920),
]


def luminance(pixel):
    r, g, b, _ = pixel
    return 0.299 * r + 0.587 * g + 0.114 * b


def bubble_only(master):
    """The white bubble with its two eyes, plate and page removed.

    The plate is the shape that touches the canvas edge, so a flood fill from the
    border over the dark pixels reaches all of it and nothing else: the eyes are
    enclosed by white, which the fill cannot cross. Whatever the fill does not
    reach is the mark, and its antialiased edge keeps its own soft alpha.
    """
    width, height = master.size
    src = master.load()
    reachable = bytearray(width * height)
    stack = []

    for x in range(width):
        stack.append((x, 0))
        stack.append((x, height - 1))
    for y in range(height):
        stack.append((0, y))
        stack.append((width - 1, y))

    def passable(x, y):
        r, g, b, a = src[x, y]
        return a < 16 or luminance((r, g, b, a)) <= PLATE_LUMA

    while stack:
        x, y = stack.pop()
        index = y * width + x
        if reachable[index]:
            continue
        if not passable(x, y):
            continue
        reachable[index] = 1
        if x > 0:
            stack.append((x - 1, y))
        if x < width - 1:
            stack.append((x + 1, y))
        if y > 0:
            stack.append((x, y - 1))
        if y < height - 1:
            stack.append((x, y + 1))

    out = Image.new('RGBA', master.size, (0, 0, 0, 0))
    dst = out.load()
    for y in range(height):
        for x in range(width):
            if not reachable[y * width + x]:
                dst[x, y] = src[x, y]
    return out.crop(out.getbbox())


def resized(image, size):
    return image.resize((size, size), Image.LANCZOS)


def circle_mask(size, supersample=4):
    """An antialiased disc, so the round icon has no staircase edge."""
    big = Image.new('L', (size * supersample, size * supersample), 0)
    from PIL import ImageDraw
    ImageDraw.Draw(big).ellipse((0, 0, size * supersample - 1, size * supersample - 1), fill=255)
    return big.resize((size, size), Image.LANCZOS)


def write(image, folder, name):
    target_dir = os.path.join(RES, folder)
    os.makedirs(target_dir, exist_ok=True)
    path = os.path.join(target_dir, name)
    image.save(path)
    print('wrote', os.path.relpath(path, ROOT), image.size)


master = Image.open(MASTER).convert('RGBA')
bubble = bubble_only(master)

for folder, launcher_px, canvas_px in DENSITIES:
    plate = resized(master, launcher_px)
    write(plate, 'mipmap-' + folder, 'ic_launcher.png')

    # The round variant is the same plate, cut to a disc. Compositing onto the
    # plate first keeps the disc's own edge colour on-brand instead of black.
    rounded = plate.copy()
    rounded.putalpha(circle_mask(launcher_px))
    write(rounded, 'mipmap-' + folder, 'ic_launcher_round.png')

    # Adaptive foreground: the bubble, centred, inside the safe zone.
    target = max(1, round(canvas_px * SAFE_FRACTION))
    scaled = bubble.resize((target, round(target * bubble.height / bubble.width)), Image.LANCZOS)
    foreground = Image.new('RGBA', (canvas_px, canvas_px), (0, 0, 0, 0))
    foreground.paste(
        scaled,
        ((canvas_px - scaled.width) // 2, (canvas_px - scaled.height) // 2),
        scaled,
    )
    write(foreground, 'mipmap-' + folder, 'ic_launcher_foreground.png')

for folder, width, height in SPLASHES:
    page = Image.new('RGBA', (width, height), (255, 255, 255, 255))
    mark = min(width, height)
    size = max(64, round(mark * 0.22))
    glyph = resized(master, size)
    page.paste(glyph, ((width - size) // 2, (height - size) // 2), glyph)
    write(page.convert('RGB'), folder, 'splash.png')

print('Android icons and splashes now match', os.path.relpath(MASTER, ROOT))
