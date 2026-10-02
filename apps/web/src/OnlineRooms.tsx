import type { PublicRoomSummary } from "@gem-merchant/game";

const statusLabels: Record<PublicRoomSummary["status"], string> = {
  waiting: "等待中",
  playing: "对局中",
  finished: "已结束",
};

function OnlineRooms({ rooms, connected }: { rooms: PublicRoomSummary[]; connected: boolean }) {
  const onlineCount = rooms.reduce(
    (total, room) => total + room.players.filter((player) => player.connected).length,
    0,
  );

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

      {rooms.length > 0 ? (
        <div className="online-rooms-grid">
          {rooms.map((room) => (
            <article className={`online-room ${room.status}`} key={room.id}>
              <div className="online-room-top">
                <span className={`online-room-status ${room.status}`}>{statusLabels[room.status]}</span>
                <span className="online-room-seats">{room.players.length} / {room.capacity} 人</span>
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
            </article>
          ))}
        </div>
      ) : (
        <p className="online-rooms-empty">现在还没有房间，创建一间邀请朋友吧。</p>
      )}
      <p className="online-rooms-note">房间为邀请制，这里不显示房间码。</p>
    </section>
  );
}

export default OnlineRooms;
