import test from 'node:test';
import assert from 'node:assert/strict';
import { Connection, isNetworkError } from '../desktop/renderer/connection.mjs';
import { roomFixture } from './helpers/room.mjs';

test('les erreurs réseau portent un code indépendant du texte et les erreurs métier restent distinctes', async (t) => {
  const fixture = await roomFixture(t);
  const connection = new Connection(
    fixture.base,
    () => {},
    () => {},
  );
  t.after(() => connection.close());
  await connection.open();
  await assert.rejects(connection.request('unknown-action'), (error) => !isNetworkError(error));
  connection.close();
  await assert.rejects(connection.request('ping'), (error) => {
    assert.equal(error.code, 'NETWORK_DISCONNECTED');
    error.message = 'Text can change';
    return isNetworkError(error);
  });
});
