import { applyAction, getPlayerBonuses, getPlayerScore } from "./engine.js";
import {
	CARD_LEVELS,
	GEM_COLORS,
	TOKEN_COLORS,
	type CardLevel,
	type ColorCounts,
	type DevelopmentCard,
	type GameAction,
	type GameState,
	type GemColor,
	type Noble,
	type PlayerState,
	type TokenColor,
	type TokenCounts,
} from "./types.js";

/**
 * 「普通」难度人机。
 *
 * 输入必须是 redactGameForViewer(state, playerId) 之后的状态：人机只看得到自己座位能看到的东西
 * （牌堆只有张数，别人暗抽预留的卡只有等级）。做法是一步前瞻：把每个合法行动在这份状态上
 * 试走一遍，用局面评分比较走完后的样子，挑分最高的。评分看：分数、折扣、贵族进度、
 * 离买下桌上（和自己预留的）好土地还差几枚宝石、手里的宝石，以及把对手马上能买的好牌拿走 / 扣下。
 */

const GEM_LIMIT = 10;
const RESERVE_LIMIT = 3;
const COLOR_NAMES: Record<TokenColor, string> = {
	white: "白",
	blue: "蓝",
	green: "绿",
	red: "红",
	black: "黑",
	gold: "金",
};
const LEVEL_NAMES: Record<CardLevel, string> = { 1: "第一排", 2: "第二排", 3: "第三排" };

export interface BotAdvice {
	action: GameAction;
	/** 给玩家看的一句话理由（教程的「提示」按钮用）。 */
	reason: string;
}

/** 牌堆在别人视角里是占位卡（id 以 deck- 或 hidden- 开头），评分时不当真。 */
function isUnknown(card: DevelopmentCard): boolean {
	return card.id.startsWith("deck-") || card.id.startsWith("hidden-");
}

function tokenTotal(gems: TokenCounts): number {
	return TOKEN_COLORS.reduce((sum, color) => sum + gems[color], 0);
}

/** 买这张卡还差几枚宝石（已经扣掉折扣和金色）。0 = 现在就买得起。 */
export function gemsShort(player: PlayerState, card: DevelopmentCard, bonuses = getPlayerBonuses(player)): number {
	let short = 0;
	for (const color of GEM_COLORS) {
		short += Math.max(0, card.cost[color] - bonuses[color] - player.gems[color]);
	}
	return Math.max(0, short - player.gems.gold);
}

function canAfford(player: PlayerState, card: DevelopmentCard, bonuses = getPlayerBonuses(player)): boolean {
	return gemsShort(player, card, bonuses) === 0;
}

function combinations<T>(items: readonly T[], size: number): T[][] {
	if (size === 0) return [[]];
	const result: T[][] = [];
	items.forEach((item, index) => {
		for (const rest of combinations(items.slice(index + 1), size - 1)) result.push([item, ...rest]);
	});
	return result;
}

/** 这一手可以怎么拿宝石（不含归还）。 */
export function gemTakeOptions(bank: TokenCounts): GemColor[][] {
	const available = GEM_COLORS.filter((color) => bank[color] > 0);
	const options: GemColor[][] = [];
	if (available.length >= 3) {
		options.push(...combinations(available, 3));
	} else {
		for (let size = 1; size <= available.length; size += 1) options.push(...combinations(available, size));
	}
	for (const color of GEM_COLORS) if (bank[color] >= 4) options.push([color, color]);
	return options;
}

/** 手里宝石超过 10 枚时，所有「还回去 excess 枚」的组合。 */
export function returnOptions(gems: TokenCounts, excess: number): Partial<TokenCounts>[] {
	if (excess <= 0) return [{}];
	const result: Partial<TokenCounts>[] = [];
	const walk = (index: number, left: number, current: Partial<TokenCounts>) => {
		if (left === 0) {
			result.push({ ...current });
			return;
		}
		if (index >= TOKEN_COLORS.length) return;
		const color = TOKEN_COLORS[index]!;
		for (let count = Math.min(left, gems[color]); count >= 0; count -= 1) {
			if (count > 0) current[color] = count;
			else delete current[color];
			walk(index + 1, left - count, current);
		}
		delete current[color];
	};
	walk(0, excess, {});
	return result;
}

