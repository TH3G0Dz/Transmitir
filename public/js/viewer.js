import { SignalingClient } from "./webrtc/signaling-client.js";
import { createViewerPeerConnection } from "./webrtc/peer-connection.js";
const $ = (id) => document.getElementById(id);
const video = $("remoteVideo");
const overlay = $("viewerOverlay");
const status = $("viewerStatus");
const playButton = $("playButton");
const soundButton = $("soundButton");
const fullscreenButton = $("fullscreenButton");
const audioStatus = $("audioStatus");
let signal = null;
let peer = null;
let viewerId = null;
let retrying = false;
let playbackBlocked = false;
let pendingCandidates = [];

function setOverlay(title, text, ended = false, retry = false) {
  $("overlayTitle").textContent = title;
  $("overlayText").textContent = text;
  overlay.classList.toggle("ended", ended);
  $("retryButton").classList.toggle("hidden", !retry);
  overlay.classList.remove("hidden");
}
function setStatus(text, connected = false) {
  status.innerHTML = "<i></i>";
  status.append(document.createTextNode(` ${text}`));
  status.classList.toggle("connected", connected);
}
function updateAudioStatus() {
  const tracks = video.srcObject?.getAudioTracks() ?? [];
  const available = tracks.some((track) => track.readyState === "live" && !track.muted);
  soundButton.disabled = !available;
  soundButton.textContent = available ? (video.muted ? "Ativar som" : "Silenciar") : "Sem áudio";
  soundButton.setAttribute("aria-label", available ? (video.muted ? "Ativar áudio" : "Silenciar áudio") : "Nenhuma faixa de áudio recebida");
  audioStatus.textContent = available
    ? (video.muted ? "Áudio recebido. Toque em “Ativar som” se estiver mudo." : "Áudio ativo.")
    : "Sem áudio recebido. O transmissor precisa compartilhar uma guia e habilitar o áudio da guia.";
}
function credentials() {
  const roomId = new URLSearchParams(location.search).get("room");
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  if (!roomId || !token) throw new Error("O link da sala está incompleto.");
  return { roomId, token };
}
async function getIceServers() {
  const response = await fetch("/api/ice", { cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível carregar a configuração de rede.");
  return (await response.json()).iceServers;
}

async function connect() {
  if (retrying) return;
  retrying = true;
  $("retryButton").disabled = true;
  setOverlay("Conectando", "Aguarde enquanto estabelecemos uma conexão segura."); setStatus("Conectando à sala…");
  try {
    const { roomId, token } = credentials();
    signal = new SignalingClient();
    signal.addEventListener("signal", onSignal);
    signal.addEventListener("disconnected", () => {
      if (peer?.connectionState !== "connected" && !overlay.classList.contains("ended")) fail("A conexão com a sala foi interrompida. Tente novamente.");
    });
    const joined = await signal.connect({ roomId, role: "viewer", token });
    viewerId = joined.viewerId;
    setOverlay("Aguardando transmissão", "Você entrou na sala. A conexão de vídeo está sendo negociada.");
  } catch (error) {
    fail(error.message === "room_unavailable" ? "A transmissão não está disponível. Verifique se o link está correto e se o transmissor iniciou a sala." : error.message, true);
  } finally { retrying = false; $("retryButton").disabled = false; }
}

async function onSignal(event) {
  const message = event.detail;
  try {
    if (message.type === "offer") await acceptOffer(message);
    else if (message.type === "ice" && message.candidate) {
      if (peer?.remoteDescription) await peer.addIceCandidate(message.candidate);
      else pendingCandidates.push(message.candidate);
    }
    else if (message.type === "room-ended") {
      cleanup(); setStatus("Transmissão encerrada"); setOverlay("Transmissão encerrada", "O transmissor encerrou a sala.", true);
    } else if (message.type === "error") {
      const text = message.code === "room_full_or_offline" ? "A sala está cheia ou o transmissor não está conectado." : `Não foi possível entrar na sala (${message.code}).`;
      fail(text, true);
    }
  } catch (error) { fail(`Falha ao iniciar o vídeo: ${error.message}`, true); }
}

async function acceptOffer(message) {
  peer?.close(); peer = null; video.srcObject = null;
  peer = createViewerPeerConnection(await getIceServers(), {
    onTrack: async ({ streams, track }) => {
    if (streams[0]) video.srcObject = streams[0];
    track.addEventListener("mute", updateAudioStatus);
    track.addEventListener("unmute", updateAudioStatus);
    updateAudioStatus();
    try { await video.play(); } catch {
      playbackBlocked = true;
      setOverlay("Toque para reproduzir", "O navegador precisa de um toque para iniciar o vídeo.", false);
      playButton.classList.remove("hidden");
    }
    },
    onIceCandidate: (candidate) => { if (signal?.connected) signal.send({ type: "ice", target: message.from, candidate }); },
    onStateChange: (connectionState) => {
    if (connectionState === "connected") {
      updateAudioStatus();
      if (!playbackBlocked) overlay.classList.add("hidden");
      setStatus("Ao vivo", true);
    } else if (connectionState === "failed") fail("A conexão falhou. Tente novamente ou peça ao transmissor para iniciar outra sala.", true);
    else if (connectionState === "disconnected") { setStatus("Reconectando…"); setOverlay("Reconectando", "A conexão foi interrompida temporariamente."); }
    }
  });
  await peer.setRemoteDescription(message.description);
  for (const candidate of pendingCandidates.splice(0)) await peer.addIceCandidate(candidate);
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  signal.send({ type: "answer", target: message.from, description: peer.localDescription });
}

function cleanupPeer() { peer?.close(); peer = null; pendingCandidates = []; video.srcObject = null; }
function cleanup() { cleanupPeer(); signal?.close(); signal = null; }
function fail(message, ended = false) {
  setStatus("Desconectado");
  setOverlay(ended ? "Sala indisponível" : "Conexão interrompida", message, ended, !ended);
}

$("retryButton").addEventListener("click", () => { cleanup(); connect(); });
soundButton.addEventListener("click", async () => {
  if (!video.srcObject?.getAudioTracks().some((track) => track.readyState === "live")) return;
  video.muted = !video.muted;
  updateAudioStatus();
  if (!video.muted) { try { await video.play(); } catch { /* O navegador pode exigir novo gesto. */ } }
});
playButton.addEventListener("click", async () => {
  video.muted = true;
  try { await video.play(); playbackBlocked = false; }
  catch { setOverlay("Reprodução bloqueada", "Toque novamente ou verifique se o navegador permite reproduzir este vídeo.", false); }
});
function setFullscreenLabel(fullscreen) {
  fullscreenButton.textContent = fullscreen ? "Sair da tela cheia" : "Tela cheia";
  fullscreenButton.setAttribute("aria-label", fullscreen ? "Sair da tela cheia" : "Entrar em tela cheia");
}
async function toggleFullscreen() {
  const target = document.querySelector(".viewer-video-wrap");
  const fullscreen = document.fullscreenElement || document.webkitFullscreenElement || target.classList.contains("immersive");
  if (fullscreen) {
    target.classList.remove("immersive");
    document.body.classList.remove("viewer-immersive");
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch { /* Sai do modo visual local mesmo se o navegador negar a API. */ }
    setFullscreenLabel(false);
    return;
  }

  // iPhone Safari supports fullscreen playback on the video, but not arbitrary page elements.
  if (!document.fullscreenEnabled && typeof video.webkitEnterFullscreen === "function") {
    try { video.controls = true; video.webkitEnterFullscreen(); setFullscreenLabel(true); return; } catch { video.controls = false; /* Tenta o modo visual abaixo. */ }
  }
  if (typeof target.requestFullscreen === "function") {
    try { await target.requestFullscreen(); setFullscreenLabel(true); return; } catch { /* Usa a alternativa de tela expandida. */ }
  }
  if (typeof video.webkitEnterFullscreen === "function") {
    try { video.controls = true; video.webkitEnterFullscreen(); setFullscreenLabel(true); return; } catch { video.controls = false; /* Usa a alternativa de tela expandida. */ }
  }
  target.classList.add("immersive");
  document.body.classList.add("viewer-immersive");
  setFullscreenLabel(true);
}
fullscreenButton.addEventListener("click", () => { void toggleFullscreen(); });
document.addEventListener("fullscreenchange", () => setFullscreenLabel(Boolean(document.fullscreenElement)));
document.addEventListener("webkitfullscreenchange", () => setFullscreenLabel(Boolean(document.webkitFullscreenElement)));
video.addEventListener("webkitendfullscreen", () => { video.controls = false; setFullscreenLabel(false); });
video.addEventListener("playing", () => { playbackBlocked = false; playButton.classList.add("hidden"); overlay.classList.add("hidden"); setStatus("Ao vivo", true); });
connect();
