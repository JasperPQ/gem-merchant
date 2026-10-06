"""生成定风格对比页：把 A/B/C 三种样张套进游戏里的卡牌版式（分数、等级点、费用），
按电脑和手机上的实际大小并排展示。输出 art/out/style-test/compare.html。
"""
from __future__ import annotations

import html
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(__file__).resolve().parent / "out" / "style-test"
CARDS = {card["id"]: card for card in json.loads((ROOT / "data/cards.json").read_text())["cards"]}
NOBLES = {noble["id"]: noble for noble in json.loads((ROOT / "data/nobles.json").read_text())["nobles"]}
ORDER = ["white", "blue", "green", "red", "black"]
NAMES = {"white": "白", "blue": "蓝", "green": "绿", "red": "红", "black": "黑"}
STYLES = {
    "A": ("暗调宝光", "暗背景，宝石发光，细节最多；四张风格最统一。"),
    "B": ("明亮绘本", "暖光、明亮；但矿洞和宝库题材本身偏暗，四张明暗不一。"),
    "C": ("粗像素", "分辨率更低、像素更大，小尺寸下更清楚；细节和质感较粗。"),
}
SIZES = [("电脑上的实际大小", 152), ("手机上的实际大小", 66)]


def pips(cost: dict[str, int]) -> str:
    return "".join(f'<i class="pip c-{c}">{cost[c]}</i>' for c in ORDER if cost.get(c, 0) > 0)


def card(style: str, card_id: str, width: int) -> str:
    data = CARDS[card_id]
    dots = "".join("<i></i>" for _ in range(data["level"]))
    points = data["points"] or ""
    label = f'{data["level"]}级 · 产出{NAMES[data["bonusColor"]]} · 费用 ' + " ".join(f"{NAMES[c]}{data['cost'][c]}" for c in ORDER if data["cost"].get(c, 0))
    return (
        f'<div class="card" style="--w:{width}px" title="{html.escape(label)}">'
        f'<img src="{style}/{card_id}.png" alt="">'
        f'<span class="top"><b>{points}</b><span class="dots">{dots}</span></span>'
        f'<span class="cost">{pips(data["cost"])}</span></div>'
    )


def noble(style: str, noble_id: str, width: int) -> str:
    data = NOBLES[noble_id]
    return (
        f'<div class="noble" style="--w:{width}px"><img src="{style}/{noble_id}.png" alt="">'
        f'<b>{data["points"]}</b><span class="cost">{pips(data["requirements"])}</span></div>'
    )


def palette_strip(style: str, card_id: str) -> str:
    return f'<img class="palette" src="{style}/{card_id}-palette.png" alt="" title="这张图被限定使用的颜色">'


sections = []
for style, (title, note) in STYLES.items():
    rows = []
    for label, width in SIZES:
        cards = "".join(card(style, cid, width) for cid in ["L1-36", "L2-09", "L3-16"])
        rows.append(f'<div class="size"><h3>{label}</h3><div class="table">{cards}{noble(style, "N-08", width)}</div></div>')
    big = "".join(f'<figure>{card(style, cid, 300)}{palette_strip(style, cid)}</figure>' for cid in ["L1-36", "L2-09", "L3-16"])
    big += f'<figure>{noble(style, "N-08", 230)}</figure>'
    sections.append(
        f'<section><h2>{style}「{title}」</h2><p>{note}</p>{"".join(rows)}'
        f'<div class="size"><h3>放大看细节（下方色条是这张图被限定使用的颜色）</h3><div class="table big">{big}</div></div></section>'
    )

page = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>宝石商人 · 像素风定风格</title>
<style>
body {{ margin: 0; padding: 24px 32px 60px; background: #f4f2ec; color: #23332d; font-family: -apple-system, "PingFang SC", sans-serif; }}
h1 {{ font-size: 22px; margin: 0 0 4px; }} h2 {{ font-size: 18px; margin: 0 0 4px; }} h3 {{ font-size: 12px; color: #7c847d; margin: 14px 0 6px; font-weight: 600; }}
section {{ margin-top: 28px; padding-top: 18px; border-top: 1px solid #ddd8cc; }}
p {{ margin: 0; color: #5f6a61; font-size: 13px; }}
.table {{ display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px; padding: 14px; border-radius: 12px; background: radial-gradient(ellipse at 50% 40%, #2e5d48, #1d3e31 78%); }}
.big {{ gap: 18px; }}
figure {{ margin: 0; display: flex; flex-direction: column; gap: 6px; }}
.palette {{ height: 10px; width: 300px; image-rendering: pixelated; border-radius: 3px; }}
.card, .noble {{ position: relative; width: var(--w); border-radius: calc(var(--w) * 0.06); overflow: hidden; box-shadow: 0 3px 8px rgba(0,0,0,.35); container-type: size; }}
.card {{ height: calc(var(--w) * 88 / 63); }}
.noble {{ height: var(--w); }}
.card img, .noble img {{ position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; }}
.top {{ position: absolute; top: 5cqh; left: 7cqh; right: 7cqh; display: flex; justify-content: space-between; align-items: flex-start; }}
.top b, .noble > b {{ color: #fff; font-size: 24cqh; font-weight: 800; line-height: .9; text-shadow: 0 0 3px #000, 0 1px 2px #000; }}
.noble > b {{ position: absolute; top: 6cqh; left: 9cqh; font-size: 22cqh; }}
.dots {{ display: flex; gap: 2cqh; }} .dots i {{ width: 6cqh; height: 6cqh; border-radius: 50%; background: #fff; box-shadow: 0 0 2px #000; }}
.cost {{ position: absolute; bottom: 5cqh; left: 6cqh; display: flex; flex-direction: column-reverse; gap: 2cqh; }}
.noble .cost {{ left: auto; right: 6cqh; }}
.pip {{ display: grid; place-items: center; width: 14cqh; height: 14cqh; border-radius: 50%; border: .8cqh solid rgba(255,255,255,.85); font-size: 9.5cqh; font-style: normal; font-weight: 800; color: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.5); }}
.noble .pip {{ width: 20cqh; height: 20cqh; font-size: 12cqh; }}
.c-white {{ background: #f1ece0; color: #3d3a31; }} .c-blue {{ background: #5a85a6; }} .c-green {{ background: #5f9168; }} .c-red {{ background: #b9604f; }} .c-black {{ background: #47524c; }}
</style></head><body>
<h1>宝石商人 · 像素风定风格</h1>
<p>同一组牌按三种风格各画一张：一级「采矿」（产出红，费用 白1 蓝3 黑1）、二级「打磨」（产出蓝，费用 白5 绿3）、三级「魔法成品」（产出绿，费用 绿7 红3）、贵族（拜访条件 绿4 红4）。牌面上的分数和费用是网页文字，叠在图上。</p>
{''.join(sections)}
</body></html>"""
(OUT / "compare.html").write_text(page)
print(OUT / "compare.html")
