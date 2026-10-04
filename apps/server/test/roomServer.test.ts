import { createHmac } from "node:crypto";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import type {
  AckResponse,
  ClientToServerEvents,
  GameAction,
  LobbyRoomSnapshot,
  PublicRoomSummary,
  ServerToClientEvents,
} from "@gem-merchant/game";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const clients = new Set<TestSocket>();
let serverUrl = "";
let httpServer: typeof import("../src/index.js").httpServer;
let serverIo: typeof import("../src/index.js").io;
let testHooks: typeof import("../src/index.js").testHooks;
const previousRematchMs = process.env.REMATCH_TIMEOUT_MS;
const previousAdminToken = process.env.ADMIN_TOKEN;
const rematchMs = 300;
const adminToken = "test-admin-token";
const previousAbandonMs = process.env.ROOM_ABANDON_MS;
const abandonMs = 300;

function connectClient(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, {
      transports: ["websocket"],
      reconnection: false,
    });
    clients.add(client);
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function waitForRoomUpdate(client: TestSocket): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve) => client.once("room:updated", resolve));
}

function emitAction(client: TestSocket, action: GameAction): Promise<AckResponse<LobbyRoomSnapshot>> {
  return new Promise((resolve) => client.emit("game:action", action, resolve));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function joinRoom(client: TestSocket, name: string, code: string): Promise<AckResponse<LobbyRoomSnapshot>> {
  return new Promise((resolve) => client.emit("room:join", { name, code }, resolve));
}

describe("Socket.IO lobby and game actions", () => {
  beforeAll(async () => {
    process.env.ROOM_ABANDON_MS = String(abandonMs);
    process.env.REMATCH_TIMEOUT_MS = String(rematchMs);
    process.env.ADMIN_TOKEN = adminToken;
    process.env.TURN_HOST = "turn.example.com";
    process.env.TURN_SECRET = "turn-secret";
    const serverModule = await import("../src/index.js");
    httpServer = serverModule.httpServer;
    serverIo = serverModule.io;
    testHooks = serverModule.testHooks;
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, resolve);
    });
    const address = httpServer.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => serverIo.close(() => resolve()));
    if (previousAbandonMs === undefined) delete process.env.ROOM_ABANDON_MS;
    else process.env.ROOM_ABANDON_MS = previousAbandonMs;
    if (previousRematchMs === undefined) delete process.env.REMATCH_TIMEOUT_MS;
    else process.env.REMATCH_TIMEOUT_MS = previousRematchMs;
    if (previousAdminToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = previousAdminToken;
    delete process.env.TURN_HOST;
    delete process.env.TURN_SECRET;
  });

  it("creates, joins, starts, rejects out-of-turn actions, and broadcasts valid turns", async () => {
    const host = await connectClient();
    const created = await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => {
      host.emit("room:create", { name: "Host Player", capacity: 4 }, resolve);
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);
    expect(created.data.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    const guest = await connectClient();
    const hostJoinUpdate = waitForRoomUpdate(host);
    const joined = await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => {
      guest.emit("room:join", { name: "Guest Player", code: created.data.code.toLowerCase() }, resolve);
    });
    expect(joined.ok).toBe(true);
    if (!joined.ok) throw new Error(joined.error);
    expect(joined.data.members).toHaveLength(2);
    expect((await hostJoinUpdate).members).toHaveLength(2);

    const deniedStart = await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => {
      guest.emit("room:start", resolve);
    });
    expect(deniedStart.ok).toBe(false);

    const hostStartUpdate = waitForRoomUpdate(host);
    const guestStartUpdate = waitForRoomUpdate(guest);
    const started = await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => {
      host.emit("room:start", resolve);
    });
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error(started.error);
    expect(started.data.status).toBe("playing");
    expect(started.data.game?.players).toHaveLength(2);
    expect(started.data.game?.market[1]).toHaveLength(4);
    expect(started.data.game?.decks[1]).toHaveLength(36);
    expect(started.data.game?.decks[2]).toHaveLength(26);
    expect(started.data.game?.decks[3]).toHaveLength(16);
    expect(started.data.game?.noblesAvailable).toHaveLength(3);
    await Promise.all([hostStartUpdate, guestStartUpdate]);

    const game = started.data.game;
    if (!game) throw new Error("Game state was not initialized.");
    const activeId = game.players[game.activePlayerIndex]!.id;
    const activeClient = activeId === host.id ? host : guest;
    const inactiveClient = activeClient === host ? guest : host;
    const rejectedAction = await emitAction(inactiveClient, {
      type: "takeGems",
      colors: ["white", "blue", "green"],
    });
    expect(rejectedAction.ok).toBe(false);
    if (rejectedAction.ok) throw new Error("Out-of-turn action was accepted.");
    expect(rejectedAction.error).toContain("active player");

    const hostActionUpdate = waitForRoomUpdate(host);
    const guestActionUpdate = waitForRoomUpdate(guest);
    const actionResult = await emitAction(activeClient, {
      type: "takeGems",
      colors: ["white", "blue", "green"],
    });
    expect(actionResult.ok).toBe(true);
    if (!actionResult.ok) throw new Error(actionResult.error);
    expect(actionResult.data.game?.bank.white).toBe(game.bank.white - 1);
    expect(actionResult.data.game?.players.find((player) => player.id === activeId)?.gems.white).toBe(1);

    const [hostUpdate, guestUpdate] = await Promise.all([hostActionUpdate, guestActionUpdate]);
    expect(hostUpdate.game?.bank.white).toBe(game.bank.white - 1);
    expect(guestUpdate.game?.players.find((player) => player.id === activeId)?.gems.white).toBe(1);

    const currentActiveClient = activeClient === host ? guest : host;
    const currentInactiveClient = currentActiveClient === host ? guest : host;
    const marketCard = actionResult.data.game!.market[1][0]!;
    const reserveResult = await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => {
      currentActiveClient.emit("game:action", {
        type: "reserveCard",
        source: { kind: "market", level: 1, cardId: marketCard.id },
      }, resolve);
    });
    expect(reserveResult.ok).toBe(true);
    if (!reserveResult.ok) throw new Error(reserveResult.error);
    expect(reserveResult.data.game?.players.find((player) => player.id === currentActiveClient.id)?.reservedCards.map((card) => card.id)).toContain(marketCard.id);
    expect(reserveResult.data.game?.players.find((player) => player.id === currentActiveClient.id)?.gems.gold).toBe(1);
    expect(reserveResult.data.game?.market[1].map((card) => card.id)).not.toContain(marketCard.id);

    const opponentBuyAttempt = await emitAction(currentInactiveClient, {
      type: "buyCard",
      source: { kind: "reserved", cardId: marketCard.id },
    });
    expect(opponentBuyAttempt.ok).toBe(false);
    if (opponentBuyAttempt.ok) throw new Error("A player purchased another player's reserved card.");
    expect(opponentBuyAttempt.error).toContain("not available to buy");
  });

  it("enforces room capacity and transfers host after a waiting host disconnects", async () => {
    const host = await connectClient();
    const created = await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => {
      host.emit("room:create", { name: "Host Two", capacity: 2 }, resolve);
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const guest = await connectClient();
    const guestJoined = await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => {
      guest.emit("room:join", { name: "Guest Two", code: created.data.code }, resolve);
    });
    expect(guestJoined.ok).toBe(true);

    const thirdPlayer = await connectClient();
    const fullRoom = await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => {
      thirdPlayer.emit("room:join", { name: "Late Player", code: created.data.code }, resolve);
    });
    expect(fullRoom.ok).toBe(false);
    if (fullRoom.ok) throw new Error("A third player joined a two-seat room.");
    expect(fullRoom.error).toContain("已满");

    const transferUpdate = waitForRoomUpdate(guest);
    host.disconnect();
    const roomAfterTransfer = await transferUpdate;
    expect(roomAfterTransfer.members).toHaveLength(1);
    expect(roomAfterTransfer.members[0]?.id).toBe(guest.id);
    expect(roomAfterTransfer.members[0]?.isHost).toBe(true);
  });

  it("lets an offline player rejoin a running game with the same nickname", async () => {
    const join = (client: TestSocket, name: string, code: string) =>
      new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => client.emit("room:join", { name, code }, resolve));

    const host = await connectClient();
    const created = await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => {
      host.emit("room:create", { name: "Rejoin Host", capacity: 3 }, resolve);
    });
    if (!created.ok) throw new Error(created.error);
    const code = created.data.code;

    const guest = await connectClient();
    expect((await join(guest, "Rejoin Guest", code)).ok).toBe(true);
    const duplicate = await join(await connectClient(), "Rejoin Guest", code);
    expect(duplicate.ok).toBe(false);

    const started = await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => host.emit("room:start", resolve));
    if (!started.ok) throw new Error(started.error);
    const guestBefore = started.data.game!.players.find((player) => player.name === "Rejoin Guest")!;

    const offlineUpdate = new Promise<LobbyRoomSnapshot>((resolve) => {
      const handler = (room: LobbyRoomSnapshot) => {
        if (room.members.some((member) => member.name === "Rejoin Guest" && !member.connected)) {
          host.off("room:updated", handler);
          resolve(room);
        }
      };
      host.on("room:updated", handler);
    });
    guest.disconnect();
    await offlineUpdate;

    const stranger = await join(await connectClient(), "Someone Else", code);
    expect(stranger.ok).toBe(false);
    const impostor = await join(await connectClient(), "Rejoin Host", code);
    expect(impostor.ok).toBe(false);

    const returning = await connectClient();
    const hostSeesReturn = new Promise<LobbyRoomSnapshot>((resolve) => {
      const handler = (room: LobbyRoomSnapshot) => {
        if (room.members.some((member) => member.id === returning.id)) {
          host.off("room:updated", handler);
          resolve(room);
        }
      };
      host.on("room:updated", handler);
    });
    const rejoined = await join(returning, "Rejoin Guest", code);
    if (!rejoined.ok) throw new Error(rejoined.error);
    expect(rejoined.data.status).toBe("playing");
    const seat = rejoined.data.game!.players.find((player) => player.name === "Rejoin Guest")!;
    expect(seat.id).toBe(returning.id);
    expect(seat.gems).toEqual(guestBefore.gems);
    expect(rejoined.data.game!.activePlayerIndex).toBe(started.data.game!.activePlayerIndex);
    const hostView = await hostSeesReturn;
    expect(hostView.members.find((member) => member.name === "Rejoin Guest")).toMatchObject({ id: returning.id, connected: true });

    const active = rejoined.data.game!.players[rejoined.data.game!.activePlayerIndex]!;
    const actor = active.id === returning.id ? returning : host;
    const acted = await emitAction(actor, { type: "takeGems", colors: ["white", "blue", "green"] });
    expect(acted.ok).toBe(true);
  });

  it("closes a running game only after every player stays offline for the grace period", async () => {
    const host = await connectClient();
    const created = await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => {
      host.emit("room:create", { name: "Abandon Host", capacity: 2 }, resolve);
    });
    if (!created.ok) throw new Error(created.error);
    const code = created.data.code;
    const guest = await connectClient();
    expect((await joinRoom(guest, "Abandon Guest", code)).ok).toBe(true);
    const started = await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => host.emit("room:start", resolve));
    expect(started.ok).toBe(true);

    guest.disconnect();
    host.disconnect();
    await delay(abandonMs / 3);
    const returningHost = await connectClient();
    const rejoined = await joinRoom(returningHost, "Abandon Host", code);
    expect(rejoined.ok).toBe(true);

    // 有人回来后计时器取消，房间应撑过原定的关闭时间。
    await delay(abandonMs * 1.5);
    const guestReturns = await joinRoom(await connectClient(), "Abandon Guest", code);
    expect(guestReturns.ok).toBe(true);

    for (const client of clients) {
      if (client.connected) client.disconnect();
    }
    await delay(abandonMs * 2);
    const tooLate = await joinRoom(await connectClient(), "Abandon Host", code);
    expect(tooLate.ok).toBe(false);
    if (tooLate.ok) throw new Error("Abandoned room was not closed.");
    expect(tooLate.error).toContain("找不到");
  });

  it("pushes the online-tables list only to visitors on the home page, at most once per second", async () => {
    const visitor = await connectClient();
    const visitorLists: PublicRoomSummary[][] = [];
    const visitorTimes: number[] = [];
    visitor.on("lobby:updated", (list) => {
      visitorLists.push(list);
      visitorTimes.push(Date.now());
    });
    const host = await connectClient();
    const code = (await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => host.emit("room:create", { name: "Burst Host", capacity: 4 }, resolve)) as { ok: true; data: LobbyRoomSnapshot }).data.code;
    let hostUpdates = 0;
    host.on("lobby:updated", () => { hostUpdates += 1; });
    for (const name of ["Burst One", "Burst Two", "Burst Three"]) {
      const response = await joinRoom(await connectClient(), name, code);
      expect(response.ok).toBe(true);
    }
    await delay(1_500);
    expect(hostUpdates).toBe(0);
    expect(visitorLists.length).toBeGreaterThanOrEqual(1);
    expect(visitorLists.length).toBeLessThanOrEqual(2);
    if (visitorTimes.length === 2) expect(visitorTimes[1]! - visitorTimes[0]!).toBeGreaterThanOrEqual(950);
    const latest = visitorLists[visitorLists.length - 1]!;
    expect(latest.find((room) => room.players.some((player) => player.name === "Burst Host"))?.players).toHaveLength(4);
  });

  it("publishes live room summaries to visitors without room codes", async () => {
    const visitor = await connectClient();
    const host = await connectClient();
    const visitorUpdate = new Promise<PublicRoomSummary[]>((resolve) => {
      const handler = (rooms: PublicRoomSummary[]) => {
        if (rooms.some((room) => room.players.some((player) => player.name === "Lobby Host"))) {
          visitor.off("lobby:updated", handler);
          resolve(rooms);
        }
      };
      visitor.on("lobby:updated", handler);
    });
    const created = await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => {
      host.emit("room:create", { name: "Lobby Host", capacity: 2 }, resolve);
    });
    if (!created.ok) throw new Error(created.error);

    const pushed = await visitorUpdate;
    const summary = pushed.find((room) => room.players.some((player) => player.name === "Lobby Host"));
    expect(summary).toMatchObject({ status: "waiting", capacity: 2 });
    expect(summary?.players[0]).toMatchObject({ name: "Lobby Host", isHost: true, connected: true });
    expect(JSON.stringify(pushed)).not.toContain(created.data.code);

    const fetched = await new Promise<AckResponse<PublicRoomSummary[]>>((resolve) => visitor.emit("lobby:get", resolve));
    if (!fetched.ok) throw new Error(fetched.error);
    expect(fetched.data.some((room) => room.id === summary?.id)).toBe(true);
  });

  it("broadcasts room chat only to members and validates messages", async () => {
    const host = await connectClient();
    const created = await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => {
      host.emit("room:create", { name: "Chat Host", capacity: 2 }, resolve);
    });
    if (!created.ok) throw new Error(created.error);
    expect(created.data.chat).toEqual([]);

    const guest = await connectClient();
    await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => {
      guest.emit("room:join", { name: "Chat Guest", code: created.data.code }, resolve);
    });
    const outsider = await connectClient();
    const outsiderSend = await new Promise<AckResponse<void>>((resolve) => {
      outsider.emit("room:chat", { message: "hello?" }, resolve);
    });
    expect(outsiderSend.ok).toBe(false);

    const guestUpdate = waitForRoomUpdate(guest);
    const sent = await new Promise<AckResponse<void>>((resolve) => {
      host.emit("room:chat", { message: "  大家好  " }, resolve);
    });
    expect(sent.ok).toBe(true);
    const updated = await guestUpdate;
    expect(updated.chat).toHaveLength(1);
    expect(updated.chat[0]).toMatchObject({ senderId: host.id, name: "Chat Host", message: "大家好" });

    const tooFast = await new Promise<AckResponse<void>>((resolve) => {
      host.emit("room:chat", { message: "again" }, resolve);
    });
    expect(tooFast.ok).toBe(false);

    const empty = await new Promise<AckResponse<void>>((resolve) => {
      guest.emit("room:chat", { message: "   " }, resolve);
    });
    expect(empty.ok).toBe(false);
  });

  describe("room lifecycle", () => {
    const emitAck = <T,>(client: TestSocket, event: string, ...args: unknown[]) =>
      new Promise<AckResponse<T>>((resolve) => (client.emit as (...rest: unknown[]) => void)(event, ...args, resolve));
    const closedReason = (client: TestSocket) => new Promise<string>((resolve) => client.once("room:closed", ({ reason }) => resolve(reason)));

    async function startedRoom(names: string[]) {
      const clientsInRoom = [await connectClient()];
      const created = await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => {
        clientsInRoom[0]!.emit("room:create", { name: names[0]!, capacity: 4 }, resolve);
      });
      if (!created.ok) throw new Error(created.error);
      for (const name of names.slice(1)) {
        const client = await connectClient();
        clientsInRoom.push(client);
        const joined = await joinRoom(client, name, created.data.code);
        if (!joined.ok) throw new Error(joined.error);
      }
      const started = await emitAck<LobbyRoomSnapshot>(clientsInRoom[0]!, "room:start");
      if (!started.ok) throw new Error(started.error);
      return { code: created.data.code, clients: clientsInRoom };
    }

    it("starts a fresh game when everyone agrees to continue", async () => {
      const { code, clients: table } = await startedRoom(["Again A", "Again B"]);
      testHooks.finishGame(code);
      expect((await emitAck(table[0]!, "room:rematch", true)).ok).toBe(true);
      const restarted = new Promise<LobbyRoomSnapshot>((resolve) => {
        table[0]!.on("room:updated", (room) => { if (!room.rematch) resolve(room); });
      });
      expect((await emitAck(table[1]!, "room:rematch", true)).ok).toBe(true);
      const room = await restarted;
      expect(room.status).toBe("playing");
      expect(room.game?.status).toBe("active");
      expect(room.members).toHaveLength(2);
    });

    it("removes a player who declines and sends the rest back to the lobby", async () => {
      const { code, clients: table } = await startedRoom(["Stay Host", "Quit Guest", "Stay Guest"]);
      testHooks.finishGame(code);
      const kicked = closedReason(table[1]!);
      const backInLobby = new Promise<LobbyRoomSnapshot>((resolve) => {
        table[0]!.on("room:updated", (room) => { if (room.status === "waiting") resolve(room); });
      });
      await emitAck(table[0]!, "room:rematch", true);
      await emitAck(table[1]!, "room:rematch", false);
      expect(await kicked).toContain("不继续");
      const room = await backInLobby;
      expect(room.game).toBeUndefined();
      expect(room.members.map((member) => member.name)).toEqual(["Stay Host", "Stay Guest"]);
    });

    it("removes players who do not answer within the time limit", async () => {
      const { code, clients: table } = await startedRoom(["Quick Host", "Slow Guest"]);
      testHooks.finishGame(code);
      const kicked = closedReason(table[1]!);
      await emitAck(table[0]!, "room:rematch", true);
      expect(await kicked).toContain("1 分钟");
      await delay(50);
      const rejoin = await joinRoom(await connectClient(), "Late Visitor", code);
      if (!rejoin.ok) throw new Error(rejoin.error);
      expect(rejoin.data.status).toBe("waiting");
      expect(rejoin.data.members.map((member) => member.name)).toEqual(["Quick Host", "Late Visitor"]);
    });

    it("lets only the host kick players in the lobby and dissolve the room", async () => {
      const host = await connectClient();
      const created = await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => host.emit("room:create", { name: "Boss", capacity: 4 }, resolve));
      if (!created.ok) throw new Error(created.error);
      const guest = await connectClient();
      const other = await connectClient();
      const guestRoom = await joinRoom(guest, "Kick Me", created.data.code);
      if (!guestRoom.ok) throw new Error(guestRoom.error);
      await joinRoom(other, "Keep Me", created.data.code);
      const guestId = guestRoom.data.members.find((member) => member.name === "Kick Me")!.id;

      expect((await emitAck(other, "room:kick", guestId)).ok).toBe(false);
      const kicked = closedReason(guest);
      expect((await emitAck(host, "room:kick", guestId)).ok).toBe(true);
      expect(await kicked).toContain("房主");

      const otherClosed = closedReason(other);
      expect((await emitAck(other, "room:dissolve")).ok).toBe(false);
      expect((await emitAck(host, "room:dissolve")).ok).toBe(true);
      expect(await otherClosed).toContain("解散");
      expect((await joinRoom(await connectClient(), "After", created.data.code)).ok).toBe(false);
    });

    it("refuses kicks during a game and lets an admin dissolve any room", async () => {
      const { code, clients: table } = await startedRoom(["Admin Host", "Admin Guest"]);
      const guestId = table[1]!.id!;
      expect((await emitAck(table[0]!, "room:kick", guestId)).ok).toBe(false);

      const visitor = await connectClient();
      const lobby = await new Promise<AckResponse<PublicRoomSummary[]>>((resolve) => visitor.emit("lobby:get", resolve));
      if (!lobby.ok) throw new Error(lobby.error);
      const target = lobby.data.find((room) => room.players.some((player) => player.name === "Admin Host"))!;
      expect((await emitAck(visitor, "admin:dissolve", { roomId: target.id, token: "wrong" })).ok).toBe(false);

      const admin = await connectClient();
      const hostClosed = closedReason(table[0]!);
      expect((await emitAck(admin, "admin:dissolve", { roomId: target.id, token: adminToken })).ok).toBe(true);
      expect(await hostClosed).toContain("管理员");
      expect((await joinRoom(await connectClient(), "Admin Host", code)).ok).toBe(false);
    });
  });

  describe("voice", () => {
    type IceServers = import("@gem-merchant/game").IceServerConfig[];
    const joinVoice = (client: TestSocket, muted = false) =>
      new Promise<AckResponse<IceServers>>((resolve) => client.emit("voice:join", { muted }, resolve));
    const latestRoom = (client: TestSocket) => new Promise<LobbyRoomSnapshot>((resolve) => client.once("room:updated", resolve));

    it("hands out short-lived TURN credentials and relays signals only between voice members of one room", async () => {
      const host = await connectClient();
      const created = await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => host.emit("room:create", { name: "Voice Host", capacity: 4 }, resolve));
      if (!created.ok) throw new Error(created.error);
      const guest = await connectClient();
      await joinRoom(guest, "Voice Guest", created.data.code);
      const outsider = await connectClient();
      const otherRoom = await new Promise<AckResponse<LobbyRoomSnapshot>>((resolve) => outsider.emit("room:create", { name: "Outsider", capacity: 2 }, resolve));
      expect(otherRoom.ok).toBe(true);

      const joined = await joinVoice(host);
      if (!joined.ok) throw new Error(joined.error);
      const turn = joined.data.find((server) => server.username)!;
      expect(turn.urls).toContain("turn:turn.example.com:3478?transport=udp");
      const [expiry, memberId] = turn.username!.split(":");
      expect(memberId).toBe(host.id);
      expect(Number(expiry)).toBeGreaterThan(Date.now() / 1000);
      expect(turn.credential).toBe(createHmac("sha1", "turn-secret").update(turn.username!).digest("base64"));

      const received: unknown[] = [];
      guest.on("voice:signal", (payload) => received.push(payload));
      const offer = { description: { type: "offer" as const, sdp: "v=0" } };
      host.emit("voice:signal", { to: guest.id!, data: offer });
      await delay(80);
      expect(received).toHaveLength(0);

      const guestView = latestRoom(guest);
      await joinVoice(guest, true);
      expect((await guestView).voice).toEqual([{ id: host.id, muted: false }, { id: guest.id, muted: true }]);
      host.emit("voice:signal", { to: guest.id!, data: offer });
      outsider.emit("voice:signal", { to: guest.id!, data: offer });
      host.emit("voice:signal", { to: guest.id!, data: { description: { type: "bogus", sdp: 1 } } as never });
      await delay(80);
      expect(received).toEqual([{ from: host.id, data: offer }]);

      const afterLeave = latestRoom(host);
      await new Promise((resolve) => guest.emit("voice:leave", resolve));
      expect((await afterLeave).voice.map((entry) => entry.id)).toEqual([host.id]);
      const afterDisconnect = latestRoom(guest);
      host.disconnect();
      expect((await afterDisconnect).voice).toEqual([]);
    });
  });
});
