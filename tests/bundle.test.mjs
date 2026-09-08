import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('file-based Electron windows reference existing bundled scripts and styles', async () => {
  for (const name of ['overlay', 'update']) {
    const page = new URL(`../desktop/${name}.html`, import.meta.url);
    const html = await readFile(page, 'utf8');
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      assert.ok((await readFile(new URL(match[1], page))).length > 0, fileURLToPath(page));
    }
  }
});
