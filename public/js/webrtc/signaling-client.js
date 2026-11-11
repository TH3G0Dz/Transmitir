export class SignalingClient extends EventTarget {
  constructor() { super(); this.socket = null; }
  connect({ roomId, role, token, timeoutMs = 10000 }) {
    return new Promise((resolve, reject) => {
      const scheme = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${scheme}//${location.host}/signal`);
      this.socket = socket;
      let settled = false;
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback(value);
      };
      const timeout = setTimeout(() => { settle(reject, new Error("Tempo esgotado ao conectar à sala.")); socket.close(); }, timeoutMs);
      socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "join", roomId, role, token })));
      socket.addEventListener("message", (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        this.dispatchEvent(new CustomEvent("signal", { detail: message }));
        if (message.type === "joined") settle(resolve, message);
        else if (message.type === "error" && !settled) { settle(reject, new Error(message.code)); socket.close(); }
      });
      socket.addEventListener("error", () => { settle(reject, new Error("Não foi possível acessar o servidor de sinalização.")); socket.close(); });
      socket.addEventListener("close", () => {
        settle(reject, new Error("A conexão com o servidor de sinalização foi encerrada."));
        this.dispatchEvent(new Event("disconnected"));
      });
    });
  }
  get connected() { return this.socket?.readyState === WebSocket.OPEN; }
  send(message) {
    if (!this.connected) throw new Error("O servidor de sinalização foi desconectado.");
    this.socket.send(JSON.stringify(message));
  }
  close() { this.socket?.close(1000, "Client closed"); this.socket = null; }
}
