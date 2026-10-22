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
let retrying = false;
let playbackBlocked = false;
let pendingCandidates = [];
let peerGeneration = 0;

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
async function getIceServers(roomId, token, role) {
  const response = await fetch("/api/ice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId, token, role }), cache: "no-store" });
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
    const client = new SignalingClient();
    signal = client;
    client.addEventListener("signal", onSignal);
    client.addEventListener("disconnected", () => {
      if (signal === client && !overlay.classList.contains("ended")) fail("A conexão de sinalização foi interrompida. Toque em tentar novamente para voltar à sala.");
    });
    await client.connect({ roomId, role: "viewer", token });
    setOverlay("Aguardando transmissão", "Você entrou na sala. A conexão de vídeo está sendo negociada.");
  } catch (error) {
    const unavailable = error.message === "room_unavailable";
    const message = unavailable
      ? "A transmissão não está disponível. Verifique se o link está correto e se o transmissor iniciou a sala."
      : error.message === "room_full_or_offline" ? "A sala está cheia ou o transmissor não está conectado." : error.message;
    fail(message, unavailable);
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
      const reason = message.reason === "host_disconnected" ? "O transmissor não conseguiu reconectar à sala." : message.reason === "expired" ? "A sala expirou por inatividade." : "O transmissor encerrou a sala.";
      cleanup(); setStatus("Transmissão encerrada"); setOverlay("Transmissão encerrada", reason, true);
    } else if (message.type === "error") {
      const text = message.code === "room_full_or_offline" ? "A sala está cheia ou o transmissor não está conectado." : `Não foi possível entrar na sala (${message.code}).`;
      fail(text, message.code === "room_unavailable");
    }
  } catch (error) { fail(`Falha ao iniciar o vídeo: ${error.message}`, true); }
}

async function acceptOffer(message) {
  const generation = ++peerGeneration;
  const previous = peer;
  peer = null;
  video.srcObject = null;
  previous?.close();
  const client = signal;
  try {
    const { roomId, token } = credentials();
    const iceServers = await getIceServers(roomId, token, "viewer");
    if (generation !== peerGeneration || signal !== client || !client?.connected) return;
    let newPeer;
    newPeer = createViewerPeerConnection(iceServers, {
      onTrack: async ({ streams, track }) => {
        if (peer !== newPeer) return;
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
      onIceCandidate: (candidate) => { if (peer === newPeer && signal === client && client.connected) client.send({ type: "ice", target: message.from, candidate }); },
      onStateChange: (connectionState) => {
        if (peer !== newPeer) return;
        if (connectionState === "connected") {
          updateAudioStatus();
          if (!playbackBlocked) overlay.classList.add("hidden");
          setStatus("Ao vivo", true);
        } else if (connectionState === "failed") fail("A conexão falhou. Tente novamente ou peça ao transmissor para iniciar outra sala.");
        else if (connectionState === "disconnected") { setStatus("Reconectando…"); setOverlay("Reconectando", "A conexão foi interrompida temporariamente."); }
        else if (connectionState === "closed") fail("A conexão de vídeo foi encerrada. Tente novamente.");
      }
    });
    peer = newPeer;
    await newPeer.setRemoteDescription(message.description);
    if (peer !== newPeer || generation !== peerGeneration || signal !== client) return;
    for (const candidate of pendingCandidates.splice(0)) await newPeer.addIceCandidate(candidate);
    const answer = await newPeer.createAnswer();
    if (peer !== newPeer || generation !== peerGeneration || signal !== client) return;
    await newPeer.setLocalDescription(answer);
    if (peer !== newPeer || generation !== peerGeneration || signal !== client || !client.connected) return;
    client.send({ type: "answer", target: message.from, description: newPeer.localDescription });
  } catch (error) {
    if (generation === peerGeneration && signal === client) throw error;
  }
}

function cleanupPeer() { const previous = peer; peer = null; pendingCandidates = []; video.srcObject = null; previous?.close(); }
function cleanup() { peerGeneration += 1; cleanupPeer(); const previous = signal; signal = null; previous?.close(); }
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
