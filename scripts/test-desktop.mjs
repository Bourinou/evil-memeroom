import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const focused = process.argv.includes('--focused');
const scenarios = focused
  ? [['tests/updates-050.e2e.mjs'], ['tests/shortcut.e2e.mjs']]
  : ['appearance', 'playback', 'rooms'].map((name) => ['tests/desktop.e2e.mjs', name]);
const passed = [],
  failed = [];
for (const args of scenarios) {
  const label = args[1] || args[0];
  console.log(`\nScénario : ${label}`);
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    windowsHide: true,
    timeout: 240000,
  });
  if (result.error || result.status !== 0) {
    failed.push(label);
    if (result.error) console.error(result.error.message);
  } else if (!focused) {
    const report = JSON.parse(
      await readFile(path.join('.test-artifacts', `desktop-${label}-results.json`), 'utf8'),
    );
    passed.push(...report.passed);
  }
}
if (!focused) {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  await mkdir('.test-artifacts', { recursive: true });
  await writeFile(
    path.join(
      '.test-artifacts',
      process.env.MEMEROOM_TEST_EXE ? 'packaged-results.json' : 'desktop-results.json',
    ),
    JSON.stringify({ version, passed, failed, date: new Date().toISOString() }, null, 2),
  );
}
if (failed.length) {
  console.error('Scénarios en échec :', failed.join(', '));
  process.exitCode = 1;
}
