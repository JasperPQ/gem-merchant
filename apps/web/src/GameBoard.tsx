import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  GEM_COLORS,
  TOKEN_COLORS,
  getPlayerBonuses,
  getPlayerScore,
  getRemainingCost,
  type DevelopmentCard,
  type GameAction,
  type GemColor,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type Noble,
  type PlayerState,
  type TokenColor,
  type TokenCounts,
} from "@gem-merchant/game";
import GameRules from "./GameRules.js";
import { socket } from "./socket.js";
import { useGameSounds, useSoundSetting } from "./sound.js";
import "./game.css";

// 颜色名只用于悬停提示和读屏，界面上用颜色本身表达。
const colorNames: Record<TokenColor, string> = {
  white: "白",
  blue: "蓝",
  green: "绿",
  red: "红",
  black: "黑",
  gold: "金",
};

const zeroTokens: TokenCounts = { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 };

type GemAction = Extract<GameAction, { type: "takeGems" | "reserveCard" }>;
type BuySource = Extract<GameAction, { type: "buyCard" }>["source"];
type GameView = NonNullable<LobbyRoomSnapshot["game"]>;

interface ConfirmPrompt {
  title: string;
  detail: string;
  preview: ReactNode;
  onConfirm: () => void;
}

interface ReturnPrompt {
  action: GemAction;
  projected: TokenCounts;
  required: number;
}

type SelectedCard = {
  card: DevelopmentCard;
  source:
    | { kind: "market"; level: 1 | 2 | 3 }
    | { kind: "reserved" };
};

function countTokens(tokens: TokenCounts): number {
  return TOKEN_COLORS.reduce((total, color) => total + tokens[color], 0);
}

function missingGems(player: PlayerState, card: DevelopmentCard): number {
  const cost = getRemainingCost(player, card);
  return GEM_COLORS.reduce((total, color) => total + Math.max(0, cost[color] - player.gems[color]), 0);
}

function canAfford(player: PlayerState, card: DevelopmentCard): boolean {
  return missingGems(player, card) <= player.gems.gold;
}

function costText(cost: Partial<Record<GemColor, number>>): string {
  return GEM_COLORS.filter((color) => (cost[color] ?? 0) > 0).map((color) => `${colorNames[color]}${cost[color]}`).join(" ") || "无";
}

function cardLabel(card: DevelopmentCard): string {
  return `${card.level}级土地 · ${card.points}分 · ${colorNames[card.bonusColor]}色抵扣 · 费用 ${costText(card.cost)}`;
}

function nobleLabel(noble: Noble): string {
  return `贵族 ${noble.points}分 · 需要土地 ${costText(noble.requirements)}`;
}

function LevelDots({ level }: { level: number }) {
  return (
    <span className="gm-level" aria-hidden="true">
      {Array.from({ length: level }, (_, index) => <i key={index} />)}
    </span>
  );
}

/** 土地卡：背景色即永久抵扣色，左上分数、右上等级点、左下费用。 */
function CardFace({
  card,
  affordable = false,
  mini = false,
  onClick,
}: {
  card: DevelopmentCard;
  affordable?: boolean;
  mini?: boolean;
  onClick?: () => void;
}) {
  const className = `gm-card gm-c-${card.bonusColor}${affordable ? " gm-affordable" : ""}${mini ? " gm-card-mini" : ""}`;
  const content = (
    <>
      <span className="gm-card-top">
        <b className="gm-card-points">{card.points > 0 ? card.points : ""}</b>
        <LevelDots level={card.level} />
      </span>
      {!mini && (
        <span className="gm-card-cost">
          {GEM_COLORS.filter((color) => card.cost[color] > 0).map((color) => (
            <i className={`gm-pip gm-c-${color}`} key={color}>{card.cost[color]}</i>
          ))}
        </span>
      )}
    </>
  );
  const label = cardLabel(card);
  return onClick ? (
    <button type="button" className={className} onClick={onClick} title={label} aria-label={label}>{content}</button>
  ) : (
    <span className={className} title={label} role="img" aria-label={label}>{content}</span>
  );
}

