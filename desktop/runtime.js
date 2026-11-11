export function extractTunnelUrl(text) {
  return text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0] ?? null;
}

export function sameOrigin(value, expected) {
  try { return new URL(value).origin === expected; }
  catch { return false; }
}
