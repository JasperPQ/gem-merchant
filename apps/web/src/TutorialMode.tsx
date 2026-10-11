/**
 * 宝石商人的新手教程：在浏览器里按剧本走一局（packages/game/src/tutorial.ts），
 * 牌桌就是真正对局的 GameBoard，咕噜嘎的对话框叠在上面；剧本走完开一局练习局，对手交给人机。
 * 不连服务器，不占房间；首页、等候房间都能进来（从等候房间进来时，房主开局会自动回到牌桌，见 App.tsx）。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  botCommand,
  createPracticeGame,
  createTutorialGame,
  DEFAULT_ROOM_ACCESS,
  legalActions,
  redactGameForViewer,
  sameCommand,
  TUTORIAL_FINAL_STEP,
  TUTORIAL_RIVAL,
  TUTORIAL_RIVAL_NAME,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialApply,
  type DevelopmentCard,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type Noble,
  type TutorialMove,
  type TutorialStep,
} from "@gem-merchant/game";
import cardsFile from "../../../data/cards.json";
import noblesFile from "../../../data/nobles.json";
import GameBoard from "./GameBoard.js";
import { Coach, isTouchDevice, StepPips, type CoachView } from "./tutorial/Coach.js";
import { writeTutorial } from "./tutorial/storage.js";
import { useTutorial } from "./tutorial/useTutorial.js";
import { GAME_ID } from "./tutorialGame.js";

const CARDS = (cardsFile as { cards: DevelopmentCard[] }).cards;
const NOBLES = (noblesFile as { nobles: Noble[] }).nobles;
const TUTORIAL_CODE = "GULU01";
const FINAL_AT = TUTORIAL_STEPS.findIndex((step) => step.id === TUTORIAL_FINAL_STEP);

/**
 * 买 / 预留都是「先点土地，再在弹窗里点按钮」：GameBoard 报上来点开了哪张，
 * 点对了就把高亮挪到弹窗的「购买」「预留」，点错了挪到关闭按钮。
 */
function followAnchor(step: TutorialStep, selection: string): string | null {
  const base = step.anchor ?? null;
  if (step.kind !== "do" || selection === "none") return base;
  const expect = step.expect;
  if (expect.type === "buyCard") return selection === `card:${expect.source.cardId}` ? "card-buy" : "card-close";
  if (expect.type === "reserveCard" && expect.source.kind === "market") {
    return selection === `card:${expect.source.cardId}` ? "card-reserve" : "card-close";
  }
  return "card-close";
}

