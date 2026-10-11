/**
 * 新手教程的剧本（宝石商人）。
 *
 * 教程在浏览器里直接跑规则引擎，不连服务器。两人局，你（先手）对咕噜一号，分两段：
 * 1. 开局：拿 3 枚不同色 → 同色拿 2 枚 → 买下第一块土地（讲折扣）→ 预留一块（拿到金色）→ 讲 10 枚上限；
 * 2. 「快进」到中盘（FAST_FORWARD 换成摆好的局面，开局买的、预留的土地都还在）：
 *    用金色买下预留的绿色土地，绿、红、黑土地各凑满 3 块，贵族来访 +3 → 再买一块到 15 分，触发最后一轮 →
 *    咕噜一号打完最后一回合，你 15 : 14 赢。
 *
 * 引擎的 applyAction 不用随机数，牌堆顺序在局面里，所以直接把局面摆成剧本要的样子，剧情一定这样发生。
 * 卡牌和贵族的数据（data/cards.json、nobles.json）由调用方传进来，剧本只按 id 取用。
 * 剧本走完开一局新的练习局（随机），对手交给人机。
 */
import { applyAction, createGame } from "./engine.js";
import {
	CARD_LEVELS,
	GEM_COLORS,
	TOKEN_COLORS,
	type CardLevel,
	type DevelopmentCard,
	type GameAction,
	type GameState,
	type GemColor,
	type Noble,
	type PlayerState,
	type TokenCounts,
} from "./types.js";

/** 咕噜嘎的表情。 */
export type TutorialFace = "base" | "happy" | "surprised" | "think";

/** 剧本里的一步：规则引擎的行动，或者「快进到中盘」。 */
export type TutorialMove = GameAction | { readonly type: "FAST_FORWARD" };

interface StepBase {
	readonly id: string;
	/** 侧栏「新手教程」进度里这一课叫什么；没有就不单独列。 */
	readonly lesson?: string;
	/** 主句（24px），一句话说清这一步。 */
	readonly say: string;
	/** 补充说明（12px），最多两句。 */
	readonly note?: string;
	/** 触屏设备上换成这句说明。 */
	readonly noteTouch?: string;
	/**
	 * 高亮哪个元素：网页里 data-tutorial 的值。
	 * 固定的有 bank、me-holdings、me-reserved、gem-total、nobles、result、hint、card-buy、card-reserve、card-close；
	 * 带参数的：take2:<颜色>、card:<卡 id>、noble:<贵族 id>、rival:<玩家>、score:<玩家>。
	 */
	readonly anchor?: string;
	readonly face?: TutorialFace;
}

export type TutorialStep =
	/** 讲解：玩家点「下一步」继续。finale 是最后一步（接练习局或结束）。 */
	| (StepBase & { readonly kind: "info"; readonly finale?: boolean })
	/** 等玩家做这一步；做别的会被拦下。 */
	| (StepBase & { readonly kind: "do"; readonly expect: GameAction })
	/** 对手按剧本自动走这几步，牌桌不压暗。 */
	| (StepBase & { readonly kind: "watch"; readonly moves: readonly TutorialMove[] });

export const TUTORIAL_SELF = "tutorial-self";
export const TUTORIAL_RIVAL = "tutorial-bot1";
export const TUTORIAL_RIVAL_NAME = "咕噜一号";

/** 这一步之前不弹结算框（先看咕噜一号走完最后一回合）。 */
export const TUTORIAL_FINAL_STEP = "result";

const take = (...colors: GemColor[]): GameAction => ({ type: "takeGems", colors });
const buyMarket = (level: CardLevel, cardId: string): GameAction => ({ type: "buyCard", source: { kind: "market", level, cardId } });
const buyReserved = (cardId: string): GameAction => ({ type: "buyCard", source: { kind: "reserved", cardId } });
const reserveMarket = (level: CardLevel, cardId: string): GameAction => ({ type: "reserveCard", source: { kind: "market", level, cardId } });

