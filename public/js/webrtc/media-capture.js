export const QUALITY_PROFILES = Object.freeze({
  "720p60": { label: "720p · 60 FPS", width: 1280, height: 720, fps: 60, bitrate: 6_000_000 },
  "1080p30": { label: "1080p · 30 FPS", width: 1920, height: 1080, fps: 30, bitrate: 8_000_000 },
  "1080p60": { label: "1080p · 60 FPS", width: 1920, height: 1080, fps: 60, bitrate: 12_000_000 },
  "1440p60": { label: "1440p · 60 FPS", width: 2560, height: 1440, fps: 60, bitrate: 20_000_000 }
});

export function captureScreen(profileKey, includeAudio) {
  const profile = QUALITY_PROFILES[profileKey] ?? QUALITY_PROFILES["1080p30"];
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Este navegador não oferece captura de tela compatível.");
  // A chamada começa diretamente após o clique do usuário, como exige o navegador.
  return navigator.mediaDevices.getDisplayMedia({
    video: { width: { ideal: profile.width }, height: { ideal: profile.height }, frameRate: { ideal: profile.fps, max: profile.fps } },
    audio: includeAudio
  });
}

export function setCaptureContentHint(stream, hint) {
  const track = stream?.getVideoTracks()[0];
  if (!track || !["detail", "motion", "text"].includes(hint) || !("contentHint" in track)) return false;
  try { track.contentHint = hint; return track.contentHint === hint; }
  catch { return false; }
}

export async function applyCaptureProfile(stream, profileKey) {
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  const profile = QUALITY_PROFILES[profileKey] ?? QUALITY_PROFILES["1080p30"];
  try {
    await track.applyConstraints({ width: { ideal: profile.width }, height: { ideal: profile.height }, frameRate: { ideal: profile.fps, max: profile.fps } });
  } catch { /* A fonte e o navegador podem ignorar ajustes após a escolha inicial. */ }
}

export function stopMedia(stream) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}
