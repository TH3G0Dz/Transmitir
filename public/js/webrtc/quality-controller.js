import { QUALITY_PROFILES } from "./media-capture.js";

// Keep the selected profile as the sender's ceiling and prefer retaining
// resolution when the connection is constrained. The browser still manages
// congestion control, but this app does not manually halve the video bitrate.
export async function applySenderBitrate(sender, profileKey) {
  const profile = QUALITY_PROFILES[profileKey];
  if (!profile || !sender?.track) return false;
  try {
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) parameters.encodings = [{}];
    parameters.encodings[0].maxBitrate = profile.bitrate;
    parameters.encodings[0].priority = "high";
    parameters.degradationPreference = "maintain-resolution";
    await sender.setParameters(parameters);
    return true;
  } catch {
    // Unsupported settings are left to the browser's normal WebRTC behavior.
    return false;
  }
}

export async function tunePeers(peers, profileKey) {
  await Promise.all([...peers.values()].map((peer) => applySenderBitrate(peer.sender, profileKey)));
}
