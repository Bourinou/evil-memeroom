const path = require('node:path');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const crypto = require('node:crypto');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const VIDEO_EXTS = new Set(['.mp4', '.webm']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg']);

function sanitizeMemeFilename(name) {
  const base = String(name || '').split(/[/\\]/).pop() || '';
  return base
    .replace(/[<>:"/\\|?*\x00-\x1f]/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s+\./g, '.');
}

const EXT_BY_MIME = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/webm': '.webm',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg'
};
const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const MAX_NAME_LENGTH = 120;

let detectMediaPromise;
const getDetectMedia = () => {
  if (!detectMediaPromise) detectMediaPromise = import('../server/media.mjs').then(m => m.detectMedia);
  return detectMediaPromise;
};

// Build a safe filename: the extension is imposed (`ext`), the sender's one is dropped,
// reserved Windows names get a `_` prefix, trailing dots/spaces are removed, length is capped.
// Returns '' when nothing usable remains.
function buildMemeFilename(name, ext) {
  let base = sanitizeMemeFilename(name);
  base = base.slice(0, base.length - path.extname(base).length);
  base = base.replace(/[. ]+$/, '').replace(/^[. ]+/, '');
  if (!base) return '';
  if (RESERVED_NAMES.test(base.split('.')[0])) base = `_${base}`;
  return base.slice(0, MAX_NAME_LENGTH - ext.length).replace(/[. ]+$/, '') + ext;
}

async function readHeader(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(header, 0, 4096, 0);
    return header.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

// Low-RAM streaming hash function (64 KB chunks, only 0.06 MB RAM)
async function hashFileStream(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

// memesDir: folder holding the saved memes; hashCachePath: file path or function returning it
// (the userData folder is only known once main.cjs has set it).
function createSavedMemes({ memesDir, hashCachePath }) {
  const cachePath = () => (typeof hashCachePath === 'function' ? hashCachePath() : hashCachePath);
  const memeHashCache = new Map(); // filename -> { size, mtime, hash }
  const hashToFilename = new Map(); // hash -> filename
  let hashCacheLoaded = false;
  let savingHashCache = Promise.resolve();

  async function loadHashCache() {
    if (hashCacheLoaded) return;
    try {
      const raw = await fs.readFile(cachePath(), 'utf8');
      const data = JSON.parse(raw);
      for (const [filename, info] of Object.entries(data)) {
        if (info && info.hash) {
          memeHashCache.set(filename, info);
          hashToFilename.set(info.hash, filename);
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        await fs.rm(cachePath(), { force: true }).catch(() => {});
      }
    }
    hashCacheLoaded = true;
  }

  function persistHashCache() {
    const data = {};
    for (const [filename, info] of memeHashCache) {
      data[filename] = info;
    }
    const snapshot = JSON.stringify(data, null, 2);
    savingHashCache = savingHashCache.catch(() => {}).then(async () => {
      try {
        await fs.mkdir(path.dirname(cachePath()), { recursive: true });
        await fs.writeFile(cachePath() + '.tmp', snapshot, 'utf8');
        await fs.rename(cachePath() + '.tmp', cachePath());
      } catch {}
    });
  }

  // Sync in-memory hash cache with the memes directory:
  // Only hashes new or modified files. Existing files are NEVER re-hashed!
  async function syncHashCache(entries) {
    await loadHashCache();
    await fs.mkdir(memesDir, { recursive: true });
    entries = entries || await fs.readdir(memesDir, { withFileTypes: true });
    const presentFiles = new Set();
    let modified = false;

    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      presentFiles.add(entry.name);
      try {
        const fullPath = path.join(memesDir, entry.name);
        const stat = await fs.stat(fullPath);
        const cached = memeHashCache.get(entry.name);
        if (!cached || cached.size !== stat.size || cached.mtime !== stat.mtimeMs) {
          const hash = await hashFileStream(fullPath);
          memeHashCache.set(entry.name, { size: stat.size, mtime: stat.mtimeMs, hash });
          hashToFilename.set(hash, entry.name);
          modified = true;
        }
      } catch {}
    }

    // Remove entries for deleted files
    for (const [filename, info] of memeHashCache) {
      if (!presentFiles.has(filename)) {
        memeHashCache.delete(filename);
        if (hashToFilename.get(info.hash) === filename) {
          hashToFilename.delete(info.hash);
        }
        modified = true;
      }
    }

    if (modified) persistHashCache();
  }

  // Full folder scan only once; afterwards save/rename/remove update the cache and list() resyncs.
  let initialSync;
  const ensureSynced = () => (initialSync ||= syncHashCache().catch(error => { initialSync = null; throw error; }));

  async function save(sourceFile, originalName) {
    await ensureSynced();
    const sourceStat = await fs.stat(sourceFile);
    if (!sourceStat.isFile() || sourceStat.size === 0) return null;

    // The extension comes from the detected format, never from the sender's name.
    const format = (await getDetectMedia())(await readHeader(sourceFile));
    const ext = format && EXT_BY_MIME[format.mime];
    if (!ext) return { saved: false, reason: 'unsupported' };

    // Stream-hash incoming file in 64 KB chunks
    const sourceHash = await hashFileStream(sourceFile);

    // O(1) in-memory lookup without touching any existing files on disk!
    if (hashToFilename.has(sourceHash)) {
      const existingName = hashToFilename.get(sourceHash);
      try {
        await fs.access(path.join(memesDir, existingName));
        return { saved: false, reason: 'duplicate', name: existingName };
      } catch {
        hashToFilename.delete(sourceHash);
        memeHashCache.delete(existingName);
      }
    }

    const cleanName = buildMemeFilename(originalName, ext) || `meme_${Date.now()}${ext}`;
    const stem = cleanName.slice(0, cleanName.length - ext.length);
    const taken = new Set([...memeHashCache.keys()].map(n => n.toLowerCase()));
    let finalName = cleanName;
    let counter = 1;
    while (taken.has(finalName.toLowerCase()) || await fs.access(path.join(memesDir, finalName)).then(() => true, () => false)) {
      finalName = `${stem} ${counter}${ext}`;
      counter++;
    }

    const destPath = path.join(memesDir, finalName);
    await fs.copyFile(sourceFile, destPath);
    const destStat = await fs.stat(destPath);

    memeHashCache.set(finalName, { size: destStat.size, mtime: destStat.mtimeMs, hash: sourceHash });
    hashToFilename.set(sourceHash, finalName);
    persistHashCache();

    return { saved: true, name: finalName };
  }

  async function list() {
    await fs.mkdir(memesDir, { recursive: true });
    const entries = await fs.readdir(memesDir, { withFileTypes: true });
    await syncHashCache(entries);
    const eligible = entries.filter(entry => entry.isFile() && !entry.name.startsWith('.') && !entry.name.startsWith('silent_'));
    const items = (await Promise.all(eligible.map(async entry => {
      const ext = path.extname(entry.name).toLowerCase();
      let kind = 'other';
      if (IMAGE_EXTS.has(ext)) kind = 'image';
      else if (VIDEO_EXTS.has(ext)) kind = 'video';
      else if (AUDIO_EXTS.has(ext)) kind = 'audio';
      try {
        const stat = await fs.stat(path.join(memesDir, entry.name));
        return {
          name: entry.name,
          size: stat.size,
          mtime: stat.mtimeMs,
          kind,
          url: `/saved-memes/${encodeURIComponent(entry.name)}`
        };
      } catch {
        return null;
      }
    }))).filter(Boolean);
    items.sort((a, b) => b.mtime - a.mtime);
    return items;
  }

  async function rename(oldName, newName) {
    const safeOld = path.basename(oldName);
    // The extension never changes on rename; same name rules as save.
    const safeNew = buildMemeFilename(newName, path.extname(safeOld));
    if (!safeNew) throw new Error('Nom invalide.');
    if (safeOld === safeNew) return safeNew;
    const oldPath = path.join(memesDir, safeOld);
    const newPath = path.join(memesDir, safeNew);
    try {
      await fs.access(newPath);
      throw new Error(`Un fichier nommé « ${safeNew} » existe déjà.`);
    } catch (e) {
      if (e.message.includes('existe déjà')) throw e;
    }
    await fs.rename(oldPath, newPath);
    if (memeHashCache.has(safeOld)) {
      const info = memeHashCache.get(safeOld);
      memeHashCache.delete(safeOld);
      memeHashCache.set(safeNew, info);
      hashToFilename.set(info.hash, safeNew);
      persistHashCache();
    }
    return safeNew;
  }

  async function remove(name) {
    const safeName = path.basename(name);
    await fs.rm(path.join(memesDir, safeName), { force: true });
    if (memeHashCache.has(safeName)) {
      const info = memeHashCache.get(safeName);
      memeHashCache.delete(safeName);
      if (hashToFilename.get(info.hash) === safeName) {
        hashToFilename.delete(info.hash);
      }
      persistHashCache();
    }
    return true;
  }

  async function read(name) {
    const safeName = path.basename(name);
    const buf = await fs.readFile(path.join(memesDir, safeName));
    return { name: safeName, bytes: buf.byteLength, buffer: buf };
  }

  const pathFor = name => path.join(memesDir, path.basename(name));

  return { sanitizeFilename: sanitizeMemeFilename, save, list, rename, remove, read, pathFor };
}

module.exports = { createSavedMemes, sanitizeMemeFilename };