export default function TutorialMode({ name, brand, themeToggle, waitingRoom, onExit }: {
  /** 首页填过的昵称；没填叫「新玩家」。 */
  name: string;
  brand: ReactNode;
  themeToggle: ReactNode;
  /** 从等候房间点进来的：那个房间的房间码。 */
  waitingRoom?: string | undefined;
  onExit: () => void;
}) {
  const selfName = name.trim().length >= 2 ? name.trim() : "新玩家";
  // GameBoard 报上来的当前点开的卡
  const [selection, setSelection] = useState("none");

  const tutorial = useTutorial<GameState, TutorialMove, TutorialStep>({
    steps: TUTORIAL_STEPS,
    self: TUTORIAL_SELF,
    start: () => createTutorialGame(selfName, CARDS, NOBLES),
    restart: () => createPracticeGame(selfName, CARDS, NOBLES),
    apply: (state, playerId, move) => tutorialApply(state, playerId, move, CARDS),
    same: sameCommand,
    actor: (state) => (state.status === "finished" ? null : state.players[state.activePlayerIndex]!.id),
    // 人机没有能走的（供应区空、买不起、预留满）就跳过
    bot: (state, playerId) => botCommand(redactGameForViewer(state, playerId), playerId) ?? { type: "PASS" },
    botDelay: (state) => (state.pendingNobleIds.length > 0 ? 800 : 1400),
    watchDelay: (move) => (move.type === "FAST_FORWARD" ? 900 : 1700),
  });
  const { game, step, index, practice, flash } = tutorial;
  // 每开一局练习局，牌桌重新挂载
  const [table, setTable] = useState(0);
  const newPractice = () => {
    setTable((value) => value + 1);
    tutorial.newPractice();
  };

  // 走到最后一步就算学完（之后首页不再邀请）
  useEffect(() => {
    if (practice || (step?.kind === "info" && step.finale)) writeTutorial(GAME_ID, "done");
  }, [practice, step?.id]);

  // 练习局里轮到你却什么都做不了（极少见）：替你跳过
  useEffect(() => {
    if (!practice || game.status !== "active" || game.players[game.activePlayerIndex]?.id !== TUTORIAL_SELF) return;
    if (legalActions(redactGameForViewer(game, TUTORIAL_SELF), TUTORIAL_SELF).length > 0) return;
    const timer = window.setTimeout(() => tutorial.onCommand({ type: "PASS" }), 1500);
    return () => window.clearTimeout(timer);
  }, [game, practice]);

  function leave() {
    writeTutorial(GAME_ID, "skipped");
    onExit();
  }

  const members = useMemo<LobbyMember[]>(() => [
    { id: TUTORIAL_SELF, name: selfName, isHost: false, connected: true },
    { id: TUTORIAL_RIVAL, name: TUTORIAL_RIVAL_NAME, isHost: false, connected: true, bot: true },
  ], [selfName]);
  const room = useMemo<LobbyRoomSnapshot>(() => ({
    code: TUTORIAL_CODE,
    spectators: [],
    access: DEFAULT_ROOM_ACCESS,
    capacity: 2,
    status: "playing",
    members,
    chat: [],
    voice: [],
    turnSeconds: 60,
    game: redactGameForViewer(game, TUTORIAL_SELF),
  }), [game, members]);

  let view: CoachView | null = null;
  if (step) {
    const note = isTouchDevice() && step.noteTouch ? step.noteTouch : step.note;
    const finale = step.kind === "info" && step.finale === true;
    const anchor = followAnchor(step, selection);
    view = {
      key: `${step.id}:${anchor ?? ""}`,
      say: anchor === "card-close" ? "点错土地了：先关掉这个窗口。" : step.say,
      ...(note && anchor !== "card-close" ? { note } : {}),
      ...(flash ? { flash } : {}),
      anchor,
      focus: step.kind !== "watch",
      face: flash || anchor === "card-close" ? "surprised" : step.face ?? "base",
      footer: (
        <>
          <StepPips index={index} total={TUTORIAL_STEPS.length} />
          {!finale && <button className="tut-link" type="button" onClick={leave}>跳过教程</button>}
        </>
      ),
      actions: step.kind !== "info" ? null : finale ? (
        <>
          <button className="quiet-button" type="button" onClick={onExit}>结束教程</button>
          <button className="primary-button tut-main" type="button" onClick={newPractice}>开一局练习</button>
        </>
      ) : (
        <button className="primary-button tut-main" type="button" onClick={tutorial.next}>下一步 ▶</button>
      ),
    };
  }

  // 剧本进行中和练习局的侧栏挤法不一样（见 game.css 的 .tut-script / .tut-practice）
  return (
    <div className={practice ? "tut-practice" : "tut-script"} style={{ display: "contents" }}>
      <GameBoard
        key={table}
        room={room}
        busy={false}
        error=""
        notice={practice ? "练习局：拿不准就点「提示」。" : ""}
        brand={brand}
        connection={
          <>
            <span className="connection-status online" title={waitingRoom ? `你还在房间 ${waitingRoom} 里，房主一开局就自动回到牌桌` : undefined}><span className="connection-dot" />{practice ? "练习局" : "新手教程"}{waitingRoom ? ` · 房间 ${waitingRoom}` : ""}</span>
            <button className="quiet-button gm-tut-exit" type="button" onClick={practice ? onExit : leave}>退出教程</button>
          </>
        }
        themeToggle={themeToggle}
        chat={<Checklist index={index} practice={practice} waitingRoom={waitingRoom} />}
        onAction={tutorial.onCommand}
        onRematch={() => undefined}
        onAuto={() => undefined}
        onDissolve={() => undefined}
        watchId={TUTORIAL_SELF}
        onWatch={() => undefined}
        onLeave={onExit}
        selfMemberId={TUTORIAL_SELF}
        mode={practice ? "practice" : "tutorial"}
        finalHidden={!practice && index < FINAL_AT}
        onSelection={setSelection}
        {...(practice ? {
          finalActions: (
            <>
              <button className="quiet-button" type="button" onClick={onExit}>结束教程</button>
              <button className="primary-button" type="button" onClick={newPractice}>再练一局</button>
            </>
          ),
        } : {})}
      />
      {view && <Coach view={view} />}
    </div>
  );
}

/** 侧栏（真实对局里是聊天）：剧本进行中列出这次学哪几样；练习局只留一句话。 */
function Checklist({ index, practice, waitingRoom }: { index: number; practice: boolean; waitingRoom: string | undefined }) {
  const lessons = TUTORIAL_STEPS.map((step, at) => ({ step, at })).filter(({ step }) => step.lesson);
  const done = lessons.filter(({ at }) => at < index).length;
  return (
    <section className="tut-checklist" aria-label="新手教程进度">
      {practice ? (
        <>
          <h3>练习局 <small>教程学完了</small></h3>
          <p>拿不准就点「提示」（键盘 H），我告诉你我会怎么走。</p>
        </>
      ) : (
        <>
          <h3>新手教程 <small>{done}/{lessons.length}</small></h3>
          <ul>
            {lessons.map(({ step, at }) => {
              const state = at < index ? "done" : at === index ? "now" : "";
              return (
                <li key={step.id} className={state}>
                  <i aria-hidden="true">{state === "done" ? "✓" : state === "now" ? "▶" : "·"}</i>
                  {step.lesson}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {waitingRoom && <p>你还在房间 {waitingRoom} 里，房主一开局就自动回到牌桌。</p>}
    </section>
  );
}
