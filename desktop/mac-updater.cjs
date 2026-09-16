const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function parseSemver(value) {
  const clean = String(value || '').trim().replace(/^v/, '');
  const [core] = clean.split('-');
  const parts = core.split('.').map(n => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}

function isNewerVersion(latest, current) {
  const l = parseSemver(latest);
  const c = parseSemver(current);
  for (let i = 0; i < 3; i++) {
    if (l[i] > c[i]) return true;
    if (l[i] < c[i]) return false;
  }
  return false;
}

function selectMacAsset(assets, arch = process.arch) {
  if (!Array.isArray(assets)) return null;
  const zips = assets.filter(a => typeof a.name === 'string' && a.name.endsWith('.zip') && a.browser_download_url);
  if (!zips.length) return null;
  const archMatch = zips.find(a => a.name.toLowerCase().includes(arch.toLowerCase()));
  if (archMatch) return archMatch;
  if (arch === 'arm64') {
    const fallback = zips.find(a => a.name.toLowerCase().includes('arm64') || a.name.toLowerCase().includes('aarch64'));
    if (fallback) return fallback;
  }
  if (arch === 'x64') {
    const fallback = zips.find(a => a.name.toLowerCase().includes('x64') || a.name.toLowerCase().includes('x86_64') || a.name.toLowerCase().includes('intel'));
    if (fallback) return fallback;
  }
  return zips[0];
}

class MacGithubUpdater extends EventEmitter {
  constructor({ owner = 'Bourinou', repo = 'evil-memeroom', app, arch = process.arch } = {}) {
    super();
    this.owner = owner;
    this.repo = repo;
    this.app = app;
    this.arch = arch;
    this.autoDownload = false;
    this.autoInstallOnAppQuit = false;
    this.allowDowngrade = false;
    this.allowPrerelease = false;
    this.updateInfo = null;
    this.downloadAbortController = null;
    this.downloadedZipPath = null;
    this.tempDir = null;
  }

  async checkForUpdates() {
    this.emit('checking-for-update');
    try {
      const url = `https://api.github.com/repos/${this.owner}/${this.repo}/releases/latest`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'evil-memeroom-updater',
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (!response.ok) {
        throw new Error(`GitHub API HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      const latestTag = data.tag_name || '';
      const currentVersion = this.app?.getVersion?.() || require('../package.json').version;

      if (!isNewerVersion(latestTag, currentVersion)) {
        this.emit('update-not-available');
        return { isUpdateAvailable: false, versionInfo: { version: latestTag } };
      }

      const asset = selectMacAsset(data.assets, this.arch);
      if (!asset) {
        throw new Error(`Aucune archive Mac .zip trouvée pour l’architecture ${this.arch} dans la release ${latestTag}.`);
      }

      this.updateInfo = {
        version: latestTag.replace(/^v/, ''),
        asset,
        release: data
      };

      const cancellationToken = {
        cancel: () => {
          if (this.downloadAbortController) {
            this.downloadAbortController.abort();
          }
        }
      };

      this.emit('update-available', this.updateInfo);
      return {
        isUpdateAvailable: true,
        updateInfo: this.updateInfo,
        cancellationToken
      };
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  async downloadUpdate(cancellationToken) {
    if (!this.updateInfo?.asset?.browser_download_url) {
      throw new Error('Veuillez d’abord vérifier les mises à jour.');
    }

    const downloadUrl = this.updateInfo.asset.browser_download_url;
    this.tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'evil-memeroom-mac-update-'));
    this.downloadedZipPath = path.join(this.tempDir, this.updateInfo.asset.name);

    this.downloadAbortController = new AbortController();
    if (cancellationToken) {
      cancellationToken.cancel = () => this.downloadAbortController.abort();
    }

    const response = await fetch(downloadUrl, {
      signal: this.downloadAbortController.signal,
      headers: { 'User-Agent': 'evil-memeroom-updater' }
    });

    if (!response.ok) {
      throw new Error(`Échec du téléchargement (${response.status} ${response.statusText}).`);
    }

    const totalBytes = Number(response.headers.get('content-length')) || this.updateInfo.asset.size || 0;
    let receivedBytes = 0;

    const fileStream = fs.createWriteStream(this.downloadedZipPath);
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedBytes += value.length;
        fileStream.write(Buffer.from(value));
        if (totalBytes > 0) {
          const percent = Math.min(100, Math.max(0, Math.round((receivedBytes / totalBytes) * 100)));
          this.emit('download-progress', { percent, total: totalBytes, transferred: receivedBytes });
        }
      }
      await new Promise((resolve, reject) => {
        fileStream.on('finish', resolve);
        fileStream.on('error', reject);
        fileStream.end();
      });
    } catch (error) {
      fileStream.destroy();
      await fs.promises.rm(this.tempDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }

    return [this.downloadedZipPath];
  }

  async install() {
    if (!this.downloadedZipPath || !fs.existsSync(this.downloadedZipPath)) {
      throw new Error('Fichier de mise à jour introuvable pour l’installation.');
    }

    const stageDir = path.join(this.tempDir, 'extracted');
    await fs.promises.mkdir(stageDir, { recursive: true });

    // Extract zip using ditto to strictly preserve symlinks, frameworks, and permissions
    await execFileAsync('/usr/bin/ditto', ['-xk', this.downloadedZipPath, stageDir]);

    // Find the .app bundle inside extracted content
    const entries = await fs.promises.readdir(stageDir);
    const appBundleName = entries.find(e => e.endsWith('.app'));
    if (!appBundleName) {
      throw new Error('Aucune application (.app) trouvée dans l’archive extraite.');
    }
    const stageAppPath = path.join(stageDir, appBundleName);

    // Recreate ad-hoc local signature and remove download quarantine
    try {
      await execFileAsync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', stageAppPath]);
    } catch (err) {
      console.warn('evil memeroom: codesign local:', err.message);
    }
    try {
      await execFileAsync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', stageAppPath]);
    } catch (err) {
      console.warn('evil memeroom: xattr quarantine:', err.message);
    }

    // Determine target location for the application
    let targetAppPath = path.resolve(process.execPath, '../../..');
    if (!targetAppPath.endsWith('.app')) {
      const userApps = path.join(os.homedir(), 'Applications', appBundleName);
      const sysApps = path.join('/Applications', appBundleName);
      if (fs.existsSync(userApps)) targetAppPath = userApps;
      else if (fs.existsSync(sysApps)) targetAppPath = sysApps;
      else targetAppPath = userApps;
    }

    const targetDir = path.dirname(targetAppPath);
    await fs.promises.mkdir(targetDir, { recursive: true });

    // Backup current app, install new app via ditto, remove backup
    const backupPath = path.join(os.tmpdir(), `evil-memeroom-old-${Date.now()}.app`);
    if (fs.existsSync(targetAppPath)) {
      try {
        await fs.promises.rename(targetAppPath, backupPath);
      } catch {
        await execFileAsync('/bin/rm', ['-rf', targetAppPath]).catch(() => {});
      }
    }

    await execFileAsync('/usr/bin/ditto', [stageAppPath, targetAppPath]);
    await execFileAsync('/bin/rm', ['-rf', backupPath]).catch(() => {});
    await fs.promises.rm(this.tempDir, { recursive: true, force: true }).catch(() => {});

    // Spawn new app and quit current instance
    const relaunch = spawn('/usr/bin/open', ['-n', targetAppPath], {
      detached: true,
      stdio: 'ignore'
    });
    relaunch.unref();

    if (this.app) {
      this.app.quit();
    }
  }
}

module.exports = { MacGithubUpdater, parseSemver, isNewerVersion, selectMacAsset };
