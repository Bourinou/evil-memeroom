import { isIP } from 'node:net';

// Trust exactly one proxy hop only when the deployment explicitly enables it.
export function clientIP(req, trustProxy = false) {
  const direct = req.socket.remoteAddress || 'unknown';
  if (!trustProxy) return direct;
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').at(-1).trim();
  return isIP(forwarded) ? forwarded : direct;
}
export class PasswordLimiter {
  constructor({ now = Date.now } = {}) { this.now = now; this.budgets = new Map(); }
  consume(ip, code) {
    const now = this.now();
    const keys = [[`ip:${ip}`,20], [`room:${code}:ip:${ip}`,5]];
    for (const [key, maximum] of keys) {
      const item = this.budgets.get(key);
      if (item && item.until > now && item.count >= maximum) throw Object.assign(new Error(`Trop de mots de passe incorrects. Réessayez dans ${Math.ceil((item.until - now) / 1000)} s.`), { code:'ROOM_RATE_LIMITED' });
    }
    for (const [key] of keys) {
      let item = this.budgets.get(key);
      if (!item || item.until <= now) { item = { count:0, until:now + 5 * 60 * 1000 }; this.budgets.set(key, item); }
      item.count++;
    }
    return () => { for (const [key] of keys) { const item = this.budgets.get(key); if (item) item.count = Math.max(0, item.count - 1); } };
  }
  sweep() { for (const [key, item] of this.budgets) if (item.until <= this.now()) this.budgets.delete(key); }
}
