import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { client, roomFixture } from './helpers/room.mjs';
import { secret, digest } from '../server/room-access.mjs';

test('administration is opt-in and requires a separate secret even for local requests', async (t) => {
  const adminToken = secret();
  const f = await roomFixture(t, { adminToken });
  const owner = await client(f.base);
  const room = await owner.request('create', { name: 'Owner', roomName: 'Private' });
  const url = f.base + '/api/admin/rooms';
  assert.equal((await fetch(url)).status, 403);
  assert.equal(
    (await fetch(url, { headers: { Authorization: `Bearer ${room.token}` } })).status,
    403,
  );
  const headers = { Authorization: `Bearer ${adminToken}` };
  const list = await (await fetch(url, { headers })).json();
  assert.deepEqual(list.rooms, [{ code: room.code, name: 'Private', members: 1 }]);
  assert.equal((await fetch(url + '/' + room.code, { headers, method: 'DELETE' })).status, 200);
  await f.restart();
  assert.deepEqual(
    (await (await fetch(url.replace(new URL(url).origin, f.base), { headers })).json()).rooms,
    [],
  );
  const disabled = await roomFixture(t);
  assert.equal((await fetch(disabled.base + '/api/admin/rooms', { headers })).status, 404);
});

test('only the owner can explicitly delete a room; sessions and media are revoked permanently', async (t) => {
  const f = await roomFixture(t);
  const owner = await client(f.base),
    member = await client(f.base);
  const room = await owner.request('create', { name: 'Owner', password: 'private password' });
  await member.request('join', { code: room.code, name: 'Member', password: 'private password' });
  const upload = await fetch(f.base + '/api/media', {
    method: 'POST',
    headers: { Authorization: `Bearer ${room.token}` },
    body: await readFile('public/icon.png'),
  });
  const asset = await upload.json();
  await assert.rejects(member.request('room-delete', { code: room.code }), /gestionnaire/);
  await assert.rejects(owner.request('room-delete', { code: 'WRONG' }), /code/);
  const memberClosed = once(member.ws, 'close');
  assert.deepEqual(await owner.request('room-delete', { code: room.code }), { deleted: room.code });
  await memberClosed;
  assert.ok(member.events.some((event) => event.type === 'room-deleted'));
  assert.equal((await fetch(f.base + asset.url)).status, 404);
  assert.equal(
    (
      await fetch(f.base + '/api/media', {
        method: 'POST',
        headers: { Authorization: `Bearer ${room.token}` },
        body: 'x',
      })
    ).status,
    401,
  );
  await f.restart();
  const newcomer = await client(f.base);
  await assert.rejects(newcomer.request('join', { code: room.code, name: 'New' }), /introuvable/);
});

test('deleting a persistent room frees capacity after a restart without expiring the other rooms', async (t) => {
  const f = await roomFixture(t, { emptyRoomTtlMs: 20 });
  await f.server.stop();
  const ownerToken = secret(),
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rooms = Array.from({ length: 100 }, (_, i) => ({
    code: `AAAAAA${alphabet[Math.floor(i / 32)]}${alphabet[i % 32]}`,
    name: `Room ${i}`,
    isPrivate: true,
    passwordHash: null,
    ownerHash: digest(ownerToken),
    accessKey: secret(),
  }));
  await writeFile(path.join(f.directory, 'rooms.json'), JSON.stringify({ version: 2, rooms }));
  await f.restart();
  const owner = await client(f.base);
  await assert.rejects(owner.request('create', { name: 'Owner' }), /plein/);
  await owner.request('join', { code: rooms[0].code, name: 'Owner', ownerToken });
  await owner.request('room-delete', { code: rooms[0].code });
  await f.restart();
  const next = await client(f.base);
  await next.request('create', { name: 'New' });
  const disk = JSON.parse(await readFile(path.join(f.directory, 'rooms.json'), 'utf8'));
  assert.equal(disk.rooms.length, 100);
  assert.ok(disk.rooms.some((room) => room.code === rooms[1].code));
  assert.ok(!disk.rooms.some((room) => room.code === rooms[0].code));
});

test('a failed persistent deletion keeps the room and its sessions usable', async (t) => {
  const f = await roomFixture(t, { cooldownMs: 0 });
  const owner = await client(f.base);
  const room = await owner.request('create', { name: 'Owner' });
  // A directory at the atomic write target causes persistence to fail.
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(f.directory, 'rooms.json.tmp'));
  await assert.rejects(owner.request('room-delete', { code: room.code }), /enregistrer|supprimer/);
  await owner.request('broadcast', { caption: 'Still here', duration: 2 });
  assert.equal(
    JSON.parse(await readFile(path.join(f.directory, 'rooms.json'), 'utf8')).rooms.length,
    1,
  );
});
