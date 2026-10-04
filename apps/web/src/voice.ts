import { useEffect, useRef, useState } from "react";
import type { IceServerConfig, LobbyRoomSnapshot, VoiceSignal } from "@gem-merchant/game";
import { socket } from "./socket.js";

/** 网址带 ?voice-relay 时强制走 TURN 中转，用于检查中转服务是否可用。 */
const FORCE_RELAY = new URLSearchParams(window.location.search).has("voice-relay");

/** 音量（0–1 的均方根）超过这个值就算在说话。 */
const SPEAKING_THRESHOLD = 0.035;

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  /** 远端描述到达之前收到的候选地址，先暂存。 */
  pendingCandidates: RTCIceCandidateInit[];
  localAdded: boolean;
}

export interface VoiceControls {
  joined: boolean;
  joining: boolean;
  muted: boolean;
  /** 没拿到麦克风权限，只能听。 */
  listenOnly: boolean;
  error: string;
  speaking: Set<string>;
  connections: Record<string, RTCPeerConnectionState>;
  join: () => void;
  leave: () => void;
  toggleMute: () => void;
}

/**
 * 房间语音：成员之间点对点（WebRTC）直连，服务器只转发协商消息；
 * 打不通直连时经 TURN 中转。连接方向固定为 id 较小的一方发起，避免双方同时发起。
 */
