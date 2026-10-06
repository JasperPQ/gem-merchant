"""调色板规则：主题色 = 这张牌产出的颜色，辅色 = 兑换条件里的颜色。

生成时把调色板图片作为 color_image 传给 PixelLab，强制画面只用这些颜色。
主题色给满色阶；兑换条件按数量给色阶（数量越多，色阶越多，在画面里占得越多）。
"""
from __future__ import annotations

import pathlib

from PIL import Image

# 每种宝石颜色 6 阶，从暗到亮。
RAMPS: dict[str, list[str]] = {
    "red": ["#3d0a12", "#6e1020", "#a3182c", "#d42c3c", "#f25c5c", "#ffb3a8"],
    "blue": ["#0d1a33", "#13305e", "#1f4f99", "#3f79b8", "#74aee6", "#c2e2ff"],
    "green": ["#0b2614", "#12452a", "#1d6e3d", "#2f9a52", "#62c97a", "#b7f0c0"],
    "white": ["#6d6a73", "#9a97a0", "#c2bfc6", "#dedbe0", "#f4f1ea", "#ffffff"],
    # 黑色只到暗紫，不给浅色：浅色会让模型把"黑宝石"画成浅紫的透明水晶。
    "black": ["#08080b", "#141119", "#221d2c", "#332b44", "#4a3f63", "#6b5c8f"],
    "gold": ["#4a3008", "#7a5410", "#b3821c", "#e0b030", "#f5d66b", "#fff2b8"],
}
# 人物肤色（从深到浅），只在画面里有人时加入。
SKIN = ["#3b2219", "#6b3e2a", "#9c6644", "#c98e64", "#eab896", "#f7d7bf"]
# 黑色主题的牌：暗场景里发光的焦点会被画成浅色，所以改成让黑宝石像剪影一样衬在暖光前。
BLACK_BACKLIGHT = ["#7a4a24", "#c08040", "#f0c070", "#fff0c8", "#ffffff"]
OUTLINE = "#141218"

# 风格变体对色阶的取舍：暗调保留最暗的阶，明亮去掉最暗的阶，粗像素每种颜色只留 4 阶。
VARIANT_STEPS = {
    "A": [0, 1, 2, 3, 4, 5],
    "B": [2, 3, 4, 5],
    "C": [1, 2, 3, 4],
}


def accent_steps(amount: int, steps: list[int]) -> list[int]:
    """兑换条件里的数量越多，给的色阶越多。"""
    count = 2 if amount <= 1 else 3 if amount <= 3 else 4
    # 取中间偏亮的几阶，作为点缀色更醒目。
    middle = steps[len(steps) // 2 - 1:] if len(steps) > count else steps
    return middle[:count] if len(middle) >= count else steps[-count:]


def card_palette(bonus: str, cost: dict[str, int], variant: str, with_skin: bool = True) -> list[str]:
    steps = VARIANT_STEPS[variant]
    colors = [RAMPS[bonus][i] for i in steps]
    for color, amount in sorted(cost.items(), key=lambda item: -item[1]):
        if amount <= 0 or color == bonus:
            continue
        colors += [RAMPS[color][i] for i in accent_steps(amount, steps)]
    if bonus == "black":
        colors += BLACK_BACKLIGHT
    if with_skin:
        colors += SKIN[1:5] if variant != "C" else SKIN[1:4]
    colors.append(OUTLINE)
    # 去重并保持顺序
    return list(dict.fromkeys(colors))


def noble_palette(requirements: dict[str, int], variant: str) -> list[str]:
    steps = VARIANT_STEPS[variant]
    colors = []
    for color, amount in requirements.items():
        if amount > 0:
            colors += [RAMPS[color][i] for i in steps]
    colors += SKIN
    colors += ["#2a2420", "#5a4f48", "#a8a29a"]  # 头发：黑、棕灰、银白
    colors.append(OUTLINE)
    return list(dict.fromkeys(colors))


def save_palette(colors: list[str], path: pathlib.Path) -> pathlib.Path:
    image = Image.new("RGB", (len(colors) * 4, 4))
    for index, hex_color in enumerate(colors):
        rgb = tuple(int(hex_color[k:k + 2], 16) for k in (1, 3, 5))
        for x in range(4):
            for y in range(4):
                image.putpixel((index * 4 + x, y), rgb)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)
    return path