function HiddenCard({ level, mini = false }: { level: number; mini?: boolean }) {
  const label = `${level}级暗抽预留卡，内容不可见`;
  return (
    <span className={`gm-card gm-card-back${mini ? " gm-card-mini" : ""}`} title={label} role="img" aria-label={label}>
      <span className="gm-card-top"><b /><LevelDots level={level} /></span>
    </span>
  );
}

function NobleTile({ noble }: { noble: Noble }) {
  const label = nobleLabel(noble);
  return (
    <span className="gm-noble" title={label} role="img" aria-label={label}>
      <b>{noble.points}</b>
      <span className="gm-noble-needs">
        {GEM_COLORS.filter((color) => noble.requirements[color] !== undefined).map((color) => (
          <i className={`gm-need gm-c-${color}`} key={color}>{noble.requirements[color]}</i>
        ))}
      </span>
    </span>
  );
}

/** 每种颜色一列：上方土地数（卡形），下方宝石数（圆形）。 */
function Holdings({ player, size }: { player: PlayerState; size: "large" | "small" }) {
  const lands = getPlayerBonuses(player);
  return (
    <div className={`gm-holdings gm-holdings-${size}`}>
      {TOKEN_COLORS.map((color) => {
        const land = color === "gold" ? null : lands[color];
        const label = color === "gold"
          ? `金色万能宝石 ${player.gems.gold} 枚`
          : `${colorNames[color]}色：土地 ${land} 块，宝石 ${player.gems[color]} 枚`;
        return (
          <span className="gm-holding" key={color} title={label} aria-label={label}>
            {land === null
              ? <span className="gm-land gm-land-empty" aria-hidden="true" />
              : <span className={`gm-land gm-c-${color}${land === 0 ? " gm-zero" : ""}`} aria-hidden="true">{land}</span>}
            <span className={`gm-token gm-c-${color}${player.gems[color] === 0 ? " gm-zero" : ""}`} aria-hidden="true">{player.gems[color]}</span>
          </span>
        );
      })}
    </div>
  );
}

/** 服务端发来的剩余毫秒数换算成本地截止时间，每次收到新快照时重新校准。 */
function useCountdown(remainingMs: number | undefined, syncKey: unknown): number {
  const [deadline, setDeadline] = useState(() => Date.now() + (remainingMs ?? 0));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setDeadline(Date.now() + (remainingMs ?? 0));
    setNow(Date.now());
  }, [remainingMs, syncKey]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

function TurnTimer({ seconds }: { seconds: number }) {
  return (
    <span className={`gm-turn-timer${seconds <= 10 ? " gm-turn-timer-low" : ""}`} title="本回合剩余行动时间" aria-label={`本回合剩余 ${seconds} 秒`}>
      {seconds}s
    </span>
  );
}

function RivalPanel({
  player,
  member,
  score,
  active,
  secondsLeft,
}: {
  player: PlayerState;
  member: LobbyMember | undefined;
  score: number;
  active: boolean;
  secondsLeft: number;
}) {
  const offline = member?.connected === false;
  return (
    <article className={`gm-rival${active ? " gm-rival-active" : ""}${offline ? " gm-rival-offline" : ""}`}>
      <header className="gm-rival-head">
        <span className="gm-avatar">{player.name.slice(0, 1).toUpperCase()}</span>
        <strong className="gm-rival-name">{player.name}</strong>
        {offline && <span className="gm-offline" title="离线">离线</span>}
        {active && <TurnTimer seconds={secondsLeft} />}
        <span className="gm-score" title={`${score} 分`}>{score}</span>
      </header>
      <Holdings player={player} size="small" />
      {(player.reservedCards.length > 0 || player.nobles.length > 0) && (
        <div className="gm-rival-extras">
          {player.reservedCards.map((card) => player.hiddenReservedCardIds.includes(card.id)
            ? <HiddenCard level={card.level} mini key={card.id} />
            : <CardFace card={card} mini key={card.id} />)}
          {player.nobles.map((noble) => (
            <span className="gm-noble-mini" key={noble.id} title={nobleLabel(noble)}>{noble.points}</span>
          ))}
        </div>
      )}
    </article>
  );
}

