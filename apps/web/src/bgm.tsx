import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/**
 * 背景音乐。大厅和各游戏的 bgm.tsx 一模一样，改了要同步到所有仓库。
 * - 游戏：进了房间（等候房间、对局、观战）和新手教程里放这款游戏的曲子，首页和房间列表不放；大厅一直放大厅那首。
 * - 设置全站共用（同源 localStorage）：gm-music 为 "off" 时关（默认开），gm-music-volume 是 0–100（默认 60）。
 *   顶栏的 ♪ 按钮（MusicToggle）点开可以开关、调音量；在别的标签页改了，这里跟着变。
 * - 一个页面只有一个播放器：从等候房间进牌桌不会从头放。切到别的标签页时暂停，回来接着放。
 * - 音量走 Web Audio 的 GainNode（iPhone 上 <audio>.volume 改不了）；每首的 gain 把响度拉到差不多一样大（约 -17 LUFS）。
 * - 循环：放到 end 前 FADE 秒时，另一个 <audio> 从 start 开始放，两边交叉淡化接上（Suno 的曲子结尾有淡出，开头可能有静音）。
 * - 浏览器要求用户先点过页面才能出声：被拦下时等下一次点击 / 按键再放（点的是链接就不放，免得跳页前响一下）。
 */

export interface BgmTrack {
  /** 音频地址（带 BASE_URL）。 */
  src: string;
  /** 响度系数 0–1，把各首拉到差不多响。 */
  gain: number;
  /** 循环从第几秒开始（跳过开头的静音）。 */
  start: number;
  /** 到第几秒前接回开头（结尾淡出之前）。 */
  end: number;
}

const ON_KEY = "gm-music";
const VOLUME_KEY = "gm-music-volume";
const DEFAULT_VOLUME = 60;
/** 循环处交叉淡化的秒数。 */
const FADE = 3;
/** 开始、暂停、换曲时的淡入淡出秒数。 */
const EDGE_FADE = 0.6;

interface Settings {
  on: boolean;
  volume: number;
}

function readSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    const value = raw === null ? Number.NaN : Number(raw);
    return {
      on: window.localStorage.getItem(ON_KEY) !== "off",
      volume: Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : DEFAULT_VOLUME,
    };
  } catch {
    return { on: true, volume: DEFAULT_VOLUME };
  }
}

// ---- 状态（给 React 订阅） ----

interface Snapshot {
  settings: Settings;
  hasTrack: boolean;
}

let settings = readSettings();
let track: BgmTrack | null = null;
let snapshot: Snapshot = { settings, hasTrack: false };
const listeners = new Set<() => void>();

function publish() {
  snapshot = { settings, hasTrack: track !== null };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 存不了就只在本页生效。
  }
}

function setOn(on: boolean) {
  settings = { ...settings, on };
  store(ON_KEY, on ? "on" : "off");
  publish();
  sync();
}

function setVolume(volume: number) {
  settings = { ...settings, volume };
  store(VOLUME_KEY, String(volume));
  publish();
  applyMaster(0.08);
}

// ---- 播放器 ----

interface Deck {
  el: HTMLAudioElement;
  gain: GainNode | null;
  /** 没有 Web Audio 时用 el.volume 代替 gain，记下这一路该有的音量。 */
  level: number;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let loaded: BgmTrack | null = null;
let decks: Deck[] = [];
let current = 0;
let crossfading = false;
let timer = 0;
let pauseTimer = 0;

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
  }
  return ctx;
}

function masterLevel(): number {
  if (!loaded || !settings.on || document.hidden) return 0;
  const v = settings.volume / 100;
  return loaded.gain * v * v;
}

function ramp(param: AudioParam, to: number, seconds: number) {
  const now = ctx!.currentTime;
  param.cancelScheduledValues(now);
  if (seconds <= 0) {
    param.setValueAtTime(to, now);
    return;
  }
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(to, now + seconds);
}