function gemsAfterTake(gems: TokenCounts, colors: readonly GemColor[]): TokenCounts {
	const next = { ...gems };
	for (const color of colors) next[color] += 1;
	return next;
}

/**
 * 当前玩家所有合法行动。withReturns 为 true 时，超过 10 枚的行动会按每种归还组合展开；
 * 否则只给一个默认归还（随机基线用）。
 */
export function legalActions(state: GameState, playerId: string, withReturns = true): GameAction[] {
	if (state.status !== "active") return [];
	const player = state.players[state.activePlayerIndex];
	if (!player || player.id !== playerId) return [];
	if (state.pendingNobleIds.length > 0) {
		return state.pendingNobleIds.map((nobleId) => ({ type: "chooseNoble", nobleId }));
	}
	const actions: GameAction[] = [];
	const bonuses = getPlayerBonuses(player);
	for (const level of CARD_LEVELS) {
		for (const card of state.market[level]) {
			if (!isUnknown(card) && canAfford(player, card, bonuses)) {
				actions.push({ type: "buyCard", source: { kind: "market", level, cardId: card.id } });
			}
		}
	}
	for (const card of player.reservedCards) {
		if (canAfford(player, card, bonuses)) actions.push({ type: "buyCard", source: { kind: "reserved", cardId: card.id } });
	}
	const expand = (gems: TokenCounts, make: (returnGems?: Partial<TokenCounts>) => GameAction) => {
		const excess = tokenTotal(gems) - GEM_LIMIT;
		if (excess <= 0) {
			actions.push(make());
			return;
		}
		const options = returnOptions(gems, excess);
		for (const option of withReturns ? options : options.slice(0, 1)) actions.push(make(option));
	};
	for (const colors of gemTakeOptions(state.bank)) {
		expand(gemsAfterTake(player.gems, colors), (returnGems) => ({
			type: "takeGems",
			colors,
			...(returnGems ? { returnGems } : {}),
		}));
	}
	if (player.reservedCards.length < RESERVE_LIMIT) {
		const gemsAfter = { ...player.gems, gold: player.gems.gold + (state.bank.gold > 0 ? 1 : 0) };
		for (const level of CARD_LEVELS) {
			for (const card of state.market[level]) {
				if (isUnknown(card)) continue;
				expand(gemsAfter, (returnGems) => ({
					type: "reserveCard",
					source: { kind: "market", level, cardId: card.id },
					...(returnGems ? { returnGems } : {}),
				}));
			}
			if (state.decks[level].length > 0) {
				expand(gemsAfter, (returnGems) => ({
					type: "reserveCard",
					source: { kind: "deck", level },
					...(returnGems ? { returnGems } : {}),
				}));
			}
		}
	}
	return actions;
}

// ---------------------------------------------------------------- 局面评分

interface Weights {
	/** 一枚永久折扣值几分（游戏后段打折）。 */
	bonus: number;
	/** 普通宝石 / 金色在手里值几分。 */
	gem: number;
	gold: number;
	/** 离目标还差一轮，价值打几折。 */
	discount: number;
	/** 每张卡在预留区占位的代价。 */
	reserveSlot: number;
	/** 把对手马上能买的好牌拿走的权重。 */
	deny: number;
	/** 暗扣牌堆的粗估价值倍数。 */
	deck: number;
	/** 后段分数加成。 */
	lateMult: number;
	/** 第二、三个目标的权重。 */
	second: number;
	third: number;
	/** 贵族进度权重。 */
	noble: number;
	/** 桌上的牌每过一轮、每个对手可能把它买走的概率。 */
	steal: number;
}

/** 权重按模拟调过（sim-gem-merchant.ts / 对贪心基线）：折扣 0.5、预留占位 1.2 提升最大。 */
export const WEIGHTS: Weights = { bonus: 0.8, gem: 0.04, gold: 0.12, discount: 0.5, reserveSlot: 1.2, deny: 0.45, deck: 0, lateMult: 0.6, second: 0.5, third: 0.25, noble: 0.55, steal: 0.1 };
/** 拿了又原样还回去（等于什么都没做）的扣分，免得两边都攥着宝石原地打转。 */
const IDLE_PENALTY = 1.5;

interface Context {
	me: string;
	/** 牌局进度 0..1：最高分 8 分以下为 0，到 15 分为 1。 */
	late: number;
	/** 本局里在场（桌上 + 自己预留）且看得到的土地，用来估「颜色需求」。 */
	colorDemand: ColorCounts;
}

