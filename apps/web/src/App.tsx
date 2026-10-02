import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { GameAction, GuestbookEntry, LobbyRoomSnapshot } from "@gem-merchant/game";
import GameBoard from "./GameBoard.js";
import RoomChat from "./RoomChat.js";
import { socket } from "./socket.js";

type EntryMode = "create" | "join";
type Capacity = 2 | 3 | 4;

const validRoomCode = /^[A-HJ-NP-Z2-9]{6}$/;

function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);
}

function App() {
  const [mode, setMode] = useState<EntryMode>("create");
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState<Capacity>(4);
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<LobbyRoomSnapshot | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestMessage, setGuestMessage] = useState("");
  const [guestbookEntries, setGuestbookEntries] = useState<GuestbookEntry[]>([]);
  const [guestbookBusy, setGuestbookBusy] = useState(false);
  const [guestbookError, setGuestbookError] = useState("");
  const [guestbookNotice, setGuestbookNotice] = useState("");

  useEffect(() => {
    const loadGuestbook = () => {
      setConnected(true);
      socket.emit("guestbook:get", (response) => {
        if (response.ok) setGuestbookEntries(response.data);
      });
    };
    const handleDisconnect = () => setConnected(false);
    const handleRoomUpdate = (snapshot: LobbyRoomSnapshot) => setRoom(snapshot);
    const handleRoomError = (message: string) => setError(message);
    const handleGuestbookUpdate = (entries: GuestbookEntry[]) => setGuestbookEntries(entries);

    socket.on("connect", loadGuestbook);
    socket.on("disconnect", handleDisconnect);
    socket.on("room:updated", handleRoomUpdate);
    socket.on("room:error", handleRoomError);
    socket.on("guestbook:updated", handleGuestbookUpdate);
    socket.connect();

    return () => {
      socket.off("connect", loadGuestbook);
      socket.off("disconnect", handleDisconnect);
      socket.off("room:updated", handleRoomUpdate);
      socket.off("room:error", handleRoomError);
      socket.off("guestbook:updated", handleGuestbookUpdate);
      socket.disconnect();
    };
  }, []);

  const canSubmit = useMemo(() => {
    if (!connected || busy || name.trim().length < 2 || name.trim().length > 18) return false;
    return mode === "create" || validRoomCode.test(roomCode);
  }, [busy, connected, mode, name, roomCode]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const nickname = name.trim();

    const complete = (response: { ok: true; data: LobbyRoomSnapshot } | { ok: false; error: string }) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice(mode === "create" ? "房间已创建，可以邀请朋友加入。" : "已加入房间。" );
    };

    if (mode === "create") {
      socket.emit("room:create", { name: nickname, capacity }, complete);
    } else {
      socket.emit("room:join", { name: nickname, code: roomCode }, complete);
    }
  }

  function startGame() {
    setError("");
    setBusy(true);
    socket.emit("room:start", (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice("对局已开始，祝你好运。" );
    });
  }

  function leaveRoom() {
    setBusy(true);
    socket.emit("room:leave", (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(null);
      setError("");
      setNotice("已离开房间。" );
    });
  }

  function submitGameAction(action: GameAction) {
    setBusy(true);
    setError("");
    setNotice("");
    socket.emit("game:action", action, (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice("行动已同步。" );
    });
  }

  function submitGuestbookEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGuestbookBusy(true);
    setGuestbookError("");
    setGuestbookNotice("");
    socket.emit("guestbook:post", {
      ...(guestName.trim() ? { name: guestName.trim() } : {}),
      message: guestMessage,
    }, (response) => {
      setGuestbookBusy(false);
      if (!response.ok) {
        setGuestbookError(response.error);
        return;
      }
      setGuestbookEntries(response.data);
      setGuestMessage("");
      setGuestbookNotice("感谢留言，其他访客现在也能看到了。");
    });
  }

  async function copyRoomCode() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setNotice("房间码已复制。" );
    } catch {
      setNotice("请手动复制房间码。" );
    }
  }

  if (room) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <Brand />
          <ConnectionStatus connected={connected} />
        </header>
        {room.status === "playing" && room.game ? (
          <GameBoard room={room} busy={busy} error={error} notice={notice} onAction={submitGameAction} />
        ) : (
          <RoomView
            room={room}
            busy={busy}
            error={error}
            notice={notice}
            onCopyCode={copyRoomCode}
            onLeave={leaveRoom}
            onStart={startGame}
          />
        )}
        <RoomChat room={room} />
        <footer className="page-footer">围坐桌边，专注每一次选择。</footer>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Brand />
        <ConnectionStatus connected={connected} />
      </header>

      <section className="welcome-grid">
        <div className="welcome-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> 在线对战 · 2—4 人</div>
          <h1>Splendor</h1>
          <p className="welcome-description">
            创建一间私人牌桌，或输入房间码加入朋友的对局。无需注册，选好昵称即可开始。
          </p>
          <div className="gem-showcase" aria-hidden="true">
            <span className="gem gem-white" />
            <span className="gem gem-blue" />
            <span className="gem gem-green" />
            <span className="gem gem-red" />
            <span className="gem gem-black" />
            <span className="showcase-caption">五色宝石 · 一场较量</span>
          </div>
        </div>

        <section className="entry-card" aria-labelledby="entry-title">
          <div className="entry-card-heading">
            <div>
              <span className="section-kicker">准备开始</span>
              <h2 id="entry-title">进入牌桌</h2>
            </div>
            <span className="step-indicator">01 <i /> 02</span>
          </div>

          <div className="mode-switch" role="tablist" aria-label="选择房间操作">
            <button
              className={mode === "create" ? "mode-tab active" : "mode-tab"}
              type="button"
              role="tab"
              aria-selected={mode === "create"}
              onClick={() => { setMode("create"); setError(""); }}
            >
              创建房间
            </button>
            <button
              className={mode === "join" ? "mode-tab active" : "mode-tab"}
              type="button"
              role="tab"
              aria-selected={mode === "join"}
              onClick={() => { setMode("join"); setError(""); }}
            >
              加入房间
            </button>
          </div>

          <form className="entry-form" onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="player-name">你的昵称</label>
            <input
              id="player-name"
              className="text-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="输入 2–18 个字符"
              minLength={2}
              maxLength={18}
              autoComplete="nickname"
              required
            />

            {mode === "create" ? (
              <>
                <label className="field-label field-label-spaced" htmlFor="room-capacity">房间人数</label>
                <div className="capacity-options" id="room-capacity" role="group" aria-label="选择房间人数">
                  {([2, 3, 4] as const).map((seats) => (
                    <button
                      key={seats}
                      type="button"
                      className={capacity === seats ? "capacity-option selected" : "capacity-option"}
                      aria-pressed={capacity === seats}
                      onClick={() => setCapacity(seats)}
                    >
                      <strong>{seats}</strong>
                      <span>位玩家</span>
                    </button>
                  ))}
                </div>
                <p className="field-hint">至少 2 位玩家后，房主即可开始。</p>
              </>
            ) : (
              <>
                <label className="field-label field-label-spaced" htmlFor="room-code">房间码</label>
                <input
                  id="room-code"
                  className="text-input room-code-input"
                  value={roomCode}
                  onChange={(event) => setRoomCode(normalizeRoomCode(event.target.value))}
                  placeholder="例如：7KQ2TX"
                  autoComplete="off"
                  maxLength={6}
                  required
                />
                <p className="field-hint">房间码为 6 位字母或数字，不含易混淆字符。</p>
              </>
            )}

            {error && <p className="feedback feedback-error" role="alert">{error}</p>}
            {notice && <p className="feedback feedback-success" role="status">{notice}</p>}

            <button className="primary-button" type="submit" disabled={!canSubmit}>
              {busy ? <><span className="spinner" /> 正在连接</> : mode === "create" ? "创建私人房间" : "加入牌桌"}
              {!busy && <span aria-hidden="true">↗</span>}
            </button>
          </form>
          <div className="entry-footnote"><span className="lock-icon">◇</span> 私人房间 · 邀请制加入</div>
        </section>
      </section>

      <section className="how-it-works" aria-label="游戏流程">
        <div className="how-item"><span className="how-number">01</span><span>创建或加入</span></div>
        <span className="how-divider" />
        <div className="how-item"><span className="how-number">02</span><span>等待朋友就位</span></div>
        <span className="how-divider" />
        <div className="how-item"><span className="how-number">03</span><span>开始对局</span></div>
      </section>
      <Guestbook
        entries={guestbookEntries}
        name={guestName}
        message={guestMessage}
        busy={guestbookBusy}
        connected={connected}
        error={guestbookError}
        notice={guestbookNotice}
        onNameChange={setGuestName}
        onMessageChange={setGuestMessage}
        onSubmit={submitGuestbookEntry}
      />
      <footer className="page-footer">围坐桌边，专注每一次选择。</footer>
    </main>
  );
}

