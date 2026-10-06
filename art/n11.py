"""N-11：用用户的证件照做的贵族（每种颜色各要 2 张土地），带「微笑比耶」循环动画。

  python art/n11.py pixel      # 证件照 → 像素头像（image-to-pixelart），白底换成贵族的深色背景
  python art/n11.py noble      # 保留脸，把衣服局部重绘成贵族服饰（bitforge inpainting）
  python art/n11.py animate    # 微笑比耶：先正放到比耶，再倒放回来，首尾相接

证件照本身和中间文件只放在 art/out/（不进仓库）。
"""
from __future__ import annotations

import io
import json
import pathlib
import sys
from collections import deque

from PIL import Image

import palettes
import pixellab

ART = pixellab.ART
OUT = ART / "out"
WORK = OUT / "nobles" / "N-11"
PHOTO = pathlib.Path.home() / "Desktop" / "证件照.jpg"
BG = (0x22, 0x1D, 0x2C)
REQUIREMENTS = {"white": 2, "blue": 2, "green": 2, "red": 2, "black": 2}
SIZE = 128


def b64(image: Image.Image) -> dict:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return {"type": "base64", "base64": __import__("base64").b64encode(buffer.getvalue()).decode(), "format": "png"}


def photo_input() -> Image.Image:
    """证件照放到正方形画布中间（两边补白），头肩比例接近其他贵族，再放大到 512 给转换接口。"""
    photo = Image.open(PHOTO).convert("RGB")
    side = 224
    canvas = Image.new("RGB", (side, side), (255, 255, 255))
    canvas.paste(photo, ((side - photo.width) // 2, -12))
    return canvas.resize((512, 512), Image.LANCZOS)


def recolor_background(image: Image.Image) -> Image.Image:
    """从四边往里灌：接近白色的连通区域就是原来的白底，换成贵族统一的深色背景。"""
    image = image.convert("RGB")
    width, height = image.size
    pixels = image.load()
    seen = set()
    queue = deque([(x, y) for x in range(width) for y in (0, height - 1)] + [(x, y) for y in range(height) for x in (0, width - 1)])
    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or not (0 <= x < width and 0 <= y < height):
            continue
        seen.add((x, y))
        r, g, b = pixels[x, y]
        if min(r, g, b) < 200 or max(r, g, b) - min(r, g, b) > 30:
            continue
        pixels[x, y] = BG
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return image


def pixel() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    source = photo_input()
    source.save(WORK / "N-11-photo-input.png")
    variants = {
        "p0": {},
        "p1": {"init_image_strength": 300},
        "p2": {"init_image_strength": 600, "fixer": True},
    }
    for name, extra in variants.items():
        path = pixellab.generate_image(f"N-11-{name}", {
            "image": b64(source),
            "image_size": {"width": 512, "height": 512},
            "output_size": {"width": SIZE, "height": SIZE},
            "seed": 1101,
            **extra,
        }, WORK, endpoint="/image-to-pixelart")
        recolor_background(Image.open(path)).save(WORK / f"N-11-{name}-dark.png")
        print(name, "ok", flush=True)


PUBLIC = ART.parent / "apps/web/public/art"
DESCRIPTION = (
    "bust portrait of a young noble with messy black hair and thin metal-rimmed glasses, calm gentle expression, "
    "wearing a black suit, white shirt and black tie under a deep purple velvet mantle with a white fur collar, "
    "a golden chain across the chest set with five gemstones: white diamond, blue sapphire, green emerald, red ruby and black onyx; "
    "the shoulders and mantle extend to the bottom edge and both sides of the square, centered, plain dark background, pixel art"
)


def palette_image() -> pathlib.Path:
    colors = palettes.noble_palette(REQUIREMENTS, "A") + palettes.RAMPS["gold"][1:5]
    return palettes.save_palette(list(dict.fromkeys(colors)), WORK / "N-11-palette.png")


def clothes_mask(base: Image.Image, top: int = 88, grow: int = 12) -> Image.Image:
    """白色 = 重画：脖子以下的人物（西装）再往两边放宽一些，给斗篷留位置；脸和头发不动。"""
    width, height = base.size
    pixels = base.load()
    mask = Image.new("L", base.size, 0)
    out = mask.load()
    for y in range(top, height):
        xs = [x for x in range(width) if pixels[x, y] != BG]
        if xs:
            for x in range(max(0, min(xs) - grow), min(width, max(xs) + grow + 1)):
                out[x, y] = 255
    return mask


def noble() -> None:
    base = Image.open(WORK / "N-11-p0-dark.png").convert("RGB")
    clothes_mask(base).save(WORK / "N-11-mask.png")
    common = {
        "description": DESCRIPTION,
        "image_size": {"width": SIZE, "height": SIZE},
        "color_image": pixellab.b64_image(palette_image()),
        "shading": "detailed shading",
        "detail": "highly detailed",
        "text_guidance_scale": 10,
    }
    style = {"style_image": pixellab.b64_image(PUBLIC / "nobles" / "N-01.png"), "style_strength": 40}
    jobs = {
        # 整张按其他贵族的画风重画，用像素头像做起点：数值越大越像原来的头像
        "c0": {"init_image": b64(base), "init_image_strength": 500, **style, "seed": 1111},
        "c1": {"init_image": b64(base), "init_image_strength": 300, **style, "seed": 1112},
        # 只重画衣服，脸完全保留
        "c2": {"inpainting_image": b64(base), "mask_image": pixellab.b64_image(WORK / "N-11-mask.png"), "seed": 1113},
    }
    for name, extra in jobs.items():
        pixellab.generate_image(f"N-11-{name}", common | extra, WORK, endpoint="/create-image-bitforge")
        print(name, "ok", flush=True)


EDIT = (
    "Dress this person as a royal noble: put a deep purple velvet mantle with a thick white fur collar over the black suit, "
    "and a golden chain across the chest set with five gemstones: white, blue, green, red and black. "
    "Keep the face, hair, glasses, shirt and tie exactly the same. Keep the plain dark background."
)


def edit() -> None:
    base = Image.open(WORK / "N-11-p0-dark.png").convert("RGB")
    for name, seed in (("e0", 1121), ("e1", 1122)):
        pixellab.generate_async(f"N-11-{name}", {
            "image": b64(base),
            "image_size": {"width": SIZE, "height": SIZE},
            "description": EDIT,
            "width": SIZE,
            "height": SIZE,
            "no_background": False,
            "text_guidance_scale": 8,
            "seed": seed,
        }, WORK, endpoint="/edit-image")
        print(name, "ok", flush=True)


def flatten_background(image: Image.Image, tolerance: int = 7) -> Image.Image:
    """edit-image 出来的背景带一点噪点：从四边灌，和角上背景色相近的连通像素统一成 BG。"""
    image = image.convert("RGB")
    width, height = image.size
    pixels = image.load()
    corners = [pixels[x, y] for x, y in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1))]
    ref = tuple(sorted(c[i] for c in corners)[1] for i in range(3))
    seen = set()
    queue = deque([(x, y) for x in range(width) for y in (0, height - 1)] + [(x, y) for y in range(height) for x in (0, width - 1)])
    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or not (0 <= x < width and 0 <= y < height):
            continue
        seen.add((x, y))
        if max(abs(pixels[x, y][i] - ref[i]) for i in range(3)) > tolerance:
            continue
        pixels[x, y] = BG
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return image