function late(state: GameState): number {
	const top = Math.max(...state.players.map(getPlayerScore));
	return Math.min(1, Math.max(0, (top - 7) / 8));
}

function visibleCards(state: GameState, player: PlayerState): DevelopmentCard[] {
	const cards: DevelopmentCard[] = [];
	for (const level of CARD_LEVELS) for (const card of state.market[level]) if (!isUnknown(card)) cards.push(card);
	for (const card of player.reservedCards) if (!isUnknown(card)) cards.push(card);
	return cards;
}

function colorDemand(state: GameState, player: PlayerState): ColorCounts {
	const demand: ColorCounts = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
	const bonuses = getPlayerBonuses(player);
	for (const card of visibleCards(state, player)) {
		const weight = card.points >= 1 ? 1 : 0.5;
		for (const color of GEM_COLORS) if (card.cost[color] > bonuses[color]) demand[color] += weight * Math.min(1, (card.cost[color] - bonuses[color]) / 3);
	}
	for (const noble of state.noblesAvailable) {
		for (const color of GEM_COLORS) {
			const need = (noble.requirements[color] ?? 0) - bonuses[color];
			if (need > 0) demand[color] += 0.8;
		}
	}
	return demand;
}

/** 贵族进度：差得越少越值钱。 */
function nobleValue(nobles: readonly Noble[], bonuses: ColorCounts): number {
	let value = 0;
	for (const noble of nobles) {
		let need = 0;
		let total = 0;
		for (const color of GEM_COLORS) {
			const required = noble.requirements[color] ?? 0;
			total += required;
			need += Math.max(0, required - bonuses[color]);
		}
		if (total === 0) continue;
		const progress = 1 - need / total;
		value += noble.points * progress * progress * WEIGHTS.noble;
	}
	return value;
}

/** 一张土地对这个玩家值多少：分数 + 折扣 + 让贵族更近。 */
function cardWorth(card: DevelopmentCard, bonuses: ColorCounts, nobles: readonly Noble[], ctx: Context): number {
	const bonusWeight = WEIGHTS.bonus * (1 - 0.75 * ctx.late);
	const demand = 0.6 + 0.15 * Math.min(4, ctx.colorDemand[card.bonusColor]);
	const after = { ...bonuses, [card.bonusColor]: bonuses[card.bonusColor] + 1 };
	const nobleGain = nobleValue(nobles, after) - nobleValue(nobles, bonuses);
	return card.points * (1 + WEIGHTS.lateMult * ctx.late) + bonusWeight * demand + nobleGain;
}

/**
 * 估计还要几轮才能买下这张卡（含买的那一轮）：每轮最多拿 3 枚、同色最多 2 枚；
 * 供应区不够的颜色、扣完折扣仍超过 10 枚的卡（手里装不下）都按很远算。
 */
export function roundsToBuy(state: GameState, player: PlayerState, card: DevelopmentCard, bonuses = getPlayerBonuses(player)): number {
	let short = 0;
	let worstColor = 0;
	let scarce = 0;
	let effective = 0;
	for (const color of GEM_COLORS) {
		const need = Math.max(0, card.cost[color] - bonuses[color]);
		effective += need;
		const lack = Math.max(0, need - player.gems[color]);
		short += lack;
		if (lack > 0) {
			const perRound = state.bank[color] >= 4 ? 2 : 1;
			worstColor = Math.max(worstColor, Math.ceil(lack / perRound));
			scarce += Math.max(0, lack - state.bank[color]);
		}
	}
	const gold = player.gems.gold;
	short = Math.max(0, short - gold);
	if (short === 0) return 1;
	worstColor = Math.max(0, worstColor - gold);
	let rounds = 1 + Math.max(Math.ceil(short / 3), worstColor);
	rounds += 2 * Math.max(0, scarce - gold);
	if (effective > GEM_LIMIT + gold) rounds += 2 * (effective - GEM_LIMIT - gold);
	return rounds;
}

