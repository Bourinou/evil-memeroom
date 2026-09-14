import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  mergeDirectorySync,
  migrateMemesDir,
  migrateUserData,
  migrateUserDataHashes,
  cleanupLegacyFolders
} from '../desktop/migration.cjs';
import * as protocol from '../shared/protocol.mjs';

test('migration moves memes from ~/memeroom to ~/evil-memeroom and removes old folder', async t => {
  const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'evil-memeroom-home-'));
  t.after(() => rm(fakeHome, { recursive: true, force: true }));

  const oldMemes = path.join(fakeHome, 'memeroom');
  const newMemes = path.join(fakeHome, 'evil-memeroom');

  await mkdir(oldMemes, { recursive: true });
  await writeFile(path.join(oldMemes, 'meme1.png'), 'png-bytes-1');
  await writeFile(path.join(oldMemes, 'meme2.mp4'), 'mp4-bytes-2');

  migrateMemesDir(fakeHome);

  assert.equal(existsSync(oldMemes), false, 'Old ~/memeroom folder must be deleted');
  assert.equal(existsSync(newMemes), true, 'New ~/evil-memeroom folder must exist');
  assert.equal(await readFile(path.join(newMemes, 'meme1.png'), 'utf8'), 'png-bytes-1');
  assert.equal(await readFile(path.join(newMemes, 'meme2.mp4'), 'utf8'), 'mp4-bytes-2');
});

test('migration merges memes when ~/evil-memeroom already exists without losing files', async t => {
  const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'evil-memeroom-home-merge-'));
  t.after(() => rm(fakeHome, { recursive: true, force: true }));

  const oldMemes = path.join(fakeHome, 'memeroom');
  const newMemes = path.join(fakeHome, 'evil-memeroom');

  await mkdir(oldMemes, { recursive: true });
  await mkdir(newMemes, { recursive: true });

  await writeFile(path.join(oldMemes, 'legacy.png'), 'legacy-content');
  await writeFile(path.join(newMemes, 'existing.png'), 'existing-content');

  migrateMemesDir(fakeHome);

  assert.equal(existsSync(oldMemes), false, 'Old ~/memeroom folder must be deleted');
  assert.equal(await readFile(path.join(newMemes, 'legacy.png'), 'utf8'), 'legacy-content');
  assert.equal(await readFile(path.join(newMemes, 'existing.png'), 'utf8'), 'existing-content');
});

test('migration moves userData from memeroom to evil-memeroom and removes legacy dir', async t => {
  const fakeAppData = await mkdtemp(path.join(os.tmpdir(), 'evil-memeroom-appdata-'));
  t.after(() => rm(fakeAppData, { recursive: true, force: true }));

  const legacyUserDir = path.join(fakeAppData, 'memeroom');
  const targetUserDir = path.join(fakeAppData, 'evil-memeroom');

  await mkdir(path.join(legacyUserDir, 'saved-messages', 'preset-1'), { recursive: true });
  await writeFile(path.join(legacyUserDir, 'saved-messages', 'preset-1', 'message.json'), JSON.stringify({ name: 'favorite' }));
  await writeFile(path.join(legacyUserDir, 'preferences.json'), JSON.stringify({ volume: 42 }));
  await writeFile(path.join(legacyUserDir, 'saved-rooms.json'), JSON.stringify({ rooms: [{ code: 'ABCD1234', name: 'Test' }] }));
  await writeFile(path.join(legacyUserDir, 'memeroom-hashes.json'), JSON.stringify({ 'meme.png': { hash: '123' } }));

  migrateUserData(fakeAppData, 'evil-memeroom');
  migrateUserDataHashes(targetUserDir);

  assert.equal(existsSync(legacyUserDir), false, 'Legacy memeroom directory must be deleted');
  assert.equal(existsSync(targetUserDir), true, 'Target evil-memeroom directory must exist');

  const prefs = JSON.parse(await readFile(path.join(targetUserDir, 'preferences.json'), 'utf8'));
  assert.equal(prefs.volume, 42);

  const rooms = JSON.parse(await readFile(path.join(targetUserDir, 'saved-rooms.json'), 'utf8'));
  assert.equal(rooms.rooms[0].code, 'ABCD1234');

  const preset = JSON.parse(await readFile(path.join(targetUserDir, 'saved-messages', 'preset-1', 'message.json'), 'utf8'));
  assert.equal(preset.name, 'favorite');

  assert.equal(existsSync(path.join(targetUserDir, 'memeroom-hashes.json')), false, 'Legacy hash filename must not exist');
  assert.equal(existsSync(path.join(targetUserDir, 'hashes.json')), true, 'New hashes.json must exist');
});

test('migration replaces corrupted destination JSON with valid legacy JSON', async t => {
  const fakeAppData = await mkdtemp(path.join(os.tmpdir(), 'evil-memeroom-corrupt-merge-'));
  t.after(() => rm(fakeAppData, { recursive: true, force: true }));

  const legacyUserDir = path.join(fakeAppData, 'memeroom');
  const targetUserDir = path.join(fakeAppData, 'evil-memeroom');

  await mkdir(legacyUserDir, { recursive: true });
  await mkdir(targetUserDir, { recursive: true });

  // Corrupted saved-rooms.json in target, valid in legacy
  await writeFile(path.join(targetUserDir, 'saved-rooms.json'), "Unexpected token ' invalid json");
  await writeFile(path.join(legacyUserDir, 'saved-rooms.json'), JSON.stringify({ rooms: [{ code: 'VALID123', name: 'Valid' }] }));

  migrateUserData(fakeAppData, 'evil-memeroom');

  assert.equal(existsSync(legacyUserDir), false);
  const recovered = JSON.parse(await readFile(path.join(targetUserDir, 'saved-rooms.json'), 'utf8'));
  assert.equal(recovered.rooms[0].code, 'VALID123');
});

test('corrupted saved-rooms.json recovers to empty state and resets file without crashing', async () => {
  const fakeDir = await mkdtemp(path.join(os.tmpdir(), 'corrupt-client-'));
  const filePath = path.join(fakeDir, 'saved-rooms.json');
  await writeFile(filePath, "Unexpected token '... {not valid json");

  let clientState;
  try {
    const raw = await readFile(filePath, 'utf8');
    clientState = protocol.cleanClientState(JSON.parse(raw));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      await rm(filePath, { force: true }).catch(() => {});
    }
    clientState = null;
  }

  assert.equal(clientState, null, 'Client state must be null after corrupted file recovery');
  assert.equal(existsSync(filePath), false, 'Corrupted file must be removed');
  await rm(fakeDir, { recursive: true, force: true });
});
