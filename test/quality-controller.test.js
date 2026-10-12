import test from "node:test";
import assert from "node:assert/strict";
import { applySenderBitrate } from "../public/js/webrtc/quality-controller.js";
import { getSupportedVideoCodecs } from "../public/js/webrtc/codec-support.js";

function fakeSender() {
  return {
    track: {},
    params: { encodings: [{}], degradationPreference: "balanced" },
    getParameters() { return structuredClone(this.params); },
    async setParameters(params) { this.params = params; }
  };
}

test("prioriza resolução e aplica o teto do perfil escolhido", async () => {
  const sender = fakeSender();
  assert.equal(await applySenderBitrate(sender, "1080p30"), true);
  assert.equal(sender.params.encodings[0].maxBitrate, 8_000_000);
  assert.equal(sender.params.encodings[0].priority, "high");
  assert.equal(sender.params.degradationPreference, "maintain-resolution");
});

test("detecta codecs conhecidos e ignora formatos desconhecidos", () => {
  const fakeRTCRtpSender = { getCapabilities: () => ({ codecs: [
    { mimeType: "video/VP8" }, { mimeType: "video/H264" }, { mimeType: "video/AV1" },
    { mimeType: "video/x-custom" }, { mimeType: "audio/opus" }
  ] }) };
  assert.deepEqual(getSupportedVideoCodecs(fakeRTCRtpSender), ["VP8", "H264", "AV1"]);
});
