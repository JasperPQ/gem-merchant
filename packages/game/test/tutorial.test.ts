import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	anchorVisible,
	applyAction,
	botCommand,
	createPracticeGame,
	createTutorialGame,
	getPlayerBonuses,
	getPlayerScore,
	legalActions,
	redactGameForViewer,
	sameCommand,
	skipTurn,
	TOKEN_COLORS,
	TUTORIAL_FINAL_STEP,
	TUTORIAL_RIVAL,
	TUTORIAL_SELF,
	TUTORIAL_STEPS,
	tutorialApply,
	type DevelopmentCard,
	type GameState,
	type Noble,
} from "../src/index.js";

const cards = (JSON.parse(readFileSync(new URL("../../../data/cards.json", import.meta.url), "utf8")) as { cards: DevelopmentCard[] }).cards;
const nobles = (JSON.parse(readFileSync(new URL("../../../data/nobles.json", import.meta.url), "utf8")) as { nobles: Noble[] }).nobles;

const actor = (game: GameState) => game.players[game.activePlayerIndex]!.id;
const seat = (game: GameState, id: string) => game.players.find((player) => player.id === id)!;
const stepIndex = (id: string) => TUTORIAL_STEPS.findIndex((step) => step.id === id);

/** 按剧本走到第 upTo 步之前（不含），返回那时的局面。 */
function playScript(upTo = TUTORIAL_STEPS.length): GameState {
	let game = createTutorialGame("小蒲", cards, nobles);
	for (const step of TUTORIAL_STEPS.slice(0, upTo)) {
		if (step.kind === "do") game = tutorialApply(game, TUTORIAL_SELF, step.expect, cards);
		if (step.kind === "watch") for (const move of step.moves) game = tutorialApply(game, actor(game), move, cards);
	}
	return game;
}

/** 宝石总数守恒：每种普通宝石 4 枚（两人局）、金色 5 枚。 */
function expectTokensConserved(game: GameState) {
	for (const color of TOKEN_COLORS) {
		const total = game.bank[color] + game.players.reduce((sum, player) => sum + player.gems[color], 0);
		expect(total, `${color} 不守恒`).toBe(color === "gold" ? 5 : 4);
	}
}

/** 一张卡只能出现在一个地方。 */
function expectCardsUnique(game: GameState) {
	const ids = [
		...game.market[1], ...game.market[2], ...game.market[3],
		...game.decks[1], ...game.decks[2], ...game.decks[3],
		...game.players.flatMap((player) => [...player.purchasedCards, ...player.reservedCards]),
	].map((card) => card.id);
	expect(new Set(ids).size).toBe(ids.length);
	// 剧本只摆一部分牌（快进前后各自那一份），但都来自真卡牌数据
	expect(ids.every((id) => cards.some((card) => card.id === id))).toBe(true);
}

