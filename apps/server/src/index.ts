import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Server } from "socket.io";
import {
  applyAction,
  createGame,
  getPlayerScore,
  redactGameForViewer,
  skipTurn,
  TURN_SECONDS_OPTIONS,
  type ClientToServerEvents,
  type IceServerConfig,
  type CreateRoomPayload,
  type DevelopmentCard,
  type JoinRoomPayload,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type Noble,
  type PublicRoomSummary,
  type RoomChatMessage,
  type ServerToClientEvents,
  type TurnSeconds,
  type VoiceSignal,
} from "@gem-merchant/game";

interface RoomState {
  code: string;
  /** 对外展示用的随机标识，不泄露房间码。 */
  publicId: string;
  capacity: 2 | 3 | 4;
  status: "waiting" | "playing";
  ownerId: string;
  members: LobbyMember[];
  chat: RoomChatMessage[];
  game?: ReturnType<typeof createGame>;
  /** 对局中所有玩家都离线时启动的关闭计时器。 */
  abandonTimer?: ReturnType<typeof setTimeout>;
  /** 在语音里的成员及其是否静音。 */
  voice: Map<string, { muted: boolean }>;
  /** 整轮结束后的继续投票。 */
  rematch?: { deadline: number; accepted: Set<string>; timer: ReturnType<typeof setTimeout> };
  /** 每回合行动时长（秒），房主在等待大厅设置。 */
  turnSeconds: TurnSeconds;
  /** 当前回合的截止时间；到点自动跳过当前玩家。 */
  turn?: { deadline: number; timer: ReturnType<typeof setTimeout> };
}

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const ROOM_CHAT_LIMIT = 100;
const ROOM_CHAT_MAX_LENGTH = 200;
const ROOM_CHAT_RATE_LIMIT_MS = 1_000;
const ROOM_ABANDON_MS = Number(process.env.ROOM_ABANDON_MS ?? 2 * 60_000);
const REMATCH_TIMEOUT_MS = Number(process.env.REMATCH_TIMEOUT_MS ?? 60_000);
const ADMIN_RETRY_DELAY_MS = 2_000;
const VOICE_SIGNAL_MAX_LENGTH = 20_000;
const DEFAULT_TURN_SECONDS: TurnSeconds = 60;
const TURN_CREDENTIAL_TTL_SECONDS = 24 * 60 * 60;
const rooms = new Map<string, RoomState>();
const socketRooms = new Map<string, string>();
const roomChatTimes = new Map<string, number>();
const adminFailureTimes = new Map<string, number>();

const cardsFile = JSON.parse(
  readFileSync(new URL("../../../data/cards.json", import.meta.url), "utf8"),
) as { cards: DevelopmentCard[] };
const noblesFile = JSON.parse(
  readFileSync(new URL("../../../data/nobles.json", import.meta.url), "utf8"),
) as { nobles: Noble[] };
export const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "gem-merchant-server" }));
    return;
  }
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

const configuredWebOrigins = new Set(
  (process.env.WEB_ORIGINS ?? process.env.WEB_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [first, second] = octets as [number, number, number, number];
  return first === 10 || first === 192 && second === 168 || first === 172 && second >= 16 && second <= 31;
}

function isAllowedWebOrigin(origin: string | undefined): boolean {
  if (!origin || configuredWebOrigins.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:"
      && parsed.port === "5173"
      && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || isPrivateIpv4(parsed.hostname));
  } catch {
    return false;
  }
}

export const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: (origin, callback) => callback(null, isAllowedWebOrigin(origin)),
    methods: ["GET", "POST"],
  },
});

function normalizeChatMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const message = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ");
  return message.length >= 1 && message.length <= ROOM_CHAT_MAX_LENGTH ? message : null;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 18 ? name : null;
}

function normalizeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "");
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code) ? code : null;
}

function isCapacity(value: unknown): value is 2 | 3 | 4 {
  return value === 2 || value === 3 || value === 4;
}

