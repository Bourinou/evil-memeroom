const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;

// isPackaged: whether the app runs from an asar (ffmpeg-static lives in app.asar.unpacked then).
function resolveFfmpeg(isPackaged) {
  try {
    let ffmpegBin = require('ffmpeg-static');
    if (typeof ffmpegBin === 'string' && isPackaged) {
      ffmpegBin = ffmpegBin.replace('app.asar', 'app.asar.unpacked');
    }
    if (!ffmpegBin || !fsSync.existsSync(ffmpegBin)) return 'ffmpeg';
    return ffmpegBin;
  } catch (error) {
    console.warn('ffmpeg-static unavailable, falling back to system ffmpeg:', error.message);
    return 'ffmpeg';
  }
}

function runFfmpeg(ffmpegBin, args, exec = execFileAsync) {
  return exec(ffmpegBin, args, { windowsHide: true, timeout: FFMPEG_TIMEOUT_MS });
}

// Base name without extension, never starting with "-" (would read as an ffmpeg option).
function safeBaseName(name) {
  const rawName = path.basename(name || 'media');
  const base = rawName.replace(/\.[^.]+$/, '').replace(/^[-\s]+/, '');
  return base || 'media';
}

function validateRange(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end) {
    throw new Error('Plage de découpe invalide.');
  }
}

function extractArgs(inputPath, outputPath, format) {
  return ['-y', '-i', inputPath, '-vn', ...(format === 'wav' ? ['-f', 'wav'] : ['-c:a', 'libmp3lame', '-q:a', '2']), outputPath];
}

