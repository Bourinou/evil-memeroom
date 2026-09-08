import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalHost } from '../desktop/local-host.cjs';

test('consulter les informations ne démarre rien ; les demandes concurrentes partagent le serveur', async () => {
  let starts = 0,
    stops = 0,
    factories = 0;
  const host = createLocalHost({
    port: 3210,
    interfaces: () => ({}),
    createServer: async () => {
      factories++;
      return {
        start: async () => {
          starts++;
          return { port: 3210 };
        },
        stop: async () => {
          stops++;
        },
      };
    },
  });
  assert.equal(host.info().hosting, false);
  assert.equal(factories, 0);
  const [first, second] = await Promise.all([host.ensure(), host.ensure()]);
  assert.equal(first.server, second.server);
  assert.equal(host.info().hosting, true);
  assert.equal(starts, 1);
  await host.stop();
  assert.equal(stops, 1);
});
test('un port occupé alloue un port libre et recalcule les adresses LAN', async () => {
  const ports = [],
    stopped = [];
  const host = createLocalHost({
    port: 3210,
    interfaces: () => ({
      ethernet: [{ family: 'IPv4', internal: false, address: '192.168.1.10' }],
    }),
    createServer: async ({ port }) => {
      ports.push(port);
      return {
        start: async () => {
          if (port === 3210) throw Object.assign(new Error('used'), { code: 'EADDRINUSE' });
          return { port: 45678 };
        },
        stop: async () => stopped.push(port),
      };
    },
  });
  const info = await host.ensure();
  assert.deepEqual(ports, [3210, 0]);
  assert.deepEqual(stopped, [3210]);
  assert.equal(info.server, 'http://127.0.0.1:45678');
  assert.deepEqual(info.addresses, ['http://192.168.1.10:45678']);
  await host.stop();
});
test('arrêter pendant le démarrage attend aussi le serveur tardif', async () => {
  let complete,
    stopped = 0;
  const host = createLocalHost({
    createServer: async () => ({
      start: () =>
        new Promise((resolve) => {
          complete = () => resolve({ port: 3210 });
        }),
      stop: async () => stopped++,
    }),
  });
  const pending = host.ensure();
  await new Promise((resolve) => setImmediate(resolve));
  const stopping = host.stop();
  complete();
  await Promise.all([pending, stopping]);
  assert.equal(stopped, 1);
  await assert.rejects(host.ensure(), /arrêt/);
});
