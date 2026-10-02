import { randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Server } from "socket.io";
import {
  applyAction,
  createGame,
  type ClientToServerEvents,
  type CreateRoomPayload,
  type DevelopmentCard,
  type GuestbookEntry,
  type JoinRoomPayload,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type Noble,
  type RoomChatMessage,
  type ServerToClientEvents,
  type SubmitGuestbookEntry,
} from "@gem-merchant/game";

interface RoomState {
  code: string;
  capacity: 2 | 3 | 4;
  status: "waiting" | "playing";
  ownerId: string;
  members: LobbyMember[];
  chat: RoomChatMessage[];
  game?: ReturnType<typeof createGame>;
}

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const GUESTBOOK_LIMIT = 200;
const GUESTBOOK_RATE_LIMIT_MS = 10_000;
const ROOM_CHAT_LIMIT = 100;
const ROOM_CHAT_MAX_LENGTH = 200;
const ROOM_CHAT_RATE_LIMIT_MS = 1_000;
const rooms = new Map<string, RoomState>();
const socketRooms = new Map<string, string>();
const guestbookPostTimes = new Map<string, number>();
const roomChatTimes = new Map<string, number>();

const cardsFile = JSON.parse(
  readFileSync(new URL("../../../data/cards.json", import.meta.url), "utf8"),
) as { cards: DevelopmentCard[] };
const noblesFile = JSON.parse(
  readFileSync(new URL("../../../data/nobles.json", import.meta.url), "utf8"),
) as { nobles: Noble[] };
const guestbookPath = process.env.GUESTBOOK_FILE
  ?? fileURLToPath(new URL("../../../data/guestbook.json", import.meta.url));

function loadGuestbook(): GuestbookEntry[] {
  if (!existsSync(guestbookPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(guestbookPath, "utf8")) as { entries?: unknown };
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter((entry): entry is GuestbookEntry =>
      Boolean(entry)
      && typeof entry === "object"
      && typeof entry.id === "string"
      && typeof entry.name === "string"
      && typeof entry.message === "string"
      && typeof entry.createdAt === "string",
    ).slice(-GUESTBOOK_LIMIT);
  } catch {
    return [];
  }
}

let guestbookEntries = loadGuestbook();

function getGuestbookEntries(): GuestbookEntry[] {
  return [...guestbookEntries].reverse().map((entry) => ({ ...entry }));
}

function saveGuestbook(): void {
  mkdirSync(dirname(guestbookPath), { recursive: true });
  const temporaryPath = `${guestbookPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({ entries: guestbookEntries }, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, guestbookPath);
}

function normalizeGuestName(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "游客";
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 18 ? name : null;
}

function normalizeGuestMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const message = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  return message.length >= 2 && message.length <= 280 ? message : null;
}

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

function snapshot(room: RoomState): LobbyRoomSnapshot {
  return {
    code: room.code,
    capacity: room.capacity,
    status: room.status,
    members: room.members.map((member) => ({ ...member })),
    chat: room.chat.map((entry) => ({ ...entry })),
    ...(room.game ? { game: room.game } : {}),
  };
}

function emitRoomUpdate(room: RoomState): void {
  io.to(room.code).emit("room:updated", snapshot(room));
}

function findRoomForSocket(socketId: string): RoomState | undefined {
  const code = socketRooms.get(socketId);
  return code ? rooms.get(code) : undefined;
}

function removeWaitingMember(socketId: string): void {
  const code = socketRooms.get(socketId);
  if (!code) return;
  socketRooms.delete(socketId);

  const room = rooms.get(code);
  if (!room) return;
  if (room.status === "playing") {
    room.members = room.members.map((member) =>
      member.id === socketId ? { ...member, connected: false } : member,
    );
    emitRoomUpdate(room);
    return;
  }

  room.members = room.members.filter((member) => member.id !== socketId);
  if (room.members.length === 0) {
    rooms.delete(code);
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

function invalidNameMessage(payload: CreateRoomPayload | JoinRoomPayload): string | null {
  return normalizeName(payload?.name) ? null : "昵称长度需为 2–18 个字符。";
}

io.on("connection", (socket) => {
  socket.on("guestbook:get", (ack) => {
    ack({ ok: true, data: getGuestbookEntries() });
  });

  socket.on("guestbook:post", (payload: SubmitGuestbookEntry, ack) => {
    const name = normalizeGuestName(payload?.name);
    if (!name) {
      ack({ ok: false, error: "昵称最多 18 个字符。" });
      return;
    }
    const message = normalizeGuestMessage(payload?.message);
    if (!message) {
      ack({ ok: false, error: "留言需为 2–280 个字符。" });
      return;
    }

    const now = Date.now();
    const lastPostAt = guestbookPostTimes.get(socket.id) ?? 0;
    if (now - lastPostAt < GUESTBOOK_RATE_LIMIT_MS) {
      ack({ ok: false, error: "留言太频繁了，请稍后再试。" });
      return;
    }

    const entry: GuestbookEntry = {
      id: randomUUID(),
      name,
      message,
      createdAt: new Date(now).toISOString(),
    };
    guestbookEntries = [...guestbookEntries, entry].slice(-GUESTBOOK_LIMIT);
    try {
      saveGuestbook();
    } catch {
      guestbookEntries = guestbookEntries.filter((candidate) => candidate.id !== entry.id);
      ack({ ok: false, error: "留言暂时无法保存，请稍后重试。" });
      return;
    }

    guestbookPostTimes.set(socket.id, now);
    const entries = getGuestbookEntries();
    ack({ ok: true, data: entries });
    io.emit("guestbook:updated", entries);
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
      capacity: payload.capacity,
      status: "waiting",
      ownerId: socket.id,
      members: [{ id: socket.id, name: normalizeName(payload.name)!, isHost: true, connected: true }],
      chat: [],
    };
    rooms.set(code, room);
    socketRooms.set(socket.id, code);
    void socket.join(code);
    ack({ ok: true, data: snapshot(room) });
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
    if (room.status !== "waiting") {
      ack({ ok: false, error: "对局已经开始，暂时不能加入。" });
      return;
    }
    if (room.members.length >= room.capacity) {
      ack({ ok: false, error: "房间已满。" });
      return;
    }

    const member: LobbyMember = {
      id: socket.id,
      name: normalizeName(payload.name)!,
      isHost: false,
      connected: true,
    };
    room.members.push(member);
    socketRooms.set(socket.id, code);
    void socket.join(code);
    ack({ ok: true, data: snapshot(room) });
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
      const roomSnapshot = snapshot(room);
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
      const wasActive = room.game.status === "active";
      room.game = applyAction(room.game, socket.id, action);
      // 对局结束时清空房间聊天记录。
      if (wasActive && room.game.status === "finished") room.chat = [];
      const roomSnapshot = snapshot(room);
      ack({ ok: true, data: roomSnapshot });
      emitRoomUpdate(room);
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法执行这个行动。";
      ack({ ok: false, error: message });
    }
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
    guestbookPostTimes.delete(socket.id);
    roomChatTimes.delete(socket.id);
    removeWaitingMember(socket.id);
  });
});

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT ?? 3001);
  httpServer.listen(port, () => {
    console.log(`Gem Merchant server listening on http://localhost:${port}`);
  });
}
