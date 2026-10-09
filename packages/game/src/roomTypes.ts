import type { GameAction, GameState } from "./types.js";

/** 房主可选的每回合行动时长（秒）。 */
export const TURN_SECONDS_OPTIONS = [45, 60, 120] as const;
export type TurnSeconds = (typeof TURN_SECONDS_OPTIONS)[number];

export interface LobbyMember {
	readonly id: string;
	readonly name: string;
	readonly isHost: boolean;
	readonly connected: boolean;
}

/** 房主在房间里随时可以改的「谁能进来」设置。 */
export interface RoomAccess {
	/** 允许观战：有房间码、或者从首页列表都能进来看。 */
	readonly allowSpectators: boolean;
	/** 观战的人能看到所有人的手牌（上帝视角）；关掉时只看公开信息。牌堆顺序始终看不到。 */
	readonly spectatorsSeeAll: boolean;
	/** 公开房间：不认识的人也能从首页列表直接加入空座位。 */
	readonly open: boolean;
}

export const DEFAULT_ROOM_ACCESS: RoomAccess = { allowSpectators: true, spectatorsSeeAll: false, open: false };

/** 观战的人：不占座位，不能操作、投票或进语音，可以聊天。 */
export interface Spectator {
	readonly id: string;
	readonly name: string;
}

export interface LobbyRoomSnapshot {
	/** 从首页列表进来观战的人看不到房间码（空字符串）。 */
	readonly code: string;
	readonly spectators: Spectator[];
	readonly access: RoomAccess;
	readonly capacity: 2 | 3 | 4;
	readonly status: "waiting" | "playing";
	readonly members: LobbyMember[];
	readonly chat: RoomChatMessage[];
	readonly game?: GameState;
	/** 每位玩家每回合的行动时长（秒），等待大厅里由房主设置。 */
	readonly turnSeconds: TurnSeconds;
	/** 当前回合剩余的毫秒数（发送时）；超时自动跳过该玩家。 */
	readonly turnRemainingMs?: number;
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
	/** 观战的人发的。 */
	readonly spectator?: boolean;
}

export interface SendRoomChatPayload {
	readonly message: string;
}

export interface CreateRoomPayload {
	readonly name: string;
	readonly capacity: 2 | 3 | 4;
}

/** 用房间码加入，或者从首页列表按房间的公开 id 加入；spectate 为 true 时进来观战。 */
export interface JoinRoomPayload {
	readonly name: string;
	readonly code?: string;
	readonly roomId?: string;
	readonly spectate?: boolean;
}

/** 初始界面公开展示的房间概况；不含房间码、手牌和聊天内容。 */
export interface PublicRoomSummary {
	readonly id: string;
	readonly status: "waiting" | "playing" | "finished";
	readonly capacity: 2 | 3 | 4;
	readonly open: boolean;
	readonly allowSpectators: boolean;
	readonly spectators: number;
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
	"room:turnSeconds": (seconds: TurnSeconds, ack: RoomAck<void>) => void;
	"game:action": (action: GameAction, ack: RoomAck<LobbyRoomSnapshot>) => void;
	"room:chat": (payload: SendRoomChatPayload, ack: RoomAck<void>) => void;
	"lobby:get": (ack: RoomAck<PublicRoomSummary[]>) => void;
	"room:rematch": (accept: boolean, ack: RoomAck<void>) => void;
	"room:kick": (memberId: string, ack: RoomAck<void>) => void;
	"room:access": (access: Partial<RoomAccess>, ack: RoomAck<void>) => void;
	/** 等待中：观战的人坐到空座位上 / 玩家（房主除外）改成观战。 */
	"room:sit": (ack: RoomAck<void>) => void;
	"room:stand": (ack: RoomAck<void>) => void;
	"room:dissolve": (ack: RoomAck<void>) => void;
	"admin:verify": (token: string, ack: RoomAck<void>) => void;
	"admin:dissolve": (payload: { roomId: string; token: string }, ack: RoomAck<void>) => void;
	/** 游戏中心挤掉某次登录（同一账号登录的设备超出上限）时调用：断开属于这次登录的所有连接，回执是断开的连接数。 */
	"admin:kick-session": (payload: { sessionId: string; token: string }, ack: RoomAck<number>) => void;
	"voice:join": (payload: { muted: boolean }, ack: RoomAck<IceServerConfig[]>) => void;
	"voice:mute": (muted: boolean, ack: RoomAck<void>) => void;
	"voice:leave": (ack: RoomAck<void>) => void;
	"voice:signal": (payload: { to: string; data: VoiceSignal }) => void;
}

export interface ServerToClientEvents {
	"room:updated": (room: LobbyRoomSnapshot) => void;
	/** 这次登录被同一账号的新登录挤掉了；收到后连接会被断开，网页回大厅看提示。 */
	"session:kicked": () => void;
	"room:error": (message: string) => void;
	"lobby:updated": (rooms: PublicRoomSummary[]) => void;
	/** 被移出房间或房间被解散。 */
	"room:closed": (payload: { reason: string }) => void;
	"voice:signal": (payload: { from: string; data: VoiceSignal }) => void;
}