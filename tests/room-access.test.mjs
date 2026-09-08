import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WebSocket } from 'ws';
import { createRoomServer } from '../server/index.mjs';
import { cleanClientState } from '../shared/protocol.mjs';
let sequence = 0;
async function client(base) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws'); await once(ws, 'open');
  const pending = new Map(), events = [];
  ws.on('message', raw => { const message = JSON.parse(raw); const waiting = pending.get(message.replyTo); if (!waiting) { events.push(message); return; } pending.delete(message.replyTo); clearTimeout(waiting.timer); message.ok ? waiting.resolve(message.data) : waiting.reject(Object.assign(new Error(message.error), { code: message.code })); });
  return { ws, events, request(type, data = {}) { const id = String(++sequence); return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Test request timed out')), 4000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, type, data })); }); } };
}
async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'memeroom-access-'));
  const server = createRoomServer({ host: '127.0.0.1', port: 0, dataDir, ...options });
  const address = await server.start(); t.after(() => server.stop());
  return { server, dataDir, base: `http://127.0.0.1:${address.port}` };
}
test('the website serves downloads and no public controller, including on an embedded server', async t => {
  const f = await fixture(t);
  const home = await (await fetch(f.base)).text(); assert.match(home, /Télécharger l’application/); assert.doesNotMatch(home, /send-form|Ouvrir la télécommande/);
  for (const url of ['/remote', '/desktop', '/desktop?key=anything', '/index.html', '/app.mjs', '/connection.mjs']) assert.equal((await fetch(f.base + url)).status, 404);
  assert.equal((await fetch(f.base + '/styles.css')).status, 200);
  assert.deepEqual((await (await fetch(f.base + '/api/health')).json()).features, { roomAccess: true, roomDirectory: true, mediaEviction: true, mediaExpiry:true, largeUploads:true, antivirusRequired:false });
});
test('public directory excludes private rooms and never exposes access credentials', async t => {
  const f = await fixture(t), owner = await client(f.base);
  const hidden = await owner.request('create', { name: 'Alice', roomName: 'Secret' });
  const open = await owner.request('create', { name: 'Alice', roomName: 'Ouverte', isPrivate: false });
  const locked = await owner.request('create', { name: 'Alice', roomName: 'Protégée', isPrivate: false, password: 'pass-public' });
  const response = await fetch(f.base + '/api/rooms'); assert.equal(response.headers.get('cache-control'), 'no-store');
  const json = await response.json(); assert.equal(json.rooms.length, 2);
  assert.deepEqual(json.rooms.find(r => r.code === open.code), { code: open.code, name: 'Ouverte', members: 0, passwordRequired: false });
  assert.deepEqual(json.rooms.find(r => r.code === locked.code), { code: locked.code, name: 'Protégée', members: 1, passwordRequired: true });
  for (const secret of [hidden.code, 'Secret', locked.ownerToken, locked.joinToken, 'pass-public', 'ownerHash', 'passwordHash', 'accessKey']) assert.ok(!JSON.stringify(json).includes(secret));
});
test('passwords are hashed, wrong/missing passwords are refused, saved tokens survive server restart', async t => {
  const f = await fixture(t), owner = await client(f.base), guest = await client(f.base);
  const room = await owner.request('create', { name: 'Alice', roomName: 'Protected', password: 'secret unique' });
  assert.equal(room.access.canManage, true);
  for (const password of [undefined, 'wrong']) await assert.rejects(guest.request('join', { name: 'Bob', code: room.code, password }), { code: 'ROOM_PASSWORD_REQUIRED' });
  const joined = await guest.request('join', { name: 'Bob', code: room.code, password: 'secret unique' });
  assert.equal(joined.access.canManage, false); assert.equal(joined.ownerToken, undefined);
  await assert.rejects(guest.request('room-settings', { isPrivate: false, passwordAction: 'remove' }), /gestionnaire/);
  const diskText = await readFile(path.join(f.dataDir, 'rooms.json'), 'utf8'), disk = JSON.parse(diskText);
  assert.match(disk.rooms[0].passwordHash, /^scrypt\$/);
  assert.ok(!diskText.includes('secret unique')); assert.ok(!diskText.includes(room.ownerToken)); assert.ok(!diskText.includes(joined.joinToken));
  const saved = cleanClientState({ rooms: [{ code: room.code, server: f.base, name: room.name, password: 'secret unique', joinToken: joined.joinToken }] });
  assert.equal(saved.rooms[0].joinToken, joined.joinToken); assert.ok(!JSON.stringify(saved).includes('secret unique'));
  await f.server.stop();
  const restarted = createRoomServer({ host: '127.0.0.1', port: 0, dataDir: f.dataDir }); t.after(() => restarted.stop());
  const address = await restarted.start(), base = `http://127.0.0.1:${address.port}`;
  const reconnect = await client(base); assert.equal((await reconnect.request('join', { name: 'Bob', code: room.code, joinToken: joined.joinToken })).code, room.code);
  const creator = await client(base); assert.equal((await creator.request('join', { name: 'Alice', code: room.code, ownerToken: room.ownerToken })).access.canManage, true);
  await assert.rejects(reconnect.request('join', { name: 'Bob', code: room.code, joinToken: joined.joinToken.slice(0, -1) + (joined.joinToken.endsWith('x') ? 'y' : 'x') }), { code: 'ROOM_PASSWORD_REQUIRED' });
});
test('owner can change visibility and password; old sessions, tokens and media are revoked', async t => {
  const f = await fixture(t), owner = await client(f.base), guest = await client(f.base);
  const room = await owner.request('create', { name: 'Alice', roomName: 'Room', isPrivate: false, password: 'old password' });
  const old = await guest.request('join', { name: 'Bob', code: room.code, password: 'old password' });
  const upload = await fetch(f.base + '/api/media', { method: 'POST', headers: { Authorization: `Bearer ${old.token}` }, body: await readFile('public/icon.png') }); const media = await upload.json();
  const closed = once(guest.ws, 'close');
  const updated = await owner.request('room-settings', { isPrivate: true, passwordAction: 'set', password: 'new password' }); await closed;
  assert.equal(updated.access.isPrivate, true); assert.equal(updated.access.passwordRequired, true);
  assert.deepEqual((await (await fetch(f.base + '/api/rooms')).json()).rooms, []);
  assert.equal((await fetch(f.base + media.url)).status, 404);
  assert.equal((await fetch(f.base + '/api/media', { method: 'POST', headers: { Authorization: `Bearer ${old.token}` }, body: 'x' })).status, 401);
  const reconnect = await client(f.base);
  for (const credentials of [{ password: 'old password' }, { joinToken: old.joinToken }]) await assert.rejects(reconnect.request('join', { name: 'Bob', code: room.code, ...credentials }), { code: 'ROOM_PASSWORD_REQUIRED' });
  assert.equal((await reconnect.request('join', { name: 'Bob', code: room.code, password: 'new password' })).code, room.code);
  await owner.request('room-settings', { isPrivate: false, passwordAction: 'remove' });
  const fresh = await client(f.base); assert.equal((await fresh.request('join', { name: 'Chloé', code: room.code })).access.passwordRequired, false);
});
test('old rooms keep their code, stay private, and can explicitly acquire a manager', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'memeroom-migrate-'));
  await writeFile(path.join(dataDir, 'rooms.json'), JSON.stringify({ version: 1, rooms: [{ code: 'ABCDEFGH', name: 'Amis' }] }));
  const f = await fixture(t, { dataDir }), first = await client(f.base), other = await client(f.base);
  const room = await first.request('join', { name: 'Alice', code: 'ABCDEFGH' }); await other.request('join', { name: 'Bob', code: room.code });
  assert.equal(room.access.unclaimed, true); assert.deepEqual((await (await fetch(f.base + '/api/rooms')).json()).rooms, []);
  const claimed = await first.request('room-settings', { isPrivate: true, passwordAction: 'keep' }); assert.ok(claimed.ownerToken);
  await assert.rejects(other.request('room-settings', { isPrivate: false, passwordAction: 'keep' }), /gestionnaire/);
  const disk = JSON.parse(await readFile(path.join(dataDir, 'rooms.json'), 'utf8')); assert.equal(disk.version, 2); assert.equal(disk.rooms[0].code, room.code);
});
test('room protection limits guessing and rejects oversized passwords', async t => {
  const f = await fixture(t), owner = await client(f.base), guest = await client(f.base);
  await assert.rejects(owner.request('create', { name: 'Alice', password: 'x'.repeat(129) }), /128/);
  const room = await owner.request('create', { name: 'Alice', password: 'actual password' });
  for (let i = 0; i < 5; i++) await assert.rejects(guest.request('join', { name: 'Bob', code: room.code }), { code: 'ROOM_PASSWORD_REQUIRED' });
  await assert.rejects(guest.request('join', { name: 'Bob', code: room.code, password: 'guess' }), /Trop de mots de passe/);
  assert.equal((await owner.request('join', { name: 'Alice', code: room.code, ownerToken: room.ownerToken })).access.canManage, true);
});