function Guestbook({
  entries,
  name,
  message,
  busy,
  connected,
  error,
  notice,
  onNameChange,
  onMessageChange,
  onSubmit,
}: {
  entries: GuestbookEntry[];
  name: string;
  message: string;
  busy: boolean;
  connected: boolean;
  error: string;
  notice: string;
  onNameChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="guestbook" aria-labelledby="guestbook-title">
      <div className="guestbook-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> 来访者的声音</div>
          <h2 id="guestbook-title">写下你的评价。</h2>
          <p>给后来加入的玩家留句话，也看看大家对牌桌的感受。</p>
        </div>
        <span className="guestbook-count">{entries.length} 条留言</span>
      </div>

      <div className="guestbook-layout">
        <form className="guestbook-form" onSubmit={onSubmit}>
          <label className="field-label" htmlFor="guestbook-name">怎么称呼你？ <span>可选</span></label>
          <input
            id="guestbook-name"
            className="text-input"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="留空则显示为游客"
            maxLength={18}
            autoComplete="nickname"
          />
          <label className="field-label field-label-spaced" htmlFor="guestbook-message">你的评价</label>
          <textarea
            id="guestbook-message"
            className="text-input guestbook-textarea"
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder="分享一下你的体验……"
            maxLength={280}
            required
          />
          <div className="guestbook-form-meta"><span>公开展示 · 请勿填写个人敏感信息</span><span>{message.length} / 280</span></div>
          {error && <p className="feedback feedback-error" role="alert">{error}</p>}
          {notice && <p className="feedback feedback-success" role="status">{notice}</p>}
          <button className="primary-button guestbook-submit" type="submit" disabled={!connected || busy || message.trim().length < 2}>
            {busy ? <><span className="spinner" /> 正在发布</> : "发布留言"}
            {!busy && <span aria-hidden="true">↗</span>}
          </button>
        </form>

        <div className="guestbook-list" aria-live="polite" aria-label="游客评价">
          {entries.length > 0 ? entries.map((entry) => (
            <article className="guestbook-entry" key={entry.id}>
              <div className="guestbook-entry-avatar">{entry.name.slice(0, 1).toUpperCase()}</div>
              <div className="guestbook-entry-content">
                <div className="guestbook-entry-meta">
                  <strong>{entry.name}</strong>
                  <time dateTime={entry.createdAt}>{formatGuestbookDate(entry.createdAt)}</time>
                </div>
                <p>{entry.message}</p>
              </div>
            </article>
          )) : (
            <div className="guestbook-empty">
              <span aria-hidden="true">✦</span>
              <strong>还没有访客留言</strong>
              <p>写下第一条评价，开启这里的对话。</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function formatGuestbookDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function Brand() {
  return (
    <a className="brand" href="/" aria-label="宝石商人首页">
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
      <span className="brand-name">宝石商人<span> GEM MERCHANT</span></span>
    </a>
  );
}

function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <div className={connected ? "connection-status online" : "connection-status"}>
      <span className="connection-dot" />
      {connected ? "服务已连接" : "连接中…"}
    </div>
  );
}

function RoomView({
  room,
  busy,
  error,
  notice,
  onCopyCode,
  onLeave,
  onStart,
}: {
  room: LobbyRoomSnapshot;
  busy: boolean;
  error: string;
  notice: string;
  onCopyCode: () => void;
  onLeave: () => void;
  onStart: () => void;
}) {
  const host = room.members.find((member) => member.isHost);
  const currentMember = room.members.find((member) => member.id === socket.id);
  const isHost = currentMember?.isHost ?? false;
  const openSeats = Math.max(0, room.capacity - room.members.length);

  return (
    <section className="room-layout">
      <div className="room-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> {room.status === "waiting" ? "等待大厅" : "对局已创建"}</div>
          <h1>{room.status === "waiting" ? "牌桌准备中。" : "好戏即将开始。"}</h1>
          <p>{room.status === "waiting" ? "把房间码分享给朋友，等大家就位后开始。" : "房间状态已同步，下一步将接入完整棋盘。"}</p>
        </div>
        <button className="quiet-button" type="button" onClick={onLeave} disabled={busy || room.status === "playing"}>
          离开房间
        </button>
      </div>

      {room.status === "waiting" ? (
        <div className="room-grid">
          <section className="room-panel room-code-panel">
            <div className="panel-label">房间码 <span>仅分享给朋友</span></div>
            <button className="room-code-display" type="button" onClick={onCopyCode} title="复制房间码">
              {room.code}<span aria-hidden="true">⧉</span>
            </button>
            <div className="room-code-caption">点击复制 · 6 位邀请代码</div>
          </section>

          <section className="room-panel player-panel">
            <div className="panel-topline">
              <div className="panel-label">玩家 <span>{room.members.length} / {room.capacity}</span></div>
              <span className="waiting-pill"><i /> 等待中</span>
            </div>
            <div className="player-list">
              {room.members.map((member, index) => (
                <div className="player-row" key={member.id}>
                  <div className={`player-avatar avatar-${index + 1}`}>{member.name.slice(0, 1).toUpperCase()}</div>
                  <div className="player-details">
                    <strong>{member.name}{member.id === socket.id ? <small>你</small> : null}</strong>
                    <span>{member.isHost ? "房主" : "已加入"}</span>
                  </div>
                  {member.isHost && <span className="host-badge">房主</span>}
                </div>
              ))}
              {Array.from({ length: openSeats }, (_, index) => (
                <div className="player-row open-seat" key={`open-${index}`}>
                  <div className="empty-avatar"><span>＋</span></div>
                  <div className="player-details"><strong>等待玩家加入</strong><span>分享房间码邀请朋友</span></div>
                </div>
              ))}
            </div>
            <div className="room-actions">
              {isHost ? (
                <button className="primary-button" type="button" onClick={onStart} disabled={busy || room.members.length < 2}>
                  {busy ? <><span className="spinner" /> 正在开始</> : "开始对局"}<span aria-hidden="true">↗</span>
                </button>
              ) : (
                <div className="host-wait-note"><span className="pulse-dot" /> 等待房主开始对局</div>
              )}
              {isHost && room.members.length < 2 && <p className="field-hint centered">还需要至少 1 位玩家加入。</p>}
            </div>
          </section>
        </div>
      ) : (
        <section className="room-panel game-ready-panel">
          <div className="panel-label">对局状态 <span>服务端已初始化规则状态</span></div>
          <div className="ready-summary">
            <div><strong>{room.game?.players.length ?? room.members.length}</strong><span>位玩家</span></div>
            <div><strong>{room.game?.market[1].length ?? 0}</strong><span>一级卡牌明牌</span></div>
            <div><strong>{room.game?.noblesAvailable.length ?? 0}</strong><span>位贵族</span></div>
          </div>
          <p className="game-ready-copy">当前回合：{room.game?.players[room.game.activePlayerIndex]?.name ?? host?.name ?? "房主"}。对战桌面将在下一阶段接入。</p>
        </section>
      )}

      {error && <p className="feedback feedback-error room-feedback" role="alert">{error}</p>}
      {notice && <p className="feedback feedback-success room-feedback" role="status">{notice}</p>}
      <div className="room-secure-note"><span>◇</span> 房间为私人邀请制，不会出现在公开列表。</div>
    </section>
  );
}

export default App;