// ---------- 剧本用到的牌 ----------

/** 开局翻开的 12 张（每排 4 张）。 */
const OPEN_MARKET: Record<CardLevel, readonly string[]> = {
	1: ["L1-02", "L1-12", "L1-13", "L1-14"],
	2: ["L2-21", "L2-03", "L2-04", "L2-06"],
	3: ["L3-05", "L3-06", "L3-07", "L3-08"],
};
/** 中盘桌上的 12 张。 */
const LATE_MARKET: Record<CardLevel, readonly string[]> = {
	1: ["L1-03", "L1-04", "L1-05", "L1-06"],
	2: ["L2-29", "L2-22", "L2-01", "L2-02"],
	3: ["L3-01", "L3-02", "L3-03", "L3-04"],
};
/** 中盘时你买过的土地（开局买的 L1-02 还在）：黑 3、红 3、绿 2、白 1、蓝 1，共 8 分。 */
const LATE_SELF_CARDS = ["L1-02", "L1-07", "L1-08", "L1-39", "L1-40", "L2-27", "L1-32", "L2-19", "L1-24", "L1-16"];
/** 中盘时咕噜一号买过的土地（开局买的 L1-14 还在）：12 分。 */
const LATE_RIVAL_CARDS = ["L1-14", "L2-05", "L2-17", "L2-23", "L2-11", "L3-10", "L1-23", "L1-15", "L1-01"];
/** 开局时的预留：你在开局预留的那块。 */
const RESERVED = "L2-21";
/** 两人局 3 位贵族；N-03 要绿、红、黑土地各 3 块。 */
const NOBLES = ["N-03", "N-07", "N-10"];

const zeroTokens = (): TokenCounts => ({ white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 });

function lookup(cards: readonly DevelopmentCard[]) {
	const byId = new Map(cards.map((card) => [card.id, card]));
	return (id: string): DevelopmentCard => {
		const card = byId.get(id);
		if (!card) throw new Error(`教程用到的卡 ${id} 不在卡牌数据里`);
		return card;
	};
}

function nobleList(nobles: readonly Noble[]): Noble[] {
	return NOBLES.map((id) => {
		const noble = nobles.find((candidate) => candidate.id === id);
		if (!noble) throw new Error(`教程用到的贵族 ${id} 不在贵族数据里`);
		return noble;
	});
}

/** 剧本里所有点名的卡之外的牌，按等级排好当牌堆（不洗牌：pop 从末尾取）。 */
function restDecks(cards: readonly DevelopmentCard[]): GameState["decks"] {
	const named = new Set([
		...Object.values(OPEN_MARKET).flat(),
		...Object.values(LATE_MARKET).flat(),
		...LATE_SELF_CARDS,
		...LATE_RIVAL_CARDS,
		RESERVED,
	]);
	const decks: GameState["decks"] = { 1: [], 2: [], 3: [] };
	for (const card of cards) if (!named.has(card.id)) decks[card.level].push(card);
	return decks;
}

function emptyPlayer(id: string, name: string): PlayerState {
	return { id, name, gems: zeroTokens(), purchasedCards: [], reservedCards: [], hiddenReservedCardIds: [], nobles: [] };
}

/** 教程开局：两人局，你先手；桌面、牌堆、贵族都按剧本摆好。 */
export function createTutorialGame(selfName: string, cards: readonly DevelopmentCard[], nobles: readonly Noble[]): GameState {
	const card = lookup(cards);
	const market: GameState["market"] = { 1: [], 2: [], 3: [] };
	for (const level of CARD_LEVELS) market[level] = OPEN_MARKET[level].map(card);
	return {
		players: [emptyPlayer(TUTORIAL_SELF, selfName), emptyPlayer(TUTORIAL_RIVAL, TUTORIAL_RIVAL_NAME)],
		bank: { white: 4, blue: 4, green: 4, red: 4, black: 4, gold: 5 },
		market,
		decks: restDecks(cards),
		noblesAvailable: nobleList(nobles),
		startingPlayerIndex: 0,
		activePlayerIndex: 0,
		status: "active",
		finalRoundTriggered: false,
		pendingNobleIds: [],
		winnerIds: [],
	};
}