function applyMaster(seconds: number) {
  const level = masterLevel();
  if (ctx && master) ramp(master.gain, level, seconds);
  else for (const deck of decks) deck.el.volume = Math.min(1, level * deck.level);
}

function setDeckLevel(deck: Deck, level: number, seconds: number) {
  deck.level = level;
  if (ctx && deck.gain) ramp(deck.gain.gain, level, seconds);
  else deck.el.volume = Math.min(1, masterLevel() * level);
}

function makeDeck(src: string): Deck {
  const el = new Audio();
  el.preload = "auto";
  el.src = src;
  const deck: Deck = { el, gain: null, level: 0 };
  const audio = audioContext();
  if (audio && master) {
    try {
      deck.gain = audio.createGain();
      deck.gain.gain.value = 0;
      audio.createMediaElementSource(el).connect(deck.gain);
      deck.gain.connect(master);
    } catch {
      deck.gain = null;
    }
  }
  if (!deck.gain) el.volume = 0;
  // 万一错过了交叉淡化（比如计时器被浏览器放慢），放完了就从头接上。
  el.addEventListener("ended", () => {
    if (deck !== decks[current] || !loaded) return;
    el.currentTime = loaded.start;
    play(deck);
  });
  return deck;
}

function play(deck: Deck) {
  deck.el.play().catch(() => {
    // 被自动播放规则拦下了，等下一次点击 / 按键（onGesture）。
  });
}

function shouldPlay(): boolean {
  return track !== null && settings.on && !document.hidden;
}

function sync() {
  window.clearTimeout(pauseTimer);
  if (loaded && track?.src !== loaded.src) {
    // 换曲或离开房间：旧的几路淡出后扔掉。
    const old = decks;
    for (const deck of old) setDeckLevel(deck, 0, EDGE_FADE);
    window.setTimeout(() => {
      for (const deck of old) {
        deck.el.pause();
        deck.gain?.disconnect();
        deck.el.removeAttribute("src");
        deck.el.load();
      }
    }, EDGE_FADE * 1000 + 50);
    decks = [];
    loaded = null;
    current = 0;
    crossfading = false;
  }
  if (!shouldPlay()) {
    if (decks.length > 0) {
      applyMaster(EDGE_FADE);
      pauseTimer = window.setTimeout(() => {
        // 暂停前把没淡完的交叉淡化收尾：只留当前这一路。
        decks.forEach((deck, i) => {
          deck.el.pause();
          if (i !== current) setDeckLevel(deck, 0, 0);
        });
        if (decks[current]) setDeckLevel(decks[current]!, 1, 0);
        crossfading = false;
      }, EDGE_FADE * 1000 + 50);
    }
    stopTimer();
    return;
  }
  if (!loaded && track) {
    loaded = track;
    const first = makeDeck(track.src);
    first.el.currentTime = track.start;
    decks = [first];
    current = 0;
    setDeckLevel(first, 1, 0);
  }
  void ctx?.resume().catch(() => {});
  const deck = decks[current]!;
  if (deck.el.paused) play(deck);
  applyMaster(EDGE_FADE);
  startTimer();
}

function startTimer() {
  if (timer) return;
  timer = window.setInterval(tick, 250);
}

function stopTimer() {
  window.clearInterval(timer);
  timer = 0;
}

function tick() {
  if (!loaded || crossfading || !shouldPlay()) return;
  const deck = decks[current];
  if (!deck || deck.el.paused) return;
  const at = deck.el.currentTime;
  const next = 1 - current;
  // 提前 10 秒准备好另一路（这时文件已经在缓存里了）。
  if (!decks[next] && at >= loaded.end - FADE - 10) decks[next] = makeDeck(loaded.src);
  if (at < loaded.end - FADE) return;
  const incoming = decks[next] ?? (decks[next] = makeDeck(loaded.src));
  crossfading = true;
  incoming.el.currentTime = loaded.start;
  setDeckLevel(incoming, 0, 0);
  play(incoming);
  setDeckLevel(incoming, 1, FADE);
  setDeckLevel(deck, 0, FADE);
  current = next;
  window.setTimeout(() => {
    deck.el.pause();
    crossfading = false;
  }, FADE * 1000 + 100);
}

