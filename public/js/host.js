import { captureScreen, applyCaptureProfile, setCaptureContentHint, stopMedia, QUALITY_PROFILES } from "./webrtc/media-capture.js";
import { SignalingClient } from "./webrtc/signaling-client.js";
import { applySenderBitrate, tunePeers } from "./webrtc/quality-controller.js";
import { getSupportedVideoCodecs } from "./webrtc/codec-support.js";
import { createHostPeerConnection } from "./webrtc/peer-connection.js";
import { readPeerStats } from "./webrtc/stats-monitor.js";

const $ = (id) => document.getElementById(id);
const ui = { start: $("startButton"), changeSource: $("changeSourceButton"), stop: $("stopButton"), quality: $("quality"), contentMode: $("contentMode"), audio: $("audioToggle"), preview: $("preview"), empty: $("previewEmpty"), badge: $("liveBadge"), state: $("connectionState"), count: $("viewerCount"), link: $("shareLink"), share: $("sharePanel"), message: $("hostMessage"), copy: $("copyButton"), copyStatus: $("copyStatus"), resolutionStat: $("resolutionStat"), bitrateStat: $("bitrateStat"), rttStat: $("rttStat"), codecStat: $("codecStat") };
let stream = null;
let signal = null;
let roomId = null;
const peers = new Map();

function showMessage(text, bad = false) { ui.message.textContent = text; ui.message.classList.toggle("error", bad); }
function updateCount(count) { ui.count.textContent = `${count} ${count === 1 ? "espectador" : "espectadores"}`; }
function updateConnection() {
  const states = [...peers.values()].map((item) => item.pc.connectionState);
  if (!states.length) ui.state.textContent = "Sala pronta; aguardando espectadores";
  else if (states.includes("connected")) ui.state.textContent = "Conectado com espectador";
  else if (states.includes("failed")) ui.state.textContent = "Uma conexão falhou; tentando recuperar";
  else ui.state.textContent = "Negociando conexão…";
}

