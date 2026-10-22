import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { RoomManager } from "../server/rooms/room-manager.js";
import { SlidingWindowLimiter } from "../server/security/rate-limit.js";
import { handleConnection } from "../server/signaling/message-router.js";

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent = [];
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.emit("close"); }
  message(data) { this.emit("message", Buffer.from(JSON.stringify(data))); }
}
const last = (socket, type) => socket.sent.findLast((message) => message.type === type);

test("autoriza entrada e encaminha offer, answer e ICE apenas entre participantes da sala", async () => {
  const manager = new RoomManager();
  const room = manager.createRoom();
  const dependencies = { roomManager: manager, limiter: new SlidingWindowLimiter({ windowMs: 60_000, limit: 50 }) };
  const host = new FakeSocket(); const viewer = new FakeSocket();
  handleConnection(host, dependencies); handleConnection(viewer, dependencies);
  host.message({ type: "join", roomId: room.id, role: "host", token: room.hostToken });
  viewer.message({ type: "join", roomId: room.id, role: "viewer", token: room.viewerToken });
  await new Promise((resolve) => setImmediate(resolve));
  const viewerId = last(viewer, "joined").viewerId;
  const hostId = manager.get(room.id).host.participantId;
  assert.equal(last(host, "viewer-joined").viewerId, viewerId);
  host.message({ type: "offer", target: viewerId, description: { type: "offer", sdp: "fake" } });
  viewer.message({ type: "answer", target: hostId, description: { type: "answer", sdp: "fake" } });
  viewer.message({ type: "ice", target: hostId, candidate: { candidate: "candidate:1" } });
  assert.equal(last(viewer, "offer").from, hostId);
  assert.equal(last(host, "answer").from, viewerId);
  assert.equal(last(host, "ice").candidate.candidate, "candidate:1");
  viewer.close();
  assert.equal(last(host, "viewer-left").viewerCount, 0);
});

test("recusa token incorreto e notifica espectadores quando host encerra", async () => {
  const manager = new RoomManager();
  const room = manager.createRoom();
  const dependencies = { roomManager: manager, limiter: new SlidingWindowLimiter({ windowMs: 60_000, limit: 50 }) };
  const denied = new FakeSocket(); handleConnection(denied, dependencies);
  denied.message({ type: "join", roomId: room.id, role: "host", token: room.viewerToken });
  assert.equal(last(denied, "error").code, "room_unavailable");
  const host = new FakeSocket(); const viewer = new FakeSocket();
  handleConnection(host, dependencies); handleConnection(viewer, dependencies);
  host.message({ type: "join", roomId: room.id, role: "host", token: room.hostToken });
  viewer.message({ type: "join", roomId: room.id, role: "viewer", token: room.viewerToken });
  await new Promise((resolve) => setImmediate(resolve));
  host.message({ type: "end", target: "" });
  assert.equal(last(viewer, "room-ended").reason, "host_ended");
  assert.equal(manager.get(room.id), null);
});

test("pong de manutenção renova o prazo da sala ativa", () => {
  let now = 1_000_000;
  const manager = new RoomManager({ ttlSeconds: 60, now: () => now });
  const room = manager.createRoom();
  const socket = new FakeSocket();
  handleConnection(socket, { roomManager: manager, limiter: new SlidingWindowLimiter({ windowMs: 60_000, limit: 50 }) });
  socket.message({ type: "join", roomId: room.id, role: "host", token: room.hostToken });
  now += 50_000;
  socket.isAlive = false;
  socket.emit("pong");
  assert.equal(socket.isAlive, true);
  now += 50_000;
  assert.ok(manager.get(room.id));
  now += 61_000;
  assert.equal(manager.get(room.id), null);
});

test("host pode reconectar na janela de 30 segundos e retoma viewers existentes", async () => {
  const manager = new RoomManager();
  const room = manager.createRoom();
  const limiter = new SlidingWindowLimiter({ windowMs: 60_000, limit: 50 });
  const dependencies = { roomManager: manager, limiter, hostReconnectGraceMs: 25 };
  const host = new FakeSocket(); const viewer = new FakeSocket();
  handleConnection(host, dependencies); handleConnection(viewer, dependencies);
  host.message({ type: "join", roomId: room.id, role: "host", token: room.hostToken });
  viewer.message({ type: "join", roomId: room.id, role: "viewer", token: room.viewerToken });
  const viewerId = last(viewer, "joined").viewerId;

  host.close();
  assert.ok(manager.get(room.id));
  assert.equal(last(viewer, "room-ended"), undefined);

  const replacement = new FakeSocket();
  handleConnection(replacement, dependencies);
  replacement.message({ type: "join", roomId: room.id, role: "host", token: room.hostToken });
  assert.deepEqual(last(replacement, "joined").viewerIds, [viewerId]);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.ok(manager.get(room.id));
  assert.equal(viewer.readyState, 1);

  replacement.close();
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(manager.get(room.id), null);
  assert.equal(last(viewer, "room-ended").reason, "host_disconnected");
  assert.equal(viewer.readyState, 3);
});
