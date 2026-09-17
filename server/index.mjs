import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { LIMITS, cleanText, publicMedia, validateReaction } from '../shared/protocol.mjs';
import { MediaStorage } from './media-storage.mjs';
import { inspectMedia } from './media-scan.mjs';
import { PasswordLimiter, clientIP } from './password-limiter.mjs';
import { makeMediaSpace } from './media-capacity.mjs';
import { RoomStore } from './room-store.mjs';
import { listDownloads, serveRelease, parseByteRange } from './releases.mjs';
import { secret, digest, hashPassword, verifyPassword, isOwner, issueJoinToken, validJoinToken, accessInfo, passwordError } from './room-access.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticFiles = new Map([
  ['/', ['public/downloads.html', 'text/html; charset=utf-8']],
  ['/telecharger', ['public/downloads.html', 'text/html; charset=utf-8']],
  ['/telecharger/', ['public/downloads.html', 'text/html; charset=utf-8']],
  ['/downloads.mjs', ['public/downloads.mjs', 'text/javascript; charset=utf-8']],
  ['/downloads.css', ['public/downloads.css', 'text/css; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['public/favicon.svg', 'image/svg+xml']]
]);
const staticCache = new Map();
async function getStaticFile(pathname) {
  const meta = staticFiles.get(pathname);
  if (!meta) return null;
  let cached = staticCache.get(meta[0]);
  if (!cached) {
    const data = await readFile(path.join(root, meta[0]));
    cached = { data, mime: meta[1], length: data.byteLength };
    staticCache.set(meta[0], cached);
  }
  return cached;
}
const token = () => randomBytes(24).toString('base64url');
const roomCode = () => Array.from(randomBytes(8), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
const send = (ws, data) => { if (ws.readyState === WebSocket.OPEN) { if (ws.bufferedAmount > 1024 * 1024) ws.terminate(); else ws.send(JSON.stringify(data)); } };

export function createRoomServer({ host = process.env.HOST || '0.0.0.0', port = Number(process.env.PORT || 3210), dataDir = process.env.MEMEROOM_DATA_DIR || path.resolve('data'), releasesDir = process.env.MEMEROOM_RELEASES_DIR || path.join(root, 'releases'), cooldownMs = LIMITS.cooldownMs, emptyRoomTtlMs = 30 * 60 * 1000, mediaTtlMs = LIMITS.mediaTtlMs, scanMedia = inspectMedia, trustProxy = process.env.MEMEROOM_TRUST_PROXY === '1', allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean) } = {}) {
  const rooms = new Map(), sessions = new Map(), media = new Map(), ipBudgets = new Map();
  const store = new RoomStore(dataDir);
  const storage = new MediaStorage(), passwordLimiter = new PasswordLimiter();
  const makeRoom = (code, name, access = {}) => ({ code, name, isPrivate: true, passwordHash: null, ownerHash: null, accessKey: secret(), ...access, members: new Map(), media: new Map(), bytes: 0, history: [], revision: 0, failedPasswords: { start: Date.now(), count: 0 }, lastActive: Date.now(), lastBroadcast: 0 });
  let totalBytes = 0, uploads = 0;
  function removeMedia(asset) {
    if (!media.delete(asset.id)) return;
    const room = rooms.get(asset.roomCode);
    if (room) { room.media.delete(asset.id); room.bytes -= asset.bytes; }
    totalBytes -= asset.bytes; storage.remove(asset);
  }
  function originAllowed(origin, request) {
    if (!origin) return true; // Native clients authenticate by room invitation + session token.
    try {
      const url = new URL(origin);
      return ['http:', 'https:'].includes(url.protocol) && (url.host === request.headers.host || ['localhost','127.0.0.1','[::1]'].includes(url.hostname) || allowedOrigins.includes(url.origin));
    } catch { return false; }
  }
  function limited(ip) {
    const now = Date.now();
    let budget = ipBudgets.get(ip);
    if (!budget || now - budget.start > 60000) { budget = { start: now, count: 0 }; ipBudgets.set(ip, budget); }
    return ++budget.count > 120;
  }
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  const members = room => [...room.members.values()].map(m => ({ id: m.id, name: m.name, desktop: m.desktop, paused: m.paused }));
  const emit = (room, event) => { for (const member of room.members.values()) send(member.ws, event); };
  const presence = room => emit(room, { type: 'members', members: members(room) });
  const leave = ws => {
    const member = ws.member;
    if (!member) return;
    sessions.delete(member.token);
    const room = rooms.get(member.code);
    if (room) { room.members.delete(member.id); room.lastActive = Date.now(); presence(room); }
    ws.member = null;
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: http: https:; media-src 'self' blob: http: https:; connect-src 'self' http: https: ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (!originAllowed(req.headers.origin, req)) { json(res, 403, { error: 'Origine non autorisée.' }); return; }
    if (req.headers.origin) { res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Filename');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { json(res, 400, { error: 'URL invalide.' }); return; }
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') { json(res, 200, { app: 'memeroom', version: '0.6.6', persistentRooms: !!dataDir, features: { roomAccess: true, roomDirectory: true, mediaEviction: true, mediaExpiry: true, largeUploads: true, antivirusRequired: process.env.MEMEROOM_SCAN_REQUIRED === '1' || !!process.env.CLAMAV_HOST } }); return; }
      if (req.method === 'GET' && url.pathname === '/api/rooms') {
        if (limited(clientIP(req, trustProxy))) { json(res, 429, { error: 'Trop de demandes. Patientez une minute.' }); return; }
        json(res, 200, { rooms: [...rooms.values()].filter(room => !room.isPrivate).map(room => ({ code: room.code, name: room.name, members: room.members.size, passwordRequired: !!room.passwordHash })).sort((a, b) => a.name.localeCompare(b.name, 'fr')) }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/downloads') { json(res, 200, await listDownloads(releasesDir)); return; }
      if (['GET', 'HEAD'].includes(req.method) && url.pathname.startsWith('/releases/')) { await serveRelease(req, res, releasesDir, url.pathname.slice(10)); return; }
      if (req.method === 'POST' && url.pathname === '/api/media') {
        const member = sessions.get((req.headers.authorization || '').replace(/^Bearer /, ''));
        const room = member && rooms.get(member.code);
        if (!room || member.ws.readyState !== WebSocket.OPEN) { req.resume(); json(res, 401, { error: 'Rejoignez une room avant d’importer un fichier.' }); return; }
        if (uploads >= 4 || member.uploading) { req.resume(); res.setHeader('Retry-After', '1'); json(res, 429, { error: 'Un import est déjà en cours. Réessayez dans un instant.' }); return; }
        if (Number(req.headers['content-length']) > LIMITS.uploadBytes) { req.resume(); json(res, 413, { error: 'Le fichier dépasse 1 Go.' }); return; }
        uploads++; member.uploading = true;
        let received, published = false;
        try {
          req.setTimeout(60000, () => req.destroy());
          received = await storage.receive(req);
          req.setTimeout(0);
          await scanMedia(received);
          if (sessions.get(member.token) !== member) { json(res, 401, { error: 'La connexion à la room a été interrompue.' }); return; }
          let name = 'Mon média';
          try { name = cleanText(decodeURIComponent(req.headers['x-filename'] || ''), 80) || name; } catch { /* Use default for malformed filename headers. */ }
          const asset = { id: token(), name, ...received, roomCode: room.code, expiresAt:Date.now() + mediaTtlMs };
          // Only a fully received, valid upload from a still-connected member may evict files.
          const space = makeMediaSpace(room, rooms, media, asset.bytes, totalBytes); totalBytes = space.totalBytes;
          for (const removed of space.removed) storage.remove(removed);
          room.media.set(asset.id, asset); media.set(asset.id, asset); room.bytes += asset.bytes; totalBytes += asset.bytes; published = true;
          space.changed.add(room);
          for (const changed of space.changed) emit(changed, { type: 'library', media: [...changed.media.values()].map(publicMedia) });
          json(res, 201, publicMedia(asset));
        } finally { if (received && !published) storage.remove(received); uploads--; member.uploading = false; }
        return;
      }
      if (['GET','HEAD'].includes(req.method) && url.pathname.startsWith('/media/')) {
        const asset = media.get(url.pathname.slice(7));
        if (!asset || asset.expiresAt <= Date.now()) { json(res, 404, { error: 'Média expiré.' }); return; }
        res.setHeader('Content-Type', asset.mime);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        const range = parseByteRange(req.headers.range, asset.bytes);
        if (!range) { res.writeHead(416, { 'Content-Range': `bytes */${asset.bytes}` }); res.end(); return; }
        if (range.status === 206) res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${asset.bytes}`);
        res.writeHead(range.status, { 'Content-Length': range.end - range.start + 1 });
        if (req.method === 'HEAD') res.end();
        else await pipeline(createReadStream(asset.file, { start: range.start, end: range.end }), res);
        return;
      }
      if (['GET', 'HEAD'].includes(req.method)) {
        const file = await getStaticFile(url.pathname);
        if (file) {
          res.writeHead(200, { 'Content-Type': file.mime, 'Content-Length': file.length });
          if (req.method === 'HEAD') res.end();
          else res.end(file.data);
          return;
        }
      }
      json(res, 404, { error: 'Page introuvable.' });
    } catch (error) { if (!res.headersSent && !res.destroyed) json(res, error.status || 400, { error: error.status ? error.message : 'Impossible de traiter la requête.' }); }
  });
  server.requestTimeout = LIMITS.transferTimeoutMs; server.headersTimeout = 10000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 48 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws' || !originAllowed(req.headers.origin, req) || wss.clients.size >= 256 || limited(clientIP(req, trustProxy))) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws, req) => {
    ws.alive = true; ws.rate = { start: Date.now(), count: 0 };
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    ws.on('close', () => leave(ws));
    ws.queue = Promise.resolve(); ws.queued = 0;
    ws.on('message', (raw, isBinary) => {
      if (ws.queued >= 8) { ws.terminate(); return; }
      ws.queued++;
      ws.queue = ws.queue.then(() => processMessage(raw, isBinary)).finally(() => { ws.queued--; });
    });
    async function processMessage(raw, isBinary) {
      if (ws.readyState !== WebSocket.OPEN) return;
      let message;
      try {
        if (isBinary) throw new Error('Message invalide.');
        message = JSON.parse(raw.toString());
        if (!message || typeof message !== 'object' || typeof message.id !== 'string' || message.id.length > 80) throw new Error('Message invalide.');
        const now = Date.now();
        if (now - ws.rate.start > 10000) ws.rate = { start: now, count: 0 };
        if (++ws.rate.count > 40) throw new Error('Trop de demandes. Patientez quelques secondes.');
        const reply = data => send(ws, { replyTo: message.id, ok: true, data, serverTime: Date.now() });
        const body = message.data || {};
        if (message.type === 'ping') { reply({}); return; }
        if (message.type === 'leave') { leave(ws); reply({}); return; }
        if (['create', 'join'].includes(message.type)) {
          if (limited(clientIP(req, trustProxy))) throw new Error('Trop de tentatives de connexion. Patientez une minute.');
          const name = cleanText(body.name, 24);
          if (!name) throw new Error('Choisissez un pseudo.');
          let code = cleanText(body.code, 20).toUpperCase().replace(/[-\s]/g, '');
          let room, ownerToken;
          if (message.type === 'create') {
            if (rooms.size >= 100) throw new Error('Le serveur est plein. Réessayez plus tard.');
            const passwordHash = await hashPassword(body.password);
            if (ws.readyState !== WebSocket.OPEN) return;
            if (rooms.size >= 100) throw new Error('Le serveur est plein. Réessayez plus tard.');
            do { code = roomCode(); } while (rooms.has(code));
            ownerToken = secret();
            room = makeRoom(code, cleanText(body.roomName, 40) || 'Ma room', { isPrivate: body.isPrivate !== false, passwordHash, ownerHash: digest(ownerToken) });
            try { store.add(room); } catch { throw new Error('Impossible d’enregistrer la room sur le serveur. Vérifiez son stockage.'); }
          } else {
            room = rooms.get(code);
            if (!room) throw new Error('Cette room est introuvable. Vérifiez le code et le serveur.');
            const accessKey = room.accessKey;
            if (room.passwordHash && !isOwner(room, body.ownerToken) && !validJoinToken(room, body.joinToken)) {
              const passwordSucceeded = passwordLimiter.consume(clientIP(req, trustProxy), code);
              if (Date.now() - room.failedPasswords.start > 60000) room.failedPasswords = { start: Date.now(), count: 0 };
              if (room.failedPasswords.count >= 12) throw new Error('Trop de mots de passe incorrects. Réessayez dans une minute.');
              const budget = room.failedPasswords; budget.count++;
              if (!await verifyPassword(body.password, room.passwordHash)) throw passwordError();
              budget.count--; passwordSucceeded();
            }
            if (ws.readyState !== WebSocket.OPEN) return;
            if (room.accessKey !== accessKey || rooms.get(code) !== room) throw passwordError();
            if (room.members.size >= LIMITS.members) throw new Error('Cette room est pleine (16 participants).');
          }
          leave(ws); rooms.set(code, room);
          const member = { id: randomUUID(), token: token(), name, code, owner: isOwner(room, ownerToken || body.ownerToken), desktop: body.desktop === true, paused: body.paused === true, ws };
          ws.member = member; room.members.set(member.id, member); sessions.set(member.token, member); room.lastActive = now;
          reply({ memberId: member.id, token: member.token, code, name: room.name, persistent: !!dataDir, members: members(room), media: [...room.media.values()].map(publicMedia), history: room.history, access: accessInfo(room, member.owner), joinToken: issueJoinToken(room), ...(ownerToken ? { ownerToken } : {}) });
          presence(room); return;
        }
        const member = ws.member, room = member && rooms.get(member.code);
        if (!room) throw new Error('Rejoignez une room pour continuer.');
        if (message.type === 'status') { member.paused = body.paused === true; presence(room); reply({}); return; }
        if (message.type === 'rename') {
          const name = cleanText(body.name, 24);
          if (!name) throw new Error('Choisissez un pseudo.');
          member.name = name;
          presence(room);
          reply({ name });
          return;
        }
        if (message.type === 'room-settings') {
          if (!member.owner && room.ownerHash) throw new Error('Seul le gestionnaire peut modifier cette room.');
          if (typeof body.isPrivate !== 'boolean' || !['keep', 'set', 'remove'].includes(body.passwordAction)) throw new Error('Réglages de room invalides.');
          const revision = room.revision;
          const passwordHash = body.passwordAction === 'set' ? await hashPassword(body.password) : body.passwordAction === 'remove' ? null : room.passwordHash;
          if (body.passwordAction === 'set' && !passwordHash) throw new Error('Saisissez le nouveau mot de passe.');
          if (ws.readyState !== WebSocket.OPEN || ws.member !== member) return;
          if (room.revision !== revision) throw new Error('La room a changé. Rouvrez ses réglages.');
          const ownerToken = room.ownerHash ? null : secret();
          const changed = body.passwordAction !== 'keep';
          const updated = { ...room, isPrivate: body.isPrivate, passwordHash, ownerHash: ownerToken ? digest(ownerToken) : room.ownerHash, accessKey: changed ? secret() : room.accessKey };
          try { store.add(updated); } catch { throw new Error('Impossible d’enregistrer les accès de la room.'); }
          Object.assign(room, { isPrivate: updated.isPrivate, passwordHash, ownerHash: updated.ownerHash, accessKey: updated.accessKey, revision: revision + 1 });
          member.owner = true;
          if (changed) {
            for (const other of [...room.members.values()]) if (other !== member) { send(other.ws, { type: 'access-changed' }); leave(other.ws); other.ws.close(1008, 'Accès modifié'); }
            for (const asset of room.media.values()) removeMedia(asset);
            room.media.clear(); room.bytes = 0; room.history = []; room.failedPasswords = { start: Date.now(), count: 0 };
            emit(room, { type: 'library', media: [] });
          }
          for (const current of room.members.values()) send(current.ws, { type: 'room-access', access: accessInfo(room, current.owner) });
          reply({ access: accessInfo(room, true), joinToken: issueJoinToken(room), ...(ownerToken ? { ownerToken } : {}) }); return;
        }
        if (message.type === 'broadcast') {
          if (now - room.lastBroadcast < cooldownMs) throw new Error('Une réaction vient de partir. Patientez 3 secondes.');
          for (const id of [body.mediaId, body.audioId]) if (id && room.media.get(id)?.expiresAt <= Date.now()) throw new Error('Ce fichier a expiré. Importez-le à nouveau ou chargez un message enregistré.');
          const reaction = validateReaction(body, room.media);
          const event = { ...reaction, id: randomUUID(), sender: { id: member.id, name: member.name }, sentAt: now, startAt: now + 350, type: 'reaction' };
          room.lastBroadcast = now; room.lastActive = now;
          room.history.unshift({ id: event.id, name: event.name, sender: member.name, sentAt: now, kind: event.media?.kind || (event.audio ? 'audio' : 'text'), caption: event.caption || '', media: event.media || null, audio: event.audio || null, cues: event.cues || [], duration: event.duration });
          room.history.length = Math.min(room.history.length, 50);
          emit(room, event); reply({ id: event.id }); return;
        }
        throw new Error('Action inconnue.');
      } catch (error) { send(ws, { replyTo: typeof message?.id === 'string' ? message.id.slice(0,80) : null, ok: false, error: error.message, ...(['ROOM_PASSWORD_REQUIRED','ROOM_RATE_LIMITED'].includes(error.code) ? { code: error.code } : {}) }); }
    }
  });
  const sweep = setInterval(() => {
    const now = Date.now();
    const changed = new Set();
    for (const asset of media.values()) if (asset.expiresAt <= now) { changed.add(rooms.get(asset.roomCode)); removeMedia(asset); }
    for (const room of changed) if (room) emit(room, { type:'library', media:[...room.media.values()].map(publicMedia) });
    for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
    for (const [code, room] of rooms) if (!room.members.size && now - room.lastActive > emptyRoomTtlMs) {
      for (const asset of room.media.values()) removeMedia(asset);
      if (dataDir) { room.media.clear(); room.bytes = 0; room.history = []; } else rooms.delete(code);
    }
    for (const [ip, budget] of ipBudgets) if (now - budget.start > 60000) ipBudgets.delete(ip);
    passwordLimiter.sweep();
  }, Math.min(30000, emptyRoomTtlMs, mediaTtlMs));
  sweep.unref();
  return {
    server,
    async start() { for (const saved of store.load()) rooms.set(saved.code, makeRoom(saved.code, saved.name, saved)); await storage.start(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); }); return server.address(); },
    async stop() { clearInterval(sweep); for (const ws of wss.clients) ws.terminate(); await new Promise(resolve => wss.close(resolve)); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await storage.stop(); rooms.clear(); sessions.clear(); media.clear(); staticCache.clear(); }
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const instance = createRoomServer();
  instance.start().then(address => console.log(`MemeRoom : http://localhost:${address.port}\nÉcoute : ${address.address}. Partagez l’adresse du serveur et le code de la room.`)).catch(error => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, async () => { await instance.stop(); process.exit(0); });
}
