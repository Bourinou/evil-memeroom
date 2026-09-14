const path = require('node:path');
const fsSync = require('node:fs');
const os = require('node:os');

function mergeDirectorySync(src, dest) {
  if (!fsSync.existsSync(dest)) {
    fsSync.mkdirSync(dest, { recursive: true });
  }
  const entries = fsSync.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      mergeDirectorySync(srcPath, destPath);
    } else if (entry.isFile()) {
      if (!fsSync.existsSync(destPath)) {
        try { fsSync.copyFileSync(srcPath, destPath); } catch {}
      } else if (destPath.endsWith('.json')) {
        let destValid = false;
        try { JSON.parse(fsSync.readFileSync(destPath, 'utf8')); destValid = true; } catch {}
        if (!destValid) {
          try {
            JSON.parse(fsSync.readFileSync(srcPath, 'utf8'));
            fsSync.copyFileSync(srcPath, destPath);
          } catch {}
        }
      }
    }
  }
}

function migrateMemesDir(homedir = os.homedir()) {
  const oldDir = path.join(homedir, 'memeroom');
  const newDir = path.join(homedir, 'evil-memeroom');
  try {
    if (!fsSync.existsSync(oldDir)) {
      fsSync.mkdirSync(newDir, { recursive: true });
      return;
    }
    if (!fsSync.existsSync(newDir)) {
      try {
        fsSync.renameSync(oldDir, newDir);
        return;
      } catch {}
    }
    mergeDirectorySync(oldDir, newDir);
    fsSync.rmSync(oldDir, { recursive: true, force: true });
  } catch (err) {
    console.warn('Migration du dossier memes impossible :', err.message);
  }
}

function migrateUserData(appDataDir, appName = 'evil-memeroom') {
  if (!appDataDir) return;
  const legacyDir = path.join(appDataDir, 'memeroom');
  const newDir = path.join(appDataDir, appName);
  try {
    if (!fsSync.existsSync(legacyDir)) return;
    if (!fsSync.existsSync(newDir)) {
      try {
        fsSync.renameSync(legacyDir, newDir);
        return;
      } catch {}
    }
    mergeDirectorySync(legacyDir, newDir);
    fsSync.rmSync(legacyDir, { recursive: true, force: true });
  } catch (err) {
    console.warn('Migration du dossier userData impossible :', err.message);
  }
}

function migrateUserDataHashes(userDataDir) {
  try {
    if (!userDataDir || !fsSync.existsSync(userDataDir)) return;
    const legacyHash = path.join(userDataDir, 'memeroom-hashes.json');
    const newHash = path.join(userDataDir, 'hashes.json');
    if (fsSync.existsSync(legacyHash)) {
      if (!fsSync.existsSync(newHash)) {
        try {
          fsSync.renameSync(legacyHash, newHash);
        } catch {
          try {
            fsSync.copyFileSync(legacyHash, newHash);
            fsSync.rmSync(legacyHash, { force: true });
          } catch {}
        }
      } else {
        try { fsSync.rmSync(legacyHash, { force: true }); } catch {}
      }
    }
  } catch {}
}

function cleanupLegacyFolders(homedir = os.homedir()) {
  try {
    if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
      const localLegacy = path.join(process.env.LOCALAPPDATA, 'memeroom');
      if (fsSync.existsSync(localLegacy)) {
        try { fsSync.rmSync(localLegacy, { recursive: true, force: true }); } catch {}
      }
    }
    const legacyDesktop = path.join(homedir, '.config', 'autostart', 'memeroom.desktop');
    if (fsSync.existsSync(legacyDesktop)) {
      try { fsSync.rmSync(legacyDesktop, { force: true }); } catch {}
    }
  } catch {}
}

module.exports = {
  mergeDirectorySync,
  migrateMemesDir,
  migrateUserData,
  migrateUserDataHashes,
  cleanupLegacyFolders
};