function generateRoomCode(): string {
  return Array.from({ length: ROOM_CODE_LENGTH }, () =>
    ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)],
  ).join("");
}

function snapshot(room: RoomState, viewerId: string): LobbyRoomSnapshot {
  return {
    code: room.code,
    capacity: room.capacity,
    status: room.status,
    members: room.members.map((member) => ({ ...member })),
    chat: room.chat.map((entry) => ({ ...entry })),
    voice: [...room.voice].map(([id, state]) => ({ id, muted: state.muted })),
    turnSeconds: room.turnSeconds,
    ...(room.turn ? { turnRemainingMs: Math.max(0, room.turn.deadline - Date.now()) } : {}),
    ...(room.rematch ? { rematch: { remainingMs: Math.max(0, room.rematch.deadline - Date.now()), acceptedIds: [...room.rematch.accepted] } } : {}),
    ...(room.game ? { game: redactGameForViewer(room.game, viewerId) } : {}),
  };
}

function roomSummaries(): PublicRoomSummary[] {
  const order = { playing: 0, waiting: 1, finished: 2 } as const;
  return [...rooms.values()]
    .map((room): PublicRoomSummary => {
      const game = room.game;
      const status = room.status === "waiting" ? "waiting" : game?.status === "finished" ? "finished" : "playing";
      const activeId = game?.status === "active" ? game.players[game.activePlayerIndex]?.id : undefined;
      return {
        id: room.publicId,
        status,
        capacity: room.capacity,
        players: room.members.map((member) => {
          const player = game?.players.find((candidate) => candidate.id === member.id);
          return {
            name: member.name,
            isHost: member.isHost,
            connected: member.connected,
            ...(player ? {
              score: getPlayerScore(player),
              isActive: player.id === activeId,
              isWinner: game!.winnerIds.includes(player.id),
            } : {}),
          };
        }),
      };
    })
    .sort((left, right) => order[left.status] - order[right.status]);
}

/** 「在线牌桌」列表最多每秒推送一次，期间的变化合并到下一次。 */
const LOBBY_UPDATE_INTERVAL_MS = 1_000;
let lobbyUpdateTimer: ReturnType<typeof setTimeout> | undefined;
let lobbyUpdatePending = false;

/** 只推送给停留在首页（不在任何房间里）的连接；房间里的玩家看不到这个列表。 */
function sendLobbyUpdate(): void {
  const summaries = roomSummaries();
  for (const [socketId, client] of io.sockets.sockets) {
    if (!socketRooms.has(socketId)) client.emit("lobby:updated", summaries);
  }
}

function emitLobbyUpdate(): void {
  if (lobbyUpdateTimer) {
    lobbyUpdatePending = true;
    return;
  }
  sendLobbyUpdate();
  const flush = () => {
    if (!lobbyUpdatePending) {
      lobbyUpdateTimer = undefined;
      return;
    }
    lobbyUpdatePending = false;
    sendLobbyUpdate();
    lobbyUpdateTimer = setTimeout(flush, LOBBY_UPDATE_INTERVAL_MS);
    lobbyUpdateTimer.unref();
  };
  lobbyUpdateTimer = setTimeout(flush, LOBBY_UPDATE_INTERVAL_MS);
  lobbyUpdateTimer.unref();
}

function emitRoomUpdate(room: RoomState): void {
  // 每位成员单独发送，隐藏牌库和他人暗抽预留卡的内容。
  for (const member of room.members) {
    io.to(member.id).emit("room:updated", snapshot(room, member.id));
  }
  emitLobbyUpdate();
}

function findRoomForSocket(socketId: string): RoomState | undefined {
  const code = socketRooms.get(socketId);
  return code ? rooms.get(code) : undefined;
}

