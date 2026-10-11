import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/**
 * 全站的声音：背景音乐、界面音效、语音通话音量。大厅和各游戏的 gm-sound.tsx 一模一样，改了要同步到所有仓库。
 *
 * 三路音量，设置全站共用（同源 localStorage，在别的标签页改了这里跟着变）：
 * - 音乐 gm-music / gm-music-volume（默认开、60）：进了房间（等候房间、对局、观战）和新手教程里放这款游戏的曲子，
 *   首页和房间列表不放；大厅一直放大厅那首。还没有曲子的游戏用 NO_BGM：不放音乐，但房间里照样有 ♪ 面板。
 * - 音效 gm-sfx / gm-sfx-volume（默认开、70）：sfx.* 全部用 Web Audio 即时合成，不加载文件。
 *   按钮、链接按下时自动响一声轻点（data-sfx="none" 关掉、data-sfx="select" 等换成别的声音）；
 *   各游戏按对局状态的变化调用 sfx.card() / sfx.dice() 这些，自己的动作 mine=true 响亮，别人的减半。
 * - 语音 gm-voice / gm-voice-volume（默认开、100）：别人说话的音量。voice.ts 里每个对方的 <audio> 用 registerVoiceAudio 登记。
 *   只调你听到的声音，不动自己的麦克风。iPhone 上 <audio>.volume 改不了，只能开关。
 *
 * 顶栏的 ♪ 按钮（SoundToggle）点开是三条滑杆；只在房间和教程里显示（useBgm 传了曲子或 NO_BGM 的时候）。
 *
 * 背景音乐的细节：一个页面只有一个播放器，从等候房间进牌桌不会从头放；切到别的标签页暂停；
 * 音量走 Web Audio 的 GainNode（iPhone 上 <audio>.volume 改不了），每首的 gain 把响度拉到约 -17 LUFS；
 * 放到 end 前 FADE 秒时另一个 <audio> 从 start 开始放，交叉淡化接上。
 * 浏览器要求用户先点过页面才能出声：被拦下时等下一次点击 / 按键再放（点的是链接就不放音乐，免得跳页前响一下）。
 */

export interface BgmTrack {
  /** 音频地址（带 BASE_URL）。空字符串 = 这款游戏还没有音乐。 */
  src: string;
  /** 响度系数 0–1，把各首拉到差不多响。 */
  gain: number;
  /** 循环从第几秒开始（跳过开头的静音）。 */
  start: number;
  /** 到第几秒前接回开头（结尾淡出之前）。 */
  end: number;
}

/** 在房间里但这款游戏还没有背景音乐：♪ 面板照样有（调音效、语音），不放音乐。 */
export const NO_BGM: BgmTrack = { src: "", gain: 0, start: 0, end: 0 };

type Channel = "music" | "sfx" | "voice";
const CHANNELS: Channel[] = ["music", "sfx", "voice"];
const LABEL: Record<Channel, string> = { music: "背景音乐", sfx: "音效", voice: "语音" };
const DEFAULT_VOLUME: Record<Channel, number> = { music: 60, sfx: 70, voice: 100 };
const KEY: Record<Channel, string> = { music: "gm-music", sfx: "gm-sfx", voice: "gm-voice" };
/** 循环处交叉淡化的秒数。 */
const FADE = 3;
/** 开始、暂停、换曲时的淡入淡出秒数。 */
const EDGE_FADE = 0.6;

interface Level {
  on: boolean;
  volume: number;
}
type Settings = Record<Channel, Level>;

function readLevel(channel: Channel): Level {
  try {
    const raw = window.localStorage.getItem(`${KEY[channel]}-volume`);
    const value = raw === null ? Number.NaN : Number(raw);
    let off = window.localStorage.getItem(KEY[channel]) === "off";
    // 宝石商人以前单独的「音效」开关
    if (channel === "sfx" && window.localStorage.getItem(KEY.sfx) === null) off = window.localStorage.getItem("gm-sound-enabled") === "off";
    return { on: !off, volume: Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : DEFAULT_VOLUME[channel] };
  } catch {
    return { on: true, volume: DEFAULT_VOLUME[channel] };
  }
}

