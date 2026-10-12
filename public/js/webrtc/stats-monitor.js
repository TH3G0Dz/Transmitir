const mbps = (bits) => `${(bits / 1_000_000).toFixed(1)} Mbps`;

export async function readPeerStats(peer) {
  const report = await peer.pc.getStats();
  let bitrate = null;
  let rtt = null;
  let lossRatio = null;
  let fps = null;
  let codecId = null;
  let codec = null;
  for (const item of report.values()) {
    if (item.type === "outbound-rtp" && (item.kind ?? item.mediaType) === "video" && item.bytesSent != null) {
      const prior = peer.lastStats;
      if (prior && item.timestamp > prior.timestamp) bitrate = ((item.bytesSent - prior.bytesSent) * 8 * 1000) / (item.timestamp - prior.timestamp);
      peer.lastStats = { bytesSent: item.bytesSent, timestamp: item.timestamp };
      fps = item.framesPerSecond ?? null;
      codecId = item.codecId ?? codecId;
    }
    if (item.type === "remote-inbound-rtp" && (item.kind ?? item.mediaType) === "video") {
      if (item.roundTripTime != null) rtt = item.roundTripTime * 1000;
      if (item.fractionLost != null) lossRatio = item.fractionLost;
    }
  }
  if (codecId) codec = report.get(codecId)?.mimeType?.replace("video/", "") ?? null;
  return { bitrate: bitrate == null ? "—" : mbps(bitrate), bitrateBps: bitrate, rtt: rtt == null ? "—" : `${Math.round(rtt)} ms`, rttMs: rtt, lossRatio, fps, codec };
}
