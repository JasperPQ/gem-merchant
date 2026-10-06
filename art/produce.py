"""批量生成土地牌和贵族的静态图（风格 A），每项生成若干候选，供挑选。

用法：
  python art/produce.py cards L1 [--seeds 2] [--workers 2]   # 某一级，或具体牌号 L1-36 L2-09
  python art/produce.py nobles
  python art/produce.py sheets                                # 生成审图用的对比图
已经存在的候选会跳过，可以随时中断后重跑。
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import pathlib

from PIL import Image, ImageDraw

import palettes
import pixellab
import scenes

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pixellab.ART / "out"
CARDS = {card["id"]: card for card in json.loads((ROOT / "data/cards.json").read_text())["cards"]}
NOBLES = {noble["id"]: noble for noble in json.loads((ROOT / "data/nobles.json").read_text())["nobles"]}
# 卡框里的插画窗口是 2:3。
CARD_SIZE = (128, 192)
NOBLE_SIZE = (128, 128)
PARAMS = {"shading": "detailed shading", "detail": "highly detailed", "text_guidance_scale": 10}


# 重画时换一批种子（否则同样的参数会画出同样的图）。
SEED_OFFSET = 0


def card_seed(card_id: str, candidate: int) -> int:
    return int(card_id[1]) * 10000 + int(card_id[3:]) * 10 + candidate + SEED_OFFSET


def card_job(card_id: str, candidate: int) -> str:
    card = CARDS[card_id]
    out = OUT / "cards" / card_id
    name = f"{card_id}-c{candidate}"
    if (out / f"{name}.png").exists():
        return f"{name} 已存在"
    palette = palettes.save_palette(
        palettes.card_palette(card["bonusColor"], card["cost"], "A", with_skin=card["level"] < 3),
        out / f"{card_id}-palette.png",
    )
    pixellab.generate_image(name, {
        "description": scenes.build_card_prompt(card),
        "image_size": {"width": CARD_SIZE[0], "height": CARD_SIZE[1]},
        "color_image": pixellab.b64_image(palette),
        "seed": card_seed(card_id, candidate),
        **PARAMS,
    }, out)
    return f"{name} ok"


def noble_job(noble_id: str, candidate: int) -> str:
    noble = NOBLES[noble_id]
    out = OUT / "nobles" / noble_id
    name = f"{noble_id}-c{candidate}"
    if (out / f"{name}.png").exists():
        return f"{name} 已存在"
    palette = palettes.save_palette(palettes.noble_palette(noble["requirements"], "A"), out / f"{noble_id}-palette.png")
    pixellab.generate_image(name, {
        "description": scenes.build_noble_prompt(noble_id),
        "image_size": {"width": NOBLE_SIZE[0], "height": NOBLE_SIZE[1]},
        "color_image": pixellab.b64_image(palette),
        "seed": 80000 + int(noble_id[2:]) * 10 + candidate + SEED_OFFSET,
        **PARAMS,
    }, out)
    return f"{name} ok"


# 宝石筹码：每种宝石切工不同，色弱玩家也能靠形状区分。
TOKENS = {
    "white": "a round brilliant cut white diamond",
    "blue": "an oval cut blue sapphire",
    "green": "a rectangular emerald cut green emerald",
    "red": "a triangular trillion cut red ruby",
    "black": "a hexagonal cut glossy jet-black onyx with violet highlights",
    "gold": "a shiny gold coin stamped with a star, wild token",
}
# 三级卡背：青铜（采矿）、白银（加工）、黄金（魔法成品）纹章。
BACKS = {
    1: "ornate card back design, dark background with a bronze emblem of crossed pickaxes over a raw gemstone, symmetrical, decorative border",
    2: "ornate card back design, dark background with a silver emblem of a gem cutting wheel and a faceted gemstone, symmetrical, decorative border",
    3: "ornate card back design, dark background with a golden emblem of a crown above a glowing magical gemstone, symmetrical, decorative border",
}


def token_job(color: str, candidate: int) -> str:
    out = OUT / "tokens"
    name = f"token-{color}-c{candidate}"
    if (out / f"{name}.png").exists():
        return f"{name} 已存在"
    palette = palettes.save_palette(
        [palettes.RAMPS[color][i] for i in range(6)] + [palettes.OUTLINE, "#ffffff"],
        out / f"token-{color}-palette.png",
    )
    pixellab.generate_image(name, {
        "description": f"{TOKENS[color]}, board game token icon, centered, glossy highlights, pixel art",
        "image_size": {"width": 64, "height": 64},
        "no_background": True,
        "outline": "single color black outline",
        "shading": "medium shading",
        "detail": "highly detailed",
        "color_image": pixellab.b64_image(palette),
        "seed": 90000 + list(TOKENS).index(color) * 10 + candidate,
    }, out)
    return f"{name} ok"


def back_job(level: int, candidate: int) -> str:
    out = OUT / "backs"
    name = f"back-L{level}-c{candidate}"
    if (out / f"{name}.png").exists():
        return f"{name} 已存在"
    metal = ["", "gold", "white", "gold"][level]  # 青铜、白银用相近色阶，黄金用金色
    colors = [palettes.RAMPS["black"][i] for i in range(4)] + [palettes.RAMPS[metal][i] for i in range(1, 6)]
    if level == 1:
        colors += ["#5a3418", "#8a5528", "#c07f43"]  # 青铜
    palette = palettes.save_palette(colors + [palettes.OUTLINE], out / f"back-L{level}-palette.png")
    pixellab.generate_image(name, {
        "description": BACKS[level] + ", pixel art",
        "image_size": {"width": 144, "height": 200},
        "shading": "detailed shading",
        "detail": "highly detailed",
        "color_image": pixellab.b64_image(palette),
        "seed": 95000 + level * 10 + candidate,
    }, out)
    return f"{name} ok"


def run(jobs: list[tuple], workers: int) -> None:
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(*job): job for job in jobs}
        for future in concurrent.futures.as_completed(futures):
            job = futures[future]
            try:
                print(future.result(), flush=True)
            except Exception as error:  # 单张失败不影响其他张，重跑会补上
                print(f"{job[1]} c{job[2]} 失败: {error}", flush=True)
    print(f"累计花费 ${pixellab.spent_usd():.3f}；余额 {pixellab.balance()}", flush=True)


def select_cards(patterns: list[str]) -> list[str]:
    chosen = []
    for card_id in sorted(CARDS, key=lambda cid: (cid[:2], CARDS[cid]["bonusColor"], cid)):
        if any(card_id == p or card_id.startswith(p + "-") for p in patterns):
            chosen.append(card_id)
    return chosen


def contact_sheets() -> None:
    """每张牌一行：候选图并排，左边写牌号和产出色，放大 2 倍便于审图。"""
    groups: dict[str, list[pathlib.Path]] = {}
    for directory in sorted((OUT / "cards").iterdir()) if (OUT / "cards").exists() else []:
        card = CARDS[directory.name]
        groups.setdefault(f"L{card['level']}-{card['bonusColor']}", []).append(directory)
    if (OUT / "nobles").exists():
        groups["nobles"] = sorted((OUT / "nobles").iterdir())
    sheet_dir = OUT / "sheets"
    sheet_dir.mkdir(exist_ok=True)
    for group, directories in groups.items():
        rows = []
        for directory in directories:
            images = sorted(directory.glob("*-c[0-9].png"))
            if not images:
                continue
            tiles = [Image.open(p).convert("RGB") for p in images]
            tiles = [t.resize((t.width * 2, t.height * 2), Image.NEAREST) for t in tiles]
            width = 110 + sum(t.width + 8 for t in tiles)
            row = Image.new("RGB", (width, max(t.height for t in tiles) + 8), (238, 232, 218))
            draw = ImageDraw.Draw(row)
            draw.text((6, 8), directory.name, fill=(30, 40, 35))
            x = 110
            for path, tile in zip(images, tiles):
                row.paste(tile, (x, 4))
                draw.text((x + 4, 6), path.stem[-2:], fill=(255, 255, 255))
                x += tile.width + 8
            rows.append(row)
        if not rows:
            continue
        sheet = Image.new("RGB", (max(r.width for r in rows), sum(r.height for r in rows)), (238, 232, 218))
        y = 0
        for row in rows:
            sheet.paste(row, (0, y))
            y += row.height
        sheet.save(sheet_dir / f"{group}.png")
        print("sheet", group, sheet.size)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("what", choices=["cards", "nobles", "tokens", "backs", "sheets"])
    parser.add_argument("targets", nargs="*")
    parser.add_argument("--seeds", type=int, default=2)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--seed-offset", type=int, default=0)
    args = parser.parse_args()
    SEED_OFFSET = args.seed_offset
    if args.what == "cards":
        ids = select_cards(args.targets or ["L1", "L2", "L3"])
        run([(card_job, card_id, c) for card_id in ids for c in range(args.seeds)], args.workers)
    elif args.what == "tokens":
        run([(token_job, color, c) for color in (args.targets or list(TOKENS)) for c in range(args.seeds)], args.workers)
    elif args.what == "backs":
        run([(back_job, int(level), c) for level in (args.targets or ["1", "2", "3"]) for c in range(args.seeds)], args.workers)
    elif args.what == "nobles":
        ids = args.targets or sorted(NOBLES)
        run([(noble_job, noble_id, c) for noble_id in ids for c in range(args.seeds)], args.workers)
    else:
        contact_sheets()
