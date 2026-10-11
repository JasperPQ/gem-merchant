/**
 * 剧本推进（全站共用，随 tutorial/ 文件夹一起复制）。
 *
 * 教程不连服务器：局面放在这里，玩家的操作交给本游戏的规则引擎；
 * 剧本里「对手的回合」按剧本自动走，剧本走完进练习局，对手交给人机。
 * 每款游戏只要提供一个 TutorialEngine（怎么开局、怎么走一步、现在轮到谁、人机怎么走、各种等待时间）。
 */
import { useEffect, useRef, useState } from "react";

/** 剧本步骤里这一层要用到的字段（各游戏 packages/game/src/tutorial.ts 里的 TutorialStep 都符合）。 */
export interface ScriptStepLike<C> {
  readonly id: string;
  readonly kind: "info" | "do" | "watch";
  readonly expect?: C;
  readonly moves?: readonly C[];
}

export interface TutorialEngine<S, C, Step extends ScriptStepLike<C>> {
  readonly steps: readonly Step[];
  /** 玩家自己的座位 id。 */
  readonly self: string;
  /** 教程开局（剧本从这里开始）。 */
  start(): S;
  /** 练习局「再练一局」：新开一局（随机）。 */
  restart(): S;
  /** 走一步（不合法就抛错）。剧本骰子、发牌顺序由引擎自己的随机数决定。 */
  apply(state: S, playerId: string, command: C): S;
  /** 两条命令是不是同一步。 */
  same(a: C, b: C): boolean;
  /** 现在轮到谁；对局结束返回 null。 */
  actor(state: S): string | null;
  /**
   * 可选（同时出牌的游戏用，比如七大奇迹）：练习局里玩家现在能不能发命令。
   * 不给就按「actor 是不是自己」判断（轮流行动的游戏）。七大奇迹交了牌以后 actor 是还没出的人机，但玩家还能撤回。
   */
  canAct?(state: S, playerId: string): boolean;
  /** 人机替 playerId 走一步（只给它能看到的信息）。 */
  bot(state: S, playerId: string): C | null;
  /** 练习局里人机走之前等多久（毫秒），让动画播完、人看得清。 */
  botDelay(state: S): number;
  /** 剧本里对手走完这一步，等多久再走下一步。 */
  watchDelay(command: C): number;
}

export const WRONG_STEP = "这一步先照我说的做，教程结束后可以随便走。";

export function useTutorial<S, C, Step extends ScriptStepLike<C>>(engine: TutorialEngine<S, C, Step>) {
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const [game, setGame] = useState<S>(() => engine.start());
  const gameRef = useRef(game);
  const [index, setIndex] = useState(0);
  const [practice, setPractice] = useState(false);
  const [flash, setFlash] = useState("");
  const step: Step | undefined = practice ? undefined : engine.steps[index];

  // 下一步的局面在这里算好再交给 setState（不能放进 setState 的回调：开发模式会调两次，剧本骰子会被多取）
  function run(playerId: string, command: C): boolean {
    try {
      const next = engineRef.current.apply(gameRef.current, playerId, command);
      gameRef.current = next;
      setGame(next);
      return true;
    } catch {
      return false;
    }
  }

  /** 牌桌上玩家（自己）的操作。 */
  function onCommand(command: C) {
    const current = engineRef.current;
    if (practice) {
      const allowed = current.canAct ? current.canAct(gameRef.current, current.self) : current.actor(gameRef.current) === current.self;
      if (allowed) run(current.self, command);
      return;
    }
    if (!step || step.kind !== "do" || step.expect === undefined || !current.same(command, step.expect)) {
      setFlash(WRONG_STEP);
      return;
    }
    if (run(current.self, command)) {
      setFlash("");
      setIndex((at) => at + 1);
    }
  }

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(""), 2600);
    return () => window.clearTimeout(timer);
  }, [flash]);

  // 剧本里对手的回合：按剧本一步步自动走，走完进下一步
  useEffect(() => {
    if (!step || step.kind !== "watch" || !step.moves) return;
    const timers: number[] = [];
    let at = 1400;
    for (const move of step.moves) {
      timers.push(window.setTimeout(() => {
        const actor = engineRef.current.actor(gameRef.current);
        if (actor) run(actor, move);
      }, at));
      at += engineRef.current.watchDelay(move);
    }
    timers.push(window.setTimeout(() => setIndex((value) => value + 1), at + 500));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [step?.id]);

  // 练习局：轮到人机就替它走
  useEffect(() => {
    if (!practice) return;
    const current = engineRef.current;
    const actor = current.actor(game);
    if (!actor || actor === current.self) return;
    const timer = window.setTimeout(() => {
      const command = engineRef.current.bot(gameRef.current, actor);
      if (command !== null) run(actor, command);
    }, current.botDelay(game));
    return () => window.clearTimeout(timer);
  }, [game, practice]);

  return {
    game,
    /** 剧本进行到第几步（练习局里停在最后）。 */
    index,
    step,
    practice,
    flash,
    onCommand,
    /** 讲解步骤点「下一步」。 */
    next: () => setIndex((at) => Math.min(at + 1, engineRef.current.steps.length - 1)),
    /** 剧本走完，接着打完这局。 */
    startPractice: () => setPractice(true),
    /** 练习局「再练一局」。 */
    newPractice: () => {
      const next = engineRef.current.restart();
      gameRef.current = next;
      setGame(next);
      setPractice(true);
    },
  };
}
