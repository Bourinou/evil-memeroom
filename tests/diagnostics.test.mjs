import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnostics } from '../server/diagnostics.mjs';
import { createAdminHandler } from '../server/admin-api.mjs';
import { randomBytes } from 'node:crypto';

test('les diagnostics comptent les erreurs sans secrets et limitent les répétitions', () => {
  const lines = [];
  let now = 0;
  const log = createDiagnostics({ write: (line) => lines.push(line), now: () => now });
  const failure = Object.assign(new Error('private token or path'), { code: 'EACCES' });
  for (let i = 0; i < 20; i++) log.error('http', failure);
  assert.equal(lines.length, 1);
  assert.equal(log.snapshot().http, 20);
  assert.equal(lines[0].includes('private'), false);
  now = 10001;
  log.error('http', failure);
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).count, 21);
});
test('les statistiques administratives refusent le réseau externe et les origines web', () => {
  const adminToken = randomBytes(32).toString('base64url');
  const handle = createAdminHandler({
    adminToken,
    rooms: new Map(),
    deleteRoom() {},
    stats: () => ({ rooms: 0, mediaBytes: 0 }),
    json: (response, status, value) => Object.assign(response, { status, value }),
  });
  for (const [remoteAddress, origin, expected, forwarded] of [
    ['127.0.0.1', undefined, 200],
    ['192.168.1.9', undefined, 403],
    ['127.0.0.1', 'http://localhost', 403],
    ['127.0.0.1', undefined, 403, '198.51.100.20'],
  ]) {
    const response = {};
    assert.equal(
      handle(
        {
          method: 'GET',
          socket: { remoteAddress },
          headers: { authorization: `Bearer ${adminToken}`, origin, 'x-forwarded-for': forwarded },
        },
        response,
        new URL('http://localhost/api/admin/status'),
      ),
      true,
    );
    assert.equal(response.status, expected);
    assert.equal(JSON.stringify(response).includes(adminToken), false);
  }
});
