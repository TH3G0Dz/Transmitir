import { randomUUID } from "node:crypto";
import { createToken, tokenDigest, verifyToken } from "../security/tokens.js";

const ROOM_RESERVATION_TTL_MS = 5 * 60 * 1000;

export class RoomManager {
  #rooms = new Map();
  constructor({ ttlSeconds = 43200, maxViewers = 4, maxRooms = 500, now = Date.now } = {}) {
    this.ttlMs = ttlSeconds * 1000;
    this.maxViewers = maxViewers;
    this.maxRooms = maxRooms;
    this.now = now;
  }
  createRoom() {
    this.expireRooms();
    if (this.#rooms.size >= this.maxRooms) return null;
    const id = randomUUID();
    const hostToken = createToken();
    const viewerToken = createToken();
    const room = {
      id,
      hostDigest: tokenDigest(hostToken),
      viewerDigest: tokenDigest(viewerToken),
      createdAt: this.now(),
      expiresAt: this.now() + Math.min(this.ttlMs, ROOM_RESERVATION_TTL_MS),
      host: null,
      viewers: new Map()
    };
    this.#rooms.set(id, room);
    return { id, hostToken, viewerToken, expiresAt: room.expiresAt };
  }
  get(id) {
    const room = this.#rooms.get(id);
    if (!room) return null;
    if (room.expiresAt <= this.now()) { this.closeRoom(id); return null; }
    return room;
  }
  touch(id) {
    const room = this.get(id);
    if (!room) return false;
    room.expiresAt = this.now() + this.ttlMs;
    return true;
  }
  authorize(id, role, token) {
    const room = this.get(id);
    if (!room) return false;
    return role === "host" ? verifyToken(token, room.hostDigest) :
      role === "viewer" && verifyToken(token, room.viewerDigest);
  }
  attachHost(id, socket, participantId) {
    const room = this.get(id);
    if (!room || room.host) return false;
    room.host = { socket, participantId };
    room.expiresAt = this.now() + this.ttlMs;
    return true;
  }
  addViewer(id, socket, participantId) {
    const room = this.get(id);
    if (!room || !room.host || room.viewers.size >= this.maxViewers) return false;
    room.viewers.set(participantId, socket);
    return true;
  }
  removeParticipant(id, participantId) {
    const room = this.get(id);
    if (!room) return { room: null, role: null };
    if (room.host?.participantId === participantId) {
      room.host = null;
      return { room, role: "host" };
    }
    if (room.viewers.delete(participantId)) return { room, role: "viewer" };
    return { room, role: null };
  }
  closeRoom(id) {
    const room = this.#rooms.get(id) ?? null;
    if (room) this.#rooms.delete(id);
    return room;
  }
  cleanupExpired() {
    return this.expireRooms().length;
  }
  expireRooms() {
    const expired = [];
    for (const [id, room] of this.#rooms) {
      if (room.expiresAt <= this.now()) { expired.push(this.closeRoom(id)); }
    }
    return expired;
  }
  get size() { return this.#rooms.size; }
}