/** 某位玩家局面的估值（越大越好）。 */
function evaluatePlayer(state: GameState, player: PlayerState, ctx: Context): number {
	const bonuses = getPlayerBonuses(player);
	const score = getPlayerScore(player);
	let value = score * (1 + WEIGHTS.lateMult * ctx.late);
	const bonusWeight = WEIGHTS.bonus * (1 - 0.75 * ctx.late);
	for (const color of GEM_COLORS) value += bonuses[color] * bonusWeight * (0.6 + 0.1 * Math.min(4, ctx.colorDemand[color]));
	value += nobleValue(state.noblesAvailable, bonuses);
	for (const color of GEM_COLORS) value += Math.min(player.gems[color], 4) * WEIGHTS.gem;
	value += player.gems.gold * WEIGHTS.gold;

	// 目标：桌上和自己预留的土地里，按「价值 × 折扣^(还要几轮)」挑最好的三张。
	const prospects: number[] = [];
	for (const card of visibleCards(state, player)) {
		const rounds = roundsToBuy(state, player, card, bonuses);
		const worth = cardWorth(card, bonuses, state.noblesAvailable, ctx);
		const survive = player.reservedCards.includes(card) ? 1 : Math.pow(1 - WEIGHTS.steal * (state.players.length - 1), rounds - 1);
		prospects.push(worth * Math.pow(WEIGHTS.discount, rounds) * survive);
	}
	prospects.sort((a, b) => b - a);
	value += (prospects[0] ?? 0) + WEIGHTS.second * (prospects[1] ?? 0) + WEIGHTS.third * (prospects[2] ?? 0);
	// 预留区占位：买不起又占着位置的卡是负担。
	value -= player.reservedCards.length * WEIGHTS.reserveSlot;
	return value;
}

/** 对手现在就能买的最好那张值多少（拿走或扣下它算「拆对手」）。 */
function opponentThreat(state: GameState, ctx: Context): number {
	let threat = 0;
	for (const opponent of state.players) {
		if (opponent.id === ctx.me) continue;
		const bonuses = getPlayerBonuses(opponent);
		const score = getPlayerScore(opponent);
		let best = 0;
		for (const level of CARD_LEVELS) {
			for (const card of state.market[level]) {
				if (isUnknown(card) || !canAfford(opponent, card, bonuses)) continue;
				let worth = card.points + 0.4;
				// 买了就能到 15 分：一定要拦
				if (score + card.points >= 15) worth += 6;
				best = Math.max(best, worth);
			}
		}
		threat += best;
	}
	return threat;
}

function evaluate(state: GameState, ctx: Context): number {
	const me = state.players.find((player) => player.id === ctx.me)!;
	if (state.status === "finished") {
		// 这一步打完就结算：赢最重要，输了也尽量多拿分
		const won = state.winnerIds.includes(ctx.me);
		return (won ? 1000 : 0) + getPlayerScore(me) * 10 - me.purchasedCards.length * 0.01;
	}
	let value = evaluatePlayer(state, me, ctx);
	value -= WEIGHTS.deny * opponentThreat(state, ctx);
	return value;
}

// ---------------------------------------------------------------- 决策

function describeColors(colors: readonly GemColor[]): string {
	return colors.map((color) => COLOR_NAMES[color]).join("、");
}

function findCard(state: GameState, player: PlayerState, cardId: string): DevelopmentCard | undefined {
	for (const level of CARD_LEVELS) {
		const card = state.market[level].find((candidate) => candidate.id === cardId);
		if (card) return card;
	}
	return player.reservedCards.find((card) => card.id === cardId);
}

/** 拿完宝石后，离哪张好土地最近（给理由用）。 */
function bestTarget(state: GameState, player: PlayerState, ctx: Context): { card: DevelopmentCard; short: number } | undefined {
	const bonuses = getPlayerBonuses(player);
	let best: { card: DevelopmentCard; short: number; score: number } | undefined;
	for (const card of visibleCards(state, player)) {
		const short = gemsShort(player, card, bonuses);
		const score = cardWorth(card, bonuses, state.noblesAvailable, ctx) * Math.pow(WEIGHTS.discount, roundsToBuy(state, player, card, bonuses));
		if (!best || score > best.score) best = { card, short, score };
	}
	return best;
}

function cardLabel(card: DevelopmentCard): string {
	const points = card.points > 0 ? `${card.points} 分的` : "";
	return `${LEVEL_NAMES[card.level]}${points}${COLOR_NAMES[card.bonusColor]}色土地`;
}

