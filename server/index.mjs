import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { LIMITS, publicMedia } from '../shared/protocol.mjs';
import { inspectMedia } from './media-scan.mjs';
import { createRoomRegistry } from './rooms.mjs';
import { createRequestPolicy } from './request-policy.mjs';
import { createHttpHandler } from './http.mjs';
import { attachWebSocket } from './websocket.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function createRoomServer({
  host = process.env.HOST || '0.0.0.0',
  port = Number(process.env.PORT || 3210),
  dataDir = process.env.MEMEROOM_DATA_DIR || path.resolve('data'),
  releasesDir = process.env.MEMEROOM_RELEASES_DIR || path.join(root, 'releases'),
  cooldownMs = LIMITS.cooldownMs,
  emptyRoomTtlMs = 30 * 60 * 1000,
  mediaTtlMs = LIMITS.mediaTtlMs,
  scanMedia = inspectMedia,
  adminToken = process.env.MEMEROOM_ADMIN_TOKEN,
  trustProxy = process.env.MEMEROOM_TRUST_PROXY === '1',
  allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
} = {}) {
  const registry = createRoomRegistry(dataDir);
  const { rooms, sessions, media, store, storage, makeRoom, removeMedia, emit } = registry;
  const policy = createRequestPolicy(allowedOrigins);
  const config = {
    dataDir,
    releasesDir,
    trustProxy,
    scanMedia,
    mediaTtlMs,
    adminToken,
    cooldownMs,
  };
  const server = http.createServer(createHttpHandler(registry, policy, config));
  server.requestTimeout = LIMITS.transferTimeoutMs;
  server.headersTimeout = 10000;
  const { wss, passwordLimiter } = attachWebSocket(server, registry, policy, config);
  const sweep = setInterval(
    () => {
      const now = Date.now();
      const changed = new Set();
      for (const asset of media.values())
        if (asset.expiresAt <= now) {
          changed.add(rooms.get(asset.roomCode));
          removeMedia(asset);
        }
      for (const room of changed)
        if (room) emit(room, { type: 'library', media: [...room.media.values()].map(publicMedia) });
      for (const ws of wss.clients) {
        if (!ws.alive) ws.terminate();
        else {
          ws.alive = false;
          ws.ping();
        }
      }
      for (const [code, room] of rooms)
        if (!room.members.size && now - room.lastActive > emptyRoomTtlMs) {
          for (const asset of room.media.values()) removeMedia(asset);
          if (dataDir) {
            room.media.clear();
            room.bytes = 0;
            room.history = [];
          } else rooms.delete(code);
        }
      policy.sweep(now);
      passwordLimiter.sweep();
    },
    Math.min(30000, emptyRoomTtlMs, mediaTtlMs),
  );
  sweep.unref();
  return {
    server,
    async start() {
      for (const saved of store.load())
        rooms.set(saved.code, makeRoom(saved.code, saved.name, saved));
      await storage.start();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      return server.address();
    },
    async stop() {
      clearInterval(sweep);
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await storage.stop();
      rooms.clear();
      sessions.clear();
      media.clear();
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const instance = createRoomServer();
  instance
    .start()
    .then((address) =>
      console.log(
        `MemeRoom : http://localhost:${address.port}\nÉcoute : ${address.address}. Partagez l’adresse du serveur et le code de la room.`,
      ),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => {
      await instance.stop();
      process.exit(0);
    });
}
