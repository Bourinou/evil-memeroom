import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocket } from 'ws';
import { LIMITS, cleanText, publicMedia } from '../shared/protocol.mjs';
import { clientIP } from './password-limiter.mjs';
import { makeMediaSpace } from './media-capacity.mjs';
import { listDownloads, serveRelease } from './releases.mjs';
import { createAdminHandler } from './admin-api.mjs';
import { token } from './transport.mjs';
import metadata from '../package.json' with { type: 'json' };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticFiles = new Map([
  ['/', ['public/downloads.html', 'text/html; charset=utf-8']],
  ['/telecharger', ['public/downloads.html', 'text/html; charset=utf-8']],
  ['/telecharger/', ['public/downloads.html', 'text/html; charset=utf-8']],
  ['/downloads.mjs', ['public/downloads.mjs', 'text/javascript; charset=utf-8']],
  ['/downloads.css', ['public/downloads.css', 'text/css; charset=utf-8']],
  ['/styles.css', ['shared/base.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['public/favicon.svg', 'image/svg+xml']],
]);

export function createHttpHandler(
  registry,
  policy,
  { dataDir, releasesDir, trustProxy, scanMedia, mediaTtlMs, adminToken, diagnostics, stats },
) {
  const { rooms, sessions, media, storage, transfers, emit, deleteRoom } = registry;
  const { originAllowed, limited } = policy;
  const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };

  const handleAdmin = createAdminHandler({ adminToken, rooms, deleteRoom, json, stats });
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: http: https:; media-src 'self' blob: http: https:; connect-src 'self' http: https: ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (!originAllowed(req.headers.origin, req)) {
      json(res, 403, { error: 'Origine non autorisée.' });
      return;
    }
    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Filename');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      json(res, 400, { error: 'URL invalide.' });
      return;
    }
    try {
      if (handleAdmin(req, res, url)) return;
      if (req.method === 'GET' && url.pathname === '/api/health') {
        json(res, 200, {
          app: 'memeroom',
          version: metadata.version,
          persistentRooms: !!dataDir,
          features: {
            roomAccess: true,
            roomDirectory: true,
            mediaEviction: true,
            mediaExpiry: true,
            largeUploads: true,
            antivirusRequired:
              process.env.MEMEROOM_SCAN_REQUIRED === '1' || !!process.env.CLAMAV_HOST,
          },
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/rooms') {
        if (limited(clientIP(req, trustProxy))) {
          json(res, 429, { error: 'Trop de demandes. Patientez une minute.' });
          return;
        }
        json(res, 200, {
          rooms: [...rooms.values()]
            .filter((room) => !room.isPrivate)
            .map((room) => ({
              code: room.code,
              name: room.name,
              members: room.members.size,
              passwordRequired: !!room.passwordHash,
            }))
            .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/downloads') {
        json(res, 200, await listDownloads(releasesDir));
        return;
      }
      if (['GET', 'HEAD'].includes(req.method) && url.pathname.startsWith('/releases/')) {
        await serveRelease(req, res, releasesDir, url.pathname.slice(10));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/media') {
        const member = sessions.get((req.headers.authorization || '').replace(/^Bearer /, ''));
        const room = member && rooms.get(member.code);
        if (!room || member.ws.readyState !== WebSocket.OPEN) {
          req.resume();
          json(res, 401, { error: 'Rejoignez une room avant d’importer un fichier.' });
          return;
        }
        if (transfers.uploads >= 4 || member.uploading) {
          req.resume();
          res.setHeader('Retry-After', '1');
          json(res, 429, { error: 'Un import est déjà en cours. Réessayez dans un instant.' });
          return;
        }
        if (Number(req.headers['content-length']) > LIMITS.uploadBytes) {
          req.resume();
          json(res, 413, { error: 'Le fichier dépasse 1 Go.' });
          return;
        }
        transfers.uploads++;
        member.uploading = true;
        let received,
          published = false;
        try {
          req.setTimeout(60000, () => req.destroy());
          received = await storage.receive(req);
          req.setTimeout(0);
          await scanMedia(received);
          if (sessions.get(member.token) !== member) {
            json(res, 401, { error: 'La connexion à la room a été interrompue.' });
            return;
          }
          let name = 'Mon média';
          try {
            name = cleanText(decodeURIComponent(req.headers['x-filename'] || ''), 80) || name;
          } catch {
            /* Use default for malformed filename headers. */
          }
          const asset = {
            id: token(),
            name,
            ...received,
            roomCode: room.code,
            expiresAt: Date.now() + mediaTtlMs,
          };
          // Only a fully received, valid upload from a still-connected member may evict files.
          const space = makeMediaSpace(room, rooms, media, asset.bytes, transfers.totalBytes);
          transfers.totalBytes = space.totalBytes;
          for (const removed of space.removed) storage.remove(removed);
          room.media.set(asset.id, asset);
          media.set(asset.id, asset);
          room.bytes += asset.bytes;
          transfers.totalBytes += asset.bytes;
          published = true;
          space.changed.add(room);
          for (const changed of space.changed)
            emit(changed, { type: 'library', media: [...changed.media.values()].map(publicMedia) });
          json(res, 201, publicMedia(asset));
        } finally {
          if (received && !published) storage.remove(received);
          transfers.uploads--;
          member.uploading = false;
        }
        return;
      }
      if (['GET', 'HEAD'].includes(req.method) && url.pathname.startsWith('/media/')) {
        const asset = media.get(url.pathname.slice(7));
        if (!asset || asset.expiresAt <= Date.now()) {
          json(res, 404, { error: 'Média expiré.' });
          return;
        }
        res.setHeader('Content-Type', asset.mime);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        let start = 0,
          end = asset.bytes - 1,
          status = 200;
        if (req.headers.range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          if (!match || (!match[1] && !match[2])) {
            res.writeHead(416, { 'Content-Range': `bytes */${asset.bytes}` });
            res.end();
            return;
          }
          if (!match[1]) start = Math.max(0, asset.bytes - Number(match[2]));
          else {
            start = Number(match[1]);
            if (match[2]) end = Math.min(end, Number(match[2]));
          }
          if (start > end || start >= asset.bytes) {
            res.writeHead(416, { 'Content-Range': `bytes */${asset.bytes}` });
            res.end();
            return;
          }
          status = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${asset.bytes}`);
        }
        res.writeHead(status, { 'Content-Length': end - start + 1 });
        if (req.method === 'HEAD') res.end();
        else await pipeline(createReadStream(asset.file, { start, end }), res);
        return;
      }
      const file = staticFiles.get(url.pathname);
      if (req.method === 'GET' && file) {
        const data = await readFile(path.join(root, file[0]));
        res.writeHead(200, { 'Content-Type': file[1] });
        res.end(data);
        return;
      }
      json(res, 404, { error: 'Page introuvable.' });
    } catch (error) {
      if (!error.status || error.status >= 500) diagnostics.error('http', error);
      if (!res.headersSent && !res.destroyed)
        json(res, error.status || 400, {
          error: error.status ? error.message : 'Impossible de traiter la requête.',
        });
    }
  };
}
