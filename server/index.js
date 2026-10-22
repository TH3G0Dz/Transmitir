import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { RoomManager } from "./rooms/room-manager.js";
import { validateJoin } from "./rooms/room-validation.js";
import { createTurnCredentials } from "./security/tokens.js";
import { SlidingWindowLimiter } from "./security/rate-limit.js";
import { handleConnection } from "./signaling/message-router.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../public");
const app = express();
const server = createServer(app);
const rooms = new RoomManager({ ttlSeconds: config.roomTtlSeconds, maxViewers: config.maxViewers, maxRooms: config.maxRooms });
const httpLimiter = new SlidingWindowLimiter({ windowMs: config.rateLimitWindowMs, limit: 30 });
const iceLimiter = new SlidingWindowLimiter({ windowMs: config.rateLimitWindowMs, limit: 60 });
const messageLimiter = new SlidingWindowLimiter({ windowMs: config.rateLimitWindowMs, limit: config.rateLimitMessages });
const connectionsByIp = new Map();
let totalConnections = 0;

function parseTunnelOrigin(protocolHeader, hostHeader) {
  if (typeof protocolHeader !== "string" || typeof hostHeader !== "string") return null;
  try {
    const protocol = protocolHeader.split(",")[0].trim().toLowerCase();
    const host = hostHeader.split(",")[0].trim().toLowerCase();
    if (protocol !== "https" || !host || /[\\/@\s]/.test(host)) return null;
    const candidate = new URL(`https://${host}`);
    if (candidate.hostname === "trycloudflare.com" || !candidate.hostname.endsWith(".trycloudflare.com")) return null;
    return candidate.origin;
  } catch { return null; }
}

function publicOriginFromHeaders(headers, fallback = config.publicOrigin) {
  if (config.allowQuickTunnel && config.trustProxyHops > 0) {
    const host = headers["x-forwarded-host"] ?? headers.host;
    const originProtocol = typeof headers.origin === "string" ? (() => {
      try { return new URL(headers.origin).protocol.replace(":", ""); } catch { return null; }
    })() : null;
    const protocol = headers["x-forwarded-proto"] ?? originProtocol ?? "https";
    const tunnelOrigin = parseTunnelOrigin(protocol, host);
    if (tunnelOrigin) return tunnelOrigin;
  }
  return fallback;
}

function requestPublicOrigin(req) {
  return publicOriginFromHeaders(req.headers);
}

function isAllowedOrigin(origin, headers) {
  if (typeof origin !== "string") return config.nodeEnv !== "production" && !config.allowQuickTunnel;
  return origin === config.publicOrigin || (config.allowQuickTunnel && origin === publicOriginFromHeaders(headers, null));
}