async function fetchIce() {
  const response = await fetch("/api/ice", { cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível carregar a configuração de rede.");
  return (await response.json()).iceServers;
}

async function makePeer(viewerId) {
  if (peers.has(viewerId) || !stream || !signal) return;
  const { pc, sender, audioSender, preferredCodec } = createHostPeerConnection(stream, await fetchIce(), {
    onIceCandidate: (candidate) => { if (signal?.connected) signal.send({ type: "ice", target: viewerId, candidate }); },
    onStateChange: updateConnection
  });
  if (preferredCodec) ui.codecStat.textContent = `${preferredCodec} priorizado`;
  const peer = { pc, sender, audioSender, lastStats: null, pendingCandidates: [] };
  peers.set(viewerId, peer);
  await applySenderBitrate(sender, ui.quality.value);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  signal.send({ type: "offer", target: viewerId, description: pc.localDescription });
  updateConnection();
}

async function handleSignal({ detail: message }) {
  try {
    if (message.type === "viewer-joined") {
      updateCount(message.viewerCount);
      await makePeer(message.viewerId);
    } else if (message.type === "viewer-left") {
      peers.get(message.viewerId)?.pc.close(); peers.delete(message.viewerId); updateCount(message.viewerCount); updateConnection();
    } else if (message.type === "answer") {
      const peer = peers.get(message.from); if (peer) {
        await peer.pc.setRemoteDescription(message.description);
        for (const candidate of peer.pendingCandidates.splice(0)) await peer.pc.addIceCandidate(candidate);
      }
    } else if (message.type === "ice") {
      const peer = peers.get(message.from); if (peer && message.candidate) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(message.candidate);
        else peer.pendingCandidates.push(message.candidate);
      }
    } else if (message.type === "error") {
      showMessage(friendlyError(message.code), true);
    }
  } catch (error) { showMessage(`Falha ao negociar a conexão: ${error.message}`, true); }
}

function friendlyError(code) {
  const messages = { target_unavailable: "Um espectador desconectou antes de concluir a conexão.", rate_limited: "Muitas mensagens em pouco tempo. Aguarde e tente novamente." };
  return messages[code] ?? `O servidor informou um problema (${code}).`;
}

function watchVideoTrack(track) {
  track.addEventListener("ended", () => {
    if (stream?.getVideoTracks()[0] === track) stop();
  });
}

function updatePreviewDetails(source) {
  ui.preview.srcObject = source;
  ui.empty.classList.add("hidden");
  const settings = source.getVideoTracks()[0]?.getSettings() ?? {};
  ui.resolutionStat.textContent = settings.width
    ? `${settings.width}×${settings.height} / ${Math.round(settings.frameRate ?? 0)} FPS`
    : "Métrica indisponível";
}

async function replacePeerSource(peer, videoTrack, audioTrack) {
  if (peer.pc.signalingState === "closed") return;
  await Promise.all([
    peer.sender.replaceTrack(videoTrack),
    peer.audioSender.replaceTrack(audioTrack)
  ]);
}

async function changeSource() {
  if (!stream || ui.changeSource.disabled) return;
  ui.changeSource.disabled = true;
  showMessage("Escolha a nova tela ou guia no seletor do navegador…");
  let nextStream;
  const previousStream = stream;
  const previousVideo = previousStream.getVideoTracks()[0];
  const previousAudio = previousStream.getAudioTracks()[0] ?? null;
  const peerSnapshot = [...peers.values()];
  try {
    // getDisplayMedia must be called directly from this button gesture.
    nextStream = await captureScreen(ui.quality.value, ui.audio.checked);
    if (stream !== previousStream) { stopMedia(nextStream); return; }
    const nextVideo = nextStream.getVideoTracks()[0];
    if (!nextVideo) throw new Error("A fonte escolhida não forneceu vídeo.");
    const nextAudio = nextStream.getAudioTracks()[0] ?? null;
    setCaptureContentHint(nextStream, ui.contentMode.value);
    stream = nextStream;

    const replacements = await Promise.allSettled(peerSnapshot.map((peer) => replacePeerSource(peer, nextVideo, nextAudio)));
    const failed = replacements.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;

    watchVideoTrack(nextVideo);
    updatePreviewDetails(nextStream);
    stopMedia(previousStream);
    showMessage("Fonte alterada. A sala e o link continuam os mesmos.");
  } catch (error) {
    if (stream !== previousStream) { stopMedia(nextStream); return; }
    stream = previousStream;
    if (nextStream) {
      await Promise.allSettled([...peers.values()].map((peer) => replacePeerSource(peer, previousVideo, previousAudio)));
      stopMedia(nextStream);
    }
    ui.preview.srcObject = previousStream;
    if (error.name === "NotAllowedError" || error.name === "AbortError") {
      showMessage("Seleção cancelada; a transmissão atual continua.");
    } else {
      showMessage(`Não foi possível mudar a fonte: ${error.message}`, true);
    }
  } finally {
    ui.changeSource.disabled = false;
  }
}

async function start() {
  if (stream) return;
  ui.start.disabled = true;
  showMessage("Aguardando sua escolha de tela…");
  let capturePromise;
  try { capturePromise = captureScreen(ui.quality.value, ui.audio.checked); }
  catch (error) { ui.start.disabled = false; showMessage(error.message, true); return; }
  try {
    stream = await capturePromise;
    setCaptureContentHint(stream, ui.contentMode.value);
    ui.preview.srcObject = stream; ui.empty.classList.add("hidden");
    ui.codecStat.textContent = getSupportedVideoCodecs().join(", ") || "Negociado pelo navegador";
    updatePreviewDetails(stream);
    const response = await fetch("/api/rooms", { method: "POST" });
    if (!response.ok) throw new Error("Não foi possível criar uma sala. Verifique o serviço e tente novamente.");
    const room = await response.json(); roomId = room.roomId;
    ui.link.value = room.viewerUrl; ui.share.classList.remove("hidden");
    signal = new SignalingClient(); signal.addEventListener("signal", handleSignal);
    signal.addEventListener("disconnected", () => { if (stream) { showMessage("A conexão com o servidor foi encerrada; a sala foi finalizada.", true); stop(); } });
    await signal.connect({ roomId, role: "host", token: room.hostToken });
    watchVideoTrack(stream.getVideoTracks()[0]);
    ui.start.classList.add("hidden"); ui.stop.disabled = false; ui.stop.classList.remove("hidden");
    ui.changeSource.classList.remove("hidden");
    ui.badge.classList.add("live"); ui.badge.innerHTML = "<i></i> Ao vivo";
    showMessage(stream.getAudioTracks().length ? "Transmissão ativa com áudio disponível." : ui.audio.checked ? "Transmissão ativa. A fonte escolhida não forneceu áudio." : "Transmissão ativa sem áudio.");
  } catch (error) {
    stopMedia(stream); stream = null; ui.preview.srcObject = null; ui.empty.classList.remove("hidden");
    signal?.close(); signal = null; ui.start.disabled = false;
    showMessage(error.message, true);
  }
}

function stop() {
  if (!stream && !signal) return;
  try { signal?.send({ type: "end", target: "" }); } catch { /* Socket pode já ter caído. */ }
  for (const peer of peers.values()) peer.pc.close(); peers.clear();
  signal?.close(); signal = null;
  stopMedia(stream); stream = null; roomId = null;
  ui.preview.srcObject = null; ui.empty.classList.remove("hidden");
  ui.start.classList.remove("hidden"); ui.start.disabled = false; ui.changeSource.disabled = false; ui.changeSource.classList.add("hidden"); ui.stop.disabled = true; ui.stop.classList.add("hidden");
  ui.badge.classList.remove("live"); ui.badge.innerHTML = "<i></i> Encerrado";
  ui.resolutionStat.textContent = "—"; ui.bitrateStat.textContent = "—"; ui.rttStat.textContent = "—"; ui.codecStat.textContent = "—";
  updateCount(0); updateConnection(); showMessage("Transmissão encerrada. Sua tela foi liberada.");
}

ui.start.addEventListener("click", start);
ui.changeSource.addEventListener("click", () => { void changeSource(); });
ui.stop.addEventListener("click", stop);
ui.copy.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(ui.link.value); ui.copyStatus.textContent = "Link copiado."; }
  catch { ui.link.select(); ui.copyStatus.textContent = "Copie o link selecionado."; }
});
ui.quality.addEventListener("change", async () => {
  if (!stream) return;
  await applyCaptureProfile(stream, ui.quality.value);
  await tunePeers(peers, ui.quality.value);
  showMessage(`Perfil solicitado: ${QUALITY_PROFILES[ui.quality.value].label}. O resultado depende do dispositivo e da rede.`);
});
ui.contentMode.addEventListener("change", () => {
  if (!stream) return;
  const applied = setCaptureContentHint(stream, ui.contentMode.value);
  showMessage(applied
    ? "Otimização da imagem atualizada sem alterar a resolução."
    : "Este navegador não permite ajustar a otimização da captura.");
});

