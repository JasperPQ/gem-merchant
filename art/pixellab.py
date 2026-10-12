"""PixelLab API 客户端（流水线标准版）：全站排队、限速自动重试、后台任务轮询、花费记账和预算上限。

用法：把这个文件复制到游戏仓库的 art/pixellab.py（开工样张阶段复制到 ~/projects/pipeline/games/<id>/assets/work/），
不要从老游戏复制，老游戏的副本没有排队。标准版在 ~/projects/pipeline/bin/pixellab.py。

密钥从 ~/.config/pixellab/api_key 读取（或环境变量 PIXELLAB_API_KEY），不进仓库。
每次调用都记进本文件所在目录的 ledger.jsonl；累计美元花费超过 BUDGET_USD 就拒绝继续调用。
全站排队：一个 PixelLab 账号同一时间只能跑一个任务，所有游戏的请求都先经过 ~/projects/pipeline/bin/pxqueue.py 排队，
轮到了才发（见那个文件的说明）。开工样张这类急活用环境变量 PIXELLAB_PRIORITY=0 插队；看排队：python3 ~/projects/pipeline/bin/pxqueue.py status。
"""
from __future__ import annotations

import base64
import json
import os
import pathlib
import threading
import time
import contextlib
import sys
import urllib.error
import urllib.request

sys.path.insert(0, str(pathlib.Path.home() / "projects" / "pipeline" / "bin"))
try:
    import pxqueue  # 全站 PixelLab 排队
except ImportError:  # 没有流水线目录的机器上照常能用，只是不排队
    pxqueue = None
    print("[PixelLab] 没找到 ~/projects/pipeline/bin/pxqueue.py，这次不排队", file=sys.stderr)

API = "https://api.pixellab.ai/v2"
ART = pathlib.Path(__file__).resolve().parent
LEDGER = ART / "ledger.jsonl"
# 每个游戏单独记账。上限用环境变量 PIXELLAB_BUDGET_USD 设，默认 $8；他说过不要怕花钱，但要记账、汇报。
BUDGET_USD = float(os.environ.get("PIXELLAB_BUDGET_USD", "8"))


def _key() -> str:
    key = os.environ.get("PIXELLAB_API_KEY")
    if key:
        return key.strip()
    return pathlib.Path.home().joinpath(".config/pixellab/api_key").read_text().strip()


def spent_usd() -> float:
    if not LEDGER.exists():
        return 0.0
    total = 0.0
    for line in LEDGER.read_text().splitlines():
        usage = json.loads(line).get("usage") or {}
        if usage.get("type") == "usd":
            total += usage.get("usd") or 0.0
    return total


_ledger_lock = threading.Lock()


def _record(entry: dict) -> None:
    # 批量生成时多个线程同时记账
    with _ledger_lock, LEDGER.open("a") as ledger:
        ledger.write(json.dumps(entry, ensure_ascii=False) + "\n")


# 429 时的重试节奏。默认指数退避；插队重做时改成固定短间隔，好在别的任务交接的空档里抢到位置。
RETRY_ATTEMPTS = 8
RETRY_DELAY: float | None = None


def _request(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        f"{API}{path}",
        data=data,
        headers={"Authorization": f"Bearer {_key()}", "Content-Type": "application/json"},
        method=method,
    )
    wait = 15
    # 整个请求（包括 429 重试）都在全站排队里占着位置；提交任务前可能要等别的游戏用完
    queue = pxqueue.turn(method, path, ART) if pxqueue else contextlib.nullcontext()
    with queue:
        for attempt in range(RETRY_ATTEMPTS):
            try:
                with urllib.request.urlopen(request, timeout=240) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                detail = error.read()[:400]
                if error.code != 429 or attempt == RETRY_ATTEMPTS - 1:
                    raise RuntimeError(f"HTTP {error.code} {path}: {detail!r}") from error
                # 还是撞上了频率限制（比如有没走排队的老脚本在跑）：按 Retry-After（没有就指数退避）等一会儿再试
                delay = RETRY_DELAY or int(error.headers.get("Retry-After") or wait)
                time.sleep(delay)
                wait = min(wait * 2, 120)
    raise RuntimeError("unreachable")


def balance() -> dict:
    return _request("GET", "/balance")


def b64_image(path: pathlib.Path) -> dict:
    return {"type": "base64", "base64": base64.b64encode(path.read_bytes()).decode(), "format": "png"}