export function useVoice(room: LobbyRoomSnapshot | null): VoiceControls {
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [muted, setMuted] = useState(false);
  const [listenOnly, setListenOnly] = useState(false);
  const [error, setError] = useState("");
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [connections, setConnections] = useState<Record<string, RTCPeerConnectionState>>({});

  const joinedRef = useRef(false);
  const localStream = useRef<MediaStream | null>(null);
  const iceServers = useRef<IceServerConfig[]>([]);
  const peers = useRef(new Map<string, Peer>());
  const audioContext = useRef<AudioContext | null>(null);
  const analysers = useRef(new Map<string, AnalyserNode>());

  function watchLevel(id: string, stream: MediaStream) {
    const context = audioContext.current;
    if (!context || stream.getAudioTracks().length === 0) return;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    analysers.current.set(id, analyser);
  }

  function addLocalAudio(peer: Peer) {
    if (peer.localAdded) return;
    peer.localAdded = true;
    const stream = localStream.current;
    if (stream) {
      for (const track of stream.getAudioTracks()) peer.pc.addTrack(track, stream);
    } else if (!peer.pc.remoteDescription) {
      // 只听不说：仍然要声明一路接收音频。
      peer.pc.addTransceiver("audio", { direction: "recvonly" });
    }
  }

  async function sendOffer(peerId: string, iceRestart = false) {
    const peer = peers.current.get(peerId);
    if (!peer) return;
    const offer = await peer.pc.createOffer({ iceRestart });
    await peer.pc.setLocalDescription(offer);
    socket.emit("voice:signal", { to: peerId, data: { description: { type: "offer", sdp: offer.sdp ?? "" } } });
  }

  function createPeer(peerId: string, initiator: boolean): Peer {
    const pc = new RTCPeerConnection({ iceServers: iceServers.current, iceTransportPolicy: FORCE_RELAY ? "relay" : "all" });
    const audio = new Audio();
    audio.autoplay = true;
    const peer: Peer = { pc, audio, pendingCandidates: [], localAdded: false };
    peers.current.set(peerId, peer);

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const { candidate, sdpMid, sdpMLineIndex } = event.candidate.toJSON();
      socket.emit("voice:signal", {
        to: peerId,
        data: { candidate: { candidate: candidate ?? "", sdpMid: sdpMid ?? null, sdpMLineIndex: sdpMLineIndex ?? null } },
      });
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      audio.srcObject = stream;
      void audio.play().catch(() => undefined);
      watchLevel(peerId, stream);
    };
    pc.onconnectionstatechange = () => {
      setConnections((current) => ({ ...current, [peerId]: pc.connectionState }));
      // 网络变化导致断开时，由发起方重新协商。
      if (pc.connectionState === "failed" && initiator) {
        pc.restartIce();
        void sendOffer(peerId, true);
      }
    };

    if (initiator) {
      addLocalAudio(peer);
      void sendOffer(peerId);
    }
    return peer;
  }

  function closePeer(peerId: string) {
    const peer = peers.current.get(peerId);
    if (!peer) return;
    peer.pc.close();
    peer.audio.srcObject = null;
    peers.current.delete(peerId);
    analysers.current.delete(peerId);
    setConnections((current) => {
      const next = { ...current };
      delete next[peerId];
      return next;
    });
  }

  /** 清掉本地的一切语音资源；notifyServer 为 false 时只做本地清理（例如已断线）。 */
  function teardown(notifyServer: boolean) {
    if (!joinedRef.current) return;
    joinedRef.current = false;
    for (const peerId of [...peers.current.keys()]) closePeer(peerId);
    for (const track of localStream.current?.getTracks() ?? []) track.stop();
    localStream.current = null;
    analysers.current.clear();
    void audioContext.current?.close().catch(() => undefined);
    audioContext.current = null;
    setJoined(false);
    setMuted(false);
    setListenOnly(false);
    setSpeaking(new Set());
    setConnections({});
    if (notifyServer) socket.emit("voice:leave", () => undefined);
  }

  async function join() {
    if (joinedRef.current || joining || !room) return;
    setJoining(true);
    setError("");
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      setError(window.isSecureContext ? "没有拿到麦克风权限，已用「只听」方式加入。" : "当前不是 HTTPS 页面，浏览器不允许使用麦克风，已用「只听」方式加入。");
    }
    audioContext.current = new AudioContext();
    localStream.current = stream;
    if (stream && socket.id) watchLevel(socket.id, stream);
    socket.emit("voice:join", { muted: !stream }, (response) => {
      setJoining(false);
      if (!response.ok) {
        for (const track of stream?.getTracks() ?? []) track.stop();
        setError(response.error);
        return;
      }
      iceServers.current = response.data;
      joinedRef.current = true;
      setJoined(true);
      setListenOnly(!stream);
      setMuted(!stream);
    });
  }

  function toggleMute() {
    const stream = localStream.current;
    if (!stream) return;
    const next = !muted;
    for (const track of stream.getAudioTracks()) track.enabled = !next;
    setMuted(next);
    socket.emit("voice:mute", next, () => undefined);
  }

  // 收到其他成员转发来的协商消息。
  useEffect(() => {
    const handleSignal = async ({ from, data }: { from: string; data: VoiceSignal }) => {
      if (!joinedRef.current) return;
      let peer = peers.current.get(from);
      try {
        if ("description" in data) {
          if (data.description.type === "offer") {
            peer ??= createPeer(from, false);
            await peer.pc.setRemoteDescription(data.description);
            addLocalAudio(peer);
            const answer = await peer.pc.createAnswer();
            await peer.pc.setLocalDescription(answer);
            socket.emit("voice:signal", { to: from, data: { description: { type: "answer", sdp: answer.sdp ?? "" } } });
          } else {
            if (!peer) return;
            await peer.pc.setRemoteDescription(data.description);
          }
          for (const candidate of peer.pendingCandidates.splice(0)) await peer.pc.addIceCandidate(candidate);
        } else if (peer) {
          if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate);
          else peer.pendingCandidates.push(data.candidate);
        }
      } catch {
        // 单条协商消息失败不影响其他连接；连接失败时发起方会重新协商。
      }
    };
    const handleDisconnect = () => teardown(false);
    socket.on("voice:signal", handleSignal);
    socket.on("disconnect", handleDisconnect);
    return () => {
      socket.off("voice:signal", handleSignal);
      socket.off("disconnect", handleDisconnect);
    };
  }, []);

  // 语音成员变化时：对新成员建立连接（id 较小的一方发起），对离开的成员断开。
  const voiceIds = room?.voice.map((entry) => entry.id).join(",") ?? "";
  useEffect(() => {
    if (!joined || !room) return;
    const myId = socket.id ?? "";
    const others = room.voice.map((entry) => entry.id).filter((id) => id !== myId);
    for (const peerId of others) {
      if (!peers.current.has(peerId) && myId < peerId) createPeer(peerId, true);
    }
    for (const peerId of [...peers.current.keys()]) {
      if (!others.includes(peerId)) closePeer(peerId);
    }
  }, [joined, voiceIds]);

  // 离开房间或换房间时退出语音。
  useEffect(() => () => teardown(false), [room?.code]);

  // 说话检测：定时读取每路音量。
  useEffect(() => {
    if (!joined) return;
    const samples = new Uint8Array(512);
    const timer = window.setInterval(() => {
      const active = new Set<string>();
      for (const [id, analyser] of analysers.current) {
        if (id === socket.id && muted) continue;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
        if (Math.sqrt(sum / samples.length) > SPEAKING_THRESHOLD) active.add(id);
      }
      setSpeaking((current) => {
        const same = current.size === active.size && [...active].every((id) => current.has(id));
        return same ? current : active;
      });
    }, 200);
    return () => window.clearInterval(timer);
  }, [joined, muted]);

  return {
    joined,
    joining,
    muted,
    listenOnly,
    error,
    speaking,
    connections,
    join: () => void join(),
    leave: () => teardown(true),
    toggleMute,
  };
}
