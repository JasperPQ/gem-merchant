import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  botCommand,
  type AckResponse,
  type ClientToServerEvents,
  type GameState,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
  type ServerToClientEvents,
} from "@gem-merchant/game";

// ---------- 宝石商人这边的设定 ----------
type Capacity = 2 | 3 | 4;
/** 这位玩家的东西（宝石、土地、预留、贵族）有没有变：超时跳过什么都不变，真的行动了才会变。 */
function holdings(room: LobbyRoomSnapshot, playerId: string): string {
  const player = room.game?.players.find((candidate) => candidate.id === playerId);
  return player ? JSON.stringify([player.gems, player.purchasedCards.length, player.reservedCards.length, player.nobles.length]) : "";
}
const MIN_CAPACITY: Capacity = 2;
const MIN_PLAYERS = 2;
const SOLO_CAPACITY: Capacity = 4;
const FULL_TEST_CAPACITY: Capacity = 3;
// ----------------------------------------

// 人机立刻行动、每回合 300 ms 超时，测试才跑得快（服务端在导入时读这两个变量）。
process.env.BOT_DELAY_SCALE = "0";
process.env.TURN_MS = "300";

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

function nick(prefix: string): string {
  nameSeq += 1;
  return `${prefix}${nameSeq}`;
}

function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}

async function create(client: TestSocket, name: string, capacity: Capacity): Promise<LobbyRoomSnapshot> {
  const response = await call<LobbyRoomSnapshot>((ack) => client.emit("room:create", { name, capacity }, ack));
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

const addBot = (client: TestSocket) => call<void>((ack) => client.emit("room:add-bot", ack));

async function addBotsUpTo(host: TestSocket, humansSeated: number): Promise<void> {
  for (let seat = humansSeated; seat < MIN_PLAYERS; seat += 1) expect((await addBot(host)).ok).toBe(true);
}
const start = (client: TestSocket) => call<LobbyRoomSnapshot>((ack) => client.emit("room:start", ack));

function lobby(client: TestSocket): Promise<PublicRoomSummary[]> {
  return new Promise((resolve) => client.emit("lobby:get", (response) => resolve(response.ok ? response.data : [])));
}

function updateWhere(client: TestSocket, test: (room: LobbyRoomSnapshot) => boolean, timeoutMs = 20_000): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve, reject) => {
    const current = latest.get(client);
    if (current && test(current)) {
      resolve(current);
      return;
    }
    const timer = setTimeout(() => {
      client.off("room:updated", handler);
      reject(new Error("等不到想要的房间状态"));
    }, timeoutMs);
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      clearTimeout(timer);
      client.off("room:updated", handler);
      resolve(room);
    };
    client.on("room:updated", handler);
  });
}

function activeId(game: GameState | undefined): string | undefined {
  return game?.status === "active" ? game.players[game.activePlayerIndex]?.id : undefined;
}

/** 轮到这个真人时按人机的走法自动行动（收到的就是他自己视角的状态）；返回停止函数。 */
function autoplay(client: TestSocket): () => void {
  let sentFor = "";
  const handler = (room: LobbyRoomSnapshot) => {
    const game = room.game;
    if (!game || activeId(game) !== client.id) return;
    const key = JSON.stringify([game.players.map((player) => player.gems), game.pendingNobleIds, game.bank]);
    if (sentFor === key) return;
    sentFor = key;
    const action = botCommand(game, client.id!);
    if (action) client.emit("game:action", action, () => {});
  };
  client.on("room:updated", handler);
  const current = latest.get(client);
  if (current) handler(current);
  return () => client.off("room:updated", handler);
}