function readSettings(): Settings {
  return { music: readLevel("music"), sfx: readLevel("sfx"), voice: readLevel("voice") };
}

// ---- 状态（给 React 订阅） ----

interface Snapshot {
  settings: Settings;
  /** 在房间或教程里（♪ 按钮显示）。 */
  inRoom: boolean;
  /** 这款游戏有背景音乐。 */
  hasMusic: boolean;
}

let settings = readSettings();
let track: BgmTrack | null = null;
let snapshot: Snapshot = { settings, inRoom: false, hasMusic: false };
const listeners = new Set<() => void>();

function publish() {
  snapshot = { settings, inRoom: track !== null, hasMusic: !!track?.src };
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

function setLevel(channel: Channel, patch: Partial<Level>) {
  const next = { ...settings[channel], ...patch };
  settings = { ...settings, [channel]: next };
  if (patch.on !== undefined) store(KEY[channel], next.on ? "on" : "off");
  if (patch.volume !== undefined) store(`${KEY[channel]}-volume`, String(next.volume));
  publish();
  applyChannels(patch.on === undefined);
}

/** 把设置应用到三路输出。volumeOnly：只是拖了滑杆，不用重新开始 / 暂停音乐。 */
function applyChannels(volumeOnly: boolean) {
  if (volumeOnly) applyMaster(0.08);
  else sync();
  applySfxLevel();
  for (const el of voiceAudios) applyVoice(el);
}

// ---- 共用的 AudioContext ----

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxOut: GainNode | null = null;

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    sfxOut = ctx.createGain();
    sfxOut.gain.value = sfxLevel();
    sfxOut.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
    sfxOut = null;
  }
  return ctx;
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

// ---- 背景音乐 ----

interface Deck {
  el: HTMLAudioElement;
  gain: GainNode | null;
  /** 没有 Web Audio 时用 el.volume 代替 gain，记下这一路该有的音量。 */
  level: number;
}

let loaded: BgmTrack | null = null;
let decks: Deck[] = [];
let current = 0;
let crossfading = false;
let timer = 0;
let pauseTimer = 0;