def _check_budget() -> None:
    if spent_usd() >= BUDGET_USD:
        raise RuntimeError(f"已花费 ${spent_usd():.3f}，达到预算上限 ${BUDGET_USD}，停止调用。")


def generate_image(name: str, body: dict, out_dir: pathlib.Path, endpoint: str = "/create-image-pixflux") -> pathlib.Path:
    """同步出图（pixflux / bitforge），保存 PNG 和生成参数。"""
    _check_budget()
    out_dir.mkdir(parents=True, exist_ok=True)
    started = time.time()
    result = _request("POST", endpoint, body)
    path = out_dir / f"{name}.png"
    path.write_bytes(base64.b64decode(result["image"]["base64"]))
    meta = {k: v for k, v in body.items() if k not in ("color_image", "style_image", "init_image", "image", "inpainting_image", "mask_image")}
    meta |= {"endpoint": endpoint, "usage": result.get("usage"), "seconds": round(time.time() - started, 1)}
    path.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    _record({"time": time.strftime("%Y-%m-%d %H:%M:%S"), "name": name, "endpoint": endpoint, "usage": result.get("usage"), "seconds": meta["seconds"]})
    return path


def poll(job_id: str, timeout: float = 600) -> dict:
    started = time.time()
    while True:
        time.sleep(4)
        result = _request("GET", f"/background-jobs/{job_id}")
        if result["status"] != "processing":
            return result
        if time.time() - started > timeout:
            raise TimeoutError(f"后台任务 {job_id} 超时")


def generate_async(name: str, body: dict, out_dir: pathlib.Path, endpoint: str) -> list[pathlib.Path]:
    """后台任务类的出图（edit-image 等）：提交后轮询，返回的一张或多张图依次存成 {name}.png、{name}-1.png……"""
    _check_budget()
    out_dir.mkdir(parents=True, exist_ok=True)
    started = time.time()
    job = _request("POST", endpoint, body)
    result = poll(job["background_job_id"])
    usage = result.get("usage") or job.get("usage")
    _record({"time": time.strftime("%Y-%m-%d %H:%M:%S"), "name": name, "endpoint": endpoint, "usage": usage, "seconds": round(time.time() - started, 1), "status": result["status"]})
    if result["status"] != "completed":
        raise RuntimeError(f"{name} 失败：{json.dumps(result.get('last_response'))[:300]}")
    response = result["last_response"]
    images = response.get("images") or [response.get("image")]
    paths = []
    for index, image in enumerate(images):
        data = image["base64"] if isinstance(image, dict) else image
        path = out_dir / (f"{name}.png" if index == 0 else f"{name}-{index}.png")
        path.write_bytes(base64.b64decode(data))
        paths.append(path)
    meta = {k: v for k, v in body.items() if k not in ("image", "color_image", "reference_image")}
    (out_dir / f"{name}.json").write_text(json.dumps(meta | {"endpoint": endpoint, "usage": usage}, ensure_ascii=False, indent=2))
    return paths


def animate(name: str, body: dict, out_dir: pathlib.Path, endpoint: str = "/animate-with-text-v3") -> list[pathlib.Path]:
    """异步动画：提交后轮询，保存每一帧。"""
    _check_budget()
    out_dir.mkdir(parents=True, exist_ok=True)
    started = time.time()
    job = _request("POST", endpoint, body)
    result = poll(job["background_job_id"])
    usage = result.get("usage") or job.get("usage")
    _record({"time": time.strftime("%Y-%m-%d %H:%M:%S"), "name": name, "endpoint": endpoint, "usage": usage, "seconds": round(time.time() - started, 1), "status": result["status"]})
    if result["status"] != "completed":
        raise RuntimeError(f"{name} 动画失败：{json.dumps(result.get('last_response'))[:300]}")
    paths = []
    for index, image in enumerate(result["last_response"]["images"]):
        data = image["base64"] if isinstance(image, dict) else image
        path = out_dir / f"{name}-{index:02d}.png"
        path.write_bytes(base64.b64decode(data))
        paths.append(path)
    meta = {k: v for k, v in body.items() if k not in ("first_frame", "last_frame")}
    meta |= {"endpoint": endpoint, "usage": usage, "frames": len(paths)}
    (out_dir / f"{name}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    return paths


DIRECTIONS = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]


