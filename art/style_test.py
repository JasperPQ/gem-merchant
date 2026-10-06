"""定风格样张：同一组牌（一、二、三级各一张 + 一位贵族）按 A/B/C 三种风格各画一遍。

用法：python art/style_test.py [A B C]
输出到 art/out/style-test/<风格>/，再用 art/style_test_page.py 生成对比页。
"""
from __future__ import annotations

import json
import pathlib
import sys

import palettes
import pixellab

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pixellab.ART / "out" / "style-test"
CARDS = {card["id"]: card for card in json.loads((ROOT / "data/cards.json").read_text())["cards"]}
NOBLES = {noble["id"]: noble for noble in json.loads((ROOT / "data/nobles.json").read_text())["nobles"]}

# 场景：视觉中心放在偏右，左边缘和左上角留简洁（叠放费用和分数）。
SCENES = {
    "L1-36": "a miner with a pickaxe chipping a large glowing red ruby vein out of a mine wall, the red ruby vein is the bright focal point slightly right of center, blue lantern light, white quartz pebbles and black coal lumps on the ground, mine tunnel with wooden supports, simple uncluttered left edge",
    "L2-09": "a gem cutter at a workbench polishing a large blue sapphire on a spinning grinding wheel, the glowing blue sapphire is the focal point slightly right of center, white marble workshop walls, green potted plants and green glass bottles on the shelves, simple uncluttered left edge",
    "L3-16": "a magnificent finished emerald jewel floating above a carved stone pedestal, radiating magical green light and sparkles, small red rubies set around the emerald, glowing green runes floating in the air, enchanted vault, focal point slightly right of center, simple uncluttered left edge",
}
NOBLE_SCENES = {
    "N-08": "bust portrait of an elderly Indian noblewoman with silver hair, dignified and kind expression, wearing an elegant green silk sari with a red embroidered border and red jewels, centered",
}

STYLES = {
    "A": {
        "suffix": ", dark moody lighting, the focal gem glows brightly against dark surroundings, pixel art",
        "card_size": (160, 224), "noble_size": (128, 128),
        "params": {"shading": "detailed shading", "detail": "highly detailed"},
        "noble_bg": "plain dark background",
    },
    "B": {
        "suffix": ", bright warm daylight, soft cheerful colors, cozy storybook illustration, pixel art",
        "card_size": (160, 224), "noble_size": (128, 128),
        "params": {"shading": "medium shading", "detail": "medium detail"},
        "noble_bg": "plain soft light background",
    },
    "C": {
        "suffix": ", simple bold shapes, chunky retro 16-bit pixel art, strong silhouette, minimal detail",
        "card_size": (96, 134), "noble_size": (80, 80),
        "params": {"shading": "basic shading", "detail": "low detail", "outline": "single color black outline"},
        "noble_bg": "plain background",
    },
}


def run(style: str) -> None:
    config = STYLES[style]
    out = OUT / style
    for card_id, scene in SCENES.items():
        card = CARDS[card_id]
        palette = palettes.save_palette(palettes.card_palette(card["bonusColor"], card["cost"], style), out / f"{card_id}-palette.png")
        width, height = config["card_size"]
        path = pixellab.generate_image(card_id, {
            "description": "board game card illustration: " + scene + config["suffix"],
            "image_size": {"width": width, "height": height},
            "text_guidance_scale": 10,
            "color_image": pixellab.b64_image(palette),
            "seed": int(card_id[1]) * 1000 + int(card_id[3:]),
            **config["params"],
        }, out)
        print(style, card_id, "ok", path.name)
    for noble_id, scene in NOBLE_SCENES.items():
        noble = NOBLES[noble_id]
        palette = palettes.save_palette(palettes.noble_palette(noble["requirements"], style), out / f"{noble_id}-palette.png")
        width, height = config["noble_size"]
        path = pixellab.generate_image(noble_id, {
            "description": scene + ", " + config["noble_bg"] + config["suffix"],
            "image_size": {"width": width, "height": height},
            "text_guidance_scale": 10,
            "color_image": pixellab.b64_image(palette),
            "seed": 8000 + int(noble_id[2:]),
            **config["params"],
        }, out)
        print(style, noble_id, "ok", path.name)


if __name__ == "__main__":
    for style in sys.argv[1:] or ["A", "B", "C"]:
        run(style)
    print("spent usd:", round(pixellab.spent_usd(), 4), "balance:", pixellab.balance())
