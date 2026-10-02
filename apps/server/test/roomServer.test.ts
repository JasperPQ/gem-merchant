import { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import type {
  AckResponse,
  ClientToServerEvents,
  GameAction,
  GuestbookEntry,
  LobbyRoomSnapshot,
  PublicRoomSummary,
  ServerToClientEvents,
  SubmitGuestbookEntry,
} from "@gem-merchant/game";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const clients = new Set<TestSocket>();
let serverUrl = "";
let httpServer: typeof import("../src/index.js").httpServer;
let serverIo: typeof import("../src/index.js").io;
let guestbookFile = "";
let temporaryDirectory = "";
const previousGuestbookFile = process.env.GUESTBOOK_FILE;

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

function getGuestbook(client: TestSocket): Promise<AckResponse<GuestbookEntry[]>> {
  return new Promise((resolve) => client.emit("guestbook:get", resolve));
}

function postGuestbook(
  client: TestSocket,
  payload: SubmitGuestbookEntry,
): Promise<AckResponse<GuestbookEntry[]>> {
  return new Promise((resolve) => client.emit("guestbook:post", payload, resolve));
}

describe("Socket.IO lobby and game actions", () => {
  beforeAll(async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "gem-merchant-guestbook-"));
    guestbookFile = join(temporaryDirectory, "guestbook.json");
    process.env.GUESTBOOK_FILE = guestbookFile;
    const serverModule = await import("../src/index.js");
    httpServer = serverModule.httpServer;
    serverIo = serverModule.io;
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
    if (previousGuestbookFile === undefined) delete process.env.GUESTBOOK_FILE;
    else process.env.GUESTBOOK_FILE = previousGuestbookFile;
    rmSync(temporaryDirectory, { recursive: true, force: true });
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

  it("persists guest reviews and broadcasts them to other visitors", async () => {
    const author = await connectClient();
    const visitor = await connectClient();
    const initial = await getGuestbook(visitor);
    expect(initial).toEqual({ ok: true, data: [] });

    const visitorUpdate = new Promise<GuestbookEntry[]>((resolve) => {
      visitor.once("guestbook:updated", resolve);
    });
    const posted = await postGuestbook(author, {
      name: "Guest Reviewer",
      message: "A pleasant table for a quick game.",
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) throw new Error(posted.error);
    expect(posted.data[0]).toMatchObject({
      name: "Guest Reviewer",
      message: "A pleasant table for a quick game.",
    });

    const broadcast = await visitorUpdate;
    expect(broadcast).toEqual(posted.data);
    const persisted = JSON.parse(readFileSync(guestbookFile, "utf8")) as { entries: GuestbookEntry[] };
    expect(persisted.entries).toHaveLength(1);

    const rateLimited = await postGuestbook(author, { message: "Another review" });
    expect(rateLimited.ok).toBe(false);
    if (rateLimited.ok) throw new Error("Guestbook rate limit was not enforced.");
    expect(rateLimited.error).toContain("频繁");
  });
});