/** 快进：换成中盘局面（轮到你，你 8 分，咕噜一号 12 分）。 */
export function createLateGame(previous: GameState, cards: readonly DevelopmentCard[]): GameState {
	const card = lookup(cards);
	const [selfBefore, rivalBefore] = previous.players as [PlayerState, PlayerState];
	const self: PlayerState = {
		...selfBefore,
		gems: { white: 2, blue: 0, green: 0, red: 1, black: 3, gold: 1 },
		purchasedCards: LATE_SELF_CARDS.map(card),
		reservedCards: [card(RESERVED)],
		hiddenReservedCardIds: [],
		nobles: [],
	};
	const rival: PlayerState = {
		...rivalBefore,
		gems: { white: 0, blue: 0, green: 4, red: 3, black: 0, gold: 0 },
		purchasedCards: LATE_RIVAL_CARDS.map(card),
		reservedCards: [],
		hiddenReservedCardIds: [],
		nobles: [],
	};
	const bank = { white: 4, blue: 4, green: 4, red: 4, black: 4, gold: 5 };
	for (const color of TOKEN_COLORS) bank[color] -= self.gems[color] + rival.gems[color];
	const market: GameState["market"] = { 1: [], 2: [], 3: [] };
	for (const level of CARD_LEVELS) market[level] = LATE_MARKET[level].map(card);
	return {
		...previous,
		players: [self, rival],
		bank,
		market,
		decks: restDecks(cards),
		activePlayerIndex: 0,
		status: "active",
		finalRoundTriggered: false,
		pendingNobleIds: [],
		winnerIds: [],
	};
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
	{
		kind: "info", id: "goal", lesson: "目标", face: "happy",
		say: "买土地攒分数：有人到 15 分，这一轮打完就结算。",
		note: "最后分数最高的人赢。这局你和咕噜一号对战，你先走。",
	},
	{
		kind: "info", id: "bank", lesson: "宝石", anchor: "bank",
		say: "这是供应区：五种颜色的宝石，加上金色万能宝石。",
		note: "宝石用来买土地。每回合只做一件事：拿宝石、预留土地、或者买土地。",
	},
	{
		kind: "do", id: "take-three", lesson: "拿 3 枚", anchor: "bank", expect: take("white", "blue", "green"),
		say: "点白、蓝、绿三种宝石，再点「拿取」。",
		note: "三种不同颜色各拿 1 枚，是最常用的拿法。",
	},
	{
		kind: "watch", id: "rival-1", anchor: `rival:${TUTORIAL_RIVAL}`,
		say: "轮到咕噜一号：它也拿了 3 枚。",
		moves: [take("blue", "green", "black")],
	},
	{
		kind: "do", id: "take-two", lesson: "拿 2 枚同色", anchor: "take2:red", expect: take("red", "red"),
		say: "同色拿 2 枚：点红宝石旁边的「+2」。",
		note: "这种颜色在供应区还剩至少 4 枚时，才能一次拿 2 枚。",
	},
	{
		kind: "watch", id: "rival-2", anchor: `rival:${TUTORIAL_RIVAL}`,
		say: "咕噜一号又拿了 3 枚。",
		moves: [take("white", "green", "black")],
	},
	{
		kind: "do", id: "buy-first", lesson: "买土地", anchor: "card:L1-02", expect: buyMarket(1, "L1-02"),
		say: "宝石够了：点这块土地，再点「购买」。",
		note: "土地底下是价钱：白、蓝、绿各 1 枚，红 2 枚。付出去的宝石回到供应区。",
	},
	{
		kind: "info", id: "discount", lesson: "折扣", anchor: "me-holdings", face: "happy",
		say: "买到的土地是永久折扣：以后买土地，黑宝石少付 1 枚。",
		note: "上面一排方块是你各色土地的块数，下面是手里的宝石。这块土地 0 分，有分的土地角上写着分数。",
	},
	{
		kind: "watch", id: "rival-3", anchor: `rival:${TUTORIAL_RIVAL}`,
		say: "咕噜一号还在攒宝石。",
		moves: [take("white", "blue", "red")],
	},
	{
		kind: "do", id: "reserve", lesson: "预留和金色", anchor: `card:${RESERVED}`, expect: reserveMarket(2, RESERVED),
		say: "这块 2 分的土地先预留：点它，再点「预留」。",
		note: "预留的土地只有你能买，还能拿 1 枚金色万能宝石。",
	},
	{
		kind: "info", id: "reserved", anchor: "me-reserved",
		say: "预留的土地放在这里，以后随时可以买。",
		note: "金色宝石买土地时能顶任意一种颜色。每人最多预留 3 块；也可以点牌堆暗抽一块预留。",
	},
	{
		kind: "watch", id: "rival-4", anchor: `rival:${TUTORIAL_RIVAL}`,
		say: "咕噜一号买下了一块土地。",
		moves: [buyMarket(1, "L1-14")],
	},
	{
		kind: "info", id: "limit", lesson: "10 枚上限", anchor: "gem-total", face: "think",
		say: "手里的宝石（含金色）最多 10 枚。",
		note: "拿完超过 10 枚，要自己挑几枚还回供应区。",
	},
	{
		kind: "watch", id: "skip",
		say: "后面就这样一来一回。我们快进到中盘……",
		moves: [{ type: "FAST_FORWARD" }],
	},
	{
		kind: "info", id: "late", anchor: "me-holdings",
		say: "快进了几轮：你 8 分，黑、红土地各 3 块，绿土地 2 块。",
		note: "咕噜一号 12 分，暂时领先。",
	},
	{
		kind: "info", id: "noble", lesson: "贵族", anchor: "noble:N-03", face: "think",
		say: "这位贵族要绿、红、黑土地各 3 块，凑够就来访，加 3 分。",
		note: "只看买到的土地，不算手里的宝石。你只差 1 块绿色。",
	},
	{
		kind: "do", id: "buy-reserved", anchor: `card:${RESERVED}`, expect: buyReserved(RESERVED),
		say: "买下你预留的绿色土地：点它，再点「购买」。",
		note: "有黑土地折扣，黑的只付 1 枚；还差 1 枚蓝的，用金色顶上。",
	},
	{
		kind: "info", id: "noble-visit", anchor: `score:${TUTORIAL_SELF}`, face: "happy",
		say: "绿色凑满 3 块，贵族来访：+3 分！",
		note: "回合结束时自动来访，不用操作。同时满足好几位时自己选一位，每回合最多来一位。",
	},
	{
		kind: "watch", id: "rival-5", anchor: `rival:${TUTORIAL_RIVAL}`,
		say: "咕噜一号拿了 3 枚宝石。",
		moves: [take("white", "blue", "black")],
	},
	{
		kind: "do", id: "reach-15", lesson: "15 分", anchor: "card:L2-29", expect: buyMarket(2, "L2-29"),
		say: "买下这块 2 分的红色土地，你就到 15 分了。",
		note: "它要 5 枚黑宝石，你的 3 块黑土地抵掉 3 枚，只付 2 枚。",
	},
	{
		kind: "info", id: "final-round", anchor: `score:${TUTORIAL_SELF}`, face: "think",
		say: "有人到 15 分：这一轮打完就结算。",
		note: "你是先手，所以咕噜一号还有最后一回合，大家回合数一样。",
	},
	{
		kind: "watch", id: "rival-last", anchor: `rival:${TUTORIAL_RIVAL}`,
		say: "咕噜一号的最后一回合……",
		moves: [buyMarket(2, "L2-22")],
	},
	{
		kind: "info", id: "result", lesson: "胜负", anchor: "result", face: "happy",
		say: "你 15 分，咕噜一号 14 分，你赢了！",
		note: "同分时，买的土地少的人赢；还一样就并列。",
	},
	{
		kind: "info", id: "players", lesson: "人机和托管",
		say: "2–4 人都能玩，人不够就在空座位上「加人机」。",
		note: "连续 2 次超时会转成托管，由人机替你打，点「取消托管」就拿回来。掉线时人机也会先替你走。",
	},
	{
		kind: "info", id: "finale", finale: true, face: "happy",
		say: "教程结束！和咕噜一号练一局吧。",
		note: "练习局里拿不准就点「提示」（键盘 H），我告诉你我会怎么走。",
	},
];

