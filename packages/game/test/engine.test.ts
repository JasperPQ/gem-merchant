import { describe, expect, it } from "vitest";
import {
	applyAction,
	createGame,
	getPlayerScore,
	redactGameForViewer,
	skipTurn,
	type ColorCounts,
	type DevelopmentCard,
	type Noble,
} from "../src/index.js";

const zeroCost: ColorCounts = { white: 0, blue: 0, green: 0, red: 0, black: 0 };

function makeCard(
	id: string,
	level: 1 | 2 | 3,
	options: Partial<Pick<DevelopmentCard, "bonusColor" | "points">> & { cost?: Partial<ColorCounts> } = {},
): DevelopmentCard {
	return {
		id,
		level,
		bonusColor: options.bonusColor ?? "white",
		points: options.points ?? 0,
		cost: { ...zeroCost, ...options.cost },
	};
}

function makeNoble(id: string, requirements: Partial<ColorCounts> = { black: 99 }): Noble {
	return { id, points: 3, requirements };
}

function makeGame(nobles = Array.from({ length: 5 }, (_, index) => makeNoble(`safe-${index}`))) {
	const cards = ([1, 2, 3] as const).flatMap((level) =>
		Array.from({ length: 8 }, (_, index) => makeCard(`L${level}-${index}`, level)),
	);
	return createGame(
		[
			{ id: "p1", name: "Player 1" },
			{ id: "p2", name: "Player 2" },
		],
		cards,
		nobles,
		() => 0,
	);
}

function gemTotal(player: ReturnType<typeof makeGame>["players"][number]): number {
	return Object.values(player.gems).reduce((total, count) => total + count, 0);
}

describe("game setup", () => {
	it("sets the player-count supply and opens four cards per level", () => {
		const game = makeGame();

		expect(game.bank).toEqual({ white: 4, blue: 4, green: 4, red: 4, black: 4, gold: 5 });
		expect(game.market[1]).toHaveLength(4);
		expect(game.market[2]).toHaveLength(4);
		expect(game.market[3]).toHaveLength(4);
		expect(game.noblesAvailable).toHaveLength(3);
		expect(game.activePlayerIndex).toBe(0);
	});
});