function explain(before: GameState, after: GameState, action: GameAction, ctx: Context): string {
	const meBefore = before.players.find((player) => player.id === ctx.me)!;
	const meAfter = after.players.find((player) => player.id === ctx.me)!;
	const gainedNoble = meAfter.nobles.length > meBefore.nobles.length;
	const threatBefore = opponentThreat(before, ctx);
	const threatAfter = opponentThreat(after, ctx);
	switch (action.type) {
		case "chooseNoble":
			return "同时满足好几位贵族，选这一位：来访就加 3 分。";
		case "buyCard": {
			const card = findCard(before, meBefore, action.source.cardId)!;
			const parts: string[] = [];
			if (card.points > 0) parts.push(`+${card.points} 分`);
			parts.push(`以后买${COLOR_NAMES[card.bonusColor]}色便宜 1 枚`);
			if (gainedNoble) parts.push("还凑齐了贵族，再 +3 分");
			const prefix = action.source.kind === "reserved" ? "买下预留的" : "买下";
			return `${prefix}${cardLabel(card)}：${parts.join("，")}。`;
		}
		case "reserveCard": {
			const gold = meAfter.gems.gold > meBefore.gems.gold ? "，顺手拿 1 枚金色万能宝石" : "";
			if (action.source.kind === "deck") return `从${LEVEL_NAMES[action.source.level]}的牌堆暗扣一块${gold}。`;
			const card = findCard(before, meBefore, action.source.cardId)!;
			if (threatAfter < threatBefore - 0.5) return `预留${cardLabel(card)}：对手下回合就买得起它，先扣下来${gold}。`;
			return `预留${cardLabel(card)}，留着以后买${gold}。`;
		}
		case "takeGems": {
			const target = bestTarget(after, meAfter, ctx);
			const what = action.colors.length === 2 && action.colors[0] === action.colors[1]
				? `同色拿 2 枚${COLOR_NAMES[action.colors[0]!]}宝石`
				: `拿${describeColors(action.colors)}宝石`;
			const giveBack = action.returnGems && tokenTotal({ white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0, ...action.returnGems }) > 0
				? `（超过 10 枚，还回${Object.entries(action.returnGems).filter(([, n]) => (n ?? 0) > 0).map(([c, n]) => `${n} 枚${COLOR_NAMES[c as TokenColor]}`).join("、")}）`
				: "";
			if (!target) return `${what}${giveBack}。`;
			if (target.short === 0) return `${what}${giveBack}：下回合就能买${cardLabel(target.card)}。`;
			return `${what}${giveBack}：攒着买${cardLabel(target.card)}，还差 ${target.short} 枚。`;
		}
	}
}

function isIdle(before: GameState, after: GameState, playerId: string): boolean {
	const a = before.players.find((player) => player.id === playerId)!.gems;
	const b = after.players.find((player) => player.id === playerId)!.gems;
	return TOKEN_COLORS.every((color) => a[color] === b[color]);
}

/** 人机挑这一步，并附一句理由。state 必须是 playerId 视角（redactGameForViewer 之后）。 */
export function botAdvice(state: GameState, playerId: string): BotAdvice | null {
	const actions = legalActions(state, playerId, true);
	if (actions.length === 0) return null;
	const me = state.players.find((player) => player.id === playerId)!;
	const ctx: Context = { me: playerId, late: late(state), colorDemand: colorDemand(state, me) };
	let best: { action: GameAction; value: number; after: GameState } | undefined;
	for (const action of actions) {
		let after: GameState;
		try {
			after = applyAction(state, playerId, action);
		} catch {
			continue;
		}
		let value = evaluate(after, ctx);
		// 暗扣的卡看不到内容：按这一排的平均价值粗估
		if (action.type === "takeGems" && isIdle(state, after, playerId)) value -= IDLE_PENALTY;
		if (action.type === "reserveCard" && action.source.kind === "deck") value += WEIGHTS.deck * [0, 0.25, 0.6, 1.0][action.source.level]! * WEIGHTS.discount ** 3;
		if (!best || value > best.value + 1e-9) best = { action, value, after };
	}
	if (!best) return null;
	return { action: best.action, reason: explain(state, best.after, best.action, ctx) };
}

/** 人机下一步；没有合法行动（宝石拿光、预留满、什么都买不起）时返回 null，由服务器按跳过处理。 */
export function botCommand(state: GameState, playerId: string): GameAction | null {
	return botAdvice(state, playerId)?.action ?? null;
}