function removeWaitingMember(socketId: string): void {
  const code = socketRooms.get(socketId);
  if (!code) return;
  socketRooms.delete(socketId);
  rooms.get(code)?.voice.delete(socketId);

  const room = rooms.get(code);
  if (!room) return;
  if (room.status === "playing") {
    room.members = room.members.map((member) =>
      member.id === socketId ? { ...member, connected: false } : member,
    );
    if (room.members.every((member) => !member.connected)) scheduleAbandonedRoomClose(room);
    emitRoomUpdate(room);
    return;
  }

  room.members = room.members.filter((member) => member.id !== socketId);
  if (room.members.length === 0) {
    rooms.delete(code);
    emitLobbyUpdate();
    return;
  }
  if (room.ownerId === socketId) {
    room.ownerId = room.members[0]!.id;
    room.members = room.members.map((member) => ({
      ...member,
      isHost: member.id === room.ownerId,
    }));
  }
  emitRoomUpdate(room);
}

/** 所有玩家离线满 ROOM_ABANDON_MS 后关闭房间；期间有人重新加入则取消。 */
function scheduleAbandonedRoomClose(room: RoomState): void {
  clearTimeout(room.abandonTimer);
  room.abandonTimer = setTimeout(() => {
    if (rooms.get(room.code) !== room || room.members.some((member) => member.connected)) return;
    rooms.delete(room.code);
    emitLobbyUpdate();
  }, ROOM_ABANDON_MS);
  room.abandonTimer.unref();
}

/** 通知某个连接已被移出房间，并断开它和房间的关联。 */
function closeMemberConnection(room: RoomState, memberId: string, reason: string): void {
  socketRooms.delete(memberId);
  const memberSocket = io.sockets.sockets.get(memberId);
  if (!memberSocket) return;
  void memberSocket.leave(room.code);
  memberSocket.emit("room:closed", { reason });
}

function deleteRoom(room: RoomState): void {
  clearTimeout(room.abandonTimer);
  clearTurnTimer(room);
  clearTimeout(room.rematch?.timer);
  for (const member of room.members) socketRooms.delete(member.id);
  rooms.delete(room.code);
  emitLobbyUpdate();
}

function dissolveRoom(room: RoomState, reason: string): void {
  for (const member of room.members) closeMemberConnection(room, member.id, reason);
  deleteRoom(room);
}

/** 移出成员并在需要时转移房主；房间空了就删除。返回房间是否还在。 */
function removeMembers(room: RoomState, memberIds: string[], reason: string): boolean {
  for (const memberId of memberIds) closeMemberConnection(room, memberId, reason);
  for (const memberId of memberIds) room.voice.delete(memberId);
  room.members = room.members.filter((member) => !memberIds.includes(member.id));
  if (room.members.length === 0) {
    deleteRoom(room);
    return false;
  }
  if (!room.members.some((member) => member.id === room.ownerId)) room.ownerId = room.members[0]!.id;
  room.members = room.members.map((member) => ({ ...member, isHost: member.id === room.ownerId }));
  return true;
}

/** 有人拒绝或超时：移出这些人和已离线的人，其余玩家回到等待大厅。 */
function returnToWaiting(room: RoomState, kickedIds: string[], reason: string): void {
  clearTimeout(room.rematch?.timer);
  delete room.rematch;
  clearTimeout(room.abandonTimer);
  delete room.abandonTimer;
  const offlineIds = room.members.filter((member) => !member.connected && !kickedIds.includes(member.id)).map((member) => member.id);
  if (!removeMembers(room, [...kickedIds, ...offlineIds], reason)) return;
  room.status = "waiting";
  clearTurnTimer(room);
  delete room.game;
  emitRoomUpdate(room);
}

function clearTurnTimer(room: RoomState): void {
  clearTimeout(room.turn?.timer);
  delete room.turn;
}

/** 当前玩家开始新的回合：限时 turnSeconds 秒，超时跳过。 */
function startTurnTimer(room: RoomState): void {
  clearTurnTimer(room);
  if (room.game?.status !== "active") return;
  const timer = setTimeout(() => expireTurn(room), room.turnSeconds * 1000);
  timer.unref();
  room.turn = { deadline: Date.now() + room.turnSeconds * 1000, timer };
}

