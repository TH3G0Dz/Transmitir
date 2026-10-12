import { preferEfficientVideoCodec } from "./codec-support.js";

export function createHostPeerConnection(stream, iceServers, { onIceCandidate, onStateChange } = {}) {
  const pc = new RTCPeerConnection({ iceServers });
  const videoSender = pc.addTrack(stream.getVideoTracks()[0], stream);
  const videoTransceiver = pc.getTransceivers().find((transceiver) => transceiver.sender === videoSender);
  const preferredCodec = preferEfficientVideoCodec(videoTransceiver);
  const audioTrack = stream.getAudioTracks()[0];
  const audioTransceiver = audioTrack
    ? pc.addTransceiver(audioTrack, { direction: "sendonly", streams: [stream] })
    : pc.addTransceiver("audio", { direction: "sendonly", streams: [stream] });
  pc.onicecandidate = ({ candidate }) => onIceCandidate?.(candidate?.toJSON() ?? null);
  pc.onconnectionstatechange = () => onStateChange?.(pc.connectionState);
  return { pc, sender: videoSender, audioSender: audioTransceiver.sender, preferredCodec };
}

export function createViewerPeerConnection(iceServers, { onTrack, onIceCandidate, onStateChange } = {}) {
  const pc = new RTCPeerConnection({ iceServers });
  pc.ontrack = onTrack;
  pc.onicecandidate = ({ candidate }) => onIceCandidate?.(candidate?.toJSON() ?? null);
  pc.onconnectionstatechange = () => onStateChange?.(pc.connectionState);
  return pc;
}
