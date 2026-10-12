export class SignalingClient extends EventTarget {
  constructor() { super(); this.socket = null; }
  connect({ roomId, role, token }) {
    return new Promise((resolve, reject) => {
      const scheme = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${scheme}//${location.host}/signal`);
      this.socket = socket;
      const timeout = setTimeout(() => { socket.close(); reject(new Error("Tempo esgotado ao conectar à sala.")); }, 10000);
      socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "join", roomId, role, token })));
      socket.addEventListener("message", (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        this.dispatchEvent(new CustomEvent("signal", { detail: message }));
        if (message.type === "joined") { clearTimeout(timeout); resolve(message); }
        else if (message.type === "error" && !this.connected) { clearTimeout(timeout); reject(new Error(message.code)); }
      });
      socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Não foi possível acessar o servidor de sinalização.")); });
      socket.addEventListener("close", () => {
        clearTimeout(timeout);
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
