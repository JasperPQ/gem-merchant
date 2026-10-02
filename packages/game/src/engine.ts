import {
	CARD_LEVELS,
	GEM_COLORS,
	TOKEN_COLORS,
	type CardLevel,
	type ColorCounts,
	type Decks,
	type DevelopmentCard,
	type GameAction,
	type GameState,
	type GemColor,
	type Noble,
	type PlayerDefinition,
	type PlayerState,
	type RuleErrorCode,
	type TokenCounts,
	RuleViolation,
} from "./types.js";

const GEM_LIMIT = 10;
const RESERVED_CARD_LIMIT = 3;

function fail(code: RuleErrorCode, message: string): never {
	throw new RuleViolation(code, message);
}

function zeroTokenCounts(): TokenCounts {
	return { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
}

function emptyMarket(): GameState["market"] {
	return { 1: [], 2: [], 3: [] };
}

function emptyDecks(): Decks {
	return { 1: [], 2: [], 3: [] };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
	const result = [...items];
	for (let index = result.length - 1; index > 0; index -= 1) {
		const value = random();
		if (!Number.isFinite(value) || value < 0 || value >= 1) {
			fail("INVALID_GAME_DATA", "Random source must return a value in [0, 1).");
		}
		const swapIndex = Math.floor(value * (index + 1));
		[result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
	}
	return result;
}

function totalTokens(gems: TokenCounts): number {
	return TOKEN_COLORS.reduce((total, color) => total + gems[color], 0);
}

function validateGameData(cards: readonly DevelopmentCard[], nobles: readonly Noble[]): void {
	const cardIds = new Set<string>();
	for (const card of cards) {
		if (
			!card.id ||
			cardIds.has(card.id) ||
			!CARD_LEVELS.includes(card.level) ||
			!GEM_COLORS.includes(card.bonusColor) ||
			!Number.isInteger(card.points) ||
			card.points < 0
		) {
			fail("INVALID_GAME_DATA", `Invalid development card: ${card.id || "<no id>"}.`);
		}
		cardIds.add(card.id);
		for (const color of GEM_COLORS) {
			if (!Number.isInteger(card.cost[color]) || card.cost[color] < 0) {
				fail("INVALID_GAME_DATA", `Invalid ${color} cost on card ${card.id}.`);
			}
		}
	}

	const nobleIds = new Set<string>();
	for (const noble of nobles) {
		const requirements = Object.entries(noble.requirements);
		if (
			!noble.id ||
			nobleIds.has(noble.id) ||
			!Number.isInteger(noble.points) ||
			noble.points < 0 ||
			requirements.length === 0
		) {
			fail("INVALID_GAME_DATA", `Invalid noble: ${noble.id || "<no id>"}.`);
		}
		nobleIds.add(noble.id);
		for (const [color, count] of requirements) {
			if (
				!GEM_COLORS.includes(color as GemColor) ||
				!Number.isInteger(count) ||
				count < 1
			) {
				fail("INVALID_GAME_DATA", `Invalid requirement on noble ${noble.id}.`);
			}
		}
	}
}

export function createGame(
	playerDefinitions: readonly PlayerDefinition[],
	cards: readonly DevelopmentCard[],
	nobles: readonly Noble[],
	random: () => number = Math.random,
): GameState {
	if (playerDefinitions.length < 2 || playerDefinitions.length > 4) {
		fail("INVALID_PLAYER_COUNT", "A game requires 2 to 4 players.");
	}
	const playerIds = new Set<string>();
	for (const player of playerDefinitions) {
		if (!player.id || !player.name.trim() || playerIds.has(player.id)) {
			fail("INVALID_GAME_DATA", "Players must have unique IDs and non-empty names.");
		}
		playerIds.add(player.id);
	}
	validateGameData(cards, nobles);
	if (nobles.length < playerDefinitions.length + 1) {
		fail("INVALID_GAME_DATA", "The noble deck must contain at least players + 1 nobles.");
	}

	const decks = emptyDecks();
	for (const level of CARD_LEVELS) {
		const levelCards = cards.filter((card) => card.level === level);
		if (levelCards.length < 4) {
			fail("INVALID_GAME_DATA", `Level ${level} requires at least 4 cards.`);
		}
		decks[level] = shuffle(levelCards, random);
	}

	const market = emptyMarket();
	for (const level of CARD_LEVELS) {
		for (let index = 0; index < 4; index += 1) {
			market[level].push(decks[level].pop()!);
		}
	}

	const tokenSupply = playerDefinitions.length === 2 ? 4 : playerDefinitions.length === 3 ? 5 : 6;
	const bank: TokenCounts = {
		white: tokenSupply,
		blue: tokenSupply,
		green: tokenSupply,
		red: tokenSupply,
		black: tokenSupply,
		gold: 5,
	};
	const players: PlayerState[] = playerDefinitions.map((definition) => ({
		id: definition.id,
		name: definition.name.trim(),
		gems: zeroTokenCounts(),
		purchasedCards: [],
		reservedCards: [],
		hiddenReservedCardIds: [],
		nobles: [],
	}));
	const shuffledNobles = shuffle(nobles, random);
	const startingPlayerIndex = Math.floor(random() * players.length);

	return {
		players,
		bank,
		market,
		decks,
		noblesAvailable: shuffledNobles.slice(0, players.length + 1),
		startingPlayerIndex,
		activePlayerIndex: startingPlayerIndex,
		status: "active",
		finalRoundTriggered: false,
		pendingNobleIds: [],
		winnerIds: [],
	};
}

function cloneState(state: GameState): GameState {
	return {
		...state,
		players: state.players.map((player) => ({
			...player,
			gems: { ...player.gems },
			purchasedCards: [...player.purchasedCards],
			reservedCards: [...player.reservedCards],
			hiddenReservedCardIds: [...player.hiddenReservedCardIds],
			nobles: [...player.nobles],
		})),
		bank: { ...state.bank },
		market: {
			1: [...state.market[1]],
			2: [...state.market[2]],
			3: [...state.market[3]],
		},
		decks: {
			1: [...state.decks[1]],
			2: [...state.decks[2]],
			3: [...state.decks[3]],
		},
		noblesAvailable: [...state.noblesAvailable],
		pendingNobleIds: [...state.pendingNobleIds],
		winnerIds: [...state.winnerIds],
	};
}

function getPlayer(state: GameState, playerId: string): PlayerState {
	const player = state.players[state.activePlayerIndex];
	if (!player || player.id !== playerId) {
		fail("NOT_ACTIVE_PLAYER", "Only the active player may act.");
	}
	return player;
}

function checkReturns(
	player: PlayerState,
	bank: TokenCounts,
	returnGems: Partial<TokenCounts> | undefined,
): void {
	const amountToReturn = TOKEN_COLORS.reduce((total, color) => {
		const count = returnGems?.[color] ?? 0;
		if (!Number.isInteger(count) || count < 0 || count > player.gems[color]) {
			fail("INVALID_RETURN", `Invalid number of ${color} gems to return.`);
		}
		return total + count;
	}, 0);
	const excess = totalTokens(player.gems) - GEM_LIMIT;
	if (excess <= 0 && amountToReturn > 0) {
		fail("INVALID_RETURN", "Gems may only be returned when the 10-gem limit is exceeded.");
	}
	if (excess > 0 && amountToReturn !== excess) {
		fail("GEM_LIMIT_EXCEEDED", `Return exactly ${excess} gem(s) to meet the hand limit.`);
	}
	for (const color of TOKEN_COLORS) {
		const count = returnGems?.[color] ?? 0;
		player.gems[color] -= count;
		bank[color] += count;
	}
}

function refillMarket(state: GameState, level: CardLevel): void {
	const replacement = state.decks[level].pop();
	if (replacement) {
		state.market[level].push(replacement);
	}
}

function removeMarketCard(
	state: GameState,
	level: CardLevel,
	cardId: string,
): DevelopmentCard {
	const index = state.market[level].findIndex((card) => card.id === cardId);
	if (index < 0) {
		fail("CARD_NOT_AVAILABLE", `Card ${cardId} is not in the level ${level} market.`);
	}
	const [card] = state.market[level].splice(index, 1);
	if (!card) {
		fail("CARD_NOT_AVAILABLE", `Card ${cardId} could not be removed from the market.`);
	}
	refillMarket(state, level);
	return card;
}

function completeTurn(state: GameState, player: PlayerState): void {
	const eligibleNobles = state.noblesAvailable.filter((noble) =>
		Object.entries(noble.requirements).every(([color, required]) => {
			const bonusColor = color as GemColor;
			const bonusCount = player.purchasedCards.filter(
				(card) => card.bonusColor === bonusColor,
			).length;
			return bonusCount >= required;
		}),
	);

	if (eligibleNobles.length > 1) {
		state.pendingNobleIds = eligibleNobles.map((noble) => noble.id);
		return;
	}
	if (eligibleNobles.length === 1) {
		claimNoble(state, player, eligibleNobles[0]!.id);
	}
	advanceTurn(state);
}

function claimNoble(state: GameState, player: PlayerState, nobleId: string): void {
	const index = state.noblesAvailable.findIndex((noble) => noble.id === nobleId);
	if (index < 0) {
		fail("INVALID_ACTION", `Noble ${nobleId} is no longer available.`);
	}
	const [noble] = state.noblesAvailable.splice(index, 1);
	if (!noble) {
		fail("INVALID_ACTION", `Noble ${nobleId} could not be claimed.`);
	}
	player.nobles.push(noble);
}

function finishGame(state: GameState): void {
	const highestScore = Math.max(...state.players.map(getPlayerScore));
	const scoreLeaders = state.players.filter((player) => getPlayerScore(player) === highestScore);
	const fewestCards = Math.min(...scoreLeaders.map((player) => player.purchasedCards.length));
	state.winnerIds = scoreLeaders
		.filter((player) => player.purchasedCards.length === fewestCards)
		.map((player) => player.id);
	state.status = "finished";
}

function advanceTurn(state: GameState): void {
	if (state.players.some((player) => getPlayerScore(player) >= 15)) {
		state.finalRoundTriggered = true;
	}
	const finalPlayerIndex =
		(state.startingPlayerIndex - 1 + state.players.length) % state.players.length;
	if (state.finalRoundTriggered && state.activePlayerIndex === finalPlayerIndex) {
		finishGame(state);
		return;
	}
	state.activePlayerIndex = (state.activePlayerIndex + 1) % state.players.length;
}

function applyTakeGems(
	state: GameState,
	player: PlayerState,
	colors: readonly GemColor[],
	returnGems: Partial<TokenCounts> | undefined,
): void {
	if (colors.length < 1 || colors.length > 3) {
		fail("INVALID_ACTION", "Take between 1 and 3 ordinary gems.");
	}
	if (colors.some((color) => !GEM_COLORS.includes(color))) {
		fail("INVALID_ACTION", "Only ordinary gem colors may be taken.");
	}
	const uniqueColors = new Set(colors);
	const isDoubleTake = colors.length === 2 && uniqueColors.size === 1;
	if (isDoubleTake) {
		const color = colors[0]!;
		if (state.bank[color] < 4) {
			fail("INSUFFICIENT_SUPPLY", "Taking 2 gems of one color requires at least 4 in the bank.");
		}
		state.bank[color] -= 2;
		player.gems[color] += 2;
	} else {
		if (uniqueColors.size !== colors.length) {
			fail("INVALID_ACTION", "Different-color gem selections must not contain duplicates.");
		}
		const availableColorCount = GEM_COLORS.filter((color) => state.bank[color] > 0).length;
		if (
			(availableColorCount >= 3 && colors.length !== 3) ||
			(availableColorCount < 3 && colors.length > availableColorCount)
		) {
			fail("INVALID_ACTION", "Take 3 different gems when possible, or 1 to 2 when fewer colors remain.");
		}
		for (const color of colors) {
			if (state.bank[color] < 1) {
				fail("INSUFFICIENT_SUPPLY", `No ${color} gems remain in the bank.`);
			}
		}
		for (const color of colors) {
			state.bank[color] -= 1;
			player.gems[color] += 1;
		}
	}
	checkReturns(player, state.bank, returnGems);
}

function applyReserveCard(
	state: GameState,
	player: PlayerState,
	action: Extract<GameAction, { type: "reserveCard" }>,
): void {
	if (player.reservedCards.length >= RESERVED_CARD_LIMIT) {
		fail("RESERVE_LIMIT_REACHED", "A player may reserve at most 3 cards.");
	}
	let card: DevelopmentCard | undefined;
	if (action.source.kind === "market") {
		card = removeMarketCard(state, action.source.level, action.source.cardId);
	} else {
		card = state.decks[action.source.level].pop();
		if (!card) {
			fail("DECK_EMPTY", `The level ${action.source.level} deck is empty.`);
		}
	}
	player.reservedCards.push(card);
	if (action.source.kind === "deck") player.hiddenReservedCardIds.push(card.id);
	if (state.bank.gold > 0) {
		state.bank.gold -= 1;
		player.gems.gold += 1;
	}
	checkReturns(player, state.bank, action.returnGems);
}

function getCardForPurchase(
	state: GameState,
	player: PlayerState,
	source: Extract<GameAction, { type: "buyCard" }> ["source"],
): DevelopmentCard {
	if (source.kind === "market") {
		const card = state.market[source.level].find((candidate) => candidate.id === source.cardId);
		if (!card) {
			fail("CARD_NOT_AVAILABLE", `Card ${source.cardId} is not available in the market.`);
		}
		return removeMarketCard(state, source.level, source.cardId);
	}
	const index = player.reservedCards.findIndex((card) => card.id === source.cardId);
	if (index < 0) {
		fail("CARD_NOT_AVAILABLE", `Card ${source.cardId} is not reserved by this player.`);
	}
	const [card] = player.reservedCards.splice(index, 1);
	if (!card) {
		fail("CARD_NOT_AVAILABLE", `Card ${source.cardId} could not be removed from the reserve.`);
	}
	player.hiddenReservedCardIds = player.hiddenReservedCardIds.filter((id) => id !== card.id);
	return card;
}

function applyBuyCard(
	state: GameState,
	player: PlayerState,
	action: Extract<GameAction, { type: "buyCard" }>,
): void {
	const sourceCard = action.source.kind === "market"
		? state.market[action.source.level].find((card) => card.id === action.source.cardId)
		: player.reservedCards.find((card) => card.id === action.source.cardId);
	if (!sourceCard) {
		fail("CARD_NOT_AVAILABLE", `Card ${action.source.cardId} is not available to buy.`);
	}

	const discounts: ColorCounts = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
	for (const card of player.purchasedCards) {
		discounts[card.bonusColor] += 1;
	}
	let goldNeeded = 0;
	const gemsToSpend: Partial<Record<GemColor, number>> = {};
	for (const color of GEM_COLORS) {
		const costAfterDiscount = Math.max(0, sourceCard.cost[color] - discounts[color]);
		const spend = Math.min(player.gems[color], costAfterDiscount);
		gemsToSpend[color] = spend;
		goldNeeded += costAfterDiscount - spend;
	}
	if (goldNeeded > player.gems.gold) {
		fail("CANNOT_AFFORD_CARD", `Not enough gems to buy card ${sourceCard.id}.`);
	}

	for (const color of GEM_COLORS) {
		const spend = gemsToSpend[color] ?? 0;
		player.gems[color] -= spend;
		state.bank[color] += spend;
	}
	player.gems.gold -= goldNeeded;
	state.bank.gold += goldNeeded;
	const card = getCardForPurchase(state, player, action.source);
	player.purchasedCards.push(card);
}

export function applyAction(state: GameState, actorId: string, action: GameAction): GameState {
	if (state.status !== "active") {
		fail("GAME_FINISHED", "This game has already finished.");
	}
	const next = cloneState(state);
	const player = getPlayer(next, actorId);
	if (next.pendingNobleIds.length > 0) {
		if (action.type !== "chooseNoble") {
			fail("NOBLE_CHOICE_REQUIRED", "Choose one eligible noble before ending your turn.");
		}
		if (!next.pendingNobleIds.includes(action.nobleId)) {
			fail("INVALID_ACTION", "The selected noble is not eligible.");
		}
		claimNoble(next, player, action.nobleId);
		next.pendingNobleIds = [];
		advanceTurn(next);
		return next;
	}
	if (action.type === "chooseNoble") {
		fail("NO_PENDING_NOBLE_CHOICE", "There is no pending noble choice.");
	}

	switch (action.type) {
		case "takeGems":
			applyTakeGems(next, player, action.colors, action.returnGems);
			break;
		case "reserveCard":
			applyReserveCard(next, player, action);
			break;
		case "buyCard":
			applyBuyCard(next, player, action);
			break;
	}
	completeTurn(next, player);
	return next;
}

export function getPlayerScore(player: PlayerState): number {
	return (
		player.purchasedCards.reduce((total, card) => total + card.points, 0) +
		player.nobles.reduce((total, noble) => total + noble.points, 0)
	);
}

export function getPlayerBonuses(player: PlayerState): ColorCounts {
	const bonuses: ColorCounts = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
	for (const card of player.purchasedCards) {
		bonuses[card.bonusColor] += 1;
	}
	return bonuses;
}

export function getRemainingCost(player: PlayerState, card: DevelopmentCard): ColorCounts {
	const bonuses = getPlayerBonuses(player);
	return {
		white: Math.max(0, card.cost.white - bonuses.white),
		blue: Math.max(0, card.cost.blue - bonuses.blue),
		green: Math.max(0, card.cost.green - bonuses.green),
		red: Math.max(0, card.cost.red - bonuses.red),
		black: Math.max(0, card.cost.black - bonuses.black),
	};
}
function hiddenCard(id: string, level: CardLevel): DevelopmentCard {
	return { id, level, bonusColor: "white", points: 0, cost: { white: 0, blue: 0, green: 0, red: 0, black: 0 } };
}

/**
 * 生成某位玩家可见的对局状态：牌库只保留数量，其他玩家暗抽预留的卡只保留等级。
 */
export function redactGameForViewer(state: GameState, viewerId: string): GameState {
	return {
		...state,
		players: state.players.map((player) => {
			if (player.id === viewerId) return player;
			const hiddenIds: string[] = [];
			const reservedCards = player.reservedCards.map((card, index) => {
				if (!player.hiddenReservedCardIds.includes(card.id)) return card;
				const id = `hidden-${index}`;
				hiddenIds.push(id);
				return hiddenCard(id, card.level);
			});
			return { ...player, reservedCards, hiddenReservedCardIds: hiddenIds };
		}),
		decks: {
			1: state.decks[1].map((_, index) => hiddenCard(`deck-1-${index}`, 1)),
			2: state.decks[2].map((_, index) => hiddenCard(`deck-2-${index}`, 2)),
			3: state.decks[3].map((_, index) => hiddenCard(`deck-3-${index}`, 3)),
		},
	};
}