/** 剧本里走一步：快进换成中盘局面，其余交给规则引擎（不合法就抛错）。 */
export function tutorialApply(
	state: GameState,
	playerId: string,
	move: TutorialMove,
	cards: readonly DevelopmentCard[],
): GameState {
	if (move.type === "FAST_FORWARD") return createLateGame(state, cards);
	return applyAction(state, playerId, move);
}

/** 练习局：新开一局两人局（随机牌堆、随机贵族、随机先手）。 */
export function createPracticeGame(selfName: string, cards: readonly DevelopmentCard[], nobles: readonly Noble[], random: () => number = Math.random): GameState {
	return createGame([{ id: TUTORIAL_SELF, name: selfName }, { id: TUTORIAL_RIVAL, name: TUTORIAL_RIVAL_NAME }], cards, nobles, random);
}

/** 两条命令是不是同一步（拿宝石不看点的先后，也不看归还）。 */
export function sameCommand(a: TutorialMove, b: TutorialMove): boolean {
	if (a.type !== b.type) return false;
	if (a.type === "takeGems" && b.type === "takeGems") return [...a.colors].sort().join() === [...b.colors].sort().join();
	if (a.type === "buyCard" && b.type === "buyCard") return a.source.kind === b.source.kind && a.source.cardId === b.source.cardId;
	if (a.type === "reserveCard" && b.type === "reserveCard") {
		if (a.source.kind !== b.source.kind || a.source.level !== b.source.level) return false;
		return a.source.kind === "deck" || (b.source.kind === "market" && a.source.cardId === b.source.cardId);
	}
	if (a.type === "chooseNoble" && b.type === "chooseNoble") return a.nobleId === b.nobleId;
	return a.type === "FAST_FORWARD";
}

