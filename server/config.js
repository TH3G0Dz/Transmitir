const integer = (env, name, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(env[name] ?? String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} deve ser um inteiro entre ${minimum} e ${maximum}.`);
  }
  return parsed;
};

const list = (value) => value.split(",").map((item) => item.trim()).filter(Boolean);

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const publicOrigin = env.PUBLIC_ORIGIN ?? "http://localhost:3000";
  let parsedOrigin;
  try { parsedOrigin = new URL(publicOrigin); } catch { throw new Error("PUBLIC_ORIGIN não é uma URL válida."); }
  if (production && parsedOrigin.protocol !== "https:") {
    throw new Error("PUBLIC_ORIGIN deve usar HTTPS em produção.");
  }

  return Object.freeze({
    host: env.HOST ?? "127.0.0.1",
    port: integer(env, "PORT", 3000, 1, 65535),
    nodeEnv: production ? "production" : "development",
    publicOrigin: parsedOrigin.origin,
    roomTtlSeconds: integer(env, "ROOM_TTL_SECONDS", 21600, 300, 604800),
    maxViewers: integer(env, "MAX_VIEWERS", 4, 1, 100),
    maxRooms: integer(env, "MAX_ROOMS", 500, 1, 100000),
    maxConnectionsPerIp: integer(env, "MAX_CONNECTIONS_PER_IP", 20, 2, 500),
    trustProxyHops: integer(env, "TRUST_PROXY_HOPS", 0, 0, 5),
    allowQuickTunnel: env.ALLOW_QUICK_TUNNEL === "true",
    maxMessageBytes: integer(env, "MAX_MESSAGE_BYTES", 65536, 1024, 1048576),
    rateLimitWindowMs: integer(env, "RATE_LIMIT_WINDOW_MS", 60000, 1000, 3600000),
    rateLimitMessages: integer(env, "RATE_LIMIT_MESSAGES", 120, 10, 10000),
    stunUrls: list(env.STUN_URLS ?? "stun:stun.l.google.com:19302"),
    turnUrls: list(env.TURN_URLS ?? ""),
    turnSharedSecret: env.TURN_SHARED_SECRET ?? "",
    turnCredentialTtlSeconds: integer(env, "TURN_CREDENTIAL_TTL_SECONDS", 3600, 60, 86400)
  });
}

export const config = loadConfig();