function expireTurn(room: RoomState): void {
  if (rooms.get(room.code) !== room || room.game?.status !== "active") return;
  room.game = skipTurn(room.game);
  afterGameChange(room);
  emitRoomUpdate(room);
}

/** 对局状态变化后：结束则清空聊天并发起继续投票，否则为下一位玩家重新计时。 */
function afterGameChange(room: RoomState, previousActiveIndex?: number): void {
  if (room.game?.status === "finished") {
    clearTurnTimer(room);
    room.chat = [];
    startRematchVote(room);
    return;
  }
  // 选贵族仍属于同一回合，不重新计时。
  if (room.game?.activePlayerIndex !== previousActiveIndex) startTurnTimer(room);
}

/** 整轮结束：所有人需在 REMATCH_TIMEOUT_MS 内确认是否继续。 */
function startRematchVote(room: RoomState): void {
  clearTimeout(room.rematch?.timer);
  const timer = setTimeout(() => {
    if (rooms.get(room.code) !== room || !room.rematch) return;
    const accepted = room.rematch.accepted;
    const pending = room.members.filter((member) => !accepted.has(member.id)).map((member) => member.id);
    returnToWaiting(room, pending, "没有在 1 分钟内确认继续，已被移出房间。");
  }, REMATCH_TIMEOUT_MS);
  timer.unref();
  room.rematch = { deadline: Date.now() + REMATCH_TIMEOUT_MS, accepted: new Set(), timer };
}

/** 未配置 ADMIN_TOKEN 时管理功能关闭。 */
const adminTokenHash = process.env.ADMIN_TOKEN
  ? createHash("sha256").update(process.env.ADMIN_TOKEN).digest()
  : null;

function checkAdminToken(socketId: string, token: unknown): string | null {
  if (!adminTokenHash) return "管理功能未启用。";
  const now = Date.now();
  if (now - (adminFailureTimes.get(socketId) ?? 0) < ADMIN_RETRY_DELAY_MS) {
    return "尝试太频繁了，请稍后再试。";
  }
  const tokenHash = createHash("sha256").update(typeof token === "string" ? token : "").digest();
  if (!timingSafeEqual(tokenHash, adminTokenHash)) {
    adminFailureTimes.set(socketId, now);
    return "管理员口令不正确。";
  }
  return null;
}

/**
 * 语音用的 STUN/TURN 配置。配置了 TURN_HOST 和 TURN_SECRET 时，按 coturn 的
 * use-auth-secret 约定发放 24 小时有效的临时凭证；否则只靠局域网直连（本地开发）。
 */
function iceServersFor(memberId: string): IceServerConfig[] {
  const host = process.env.TURN_HOST;
  const secret = process.env.TURN_SECRET;
  if (!host || !secret) return [];
  const username = `${Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL_SECONDS}:${memberId}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return [
    { urls: `stun:${host}:3478` },
    { urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`], username, credential },
  ];
}

function isVoiceSignal(value: unknown): value is VoiceSignal {
  if (!value || typeof value !== "object") return false;
  if (JSON.stringify(value).length > VOICE_SIGNAL_MAX_LENGTH) return false;
  const data = value as { description?: { type?: unknown; sdp?: unknown }; candidate?: { candidate?: unknown } };
  if (data.description) {
    return (data.description.type === "offer" || data.description.type === "answer") && typeof data.description.sdp === "string";
  }
  return Boolean(data.candidate) && typeof data.candidate?.candidate === "string";
}

/** 把离线玩家的座位交给新的连接，保留其对局状态。 */
function reassignMember(room: RoomState, previousId: string, nextId: string): void {
  const swap = (id: string) => (id === previousId ? nextId : id);
  room.members = room.members.map((member) =>
    member.id === previousId ? { ...member, id: nextId, connected: true } : member,
  );
  room.ownerId = swap(room.ownerId);
  room.chat = room.chat.map((entry) => ({ ...entry, senderId: swap(entry.senderId) }));
  if (room.rematch) room.rematch.accepted = new Set([...room.rematch.accepted].map(swap));
  if (room.game) {
    room.game = {
      ...room.game,
      players: room.game.players.map((player) => ({ ...player, id: swap(player.id) })),
      winnerIds: room.game.winnerIds.map(swap),
    };
  }
}

