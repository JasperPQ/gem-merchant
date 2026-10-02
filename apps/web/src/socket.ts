import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@gem-merchant/game";

const serverUrl = import.meta.env.VITE_SERVER_URL
  ?? `${window.location.protocol}//${window.location.hostname}:3001`;

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 8,
});
