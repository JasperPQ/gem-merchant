/**
 * 资源预加载（全站共用，各仓库同一份 gm-preload.ts + gm-preload-plugin.ts；改了要同步到所有仓库）。
 *
 * 线路慢的时候（香港服务器回大陆电信/联通要绕路），对局里第一次翻出某张牌、第一次播某个动画，
 * 都要先跟服务器来回一趟才画得出来，看着像卡了一下。这里在网页打开后，把构建时列好的图片、字体和
 * 数据文件（preload-manifest.json）在后台先下好；背景音乐不在里面，它边下边放。
 *
 * - 首页、等候房间：没下完时左下角一条小进度条（很快下完就不出现）。
 * - 牌桌和新手教程（带 data-gc-table 的 <main>）出现时还没下完：盖一层进度条，下完自动消失；
 *   随时能点「直接进入」，对局本身不受影响。
 * - 开发时没有清单，什么都不做。
 */

type Entry = [path: string, bytes: number];

const BASE = import.meta.env.BASE_URL;
/** 同时下几个文件（HTTP/2 一条连接上并发，主要省的是来回次数）。 */
const PARALLEL = 24;
/** 单个文件最多等多久，超时就当它下完了，不让进度条卡死。 */
const FILE_TIMEOUT_MS = 20_000;
/** 开始后多久还没下完才显示左下角的小进度条。 */
const PILL_AFTER_MS = 800;
/** 牌桌出现后多久还没下完才盖进度条（快下完时不要闪一下）。 */
const COVER_AFTER_MS = 300;
const IMAGE = /\.(png|webp|gif|jpe?g|svg|avif)$/i;

const state = { total: 0, loaded: 0, files: 0, finished: 0, done: false, skipped: false };
/** 调试和测试用：window.__gmPreload。 */
(window as unknown as { __gmPreload: typeof state }).__gmPreload = state;

/** 留着引用，浏览器才会把下好的图一直放在内存里，之后用到时直接拿。 */
const kept: HTMLImageElement[] = [];
let started = false;
let startedAt = 0;
let tableSince = 0;
let observer: MutationObserver | null = null;
let queued = false;
let pill: HTMLDivElement | null = null;
let cover: HTMLDivElement | null = null;

export function startPreload() {
  if (started) return;
  started = true;
  let began = false;
  const begin = () => {
    if (began) return;
    began = true;
    void run();
  };
  // 先让网页自己的东西加载（最多等 0.6 秒），不跟首屏抢；预加载的图不在页面上，浏览器本来就排在后面。
  window.setTimeout(begin, 600);
  if (document.readyState === "complete") window.setTimeout(begin, 200);
  else window.addEventListener("load", () => window.setTimeout(begin, 200), { once: true });
}

async function run() {
  let files: Entry[] = [];
  try {
    const response = await fetch(`${BASE}preload-manifest.json`, { cache: "no-cache" });
    if (response.ok) files = ((await response.json()) as { files?: Entry[] }).files ?? [];
  } catch {
    // 拿不到清单就不预加载，跟原来一样用到再下。
  }
  if (files.length === 0) return finish();
  state.files = files.length;
  state.total = files.reduce((sum, [, bytes]) => sum + bytes, 0);
  startedAt = performance.now();
  observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-gc-table"] });
  // 计时器可能比 performance.now() 早一点点触发，多等 50ms 再判断。
  window.setTimeout(schedule, PILL_AFTER_MS + 50);
  schedule();

  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const [path, bytes] = files[next++]!;
      await load(BASE + path);
      state.loaded += bytes;
      state.finished += 1;
      schedule();
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, files.length) }, worker));
  finish();
}

function load(url: string): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, FILE_TIMEOUT_MS);
    const settle = () => {
      window.clearTimeout(timer);
      resolve();
    };
    if (IMAGE.test(url)) {
      const img = new Image();
      img.decoding = "async";
      img.onload = settle;
      img.onerror = settle;
      img.src = url;
      kept.push(img);
    } else {
      fetch(url)
        .then((response) => response.arrayBuffer())
        .then(settle, settle);
    }
  });
}

function finish() {
  state.done = true;
  observer?.disconnect();
  observer = null;
  render();
}

function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    render();
  });
}

