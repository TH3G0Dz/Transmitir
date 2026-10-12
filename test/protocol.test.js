import test from "node:test";
import assert from "node:assert/strict";
import { parseClientMessage } from "../server/signaling/protocol.js";
import { validateJoin } from "../server/rooms/room-validation.js";
import { createTurnCredentials, verifyToken, tokenDigest } from "../server/security/tokens.js";
import { SlidingWindowLimiter } from "../server/security/rate-limit.js";
import { loadConfig } from "../server/config.js";

test("valida mensagens de sinalização e rejeita JSON ou payloads inválidos", () => {
  assert.equal(parseClientMessage("{").error, "invalid_json");
  assert.equal(parseClientMessage(JSON.stringify({ type: "danger" })).error, "unknown_type");
  assert.equal(parseClientMessage(JSON.stringify({ type: "offer", target: "x", description: { type: "offer", sdp: "sdp" } })).message.type, "offer");
  assert.equal(parseClientMessage(JSON.stringify({ type: "offer", target: "x", description: { type: "answer", sdp: "sdp" } })).error, "invalid_description");
  assert.equal(validateJoin({ type: "join", roomId: "bad", role: "viewer", token: "x" }), false);
});

test("hash de token não guarda o segredo e valida sem comparação ingênua", () => {
  const digest = tokenDigest("token-secreto");
  assert.equal(verifyToken("token-secreto", digest), true);
  assert.equal(verifyToken("token-errado", digest), false);
});

test("emite credencial TURN com expiração e limita mensagens por janela", () => {
  const credential = createTurnCredentials("shared", 3600, 1000);
  assert.equal(credential.username, "4600:webshare");
  assert.ok(credential.credential.length > 10);
  let now = 0;
  const limiter = new SlidingWindowLimiter({ windowMs: 1000, limit: 2, now: () => now });
  assert.equal(limiter.consume("ip"), true);
  assert.equal(limiter.consume("ip"), true);
  assert.equal(limiter.consume("ip"), false);
  now = 1001;
  assert.equal(limiter.consume("ip"), true);
});

test("valida configuração de produção e permite ajustar limites", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production", PUBLIC_ORIGIN: "http://example.test" }), /HTTPS/);
  const settings = loadConfig({ NODE_ENV: "production", PUBLIC_ORIGIN: "https://example.test", MAX_VIEWERS: "8", STUN_URLS: "stun:one, stun:two" });
  assert.equal(settings.maxViewers, 8);
  assert.deepEqual(settings.stunUrls, ["stun:one", "stun:two"]);
});
