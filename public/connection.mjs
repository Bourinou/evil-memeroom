export class Connection {
  constructor(origin, onEvent, onClose) {
    this.origin = origin; this.onEvent = onEvent; this.onClose = onClose;
    this.pending = new Map(); this.skew = 0; this.intentional = false;
  }
  async open() {
    const url = new URL('/ws', this.origin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(url);
    this.ws.addEventListener('message', event => {
      let value; try { value = JSON.parse(event.data); } catch { return; }
      if (value.replyTo && this.pending.has(value.replyTo)) {
        const pending = this.pending.get(value.replyTo); clearTimeout(pending.timer); this.pending.delete(value.replyTo);
        if (value.serverTime) this.skew = value.serverTime - (Date.now() + pending.sentAt) / 2;
        value.ok ? pending.resolve(value.data) : pending.reject(Object.assign(new Error(value.error || 'La demande a échoué.'), { code: value.code }));
      } else this.onEvent(value);
    });
    this.ws.addEventListener('close', () => {
      clearInterval(this.heartbeat);
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Connexion interrompue.')); }
      this.pending.clear(); if (!this.intentional) this.onClose();
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.close(); reject(new Error('Serveur inaccessible.')); }, 6000);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Serveur inaccessible.')); }, { once: true });
    });
    this.heartbeat = setInterval(() => this.request('ping').catch(() => this.ws.close()), 20000);
  }
  request(type, data = {}) {
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Serveur déconnecté.'));
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Le serveur ne répond pas.')); }, 10000);
      this.pending.set(id, { resolve, reject, timer, sentAt: Date.now() }); this.ws.send(JSON.stringify({ id, type, data }));
    });
  }
  close() { this.intentional = true; clearInterval(this.heartbeat); this.ws?.close(); }
}
