import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function createToken() {
  return randomBytes(32).toString("base64url");
}

export function tokenDigest(token) {
  return createHash("sha256").update(token).digest();
}

// Hash tokens at rest in the in-memory room registry.
export function verifyToken(token, digest) {
  if (typeof token !== "string" || !Buffer.isBuffer(digest)) return false;
  const candidate = tokenDigest(token);
  return candidate.length === digest.length && timingSafeEqual(candidate, digest);
}

export function createTurnCredentials(sharedSecret, ttlSeconds, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!sharedSecret) return null;
  const username = `${nowSeconds + ttlSeconds}:webshare`;
  const password = createHmac("sha1", sharedSecret).update(username).digest("base64");
  return { username, credential: password, expiresAt: nowSeconds + ttlSeconds };
}
