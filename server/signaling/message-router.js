import { randomUUID } from "node:crypto";
import { validateJoin } from "../rooms/room-validation.js";
import { parseClientMessage, serverMessage } from "./protocol.js";

const send = (socket, type, fields) => {
  if (socket.readyState === 1) socket.send(serverMessage(type, fields));
};

export function handleConnection(socket, { roomManager, limiter, config, onClose = () => {} }) {
  const state = { id: randomUUID(), roomId: null, role: null, closed: false };
  socket.on("error", () => socket.close());
  socket.on("pong", () => {
    socket.isAlive = true;
    if (state.roomId) roomManager.touch(state.roomId);
  });
  socket.on("message", (raw) => {
    if (!limiter.consume(state.id)) { send(socket, "error", { code: "rate_limited" }); socket.close(1008, "Rate limit"); return; }
    const parsed = parseClientMessage(raw);
    if (parsed.error) { send(socket, "error", { code: parsed.error }); return; }
    const message = parsed.message;
    if (!state.role) {
      if (!validateJoin(message)) { send(socket, "error", { code: "invalid_join" }); socket.close(1008, "Invalid join"); return; }
      const room = roomManager.get(message.roomId);
      if (!room || !roomManager.authorize(message.roomId, message.role, message.token)) {
        send(socket, "error", { code: "room_unavailable" }); socket.close(1008, "Room unavailable"); return;
      }
      state.role = message.role;
      state.roomId = message.roomId;
      if (message.role === "host") {
        if (!roomManager.attachHost(message.roomId, socket, state.id)) {
          state.role = null; state.roomId = null;
          send(socket, "error", { code: "host_already_connected" }); socket.close(1008, "Host connected"); return;
        }
        send(socket, "joined", { role: "host", viewerCount: room.viewers.size });
        return;
      }
      if (!roomManager.addViewer(message.roomId, socket, state.id)) {
        state.role = null; state.roomId = null;
        send(socket, "error", { code: "room_full_or_offline" }); socket.close(1008, "Unavailable"); return;
      }
      const currentRoom = roomManager.get(message.roomId);
      send(socket, "joined", { role: "viewer", viewerId: state.id });
      send(currentRoom.host.socket, "viewer-joined", { viewerId: state.id, viewerCount: currentRoom.viewers.size });
      return;
    }
    routeSignal(socket, state, message, roomManager);
  });

  socket.on("close", () => {
    if (state.closed) return;
    state.closed = true;
    limiter.forget(state.id);
    if (state.roomId && state.role) {
      const { room, role } = roomManager.removeParticipant(state.roomId, state.id);
      if (role === "host") {
        for (const viewerSocket of room?.viewers.values() ?? []) {
          send(viewerSocket, "room-ended", { reason: "host_disconnected" });
          viewerSocket.close(1000, "Host disconnected");
        }
      } else if (role === "viewer" && room?.host) {
        send(room.host.socket, "viewer-left", { viewerId: state.id, viewerCount: room.viewers.size });
      }
    }
    onClose(state);
  });
}

function routeSignal(socket, state, message, roomManager) {
  if (message.type === "end") {
    if (state.role !== "host") { send(socket, "error", { code: "host_only" }); return; }
    const room = roomManager.closeRoom(state.roomId);
    for (const viewerSocket of room?.viewers.values() ?? []) {
      send(viewerSocket, "room-ended", { reason: "host_ended" });
      viewerSocket.close(1000, "Host ended stream");
    }
    socket.close(1000, "Host ended stream");
    return;
  }
  const room = roomManager.get(state.roomId);
  if (!room) { send(socket, "error", { code: "room_unavailable" }); socket.close(1008, "Unavailable"); return; }
  let target;
  if (state.role === "host") target = room.viewers.get(message.target);
  else if (room.host?.participantId === message.target) target = room.host.socket;
  if (!target) { send(socket, "error", { code: "target_unavailable" }); return; }
  if (state.role === "host" && message.type === "answer") { send(socket, "error", { code: "invalid_direction" }); return; }
  if (state.role === "viewer" && message.type === "offer") { send(socket, "error", { code: "invalid_direction" }); return; }
  send(target, message.type, { from: state.id, ...(message.description ? { description: message.description } : {}), ...(message.candidate !== undefined ? { candidate: message.candidate } : {}) });
}
