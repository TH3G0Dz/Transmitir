import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(baseUrl, child, getOutput) {
  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (error) { lastError = `${error.message}: ${error.cause?.code ?? error.cause?.message ?? "unknown"}`; }
    await wait(100);
  }
  throw new Error(`Servidor de teste não iniciou (${lastError}). ${getOutput()}`);
}

function join(socket, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Tempo esgotado aguardando entrada na sala.")), 3000);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "joined") { clearTimeout(timeout); resolve(message); }
      if (message.type === "error") { clearTimeout(timeout); reject(new Error(message.code)); }
    });
    socket.once("error", (error) => { clearTimeout(timeout); reject(error); });
    socket.once("open", () => socket.send(JSON.stringify(payload)));
  });
}

test("API ICE exige credencial da sala e sinalização respeita limite global", { timeout: 20_000 }, async () => {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let childOutput = "";
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: String(port),
      PUBLIC_ORIGIN: baseUrl,
      ALLOW_QUICK_TUNNEL: "false",
      TRUST_PROXY_HOPS: "0",
      STUN_URLS: "stun:stun.example.test:3478",
      TURN_URLS: "turn:turn.example.test:3478",
      TURN_SHARED_SECRET: "integration-test-secret",
      MAX_TOTAL_CONNECTIONS: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });
  let host;
  try {
    await waitForServer(baseUrl, child, () => childOutput);
    const roomResponse = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
    assert.equal(roomResponse.status, 201);
    const room = await roomResponse.json();

    const denied = await fetch(`${baseUrl}/api/ice`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: room.roomId, role: "host", token: room.viewerToken })
    });
    assert.equal(denied.status, 403);

    const allowed = await fetch(`${baseUrl}/api/ice`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: room.roomId, role: "host", token: room.hostToken })
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("cache-control"), "no-store");
    const { iceServers } = await allowed.json();
    assert.deepEqual(iceServers[0].urls, ["stun:stun.example.test:3478"]);
    assert.deepEqual(iceServers[1].urls, ["turn:turn.example.test:3478"]);
    assert.equal(iceServers[1].username.split(":")[1], "webshare");

    host = new WebSocket(`ws://127.0.0.1:${port}/signal`);
    const joined = await join(host, { type: "join", roomId: room.roomId, role: "host", token: room.hostToken });
    assert.equal(joined.role, "host");

    const rejected = new WebSocket(`ws://127.0.0.1:${port}/signal`);
    const statusCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Servidor não rejeitou a conexão excedente.")), 3000);
      rejected.once("unexpected-response", (_request, response) => {
        clearTimeout(timeout);
        response.resume();
        resolve(response.statusCode);
      });
      rejected.once("open", () => { clearTimeout(timeout); rejected.close(); reject(new Error("Conexão excedente foi aceita.")); });
      rejected.once("error", () => {});
    });
    assert.equal(statusCode, 503);

    await new Promise((resolve) => { host.once("close", resolve); host.close(); });
    const replacement = new WebSocket(`ws://127.0.0.1:${port}/signal`);
    assert.equal((await join(replacement, { type: "join", roomId: room.roomId, role: "host", token: room.hostToken })).role, "host");
    host = replacement;
  } finally {
    host?.close();
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await Promise.race([exited, wait(5000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }
});