function masterLevel(): number {
  if (!loaded || !settings.music.on || document.hidden) return 0;
  const v = settings.music.volume / 100;
  return loaded.gain * v * v;
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
  return !!track?.src && settings.music.on && !document.hidden;
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
  if (!loaded && track?.src) {
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

function setTrack(next: BgmTrack | null) {
  if (next === track || (next && track && next.src === track.src)) return;
  track = next;
  publish();
  sync();
}

/**
 * 这一页的声音场景：传曲子 = 在房间里放这首；传 NO_BGM = 在房间里但没有音乐；传 null = 不在房间（停音乐、藏 ♪）。
 */
export function useBgm(next: BgmTrack | null) {
  useEffect(() => setTrack(next), [next, next?.src]);
}

// ---- 语音音量 ----

const voiceAudios = new Set<HTMLAudioElement>();

function applyVoice(el: HTMLAudioElement) {
  const { on, volume } = settings.voice;
  el.muted = !on;
  try {
    el.volume = Math.min(1, volume / 100);
  } catch {
    // 有的浏览器不让改。
  }
}

/** voice.ts 里给每个对方的 <audio> 登记一下：语音的开关和音量跟着面板走。 */
export function registerVoiceAudio(el: HTMLAudioElement) {
  voiceAudios.add(el);
  applyVoice(el);
}

export function unregisterVoiceAudio(el: HTMLAudioElement) {
  voiceAudios.delete(el);
}

// ---- 音效 ----

function sfxLevel(): number {
  if (!settings.sfx.on) return 0;
  const v = settings.sfx.volume / 100;
  return 0.9 * v * v;
}

function applySfxLevel() {
  if (ctx && sfxOut) ramp(sfxOut.gain, sfxLevel(), 0.05);
}

/** 能出声的输出口；音效关着、页面在后台、浏览器还没解锁时返回 null。 */
function out(): { ctx: AudioContext; out: GainNode } | null {
  if (!settings.sfx.on || settings.sfx.volume === 0 || document.hidden) return null;
  const audio = audioContext();
  if (!audio || !sfxOut || audio.state === "closed") return null;
  if (audio.state === "suspended") void audio.resume().catch(() => {});
  return { ctx: audio, out: sfxOut };
}

interface ToneOptions {
  at?: number;
  duration?: number;
  type?: OscillatorType;
  volume?: number;
  glideTo?: number;
}

/** 一个带起音 / 衰减包络的音。 */
function tone(freq: number, { at = 0, duration = 0.15, type = "sine", volume = 0.3, glideTo }: ToneOptions = {}) {
  const a = out();
  if (!a || volume <= 0) return;
  const start = a.ctx.currentTime + at;
  const osc = a.ctx.createOscillator();
  const gain = a.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(a.out);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

let noiseBuffer: AudioBuffer | null = null;

interface NoiseOptions {
  at?: number;
  duration?: number;
  volume?: number;
  filter?: BiquadFilterType;
  freq?: number;
  freqTo?: number;
  q?: number;
}

/** 滤波白噪声：卡牌摩擦、翻动、骰子、木头碰撞都靠它。 */
function noise({ at = 0, duration = 0.12, volume = 0.2, filter = "bandpass", freq = 2000, freqTo, q = 1 }: NoiseOptions = {}) {
  const a = out();
  if (!a || volume <= 0) return;
  if (!noiseBuffer || noiseBuffer.sampleRate !== a.ctx.sampleRate) {
    noiseBuffer = a.ctx.createBuffer(1, a.ctx.sampleRate, a.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  const start = a.ctx.currentTime + at;
  const source = a.ctx.createBufferSource();
  source.buffer = noiseBuffer;
  source.loopStart = Math.random() * 0.5;
  const biquad = a.ctx.createBiquadFilter();
  biquad.type = filter;
  biquad.Q.value = q;
  biquad.frequency.setValueAtTime(freq, start);
  if (freqTo) biquad.frequency.exponentialRampToValueAtTime(freqTo, start + duration);
  const gain = a.ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.02, duration / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(biquad).connect(gain).connect(a.out);
  source.start(start, Math.random() * 0.5);
  source.stop(start + duration + 0.02);
}

const jitter = (spread = 0.06) => 1 - spread + Math.random() * spread * 2;
/** 自己的动作响亮，别人的减半。 */
const lv = (mine = true) => (mine ? 1 : 0.45);

/** 一枚筹码 / 宝石落下：两个高频泛音 + 一下轻微的撞击。 */
function chipOne(at: number, v: number) {
  const p = jitter();
  noise({ at, duration: 0.03, volume: v * 0.5, filter: "highpass", freq: 3000 });
  tone(2900 * p, { at, duration: 0.09, volume: v * 0.35 });
  tone(4300 * p, { at: at + 0.004, duration: 0.06, volume: v * 0.2 });
}

/** 一张牌擦过桌面落下。 */
function cardOne(at: number, v: number) {
  noise({ at, duration: 0.07, volume: 0.28 * v, freq: 2200 * jitter(), freqTo: 3800, q: 0.7 });
  noise({ at: at + 0.04, duration: 0.05, volume: 0.18 * v, filter: "lowpass", freq: 900 });
}

/** 硬质小块（麻将牌、瓷砖、木块）碰在一起的「嗒」。 */
function clackOne(at: number, v: number, pitch = 1) {
  const p = jitter() * pitch;
  noise({ at, duration: 0.025, volume: 0.35 * v, freq: 3200 * p, q: 2 });
  tone(1250 * p, { at, duration: 0.05, volume: 0.16 * v, type: "triangle" });
  tone(520 * p, { at, duration: 0.07, volume: 0.1 * v });
}

/** 一颗骰子落桌。 */
function diceHit(at: number, v: number) {
  noise({ at, duration: 0.03, volume: 0.32 * v, freq: 2600 * jitter(0.2), q: 1.5 });
  tone(330 * jitter(0.15), { at, duration: 0.05, volume: 0.12 * v, type: "triangle" });
}

/**
 * 音效库。所有游戏共用这些声音，按动作的意思挑：参数 mine = 是不是自己的动作（别人的减半）。
 * 想要更有游戏特色时，可以在游戏里组合多个（比如先 card() 再 score()）。
 */
export const sfx = {
  /** 按钮按下的轻点（全局自动，一般不用手动调）。 */
  tap() {
    noise({ duration: 0.018, volume: 0.12, filter: "highpass", freq: 3500 });
    tone(1750, { duration: 0.035, volume: 0.05, type: "triangle" });
  },
  /** 选中 / 取消选中一张牌、一个格子。 */
  select(on = true) {
    if (on) tone(880, { duration: 0.07, volume: 0.12, type: "triangle", glideTo: 1180 });
    else tone(1000, { duration: 0.06, volume: 0.09, type: "triangle", glideTo: 760 });
  },
  /** 点了不能点的东西（灰掉的按钮、非法位置）。 */
  deny() {
    tone(240, { duration: 0.06, volume: 0.08, type: "square" });
    tone(190, { at: 0.07, duration: 0.08, volume: 0.08, type: "square" });
  },
  /** 服务器拒绝了操作（room:error）。 */
  error() {
    tone(220, { duration: 0.18, volume: 0.16, type: "triangle", glideTo: 150 });
  },
  /** 出一张或几张牌拍在桌上。 */
  card(mine = true, count = 1) {
    const v = lv(mine);
    for (let i = 0; i < Math.min(count, 6); i += 1) cardOne(i * 0.045, v);
    tone(140, { at: Math.min(count, 6) * 0.045, duration: 0.08, volume: 0.12 * v });
  },
  /** 摸牌 / 拿牌进手里（轻一点的擦）。 */
  draw(mine = true, count = 1) {
    const v = lv(mine) * 0.8;
    for (let i = 0; i < Math.min(count, 5); i += 1) noise({ at: i * 0.07, duration: 0.09, volume: 0.22 * v, freq: 3200, freqTo: 1800, q: 0.8 });
  },
  /** 翻开一张牌。 */
  flip(mine = true) {
    const v = lv(mine);
    noise({ duration: 0.05, volume: 0.24 * v, freq: 1800, freqTo: 3600 });
    noise({ at: 0.06, duration: 0.05, volume: 0.2 * v, freq: 3600, freqTo: 2000 });
    tone(150, { at: 0.1, duration: 0.06, volume: 0.1 * v });
  },
  /** 发牌（开局一张张飞出去）。 */
  deal(count = 8) {
    for (let i = 0; i < Math.min(count, 12); i += 1) cardOne(i * 0.06, 0.6);
  },
  /** 洗牌。 */
  shuffle() {
    for (let i = 0; i < 9; i += 1) noise({ at: i * 0.035, duration: 0.05, volume: 0.15, freq: 2500 + Math.random() * 1500, q: 0.6 });
  },
  /** 筹码 / 宝石 / 金币落下 count 枚。 */
  chips(count = 1, mine = true) {
    for (let i = 0; i < Math.min(count, 8); i += 1) chipOne(i * 0.075, lv(mine));
  },
  /** 硬币进账（得钱、得分币）。 */
  coin(mine = true) {
    const v = lv(mine);
    tone(1568, { duration: 0.08, volume: 0.14 * v, type: "square" });
    tone(2093, { at: 0.07, duration: 0.18, volume: 0.12 * v, type: "square" });
  },
  /** 掷 count 颗骰子：摇骰子的哗啦声 + 一颗颗落桌。 */
  dice(count = 2, mine = true) {
    const v = lv(mine);
    for (let i = 0; i < 6; i += 1) noise({ at: i * 0.045, duration: 0.04, volume: 0.12 * v, freq: 1800 + Math.random() * 1600, q: 1 });
    for (let i = 0; i < Math.min(count, 6); i += 1) {
      const at = 0.3 + i * 0.07 + Math.random() * 0.04;
      diceHit(at, v);
      diceHit(at + 0.09, v * 0.5);
    }
  },
  /** 放下一块硬质的牌 / 砖 / 骨牌（麻将、花砖、多米诺）。pitch 越大越清脆。 */
  tile(mine = true, count = 1, pitch = 1) {
    for (let i = 0; i < Math.min(count, 6); i += 1) clackOne(i * 0.06, lv(mine), pitch);
  },
  /** 在版图上放下一个木头棋子 / 火车 / 标记。 */
  place(mine = true) {
    const v = lv(mine);
    noise({ duration: 0.05, volume: 0.3 * v, filter: "lowpass", freq: 1100 });
    tone(260 * jitter(), { duration: 0.09, volume: 0.18 * v, type: "triangle" });
  },
  /** 棋子 / 骆驼 / 登山者往前走 steps 步。 */
  move(steps = 1, mine = true) {
    const v = lv(mine);
    for (let i = 0; i < Math.min(steps, 8); i += 1) {
      noise({ at: i * 0.09, duration: 0.04, volume: 0.22 * v, filter: "lowpass", freq: 900 });
      tone(330 + i * 40, { at: i * 0.09, duration: 0.05, volume: 0.08 * v, type: "triangle" });
    }
  },
  /** 写字 / 打勾（纸笔类：欢迎来到、快艇骰子记分）。 */
  write(mine = true) {
    const v = lv(mine);
    noise({ duration: 0.12, volume: 0.16 * v, freq: 4200, freqTo: 2600, q: 2 });
    noise({ at: 0.1, duration: 0.08, volume: 0.12 * v, freq: 3000, freqTo: 4500, q: 2 });
  },
  /** 过 / 不要 / 跳过。 */
  pass(mine = true) {
    const v = lv(mine);
    noise({ duration: 0.16, volume: 0.14 * v, freq: 1400, freqTo: 500, q: 0.8 });
    tone(520, { at: 0.02, duration: 0.12, volume: 0.06 * v, glideTo: 400 });
  },
  /** 得分 / 完成一件事（凑成一组、拿到奖励）。big = 大的得分。 */
  score(mine = true, big = false) {
    const v = lv(mine);
    const notes = big ? [784, 988, 1175, 1568] : [880, 1319];
    notes.forEach((f, i) => tone(f, { at: i * 0.07, duration: 0.18, volume: 0.13 * v, type: "triangle" }));
  },
  /** 好运 / 特殊奖励（贵族来访、翻到好牌、七张凑齐）：亮晶晶的琶音。 */
  sparkle(mine = true) {
    const v = lv(mine);
    [1047, 1319, 1568, 2093, 2637].forEach((f, i) => tone(f, { at: i * 0.055, duration: 0.25, volume: 0.09 * v, type: "triangle" }));
  },
  /** 失手 / 爆掉 / 被罚分：往下滑的一声。 */
  bust(mine = true) {
    const v = lv(mine);
    tone(440, { duration: 0.35, volume: 0.18 * v, type: "triangle", glideTo: 196 });
    tone(415, { at: 0.03, duration: 0.35, volume: 0.1 * v, type: "square", glideTo: 185 });
    noise({ at: 0.05, duration: 0.25, volume: 0.08 * v, freq: 800, freqTo: 300 });
  },
  /** 炸弹 / 王炸 / 大事件：低沉的轰。 */
  boom(mine = true) {
    const v = lv(mine);
    noise({ duration: 0.6, volume: 0.45 * v, filter: "lowpass", freq: 900, freqTo: 120 });
    tone(110, { duration: 0.5, volume: 0.35 * v, glideTo: 40 });
    tone(55, { at: 0.02, duration: 0.6, volume: 0.25 * v });
  },
  /** 攻击 / 抢 / 把别人的东西拿走（情书、骷髅牌）。 */
  hit(mine = true) {
    const v = lv(mine);
    noise({ duration: 0.08, volume: 0.35 * v, filter: "lowpass", freq: 1600 });
    tone(180, { duration: 0.15, volume: 0.22 * v, type: "square", glideTo: 90 });
  },
  /** 揭晓 / 亮牌：轻微的上扬。 */
  reveal(mine = true) {
    const v = lv(mine);
    noise({ duration: 0.25, volume: 0.12 * v, freq: 800, freqTo: 4000, q: 0.7 });
    tone(660, { at: 0.18, duration: 0.2, volume: 0.1 * v, type: "triangle" });
  },
  /** 轮到自己行动。 */
  yourTurn() {
    tone(659, { duration: 0.35, volume: 0.22 });
    tone(988, { at: 0.12, duration: 0.5, volume: 0.2 });
    tone(1976, { at: 0.12, duration: 0.3, volume: 0.04 });
  },
  /** 回合交给下一位。 */
  turnPassed() {
    tone(660, { duration: 0.12, volume: 0.1, glideTo: 520 });
  },
  /** 最后 5 秒每秒一声；最后一秒更高更长。 */
  countdown(secondsLeft: number) {
    if (secondsLeft <= 1) tone(1320, { duration: 0.3, volume: 0.2, type: "square" });
    else tone(880, { duration: 0.08, volume: 0.14, type: "square" });
  },
  /** 自己超时，被系统代做了。 */
  timeout() {
    tone(196, { duration: 0.35, volume: 0.28, type: "triangle", glideTo: 110 });
  },
  /** 对局开始。 */
  gameStart() {
    [523, 659, 784].forEach((f, i) => tone(f, { at: i * 0.09, duration: 0.22, volume: 0.15, type: "triangle" }));
    tone(1047, { at: 0.27, duration: 0.4, volume: 0.15, type: "triangle" });
  },
  /** 新的一轮 / 一盘开始（比对局开始轻）。 */
  roundStart() {
    tone(784, { duration: 0.12, volume: 0.12, type: "triangle" });
    tone(1047, { at: 0.1, duration: 0.25, volume: 0.12, type: "triangle" });
  },
  /** 终局：赢了上行的五音，输了短一点。 */
  gameOver(won: boolean) {
    const notes = won ? [523, 659, 784, 1047, 1319] : [440, 523, 659];
    notes.forEach((f, i) => tone(f, { at: i * 0.12, duration: won ? 0.5 : 0.6, volume: 0.18, type: "triangle" }));
  },
  /** 有人进房间。 */
  join() {
    tone(988, { duration: 0.1, volume: 0.1, type: "triangle" });
    tone(1319, { at: 0.08, duration: 0.18, volume: 0.1, type: "triangle" });
  },
  /** 有人离开房间。 */
  leave() {
    tone(1319, { duration: 0.1, volume: 0.08, type: "triangle" });
    tone(988, { at: 0.08, duration: 0.18, volume: 0.08, type: "triangle" });
  },
  /** 收到别人的聊天消息。 */
  chat() {
    tone(1568, { duration: 0.06, volume: 0.08, type: "sine" });
    tone(2093, { at: 0.06, duration: 0.1, volume: 0.07, type: "sine" });
  },
};

export type SfxName = keyof typeof sfx;

/**
 * 底层合成：游戏想要自己的招牌声音时（比如宝石碰撞、骆驼铃铛）在 game-sfx.ts 里用它组合。
 * 都走「音效」那一路音量；mine 的轻重用 synth.level(mine) 乘到 volume 上。
 */
export const synth = { tone, noise, level: lv, jitter };

/** 自己行动的最后 5 秒，每秒响一次（secondsLeft 是整数秒的倒计时）。 */
export function useSfxCountdown(isMyTurn: boolean, secondsLeft: number | null | undefined) {
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!isMyTurn || secondsLeft == null || secondsLeft > 5 || secondsLeft < 1) {
      if (!isMyTurn || secondsLeft == null || secondsLeft > 5) last.current = null;
      return;
    }
    if (last.current === secondsLeft) return;
    last.current = secondsLeft;
    sfx.countdown(secondsLeft);
  }, [isMyTurn, secondsLeft]);
}

/**
 * 房间里的通用提示音：有人进出、开局、收到聊天。传进来的都是简单的数：
 * members 房间人数、playing 是否在对局中、chatCount 聊天条数、lastChatMine 最后一条是不是自己发的。
 * 第一次拿到（进房间、重连）不出声。
 */
export function useRoomSfx(room: { members: number; playing: boolean; chatCount: number; lastChatMine: boolean } | null) {
  const prev = useRef<typeof room>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = room;
    if (!before || !room) return;
    if (!before.playing && room.playing) sfx.gameStart();
    else if (room.members > before.members) sfx.join();
    else if (room.members < before.members) sfx.leave();
    if (room.chatCount > before.chatCount && !room.lastChatMine) sfx.chat();
  }, [room?.members, room?.playing, room?.chatCount, room?.lastChatMine]);
}

