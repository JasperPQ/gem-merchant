import { useEffect, useRef } from "react";
import { GEM_COLORS, TOKEN_COLORS, type GameState, type PlayerState } from "@gem-merchant/game";
import { sfx, synth } from "./gm-sound.js";

/**
 * 宝石商人的动作音效。声音都走共用的 gm-sound.tsx（♪ 面板里的「音效」那一路），这里只负责
 * 「刚发生了什么 → 响哪个声音」，外加几个这款独有的招牌声音（宝石碰撞、买卡、预留、贵族来访）。
 *
 * - 拿宝石：一枚一声宝石碰撞（拿 3 枚响 3 下）；退回宝石：轻一点的几下
 * - 买卡：卡牌滑过 + 两声上行的钟音；预留：一下翻牌，拿到金色宝石再加一声碰撞
 * - 贵族来访：四音琶音；轮到你、回合交出、超时、终局输赢用共用的提示音
 * 自己的动作响亮，别人的减半；第一次拿到局面（进房间、重连、观战）不出声。
 */

/** 开发时把响过的声音名字记在 window.__sfxLog（别人的动作带「@他」），给自测脚本看。 */
function log(name: string, mine = true) {
  if (import.meta.env.DEV) {
    const w = window as unknown as { __sfxLog?: string[] };
    (w.__sfxLog ??= []).push(mine ? name : `${name}@他`);
  }
}

const { tone, noise, level, jitter } = synth;

/** 一枚宝石落下：两个高频泛音 + 一下轻微的撞击。 */
function gemClink(at: number, v: number) {
  const p = jitter();
  noise({ at, duration: 0.03, volume: v * 0.5, filter: "highpass", freq: 3000 });
  tone(2900 * p, { at, duration: 0.09, volume: v * 0.35 });
  tone(4300 * p, { at: at + 0.004, duration: 0.06, volume: v * 0.2 });
}

export const gemSfx = {
  takeGems(count: number, mine: boolean) {
    log("takeGems", mine);
    for (let i = 0; i < count; i += 1) gemClink(i * 0.08, level(mine));
  },
  returnGems(count: number, mine: boolean) {
    log("returnGems", mine);
    for (let i = 0; i < Math.min(count, 3); i += 1) gemClink(0.25 + i * 0.07, level(mine) * 0.6);
  },
  buyCard(mine: boolean) {
    log("buyCard", mine);
    const v = level(mine);
    noise({ duration: 0.18, volume: 0.25 * v, freq: 1400, freqTo: 3200, q: 0.8 });
    tone(784, { at: 0.16, duration: 0.14, volume: 0.18 * v, type: "triangle" });
    tone(1175, { at: 0.24, duration: 0.22, volume: 0.18 * v, type: "triangle" });
  },
  reserveCard(gainedGold: boolean, mine: boolean) {
    log("reserveCard", mine);
    const v = level(mine);
    noise({ duration: 0.07, volume: 0.3 * v, filter: "highpass", freq: 2500 });
    noise({ at: 0.06, duration: 0.1, volume: 0.15 * v, freq: 1800, freqTo: 900 });
    if (gainedGold) gemClink(0.18, v);
  },
  noble(mine: boolean) {
    log("noble", mine);
    const v = level(mine);
    [523, 659, 784, 1047].forEach((freq, i) => tone(freq, { at: 0.3 + i * 0.09, duration: 0.3, volume: 0.16 * v, type: "triangle" }));
  },
  /** 在供应区点选 / 取消一枚宝石：选中是一声小碰撞，取消是往下的一声。 */
  pick(on: boolean) {
    log(on ? "pick" : "unpick");
    if (on) gemClink(0, 0.55);
    else sfx.select(false);
  },
};

/** 共用提示音也记一笔名字。 */
function cue(name: "yourTurn" | "turnPassed" | "timeout" | "gameOver", won = false) {
  log(name === "gameOver" ? (won ? "gameOver:win" : "gameOver:lose") : name);
  if (name === "gameOver") sfx.gameOver(won);
  else sfx[name]();
}

const later = (ms: number, fn: () => void) => window.setTimeout(fn, ms);

function holdings(p: PlayerState) {
  return `${TOKEN_COLORS.map((c) => p.gems[c]).join(",")}|${p.purchasedCards.length}|${p.reservedCards.length}|${p.nobles.length}`;
}

/**
 * 对比前后两次对局快照推断刚发生的行动并播放音效，所有玩家的行动都能听到。
 * 第一次拿到快照（进入或重连）时不出声；一下跳了好几步（教程剧本换局面、重连补齐）也不出声。
 */
export function useGameSfx(game: GameState | undefined, myId: string | undefined) {
  const previous = useRef<GameState | undefined>(undefined);

  useEffect(() => {
    const prev = previous.current;
    previous.current = game;
    if (!prev || !game || prev === game) return;
    const myTurnNext = game.status === "active" && game.players[game.activePlayerIndex]?.id === myId;

    // 新的一局（再来一局、教程剧本进练习局）
    const restarted = prev.status === "finished" && game.status === "active"
      || prev.players.length !== game.players.length
      || game.players.some((p, i) => p.purchasedCards.length < (prev.players[i]?.purchasedCards.length ?? 0));
    if (restarted) {
      if (myTurnNext) later(300, () => cue("yourTurn"));
      return;
    }

    // 不止一位玩家的东西变了：跳了好几步，不去猜
    const changed = game.players.filter((p, i) => holdings(p) !== holdings(prev.players[i]!)).length;
    if (changed > 1) return;

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
    if (bought) gemSfx.buyCard(mine);
    else if (reserved) gemSfx.reserveCard(after.gems.gold > before.gems.gold, mine);
    else if (gained > 0) gemSfx.takeGems(gained, mine);
    else if (turnChanged && !gotNoble) {
      // 什么都没做就换人了：超时被跳过。
      if (mine) cue("timeout");
      else cue("turnPassed");
    }
    if (returned > 0) gemSfx.returnGems(returned, mine);
    if (gotNoble) gemSfx.noble(mine);

    if (game.status === "finished") {
      const won = game.winnerIds.includes(myId ?? "");
      later(700, () => cue("gameOver", won));
    } else if (turnChanged) {
      if (myTurnNext) later(500, () => cue("yourTurn"));
      else if (mine) later(450, () => cue("turnPassed"));
    }
  }, [game, myId]);
}
