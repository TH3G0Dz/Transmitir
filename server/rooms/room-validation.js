export const ROOM_ID_PATTERN = /^[0-9a-f-]{36}$/i;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

export function validateRoomId(value) {
  return typeof value === "string" && ROOM_ID_PATTERN.test(value);
}

export function validateJoin(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    value.type === "join" && validateRoomId(value.roomId) &&
    (value.role === "host" || value.role === "viewer") &&
    typeof value.token === "string" && TOKEN_PATTERN.test(value.token);
}