/**
 * 这个锚点在这个局面里，界面上应该看得见吗（给剧本单测用，对应 GameBoard 的显示条件）。
 * viewer 是看界面的人（教程里就是你）。
 */
export function anchorVisible(state: GameState, anchor: string, viewer: string): boolean {
	const me = state.players.find((player) => player.id === viewer);
	const myTurn = state.status === "active" && state.players[state.activePlayerIndex]?.id === viewer;
	const [kind, arg] = anchor.split(":") as [string, string | undefined];
	switch (kind) {
		case "bank":
		case "nobles":
			return true;
		case "take2":
			return GEM_COLORS.includes(arg as never);
		case "card":
			return CARD_LEVELS.some((level) => state.market[level].some((card) => card.id === arg))
				|| (me?.reservedCards.some((card) => card.id === arg) ?? false);
		case "card-buy":
		case "card-reserve":
		case "card-close":
		case "hint":
			return myTurn;
		case "noble":
			return state.noblesAvailable.some((noble) => noble.id === arg);
		case "rival":
			return arg !== viewer && state.players.some((player) => player.id === arg);
		case "score":
			return state.players.some((player) => player.id === arg);
		case "me-holdings":
		case "gem-total":
			return me !== undefined;
		case "me-reserved":
			return me !== undefined && me.reservedCards.length > 0;
		case "result":
			return state.status === "finished";
		default:
			return false;
	}
}
