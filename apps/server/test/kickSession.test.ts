import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";

// 同一个账号登录的设备超出上限时，游戏中心按登录编号（网关转来的 X-GC-Session 头）让游戏断开那次登录的连接。
const TOKEN = "kick-session-test-token";
let serverUrl = "";
let httpServer: typeof import("../src/index.js").httpServer;
let serverIo: typeof import("../src/index.js").io;
const clients: Socket[] = [];

function connect(session?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const client = createClient(serverUrl, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: session ? { "x-gc-session": session } : {},
    });
    clients.push(client);
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function kick(client: Socket, sessionId: string, token = TOKEN): Promise<{ ok: boolean; data?: number; error?: string }> {
  return new Promise((resolve) => client.emit("admin:kick-session", { sessionId, token }, resolve));
}

describe("admin:kick-session", () => {
  beforeAll(async () => {
    process.env.ADMIN_TOKEN = TOKEN;
    const server = await import("../src/index.js");
    httpServer = server.httpServer;
    serverIo = server.io;
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    serverUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const client of clients) client.close();
    await new Promise<void>((resolve) => serverIo.close(() => resolve()));
  });

  it("disconnects every connection of that login, tells it why, and leaves other logins alone", async () => {
    const a1 = await connect("sess-a");
    const a2 = await connect("sess-a");
    const b = await connect("sess-b");
    const admin = await connect();
    const outsider = await connect();

    expect((await kick(outsider, "sess-a", "wrong-token")).ok).toBe(false);
    expect(a1.connected && a2.connected).toBe(true);

    const told = Promise.all([a1, a2].map((client) => new Promise<void>((resolve) => client.once("session:kicked", () => resolve()))));
    const gone = Promise.all([a1, a2].map((client) => new Promise<string>((resolve) => client.once("disconnect", resolve))));
    const result = await kick(admin, "sess-a");
    expect(result).toEqual({ ok: true, data: 2 });
    await told;
    expect(await gone).toEqual(["io server disconnect", "io server disconnect"]);
    expect(b.connected).toBe(true);
    expect(await kick(admin, "sess-a")).toEqual({ ok: true, data: 0 });
    expect(await kick(admin, "no-such-login")).toEqual({ ok: true, data: 0 });
  });
});