app.disable("x-powered-by");
if (config.trustProxyHops > 0) app.set("trust proxy", config.trustProxyHops);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), display-capture=(self), fullscreen=(self)");
  if (config.nodeEnv === "production" && req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  const socketOrigin = requestPublicOrigin(req).replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  res.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' ${socketOrigin}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`);
  next();
});
app.use(express.json({ limit: "8kb", strict: true }));

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "webshare", runtimeVersion: 5 }));
app.get("/api/config", (_req, res) => res.json({ maxViewers: config.maxViewers, roomTtlSeconds: config.roomTtlSeconds }));
app.post("/api/ice", (req, res) => {
  if ((config.nodeEnv === "production" || config.allowQuickTunnel) && !isAllowedOrigin(req.get("origin"), req.headers)) {
    return res.status(403).json({ error: "origin_not_allowed" });
  }
  if (!iceLimiter.consume(req.ip ?? "unknown")) return res.status(429).json({ error: "rate_limited" });
  const credentials = { ...(req.body ?? {}), type: "join" };
  if (!validateJoin(credentials) || !rooms.authorize(credentials.roomId, credentials.role, credentials.token)) {
    return res.status(403).json({ error: "room_unavailable" });
  }
  const iceServers = [];
  if (config.stunUrls.length) iceServers.push({ urls: config.stunUrls });
  if (config.turnUrls.length && config.turnSharedSecret) {
    const credentials = createTurnCredentials(config.turnSharedSecret, config.turnCredentialTtlSeconds);
    iceServers.push({ urls: config.turnUrls, username: credentials.username, credential: credentials.credential });
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ iceServers });
});
app.post("/api/rooms", (req, res) => {
  if ((config.nodeEnv === "production" || config.allowQuickTunnel) && !isAllowedOrigin(req.get("origin"), req.headers)) {
    return res.status(403).json({ error: "origin_not_allowed" });
  }
  const key = req.ip ?? "unknown";
  if (!httpLimiter.consume(key)) return res.status(429).json({ error: "rate_limited" });
  const room = rooms.createRoom();
  if (!room) return res.status(503).setHeader("Retry-After", "60").json({ error: "room_capacity_reached" });
  res.status(201).setHeader("Cache-Control", "no-store").json({
    roomId: room.id,
    hostToken: room.hostToken,
    viewerToken: room.viewerToken,
    expiresAt: room.expiresAt,
    viewerUrl: `${requestPublicOrigin(req)}/viewer.html?room=${room.id}#token=${room.viewerToken}`
  });
});
app.use(express.static(publicDir, { extensions: ["html"], maxAge: config.nodeEnv === "production" ? "1h" : 0 }));
app.use((req, res) => res.status(404).json({ error: "not_found" }));

const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes, perMessageDeflate: false });
server.on("upgrade", (request, socket, head) => {
  let pathname;
  try { pathname = new URL(request.url, config.publicOrigin).pathname; } catch { socket.destroy(); return; }
  const origin = request.headers.origin;
  const forwarded = request.headers["x-forwarded-for"]?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  const forwardedIndex = Math.max(0, forwarded.length - config.trustProxyHops);
  const ip = config.trustProxyHops > 0 && forwarded.length ? forwarded[forwardedIndex] : request.socket.remoteAddress ?? "unknown";
  const count = connectionsByIp.get(ip) ?? 0;
  const originAllowed = isAllowedOrigin(origin, request.headers);
  if (pathname !== "/signal" || !originAllowed || count >= config.maxConnectionsPerIp) { socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return; }
  if (totalConnections >= config.maxTotalConnections) { socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n"); socket.destroy(); return; }
  connectionsByIp.set(ip, count + 1);
  totalConnections += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    totalConnections -= 1;
    const remaining = (connectionsByIp.get(ip) ?? 1) - 1;
    if (remaining <= 0) connectionsByIp.delete(ip); else connectionsByIp.set(ip, remaining);
  };
  socket.once("close", release);
  try {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  } catch {
    release();
    socket.destroy();
  }
});
wss.on("connection", (socket) => {
  socket.isAlive = true;
  handleConnection(socket, { roomManager: rooms, limiter: messageLimiter });
});
wss.on("error", () => {});
server.on("error", (error) => {
  console.error(`Servidor HTTP não iniciou: ${error.message}`);
  process.exitCode = 1;
});

const cleanup = setInterval(() => {
  for (const room of rooms.expireRooms()) {
    for (const viewerSocket of room.viewers.values()) {
      if (viewerSocket.readyState === 1) viewerSocket.send(JSON.stringify({ type: "room-ended", reason: "expired" }));
      viewerSocket.close(1000, "Room expired");
    }
    room.host?.socket.close(1000, "Room expired");
  }
}, 60_000);
cleanup.unref();
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.readyState !== 1) continue;
    if (socket.isAlive === false) { socket.terminate(); continue; }
    socket.isAlive = false;
    socket.ping();
  }
}, 25_000);
heartbeat.unref();
server.listen(config.port, config.host, () => {
  console.log(`WebShare pronto em ${config.publicOrigin}`);
});

function shutdown() {
  clearInterval(cleanup);
  clearInterval(heartbeat);
  for (const client of wss.clients) client.close(1001, "Server shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
