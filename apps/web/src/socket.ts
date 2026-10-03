import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@gem-merchant/game";

// 默认连接页面同源地址：开发时由 Vite 代理到 3001，线上由反向代理（如 Caddy）转发。
const serverUrl: string | undefined = import.meta.env.VITE_SERVER_URL;

const options = {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 8,
};

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = serverUrl
  ? io(serverUrl, options)
  : io(options);
