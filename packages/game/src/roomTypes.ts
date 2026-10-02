import type { GameAction, GameState } from "./types.js";

export interface LobbyMember {
	readonly id: string;
	readonly name: string;
	readonly isHost: boolean;
	readonly connected: boolean;
}

export interface LobbyRoomSnapshot {
	readonly code: string;
	readonly capacity: 2 | 3 | 4;
	readonly status: "waiting" | "playing";
	readonly members: LobbyMember[];
	readonly chat: RoomChatMessage[];
	readonly game?: GameState;
}

export interface RoomChatMessage {
	readonly id: string;
	readonly senderId: string;
	readonly name: string;
	readonly message: string;
	readonly createdAt: string;
}

export interface SendRoomChatPayload {
	readonly message: string;
}

export interface CreateRoomPayload {
	readonly name: string;
	readonly capacity: 2 | 3 | 4;
}

export interface JoinRoomPayload {
	readonly name: string;
	readonly code: string;
}

/** 初始界面公开展示的房间概况；不含房间码、手牌和聊天内容。 */
export interface PublicRoomSummary {
	readonly id: string;
	readonly status: "waiting" | "playing" | "finished";
	readonly capacity: 2 | 3 | 4;
	readonly players: {
		readonly name: string;
		readonly isHost: boolean;
		readonly connected: boolean;
		readonly score?: number;
		readonly isActive?: boolean;
		readonly isWinner?: boolean;
	}[];
}

export interface GuestbookEntry {
	readonly id: string;
	readonly name: string;
	readonly message: string;
	readonly createdAt: string;
}

export interface SubmitGuestbookEntry {
	readonly name?: string;
	readonly message: string;
}

export type AckResponse<T> = { ok: true; data: T } | { ok: false; error: string };
export type RoomAck<T> = (response: AckResponse<T>) => void;

export interface ClientToServerEvents {
	"room:create": (payload: CreateRoomPayload, ack: RoomAck<LobbyRoomSnapshot>) => void;
	"room:join": (payload: JoinRoomPayload, ack: RoomAck<LobbyRoomSnapshot>) => void;
	"room:start": (ack: RoomAck<LobbyRoomSnapshot>) => void;
	"room:leave": (ack: RoomAck<void>) => void;
	"game:action": (action: GameAction, ack: RoomAck<LobbyRoomSnapshot>) => void;
	"room:chat": (payload: SendRoomChatPayload, ack: RoomAck<void>) => void;
	"guestbook:get": (ack: RoomAck<GuestbookEntry[]>) => void;
	"lobby:get": (ack: RoomAck<PublicRoomSummary[]>) => void;
	"guestbook:post": (payload: SubmitGuestbookEntry, ack: RoomAck<GuestbookEntry[]>) => void;
}

export interface ServerToClientEvents {
	"room:updated": (room: LobbyRoomSnapshot) => void;
	"room:error": (message: string) => void;
	"guestbook:updated": (entries: GuestbookEntry[]) => void;
	"lobby:updated": (rooms: PublicRoomSummary[]) => void;
}