def recolor_gem_black(image: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    """链子上第五颗宝石画成了红色：按亮度换成黑曜石的色阶，白色高光保留。"""
    ramp = [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in palettes.RAMPS["black"]]
    pixels = image.load()
    for x in range(box[0], box[2]):
        for y in range(box[1], box[3]):
            r, g, b = pixels[x, y]
            if r > 120 and r > g + 50 and r > b + 20:  # 红色宝石的像素
                light = (r + g + b) / 3
                pixels[x, y] = ramp[min(len(ramp) - 1, int(light / 255 * len(ramp) * 1.4))]
    return image


def finish() -> None:
    # c0：e0（黑宝石修正 + 背景统一）；c1：e1（背景统一）
    e0 = flatten_background(Image.open(WORK / "N-11-e0.png"))
    recolor_gem_black(e0, (74, 96, 86, 108)).save(WORK / "N-11-c0.png")
    flatten_background(Image.open(WORK / "N-11-e1.png")).save(WORK / "N-11-c1.png")
    print("c0 c1 ok")


ACTION = ("the person smiles happily and raises one hand beside the face making a V sign (peace sign) "
          "with the index and middle fingers")


def animate(seed: int = 1131) -> None:
    """只给首帧：模型从平静表情一路画到笑着比耶；之后正放 + 倒放拼成循环。"""
    paths = pixellab.animate("N-11", {
        "first_frame": pixellab.b64_image(WORK / "N-11-c0.png"),
        "action": ACTION,
        "frame_count": 8,
        "no_background": False,
        "seed": seed,
    }, OUT / "anim" / "N-11")
    print(len(paths), "frames", flush=True)


# 循环顺序：平静停一下 → 抬手（1-4）→ 比耶时笑容来回变（5-8-5）→ 放下（4-1）。0 号是静态图本身。
LOOP = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 7, 6, 5, 4, 3, 2, 1]


def strip() -> None:
    frame_dir = OUT / "anim" / "N-11"
    frames = [Image.open(frame_dir / f"N-11-{index:02d}.png").convert("RGB") for index in LOOP]
    sheet = Image.new("RGB", (SIZE * len(frames), SIZE))
    for index, frame in enumerate(frames):
        sheet.paste(frame, (index * SIZE, 0))
    target = PUBLIC / "nobles-anim" / "N-11.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target, optimize=True)
    big = [frame.resize((SIZE * 3, SIZE * 3), Image.NEAREST) for frame in frames]
    big[0].save(frame_dir / "N-11.gif", save_all=True, append_images=big[1:], duration=140, loop=0)
    print(target, sheet.size)


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else "pixel"
    {"pixel": pixel, "noble": noble, "edit": edit, "finish": finish, "animate": animate, "strip": strip}[command]()
    print(f"累计花费 ${pixellab.spent_usd():.3f}")
