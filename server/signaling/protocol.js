const MAX_SDP_LENGTH = 50000;
const MAX_CANDIDATE_LENGTH = 4096;

export function parseClientMessage(raw) {
  let data;
  try { data = JSON.parse(raw.toString()); } catch { return { error: "invalid_json" }; }
  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.type !== "string") {
    return { error: "invalid_message" };
  }
  if (data.type === "join") return { message: data };
  if (!["offer", "answer", "ice", "end"].includes(data.type)) return { error: "unknown_type" };
  if (typeof data.target !== "string" || data.target.length > 80) return { error: "invalid_target" };
  if (data.type === "offer" || data.type === "answer") {
    if (!data.description || data.description.type !== data.type ||
        typeof data.description.sdp !== "string" || data.description.sdp.length > MAX_SDP_LENGTH) {
      return { error: "invalid_description" };
    }
  }
  if (data.type === "ice" && data.candidate !== null &&
      (!data.candidate || typeof data.candidate.candidate !== "string" || data.candidate.candidate.length > MAX_CANDIDATE_LENGTH)) {
    return { error: "invalid_candidate" };
  }
  return { message: data };
}

export function serverMessage(type, fields = {}) {
  return JSON.stringify({ type, ...fields });
}
