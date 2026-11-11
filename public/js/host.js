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
let hostToken = null;
let hostJoined = false;
let reconnectingSignal = false;
let reconnectGeneration = 0;
const peers = new Map();
const pendingPeers = new Map();

function showMessage(text, bad = false) { ui.message.textContent = text; ui.message.classList.toggle("error", bad); }
function updateCount(count) { ui.count.textContent = `${count} ${count === 1 ? "espectador" : "espectadores"}`; }
function updateConnection() {
  const states = [...peers.values()].map((item) => item.pc.connectionState);
  if (!states.length) ui.state.textContent = "Sala pronta; aguardando espectadores";
  else if (states.includes("connected")) ui.state.textContent = "Conectado com espectador";
  else if (states.includes("failed")) ui.state.textContent = "Uma conexão falhou; tentando recuperar";
  else ui.state.textContent = "Negociando conexão…";
}

async function fetchIce(roomId, token, role) {
  const response = await fetch("/api/ice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId, token, role }), cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível carregar a configuração de rede.");
  return (await response.json()).iceServers;
}

async function makePeer(viewerId) {
  if (peers.has(viewerId) || pendingPeers.has(viewerId) || !stream || !signal?.connected) return;
  const currentSignal = signal;
  const currentStream = stream;
  const currentRoomId = roomId;
  const currentHostToken = hostToken;
  pendingPeers.set(viewerId, currentSignal);
  let peer;
  try {
    const iceServers = await fetchIce(currentRoomId, currentHostToken, "host");
    if (pendingPeers.get(viewerId) !== currentSignal || signal !== currentSignal || stream !== currentStream || !currentSignal.connected) return;
    const { pc, sender, audioSender, preferredCodec } = createHostPeerConnection(currentStream, iceServers, {
      onIceCandidate: (candidate) => { if (peers.get(viewerId)?.pc === pc && signal === currentSignal && signal.connected) signal.send({ type: "ice", target: viewerId, candidate }); },
      onStateChange: updateConnection
    });
    if (preferredCodec) ui.codecStat.textContent = `${preferredCodec} priorizado`;
    peer = { pc, sender, audioSender, lastStats: null, pendingCandidates: [] };
    peers.set(viewerId, peer);
    await applySenderBitrate(sender, ui.quality.value);
    if (peers.get(viewerId) !== peer || signal !== currentSignal || !currentSignal.connected) return;
    const offer = await pc.createOffer();
    if (peers.get(viewerId) !== peer || signal !== currentSignal || !currentSignal.connected) return;
    await pc.setLocalDescription(offer);
    if (peers.get(viewerId) !== peer || signal !== currentSignal || !currentSignal.connected) return;
    currentSignal.send({ type: "offer", target: viewerId, description: pc.localDescription });
    updateConnection();
  } catch (error) {
    if (peers.get(viewerId) === peer) peers.delete(viewerId);
    peer?.pc.close();
    if (pendingPeers.get(viewerId) === currentSignal) showMessage(`Falha ao negociar a conexão: ${error.message}`, true);
  } finally {
    if (pendingPeers.get(viewerId) === currentSignal) pendingPeers.delete(viewerId);
  }
}

