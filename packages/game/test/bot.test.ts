import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	applyAction,
	botAdvice,
	botCommand,
	createGame,
	legalActions,
	redactGameForViewer,
	skipTurn,
	TOKEN_COLORS,
	type ColorCounts,
	type DevelopmentCard,
	type GameState,
	type Noble,
	type PlayerState,
	type TokenCounts,
} from "../src/index.js";

const cards = (JSON.parse(readFileSync(new URL("../../../data/cards.json", import.meta.url), "utf8")) as { cards: DevelopmentCard[] }).cards;
const nobles = (JSON.parse(readFileSync(new URL("../../../data/nobles.json", import.meta.url), "utf8")) as { nobles: Noble[] }).nobles;

const zero: ColorCounts = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
const noTokens: TokenCounts = { ...zero, gold: 0 };

function card(id: string, level: 1 | 2 | 3, bonusColor: DevelopmentCard["bonusColor"], points: number, cost: Partial<ColorCounts>): DevelopmentCard {
	return { id, level, bonusColor, points, cost: { ...zero, ...cost } };
}

function player(id: string, options: Partial<PlayerState> = {}): PlayerState {
	return { id, name: id, gems: { ...noTokens }, purchasedCards: [], reservedCards: [], hiddenReservedCardIds: [], nobles: [], ...options };
}

/** 一批「贵得买不起」的填充卡，用来把桌面摆满。 */
function filler(prefix: string, level: 1 | 2 | 3, count: number): DevelopmentCard[] {
	return Array.from({ length: count }, (_, index) => card(`${prefix}${index}`, level, "black", 0, { black: 7 }));
}

function makeState(players: PlayerState[], overrides: Partial<GameState> = {}): GameState {
	return {
		players,
		bank: { white: 4, blue: 4, green: 4, red: 4, black: 4, gold: 5 },
		market: { 1: filler("m1-", 1, 4), 2: filler("m2-", 2, 4), 3: filler("m3-", 3, 4) },
		decks: { 1: filler("d1-", 1, 5), 2: filler("d2-", 2, 5), 3: filler("d3-", 3, 5) },
		noblesAvailable: [{ id: "N-far", points: 3, requirements: { black: 4, red: 4 } }],
		startingPlayerIndex: 0,
		activePlayerIndex: 0,
		status: "active",
		finalRoundTriggered: false,
		pendingNobleIds: [],
		winnerIds: [],
		...overrides,
	};
}

function purchased(count: number, color: DevelopmentCard["bonusColor"], points = 0): DevelopmentCard[] {
	return Array.from({ length: count }, (_, index) => card(`own-${color}-${points}-${index}`, 1, color, points, {}));
}

let seed = 2024;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

describe("人机：只看自己座位能看到的信息", () => {
	it("决策只取决于 redact 之后的状态：换掉牌堆顺序和对手暗扣的卡，选择不变", () => {
		const base = createGame([{ id: "a", name: "A" }, { id: "b", name: "B" }], cards, nobles, rand);
		let state = base;
		// 让 b 暗扣一张，a 看不到内容
		state = applyAction(state, state.players[state.activePlayerIndex]!.id, { type: "takeGems", colors: ["white", "blue", "green"] });
		const other = state.players[state.activePlayerIndex]!.id;
		state = applyAction(state, other, { type: "reserveCard", source: { kind: "deck", level: 2 } });
		const me = state.players[state.activePlayerIndex]!.id;
		const view = redactGameForViewer(state, me);
		// 另一个世界：牌堆倒过来、对手暗扣的那张换成别的卡
		const twisted: GameState = {
			...state,
			decks: { 1: [...state.decks[1]].reverse(), 2: [...state.decks[2]].reverse(), 3: [...state.decks[3]].reverse() },
			players: state.players.map((p) => (p.id === other ? { ...p, reservedCards: p.reservedCards.map((c) => ({ ...c, points: 5, bonusColor: "red" as const })) } : p)),
		};
		const twistedView = redactGameForViewer(twisted, me);
		expect(JSON.stringify(twistedView.decks)).toBe(JSON.stringify(view.decks));
		expect(botCommand(view, me)).toEqual(botCommand(twistedView, me));
		// redact 之后看不到对手暗扣卡的内容和牌堆顺序
		const otherInView = view.players.find((p) => p.id === other)!;
		expect(otherInView.reservedCards[0]!.id.startsWith("hidden-")).toBe(true);
		expect(view.decks[1].every((c) => c.id.startsWith("deck-"))).toBe(true);
	});
});

describe("人机：自对弈", () => {
	for (const count of [2, 3, 4]) {
		it(`${count} 人自对弈 40 局：每一步都合法、宝石守恒、不超过 600 步`, () => {
			for (let game = 0; game < 40; game += 1) {
				const defs = Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `P${index}` }));
				let state = createGame(defs, cards, nobles, rand);
				const totals = TOKEN_COLORS.map((color) => state.bank[color]);
				let plies = 0;
				while (state.status === "active") {
					plies += 1;
					expect(plies).toBeLessThan(600);
					const id = state.players[state.activePlayerIndex]!.id;
					const action = botCommand(redactGameForViewer(state, id), id);
					state = action ? applyAction(state, id, action) : skipTurn(state);
					TOKEN_COLORS.forEach((color, index) => {
						expect(state.bank[color] + state.players.reduce((sum, p) => sum + p.gems[color], 0)).toBe(totals[index]);
					});
					for (const p of state.players) expect(TOKEN_COLORS.reduce((sum, color) => sum + p.gems[color], 0)).toBeLessThanOrEqual(10);
				}
				expect(state.winnerIds.length).toBeGreaterThan(0);
			}
		}, 60_000);
	}
});