// mode: 'mp3' | 'wav' (audio only) | 'copy' (stream copy) | 'preset' | 'reencode'
function trimArgs(inputPath, outputPath, start, duration, mode) {
  const head = ['-y', '-ss', String(start), '-i', inputPath, '-t', String(duration)];
  switch (mode) {
    case 'mp3': return [...head, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', outputPath];
    case 'wav': return [...head, '-vn', '-f', 'wav', outputPath];
    case 'copy': return [...head, '-c', 'copy', '-avoid_negative_ts', 'make_zero', outputPath];
    case 'preset': return [...head, '-preset', 'veryfast', outputPath];
    default: return [...head, outputPath];
  }
}

const UPLOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

// Same policy as the page's uploadMedia: retry on 429 only.
async function uploadWithRetry(upload, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await upload();
    } catch (error) {
      if (error.status !== 429 || attempt >= UPLOAD_ATTEMPTS - 1) throw error;
      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function withTempDir(prefix, fn) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// downloadAsset / uploadAsset come from media-files.cjs; savedMemePath(name) from saved-memes.cjs.
// Every operation takes a source (`asset`, `savedName` or `filePath`) plus `server` and `token`,
// works on disk and returns the asset imported on the server: no media buffer crosses IPC.
function createMediaTools({ isPackaged, downloadAsset, uploadAsset, savedMemePath }) {
  async function acquireInput(source, tempDir) {
    const { asset, savedName, filePath, server } = source;
    if (asset) {
      const name = String(asset.name || 'media');
      const ext = path.extname(path.basename(name)).toLowerCase() || '.mp4';
      const inputPath = path.join(tempDir, `input${ext}`);
      await downloadAsset(asset, server, inputPath);
      return { inputPath, name, ext };
    }
    const target = savedName ? savedMemePath(savedName) : filePath;
    if (typeof target !== 'string' || !path.isAbsolute(target) || !(await fs.stat(target)).isFile()) throw new Error('Fichier introuvable.');
    const name = path.basename(target);
    return { inputPath: target, name, ext: path.extname(name).toLowerCase() || '.mp4' };
  }

  async function importFile(file, name, { server, token }) {
    const { size } = await fs.stat(file);
    return uploadWithRetry(() => uploadAsset(file, { name, bytes: size }, server, token));
  }

  async function extractAudio(source) {
    return withTempDir('evil-audio-', async tempDir => {
      const { inputPath, name } = await acquireInput(source, tempDir);
      const baseName = safeBaseName(name);
      const outputPathMp3 = path.join(tempDir, `${baseName}.mp3`);
      const ffmpegBin = resolveFfmpeg(isPackaged);
      try {
        await runFfmpeg(ffmpegBin, extractArgs(inputPath, outputPathMp3, 'mp3'));
        return await importFile(outputPathMp3, `${baseName}.mp3`, source);
      } catch (mp3Err) {
        if (mp3Err.status) throw mp3Err;
        console.warn('ffmpeg mp3 extraction failed, trying wav:', mp3Err.message);
      }
      const outputPathWav = path.join(tempDir, `${baseName}.wav`);
      try {
        await runFfmpeg(ffmpegBin, extractArgs(inputPath, outputPathWav, 'wav'));
      } catch (wavErr) {
        console.warn('ffmpeg wav extraction failed:', wavErr.message);
        throw new Error('Cette vidéo ne contient pas de piste audio exploitable.');
      }
      return importFile(outputPathWav, `${baseName}.wav`, source);
    });
  }

  async function trim(source) {
    const { start, end, asAudio = false } = source;
    validateRange(start, end);
    return withTempDir('evil-trim-', async tempDir => {
      const { inputPath, name, ext } = await acquireInput(source, tempDir);
      const rawName = path.basename(name);
      const baseName = safeBaseName(name);
      const safeName = asAudio ? `${baseName}.mp3` : (rawName.startsWith('-') ? `${baseName}${ext}` : rawName);
      const outputPath = path.join(tempDir, `trimmed_${safeName}`);
      const duration = Math.max(0.1, end - start);
      const attempt = (mode, target = outputPath) => runFfmpeg(resolveFfmpeg(isPackaged), trimArgs(inputPath, target, start, duration, mode));
      let trimmed = false;

      if (asAudio) {
        try {
          await attempt('mp3');
          trimmed = true;
        } catch (audioErr) {
          console.warn('ffmpeg mp3 trim failed, trying wav:', audioErr.message);
        }

        if (!trimmed) {
          const fallbackWav = path.join(tempDir, `trimmed_${baseName}.wav`);
          try {
            await attempt('wav', fallbackWav);
          } catch (wavErr) {
            console.warn('ffmpeg wav trim failed:', wavErr.message);
            throw new Error('Impossible de découper la piste audio de cette vidéo.');
          }
          return importFile(fallbackWav, `trim_${baseName}.wav`, source);
        }
      } else if (ext === '.webm') {
        // Stream copy preserves per-frame dynamic resolution, aspect ratio animations,
        // and alpha channels in WebM without re-encoding.
        try {
          await attempt('copy');
          trimmed = true;
        } catch (copyErr) {
          console.warn('ffmpeg webm stream copy failed, re-encoding:', copyErr.message);
        }
      }

      if (!trimmed) {
        try {
          await attempt('preset');
        } catch (presetErr) {
          console.warn('ffmpeg preset trim failed, retrying plain:', presetErr.message);
          try {
            await attempt('reencode');
          } catch (reencErr) {
            console.warn('ffmpeg re-encode trim failed, trying stream copy:', reencErr.message);
            await attempt('copy');
          }
        }
      }
      return importFile(outputPath, `trim_${safeName}`, source);
    });
  }

  // Imports a saved meme as-is; GIF duration is computed here so the page need not read the bytes.
  async function uploadSavedMeme({ name, server, token }) {
    const file = savedMemePath(name);
    const asset = await importFile(file, path.basename(file), { server, token });
    if (!/\.gif$/i.test(file)) return { asset };
    const { getGifDuration } = await import('../shared/protocol.mjs');
    const info = getGifDuration(await fs.readFile(file));
    return info ? { asset, gifInfo: info } : { asset };
  }

  return { extractAudio, trim, uploadSavedMeme };
}

module.exports = { createMediaTools, resolveFfmpeg, runFfmpeg, safeBaseName, validateRange, extractArgs, trimArgs, uploadWithRetry, FFMPEG_TIMEOUT_MS };