describe("新手教程剧本", () => {
	it("开局摆法：两人局，你先手，桌上 12 张、3 位贵族，牌不重复", () => {
		const game = createTutorialGame("小蒲", cards, nobles);
		expect(actor(game)).toBe(TUTORIAL_SELF);
		expect(game.market[1].map((card) => card.id)).toEqual(["L1-02", "L1-12", "L1-13", "L1-14"]);
		expect(game.noblesAvailable.map((noble) => noble.id)).toEqual(["N-03", "N-07", "N-10"]);
		expectTokensConserved(game);
		expectCardsUnique(game);
	});

	it("从头走到尾：每一步要你做的都合法、轮到的是对的人，高亮的东西在界面上看得见", () => {
		let game = createTutorialGame("小蒲", cards, nobles);
		for (const step of TUTORIAL_STEPS) {
			if (step.anchor) expect(anchorVisible(game, step.anchor, TUTORIAL_SELF), `「${step.id}」高亮的 ${step.anchor} 看不见`).toBe(true);
			if (step.kind === "do") {
				expect(actor(game), `「${step.id}」不是轮到你`).toBe(TUTORIAL_SELF);
				expect(legalActions(game, TUTORIAL_SELF).some((action) => sameCommand(action, step.expect)), `「${step.id}」不合法`).toBe(true);
				// 点卡以后的弹窗按钮
				if (step.expect.type === "buyCard") expect(anchorVisible(game, "card-buy", TUTORIAL_SELF)).toBe(true);
				if (step.expect.type === "reserveCard") expect(anchorVisible(game, "card-reserve", TUTORIAL_SELF)).toBe(true);
				game = tutorialApply(game, TUTORIAL_SELF, step.expect, cards);
			}
			if (step.kind === "watch") {
				for (const move of step.moves) {
					const who = actor(game);
					if (move.type !== "FAST_FORWARD") expect(who, `「${step.id}」该咕噜一号走`).toBe(TUTORIAL_RIVAL);
					game = tutorialApply(game, who, move, cards);
				}
			}
			expectTokensConserved(game);
			expectCardsUnique(game);
			// 剧本里谁都不会超过 10 枚，不会弹「归还」
			for (const player of game.players) expect(TOKEN_COLORS.reduce((sum, color) => sum + player.gems[color], 0)).toBeLessThanOrEqual(10);
			// 剧本里不会同时满足多位贵族（不需要选）
			expect(game.pendingNobleIds).toEqual([]);
		}
		expect(game.status).toBe("finished");
	});

	it("关键几幕：买第一块得到黑色折扣；预留拿到金色；贵族来访 +3；到 15 分触发最后一轮；15 比 14 你赢", () => {
		const afterBuy = playScript(stepIndex("discount"));
		expect(getPlayerBonuses(seat(afterBuy, TUTORIAL_SELF)).black).toBe(1);
		expect(seat(afterBuy, TUTORIAL_SELF).gems).toEqual({ white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 });

		const afterReserve = playScript(stepIndex("reserved"));
		expect(seat(afterReserve, TUTORIAL_SELF).gems.gold).toBe(1);
		expect(seat(afterReserve, TUTORIAL_SELF).reservedCards.map((card) => card.id)).toEqual(["L2-21"]);

		const late = playScript(stepIndex("late"));
		expect(getPlayerScore(seat(late, TUTORIAL_SELF))).toBe(8);
		expect(getPlayerScore(seat(late, TUTORIAL_RIVAL))).toBe(12);
		expect(getPlayerBonuses(seat(late, TUTORIAL_SELF))).toMatchObject({ black: 3, red: 3, green: 2 });

		const visited = playScript(stepIndex("noble-visit"));
		const me = seat(visited, TUTORIAL_SELF);
		expect(me.nobles.map((noble) => noble.id)).toEqual(["N-03"]);
		expect(getPlayerScore(me)).toBe(13);
		expect(me.gems.gold).toBe(0);

		const fifteen = playScript(stepIndex("final-round"));
		expect(getPlayerScore(seat(fifteen, TUTORIAL_SELF))).toBe(15);
		expect(fifteen.finalRoundTriggered).toBe(true);
		expect(fifteen.status).toBe("active");
		expect(actor(fifteen)).toBe(TUTORIAL_RIVAL);

		const done = playScript(stepIndex(TUTORIAL_FINAL_STEP));
		expect(done.status).toBe("finished");
		expect(getPlayerScore(seat(done, TUTORIAL_RIVAL))).toBe(14);
		expect(done.winnerIds).toEqual([TUTORIAL_SELF]);
	});

	it("剧本自身：id 不重复，finale 唯一且在最后，每步都有话说，主句不长", () => {
		const ids = TUTORIAL_STEPS.map((step) => step.id);
		expect(new Set(ids).size).toBe(ids.length);
		const finales = TUTORIAL_STEPS.filter((step) => step.kind === "info" && step.finale);
		expect(finales).toHaveLength(1);
		expect(TUTORIAL_STEPS.at(-1)).toBe(finales[0]);
		for (const step of TUTORIAL_STEPS) {
			expect(step.say.length).toBeGreaterThan(0);
			expect(step.say.length, `「${step.id}」主句太长`).toBeLessThanOrEqual(32);
			if (step.note) expect(step.note.length, `「${step.id}」补充太长`).toBeLessThanOrEqual(60);
		}
		expect(stepIndex(TUTORIAL_FINAL_STEP)).toBeGreaterThan(0);
	});

	it("剧本走完接练习局：两边都交给人机，120 局都能打完", () => {
		let seed = 99;
		const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
		let stuck = 0;
		for (let round = 0; round < 120; round += 1) {
			let game = createPracticeGame("小蒲", cards, nobles, random);
			let plies = 0;
			while (game.status === "active" && plies < 600) {
				plies += 1;
				const id = actor(game);
				const action = botCommand(redactGameForViewer(game, id), id);
				game = action ? applyAction(game, id, action) : skipTurn(game);
			}
			if (game.status !== "finished") stuck += 1;
		}
		expect(stuck).toBe(0);
	}, 60_000);
});
