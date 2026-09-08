import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runStartupUpdate } from '../desktop/startup-update.cjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function fixture() {
  const updater = new EventEmitter(),
    controller = new AbortController(),
    statuses = [];
  let downloads = 0,
    installs = 0,
    cancels = 0;
  updater.checkForUpdates = async () => ({
    isUpdateAvailable: true,
    cancellationToken: {
      cancel() {
        cancels++;
      },
    },
  });
  updater.downloadUpdate = async () => {
    downloads++;
    return ['verified-installer'];
  };
  const run = (options) =>
    runStartupUpdate({
      updater,
      signal: controller.signal,
      status: (value) => statuses.push(value),
      install: async () => {
        installs++;
      },
      checkTimeoutMs: 100,
      stallTimeoutMs: 100,
      ...options,
    });
  return { updater, controller, statuses, run, counts: () => ({ downloads, installs, cancels }) };
}
test('startup checks and installs only after the verified download completes', async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { installed: true });
  assert.deepEqual(f.counts(), { downloads: 1, installs: 1, cancels: 0 });
  assert.deepEqual(
    f.statuses.map((s) => s.phase),
    ['checking', 'downloading', 'installing'],
  );
  assert.equal(f.updater.autoDownload, false);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updater.allowDowngrade, false);
});
test('up-to-date and offline launches continue without an installation', async () => {
  for (const check of [
    async () => ({ isUpdateAvailable: false }),
    async () => {
      throw new Error('offline');
    },
  ]) {
    const f = fixture();
    f.updater.checkForUpdates = check;
    assert.equal((await f.run()).installed, false);
    assert.deepEqual(f.counts(), { downloads: 0, installs: 0, cancels: 0 });
  }
});
test('late check results after timeout or skip never download in an active app', async () => {
  for (const skip of [false, true]) {
    const f = fixture();
    f.updater.checkForUpdates = async () => {
      await delay(60);
      return { isUpdateAvailable: true };
    };
    if (skip) setTimeout(() => f.controller.abort(), 10);
    assert.equal((await f.run({ checkTimeoutMs: 20 })).installed, false);
    await delay(80);
    assert.equal(f.counts().downloads, 0);
    assert.equal(f.counts().installs, 0);
  }
});
test('skip and a stalled download cancel the transfer without installing', async () => {
  for (const skip of [false, true]) {
    const f = fixture();
    f.updater.downloadUpdate = async () => {
      await delay(70);
    };
    if (skip) setTimeout(() => f.controller.abort(), 10);
    assert.equal((await f.run({ stallTimeoutMs: 20 })).installed, false);
    await delay(80);
    assert.equal(f.counts().cancels, 1);
    assert.equal(f.counts().installs, 0);
  }
});
test('an advancing transfer can last longer than the stall timeout', async () => {
  const f = fixture();
  f.updater.downloadUpdate = async () => {
    for (let percent = 10; percent <= 100; percent += 10) {
      await delay(15);
      f.updater.emit('download-progress', { percent });
    }
  };
  assert.equal((await f.run({ stallTimeoutMs: 80 })).installed, true);
  assert.equal(f.statuses.at(-2).percent, 100);
});
test('corrupt downloads and install failures fall back to opening the app', async () => {
  const f = fixture();
  f.updater.downloadUpdate = async () => {
    const error = new Error('checksum mismatch');
    f.updater.emit('error', error);
    throw error;
  };
  assert.match((await f.run()).error, /checksum/);
  assert.equal(f.counts().installs, 0);
  const other = fixture();
  assert.equal(
    (
      await other.run({
        install: async () => {
          throw new Error('installer failed');
        },
      })
    ).installed,
    false,
  );
});
