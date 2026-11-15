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

function createMediaTools({ isPackaged }) {
  async function extractAudio({ name, buffer }) {
    const rawName = path.basename(name || 'media');
    const baseName = safeBaseName(name);
    const ext = path.extname(rawName).toLowerCase() || '.mp4';
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'evil-audio-'));
    const inputPath = path.join(tempDir, `input${ext}`);
    const outputPathMp3 = path.join(tempDir, `${baseName}.mp3`);
    try {
      await fs.writeFile(inputPath, Buffer.from(buffer));
      const ffmpegBin = resolveFfmpeg(isPackaged);

      try {
        await runFfmpeg(ffmpegBin, extractArgs(inputPath, outputPathMp3, 'mp3'));
      } catch (mp3Err) {
        console.warn('ffmpeg mp3 extraction failed, trying wav:', mp3Err.message);
        const outputPathWav = path.join(tempDir, `${baseName}.wav`);
        try {
          await runFfmpeg(ffmpegBin, extractArgs(inputPath, outputPathWav, 'wav'));
          const wavBytes = await fs.readFile(outputPathWav);
          return { name: `${baseName}.wav`, buffer: wavBytes, mime: 'audio/wav', size: wavBytes.length };
        } catch (wavErr) {
          console.warn('ffmpeg wav extraction failed:', wavErr.message);
          throw new Error('Cette vidéo ne contient pas de piste audio exploitable.');
        }
      }

      const mp3Bytes = await fs.readFile(outputPathMp3);
      return { name: `${baseName}.mp3`, buffer: mp3Bytes, mime: 'audio/mpeg', size: mp3Bytes.length };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function trim({ name, buffer, start, end, asAudio = false }) {
    validateRange(start, end);
    const rawName = path.basename(name || 'media');
    const baseName = safeBaseName(name);
    const ext = path.extname(rawName).toLowerCase() || '.mp4';
    const safeName = asAudio ? `${baseName}.mp3` : (rawName.startsWith('-') ? `${baseName}${ext}` : rawName);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'evil-trim-'));
    const inputPath = path.join(tempDir, `input${ext}`);
    const outputPath = path.join(tempDir, `trimmed_${safeName}`);
    try {
      await fs.writeFile(inputPath, Buffer.from(buffer));
      const ffmpegBin = resolveFfmpeg(isPackaged);
      const duration = Math.max(0.1, end - start);
      const attempt = (mode, target = outputPath) => runFfmpeg(ffmpegBin, trimArgs(inputPath, target, start, duration, mode));
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
            const wavBytes = await fs.readFile(fallbackWav);
            return { name: `trim_${baseName}.wav`, buffer: wavBytes, mime: 'audio/wav', size: wavBytes.length };
          } catch (wavErr) {
            console.warn('ffmpeg wav trim failed:', wavErr.message);
            throw new Error('Impossible de découper la piste audio de cette vidéo.');
          }
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

      const trimmedBytes = await fs.readFile(outputPath);
      return {
        name: `trim_${safeName}`,
        buffer: trimmedBytes,
        size: trimmedBytes.length,
        ...(asAudio ? { mime: outputPath.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg' } : {})
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return { extractAudio, trim };
}

module.exports = { createMediaTools, resolveFfmpeg, runFfmpeg, safeBaseName, validateRange, extractArgs, trimArgs, FFMPEG_TIMEOUT_MS };