function onGesture(event: Event) {
  if (!shouldPlay()) return;
  const target = event.target as Element | null;
  if (target?.closest?.("a[href]")) return;
  void ctx?.resume().catch(() => {});
  const deck = decks[current];
  if (deck?.el.paused) play(deck);
}

function setTrack(next: BgmTrack | null) {
  if ((next?.src ?? null) === (track?.src ?? null)) return;
  track = next;
  publish();
  sync();
}

for (const type of ["pointerdown", "pointerup", "click", "touchend", "keydown"]) {
  window.addEventListener(type, onGesture, { capture: true, passive: true });
}
document.addEventListener("visibilitychange", sync);
window.addEventListener("storage", (event) => {
  if (event.key !== ON_KEY && event.key !== VOLUME_KEY) return;
  settings = readSettings();
  publish();
  sync();
});

/** 这一页该放哪首；传 null 就停（淡出）。 */
export function useBgm(next: BgmTrack | null) {
  useEffect(() => setTrack(next), [next?.src]);
}

// ---- 顶栏的 ♪ 按钮 ----

const CSS = `
.gm-music-panel { --bg: #0e0c13; --panel: #1c1826; --text: #f1ece0; --muted: #9a93ad; --gold: #f0c050; --edge: #050408;
  --rim: #4a3f63; --shade: #0b0a10; --track: #332b44;
  position: fixed; z-index: 1000; width: 208px; padding: 12px 14px 14px; background: var(--panel); color: var(--text);
  font-family: "Fusion Pixel", -apple-system, "PingFang SC", sans-serif; font-size: 12px; line-height: 1.5; -webkit-font-smoothing: none;
  box-shadow: 0 -2px 0 0 var(--edge), 0 2px 0 0 var(--edge), -2px 0 0 0 var(--edge), 2px 0 0 0 var(--edge),
    inset 2px 2px 0 0 var(--rim), inset -2px -2px 0 0 var(--shade); }
html[data-theme="day"] .gm-music-panel { --bg: #ffffff; --panel: #f6f4f9; --text: #26212f; --muted: #6c6580; --gold: #c8901c;
  --edge: #2b2536; --rim: #ffffff; --shade: #d5d0de; --track: #d5d0de; }
.gm-music-panel * { box-sizing: border-box; font: inherit; letter-spacing: 0; }
.gm-music-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.gm-music-row + .gm-music-row { margin-top: 12px; }
.gm-music-row > span { white-space: nowrap; }
.gm-music-switch { min-width: 52px; margin: 0; border: 0; border-radius: 0; padding: 4px 10px; cursor: pointer; white-space: nowrap;
  color: var(--muted); background: var(--bg);
  box-shadow: 0 -2px 0 0 var(--edge), 0 2px 0 0 var(--edge), -2px 0 0 0 var(--edge), 2px 0 0 0 var(--edge); }
.gm-music-switch[aria-pressed="true"] { color: #2a1c06; background: #f0c050; }
.gm-music-range { flex: 1; min-width: 0; height: 20px; margin: 0; background: transparent; accent-color: var(--gold); cursor: pointer;
  -webkit-appearance: none; appearance: none; }
.gm-music-range::-webkit-slider-runnable-track { height: 6px; background: var(--track); }
.gm-music-range::-moz-range-track { height: 6px; background: var(--track); border: 0; }
.gm-music-range::-webkit-slider-thumb { -webkit-appearance: none; width: 10px; height: 18px; margin-top: -6px; border: 0; border-radius: 0;
  background: var(--gold); box-shadow: 0 0 0 2px var(--edge); }
.gm-music-range::-moz-range-thumb { width: 10px; height: 18px; border: 0; border-radius: 0; background: var(--gold); box-shadow: 0 0 0 2px var(--edge); }
.gm-music-range:disabled { cursor: default; opacity: 0.5; }
.gm-music-toggle { white-space: nowrap; }
/* 晶脉这种不是像素风的画面：浅色圆角面板，字体跟页面走。 */
.gm-music-panel.soft { --panel: #fffdf8; --text: #23332d; --muted: #7f847c; --gold: #1e3d32; --track: #e4e0d6;
  border: 1px solid #e2ddd1; border-radius: 12px; box-shadow: 0 12px 32px rgba(35, 51, 45, 0.14);
  font-family: inherit; -webkit-font-smoothing: auto; }
.gm-music-panel.soft .gm-music-switch { border: 1px solid #dedbd1; border-radius: 7px; box-shadow: none; color: var(--muted); background: #fff; }
.gm-music-panel.soft .gm-music-switch[aria-pressed="true"] { border-color: #1e3d32; color: #fff; background: #1e3d32; }
.gm-music-panel.soft .gm-music-range::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; }
.gm-music-panel.soft .gm-music-range::-moz-range-track { height: 4px; border-radius: 2px; }
.gm-music-panel.soft .gm-music-range::-webkit-slider-thumb { width: 14px; height: 14px; margin-top: -5px; border-radius: 50%; background: #1e3d32; box-shadow: none; }
.gm-music-panel.soft .gm-music-range::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #1e3d32; box-shadow: none; }
`;