async function handleSignal({ detail: message }) {
  try {
    if (message.type === "viewer-joined") {
      updateCount(message.viewerCount);
      await makePeer(message.viewerId);
    } else if (message.type === "viewer-left") {
      pendingPeers.delete(message.viewerId);
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

function observeSignal(client) {
  client.addEventListener("signal", (event) => { if (signal === client) void handleSignal(event); });
  client.addEventListener("disconnected", () => {
    if (signal === client && hostJoined && stream) {
      ui.state.textContent = "Reconectando sinalização…";
      showMessage("Sinalização interrompida. Tentando reconectar à sala…");
      void reconnectSignal();
    }
  });
}

function connectSignal() {
  const client = new SignalingClient();
  signal = client;
  observeSignal(client);
  return client.connect({ roomId, role: "host", token: hostToken });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reconnectSignal() {
  if (reconnectingSignal || !stream || !roomId || !hostToken) return;
  reconnectingSignal = true;
  hostJoined = false;
  const generation = ++reconnectGeneration;
  try {
    for (const delay of [0, 500, 1000, 2000, 4000]) {
      if (delay) await wait(delay);
      if (generation !== reconnectGeneration || !stream) return;
      const client = new SignalingClient();
      signal = client;
      observeSignal(client);
      try {
        const joined = await client.connect({ roomId, role: "host", token: hostToken, timeoutMs: 3500 });
        if (generation !== reconnectGeneration || !stream) { client.close(); return; }
        if (!client.connected) { if (signal === client) signal = null; client.close(); continue; }
        hostJoined = true;
        for (const peer of peers.values()) peer.pc.close();
        peers.clear();
        pendingPeers.clear();
        ui.badge.classList.add("live"); ui.badge.innerHTML = "<i></i> Ao vivo";
        updateCount(joined.viewerCount);
        updateConnection();
        await Promise.all((joined.viewerIds ?? []).map(makePeer));
        if (!client.connected) { hostJoined = false; continue; }
        if (generation === reconnectGeneration) showMessage("Conexão de sinalização restabelecida; transmissão retomada.");
        return;
      } catch {
        if (signal === client) signal = null;
        client.close();
      }
    }
    if (generation === reconnectGeneration && stream) {
      ui.badge.classList.remove("live"); ui.badge.innerHTML = "<i></i> Sinalização desconectada";
      ui.state.textContent = "Sem conexão com a sala";
      showMessage("Não foi possível reconectar. A captura continua neste computador, mas a sala pode ter sido encerrada. Encerre e inicie uma nova transmissão.", true);
    }
  } finally {
    if (generation === reconnectGeneration) reconnectingSignal = false;
  }
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
  showMessage("Escolha a nova tela ou janela no aplicativo…");
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
    ui.codecStat.textContent = getSupportedVideoCodecs().join(", ") || "Negociado pelo aplicativo";
    updatePreviewDetails(stream);
    const response = await fetch("/api/rooms", { method: "POST" });
    if (!response.ok) throw new Error("Não foi possível criar uma sala. Verifique o serviço e tente novamente.");
    const room = await response.json(); roomId = room.roomId; hostToken = room.hostToken;
    ui.link.value = room.viewerUrl; ui.share.classList.remove("hidden");
    const joined = await connectSignal();
    hostJoined = true;
    updateCount(joined.viewerCount);
    watchVideoTrack(stream.getVideoTracks()[0]);
    ui.start.classList.add("hidden"); ui.stop.disabled = false; ui.stop.classList.remove("hidden");
    ui.changeSource.classList.remove("hidden");
    ui.badge.classList.add("live"); ui.badge.innerHTML = "<i></i> Ao vivo";
    globalThis.desktopApp?.setBroadcasting(true);
    showMessage(stream.getAudioTracks().length ? "Transmissão ativa com áudio disponível." : ui.audio.checked ? "Transmissão ativa. A fonte escolhida não forneceu áudio." : "Transmissão ativa sem áudio.");
  } catch (error) {
    stopMedia(stream); stream = null; globalThis.desktopApp?.setBroadcasting(false); ui.preview.srcObject = null; ui.empty.classList.remove("hidden");
    signal?.close(); signal = null; hostJoined = false; roomId = null; hostToken = null; ui.start.disabled = false;
    showMessage(error.message, true);
  }
}

function stop() {
  if (!stream && !signal) return;
  reconnectGeneration += 1; reconnectingSignal = false; hostJoined = false;
  try { signal?.send({ type: "end", target: "" }); } catch { /* Socket pode já ter caído. */ }
  for (const peer of peers.values()) peer.pc.close(); peers.clear();
  pendingPeers.clear();
  signal?.close(); signal = null;
  stopMedia(stream); stream = null; roomId = null; hostToken = null;
  globalThis.desktopApp?.setBroadcasting(false);
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
    : "Este aplicativo não permite ajustar a otimização da captura.");
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
