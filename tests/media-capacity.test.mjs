import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { makeMediaSpace } from '../server/media-capacity.mjs';
import { createRoomServer } from '../server/index.mjs';

test('room and global byte limits evict as many oldest uploads as needed', () => {
  const a = { code:'a', bytes:6, media:new Map() }, b = { code:'b', bytes:6, media:new Map() }, c = { code:'c', bytes:0, media:new Map() };
  const rooms = new Map([['a',a],['b',b],['c',c]]), media = new Map();
  for (const [id, room] of [['a1',a],['b1',b],['a2',a],['b2',b]]) { const item = { id, bytes:3, roomCode:room.code }; room.media.set(id,item); media.set(id,item); }
  const limits = { mediaCount:30, roomBytes:10, totalBytes:12 };
  const space = makeMediaSpace(c, rooms, media, 5, 12, limits);
  assert.deepEqual([...media.keys()], ['a2','b2']); assert.equal(space.totalBytes, 6);
  assert.equal(a.bytes, 3); assert.equal(b.bytes, 3); assert.deepEqual([...space.changed], [a,b]);
  const local = makeMediaSpace(a, rooms, media, 8, space.totalBytes, limits);
  assert.equal(a.media.size, 0); assert.equal(a.bytes, 0); assert.equal(local.totalBytes, 3);
});

test('the 31st valid upload replaces the oldest; an invalid upload never deletes anything', async t => {
  const server = createRoomServer({ host:'127.0.0.1', port:0, dataDir:null });
  const address = await server.start(); t.after(() => server.stop());
  const base = `http://127.0.0.1:${address.port}`;
  const ws = new WebSocket(base.replace('http:','ws:') + '/ws'); await once(ws,'open');
  const reply = once(ws,'message'); ws.send(JSON.stringify({ id:'create', type:'create', data:{ name:'Test' } }));
  const { data:room } = JSON.parse((await reply)[0]);
  const bytes = await readFile(new URL('../public/icon.png', import.meta.url));
  const upload = body => fetch(base + '/api/media', { method:'POST', headers:{ Authorization:`Bearer ${room.token}` }, body });
  const files = [];
  for (let i=0; i<30; i++) { const response = await upload(bytes); assert.equal(response.status,201); files.push(await response.json()); }
  assert.equal((await upload('invalid file')).status,415);
  assert.equal((await fetch(base + files[0].url)).status,200);
  const response = await upload(bytes); assert.equal(response.status,201); const latest = await response.json();
  assert.equal((await fetch(base + files[0].url)).status,404);
  assert.equal((await fetch(base + files[1].url)).status,200);
  assert.equal((await fetch(base + latest.url)).status,200);
});