let styled = false;
function injectStyle() {
  if (styled) return;
  styled = true;
  const style = document.createElement("style");
  style.dataset.gmMusic = "";
  style.textContent = CSS;
  document.head.append(style);
}

const PANEL_WIDTH = 208;

/**
 * 顶栏的 ♪ 按钮：没有在放音乐的画面（首页、房间列表）不显示。className 跟同一排的按钮一样；
 * look="soft" 给晶脉这种不是像素风的画面用（浅色圆角面板）。
 */
export function MusicToggle({ className = "quiet-button", look = "pixel" }: { className?: string; look?: "pixel" | "soft" }) {
  const { settings: current, hasTrack } = useSyncExternalStore(subscribe, () => snapshot);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    injectStyle();
    const button = buttonRef.current?.getBoundingClientRect();
    const height = panelRef.current?.offsetHeight ?? 96;
    // 按钮在手机「菜单」里，点完菜单就收起来了（麻将、斗地主）：面板贴右上角。
    if (!button || button.width === 0) {
      setPlace({ top: 8, left: Math.max(8, window.innerWidth - PANEL_WIDTH - 8) });
      return;
    }
    const left = Math.min(Math.max(8, button.right - PANEL_WIDTH), window.innerWidth - PANEL_WIDTH - 8);
    const below = button.bottom + 8;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, button.top - height - 8) : below;
    setPlace({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      const target = event.target as Node | null;
      if (target && (panelRef.current?.contains(target) || buttonRef.current?.contains(target))) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  useEffect(() => {
    if (!hasTrack) setOpen(false);
  }, [hasTrack]);

  if (!hasTrack) return null;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${className} gm-music-toggle`}
        aria-expanded={open}
        aria-label={current.on ? "背景音乐：开" : "背景音乐：关"}
        title="背景音乐：开关、音量（只影响你自己）"
        onClick={() => setOpen((value) => !value)}
      >
        {current.on ? "♪" : "♪×"}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={look === "soft" ? "gm-music-panel soft" : "gm-music-panel"}
          role="dialog"
          aria-label="背景音乐"
          style={place ? { top: place.top, left: place.left } : { top: -9999, left: -9999 }}
        >
          <div className="gm-music-row">
            <span>背景音乐</span>
            <button type="button" className="gm-music-switch" aria-pressed={current.on} onClick={() => setOn(!current.on)}>
              {current.on ? "开" : "关"}
            </button>
          </div>
          <div className="gm-music-row">
            <span>音量</span>
            <input
              className="gm-music-range"
              type="range"
              min={0}
              max={100}
              step={5}
              value={current.volume}
              disabled={!current.on}
              aria-label="背景音乐音量"
              onChange={(event) => setVolume(Number(event.target.value))}
            />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
