import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createRoomServer } from '../../server/index.mjs';

export async function client(base) {
  const ws = new WebSocket(new URL('/ws', base.replace('http:', 'ws:')));
  await once(ws, 'open');
  let sequence = 0;
  const events = [],
    pending = new Map();
  ws.on('message', (raw) => {
    const value = JSON.parse(raw);
    const request = pending.get(value.replyTo);
    if (!request) {
      events.push(value);
      return;
    }
    pending.delete(value.replyTo);
    clearTimeout(request.timer);
    value.ok
      ? request.resolve(value.data)
      : request.reject(Object.assign(new Error(value.error), { code: value.code }));
  });
  ws.on('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Connexion fermée.'));
    }
    pending.clear();
  });
  return {
    ws,
    events,
    request(type, data = {}) {
      const id = String(++sequence);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Délai de réponse dépassé.'));
        }, 2000);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, type, data }));
      });
    },
  };
}

export async function roomFixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'memeroom-test-'));
  let server;
  const fixture = {
    directory,
    base: null,
    server: null,
    async restart() {
      if (server) await server.stop();
      server = createRoomServer({ host: '127.0.0.1', port: 0, dataDir: directory, ...options });
      const address = await server.start();
      fixture.server = server;
      fixture.base = `http://127.0.0.1:${address.port}`;
      return fixture;
    },
  };
  t.after(async () => {
    if (server) await server.stop();
    await rm(directory, { recursive: true, force: true });
  });
  return fixture.restart();
}
