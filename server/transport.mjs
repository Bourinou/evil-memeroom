import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
export const token = () => randomBytes(24).toString('base64url');
export const roomCode = () =>
  Array.from(randomBytes(8), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
export const send = (ws, data) => {
  if (ws.readyState === WebSocket.OPEN) {
    if (ws.bufferedAmount > 1024 * 1024) ws.terminate();
    else ws.send(JSON.stringify(data));
  }
};