setInterval(async () => {
  if (!peers.size) return;
  try {
    const peerList = [...peers.values()];
    const statsList = await Promise.all(peerList.map(async (peer) => {
      const stats = await readPeerStats(peer);
      return stats;
    }));
    const totalBps = statsList.reduce((sum, stats) => sum + (stats.bitrateBps ?? 0), 0);
    ui.bitrateStat.textContent = totalBps ? `${(totalBps / 1_000_000).toFixed(1)} Mbps` : "—";
    const rtts = statsList.map((stats) => stats.rttMs).filter((value) => value != null);
    ui.rttStat.textContent = rtts.length ? `${Math.round(rtts.reduce((sum, value) => sum + value, 0) / rtts.length)} ms méd.` : "—";
    ui.codecStat.textContent = [...new Set(statsList.map((stats) => stats.codec).filter(Boolean))].join(", ") || "Negociando";
    const fps = statsList.find((stats) => stats.fps != null)?.fps;
    if (fps != null) {
      const track = stream?.getVideoTracks()[0]; const settings = track?.getSettings() ?? {};
      ui.resolutionStat.textContent = `${settings.width ?? "?"}×${settings.height ?? "?"} / ${Math.round(fps)} FPS`;
    }
  } catch { /* Estatísticas podem não estar disponíveis durante a negociação. */ }
}, 2000);

updateCount(0);
