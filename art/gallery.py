"""生成画廊数据 out/gallery.json（卡牌按等级、颜色分组，附候选图、我的推荐、费用等），
供 out/gallery.html 读取。可以反复运行，生成过程中随时刷新。
"""
from __future__ import annotations

import json
import pathlib

import pixellab

ART = pixellab.ART
OUT = ART / "out"
ROOT = ART.parent
CARDS = json.loads((ROOT / "data/cards.json").read_text())["cards"]
NOBLES = json.loads((ROOT / "data/nobles.json").read_text())["nobles"]
COLORS = ["white", "blue", "green", "red", "black"]


def candidates(directory: pathlib.Path, prefix: str) -> list[str]:
    if not directory.exists():
        return []
    return sorted(p.relative_to(OUT).as_posix() for p in directory.glob(f"{prefix}-c[0-9].png"))


def anim_url(card_id: str) -> str | None:
    """动态版预览 GIF；带上修改时间，重做之后浏览器不会还显示缓存里的旧图。"""
    gif = OUT / "anim" / card_id / f"{card_id}.gif"
    return f"anim/{card_id}/{card_id}.gif?t={int(gif.stat().st_mtime)}" if gif.exists() else None


def build() -> dict:
    selection = json.loads((ART / "selection.json").read_text()) if (ART / "selection.json").exists() else {}
    cards = []
    for card in sorted(CARDS, key=lambda c: (c["level"], COLORS.index(c["bonusColor"]), c["id"])):
        cards.append({
            "id": card["id"],
            "level": card["level"],
            "bonus": card["bonusColor"],
            "points": card["points"],
            "cost": {k: v for k, v in card["cost"].items() if v},
            "images": candidates(OUT / "cards" / card["id"], card["id"]),
            "pick": selection.get(card["id"]),
            "anim": anim_url(card["id"]),
            "chosen": f"cards/{card['id']}/{card['id']}-{selection[card['id']]}.png" if card["id"] in selection else None,
        })
    nobles = [{
        "id": noble["id"],
        "requirements": noble["requirements"],
        "images": candidates(OUT / "nobles" / noble["id"], noble["id"]),
        "pick": selection.get(noble["id"]),
    } for noble in NOBLES]
    tokens = [{"id": color, "images": sorted(p.relative_to(OUT).as_posix() for p in (OUT / "tokens").glob(f"token-{color}-c[0-9].png"))}
              for color in COLORS + ["gold"]] if (OUT / "tokens").exists() else []
    backs = [{"id": f"L{level}", "images": sorted(p.relative_to(OUT).as_posix() for p in (OUT / "backs").glob(f"back-L{level}-c[0-9].png"))}
             for level in (1, 2, 3)] if (OUT / "backs").exists() else []
    done_cards = sum(1 for card in cards if card["images"])
    # 动画的排队顺序：插队重做的（anim-priority.txt）→ 第一批（anim-ids.txt）→ 重画的 16 张 → L2-04
    queue: list[str] = []
    if (OUT / "anim-priority.txt").exists():
        queue += (OUT / "anim-priority.txt").read_text().split()
    queue += ["L1-36"]
    if (OUT / "anim-ids.txt").exists():
        queue += (OUT / "anim-ids.txt").read_text().split()
    queue += ["L2-17", "L2-18", "L2-07", "L2-09", "L2-10", "L2-11", "L2-12", "L2-20", "L2-23", "L2-29", "L2-30", "L2-06", "L2-01", "L2-03", "L3-01", "L1-19", "L2-04"]
    redo_file = OUT / "anim-redo-queue.txt"
    return {
        "animRedo": redo_file.read_text().split() if redo_file.exists() else [],
        "animQueue": list(dict.fromkeys(queue)),
        "nobleAnims": [{"id": noble["id"], "requirements": noble["requirements"], "anim": anim_url(noble["id"])}
                       for noble in NOBLES if anim_url(noble["id"])],
        "cards": cards,
        "nobles": nobles,
        "tokens": tokens,
        "backs": backs,
        "summary": {
            "cards": done_cards,
            "cardImages": sum(len(card["images"]) for card in cards),
            "nobles": sum(1 for noble in nobles if noble["images"]),
            "tokens": sum(1 for token in tokens if token["images"]),
            "backs": sum(1 for back in backs if back["images"]),
            "spentUsd": round(pixellab.spent_usd(), 2),
            "anims": sum(1 for card in cards if card["anim"]),
        },
    }


if __name__ == "__main__":
    (OUT / "gallery.json").write_text(json.dumps(build(), ensure_ascii=False))