// ---- 全局：按下按钮的轻点、解锁声音 ----

const CLICKABLE = "button, [role=button], a[href], summary, select, input[type=checkbox], input[type=radio], label[for], [data-sfx]";

function onGesture(event: Event) {
  const target = event.target as Element | null;
  // 声音要在用户的点击里解锁：音效、音乐都靠它。
  if (event.type === "pointerdown" || event.type === "keydown" || event.type === "touchend" || event.type === "click") {
    const audio = ctx ?? (track ? audioContext() : null);
    if (audio && audio.state === "suspended") void audio.resume().catch(() => {});
  }
  if (event.type === "pointerdown" && target?.closest) {
    const el = target.closest(CLICKABLE);
    if (el && !el.closest(".gm-music-panel")) {
      const name = (el.closest("[data-sfx]") as HTMLElement | null)?.dataset.sfx;
      const disabled = (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true";
      if (name === "none") {
        // 游戏自己出声
      } else if (disabled) sfx.deny();
      else if (name && name in sfx) (sfx[name as SfxName] as () => void)();
      else sfx.tap();
    }
  }
  if (event.type === "keydown") {
    const key = (event as KeyboardEvent).key;
    const el = target?.closest?.("button, [role=button]");
    if ((key === "Enter" || key === " ") && el && !(el as HTMLButtonElement).disabled && !el.closest("[data-sfx=none]")) sfx.tap();
  }
  if (!shouldPlay()) return;
  if (target?.closest?.("a[href]")) return;
  void ctx?.resume().catch(() => {});
  const deck = decks[current];
  if (deck?.el.paused) play(deck);
}

for (const type of ["pointerdown", "pointerup", "click", "touchend", "keydown"]) {
  window.addEventListener(type, onGesture, { capture: true, passive: true });
}
document.addEventListener("visibilitychange", sync);
window.addEventListener("storage", (event) => {
  if (!event.key || !CHANNELS.some((c) => event.key === KEY[c] || event.key === `${KEY[c]}-volume`)) return;
  settings = readSettings();
  publish();
  applyChannels(false);
});

// ---- 顶栏的 ♪ 按钮 ----

const CSS = `
.gm-music-panel { --bg: #0e0c13; --panel: #1c1826; --text: #f1ece0; --muted: #9a93ad; --gold: #f0c050; --edge: #050408;
  --rim: #4a3f63; --shade: #0b0a10; --track: #332b44;
  position: fixed; z-index: 1000; width: 256px; padding: 12px 14px 14px; background: var(--panel); color: var(--text);
  font-family: "Fusion Pixel", -apple-system, "PingFang SC", sans-serif; font-size: 12px; line-height: 1.5; -webkit-font-smoothing: none;
  box-shadow: 0 -2px 0 0 var(--edge), 0 2px 0 0 var(--edge), -2px 0 0 0 var(--edge), 2px 0 0 0 var(--edge),
    inset 2px 2px 0 0 var(--rim), inset -2px -2px 0 0 var(--shade); }
html[data-theme="day"] .gm-music-panel { --bg: #ffffff; --panel: #f6f4f9; --text: #26212f; --muted: #6c6580; --gold: #c8901c;
  --edge: #2b2536; --rim: #ffffff; --shade: #d5d0de; --track: #d5d0de; }
.gm-music-panel * { box-sizing: border-box; font: inherit; letter-spacing: 0; }
.gm-music-row { display: grid; grid-template-columns: 60px minmax(0, 1fr) auto; align-items: center; gap: 10px; }
.gm-music-row + .gm-music-row { margin-top: 12px; }
.gm-music-row > span { white-space: nowrap; }
.gm-music-row > em { grid-column: 2 / 4; color: var(--muted); font-style: normal; white-space: nowrap; }
.gm-music-switch { min-width: 40px; margin: 0; border: 0; border-radius: 0; padding: 4px 8px; cursor: pointer; white-space: nowrap;
  color: var(--muted); background: var(--bg);
  box-shadow: 0 -2px 0 0 var(--edge), 0 2px 0 0 var(--edge), -2px 0 0 0 var(--edge), 2px 0 0 0 var(--edge); }
.gm-music-switch[aria-pressed="true"] { color: #2a1c06; background: #f0c050; }
.gm-music-range { width: 100%; min-width: 0; height: 20px; margin: 0; background: transparent; accent-color: var(--gold); cursor: pointer;
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
  style.dataset.gmSound = "";
  style.textContent = CSS;
  document.head.append(style);
}

const PANEL_WIDTH = 256;

/**
 * 顶栏的 ♪ 按钮：点开是音乐 / 音效 / 语音三条滑杆。不在房间（首页、房间列表）时不显示。
 * className 跟同一排的按钮一样；look="soft" 给晶脉这种不是像素风的画面用（浅色圆角面板）。
 */
export function SoundToggle({ className = "quiet-button", look = "pixel" }: { className?: string; look?: "pixel" | "soft" }) {
  const { settings: now, inRoom, hasMusic } = useSyncExternalStore(subscribe, () => snapshot);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    injectStyle();
    const button = buttonRef.current?.getBoundingClientRect();
    const height = panelRef.current?.offsetHeight ?? 130;
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
    if (!inRoom) setOpen(false);
  }, [inRoom]);

  if (!inRoom) return null;
  const anyOn = (hasMusic && now.music.on) || now.sfx.on || now.voice.on;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${className} gm-music-toggle`}
        aria-expanded={open}
        aria-label="声音：音乐、音效、语音"
        title="声音：背景音乐、音效、语音音量（只影响你自己）"
        onClick={() => setOpen((value) => !value)}
      >
        {anyOn ? "♪" : "♪×"}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={look === "soft" ? "gm-music-panel soft" : "gm-music-panel"}
          role="dialog"
          aria-label="声音"
          style={place ? { top: place.top, left: place.left } : { top: -9999, left: -9999 }}
        >
          {CHANNELS.map((channel) => {
            const level = now[channel];
            if (channel === "music" && !hasMusic) {
              return (
                <div className="gm-music-row" key={channel}>
                  <span>{LABEL[channel]}</span>
                  <em>这款还没有</em>
                </div>
              );
            }
            return (
              <div className="gm-music-row" key={channel}>
                <span>{LABEL[channel]}</span>
                <input
                  className="gm-music-range"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={level.volume}
                  disabled={!level.on}
                  aria-label={`${LABEL[channel]}音量`}
                  onChange={(event) => setLevel(channel, { volume: Number(event.target.value) })}
                  onPointerUp={() => channel === "sfx" && sfx.tap()}
                />
                <button type="button" className="gm-music-switch" aria-pressed={level.on} aria-label={`${LABEL[channel]}：${level.on ? "开" : "关"}`} onClick={() => setLevel(channel, { on: !level.on })}>
                  {level.on ? "开" : "关"}
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

/** 旧名字（背景音乐刚上线时叫 MusicToggle）。 */
export const MusicToggle = SoundToggle;
