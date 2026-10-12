import test from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "../server/rooms/room-manager.js";

test("cria sala com tokens distintos e valida autorização", () => {
  const manager = new RoomManager({ ttlSeconds: 60, maxViewers: 2 });
  const room = manager.createRoom();
  assert.match(room.id, /^[0-9a-f-]{36}$/i);
  assert.notEqual(room.hostToken, room.viewerToken);
  assert.equal(manager.authorize(room.id, "host", room.hostToken), true);
  assert.equal(manager.authorize(room.id, "viewer", room.viewerToken), true);
  assert.equal(manager.authorize(room.id, "host", room.viewerToken), false);
  assert.equal(manager.authorize(room.id, "viewer", "invalid"), false);
});

test("adiciona espectadores, respeita limite e encerra sala", () => {
  const manager = new RoomManager({ maxViewers: 1 });
  const room = manager.createRoom();
  const host = { readyState: 1 };
  assert.equal(manager.attachHost(room.id, host, "host-id"), true);
  assert.equal(manager.attachHost(room.id, {}, "other-host"), false);
  assert.equal(manager.addViewer(room.id, {}, "viewer-1"), true);
  assert.equal(manager.addViewer(room.id, {}, "viewer-2"), false);
  const removal = manager.removeParticipant(room.id, "viewer-1");
  assert.equal(removal.role, "viewer");
  assert.equal(removal.room.viewers.size, 0);
  assert.equal(manager.removeParticipant(room.id, "host-id").role, "host");
  assert.equal(manager.get(room.id), null);
});

test("remove salas expiradas", () => {
  let now = 1_000_000;
  const manager = new RoomManager({ ttlSeconds: 1, now: () => now });
  const room = manager.createRoom();
  now += 1001;
  assert.equal(manager.cleanupExpired(), 1);
  assert.equal(manager.get(room.id), null);
});

