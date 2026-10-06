"""PixelLab API 客户端：限速自动重试、后台任务轮询、花费记账和预算上限。

密钥从 ~/.config/pixellab/api_key 读取（或环境变量 PIXELLAB_API_KEY），不进仓库。
每次调用都记进 art/ledger.jsonl；累计美元花费超过 BUDGET_USD 就拒绝继续调用。
"""
from __future__ import annotations

import base64
import json
import os
import pathlib
import threading
import time
import urllib.error
import urllib.request

API = "https://api.pixellab.ai/v2"
ART = pathlib.Path(__file__).resolve().parent
LEDGER = ART / "ledger.jsonl"
# 用户充值 15 美元；留 1 美元余量，避免最后一次调用透支。
BUDGET_USD = float(os.environ.get("PIXELLAB_BUDGET_USD", "14"))


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
    for attempt in range(RETRY_ATTEMPTS):
        try:
            with urllib.request.urlopen(request, timeout=240) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read()[:400]
            if error.code != 429 or attempt == RETRY_ATTEMPTS - 1:
                raise RuntimeError(f"HTTP {error.code} {path}: {detail!r}") from error
            # 有频率限制：按 Retry-After（没有就指数退避）等一会儿再试
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