def _download(url: str) -> bytes:
    """下载 PixelLab 返回的图片地址（预签名的图床链接）。不带 API key；
    图床会拒绝 Python 默认的 User-Agent，所以换一个普通的。"""
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 seasalt-art"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def character(character_id: str) -> dict:
    return _request("GET", f"/characters/{character_id}")


def create_character(name: str, body: dict, out_dir: pathlib.Path, endpoint: str = "/create-character-v3") -> dict[str, pathlib.Path]:
    """8 方向角色：提交后轮询，下载每个方向的图存成 {name}-{方向}.png，返回 {方向: 路径}。
    角色 id 写进 {name}.json，后面做动画要用。"""
    _check_budget()
    out_dir.mkdir(parents=True, exist_ok=True)
    started = time.time()
    job = _request("POST", endpoint, body)
    result = poll(job["background_job_id"], timeout=900)
    usage = result.get("usage") or job.get("usage")
    _record({"time": time.strftime("%Y-%m-%d %H:%M:%S"), "name": name, "endpoint": endpoint, "usage": usage,
             "seconds": round(time.time() - started, 1), "status": result["status"], "character_id": job.get("character_id")})
    if result["status"] != "completed":
        raise RuntimeError(f"{name} 失败：{json.dumps(result.get('last_response'))[:300]}")
    paths = download_rotations(name, job["character_id"], out_dir)
    meta = {k: v for k, v in body.items() if k not in ("reference_image", "color_image", "directions")}
    meta |= {"endpoint": endpoint, "usage": usage, "character_id": job.get("character_id"), "seconds": round(time.time() - started, 1)}
    (out_dir / f"{name}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    return paths


def download_rotations(name: str, character_id: str, out_dir: pathlib.Path) -> dict[str, pathlib.Path]:
    """把角色 8 个方向的图存成 {name}-{方向}.png。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    detail = character(character_id)
    for _ in range(30):
        if detail.get("rotation_urls"):
            break
        time.sleep(4)
        detail = character(character_id)
    paths: dict[str, pathlib.Path] = {}
    for direction, url in (detail.get("rotation_urls") or {}).items():
        path = out_dir / f"{name}-{direction}.png"
        path.write_bytes(_download(url))
        paths[direction] = path
    return paths


def animate_character(name: str, body: dict, out_dir: pathlib.Path) -> dict[str, list[pathlib.Path]]:
    """给已有角色做动画（/characters/animations，每个方向一个后台任务）。
    帧存成 {name}-{方向}-{帧号}.png，返回 {方向: [帧路径]}。"""
    _check_budget()
    out_dir.mkdir(parents=True, exist_ok=True)
    started = time.time()
    job = _request("POST", "/characters/animations", body)
    job_ids = job.get("background_job_ids") or ([job["background_job_id"]] if job.get("background_job_id") else [])
    results: dict[str, list[pathlib.Path]] = {}
    total_usd = 0.0
    labels = job.get("directions") or body.get("directions") or ["south"]
    for job_id, direction in zip(job_ids, labels):
        result = poll(job_id, timeout=900)
        usage = result.get("usage") or {}
        if usage.get("type") == "usd":
            total_usd += usage.get("usd") or 0.0
        if result["status"] != "completed":
            raise RuntimeError(f"{name} 动画失败：{json.dumps(result.get('last_response'))[:300]}")
        response = result.get("last_response") or {}
        frames = []
        for index, image in enumerate(response.get("images") or []):
            data = image["base64"] if isinstance(image, dict) else image
            path = out_dir / f"{name}-{direction}-{index:02d}.png"
            path.write_bytes(base64.b64decode(data) if isinstance(data, str) and not data.startswith("http") else _download(data))
            frames.append(path)
        results[direction] = frames
    (out_dir / f"{name}-last-response.json").write_text(json.dumps({k: v for k, v in (response if job_ids else {}).items() if k != "images"}, ensure_ascii=False, indent=2)[:4000])
    usage = {"type": "usd", "usd": total_usd} if total_usd else job.get("usage")
    _record({"time": time.strftime("%Y-%m-%d %H:%M:%S"), "name": name, "endpoint": "/characters/animations", "usage": usage,
             "seconds": round(time.time() - started, 1), "jobs": len(job_ids)})
    (out_dir / f"{name}.json").write_text(json.dumps({**body, "usage": usage, "job": {k: v for k, v in job.items() if k != "usage"}}, ensure_ascii=False, indent=2))
    return results
