"""N-04：人物保留，把半身像底部的圆弧切口补成衣袍，铺满整个方形。

用 bitforge 的局部重绘：遮罩（白色 = 重画）只覆盖肩膀以下、人物外侧的空背景，
脸和上身一个像素都不动。输出 out/nobles/N-04/N-04-c2.png、-c3.png。
"""
from __future__ import annotations

import json

import palettes
import pixellab

OUT = pixellab.ART / "out" / "nobles" / "N-04"
NOBLE = next(n for n in json.loads((pixellab.ART.parent / "data/nobles.json").read_text())["nobles"] if n["id"] == "N-04")

palette = palettes.save_palette(palettes.noble_palette(NOBLE["requirements"], "A"), OUT / "N-04-palette.png")
for index, seed in enumerate((84041, 84042), start=2):
    pixellab.generate_image(f"N-04-c{index}", {
        "description": (
            "bust portrait of an elderly Japanese nobleman with white hair and beard, wearing a black haori over a red kimono "
            "with white crests; his broad shoulders and robes extend all the way down to the bottom edge and out to both "
            "sides of the square, filling the whole frame, no round cutout, plain dark background above the shoulders, pixel art"
        ),
        "image_size": {"width": 128, "height": 128},
        "inpainting_image": pixellab.b64_image(OUT / "N-04-c1.png"),
        "mask_image": pixellab.b64_image(OUT / "N-04-mask.png"),
        "color_image": pixellab.b64_image(palette),
        "shading": "detailed shading",
        "detail": "highly detailed",
        "text_guidance_scale": 10,
        "seed": seed,
    }, OUT, endpoint="/create-image-bitforge")
    print("N-04", f"c{index}", "ok", flush=True)
