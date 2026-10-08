import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  type AckResponse,
  type GameAction,
  type ClientToServerEvents,
  type GameState,
  type JoinRoomPayload,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
  type RoomAccess,
  type ServerToClientEvents,
} from "@gem-merchant/game";

// ---------- 每款游戏不一样的地方 ----------
/** 最小的房间人数（对局要坐满才开始测）。 */
const CAPACITY = 2 as const;
/** 这款游戏有没有藏起来的信息。 */
const HIDDEN_INFO = true;
/** 开局后先走几步（每步选轮到的人的第一个合法动作），让场上有藏起来的牌。 */
const STEPS = 1;
/** 只在服务端的字段（牌堆顺序、种子等），观战的人永远拿不到。 */
const SERVER_ONLY: string[] = [];
/** 这份状态里看得到几样藏起来的东西（手牌之类）。 */
function secretsSeen(game: GameState): number {
  return game.players.reduce((total, player) => total
    + player.reservedCards.filter((card) => player.hiddenReservedCardIds.includes(card.id) && !card.id.startsWith("hidden-")).length, 0);
}
/** 宝石商人没有现成的合法动作列表：轮到的人从一级牌库暗扣一张总是合法的。 */
function legalActions(game: GameState, seat: string): GameAction[] {
  return game.status === "active" && game.players[game.activePlayerIndex]?.id === seat
    ? [{ type: "reserveCard", source: { kind: "deck", level: 1 } }]
    : [];
}
// ----------------------------------------

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const clients = new Set<TestSocket>();
const latest = new Map<TestSocket, LobbyRoomSnapshot>();
let serverUrl = "";
let httpServer: typeof import("../src/index.js").httpServer;
let serverIo: typeof import("../src/index.js").io;
let nameSeq = 0;

function connect(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.add(client);
    client.on("room:updated", (room) => latest.set(client, room));
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

/** 每次都不一样的昵称（2–18 个字符）。 */
function nick(prefix: string): string {
  nameSeq += 1;
  return `${prefix}${nameSeq}`;
}

function create(client: TestSocket, name: string): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve, reject) => client.emit("room:create", { name, capacity: CAPACITY } as never, (response: AckResponse<LobbyRoomSnapshot>) => {
    if (response.ok) resolve(response.data);
    else reject(new Error(response.error));
  }));
}

function join(client: TestSocket, payload: JoinRoomPayload): Promise<AckResponse<LobbyRoomSnapshot>> {
  return new Promise((resolve) => client.emit("room:join", payload, resolve));
}

function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}

function access(client: TestSocket, value: Partial<RoomAccess>): Promise<AckResponse<void>> {
  return call((ack) => client.emit("room:access", value, ack));
}

function lobby(client: TestSocket): Promise<PublicRoomSummary[]> {
  return new Promise((resolve) => client.emit("lobby:get", (response) => resolve(response.ok ? response.data : [])));
}

/** 等到满足条件的那次房间更新（前面的操作可能还有更新在路上）。 */
function updateWhere(client: TestSocket, test: (room: LobbyRoomSnapshot) => boolean): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve) => {
    const current = latest.get(client);
    if (current && test(current)) {
      resolve(current);
      return;
    }
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      client.off("room:updated", handler);
      resolve(room);
    };
    client.on("room:updated", handler);
  });
}

function closed(client: TestSocket): Promise<string> {
  return new Promise((resolve) => client.once("room:closed", ({ reason }) => resolve(reason)));
}

/** 服务端字段发到前端时要么去掉，要么换成空数组。 */
function hiddenField(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}

function seatOf(client: TestSocket): string {
  // 宝石商人对局里的玩家 id 就是连接 id。
  return client.id ?? "";
}

