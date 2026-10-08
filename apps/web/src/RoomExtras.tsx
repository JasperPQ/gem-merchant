import { useState } from "react";
import type { LobbyRoomSnapshot, RoomAccess } from "@gem-merchant/game";
import { socket } from "./socket.js";

/** 我在这个房间里的身份：坐着的玩家（可能是房主）还是观战的人。 */
export function roomRole(room: LobbyRoomSnapshot) {
  const member = room.members.find((candidate) => candidate.id === socket.id);
  return { member, spectating: !member, isHost: member?.isHost ?? false };
}

/** 这款游戏有没有藏起来的信息（手牌等）；没有的话不显示「观战看手牌」。 */
const HIDDEN_INFO = true;
/** 藏起来的是什么（显示在开关上）。 */
const SECRET = "暗扣的卡";

const ALL_OPTIONS: { key: keyof RoomAccess; label: string; hint: string }[] = [
  { key: "allowSpectators", label: "允许观战", hint: "有房间码、或者从首页列表都能进来看" },
  { key: "spectatorsSeeAll", label: `观战看${SECRET}`, hint: `打开后观战的人能看到${SECRET}；关掉只看公开信息` },
  { key: "open", label: "公开房间", hint: "不认识的人也能从首页列表直接加入空座位" },
];
const OPTIONS = ALL_OPTIONS.filter((option) => HIDDEN_INFO || option.key !== "spectatorsSeeAll");

type Ack = { ok: true; data: void } | { ok: false; error: string };

/** 房间设置（房主能点，其他人只看）+ 观战名单（房主能移出）。等候房间和牌桌上的设置弹窗共用。 */
export function RoomSettingsPanel({ room }: { room: LobbyRoomSnapshot }) {
  const { isHost } = roomRole(room);
  const [error, setError] = useState("");
  const done = (response: Ack) => setError(response.ok ? "" : response.error);
  const toggle = (key: keyof RoomAccess) => socket.emit("room:access", { [key]: !room.access[key] }, done);
  const kick = (id: string) => socket.emit("room:kick", id, done);

  return (
    <div className="room-settings">
      <div className="panel-label">房间设置 <span>{isHost ? "房主随时可以改" : "只有房主能改"}</span></div>
      <div className="room-settings-options">
        {OPTIONS.map((option) => {
          const on = room.access[option.key];
          const off = option.key === "spectatorsSeeAll" && !room.access.allowSpectators;
          return (
            <button
              key={option.key}
              type="button"
              className={on && !off ? "room-setting on" : "room-setting"}
              aria-pressed={on && !off}
              disabled={!isHost || off}
              onClick={() => toggle(option.key)}
              title={option.hint}
            >
              <i aria-hidden="true" />{option.label}
            </button>
          );
        })}
      </div>
      {room.access.allowSpectators && (
        <div className="room-spectators">
          <span>观战 {room.spectators.length} 人</span>
          {room.spectators.map((spectator) => (
            <span className="room-spectator" key={spectator.id}>
              {spectator.id === socket.id ? "你" : spectator.name}
              {isHost && (
                <button type="button" onClick={() => kick(spectator.id)} title={`把 ${spectator.name} 移出房间`} aria-label={`移出 ${spectator.name}`}>×</button>
              )}
            </span>
          ))}
        </div>
      )}
      {error && <p className="feedback feedback-error" role="alert">{error}</p>}
    </div>
  );
}

/** 等候房间里换位置：观战的人坐到空座位，玩家（房主除外）改成观战。 */
export function SeatSwitch({ room }: { room: LobbyRoomSnapshot }) {
  const { spectating, isHost } = roomRole(room);
  const [error, setError] = useState("");
  if (room.status !== "waiting" || isHost) return null;
  const full = room.members.length >= room.capacity;
  if (!spectating && !room.access.allowSpectators) return null;
  const done = (response: Ack) => setError(response.ok ? "" : response.error);
  return (
    <div className="seat-switch">
      {spectating ? (
        <button className="quiet-button" type="button" disabled={full} onClick={() => socket.emit("room:sit", done)}>
          {full ? "座位已满" : "坐下一起玩"}
        </button>
      ) : (
        <button className="quiet-button" type="button" onClick={() => socket.emit("room:stand", done)}>改成观战</button>
      )}
      {error && <p className="feedback feedback-error" role="alert">{error}</p>}
    </div>
  );
}

/** 牌桌上的房间设置按钮：房主改设置、看观战名单；其他人看到观战人数。 */
export function GameRoomMenu({ room }: { room: LobbyRoomSnapshot }) {
  const { isHost } = roomRole(room);
  const [open, setOpen] = useState(false);
  const count = room.spectators.length;
  if (!isHost) {
    return count > 0 ? <span className="spectator-count" title={room.spectators.map((spectator) => spectator.name).join("、")}>观战 {count}</span> : null;
  }
  return (
    <span className="game-room-menu">
      <button className="quiet-button" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        房间设置{count > 0 ? ` · 观战 ${count}` : ""}
      </button>
      {open && (
        <div className="game-room-popover" role="dialog" aria-label="房间设置">
          <RoomSettingsPanel room={room} />
          <button className="quiet-button" type="button" onClick={() => setOpen(false)}>关闭</button>
        </div>
      )}
    </span>
  );
}

/** 观战的人在牌桌上看到的条：换一个座位的视角、离开。 */
export function SpectateBar({ room, watchId, onWatch, onLeave, showSeats = true }: {
  room: LobbyRoomSnapshot;
  watchId: string;
  onWatch: (playerId: string) => void;
  onLeave: () => void;
  /** 牌桌不分座位视角（所有人看到的一样）时不显示换座位。 */
  showSeats?: boolean;
}) {
  const players = room.game?.players ?? [];
  return (
    <div className="spectate-bar">
      <strong>观战中</strong>
      <span className="spectate-hint">{HIDDEN_INFO ? (room.access.spectatorsSeeAll ? `能看到${SECRET}` : "只看公开信息") : ""}{HIDDEN_INFO && showSeats ? " · " : ""}{showSeats ? "从谁的座位看：" : ""}</span>
      {showSeats && <span className="spectate-seats">
        {players.map((player) => (
          <button
            key={player.id}
            type="button"
            className={player.id === watchId ? "spectate-seat on" : "spectate-seat"}
            aria-pressed={player.id === watchId}
            onClick={() => onWatch(player.id)}
          >
            {player.name}
          </button>
        ))}
      </span>}
      <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>
    </div>
  );
}
