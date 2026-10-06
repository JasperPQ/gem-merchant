"""挑选、导出、生成动态版。

  python art/finalize.py export            # 按 selection.json 把选中的候选复制进游戏目录
  python art/finalize.py animate [牌号...]  # 用导出的静态图生成 8 帧循环动画（首尾帧都是静态图）
  python art/finalize.py report            # 检查动画：变化太大（画面走形）或太小（几乎不动）的标出来

selection.json 形如 {"L1-36": "c0", "N-08": "c1"}。
"""
from __future__ import annotations

import concurrent.futures
import json
import pathlib
import shutil
import sys

from PIL import Image, ImageChops

import pixellab
import scenes

ART = pixellab.ART
ROOT = ART.parent
OUT = ART / "out"
PUBLIC = ROOT / "apps/web/public/art"
SELECTION = ART / "selection.json"
FRAMES = 8


def load_selection() -> dict[str, str]:
    return json.loads(SELECTION.read_text()) if SELECTION.exists() else {}


PIXEL_ASSETS = ROOT / "apps/web/src/assets/pixel"


def export() -> None:
    """按 selection.json 导出；没选定的牌/贵族删掉旧文件，界面会退回纯色样式。"""
    selection = load_selection()
    wanted: dict[pathlib.Path, pathlib.Path] = {}
    for item_id, candidate in selection.items():
        if item_id.startswith("token-"):
            color = item_id[len("token-"):]
            wanted[PIXEL_ASSETS / "tokens" / f"{color}.png"] = OUT / "tokens" / f"{item_id}-{candidate}.png"
        elif item_id.startswith("back-"):
            level = item_id[len("back-L"):]
            wanted[PIXEL_ASSETS / "backs" / f"l{level}.png"] = OUT / "backs" / f"{item_id}-{candidate}.png"
        else:
            kind = "nobles" if item_id.startswith("N-") else "cards"
            wanted[PUBLIC / kind / f"{item_id}.png"] = OUT / kind / item_id / f"{item_id}-{candidate}.png"
    for kind in ("cards", "nobles"):
        for stale in (PUBLIC / kind).glob("*.png"):
            if stale not in wanted:
                stale.unlink()
    for target, source in wanted.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    print("exported", len(wanted))


def animate_one(card_id: str, seed_offset: int = 0) -> str:
    static = PUBLIC / "cards" / f"{card_id}.png"
    strip_path = PUBLIC / "cards-anim" / f"{card_id}.png"
    if strip_path.exists():
        return f"{card_id} 已存在"
    frame_dir = OUT / "anim" / card_id
    paths = pixellab.animate(card_id, {
        "first_frame": pixellab.b64_image(static),
        "last_frame": pixellab.b64_image(static),
        "action": scenes.build_card_motion(card_id),
        "frame_count": FRAMES,
        "no_background": False,
        "seed": int(card_id[1]) * 10000 + int(card_id[3:]) * 10 + 7 + seed_offset,
    }, frame_dir)
    # 返回的是「首帧 + 生成的帧」，末帧又回到首帧：取前 8 帧，循环时第 8 帧接回第 1 帧。
    frames = [Image.open(p).convert("RGB") for p in paths][:FRAMES]
    while len(frames) < FRAMES:
        frames.append(frames[-1])
    width, height = frames[0].size
    strip = Image.new("RGB", (width * FRAMES, height))
    for index, frame in enumerate(frames):
        strip.paste(frame, (index * width, 0))
    strip_path.parent.mkdir(parents=True, exist_ok=True)
    strip.save(strip_path, optimize=True)
    big = [f.resize((width * 3, height * 3), Image.NEAREST) for f in frames]
    big[0].save(frame_dir / f"{card_id}.gif", save_all=True, append_images=big[1:], duration=140, loop=0)
    return f"{card_id} ok"


def rebuild_strip(card_id: str, order: list[int]) -> None:
    """用已经下载的原始帧按指定顺序重新拼条带和预览 GIF，比如只取前几帧来回播：[0,1,2,3,3,2,1,0]。"""
    frame_dir = OUT / "anim" / card_id
    frames = [Image.open(frame_dir / f"{card_id}-{index:02d}.png").convert("RGB") for index in order]
    width, height = frames[0].size
    strip = Image.new("RGB", (width * FRAMES, height))
    for index, frame in enumerate(frames[:FRAMES]):
        strip.paste(frame, (index * width, 0))
    strip.save(PUBLIC / "cards-anim" / f"{card_id}.png", optimize=True)
    big = [f.resize((width * 3, height * 3), Image.NEAREST) for f in frames[:FRAMES]]
    big[0].save(frame_dir / f"{card_id}.gif", save_all=True, append_images=big[1:], duration=140, loop=0)
    meta_path = frame_dir / f"{card_id}.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    meta_path.write_text(json.dumps(meta | {"strip_order": order}, ensure_ascii=False, indent=2))


