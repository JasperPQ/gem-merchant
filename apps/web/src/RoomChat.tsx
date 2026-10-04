import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LobbyRoomSnapshot } from "@gem-merchant/game";
import { socket } from "./socket.js";
import type { VoiceControls } from "./voice.js";
import VoiceBar from "./VoiceBar.js";

const CHAT_MAX_LENGTH = 200;

function formatTime(value: string): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function RoomChat({ room, voice }: { room: LobbyRoomSnapshot; voice: VoiceControls }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const messages = room.chat;
  const lastMessageId = messages[messages.length - 1]?.id;

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lastMessageId]);

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setError("");
    socket.emit("room:chat", { message }, (response) => {
      setSending(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setDraft("");
    });
  }

  return (
    <section className={room.status === "waiting" ? "room-chat light" : "room-chat"} aria-labelledby="room-chat-title">
      <div className="room-chat-heading">
        <h2 id="room-chat-title">房间对话</h2>
        <span>仅房间内可见 · 对局结束后自动清空</span>
      </div>
      <VoiceBar room={room} voice={voice} />
      <div className="room-chat-list" ref={listRef} aria-live="polite">
        {messages.length > 0 ? messages.map((entry) => (
          <div className={entry.senderId === socket.id ? "room-chat-message mine" : "room-chat-message"} key={entry.id}>
            <div className="room-chat-meta">
              <strong>{entry.senderId === socket.id ? "你" : entry.name}</strong>
              <time dateTime={entry.createdAt}>{formatTime(entry.createdAt)}</time>
            </div>
            <p>{entry.message}</p>
          </div>
        )) : <p className="room-chat-empty">还没有消息，打个招呼吧。</p>}
      </div>
      <form className="room-chat-form" onSubmit={sendMessage}>
        <input
          className="room-chat-input"
          value={draft}
          maxLength={CHAT_MAX_LENGTH}
          placeholder="输入消息，回车发送"
          aria-label="聊天消息"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="room-chat-send" type="submit" disabled={sending || !draft.trim()}>发送</button>
      </form>
      {error && <p className="room-chat-error" role="alert">{error}</p>}
    </section>
  );
}

export default RoomChat;