/** 用房间码把座位坐满，返回新加入的玩家。 */
async function fillSeats(code: string, seated: number): Promise<TestSocket[]> {
  const added: TestSocket[] = [];
  for (let seat = seated; seat < CAPACITY; seat += 1) {
    const client = await connect();
    expect((await join(client, { name: nick("玩家"), code })).ok).toBe(true);
    added.push(client);
  }
  return added;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("观战和公开房间", () => {
  beforeAll(async () => {
    const serverModule = await import("../src/index.js");
    httpServer = serverModule.httpServer;
    serverIo = serverModule.io;
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, resolve);
    });
    serverUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => serverIo.close(() => resolve()));
  });

  it("新房间默认可观战、不公开；陌生人从列表只能观战，房主打开公开后才能坐下", async () => {
    const host = await connect();
    const hostName = nick("房主");
    const room = await create(host, hostName);
    expect(room.access).toEqual({ allowSpectators: true, spectatorsSeeAll: false, open: false });

    const stranger = await connect();
    const strangerName = nick("路人");
    const summary = (await lobby(stranger)).find((candidate) => candidate.players[0]?.name === hostName)!;
    expect(summary.open).toBe(false);
    expect(summary.allowSpectators).toBe(true);

    expect((await join(stranger, { name: strangerName, roomId: summary.id })).ok).toBe(false);

    const watching = await join(stranger, { name: strangerName, roomId: summary.id, spectate: true });
    expect(watching.ok && watching.data.spectators.map((spectator) => spectator.name)).toEqual([strangerName]);
    // 从列表进来的看不到房间码，邀请制房间也不能坐下。
    expect(watching.ok && watching.data.code).toBe("");
    expect((await call<void>((ack) => stranger.emit("room:sit", ack))).ok).toBe(false);
    expect((await lobby(await connect())).find((candidate) => candidate.id === summary.id)?.spectators).toBe(1);

    // 观战的人不能开语音；能聊天，带「观战」标记。
    expect((await call<unknown>((ack) => stranger.emit("voice:join", { muted: true }, ack as never))).ok).toBe(false);
    const chatSeen = updateWhere(host, (snapshot) => snapshot.chat.some((entry) => entry.message === "加油"));
    expect((await call<void>((ack) => stranger.emit("room:chat", { message: "加油" }, ack))).ok).toBe(true);
    expect((await chatSeen).chat.at(-1)).toMatchObject({ name: strangerName, spectator: true });

    // 不是房主不能改设置；房主打开公开后，观战的人可以坐下。
    expect((await access(stranger, { open: true })).ok).toBe(false);
    expect((await access(host, { open: true })).ok).toBe(true);
    const seated = updateWhere(host, (snapshot) => snapshot.members.some((member) => member.name === strangerName));
    expect((await call<void>((ack) => stranger.emit("room:sit", ack))).ok).toBe(true);
    expect((await seated).spectators).toEqual([]);

    // 坐满后列表加入会被拒；改回观战后空出座位，第三个人能从列表加入。
    await fillSeats(room.code, 2);
    const third = await connect();
    const thirdName = nick("路人");
    expect((await join(third, { name: thirdName, roomId: summary.id })).ok).toBe(false);
    expect((await call<void>((ack) => stranger.emit("room:stand", ack))).ok).toBe(true);
    const joined = await join(third, { name: thirdName, roomId: summary.id });
    expect(joined.ok && joined.data.members.some((member) => member.name === thirdName)).toBe(true);
  });

  it("对局中观战默认只看公开信息，房主打开「看手牌」后能看到；不能操作，随时能离开", async () => {
    const host = await connect();
    const room = await create(host, nick("玩家"));
    const players = [host, ...(await fillSeats(room.code, 1))];
    const viewer = await connect();
    const invited = await join(viewer, { name: nick("看客"), code: room.code, spectate: true });
    expect(invited.ok && invited.data.code).toBe(room.code);

    expect((await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack))).ok).toBe(true);
    await updateWhere(viewer, (snapshot) => snapshot.game !== undefined);
    for (const client of players) await updateWhere(client, (snapshot) => snapshot.game !== undefined);

    // 先走几步，让场上有藏起来的牌。
    for (let step = 0; step < STEPS; step += 1) {
      const mover = players.find((client) => legalActions(latest.get(client)!.game!, seatOf(client)).length > 0);
      if (!mover) break;
      const action = legalActions(latest.get(mover)!.game!, seatOf(mover))[0]!;
      const before = JSON.stringify(latest.get(viewer)!.game);
      expect((await call<LobbyRoomSnapshot>((ack) => mover.emit("game:action", action, ack))).ok).toBe(true);
      await updateWhere(viewer, (snapshot) => JSON.stringify(snapshot.game) !== before);
      await delay(20);
    }

    const blind = latest.get(viewer)!.game!;
    for (const key of SERVER_ONLY) expect(hiddenField((blind as unknown as Record<string, unknown>)[key])).toBe(true);
    // 每位玩家自己看到的那一份里，自己身上的秘密。
    const owners = players.reduce((total, client) => {
      const game = latest.get(client)!.game!;
      return total + secretsSeen({ ...game, players: game.players.filter((player) => player.id === seatOf(client)) });
    }, 0);
    if (HIDDEN_INFO) {
      expect(owners).toBeGreaterThan(0);
      expect(secretsSeen(blind)).toBeLessThan(owners);
    }

    expect((await access(host, { spectatorsSeeAll: true })).ok).toBe(true);
    const godView = (await updateWhere(viewer, (snapshot) => snapshot.access.spectatorsSeeAll)).game!;
    for (const key of SERVER_ONLY) expect(hiddenField((godView as unknown as Record<string, unknown>)[key])).toBe(true);
    expect(secretsSeen(godView)).toBeGreaterThanOrEqual(owners);

    // 观战的人发动作会被拒。
    const anyAction = players.map((client) => legalActions(latest.get(client)!.game!, seatOf(client))[0]).find(Boolean);
    if (anyAction) {
      expect((await call<LobbyRoomSnapshot>((ack) => viewer.emit("game:action", anyAction, ack))).ok).toBe(false);
    }
    // 对局中玩家不能改成观战；观战的人随时能离开。
    expect((await call<void>((ack) => players[1]!.emit("room:stand", ack))).ok).toBe(false);
    expect((await call<void>((ack) => viewer.emit("room:leave", ack))).ok).toBe(true);
  });

  it("房主关闭观战会把观战的人请出去；房间解散时观战的人也会收到通知", async () => {
    const host = await connect();
    const room = await create(host, nick("玩家"));
    const viewer = await connect();
    const viewerName = nick("看客");
    expect((await join(viewer, { name: viewerName, code: room.code, spectate: true })).ok).toBe(true);
    const kicked = closed(viewer);
    expect((await access(host, { allowSpectators: false })).ok).toBe(true);
    expect(await kicked).toContain("关闭了观战");
    expect((await join(viewer, { name: viewerName, code: room.code, spectate: true })).ok).toBe(false);

    expect((await access(host, { allowSpectators: true })).ok).toBe(true);
    expect((await join(viewer, { name: viewerName, code: room.code, spectate: true })).ok).toBe(true);
    const dissolved = closed(viewer);
    expect((await call<void>((ack) => host.emit("room:dissolve", ack))).ok).toBe(true);
    expect(await dissolved).toContain("解散");
  });

  it("同名的人不能同时在房间里（座位和观战一起算）", async () => {
    const host = await connect();
    const hostName = nick("玩家");
    const room = await create(host, hostName);
    const viewer = await connect();
    expect((await join(viewer, { name: hostName, code: room.code, spectate: true })).ok).toBe(false);
  });
});