def animate(card_ids: list[str], workers: int = 2) -> None:
    ids = card_ids or sorted(p.stem for p in (PUBLIC / "cards").glob("*.png"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(animate_one, card_id): card_id for card_id in ids}
        for future in concurrent.futures.as_completed(futures):
            try:
                print(future.result(), flush=True)
            except Exception as error:
                print(f"{futures[future]} 失败: {error}", flush=True)
    print(f"累计花费 ${pixellab.spent_usd():.3f}；余额 {pixellab.balance()}", flush=True)


def frame_changes(strip_path: pathlib.Path) -> list[float]:
    """第 2～8 帧各自和首帧比，变了的像素比例。"""
    strip = Image.open(strip_path).convert("RGB")
    width = strip.width // FRAMES
    frames = [strip.crop((i * width, 0, (i + 1) * width, strip.height)) for i in range(FRAMES)]
    changes = []
    for frame in frames[1:]:
        diff = ImageChops.difference(frames[0], frame).convert("L").point(lambda v: 255 if v > 24 else 0)
        changes.append(sum(1 for v in diff.get_flattened_data() if v) / (width * strip.height))
    return changes


def motion_amount(strip_path: pathlib.Path) -> float:
    return max(frame_changes(strip_path))


def has_glitch_frame(strip_path: pathlib.Path) -> bool:
    """个别帧突然大变（整片褪色、主体消失）又变回来：最大变化 ≥15% 且是中位数的 2.5 倍以上。"""
    changes = sorted(frame_changes(strip_path))
    peak, median = changes[-1], changes[len(changes) // 2]
    return peak >= 0.15 and peak >= 2.5 * median


def archive_animation(card_id: str) -> int:
    """把旧动画（帧和条带）挪到 out/anim/{id}-old{n}/，返回 n，重做时用它换种子。"""
    n = 1
    while (OUT / "anim" / f"{card_id}-old{n}").exists():
        n += 1
    archive = OUT / "anim" / f"{card_id}-old{n}"
    frame_dir = OUT / "anim" / card_id
    strip_path = PUBLIC / "cards-anim" / f"{card_id}.png"
    if frame_dir.exists():
        frame_dir.rename(archive)
    if strip_path.exists():
        archive.mkdir(parents=True, exist_ok=True)
        strip_path.rename(archive / "strip.png")
    return n


def reanimate(card_ids: list[str], tries: int = 2) -> None:
    """重做动画：旧的存档后换种子重画；画出来几乎不动（低于 3%）或有坏帧就再换一次种子。"""
    for card_id in card_ids:
        for _ in range(tries):
            n = archive_animation(card_id)
            try:
                print(animate_one(card_id, seed_offset=1000 * n), flush=True)
            except Exception as error:
                print(f"{card_id} 失败: {error}", flush=True)
                break
            strip_path = PUBLIC / "cards-anim" / f"{card_id}.png"
            amount, glitch = motion_amount(strip_path), has_glitch_frame(strip_path)
            print(f"{card_id}: 最大变化 {amount:.1%}{' 有坏帧' if glitch else ''}", flush=True)
            if amount >= 0.03 and not glitch:
                break
    print(f"累计花费 ${pixellab.spent_usd():.3f}", flush=True)


def report() -> None:
    """最大变化超过 45% 多半画面走形，低于 3% 几乎看不出在动。"""
    for strip_path in sorted((PUBLIC / "cards-anim").glob("*.png")):
        worst = motion_amount(strip_path)
        flag = "走形?" if worst > 0.45 else "太静?" if worst < 0.03 else ""
        print(f"{strip_path.stem}: 最大变化 {worst:5.1%} {flag}")


if __name__ == "__main__":
    command, *rest = sys.argv[1:] or ["report"]
    if command == "export":
        export()
    elif command == "animate":
        animate(rest)
    else:
        report()