function CardDialog({
  selected,
  game,
  player,
  isMyTurn,
  busy,
  onClose,
  onBuy,
  onReserve,
}: {
  selected: SelectedCard;
  game: GameView;
  player: PlayerState;
  isMyTurn: boolean;
  busy: boolean;
  onClose: () => void;
  onBuy: (source: BuySource) => void;
  onReserve: (level: 1 | 2 | 3, card: DevelopmentCard) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { card, source } = selected;
  const remaining = getRemainingCost(player, card);
  const shortfall = Math.max(0, missingGems(player, card) - player.gems.gold);
  const available = source.kind === "market"
    ? game.market[source.level].some((candidate) => candidate.id === card.id)
    : player.reservedCards.some((candidate) => candidate.id === card.id);
  const active = game.status === "active";

  useEffect(() => {
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="gm-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="gm-card-dialog" role="dialog" aria-modal="true" aria-labelledby="gm-card-dialog-title">
        <button ref={closeRef} type="button" className="gm-dialog-close" onClick={onClose} aria-label="关闭卡牌详情">×</button>
        <div className="gm-card-dialog-art"><CardFace card={card} /></div>
        <div className="gm-card-dialog-body">
          <h2 id="gm-card-dialog-title">{source.kind === "reserved" ? "你的预留卡" : `${card.level} 级土地`}</h2>
          <div className="gm-dialog-row" title="扣除你已有土地后，还需支付的宝石">
            <span>需付</span>
            {GEM_COLORS.some((color) => remaining[color] > 0)
              ? GEM_COLORS.filter((color) => remaining[color] > 0).map((color) => (
                <i className={`gm-pip gm-c-${color}`} key={color}>{remaining[color]}</i>
              ))
              : <em>免费</em>}
          </div>
          <div className="gm-dialog-row">
            <span>持有</span>
            {TOKEN_COLORS.map((color) => (
              <i className={`gm-pip gm-c-${color}${player.gems[color] === 0 ? " gm-zero" : ""}`} key={color}>{player.gems[color]}</i>
            ))}
          </div>
          <p className={`gm-dialog-status${available && isMyTurn && shortfall === 0 ? " ok" : ""}`}>
            {!available ? "这张卡已不在可购买区域。"
              : !active ? "对局已结束。"
              : !isMyTurn ? "还没轮到你，可以先看看。"
              : shortfall > 0 ? `还差 ${shortfall} 枚宝石。`
              : "可以购买。"}
          </p>
          <div className="gm-dialog-actions">
            <button
              type="button"
              className="primary-button"
              disabled={!available || !isMyTurn || busy || shortfall > 0 || !active}
              onClick={() => {
                onBuy(source.kind === "reserved"
                  ? { kind: "reserved", cardId: card.id }
                  : { kind: "market", level: source.level, cardId: card.id });
                onClose();
              }}
            >购买</button>
            {source.kind === "market" && (
              <button
                type="button"
                className="quiet-button"
                disabled={!available || !isMyTurn || busy || player.reservedCards.length >= 3 || !active}
                onClick={() => {
                  onReserve(source.level, card);
                  onClose();
                }}
              >预留</button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/** 整轮结束后的继续投票：倒计时、已确认的玩家、继续/退出按钮。 */
function RematchPanel({ room, winnerNames, onRematch }: {
  room: LobbyRoomSnapshot;
  winnerNames: string[];
  onRematch: (accept: boolean) => void;
}) {
  const rematch = room.rematch;
  const secondsLeft = useCountdown(rematch?.remainingMs, room);
  const accepted = new Set(rematch?.acceptedIds ?? []);
  const myVote = accepted.has(socket.id ?? "");

  return (
    <div className="gm-result" role="dialog" aria-labelledby="gm-result-title">
      <span>本局获胜</span>
      <strong id="gm-result-title">{winnerNames.join("、") || "平局"}</strong>
      {rematch && (
        <div className="gm-rematch">
          <p>再来一局？{secondsLeft} 秒内未确认视为退出。</p>
          <div className="gm-rematch-votes">
            {room.members.map((member) => (
              <span className={accepted.has(member.id) ? "gm-vote yes" : "gm-vote"} key={member.id}>
                {member.name}{accepted.has(member.id) ? " ✓" : ""}
              </span>
            ))}
          </div>
          <div className="gm-panel-actions">
            <button type="button" className="quiet-button" onClick={() => onRematch(false)}>退出房间</button>
            <button type="button" className="primary-button" disabled={myVote} onClick={() => onRematch(true)}>
              {myVote ? "等待其他玩家" : "继续下一局"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function GameBoard({
  room,
  busy,
  error,
  notice,
  brand,
  connection,
  chat,
  onAction,
  onRematch,
  onDissolve,
}: {
  room: LobbyRoomSnapshot;
  busy: boolean;
  error: string;
  notice: string;
  brand: ReactNode;
  connection: ReactNode;
  chat: ReactNode;
  onAction: (action: GameAction) => void;
  onRematch: (accept: boolean) => void;
  onDissolve: () => void;
}) {
  const game = room.game;
  const [selectedColors, setSelectedColors] = useState<GemColor[]>([]);
  const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null);
  const [returnPrompt, setReturnPrompt] = useState<ReturnPrompt | null>(null);
  const [returnSelection, setReturnSelection] = useState<TokenCounts>(zeroTokens);
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmPrompt | null>(null);
  const turnSecondsLeft = useCountdown(room.turnRemainingMs, room);
  const [soundOn, toggleSound] = useSoundSetting();
  const myTurnNow = game?.status === "active" && game.players[game.activePlayerIndex]?.id === socket.id;
  useGameSounds(game, socket.id, myTurnNow, turnSecondsLeft);
  const scores = useMemo(
    () => new Map((game?.players ?? []).map((candidate) => [candidate.id, getPlayerScore(candidate)])),
    [game?.players],
  );

  useEffect(() => {
    if (!game) return;
    setSelectedColors([]);
    setReturnPrompt(null);
    setReturnSelection({ ...zeroTokens });
  }, [game?.activePlayerIndex, game?.pendingNobleIds.length, game?.status]);

  if (!game) {
    return <section className="game-board-error">对局状态暂时不可用，请重新进入房间。</section>;
  }

  const player = game.players.find((candidate) => candidate.id === socket.id);
  const activePlayer = game.players[game.activePlayerIndex];
  if (!player || !activePlayer) {
    return <section className="game-board-error">找不到当前玩家的对局席位。</section>;
  }

  const currentGame = game;
  const currentPlayer = player;
  const active = game.status === "active";
  const isMyTurn = activePlayer.id === player.id && active;
  const actionLocked = !isMyTurn || busy || Boolean(returnPrompt);
  const pendingNobles = game.noblesAvailable.filter((noble) => game.pendingNobleIds.includes(noble.id));
  const availableDifferentColors = GEM_COLORS.filter((color) => game.bank[color] > 0).length;
  const selectionCanBeTaken = selectedColors.length > 0 && (
    availableDifferentColors >= 3
      ? selectedColors.length === 3
      : selectedColors.length <= availableDifferentColors
  );
  const winnerNames = game.winnerIds
    .map((winnerId) => game.players.find((candidate) => candidate.id === winnerId)?.name)
    .filter((name): name is string => Boolean(name));

  function beginGemAction(action: GemAction, gained: Partial<TokenCounts>) {
    const projected = { ...currentPlayer.gems };
    for (const color of TOKEN_COLORS) projected[color] += gained[color] ?? 0;
    const required = Math.max(0, countTokens(projected) - 10);
    if (required > 0) {
      setReturnPrompt({ action, projected, required });
      setReturnSelection({ ...zeroTokens });
      return;
    }
    setReturnPrompt(null);
    onAction(action);
  }

  function toggleGem(color: GemColor) {
    if (actionLocked || currentGame.bank[color] === 0) return;
    setSelectedColors((current) => current.includes(color)
      ? current.filter((selected) => selected !== color)
      : current.length < 3 ? [...current, color] : current);
  }

  function takeSelectedGems() {
    if (!selectionCanBeTaken || actionLocked) return;
    const gained = { ...zeroTokens };
    for (const color of selectedColors) gained[color] += 1;
    beginGemAction({ type: "takeGems", colors: [...selectedColors] }, gained);
    setSelectedColors([]);
  }

  function takeTwo(color: GemColor) {
    if (actionLocked || currentGame.bank[color] < 4) return;
    setConfirmPrompt({
      title: "拿 2 枚同色宝石？",
      detail: `拿取 2 枚${colorNames[color]}色宝石，本回合结束。`,
      preview: <><span className={`gm-token gm-c-${color}`}>2</span></>,
      onConfirm: () => beginGemAction({ type: "takeGems", colors: [color, color] }, { [color]: 2 }),
    });
  }

  function reserveMarketCard(level: 1 | 2 | 3, card: DevelopmentCard) {
    if (actionLocked || currentPlayer.reservedCards.length >= 3) return;
    beginGemAction(
      { type: "reserveCard", source: { kind: "market", level, cardId: card.id } },
      currentGame.bank.gold > 0 ? { gold: 1 } : {},
    );
  }

  function reserveDeck(level: 1 | 2 | 3) {
    if (actionLocked || currentPlayer.reservedCards.length >= 3 || currentGame.decks[level].length === 0) return;
    const gainsGold = currentGame.bank.gold > 0;
    setConfirmPrompt({
      title: `暗抽预留 ${level} 级土地？`,
      detail: `从 ${level} 级牌堆顶暗抽一张加入你的预留区（其他玩家看不到内容）${gainsGold ? "，并获得 1 枚金色宝石" : "；金色宝石已拿完，本次不获得"}。`,
      preview: (
        <>
          <span className="gm-card gm-card-back gm-confirm-card"><span className="gm-card-top"><b /><LevelDots level={level} /></span></span>
          {gainsGold && <span className="gm-token gm-c-gold">+1</span>}
        </>
      ),
      onConfirm: () => beginGemAction(
        { type: "reserveCard", source: { kind: "deck", level } },
        gainsGold ? { gold: 1 } : {},
      ),
    });
  }

  function buyCard(source: BuySource) {
    if (actionLocked) return;
    onAction({ type: "buyCard", source });
  }

  function selectReturn(color: TokenColor, delta: -1 | 1) {
    if (!returnPrompt) return;
    setReturnSelection((current) => {
      const nextValue = current[color] + delta;
      if (nextValue < 0 || nextValue > returnPrompt.projected[color]) return current;
      return { ...current, [color]: nextValue };
    });
  }

  function confirmReturn() {
    if (!returnPrompt || countTokens(returnSelection) !== returnPrompt.required) return;
    const action = { ...returnPrompt.action, returnGems: { ...returnSelection } } as GemAction;
    setReturnPrompt(null);
    onAction(action);
  }

  const rivals = game.players.filter((candidate) => candidate.id !== player.id);
  const turnText = !active ? "对局结束" : isMyTurn ? "轮到你行动" : `等待 ${activePlayer.name}`;

  return (
    <div className="game-screen">
      <header className="gm-topbar">
        {brand}
        <span className="gm-room-code" title="房间码">{room.code}</span>
        <span className={isMyTurn ? "turn-indicator my-turn" : "turn-indicator"}>
          <span className="turn-dot" />{turnText}{active && ` · ${turnSecondsLeft}s`}
        </span>
        <span className="gm-feedback" role="status">
          {error ? <span className="gm-feedback-error">{error}</span> : notice}
        </span>
        <button
          type="button"
          className={`gm-sound-toggle${soundOn ? "" : " off"}`}
          onClick={toggleSound}
          aria-pressed={soundOn}
          title={soundOn ? "关闭游戏音效" : "开启游戏音效"}
        >{soundOn ? "🔊 音效" : "🔇 音效"}</button>
        <GameRules />
        {room.members.find((member) => member.id === socket.id)?.isHost && (
          <button type="button" className="gm-dissolve" onClick={onDissolve}>解散房间</button>
        )}
        {connection}
      </header>

      <aside className="gm-rivals" aria-label="其他玩家">
        {rivals.map((candidate) => (
          <RivalPanel
            key={candidate.id}
            player={candidate}
            member={room.members.find((item) => item.id === candidate.id)}
            score={scores.get(candidate.id) ?? 0}
            active={active && candidate.id === activePlayer.id}
            secondsLeft={turnSecondsLeft}
          />
        ))}
      </aside>

      <section className="gm-table" aria-label="公共区域">
        <div className="gm-table-inner">
          <div className="gm-bank" aria-label="宝石供应">
            {TOKEN_COLORS.map((color) => {
              const isGem = color !== "gold";
              const selected = isGem && selectedColors.includes(color);
              const count = game.bank[color];
              return (
                <div className="gm-bank-slot" key={color}>
                  <button
                    type="button"
                    className={`gm-token gm-bank-token gm-c-${color}${selected ? " gm-selected" : ""}${count === 0 ? " gm-zero" : ""}`}
                    disabled={!isGem || actionLocked || count === 0}
                    onClick={() => isGem && toggleGem(color)}
                    title={isGem ? `${colorNames[color]}色宝石，剩余 ${count} 枚；点击选择` : `金色万能宝石，剩余 ${count} 枚（预留卡牌时获得）`}
                    aria-label={`${colorNames[color]}色宝石，剩余 ${count} 枚`}
                    aria-pressed={isGem ? selected : undefined}
                  >{count}</button>
                  {isGem && (
                    <button
                      type="button"
                      className="gm-take-two"
                      disabled={actionLocked || count < 4}
                      onClick={() => takeTwo(color)}
                      title={`拿 2 枚${colorNames[color]}色宝石（需剩余至少 4 枚）`}
                      aria-label={`拿 2 枚${colorNames[color]}色宝石`}
                    >+2</button>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              className="gm-take-button"
              disabled={actionLocked || !selectionCanBeTaken}
              onClick={takeSelectedGems}
              title="拿取所选的不同颜色宝石"
            >
              拿取
              <span className="gm-take-preview" aria-hidden="true">
                {selectedColors.map((color) => <i className={`gm-c-${color}`} key={color} />)}
              </span>
            </button>
          </div>

          <div className="gm-market">
            <div className="gm-row gm-nobles" aria-label="贵族">
              {game.noblesAvailable.map((noble) => <NobleTile noble={noble} key={noble.id} />)}
            </div>
            {([3, 2, 1] as const).map((level) => (
              <div className="gm-row" key={level} aria-label={`${level}级土地`}>
                <button
                  type="button"
                  className={`gm-card gm-card-back gm-deck${game.decks[level].length === 0 ? " gm-zero" : ""}`}
                  disabled={actionLocked || player.reservedCards.length >= 3 || game.decks[level].length === 0}
                  onClick={() => reserveDeck(level)}
                  title={`${level}级牌堆剩余 ${game.decks[level].length} 张；点击暗抽预留一张`}
                  aria-label={`暗抽预留${level}级土地，剩余 ${game.decks[level].length} 张`}
                >
                  <span className="gm-card-top"><b /><LevelDots level={level} /></span>
                  <span className="gm-deck-count">{game.decks[level].length}</span>
                </button>
                {game.market[level].map((card) => (
                  <CardFace
                    key={card.id}
                    card={card}
                    affordable={active && canAfford(player, card)}
                    onClick={() => setSelectedCard({ card, source: { kind: "market", level } })}
                  />
                ))}
                {Array.from({ length: Math.max(0, 4 - game.market[level].length) }, (_, index) => (
                  <span className="gm-card gm-card-slot" key={`empty-${index}`} aria-hidden="true" />
                ))}
              </div>
            ))}
          </div>
        </div>

        {!active && <RematchPanel room={room} winnerNames={winnerNames} onRematch={onRematch} />}
      </section>

      <section className={`gm-me${isMyTurn ? " gm-me-turn" : ""}`} aria-label="你的物品">
        <div className="gm-me-ident">
          <strong className="gm-me-name">{player.name}</strong>
          <span className="gm-score gm-score-large" title={`${scores.get(player.id) ?? 0} 分`}>{scores.get(player.id) ?? 0}</span>
          <span className="gm-gem-total" title="持有宝石总数 / 上限">{countTokens(player.gems)}/10</span>
          {isMyTurn && <TurnTimer seconds={turnSecondsLeft} />}
        </div>
        <Holdings player={player} size="large" />
        <div className="gm-me-reserved" aria-label={`预留卡 ${player.reservedCards.length} / 3`}>
          {player.reservedCards.map((card) => (
            <CardFace
              key={card.id}
              card={card}
              affordable={active && canAfford(player, card)}
              onClick={() => setSelectedCard({ card, source: { kind: "reserved" } })}
            />
          ))}
          {Array.from({ length: 3 - player.reservedCards.length }, (_, index) => (
            <span className="gm-card gm-card-slot" key={`slot-${index}`} title="空的预留位" aria-hidden="true" />
          ))}
        </div>
        {player.nobles.length > 0 && (
          <div className="gm-me-nobles">
            {player.nobles.map((noble) => <NobleTile noble={noble} key={noble.id} />)}
          </div>
        )}
      </section>

      <div className="gm-chat">{chat}</div>

      {selectedCard && (
        <CardDialog
          selected={selectedCard}
          game={game}
          player={player}
          isMyTurn={isMyTurn}
          busy={busy || Boolean(returnPrompt)}
          onClose={() => setSelectedCard(null)}
          onBuy={buyCard}
          onReserve={reserveMarketCard}
        />
      )}

      {confirmPrompt && (
        <div
          className="gm-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmPrompt(null);
          }}
        >
          <section className="gm-panel gm-confirm" role="dialog" aria-modal="true" aria-labelledby="gm-confirm-title">
            <h2 id="gm-confirm-title">{confirmPrompt.title}</h2>
            <div className="gm-confirm-preview" aria-hidden="true">{confirmPrompt.preview}</div>
            <p>{confirmPrompt.detail}</p>
            <div className="gm-panel-actions">
              <button type="button" className="quiet-button" onClick={() => setConfirmPrompt(null)}>取消</button>
              <button
                type="button"
                className="primary-button"
                autoFocus
                onClick={() => {
                  const confirmed = confirmPrompt;
                  setConfirmPrompt(null);
                  confirmed.onConfirm();
                }}
              >确认</button>
            </div>
          </section>
        </div>
      )}

      {returnPrompt && (
        <div className="gm-modal-backdrop">
          <section className="gm-panel" role="dialog" aria-modal="true" aria-labelledby="return-heading">
            <h2 id="return-heading">归还宝石</h2>
            <p>超过 10 枚，需归还 {returnPrompt.required} 枚（已选 {countTokens(returnSelection)}）。</p>
            <div className="gm-return-controls">
              {TOKEN_COLORS.map((color) => (
                <div className="gm-return-control" key={color}>
                  <button type="button" onClick={() => selectReturn(color, 1)} disabled={returnSelection[color] >= returnPrompt.projected[color]} aria-label={`多还一枚${colorNames[color]}色宝石`}>＋</button>
                  <span className={`gm-token gm-c-${color}${returnPrompt.projected[color] === 0 ? " gm-zero" : ""}`} title={`持有 ${returnPrompt.projected[color]} 枚`}>{returnSelection[color]}</span>
                  <button type="button" onClick={() => selectReturn(color, -1)} disabled={returnSelection[color] === 0} aria-label={`少还一枚${colorNames[color]}色宝石`}>−</button>
                </div>
              ))}
            </div>
            <div className="gm-panel-actions">
              <button type="button" className="quiet-button" onClick={() => setReturnPrompt(null)}>取消</button>
              <button type="button" className="primary-button" onClick={confirmReturn} disabled={busy || countTokens(returnSelection) !== returnPrompt.required}>确认</button>
            </div>
          </section>
        </div>
      )}

      {pendingNobles.length > 0 && active && isMyTurn && (
        <div className="gm-modal-backdrop">
          <section className="gm-panel" role="dialog" aria-modal="true" aria-labelledby="noble-choice-heading">
            <h2 id="noble-choice-heading">选择一位到访贵族</h2>
            <div className="gm-noble-choices">
              {pendingNobles.map((noble) => (
                <button type="button" key={noble.id} disabled={busy} onClick={() => onAction({ type: "chooseNoble", nobleId: noble.id })}>
                  <NobleTile noble={noble} />
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default GameBoard;
