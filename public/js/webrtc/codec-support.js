const KNOWN_VIDEO_CODECS = new Set(["video/h264", "video/vp8", "video/vp9", "video/av1"]);
const EFFICIENT_CODEC_ORDER = ["video/av1", "video/vp9", "video/h264", "video/vp8"];

export function getSupportedVideoCodecs(senderType = globalThis.RTCRtpSender) {
  try {
    const capabilities = senderType?.getCapabilities?.("video");
    return [...new Set((capabilities?.codecs ?? [])
      .map((codec) => codec.mimeType?.toLowerCase())
      .filter((mimeType) => KNOWN_VIDEO_CODECS.has(mimeType))
      .map((mimeType) => mimeType.slice("video/".length).toUpperCase()))];
  } catch { return []; }
}

export function preferEfficientVideoCodec(transceiver) {
  if (typeof transceiver?.setCodecPreferences !== "function") return null;
  try {
    const codecs = transceiver.receiver?.getCapabilities?.("video")?.codecs;
    if (!codecs?.length) return null;
    const rank = (mimeType) => {
      const index = EFFICIENT_CODEC_ORDER.indexOf(mimeType?.toLowerCase());
      return index < 0 ? EFFICIENT_CODEC_ORDER.length : index;
    };
    const ordered = [...codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType));
    if (!ordered.some((codec) => rank(codec.mimeType) < EFFICIENT_CODEC_ORDER.length)) return null;
    transceiver.setCodecPreferences(ordered);
    return ordered.find((codec) => rank(codec.mimeType) < EFFICIENT_CODEC_ORDER.length)?.mimeType
      .replace(/^video\//i, "").toUpperCase() ?? null;
  } catch { return null; }
}