describe("人机：关键决策", () => {
	it("最后一轮轮到自己，买下能反超的那张", () => {
		const a = player("a", { purchasedCards: purchased(5, "white", 2), gems: { ...noTokens, red: 3, green: 2 } }); // 10 分
		const b = player("b", { purchasedCards: purchased(6, "blue", 2) }); // 12 分
		const winner = card("win", 2, "red", 3, { red: 3, green: 2 });
		const cheap = card("cheap", 1, "green", 0, { red: 1 });
		const state = makeState([b, a], {
			market: { 1: [cheap, ...filler("m1-", 1, 3)], 2: [winner, ...filler("m2-", 2, 3)], 3: filler("m3-", 3, 4) },
			startingPlayerIndex: 0,
			activePlayerIndex: 1,
			finalRoundTriggered: true,
		});
		// 买 3 分到 13 分 > 12 分，赢
		expect(botCommand(redactGameForViewer(state, "a"), "a")).toEqual({ type: "buyCard", source: { kind: "market", level: 2, cardId: "win" } });
	});

	it("买得起的有分土地会买，并说出理由", () => {
		const a = player("a", { gems: { ...noTokens, blue: 3, white: 2 } });
		const target = card("pts", 1, "blue", 1, { blue: 3, white: 1 });
		const state = makeState([a, player("b")], { market: { 1: [target, ...filler("m1-", 1, 3)], 2: filler("m2-", 2, 4), 3: filler("m3-", 3, 4) } });
		const advice = botAdvice(redactGameForViewer(state, "a"), "a")!;
		expect(advice.action).toEqual({ type: "buyCard", source: { kind: "market", level: 1, cardId: "pts" } });
		expect(advice.reason).toContain("+1 分");
	});

	it("买不起时朝最近的好土地拿宝石，理由里说还差几枚", () => {
		const a = player("a");
		const target = card("aim", 1, "red", 1, { red: 1, green: 1, blue: 1, white: 1 });
		const state = makeState([a, player("b")], { market: { 1: [target, ...filler("m1-", 1, 3)], 2: filler("m2-", 2, 4), 3: filler("m3-", 3, 4) } });
		const advice = botAdvice(redactGameForViewer(state, "a"), "a")!;
		expect(advice.action.type).toBe("takeGems");
		if (advice.action.type !== "takeGems") return;
		expect(advice.action.colors).toHaveLength(3);
		expect(advice.action.colors.every((color) => ["red", "green", "blue", "white"].includes(color))).toBe(true);
		expect(advice.reason).toMatch(/还差 1 枚/);
	});

	it("对手下回合就能买到 15 分的牌：先扣下来", () => {
		const a = player("a", { gems: { ...noTokens, white: 1 } });
		const b = player("b", { purchasedCards: purchased(6, "blue", 2), gems: { ...noTokens, black: 5, red: 3 } }); // 12 分
		const danger = card("danger", 3, "black", 4, { black: 5, red: 3 });
		const state = makeState([a, b], { market: { 1: filler("m1-", 1, 4), 2: filler("m2-", 2, 4), 3: [danger, ...filler("m3-", 3, 3)] } });
		const advice = botAdvice(redactGameForViewer(state, "a"), "a")!;
		expect(advice.action).toEqual({ type: "reserveCard", source: { kind: "market", level: 3, cardId: "danger" } });
		expect(advice.reason).toContain("先扣下来");
	});

	it("超过 10 枚时按规定数量归还", () => {
		const a = player("a", { gems: { ...noTokens, white: 3, blue: 3, green: 3, red: 1 } });
		const state = makeState([a, player("b")]);
		const action = botCommand(redactGameForViewer(state, "a"), "a")!;
		const after = applyAction(state, "a", action);
		expect(TOKEN_COLORS.reduce((sum, color) => sum + after.players[0]!.gems[color], 0)).toBeLessThanOrEqual(10);
	});

	it("同时满足多位贵族时选一位", () => {
		const state = makeState([player("a", { purchasedCards: [...purchased(4, "red"), ...purchased(4, "black")] }), player("b")], {
			pendingNobleIds: ["N-1", "N-2"],
			noblesAvailable: [
				{ id: "N-1", points: 3, requirements: { red: 4, black: 4 } },
				{ id: "N-2", points: 3, requirements: { red: 3, black: 3 } },
			],
		});
		const action = botCommand(redactGameForViewer(state, "a"), "a");
		expect(action?.type).toBe("chooseNoble");
	});

	it("供应区拿空、预留已满、什么都买不起：返回 null（服务器按跳过处理）", () => {
		const a = player("a", { reservedCards: filler("r", 3, 3) });
		const state = makeState([a, player("b")], { bank: { ...noTokens } });
		expect(legalActions(redactGameForViewer(state, "a"), "a")).toEqual([]);
		expect(botCommand(redactGameForViewer(state, "a"), "a")).toBeNull();
	});

	it("一步决策耗时：平均 < 50ms", () => {
		let state = createGame([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }], cards, nobles, rand);
		let total = 0;
		let calls = 0;
		while (state.status === "active" && calls < 200) {
			const id = state.players[state.activePlayerIndex]!.id;
			const start = performance.now();
			const action = botCommand(redactGameForViewer(state, id), id);
			total += performance.now() - start;
			calls += 1;
			state = action ? applyAction(state, id, action) : skipTurn(state);
		}
		expect(total / calls).toBeLessThan(50);
	});
});
