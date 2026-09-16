import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSemver, isNewerVersion, selectMacAsset, MacGithubUpdater } from '../desktop/mac-updater.cjs';

test('parseSemver and isNewerVersion compare release tags correctly', () => {
  assert.deepEqual(parseSemver('0.6.2'), [0, 6, 2]);
  assert.deepEqual(parseSemver('v0.6.2'), [0, 6, 2]);
  assert.deepEqual(parseSemver('v1.0.0-beta.1'), [1, 0, 0]);

  assert.equal(isNewerVersion('0.6.3', '0.6.2'), true);
  assert.equal(isNewerVersion('v0.6.3', '0.6.2'), true);
  assert.equal(isNewerVersion('0.7.0', '0.6.2'), true);
  assert.equal(isNewerVersion('1.0.0', '0.6.2'), true);

  assert.equal(isNewerVersion('0.6.2', '0.6.2'), false);
  assert.equal(isNewerVersion('v0.6.2', '0.6.2'), false);
  assert.equal(isNewerVersion('0.6.1', '0.6.2'), false);
  assert.equal(isNewerVersion('0.5.9', '0.6.2'), false);
});

test('selectMacAsset chooses the matching zip asset for the CPU architecture', () => {
  const assets = [
    { name: 'evil-memeroom-0.6.3-Linux-amd64.deb', browser_download_url: 'https://example.com/deb' },
    { name: 'evil-memeroom-0.6.3-Linux-x86_64.AppImage', browser_download_url: 'https://example.com/appimage' },
    { name: 'evil-memeroom-Setup-0.6.3.exe', browser_download_url: 'https://example.com/exe' },
    { name: 'evil-memeroom-0.6.3-Mac-arm64.dmg', browser_download_url: 'https://example.com/dmg-arm' },
    { name: 'evil-memeroom-0.6.3-Mac-arm64.zip', browser_download_url: 'https://example.com/zip-arm' },
    { name: 'evil-memeroom-0.6.3-Mac-x64.dmg', browser_download_url: 'https://example.com/dmg-x64' },
    { name: 'evil-memeroom-0.6.3-Mac-x64.zip', browser_download_url: 'https://example.com/zip-x64' },
    { name: 'latest.yml', browser_download_url: 'https://example.com/yml' }
  ];

  const arm64 = selectMacAsset(assets, 'arm64');
  assert.ok(arm64);
  assert.equal(arm64.name, 'evil-memeroom-0.6.3-Mac-arm64.zip');
  assert.equal(arm64.browser_download_url, 'https://example.com/zip-arm');

  const x64 = selectMacAsset(assets, 'x64');
  assert.ok(x64);
  assert.equal(x64.name, 'evil-memeroom-0.6.3-Mac-x64.zip');
  assert.equal(x64.browser_download_url, 'https://example.com/zip-x64');
});

test('MacGithubUpdater detects available updates and handles download stream', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (url.includes('/releases/latest')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tag_name: 'v0.9.0',
            assets: [
              {
                name: 'evil-memeroom-0.9.0-Mac-arm64.zip',
                browser_download_url: 'https://example.com/download.zip',
                size: 20
              }
            ]
          })
        };
      }
      if (url === 'https://example.com/download.zip') {
        const chunk = Buffer.from('mock-zip-binary-data');
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-length': String(chunk.length) }),
          body: {
            getReader() {
              let sent = false;
              return {
                async read() {
                  if (sent) return { done: true, value: undefined };
                  sent = true;
                  return { done: false, value: chunk };
                }
              };
            }
          }
        };
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    const updater = new MacGithubUpdater({
      owner: 'Bourinou',
      repo: 'evil-memeroom',
      app: { getVersion: () => '0.6.2' },
      arch: 'arm64'
    });

    const check = await updater.checkForUpdates();
    assert.equal(check.isUpdateAvailable, true);
    assert.equal(check.updateInfo.version, '0.9.0');
    assert.equal(check.updateInfo.asset.name, 'evil-memeroom-0.9.0-Mac-arm64.zip');

    let progressEvents = [];
    updater.on('download-progress', p => progressEvents.push(p));

    const paths = await updater.downloadUpdate();
    assert.equal(paths.length, 1);
    assert.ok(paths[0].endsWith('.zip'));
    assert.ok(progressEvents.length > 0);
    assert.equal(progressEvents.at(-1).percent, 100);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('MacGithubUpdater reports no update when version is equal or older', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v0.6.2',
        assets: []
      })
    });

    const updater = new MacGithubUpdater({
      owner: 'Bourinou',
      repo: 'evil-memeroom',
      app: { getVersion: () => '0.6.2' }
    });

    const check = await updater.checkForUpdates();
    assert.equal(check.isUpdateAvailable, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
