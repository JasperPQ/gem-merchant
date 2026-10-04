import { useCallback, useEffect, useRef, useState } from "react";
import { GEM_COLORS, type GameState } from "@gem-merchant/game";

/**
 * 游戏音效：全部用 Web Audio 即时合成，不加载任何音频文件。
 * 浏览器要求先有一次用户点击才能出声，所以在第一次点击/按键时解锁。
 */

const STORAGE_KEY = "gm-sound-enabled";

let context: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = readEnabled();

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (!enabled) return null;
  if (!context) {
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    context = new AudioCtor();
    master = context.createGain();
    master.gain.value = 0.5;
    master.connect(context.destination);
  }
  if (context.state === "suspended") void context.resume();
  return context.state === "closed" ? null : { ctx: context, out: master! };
}

function unlock() {
  audio();
}
window.addEventListener("pointerdown", unlock, { passive: true });
window.addEventListener("keydown", unlock);

/** 一个带起音/衰减包络的音。 */
function tone(
  freq: number,
  { at = 0, duration = 0.15, type = "sine" as OscillatorType, volume = 0.3, glideTo }: {
    at?: number; duration?: number; type?: OscillatorType; volume?: number; glideTo?: number;
  } = {},
) {
  const a = audio();
  if (!a) return;
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

/** 滤波白噪声，用来模拟卡牌摩擦、翻动。 */
function noise(
  { at = 0, duration = 0.12, volume = 0.2, filter = "bandpass" as BiquadFilterType, freq = 2000, freqTo, q = 1 }: {
    at?: number; duration?: number; volume?: number; filter?: BiquadFilterType; freq?: number; freqTo?: number; q?: number;
  } = {},
) {
  const a = audio();
  if (!a) return;
  if (!noiseBuffer || noiseBuffer.sampleRate !== a.ctx.sampleRate) {
    noiseBuffer = a.ctx.createBuffer(1, a.ctx.sampleRate, a.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  const start = a.ctx.currentTime + at;
  const source = a.ctx.createBufferSource();
  source.buffer = noiseBuffer;
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
  source.start(start);
  source.stop(start + duration + 0.02);
}

/** 一枚筹码落下：两个高频泛音 + 一下轻微的撞击噪声。 */
function chip(at: number, volume: number) {
  const pitch = 0.94 + Math.random() * 0.12;
  noise({ at, duration: 0.03, volume: volume * 0.5, filter: "highpass", freq: 3000 });
  tone(2900 * pitch, { at, duration: 0.09, volume: volume * 0.35 });
  tone(4300 * pitch, { at: at + 0.004, duration: 0.06, volume: volume * 0.2 });
}

/** mine 为 false 时（别人的行动）音量减半。 */
const level = (mine: boolean) => (mine ? 1 : 0.45);

export const sounds = {
  takeGems(count: number, mine: boolean) {
    for (let i = 0; i < count; i += 1) chip(i * 0.08, level(mine));
  },
  returnGems(count: number, mine: boolean) {
    for (let i = 0; i < Math.min(count, 3); i += 1) chip(0.25 + i * 0.07, level(mine) * 0.6);
  },
  buyCard(mine: boolean) {
    const v = level(mine);
    noise({ duration: 0.18, volume: 0.25 * v, freq: 1400, freqTo: 3200, q: 0.8 });
    tone(784, { at: 0.16, duration: 0.14, volume: 0.18 * v, type: "triangle" });
    tone(1175, { at: 0.24, duration: 0.22, volume: 0.18 * v, type: "triangle" });
  },
  reserveCard(gainedGold: boolean, mine: boolean) {
    const v = level(mine);
    noise({ duration: 0.07, volume: 0.3 * v, filter: "highpass", freq: 2500 });
    noise({ at: 0.06, duration: 0.1, volume: 0.15 * v, freq: 1800, freqTo: 900 });
    if (gainedGold) chip(0.18, v);
  },
  noble(mine: boolean) {
    const v = level(mine);
    [523, 659, 784, 1047].forEach((freq, i) => tone(freq, { at: 0.3 + i * 0.09, duration: 0.3, volume: 0.16 * v, type: "triangle" }));
  },
  /** 轮到自己行动。 */
  yourTurn() {
    tone(659, { duration: 0.35, volume: 0.22 });
    tone(988, { at: 0.12, duration: 0.5, volume: 0.2 });
    tone(1976, { at: 0.12, duration: 0.3, volume: 0.04 });
  },
  /** 回合结束、交给下一位。 */
  turnPassed() {
    tone(660, { duration: 0.12, volume: 0.1, glideTo: 520 });
  },
  /** 最后 5 秒，每秒一声；最后一秒更高更长。 */
  countdown(secondsLeft: number) {
    if (secondsLeft <= 1) tone(1320, { duration: 0.3, volume: 0.22, type: "square" });
    else tone(880, { duration: 0.08, volume: 0.16, type: "square" });
  },
  timeout() {
    tone(196, { duration: 0.35, volume: 0.3, type: "triangle", glideTo: 110 });
  },
  gameOver(won: boolean) {
    const notes = won ? [523, 659, 784, 1047, 1319] : [440, 523, 659];
    notes.forEach((freq, i) => tone(freq, { at: i * 0.12, duration: won ? 0.5 : 0.6, volume: 0.18, type: "triangle" }));
  },
};

export function useSoundSetting(): [boolean, () => void] {
  const [on, setOn] = useState(enabled);
  const toggle = useCallback(() => {
    enabled = !enabled;
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
    } catch {
      // 存不了就只在本次页面内生效。
    }
    setOn(enabled);
    if (enabled) sounds.turnPassed();
  }, []);
  return [on, toggle];
}

/**
 * 对比前后两次对局快照推断刚发生的行动并播放音效，所有玩家的行动都能听到。
 * 第一次拿到快照（进入或重连）时不出声。
 */
export function useGameSounds(game: GameState | undefined, myId: string | undefined, isMyTurn: boolean, secondsLeft: number) {
  const previous = useRef<GameState | undefined>(undefined);

  useEffect(() => {
    const prev = previous.current;
    previous.current = game;
    if (!prev || !game || prev === game) return;

    if (prev.status === "finished") {
      if (game.status === "active" && game.players[game.activePlayerIndex]?.id === myId) sounds.yourTurn();
      return;
    }

    const actorIndex = prev.activePlayerIndex;
    const before = prev.players[actorIndex];
    const after = game.players[actorIndex];
    if (!before || !after) return;
    const mine = after.id === myId;
    const bought = after.purchasedCards.length > before.purchasedCards.length;
    const reserved = after.reservedCards.length > before.reservedCards.length;
    const gotNoble = after.nobles.length > before.nobles.length;
    let gained = 0;
    let returned = 0;
    for (const color of GEM_COLORS) {
      const delta = after.gems[color] - before.gems[color];
      if (delta > 0) gained += delta;
      else if (!bought) returned -= delta;
    }
    if (!bought) returned += Math.max(0, before.gems.gold - after.gems.gold);

    const turnChanged = game.activePlayerIndex !== actorIndex || game.status === "finished";
    if (bought) sounds.buyCard(mine);
    else if (reserved) sounds.reserveCard(after.gems.gold > before.gems.gold, mine);
    else if (gained > 0) sounds.takeGems(gained, mine);
    else if (turnChanged && !gotNoble) {
      // 什么都没做就换人了：超时被跳过。
      if (mine) sounds.timeout();
      else sounds.turnPassed();
    }
    if (returned > 0) sounds.returnGems(returned, mine);
    if (gotNoble) sounds.noble(mine);

    if (game.status === "finished") {
      const won = game.winnerIds.includes(myId ?? "");
      window.setTimeout(() => sounds.gameOver(won), 700);
    } else if (turnChanged) {
      const nextIsMe = game.players[game.activePlayerIndex]?.id === myId;
      if (nextIsMe) window.setTimeout(() => sounds.yourTurn(), 500);
      else if (mine) window.setTimeout(() => sounds.turnPassed(), 450);
    }
  }, [game, myId]);

  // 自己行动的最后 5 秒，每秒响一次。
  const lastBeep = useRef<number | null>(null);
  useEffect(() => {
    if (!isMyTurn || secondsLeft > 5 || secondsLeft < 1) {
      if (secondsLeft > 5 || !isMyTurn) lastBeep.current = null;
      return;
    }
    if (lastBeep.current === secondsLeft) return;
    lastBeep.current = secondsLeft;
    sounds.countdown(secondsLeft);
  }, [isMyTurn, secondsLeft]);
}