describe("人机", () => {
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

  it("只有房主能加人机；坐满后加不了；房主能移出人机；首页列表标出人机", async () => {
    const host = await connect();
    const hostName = nick("房主");
    const { code } = await create(host, hostName, FULL_TEST_CAPACITY);
    const guest = await connect();
    expect((await call<LobbyRoomSnapshot>((ack) => guest.emit("room:join", { name: nick("客人"), code }, ack))).ok).toBe(true);

    expect((await addBot(guest)).ok).toBe(false);
    for (let seat = 2; seat < FULL_TEST_CAPACITY; seat += 1) expect((await addBot(host)).ok).toBe(true);
    const room = await updateWhere(host, (snapshot) => snapshot.members.length === FULL_TEST_CAPACITY);
    const bot = room.members.find((member) => member.bot)!;
    expect(bot).toMatchObject({ name: "咕噜一号", isHost: false, connected: true, bot: true });
    expect((await addBot(host)).ok).toBe(false);

    const summary = (await lobby(host)).find((candidate) => candidate.players[0]?.name === hostName)!;
    expect(summary.players.find((player) => player.name === "咕噜一号")?.bot).toBe(true);

    expect((await call<void>((ack) => host.emit("room:kick", bot.id, ack))).ok).toBe(true);
    await updateWhere(host, (snapshot) => snapshot.members.length === 2 && !snapshot.members.some((member) => member.bot));
  });

  it("一个人加满人机就能开局，人机把整局打完；人机自动同意再来一局", async () => {
    const host = await connect();
    await create(host, nick("独行"), SOLO_CAPACITY);
    for (let seat = 1; seat < SOLO_CAPACITY; seat += 1) expect((await addBot(host)).ok).toBe(true);
    const names = (await updateWhere(host, (snapshot) => snapshot.members.length === SOLO_CAPACITY)).members.map((member) => member.name);
    expect(names.slice(1)).toEqual(["咕噜一号", "咕噜二号", "咕噜三号"]);

    expect((await start(host)).ok).toBe(true);
    const stop = autoplay(host);
    const finished = await updateWhere(host, (snapshot) => snapshot.game?.status === "finished", 60_000);
    stop();
    expect(finished.game!.winnerIds.length).toBeGreaterThan(0);
    const bots = finished.members.filter((member) => member.bot).map((member) => member.id);
    expect([...finished.rematch!.acceptedIds].sort()).toEqual([...bots].sort());

    expect((await call<void>((ack) => host.emit("room:rematch", true, ack))).ok).toBe(true);
    const again = await updateWhere(host, (snapshot) => snapshot.game !== undefined && snapshot.game.status === "active" && !snapshot.rematch);
    expect(again.game!.players).toHaveLength(SOLO_CAPACITY);
    expect(again.game!.players.every((player) => player.purchasedCards.length === 0)).toBe(true);
  }, 90_000);

  it("人机只拿到自己座位能看到的状态：发给真人的快照里看不到牌堆和人机暗扣的卡", async () => {
    const host = await connect();
    await create(host, nick("看牌"), MIN_CAPACITY);
    await addBotsUpTo(host, 1);
    expect((await start(host)).ok).toBe(true);
    const stop = autoplay(host);
    const room = await updateWhere(host, (snapshot) => (snapshot.game?.players.reduce((sum, player) => sum + player.purchasedCards.length, 0) ?? 0) >= 3, 30_000);
    stop();
    expect(room.game!.decks[1].every((card) => card.id.startsWith("deck-"))).toBe(true);
    const bot = room.game!.players.find((player) => player.id !== host.id)!;
    for (const card of bot.reservedCards) {
      if (card.id.startsWith("hidden-")) expect(card.points).toBe(0);
    }
  }, 40_000);

  it("等待中最后一个真人离开，只剩人机的房间直接关掉", async () => {
    const host = await connect();
    const hostName = nick("房主");
    await create(host, hostName, MIN_CAPACITY);
    expect((await addBot(host)).ok).toBe(true);
    expect((await lobby(host)).some((candidate) => candidate.players[0]?.name === hostName)).toBe(true);
    expect((await call<void>((ack) => host.emit("room:leave", ack))).ok).toBe(true);
    expect((await lobby(host)).some((candidate) => candidate.players.some((player) => player.name === hostName))).toBe(false);
  });

  it("连续超时两次转托管，由人机代打（没有倒计时）；取消托管后交还", async () => {
    const idle = await connect();
    const active = await connect();
    const { code } = await create(idle, nick("发呆"), MIN_CAPACITY);
    expect((await call<LobbyRoomSnapshot>((ack) => active.emit("room:join", { name: nick("认真"), code }, ack))).ok).toBe(true);
    expect((await start(idle)).ok).toBe(true);
    const stop = autoplay(active);

    const isAuto = (snapshot: LobbyRoomSnapshot) => snapshot.members.find((member) => member.id === idle.id)?.auto === true;
    const autoRoom = await updateWhere(idle, isAuto);
    // 两次超时都是跳过：他手里还是空的
    expect(holdings(autoRoom, idle.id!)).toBe(JSON.stringify([{ white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 }, 0, 0, 0]));

    // 托管后轮到他时没有倒计时，人机替他走：他手里有东西了
    const hisTurn = await updateWhere(idle, (snapshot) => isAuto(snapshot) && activeId(snapshot.game) === idle.id);
    expect(hisTurn.turnRemainingMs).toBeUndefined();
    const before = holdings(hisTurn, idle.id!);
    await updateWhere(idle, (snapshot) => holdings(snapshot, idle.id!) !== before);

    expect((await call<void>((ack) => idle.emit("room:auto", false, ack))).ok).toBe(true);
    const back = await updateWhere(idle, (snapshot) => !isAuto(snapshot));
    expect(back.members.find((member) => member.id === idle.id)?.auto).toBeUndefined();
    stop();
  }, 30_000);

  it("自己动一下就取消托管", async () => {
    const idle = await connect();
    const { code: _code } = await create(idle, nick("回神"), MIN_CAPACITY);
    await addBotsUpTo(idle, 1);
    expect((await start(idle)).ok).toBe(true);
    expect((await call<void>((ack) => idle.emit("room:auto", true, ack))).ok).toBe(true);
    await updateWhere(idle, (snapshot) => snapshot.members.find((member) => member.id === idle.id)?.auto === true);
    expect((await call<void>((ack) => idle.emit("room:auto", false, ack))).ok).toBe(true);
    const myTurn = await updateWhere(idle, (snapshot) => activeId(snapshot.game) === idle.id && snapshot.turnRemainingMs !== undefined);
    const action = botCommand(myTurn.game!, idle.id!)!;
    const response = await call<LobbyRoomSnapshot>((ack) => idle.emit("game:action", action, ack));
    expect(response.ok).toBe(true);
  }, 30_000);

  it("掉线的人轮到时由人机代打（不算超时），用原昵称回来后交还", async () => {
    const leaver = await connect();
    const stayer = await connect();
    const leaverName = nick("掉线");
    const { code } = await create(leaver, leaverName, MIN_CAPACITY);
    expect((await call<LobbyRoomSnapshot>((ack) => stayer.emit("room:join", { name: nick("留下"), code }, ack))).ok).toBe(true);
    const started = await start(leaver);
    if (!started.ok) throw new Error(started.error);
    const leaverId = leaver.id!;
    const stop = autoplay(stayer);
    leaver.disconnect();

    // 人机替他行动：手里的东西变了
    const empty = JSON.stringify([{ white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 }, 0, 0, 0]);
    const played = await updateWhere(stayer, (snapshot) => {
      const id = snapshot.members.find((member) => member.name === leaverName)?.id ?? leaverId;
      return holdings(snapshot, id) !== "" && holdings(snapshot, id) !== empty;
    });
    expect(played.members.find((member) => member.name === leaverName)).toMatchObject({ connected: false });
    expect(played.members.find((member) => member.name === leaverName)?.auto).toBeUndefined();

    const back = await connect();
    const rejoined = await call<LobbyRoomSnapshot>((ack) => back.emit("room:join", { name: leaverName, code }, ack));
    expect(rejoined.ok).toBe(true);
    if (!rejoined.ok) return;
    expect(rejoined.data.members.find((member) => member.id === back.id)).toMatchObject({ name: leaverName, connected: true });
    // 座位上的宝石和土地都还在
    expect(holdings(rejoined.data, back.id!)).not.toBe(empty);
    stop();
  }, 30_000);
});
