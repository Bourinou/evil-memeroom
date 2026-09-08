import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomSession } from '../desktop/renderer/room-session.mjs';

const saved = { code: 'ABCDEFGH', name: 'Room', server: 'http://localhost:3210' };
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function fixture(t, options = {}) {
  const connections = [],
    events = [],
    joined = [];
  const session = createRoomSession({
    identity: () => ({ name: 'Test', desktop: true, paused: false }),
    resolveServer: async (server) => server,
    isSaved: () => true,
    onChange: (reason) => events.push(reason),
    onEvent() {},
    onJoined: async (target) => {
      joined.push(target);
      return true;
    },
    connectionFactory: (_server, onEvent, onClose) => {
      const connection = {
        closed: false,
        skew: 0,
        open: async () => {},
        close() {
          this.closed = true;
        },
        request:
          options.request ||
          (async (_type, value) => ({
            ...saved,
            code: value.code,
            members: [],
            media: [],
            persistent: true,
          })),
        onEvent,
        onClose,
      };
      connections.push(connection);
      return connection;
    },
    ...options,
  });
  t.after(() => session.disconnect());
  return { session, connections, events, joined };
}
test('une ancienne sélection ne revient pas après le démarrage lent de son hébergement', async (t) => {
  const host = deferred();
  const { session, joined } = fixture(t, {
    resolveServer: (server) => (server === 'local' ? host.promise : Promise.resolve(server)),
  });
  const old = session.choose({ ...saved, server: 'local' });
  await session.choose({ ...saved, code: 'BCDEFGHJ' });
  host.resolve('http://localhost:45678');
  await old;
  assert.equal(session.target.code, 'BCDEFGHJ');
  assert.equal(joined.length, 1);
});
test('quitter annule une réponse en vol et toute reconnexion planifiée', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const reply = deferred();
  let requests = 0;
  const { session, joined, connections } = fixture(t, {
    request: async () =>
      ++requests === 1 ? { ...saved, media: [], members: [], persistent: true } : reply.promise,
  });
  await session.choose(saved);
  const retry = session.retry();
  await new Promise((resolve) => setImmediate(resolve));
  session.disconnect();
  reply.resolve({ ...saved, media: [], members: [] });
  await retry;
  const count = connections.length;
  t.mock.timers.tick(30000);
  assert.equal(connections.length, count);
  assert.equal(session.connected, false);
  assert.equal(session.target, null);
  assert.equal(joined.length, 1);
});
test('une coupure se reconnecte, mais une erreur de mot de passe attend une action', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requirePassword = false;
  const { session, connections } = fixture(t, {
    request: async () => {
      if (requirePassword)
        throw Object.assign(new Error('Mot de passe'), { code: 'ROOM_PASSWORD_REQUIRED' });
      return { ...saved, media: [], members: [], persistent: true };
    },
  });
  await session.choose(saved);
  connections[0].onClose();
  assert.equal(session.connected, false);
  t.mock.timers.tick(1000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(connections.length, 2);
  assert.equal(session.connected, true);
  requirePassword = true;
  await assert.rejects(session.retry(), { code: 'ROOM_PASSWORD_REQUIRED' });
  const count = connections.length;
  t.mock.timers.tick(30000);
  assert.equal(connections.length, count);
  assert.equal(session.connected, false);
});
test('les événements et réponses d’une connexion remplacée sont ignorés', async (t) => {
  const received = [];
  const { session, connections } = fixture(t, { onEvent: (value) => received.push(value) });
  await session.choose(saved);
  await session.choose({ ...saved, code: 'BCDEFGHJ' });
  connections[0].onEvent({ type: 'reaction', caption: 'ancien' });
  connections[0].onClose();
  connections[1].onEvent({ type: 'reaction', caption: 'courant' });
  assert.deepEqual(
    received.map((value) => value.caption),
    ['courant'],
  );
  assert.equal(session.connected, true);
});