function invalidNameMessage(payload: CreateRoomPayload | JoinRoomPayload): string | null {
  return normalizeName(payload?.name) ? null : "昵称长度需为 2–18 个字符。";
}

io.on("connection", (socket) => {
  socket.on("lobby:get", (ack) => {
    ack({ ok: true, data: roomSummaries() });
  });

  socket.on("room:create", (payload, ack) => {
    if (socketRooms.has(socket.id)) {
      ack({ ok: false, error: "请先离开当前房间，再创建新房间。" });
      return;
    }
    const invalidName = invalidNameMessage(payload);
    if (invalidName) {
      ack({ ok: false, error: invalidName });
      return;
    }
    if (!isCapacity(payload?.capacity)) {
      ack({ ok: false, error: "房间人数必须是 2、3 或 4 人。" });
      return;
    }

    let code = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = generateRoomCode();
      if (!rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      ack({ ok: false, error: "暂时无法分配房间码，请重试。" });
      return;
    }

    const room: RoomState = {
      code,
      publicId: randomUUID(),
      capacity: payload.capacity,
      status: "waiting",
      ownerId: socket.id,
      members: [{ id: socket.id, name: normalizeName(payload.name)!, isHost: true, connected: true }],
      chat: [],
      voice: new Map(),
      turnSeconds: DEFAULT_TURN_SECONDS,
    };
    rooms.set(code, room);
    socketRooms.set(socket.id, code);
    void socket.join(code);
    ack({ ok: true, data: snapshot(room, socket.id) });
    emitRoomUpdate(room);
  });

  socket.on("room:join", (payload, ack) => {
    if (socketRooms.has(socket.id)) {
      ack({ ok: false, error: "请先离开当前房间，再加入新房间。" });
      return;
    }
    const invalidName = invalidNameMessage(payload);
    if (invalidName) {
      ack({ ok: false, error: invalidName });
      return;
    }
    const code = normalizeCode(payload?.code);
    if (!code) {
      ack({ ok: false, error: "请输入有效的 6 位房间码。" });
      return;
    }
    const room = rooms.get(code);
    if (!room) {
      ack({ ok: false, error: "找不到这个房间，请检查房间码。" });
      return;
    }
    const name = normalizeName(payload.name)!;
    if (room.status !== "waiting") {
      // 对局中只允许离线玩家用原昵称回到自己的座位。
      const seat = room.members.find((member) => member.name === name);
      if (!seat) {
        ack({ ok: false, error: "对局已经开始，只有原房间玩家可以用原昵称重新加入。" });
        return;
      }
      if (seat.connected) {
        ack({ ok: false, error: "这个昵称的玩家仍在线，无法重新加入。" });
        return;
      }
      clearTimeout(room.abandonTimer);
      delete room.abandonTimer;
      reassignMember(room, seat.id, socket.id);
      socketRooms.set(socket.id, code);
      void socket.join(code);
      ack({ ok: true, data: snapshot(room, socket.id) });
      emitRoomUpdate(room);
      return;
    }
    if (room.members.length >= room.capacity) {
      ack({ ok: false, error: "房间已满。" });
      return;
    }
    if (room.members.some((member) => member.name === name)) {
      ack({ ok: false, error: "房间里已有同名玩家，请换一个昵称。" });
      return;
    }

    const member: LobbyMember = {
      id: socket.id,
      name,
      isHost: false,
      connected: true,
    };
    room.members.push(member);
    socketRooms.set(socket.id, code);
    void socket.join(code);
    ack({ ok: true, data: snapshot(room, socket.id) });
    emitRoomUpdate(room);
  });

  socket.on("room:start", (ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room) {
      ack({ ok: false, error: "你当前不在房间中。" });
      return;
    }
    if (room.ownerId !== socket.id) {
      ack({ ok: false, error: "只有房主可以开始对局。" });
      return;
    }
    if (room.status !== "waiting") {
      ack({ ok: false, error: "对局已经开始。" });
      return;
    }
    if (room.members.length < 2) {
      ack({ ok: false, error: "至少需要 2 位玩家才能开始。" });
      return;
    }

    try {
      room.game = createGame(
        room.members.map((member) => ({ id: member.id, name: member.name })),
        cardsFile.cards,
        noblesFile.nobles,
      );
      room.status = "playing";
      startTurnTimer(room);
      const roomSnapshot = snapshot(room, socket.id);
      ack({ ok: true, data: roomSnapshot });
      emitRoomUpdate(room);
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法开始对局。";
      ack({ ok: false, error: message });
    }
  });

  socket.on("room:leave", (ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room) {
      ack({ ok: false, error: "你当前不在房间中。" });
      return;
    }
    if (room.status === "playing") {
      ack({ ok: false, error: "对局开始后暂不能离开房间。" });
      return;
    }
    const code = room.code;
    removeWaitingMember(socket.id);
    void socket.leave(code);
    ack({ ok: true, data: undefined });
  });

  socket.on("game:action", (action, ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.status !== "playing" || !room.game) {
      ack({ ok: false, error: "当前没有进行中的对局。" });
      return;
    }

    try {
      const previousActiveIndex = room.game.activePlayerIndex;
      room.game = applyAction(room.game, socket.id, action);
      afterGameChange(room, previousActiveIndex);
      const roomSnapshot = snapshot(room, socket.id);
      ack({ ok: true, data: roomSnapshot });
      emitRoomUpdate(room);
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法执行这个行动。";
      ack({ ok: false, error: message });
    }
  });

  socket.on("room:rematch", (accept, ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room?.rematch || !room.members.some((member) => member.id === socket.id)) {
      ack({ ok: false, error: "现在不需要确认。" });
      return;
    }
    ack({ ok: true, data: undefined });
    if (accept !== true) {
      returnToWaiting(room, [socket.id], "你选择了不继续，已离开房间。");
      return;
    }
    room.rematch.accepted.add(socket.id);
    if (room.members.every((member) => room.rematch!.accepted.has(member.id))) {
      clearTimeout(room.rematch.timer);
      delete room.rematch;
      room.game = createGame(
        room.members.map((member) => ({ id: member.id, name: member.name })),
        cardsFile.cards,
        noblesFile.nobles,
      );
      startTurnTimer(room);
    }
    emitRoomUpdate(room);
  });

  socket.on("room:turnSeconds", (seconds, ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.ownerId !== socket.id) {
      ack({ ok: false, error: "只有房主可以设置行动时长。" });
      return;
    }
    if (room.status !== "waiting") {
      ack({ ok: false, error: "对局开始后不能修改行动时长。" });
      return;
    }
    if (!TURN_SECONDS_OPTIONS.includes(seconds)) {
      ack({ ok: false, error: "行动时长只能是 45 秒、1 分钟或 2 分钟。" });
      return;
    }
    room.turnSeconds = seconds;
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("room:kick", (memberId, ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.ownerId !== socket.id) {
      ack({ ok: false, error: "只有房主可以移出玩家。" });
      return;
    }
    if (room.status !== "waiting") {
      ack({ ok: false, error: "对局中不能移出玩家；有人挂机可以解散房间。" });
      return;
    }
    if (memberId === socket.id || !room.members.some((member) => member.id === memberId)) {
      ack({ ok: false, error: "找不到这位玩家。" });
      return;
    }
    removeMembers(room, [memberId], "你已被房主移出房间。");
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("room:dissolve", (ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.ownerId !== socket.id) {
      ack({ ok: false, error: "只有房主可以解散房间。" });
      return;
    }
    ack({ ok: true, data: undefined });
    dissolveRoom(room, "房主解散了房间。");
  });

  socket.on("admin:verify", (token, ack) => {
    const error = checkAdminToken(socket.id, token);
    ack(error ? { ok: false, error } : { ok: true, data: undefined });
  });

  socket.on("admin:dissolve", (payload, ack) => {
    const error = checkAdminToken(socket.id, payload?.token);
    if (error) {
      ack({ ok: false, error });
      return;
    }
    const room = [...rooms.values()].find((candidate) => candidate.publicId === payload.roomId);
    if (!room) {
      ack({ ok: false, error: "这个房间已经不存在。" });
      return;
    }
    dissolveRoom(room, "管理员解散了这个房间。");
    ack({ ok: true, data: undefined });
  });

  socket.on("voice:join", (payload, ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room) {
      ack({ ok: false, error: "你当前不在房间中。" });
      return;
    }
    room.voice.set(socket.id, { muted: payload?.muted === true });
    ack({ ok: true, data: iceServersFor(socket.id) });
    emitRoomUpdate(room);
  });

  socket.on("voice:mute", (muted, ack) => {
    const room = findRoomForSocket(socket.id);
    const state = room?.voice.get(socket.id);
    if (!room || !state) {
      ack({ ok: false, error: "你还没有加入语音。" });
      return;
    }
    state.muted = muted === true;
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("voice:leave", (ack) => {
    const room = findRoomForSocket(socket.id);
    if (room?.voice.delete(socket.id)) emitRoomUpdate(room);
    ack({ ok: true, data: undefined });
  });

  socket.on("voice:signal", (payload) => {
    // 只在同一房间、都在语音里的两人之间转发。
    const room = findRoomForSocket(socket.id);
    if (!room || !room.voice.has(socket.id) || !room.voice.has(payload?.to) || payload.to === socket.id) return;
    if (!isVoiceSignal(payload.data)) return;
    io.to(payload.to).emit("voice:signal", { from: socket.id, data: payload.data });
  });

  socket.on("room:chat", (payload, ack) => {
    const room = findRoomForSocket(socket.id);
    const member = room?.members.find((candidate) => candidate.id === socket.id);
    if (!room || !member) {
      ack({ ok: false, error: "你当前不在房间中。" });
      return;
    }
    const message = normalizeChatMessage(payload?.message);
    if (!message) {
      ack({ ok: false, error: `消息需为 1–${ROOM_CHAT_MAX_LENGTH} 个字符。` });
      return;
    }
    const now = Date.now();
    if (now - (roomChatTimes.get(socket.id) ?? 0) < ROOM_CHAT_RATE_LIMIT_MS) {
      ack({ ok: false, error: "发送太快了，请稍等一下。" });
      return;
    }

    roomChatTimes.set(socket.id, now);
    room.chat = [
      ...room.chat,
      { id: randomUUID(), senderId: socket.id, name: member.name, message, createdAt: new Date(now).toISOString() },
    ].slice(-ROOM_CHAT_LIMIT);
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("disconnect", () => {
    roomChatTimes.delete(socket.id);
    adminFailureTimes.delete(socket.id);
    removeWaitingMember(socket.id);
  });
});

/** 仅供测试：直接把某个房间的对局标记为结束并发起继续投票。 */
export const testHooks = {
  finishGame(code: string): void {
    const room = rooms.get(code);
    if (!room?.game) throw new Error("no game");
    room.game = { ...room.game, status: "finished" };
    clearTurnTimer(room);
    startRematchVote(room);
    emitRoomUpdate(room);
  },
  /** 让当前回合立即超时。 */
  expireTurn(code: string): void {
    const room = rooms.get(code);
    if (!room) throw new Error("no room");
    expireTurn(room);
  },
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT ?? 3001);
  httpServer.listen(port, () => {
    console.log(`Gem Merchant server listening on http://localhost:${port}`);
  });
}
