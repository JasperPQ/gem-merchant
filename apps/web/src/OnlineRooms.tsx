import type { PublicRoomSummary } from "@gem-merchant/game";
import AdminBar, { adminEntryEnabled, useAdminToken } from "./AdminBar.js";
import type { useConfirm } from "./confirm.js";
import { socket } from "./socket.js";

const statusLabels: Record<PublicRoomSummary["status"], string> = {
  waiting: "等待中",
  playing: "对局中",
  finished: "已结束",
};

function OnlineRooms({ rooms, connected, confirm, busy, onJoin }: {
  rooms: PublicRoomSummary[];
  connected: boolean;
  confirm: ReturnType<typeof useConfirm>[0];
  busy: boolean;
  /** 从列表加入空座位（spectate 为 false）或者进去观战。 */
  onJoin: (roomId: string, spectate: boolean) => void;
}) {
  const onlineCount = rooms.reduce(
    (total, room) => total + room.players.filter((player) => player.connected).length,
    0,
  );
  const admin = useAdminToken();

  async function dissolve(room: PublicRoomSummary) {
    const names = room.players.map((player) => player.name).join("、");
    const ok = await confirm({
      title: "解散这个房间？",
      detail: `${names}，所有玩家都会被移出。`,
      confirmLabel: "解散房间",
    });
    if (!ok) return;
    admin.setError("");
    socket.emit("admin:dissolve", { roomId: room.id, token: admin.token }, (response) => {
      if (!response.ok) admin.setError(response.error);
    });
  }

  return (
    <section className="online-rooms" aria-labelledby="online-rooms-title">
      <div className="online-rooms-heading">
        <div>
          <span className="section-kicker">LIVE TABLES</span>
          <h2 id="online-rooms-title">在线牌桌</h2>
        </div>
        <span className="online-rooms-count">
          <i className={onlineCount > 0 ? "live" : ""} aria-hidden="true" />
          {connected ? `${onlineCount} 人在线 · ${rooms.length} 个房间` : "连接中…"}
        </span>
      </div>

      {adminEntryEnabled && (
        <AdminBar token={admin.token} error={admin.error} connected={connected} onLogin={admin.login} onLogout={admin.logout} />
      )}

      {rooms.length > 0 ? (
        <div className="online-rooms-grid">
          {rooms.map((room) => (
            <article className={`online-room ${room.status}`} key={room.id}>
              <div className="online-room-top">
                <span className={`online-room-status ${room.status}`}>{statusLabels[room.status]}</span>
                <span className="online-room-seats">
                  {room.open ? <em className="online-room-tag open">公开</em> : null}
                  {room.spectators > 0 ? <em className="online-room-tag">观战 {room.spectators}</em> : null}
                  {room.players.length} / {room.capacity} 人
                </span>
              </div>
              <ul className="online-room-players">
                {room.players.map((player) => (
                  <li key={player.name} className={player.connected ? "" : "offline"}>
                    <span className={player.connected ? "presence online" : "presence"} title={player.connected ? "在线" : "离线"} />
                    <span className="online-room-name">{player.name}</span>
                    {player.isHost && room.status === "waiting" && <small>房主</small>}
                    {player.isActive && <small className="turn">行动中</small>}
                    {player.isWinner && <small className="winner">胜者</small>}
                    {!player.connected && <small>离线</small>}
                    {player.score !== undefined && <b>{player.score}<span> 分</span></b>}
                  </li>
                ))}
              </ul>
              {(() => {
                const canSit = room.open && room.status === "waiting" && room.players.length < room.capacity;
                if (!canSit && !room.allowSpectators) return null;
                return (
                  <div className="online-room-actions">
                    {canSit && <button className="online-room-join" type="button" disabled={busy || !connected} onClick={() => onJoin(room.id, false)}>加入</button>}
                    {room.allowSpectators && room.status !== "finished" && (
                      <button className="online-room-watch" type="button" disabled={busy || !connected} onClick={() => onJoin(room.id, true)}>观战</button>
                    )}
                  </div>
                );
              })()}
              {admin.token && (
                <button className="admin-dissolve" type="button" onClick={() => dissolve(room)}>解散房间</button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p className="online-rooms-empty">现在还没有房间，创建一间邀请朋友吧。</p>
      )}
      <p className="online-rooms-note">这里不显示房间码。房主设为公开的房间可以直接加入，允许观战的房间可以进去看。</p>
    </section>
  );
}

export default OnlineRooms;