describe("player actions", () => {
	it("takes three different gems and advances the turn", () => {
		const game = makeGame();
		const next = applyAction(game, "p1", { type: "takeGems", colors: ["white", "blue", "green"] });

		expect(next.players[0]?.gems).toMatchObject({ white: 1, blue: 1, green: 1 });
		expect(next.bank).toMatchObject({ white: 3, blue: 3, green: 3 });
		expect(next.players[next.activePlayerIndex]?.id).toBe("p2");
	});

	it("allows taking one or more available colors when fewer than three remain", () => {
		const game = makeGame();
		game.bank = { white: 1, blue: 1, green: 0, red: 0, black: 0, gold: 5 };

		const next = applyAction(game, "p1", { type: "takeGems", colors: ["white", "blue"] });
		const oneGemGame = makeGame();
		oneGemGame.bank = { white: 1, blue: 1, green: 0, red: 0, black: 0, gold: 5 };
		const oneGemTurn = applyAction(oneGemGame, "p1", { type: "takeGems", colors: ["white"] });

		expect(next.players[0]?.gems.white).toBe(1);
		expect(next.players[0]?.gems.blue).toBe(1);
		expect(oneGemTurn.players[0]?.gems.white).toBe(1);
		expect(oneGemTurn.players[0]?.gems.blue).toBe(0);
	});

	it("requires four gems in the bank to take two of one color", () => {
		const game = makeGame();
		game.bank.white = 3;

		expect(() => applyAction(game, "p1", { type: "takeGems", colors: ["white", "white"] }))
			.toThrow("at least 4");
		expect(game.bank.white).toBe(3);
	});

	it("requires the player to return exactly the excess over ten gems", () => {
		const game = makeGame();
		game.players[0]!.gems.white = 9;

		expect(() => applyAction(game, "p1", {
			type: "takeGems",
			colors: ["blue", "green", "red"],
		})).toThrow("Return exactly 2");
		expect(gemTotal(game.players[0]!)).toBe(9);

		const next = applyAction(game, "p1", {
			type: "takeGems",
			colors: ["blue", "green", "red"],
			returnGems: { blue: 1, green: 1 },
		});
		expect(gemTotal(next.players[0]!)).toBe(10);
	});

	it("reserves a market card, takes gold, and refills the market", () => {
		const game = makeGame();
		const card = game.market[1][0]!;
		const next = applyAction(game, "p1", {
			type: "reserveCard",
			source: { kind: "market", level: 1, cardId: card.id },
		});

		expect(next.players[0]?.reservedCards.map((reserved) => reserved.id)).toContain(card.id);
		expect(next.players[0]?.gems.gold).toBe(1);
		expect(next.market[1]).toHaveLength(4);
		expect(next.bank.gold).toBe(4);
	});

	it("awards gold when reserving a card and prevents opponents from buying it", () => {
		const game = makeGame();
		const [firstPlayer, secondPlayer] = game.players;
		const reservedCard = game.market[1][0]!;
		const afterReserve = applyAction(game, firstPlayer!.id, {
			type: "reserveCard",
			source: { kind: "market", level: 1, cardId: reservedCard.id },
		});

		expect(afterReserve.players[0]?.reservedCards.map((card) => card.id)).toContain(reservedCard.id);
		expect(afterReserve.players[0]?.gems.gold).toBe(1);
		expect(afterReserve.players[1]?.reservedCards.map((card) => card.id)).not.toContain(reservedCard.id);
		expect(afterReserve.market[1].map((card) => card.id)).not.toContain(reservedCard.id);

		expect(() => applyAction(afterReserve, secondPlayer!.id, {
			type: "buyCard",
			source: { kind: "reserved", cardId: reservedCard.id },
		})).toThrow("not available to buy");
		expect(afterReserve.players[0]?.reservedCards.map((card) => card.id)).toContain(reservedCard.id);

		const opponentTurn = applyAction(afterReserve, secondPlayer!.id, {
			type: "takeGems",
			colors: ["white", "blue", "green"],
		});
		const ownerBuysReservedCard = applyAction(opponentTurn, firstPlayer!.id, {
			type: "buyCard",
			source: { kind: "reserved", cardId: reservedCard.id },
		});
		expect(ownerBuysReservedCard.players[0]?.purchasedCards.map((card) => card.id)).toContain(reservedCard.id);
		expect(ownerBuysReservedCard.players[0]?.reservedCards).toHaveLength(0);
	});

	it("hides deck-reserved cards and deck contents from other players only", () => {
		const game = makeGame();
		const actor = game.players[game.activePlayerIndex]!;
		const other = game.players.find((candidate) => candidate.id !== actor.id)!;
		const deckTop = game.decks[2][game.decks[2].length - 1]!;
		const marketCard = game.market[1][0]!;

		const afterDeckReserve = applyAction(game, actor.id, { type: "reserveCard", source: { kind: "deck", level: 2 } });
		expect(afterDeckReserve.players.find((p) => p.id === actor.id)?.hiddenReservedCardIds).toEqual([deckTop.id]);
		const afterMarketReserve = applyAction(afterDeckReserve, other.id, {
			type: "reserveCard",
			source: { kind: "market", level: 1, cardId: marketCard.id },
		});

		const otherView = redactGameForViewer(afterMarketReserve, other.id);
		const actorSeenByOther = otherView.players.find((p) => p.id === actor.id)!;
		expect(actorSeenByOther.reservedCards).toHaveLength(1);
		expect(actorSeenByOther.reservedCards[0]?.level).toBe(2);
		expect(actorSeenByOther.hiddenReservedCardIds).toEqual([actorSeenByOther.reservedCards[0]?.id]);
		expect(JSON.stringify(otherView)).not.toContain(`"${deckTop.id}"`);
		expect(otherView.decks[2]).toHaveLength(afterMarketReserve.decks[2].length);
		expect(otherView.decks[3].map((card) => card.id)).not.toContain(afterMarketReserve.decks[3][0]?.id);

		const actorView = redactGameForViewer(afterMarketReserve, actor.id);
		expect(actorView.players.find((p) => p.id === actor.id)?.reservedCards[0]?.id).toBe(deckTop.id);
		expect(actorView.players.find((p) => p.id === other.id)?.reservedCards[0]?.id).toBe(marketCard.id);

		const afterBuy = applyAction(afterMarketReserve, actor.id, {
			type: "buyCard",
			source: { kind: "reserved", cardId: deckTop.id },
		});
		const actorAfterBuy = afterBuy.players.find((p) => p.id === actor.id)!;
		expect(actorAfterBuy.hiddenReservedCardIds).toEqual([]);
		expect(actorAfterBuy.purchasedCards.map((card) => card.id)).toContain(deckTop.id);
	});

	it("pays with matching gems first and uses gold for the remaining discounted cost", () => {
		const game = makeGame();
		const discount = makeCard("discount", 1, { bonusColor: "red" });
		const target = makeCard("target", 1, { cost: { red: 2, blue: 1 } });
		game.players[0]!.purchasedCards.push(discount);
		game.players[0]!.gems.red = 1;
		game.players[0]!.gems.gold = 1;
		game.bank.gold -= 1;
		game.market[1][0] = target;

		const next = applyAction(game, "p1", {
			type: "buyCard",
			source: { kind: "market", level: 1, cardId: "target" },
		});

		expect(next.players[0]?.purchasedCards.map((purchased) => purchased.id)).toContain("target");
		expect(next.players[0]?.gems.red).toBe(0);
		expect(next.players[0]?.gems.gold).toBe(0);
		expect(next.bank.red).toBe(5);
		expect(next.bank.gold).toBe(5);
	});

	it("requires a choice when multiple nobles are eligible and awards only one", () => {
		const nobles = [
			makeNoble("white", { white: 1 }),
			makeNoble("blue", { blue: 1 }),
			makeNoble("safe"),
		];
		const game = makeGame(nobles);
		game.players[0]!.purchasedCards.push(
			makeCard("white-bonus", 1, { bonusColor: "white" }),
			makeCard("blue-bonus", 1, { bonusColor: "blue" }),
		);

		const choiceState = applyAction(game, "p1", {
			type: "takeGems",
			colors: ["white", "blue", "green"],
		});
		expect(choiceState.pendingNobleIds).toHaveLength(2);

		const next = applyAction(choiceState, "p1", { type: "chooseNoble", nobleId: "white" });
		expect(next.players[0]?.nobles.map((noble) => noble.id)).toEqual(["white"]);
		expect(next.noblesAvailable.map((noble) => noble.id)).toContain("blue");
		expect(next.pendingNobleIds).toEqual([]);
		expect(next.players[next.activePlayerIndex]?.id).toBe("p2");
	});

	it("skips a timed-out turn without changing anyone's holdings", () => {
		const game = makeGame();
		const next = skipTurn(game);
		expect(next.players[next.activePlayerIndex]?.id).toBe("p2");
		expect(next.players).toEqual(game.players);
		expect(next.bank).toEqual(game.bank);
		expect(game.activePlayerIndex).toBe(0);
	});

	it("claims the first eligible noble when a pending choice times out", () => {
		const game = makeGame([makeNoble("white", { white: 1 }), makeNoble("blue", { blue: 1 }), makeNoble("safe")]);
		game.players[0]!.purchasedCards.push(
			makeCard("white-bonus", 1, { bonusColor: "white" }),
			makeCard("blue-bonus", 1, { bonusColor: "blue" }),
		);
		const choiceState = applyAction(game, "p1", { type: "takeGems", colors: ["white", "blue", "green"] });
		const next = skipTurn(choiceState);
		expect(next.players[0]?.nobles.map((noble) => noble.id)).toEqual([choiceState.pendingNobleIds[0]]);
		expect(next.pendingNobleIds).toEqual([]);
		expect(next.players[next.activePlayerIndex]?.id).toBe("p2");
	});

	it("finishes only after the final round gives every player an equal turn", () => {
		const game = makeGame();
		game.players[0]!.purchasedCards.push(makeCard("almost-winner", 3, { points: 14 }));
		const winningCard = makeCard("last-point", 1, { points: 1 });
		game.market[1][0] = winningCard;

		const afterTrigger = applyAction(game, "p1", {
			type: "buyCard",
			source: { kind: "market", level: 1, cardId: "last-point" },
		});
		expect(afterTrigger.finalRoundTriggered).toBe(true);
		expect(afterTrigger.status).toBe("active");

		const finished = applyAction(afterTrigger, "p2", {
			type: "takeGems",
			colors: ["white", "blue", "green"],
		});
		expect(finished.status).toBe("finished");
		expect(finished.winnerIds).toEqual(["p1"]);
		expect(getPlayerScore(finished.players[0]!)).toBe(15);
	});
});