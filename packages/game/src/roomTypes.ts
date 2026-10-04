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
	/** 整轮结束后的「是否继续」投票；remainingMs 为发送时剩余的毫秒数。 */
	readonly rematch?: RematchState;
	/** 当前在语音里的成员。 */
	readonly voice: VoiceParticipant[];
}

export interface VoiceParticipant {
	readonly id: string;
	readonly muted: boolean;
}

/** 传给浏览器 RTCPeerConnection 的 STUN/TURN 配置。 */
export interface IceServerConfig {
	urls: string | string[];
	username?: string;
	credential?: string;
}

/** 语音连接协商消息，由服务器在同一房间的两位成员之间转发。 */
export type VoiceSignal =
	| { readonly description: { readonly type: "offer" | "answer"; readonly sdp: string } }
	| { readonly candidate: { readonly candidate: string; readonly sdpMid: string | null; readonly sdpMLineIndex: number | null } };

export interface RematchState {
	readonly remainingMs: number;
	readonly acceptedIds: string[];
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

export type AckResponse<T> = { ok: true; data: T } | { ok: false; error: string };
export type RoomAck<T> = (response: AckResponse<T>) => void;

export interface ClientToServerEvents {
	"room:create": (payload: CreateRoomPayload, ack: RoomAck<LobbyRoomSnapshot>) => void;
	"room:join": (payload: JoinRoomPayload, ack: RoomAck<LobbyRoomSnapshot>) => void;
	"room:start": (ack: RoomAck<LobbyRoomSnapshot>) => void;
	"room:leave": (ack: RoomAck<void>) => void;
	"game:action": (action: GameAction, ack: RoomAck<LobbyRoomSnapshot>) => void;
	"room:chat": (payload: SendRoomChatPayload, ack: RoomAck<void>) => void;
	"lobby:get": (ack: RoomAck<PublicRoomSummary[]>) => void;
	"room:rematch": (accept: boolean, ack: RoomAck<void>) => void;
	"room:kick": (memberId: string, ack: RoomAck<void>) => void;
	"room:dissolve": (ack: RoomAck<void>) => void;
	"admin:verify": (token: string, ack: RoomAck<void>) => void;
	"admin:dissolve": (payload: { roomId: string; token: string }, ack: RoomAck<void>) => void;
	"voice:join": (payload: { muted: boolean }, ack: RoomAck<IceServerConfig[]>) => void;
	"voice:mute": (muted: boolean, ack: RoomAck<void>) => void;
	"voice:leave": (ack: RoomAck<void>) => void;
	"voice:signal": (payload: { to: string; data: VoiceSignal }) => void;
}

export interface ServerToClientEvents {
	"room:updated": (room: LobbyRoomSnapshot) => void;
	"room:error": (message: string) => void;
	"lobby:updated": (rooms: PublicRoomSummary[]) => void;
	/** 被移出房间或房间被解散。 */
	"room:closed": (payload: { reason: string }) => void;
	"voice:signal": (payload: { from: string; data: VoiceSignal }) => void;
}