function render() {
  if (state.done || state.skipped) {
    pill?.remove();
    cover?.remove();
    pill = cover = null;
    return;
  }
  const now = performance.now();
  const atTable = document.querySelector("[data-gc-table]") !== null;
  if (!atTable) tableSince = 0;
  else if (!tableSince) {
    tableSince = now;
    window.setTimeout(schedule, COVER_AFTER_MS + 50);
  }
  const showCover = atTable && now - tableSince >= COVER_AFTER_MS;
  const showPill = !atTable && now - startedAt >= PILL_AFTER_MS;
  const percent = state.total ? Math.min(99, Math.floor((state.loaded / state.total) * 100)) : 0;

  if (showPill) {
    if (!pill) {
      injectCss();
      pill = document.createElement("div");
      pill.className = "gm-preload-pill";
      pill.setAttribute("role", "status");
      pill.innerHTML = `<span>资源加载中</span><i><u></u></i><b></b>`;
      document.body.append(pill);
    }
    pill.querySelector("u")!.style.width = `${percent}%`;
    pill.querySelector("b")!.textContent = `${percent}%`;
  } else {
    pill?.remove();
    pill = null;
  }

  if (showCover) {
    if (!cover) {
      injectCss();
      cover = document.createElement("div");
      cover.className = "gm-preload-cover";
      cover.innerHTML =
        `<div class="gm-preload-box" role="status"><h2>正在加载游戏画面</h2>` +
        `<div class="gm-preload-bar"><u></u></div><p></p>` +
        `<button type="button" class="gm-preload-skip">直接进入</button></div>`;
      cover.querySelector("button")!.addEventListener("click", () => {
        state.skipped = true;
        render();
      });
      document.body.append(cover);
    }
    cover.querySelector("u")!.style.width = `${percent}%`;
    cover.querySelector("p")!.textContent = `${percent}%　·　${mb(state.loaded)} / ${mb(state.total)} MB`;
  } else {
    cover?.remove();
    cover = null;
  }
}

function mb(bytes: number) {
  return (bytes / 1048576).toFixed(1);
}

const CSS = `
.gm-preload-pill, .gm-preload-box { --panel: #1c1826; --text: #f1ece0; --muted: #9a93ad; --gold: #f0c050; --edge: #050408;
  --rim: #4a3f63; --shade: #0b0a10; --track: #332b44;
  background: var(--panel); color: var(--text); font-family: "Fusion Pixel", -apple-system, "PingFang SC", sans-serif;
  line-height: 1.5; letter-spacing: 0; -webkit-font-smoothing: none;
  box-shadow: 0 -2px 0 0 var(--edge), 0 2px 0 0 var(--edge), -2px 0 0 0 var(--edge), 2px 0 0 0 var(--edge),
    inset 2px 2px 0 0 var(--rim), inset -2px -2px 0 0 var(--shade); }
html[data-theme="day"] :is(.gm-preload-pill, .gm-preload-box) { --panel: #f6f4f9; --text: #26212f; --muted: #6c6580; --gold: #c8901c;
  --edge: #2b2536; --rim: #ffffff; --shade: #d5d0de; --track: #d5d0de; }
.gm-preload-pill { position: fixed; left: 14px; bottom: 14px; z-index: 900; display: flex; align-items: center; gap: 8px;
  padding: 5px 10px; font-size: 12px; pointer-events: none; }
.gm-preload-pill i { display: block; width: 64px; height: 6px; background: var(--track); }
.gm-preload-pill u, .gm-preload-bar u { display: block; width: 0; height: 100%; background: var(--gold); transition: width 0.2s linear; }
.gm-preload-pill b { min-width: 3em; font-weight: normal; color: var(--muted); text-align: right; }
.gm-preload-cover { position: fixed; inset: 0; z-index: 2000; display: grid; place-items: center; padding: 16px;
  background: rgba(8, 7, 12, 0.88); }
html[data-theme="day"] .gm-preload-cover { background: rgba(246, 244, 249, 0.92); }
.gm-preload-box { width: min(380px, 100%); padding: 20px 22px 22px; text-align: center; }
.gm-preload-box h2 { margin: 0 0 14px; font-size: 24px; font-weight: normal; }
.gm-preload-bar { height: 16px; background: var(--track);
  box-shadow: 0 -2px 0 0 var(--edge), 0 2px 0 0 var(--edge), -2px 0 0 0 var(--edge), 2px 0 0 0 var(--edge); }
.gm-preload-box p { margin: 12px 0 16px; font-size: 14px; color: var(--muted); }
.gm-preload-skip { margin: 0; border: 0; border-radius: 0; padding: 8px 20px; cursor: pointer; font: inherit; font-size: 16px;
  color: #2a1c06; background: #f0c050;
  box-shadow: 0 -2px 0 0 var(--edge), 0 2px 0 0 var(--edge), -2px 0 0 0 var(--edge), 2px 0 0 0 var(--edge); }
`;

let styled = false;
function injectCss() {
  if (styled) return;
  styled = true;
  const style = document.createElement("style");
  style.dataset.gmPreload = "";
  style.textContent = CSS;
  document.head.append(style);
}
