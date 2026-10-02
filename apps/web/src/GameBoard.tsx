import { useEffect, useMemo, useRef, useState } from "react";
import {
  GEM_COLORS,
  TOKEN_COLORS,
  getPlayerBonuses,
  getPlayerScore,
  getRemainingCost,
  type DevelopmentCard,
  type GameAction,
  type GemColor,
  type LobbyRoomSnapshot,
  type PlayerState,
  type TokenColor,
  type TokenCounts,
} from "@gem-merchant/game";
import { socket } from "./socket.js";

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

interface ReturnPrompt {
  action: GemAction;
  projected: TokenCounts;
  required: number;
}

function countTokens(tokens: TokenCounts): number {
  return TOKEN_COLORS.reduce((total, color) => total + tokens[color], 0);
}

function canAfford(player: PlayerState, card: DevelopmentCard): boolean {
  const cost = getRemainingCost(player, card);
  const missing = GEM_COLORS.reduce(
    (total, color) => total + Math.max(0, cost[color] - player.gems[color]),
    0,
  );
  return missing <= player.gems.gold;
}

type SelectedCard = {
  card: DevelopmentCard;
  source:
    | { kind: "market"; level: 1 | 2 | 3 }
    | { kind: "reserved" };
};

function TabletopView({
  game,
  player,
  isMyTurn,
  busy,
  selectedColors,
  onSelectGem,
  onTakeSelectedGems,
  onTakeTwo,
  onBuyCard,
  onReserveMarketCard,
  onReserveDeck,
}: {
  game: NonNullable<LobbyRoomSnapshot["game"]>;
  player: PlayerState;
  isMyTurn: boolean;
  busy: boolean;
  selectedColors: GemColor[];
  onSelectGem: (color: GemColor) => void;
  onTakeSelectedGems: () => void;
  onTakeTwo: (color: GemColor) => void;
  onBuyCard: (source: Extract<GameAction, { type: "buyCard" }> ["source"]) => void;
  onReserveMarketCard: (level: 1 | 2 | 3, card: DevelopmentCard) => void;
  onReserveDeck: (level: 1 | 2 | 3) => void;
}) {
  const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null);
  const closeDialogRef = useRef<HTMLButtonElement>(null);
  const differentColorsAvailable = GEM_COLORS.filter((color) => game.bank[color] > 0).length;
  const canTakeSelection = selectedColors.length > 0 && (
    differentColorsAvailable >= 3
      ? selectedColors.length === 3
      : selectedColors.length <= differentColorsAvailable
  );
  const selectedCardRemainingCost = selectedCard ? getRemainingCost(player, selectedCard.card) : undefined;
  const selectedCardMissing = selectedCard && selectedCardRemainingCost
    ? GEM_COLORS.reduce((total, color) => total + Math.max(0, selectedCardRemainingCost[color] - player.gems[color]), 0)
    : 0;
  const selectedCardCanAfford = selectedCardMissing <= player.gems.gold;
  const selectedCardIsAvailable = selectedCard
    ? selectedCard.source.kind === "market"
      ? game.market[selectedCard.source.level].some((card) => card.id === selectedCard.card.id)
      : player.reservedCards.some((card) => card.id === selectedCard.card.id)
    : false;

  useEffect(() => {
    if (!selectedCard) return;
    closeDialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedCard(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCard]);

  return (
    <div className="tabletop-scene">
      <div className="tabletop-frame">
        <div className="tabletop-felt">
          <div className="tabletop-inscription"><span>GEM MERCHANT</span><i /> <span>珍宝交易所</span></div>

          <div className="tabletop-layout">
            <aside className="tabletop-bank" aria-label="左侧公共宝石供应">
              <div className="tabletop-zone-title"><span>宝石供应</span><small>GEM BANK</small></div>
              {TOKEN_COLORS.map((color) => (
                <div className="gem-stack-wrap" key={color}>
                  <button
                    type="button"
                    className={`gem-stack ${selectedColors.includes(color as GemColor) ? "gem-stack-selected" : ""} ${game.bank[color] === 0 ? "gem-stack-empty" : ""}`}
                    onClick={() => {
                      if (isMyTurn && !busy && game.bank[color] > 0 && GEM_COLORS.includes(color as GemColor)) {
                        onSelectGem(color as GemColor);
                      }
                    }}
                    aria-label={`${color === "gold" ? "查看" : "选择或查看"}${colorNames[color]}色宝石，公共区剩余 ${game.bank[color]} 枚`}
                  >
                    <span className={`gem-stack-crystal color-${color}`} aria-hidden="true">
                      <i /><i /><i />
                    </span>
                    <span className="gem-stack-count">{game.bank[color]}</span>
                    <span className="gem-stack-name">{colorNames[color]}色</span>
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="tabletop-take-button"
                disabled={!isMyTurn || busy || !canTakeSelection}
                onClick={onTakeSelectedGems}
              >
                拿取所选 {selectedColors.length > 0 ? `· ${selectedColors.map((color) => colorNames[color]).join(" ")}` : "宝石"}
              </button>
              <p className="tabletop-bank-hint">点选不同颜色；同色拿 2 枚可在详情中操作。</p>
            </aside>

            <div className="tabletop-market-area">
              <section className="tabletop-nobles" aria-label="贵族区域">
                <div className="tabletop-zone-title"><span>贵族来访</span><small>NOBLES · 3 分</small></div>
                <div className="tabletop-noble-row">
                  {game.noblesAvailable.map((noble) => (
                    <button
                      type="button"
                      className="tabletop-noble"
                      key={noble.id}
                      title={`贵族奖励 ${noble.points} 分；需要${GEM_COLORS.filter((color) => noble.requirements[color] !== undefined).map((color) => `${colorNames[color]}色 ${noble.requirements[color]}`).join("、")}折扣`}
                      aria-label={`贵族，${noble.points}分`}
                    >
                      <span className="tabletop-noble-stone">✦</span>
                      <strong>{noble.points}<small>分</small></strong>
                      <span className="tabletop-noble-needs">
                        {GEM_COLORS.filter((color) => noble.requirements[color] !== undefined).map((color) => (
                          <i className={`color-${color}`} key={color} title={`${colorNames[color]}色 ${noble.requirements[color]}`}>
                            {colorNames[color]}{noble.requirements[color]}
                          </i>
                        ))}
                      </span>
                    </button>
                  ))}
                  {game.noblesAvailable.length === 0 && <span className="tabletop-empty-note">贵族已全部到访</span>}
                </div>
              </section>

              {([1, 2, 3] as const).map((level) => (
                <section className={`tabletop-level tabletop-level-${level}`} key={level} aria-label={`${level}级发展卡区域`}>
                  <div className="tabletop-level-heading">
                    <span className="tabletop-level-mark">0{level}</span>
                    <strong>{level} 级发展卡</strong>
                    <span>牌堆 {game.decks[level].length}</span>
                  </div>
                  <div className="tabletop-card-row">
                    {game.market[level].map((card) => {
                      const affordable = canAfford(player, card);
                      return (
                        <button
                          type="button"
                          className={`tabletop-card color-${card.bonusColor}`}
                          key={card.id}
                          onClick={() => {
                            setSelectedCard({ card, source: { kind: "market", level } });
                          }}
                          aria-label={`${level}级发展卡，${card.points}分，${colorNames[card.bonusColor]}色折扣`}
                        >
                          <span className={`tabletop-card-gem color-${card.bonusColor}`} aria-hidden="true" />
                          <span className="tabletop-card-level">{level} 级</span>
                          <strong className="tabletop-card-points">{card.points}<small>分</small></strong>
                          <span className="tabletop-card-discount">永久折扣 · {colorNames[card.bonusColor]}</span>
                          <span className="tabletop-card-cost">
                            {GEM_COLORS.filter((color) => card.cost[color] > 0).map((color) => (
                              <i className={`cost-${color}`} key={color} title={`${colorNames[color]}色费用 ${card.cost[color]}`}>
                                <b>{colorNames[color]}</b>{card.cost[color]}
                              </i>
                            ))}
                          </span>
                          <span className="tabletop-card-affordance">
                            {game.status !== "active" ? "对局已结束" : !isMyTurn ? "等待回合" : affordable ? "可购买" : "费用不足"}
                          </span>
                        </button>
                      );
                    })}
                    {game.market[level].length === 0 && <span className="tabletop-empty-note">此等级明牌已售完</span>}
                    <button
                      type="button"
                      className="tabletop-deck"
                      disabled={!isMyTurn || busy || player.reservedCards.length >= 3 || game.decks[level].length === 0 || game.status !== "active"}
                      onClick={() => onReserveDeck(level)}
                      aria-label={`暗抽并预留${level}级卡牌，剩余 ${game.decks[level].length} 张`}
                      title={`点击暗抽并预留一张${level}级卡牌；剩余 ${game.decks[level].length} 张`}
                    >
                      <span className="deck-card-back"><i>✦</i><b>G</b><i>✦</i></span>
                      <span className="deck-card-back deck-card-back-shadow" aria-hidden="true" />
                      <strong>暗抽预留</strong>
                      <small>{game.decks[level].length} 张</small>
                    </button>
                  </div>
                </section>
              ))}
            </div>

            <section className="tabletop-player-inventory" aria-label="本玩家物品信息">
              <div className="tabletop-inventory-heading">
                <div><span className="tabletop-inventory-kicker">PLAYER INVENTORY</span><h2>本玩家物品</h2></div>
                <span className="tabletop-inventory-name">{player.name}</span>
              </div>
              <div className="tabletop-inventory-stats">
                <div><span>总分</span><strong>{getPlayerScore(player)}<small>分</small></strong></div>
                <div><span>持有宝石</span><strong>{countTokens(player.gems)}<small> / 10</small></strong></div>
                <div><span>已购发展卡</span><strong>{player.purchasedCards.length}<small> 张</small></strong></div>
                <div><span>贵族</span><strong>{player.nobles.length}<small> 位</small></strong></div>
              </div>
              <div className="tabletop-inventory-gems" aria-label={`持有宝石 ${countTokens(player.gems)} / 10`}>
                {TOKEN_COLORS.map((color) => (
                  <div className="inventory-gem" key={color}>
                    <span className={`tabletop-hand-crystal color-${color}`} aria-hidden="true" />
                    <span>{colorNames[color]}</span>
                    <strong>{player.gems[color]}</strong>
                    {color !== "gold" && (
                      <button
                        type="button"
                        title={`同色拿取两枚${colorNames[color]}色宝石`}
                        aria-label={`同色拿取两枚${colorNames[color]}色宝石`}
                        disabled={!isMyTurn || busy || game.bank[color] < 4 || game.status !== "active"}
                        onClick={() => onTakeTwo(color)}
                      >+2</button>
                    )}
                  </div>
                ))}
              </div>
              <div className="tabletop-inventory-bonus">永久折扣：{GEM_COLORS.map((color) => `${colorNames[color]} ${getPlayerBonuses(player)[color]}`).join(" · ")}</div>
              <div className="tabletop-inventory-assets">
                <div className="tabletop-inventory-asset-group">
                  <div className="tabletop-inventory-subhead">已获得贵族</div>
                  <div className="tabletop-owned-nobles">
                    {player.nobles.length > 0 ? player.nobles.map((noble) => (
                      <span className="tabletop-owned-noble" key={noble.id}>✦ {noble.points} 分</span>
                    )) : <span className="tabletop-inventory-empty">尚未获得贵族</span>}
                  </div>
                </div>
                <div className="tabletop-inventory-asset-group">
                  <div className="tabletop-inventory-subhead">手牌 / 发展卡 <span>预留 {player.reservedCards.length} / 3</span></div>
                  <div className="tabletop-inventory-cards">
                    {player.purchasedCards.slice(-5).map((card) => (
                      <span className={`tabletop-inventory-card color-${card.bonusColor}`} key={card.id} title={`${card.level}级 · ${card.points}分 · ${colorNames[card.bonusColor]}色折扣`}>
                        <b>{card.points}</b><i>{colorNames[card.bonusColor]}</i>
                      </span>
                    ))}
                    {player.reservedCards.map((card) => (
                      <button
                        type="button"
                        className={`tabletop-inventory-card reserved color-${card.bonusColor}`}
                        key={card.id}
                        title={`${card.level}级预留卡，${card.points}分；点击查看并买入`}
                        onClick={() => setSelectedCard({ card, source: { kind: "reserved" } })}
                      >
                        <b>{card.points}</b><i>{colorNames[card.bonusColor]}</i><small>预留</small>
                      </button>
                    ))}
                    {player.purchasedCards.length === 0 && player.reservedCards.length === 0 && <span className="tabletop-inventory-empty">尚无发展卡</span>}
                  </div>
                </div>
              </div>
            </section>
          </div>
          <div className="tabletop-edge-mark">珍宝交易所 <span>✦</span> 自创卡组</div>
        </div>
      </div>
      <p className="tabletop-help">点击发展卡查看单卡信息和操作；点选宝石拿取。预留明牌会由牌堆补上一张新卡，预留卡只能由本人买入。</p>

      {selectedCard && (
        <div
          className="tabletop-card-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedCard(null);
          }}
        >
          <section className="tabletop-card-dialog" role="dialog" aria-modal="true" aria-labelledby="tabletop-card-dialog-title">
            <button
              ref={closeDialogRef}
              type="button"
              className="tabletop-card-dialog-close"
              onClick={() => setSelectedCard(null)}
              aria-label="关闭卡牌详情"
            >×</button>
            <div className="tabletop-card-dialog-art">
              <span className={`tabletop-card-dialog-gem color-${selectedCard.card.bonusColor}`} aria-hidden="true" />
              <span className="tabletop-card-level">{selectedCard.source.kind === "reserved" ? "你的预留卡" : `${selectedCard.card.level} 级发展卡`}</span>
              <strong>{selectedCard.card.points}<small>分</small></strong>
              <span className="tabletop-card-dialog-discount">永久折扣 · {colorNames[selectedCard.card.bonusColor]}色</span>
              <span className="tabletop-card-dialog-cost">
                {GEM_COLORS.filter((color) => selectedCard.card.cost[color] > 0).map((color) => (
                  <i className={`cost-${color}`} key={color}>
                    <b>{colorNames[color]}</b>
                    <span>费用 {selectedCard.card.cost[color]}</span>
                    <strong>需付 {selectedCardRemainingCost?.[color] ?? selectedCard.card.cost[color]}</strong>
                  </i>
                ))}
                {GEM_COLORS.every((color) => selectedCard.card.cost[color] === 0) && <span>无需支付</span>}
              </span>
            </div>
            <div className="tabletop-card-dialog-details">
              <div className="section-kicker">CARD DETAILS</div>
              <h2 id="tabletop-card-dialog-title">{selectedCard.source.kind === "reserved" ? "你的预留卡" : `${selectedCard.card.level} 级发展卡`}</h2>
              <p className="tabletop-card-dialog-summary">购买后获得 {selectedCard.card.points} 分，并永久获得一枚{colorNames[selectedCard.card.bonusColor]}色折扣。</p>
              <div className="tabletop-card-dialog-payment">
                <span>你的宝石</span>
                {TOKEN_COLORS.map((color) => (
                  <i className={`color-${color}`} key={color} title={`${colorNames[color]}色 ${player.gems[color]} 枚`}>
                    <b>{colorNames[color]}</b>{player.gems[color]}
                  </i>
                ))}
              </div>
              {!selectedCardIsAvailable ? (
                <p className="tabletop-card-dialog-status">这张卡已不在你的可购买区域。</p>
              ) : !isMyTurn ? (
                <p className="tabletop-card-dialog-status">尚未轮到你行动；可以先查看卡牌，等你的回合再操作。</p>
              ) : !selectedCardCanAfford ? (
                <p className="tabletop-card-dialog-status">还差 {Math.max(0, selectedCardMissing - player.gems.gold)} 枚普通宝石或万能宝石才能购买。</p>
              ) : (
                <p className="tabletop-card-dialog-status affordable">你当前可以购买这张卡。</p>
              )}
              <div className="tabletop-card-dialog-actions">
                <button
                  type="button"
                  className="dialog-action-buy"
                  disabled={!selectedCardIsAvailable || !isMyTurn || busy || !selectedCardCanAfford || game.status !== "active"}
                  onClick={() => {
                    onBuyCard(selectedCard.source.kind === "reserved"
                      ? { kind: "reserved", cardId: selectedCard.card.id }
                      : { kind: "market", level: selectedCard.source.level, cardId: selectedCard.card.id });
                    setSelectedCard(null);
                  }}
                >{selectedCard.source.kind === "reserved" ? "买入预留卡" : "购买卡牌"}</button>
                {selectedCard.source.kind === "market" && (
                  <button
                    type="button"
                    className="dialog-action-reserve"
                    disabled={!selectedCardIsAvailable || !isMyTurn || busy || player.reservedCards.length >= 3 || game.status !== "active"}
                    onClick={() => {
                      if (selectedCard.source.kind !== "market") return;
                      onReserveMarketCard(selectedCard.source.level, selectedCard.card);
                      setSelectedCard(null);
                    }}
                  >预留卡牌</button>
                )}
              </div>
              <p className="tabletop-card-dialog-footnote">预留后从公共市场移除，并从牌堆补入新卡；预留卡只有你可以购买。</p>
            </div>
          </section>
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
  onAction,
}: {
  room: LobbyRoomSnapshot;
  busy: boolean;
  error: string;
  notice: string;
  onAction: (action: GameAction) => void;
}) {
  const game = room.game;
  const [selectedColors, setSelectedColors] = useState<GemColor[]>([]);
  const [returnPrompt, setReturnPrompt] = useState<ReturnPrompt | null>(null);
  const [returnSelection, setReturnSelection] = useState<TokenCounts>(zeroTokens);
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
  const isMyTurn = Boolean(player && activePlayer?.id === player.id && game.status === "active");
  const pendingNobles = game.noblesAvailable.filter((noble) => game.pendingNobleIds.includes(noble.id));
  const availableDifferentColors = GEM_COLORS.filter((color) => game.bank[color] > 0).length;
  const selectionCanBeTaken = selectedColors.length > 0 && (
    availableDifferentColors >= 3
      ? selectedColors.length === 3
      : selectedColors.length <= availableDifferentColors
  );

  if (!player || !activePlayer) {
    return <section className="game-board-error">找不到当前玩家的对局席位。</section>;
  }

  const currentGame = game;
  const currentPlayer = player;

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

  function takeSelectedGems() {
    if (!selectionCanBeTaken || !isMyTurn || busy || returnPrompt) return;
    const gained = { ...zeroTokens };
    for (const color of selectedColors) gained[color] += 1;
    beginGemAction({ type: "takeGems", colors: [...selectedColors] }, gained);
    setSelectedColors([]);
  }

  function takeTwo(color: GemColor) {
    if (!isMyTurn || busy || returnPrompt || currentGame.bank[color] < 4) return;
    beginGemAction({ type: "takeGems", colors: [color, color] }, { [color]: 2 });
  }

  function reserveMarketCard(level: 1 | 2 | 3, card: DevelopmentCard) {
    if (!isMyTurn || busy || returnPrompt || currentPlayer.reservedCards.length >= 3) return;
    beginGemAction(
      { type: "reserveCard", source: { kind: "market", level, cardId: card.id } },
      currentGame.bank.gold > 0 ? { gold: 1 } : {},
    );
  }

  function reserveDeck(level: 1 | 2 | 3) {
    if (!isMyTurn || busy || returnPrompt || currentPlayer.reservedCards.length >= 3 || currentGame.decks[level].length === 0) return;
    beginGemAction(
      { type: "reserveCard", source: { kind: "deck", level } },
      currentGame.bank.gold > 0 ? { gold: 1 } : {},
    );
  }

  function selectReturn(color: TokenColor, delta: -1 | 1) {
    if (!returnPrompt) return;
    setReturnSelection((current) => {
      const next = { ...current };
      const nextValue = current[color] + delta;
      if (nextValue < 0 || nextValue > returnPrompt.projected[color]) return current;
      next[color] = nextValue;
      return next;
    });
  }

  function confirmReturn() {
    if (!returnPrompt || countTokens(returnSelection) !== returnPrompt.required) return;
    const action = { ...returnPrompt.action, returnGems: { ...returnSelection } } as GemAction;
    setReturnPrompt(null);
    onAction(action);
  }

  function buyCard(source: Extract<GameAction, { type: "buyCard" }> ["source"]) {
    if (!isMyTurn || busy || returnPrompt) return;
    onAction({ type: "buyCard", source });
  }

  const winnerNames = game.winnerIds
    .map((winnerId) => game.players.find((candidate) => candidate.id === winnerId)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <section className="table-layout tabletop-mode">
      <div className="table-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> 房间 {room.code}</div>
        </div>
        <div className={isMyTurn ? "turn-indicator my-turn" : "turn-indicator"}>
          <span className="turn-dot" />
          {game.status === "finished" ? "对局结束" : isMyTurn ? "轮到你行动" : `等待 ${activePlayer.name}`}
        </div>
      </div>

      <div className="tabletop-frame opponent-frame">
        <div className="tabletop-felt opponent-felt">
          <div className="tabletop-zone-title"><span>其他玩家</span><small>RIVAL MERCHANTS</small></div>
          <div className="opponent-strip" aria-label="玩家状态">
            {game.players.filter((candidate) => candidate.id !== player.id).map((candidate) => {
              const member = room.members.find((item) => item.id === candidate.id);
              const bonuses = getPlayerBonuses(candidate);
              return (
                <div className={candidate.id === activePlayer.id ? "opponent-card active-player" : "opponent-card"} key={candidate.id}>
                  <div className="opponent-avatar">{candidate.name.slice(0, 1).toUpperCase()}</div>
                  <div className="opponent-info">
                    <strong>{candidate.name}</strong>
                    <span>{candidate.purchasedCards.length} 张发展卡 · {candidate.reservedCards.length} 张预留</span>
                  </div>
                  <div className="opponent-bonuses" aria-label="各色折扣">
                    {GEM_COLORS.map((color) => (
                      <span className={`bonus-dot color-${color}`} key={color} title={`${colorNames[color]}色折扣 ${bonuses[color]}`}>
                        {bonuses[color] || "·"}
                      </span>
                    ))}
                  </div>
                  <div className="opponent-score"><strong>{scores.get(candidate.id) ?? 0}</strong><span>分</span></div>
                  <div className="opponent-gem-counts" aria-label={`${candidate.name}持有的宝石数量`}>
                    {TOKEN_COLORS.map((color) => (
                      <span className="opponent-gem-count" key={color} title={`${colorNames[color]}色宝石 ${candidate.gems[color]} 枚`}>
                        <i className={`tabletop-hand-crystal color-${color}`} aria-hidden="true" />
                        <span>{colorNames[color]}</span>
                        <strong>{candidate.gems[color]}</strong>
                      </span>
                    ))}
                  </div>
                  {member?.connected === false && <span className="offline-tag">离线</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {game.status === "finished" ? (
        <div className="result-banner" role="status">
          <span className="result-kicker">本局获胜</span>
          <strong>{winnerNames.join("、") || "平局"}</strong>
          <span>恭喜赢得这场交易。</span>
        </div>
      ) : null}

      <TabletopView
        game={game}
        player={player}
        isMyTurn={isMyTurn}
        busy={busy || Boolean(returnPrompt)}
        selectedColors={selectedColors}
        onSelectGem={(color) => setSelectedColors((current) => current.includes(color)
          ? current.filter((selected) => selected !== color)
          : current.length < 3 ? [...current, color] : current)}
        onTakeSelectedGems={takeSelectedGems}
        onTakeTwo={takeTwo}
        onBuyCard={buyCard}
        onReserveMarketCard={reserveMarketCard}
        onReserveDeck={reserveDeck}
      />

      {returnPrompt && (
        <section className="return-panel" aria-labelledby="return-heading">
          <div className="return-panel-copy">
            <span className="section-kicker">资源上限</span>
            <h2 id="return-heading">请选择归还的宝石</h2>
            <p>本次行动后超过 10 枚，需要归还 {returnPrompt.required} 枚。已选 {countTokens(returnSelection)} 枚。</p>
          </div>
          <div className="return-controls">
            {TOKEN_COLORS.map((color) => (
              <div className="return-control" key={color}>
                <span className={`token-orb color-${color}`} />
                <span>{colorNames[color]}</span>
                <button type="button" onClick={() => selectReturn(color, -1)} disabled={returnSelection[color] === 0} aria-label={`少还一枚${colorNames[color]}色宝石`}>−</button>
                <strong>{returnSelection[color]}</strong>
                <button type="button" onClick={() => selectReturn(color, 1)} disabled={returnSelection[color] >= returnPrompt.projected[color]} aria-label={`多还一枚${colorNames[color]}色宝石`}>＋</button>
              </div>
            ))}
          </div>
          <div className="return-panel-actions">
            <button type="button" className="quiet-button" onClick={() => setReturnPrompt(null)}>取消行动</button>
            <button type="button" className="primary-button" onClick={confirmReturn} disabled={busy || countTokens(returnSelection) !== returnPrompt.required}>确认并继续</button>
          </div>
        </section>
      )}

      {pendingNobles.length > 0 && game.status === "active" && isMyTurn && (
        <section className="noble-choice-panel" aria-labelledby="noble-choice-heading">
          <div><span className="section-kicker">回合奖励</span><h2 id="noble-choice-heading">请选择一位到访贵族</h2></div>
          <div className="noble-choice-list">
            {pendingNobles.map((noble) => (
              <button type="button" key={noble.id} disabled={busy} onClick={() => onAction({ type: "chooseNoble", nobleId: noble.id })}>
                <span>✦</span>{noble.points} 分
                <small>{GEM_COLORS.filter((color) => noble.requirements[color] !== undefined).map((color) => `${colorNames[color]}${noble.requirements[color]}`).join(" · ")}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {error && <p className="feedback feedback-error board-feedback" role="alert">{error}</p>}
      {notice && <p className="feedback feedback-success board-feedback" role="status">{notice}</p>}
      {!isMyTurn && game.status === "active" && <p className="board-wait-note">等待 {activePlayer.name} 完成本回合。</p>}
    </section>
  );
}

export default GameBoard;
