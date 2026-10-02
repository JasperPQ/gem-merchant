export const GEM_COLORS = ["white", "blue", "green", "red", "black"] as const;
export type GemColor = (typeof GEM_COLORS)[number];

export const TOKEN_COLORS = [...GEM_COLORS, "gold"] as const;
export type TokenColor = (typeof TOKEN_COLORS)[number];

export const CARD_LEVELS = [1, 2, 3] as const;
export type CardLevel = (typeof CARD_LEVELS)[number];

export type ColorCounts = Record<GemColor, number>;
export type TokenCounts = Record<TokenColor, number>;

export interface DevelopmentCard {
	readonly id: string;
	readonly level: CardLevel;
	readonly bonusColor: GemColor;
	readonly points: number;
	readonly cost: ColorCounts;
}

export interface Noble {
	readonly id: string;
	readonly points: number;
	readonly requirements: Partial<ColorCounts>;
}

export interface PlayerDefinition {
	readonly id: string;
	readonly name: string;
}

export interface PlayerState {
	id: string;
	name: string;
	gems: TokenCounts;
	purchasedCards: DevelopmentCard[];
	reservedCards: DevelopmentCard[];
	/** 从牌库暗抽预留的卡牌 id；其他玩家看不到这些卡的内容。 */
	hiddenReservedCardIds: string[];
	nobles: Noble[];
}

export type Market = Record<CardLevel, DevelopmentCard[]>;
export type Decks = Record<CardLevel, DevelopmentCard[]>;

export interface GameState {
	players: PlayerState[];
	bank: TokenCounts;
	market: Market;
	decks: Decks;
	noblesAvailable: Noble[];
	startingPlayerIndex: number;
	activePlayerIndex: number;
	status: "active" | "finished";
	finalRoundTriggered: boolean;
	pendingNobleIds: string[];
	winnerIds: string[];
}

export type GemReturn = Partial<TokenCounts>;

export type GameAction =
	| { type: "takeGems"; colors: GemColor[]; returnGems?: GemReturn }
	| {
			type: "reserveCard";
			source:
				| { kind: "market"; level: CardLevel; cardId: string }
				| { kind: "deck"; level: CardLevel };
			returnGems?: GemReturn;
		}
	| {
			type: "buyCard";
			source:
				| { kind: "market"; level: CardLevel; cardId: string }
				| { kind: "reserved"; cardId: string };
		}
	| { type: "chooseNoble"; nobleId: string };

export type RuleErrorCode =
	| "INVALID_GAME_DATA"
	| "INVALID_PLAYER_COUNT"
	| "GAME_FINISHED"
	| "NOT_ACTIVE_PLAYER"
	| "NOBLE_CHOICE_REQUIRED"
	| "NO_PENDING_NOBLE_CHOICE"
	| "INVALID_ACTION"
	| "INSUFFICIENT_SUPPLY"
	| "RESERVE_LIMIT_REACHED"
	| "CARD_NOT_AVAILABLE"
	| "DECK_EMPTY"
	| "CANNOT_AFFORD_CARD"
	| "INVALID_RETURN"
	| "GEM_LIMIT_EXCEEDED";

export class RuleViolation extends Error {
	constructor(
		public readonly code: RuleErrorCode,
		message: string,
	) {
		super(message);
		this.name = "RuleViolation";
	}
}