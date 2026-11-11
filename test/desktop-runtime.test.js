import test from "node:test";
import assert from "node:assert/strict";
import { extractTunnelUrl, sameOrigin } from "../desktop/runtime.js";

test("runtime desktop aceita somente a origem esperada e extrai Quick Tunnel", () => {
  assert.equal(extractTunnelUrl("INF https://abc-123.trycloudflare.com pronto"), "https://abc-123.trycloudflare.com");
  assert.equal(extractTunnelUrl("https://example.com"), null);
  assert.equal(sameOrigin("https://abc-123.trycloudflare.com/host.html", "https://abc-123.trycloudflare.com"), true);
  assert.equal(sameOrigin("https://outro.example", "https://abc-123.trycloudflare.com"), false);
});
