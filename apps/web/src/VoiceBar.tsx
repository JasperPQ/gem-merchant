import type { LobbyRoomSnapshot } from "@gem-merchant/game";
import { socket } from "./socket.js";
import type { VoiceControls } from "./voice.js";

const connectionLabels: Partial<Record<RTCPeerConnectionState, string>> = {
  new: "连接中",
  connecting: "连接中",
  disconnected: "信号不稳",
  failed: "连接失败",
};

/** 房间语音：加入/退出、静音，以及谁在语音里、谁正在说话。 */
function VoiceBar({ room, voice }: { room: LobbyRoomSnapshot; voice: VoiceControls }) {
  const nameOf = (id: string) => room.members.find((member) => member.id === id)?.name ?? "玩家";
  const participants = room.voice;

  return (
    <div className="voice-bar">
      <div className="voice-bar-row">
        {voice.joined ? (
          <>
            <button
              type="button"
              className={voice.muted ? "voice-button" : "voice-button live"}
              onClick={voice.toggleMute}
              disabled={voice.listenOnly}
              title={voice.listenOnly ? "没有麦克风权限，只能听" : voice.muted ? "打开麦克风" : "关闭麦克风"}
            >
              {voice.listenOnly ? "只听模式" : voice.muted ? "🔇 已静音" : "🎙 麦克风开"}
            </button>
            <button type="button" className="voice-button leave" onClick={voice.leave}>退出语音</button>
          </>
        ) : (
          <button type="button" className="voice-button join" onClick={voice.join} disabled={voice.joining}>
            {voice.joining ? "正在加入…" : "🎧 加入语音"}
          </button>
        )}
        <span className="voice-count">{participants.length > 0 ? `${participants.length} 人在语音中` : "语音里还没有人"}</span>
      </div>
      {participants.length > 0 && (
        <div className="voice-people">
          {participants.map((participant) => {
            const mine = participant.id === socket.id;
            const state = voice.connections[participant.id];
            const pending = voice.joined && !mine ? connectionLabels[state ?? "new"] : undefined;
            return (
              <span
                key={participant.id}
                className={`voice-person${voice.speaking.has(participant.id) ? " speaking" : ""}${participant.muted ? " muted" : ""}`}
                data-connection={mine ? "self" : state ?? "none"}
                title={participant.muted ? "已静音" : "麦克风开着"}
              >
                <i aria-hidden="true">{participant.muted ? "🔇" : "🎙"}</i>
                {mine ? "你" : nameOf(participant.id)}
                {pending && <small>{pending}</small>}
              </span>
            );
          })}
        </div>
      )}
      {voice.error && <p className="voice-error">{voice.error}</p>}
    </div>
  );
}

export default VoiceBar;
