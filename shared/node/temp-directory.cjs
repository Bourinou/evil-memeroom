const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

async function createTempDirectory(prefix, { root = os.tmpdir(), isAlive = processAlive } = {}) {
  if (!/^memeroom-[a-z-]+-$/.test(prefix)) throw new Error('Le préfixe temporaire est invalide.');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.realpath(root);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      !entry.name.startsWith(prefix) ||
      !/^[a-zA-Z0-9]{6}$/.test(entry.name.slice(prefix.length))
    )
      continue;
    const candidate = path.join(directory, entry.name);
    try {
      const marker = path.join(candidate, '.owner.json');
      const info = await fs.lstat(marker);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1024) continue;
      const owner = JSON.parse(await fs.readFile(marker, 'utf8'));
      if (
        owner.version !== 1 ||
        owner.prefix !== prefix ||
        !Number.isSafeInteger(owner.pid) ||
        owner.pid <= 0 ||
        isAlive(owner.pid)
      )
        continue;
      // Only direct children with our marker and a dead owner are reclaimed.
      await fs.rm(candidate, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code) && !(error instanceof SyntaxError))
        console.warn('Nettoyage temporaire différé :', error.code || 'INVALID_OWNER');
    }
  }
  const result = await fs.mkdtemp(path.join(directory, prefix));
  try {
    await fs.writeFile(
      path.join(result, '.owner.json'),
      JSON.stringify({ version: 1, prefix, pid: process.pid }),
      { flag: 'wx', mode: 0o600 },
    );
    return result;
  } catch (error) {
    await fs.rm(result, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { createTempDirectory };
