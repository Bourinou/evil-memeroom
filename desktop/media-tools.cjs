const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function resolveFfmpeg(isPackaged) {
  try {
    let ffmpegBin = require('ffmpeg-static');
    if (typeof ffmpegBin === 'string' && isPackaged) {
      ffmpegBin = ffmpegBin.replace('app.asar', 'app.asar.unpacked');
    }
    if (!ffmpegBin || !fsSync.existsSync(ffmpegBin)) return 'ffmpeg';
    return ffmpegBin;
  } catch {
    return 'ffmpeg';
  }
}

// isPackaged: whether the app runs from an asar (ffmpeg-static lives in app.asar.unpacked then).
function createMediaTools({ isPackaged }) {
  async function extractAudio({ name, buffer }) {
    const rawSafeName = path.basename(name || 'media');
    const safeBaseName = rawSafeName.replace(/\.[^.]+$/, '');
    const ext = path.extname(rawSafeName).toLowerCase() || '.mp4';
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'evil-audio-'));
    const inputPath = path.join(tempDir, `input${ext}`);
    const outputPathMp3 = path.join(tempDir, `${safeBaseName}.mp3`);
    try {
      await fs.writeFile(inputPath, Buffer.from(buffer));
      const ffmpegBin = resolveFfmpeg(isPackaged);

      let extracted = false;
      try {
        await execFileAsync(ffmpegBin, [
          '-y',
          '-i', inputPath,
          '-vn',
          '-c:a', 'libmp3lame',
          '-q:a', '2',
          outputPathMp3
        ], { windowsHide: true });
        extracted = true;
      } catch (mp3Err) {}

      if (!extracted) {
        const outputPathWav = path.join(tempDir, `${safeBaseName}.wav`);
        try {
          await execFileAsync(ffmpegBin, [
            '-y',
            '-i', inputPath,
            '-vn',
            '-f', 'wav',
            outputPathWav
          ], { windowsHide: true });
          const wavBytes = await fs.readFile(outputPathWav);
          return {
            name: `${safeBaseName}.wav`,
            buffer: wavBytes,
            mime: 'audio/wav',
            size: wavBytes.length
          };
        } catch (wavErr) {
          throw new Error('Cette vidéo ne contient pas de piste audio exploitable.');
        }
      }

      const mp3Bytes = await fs.readFile(outputPathMp3);
      return {
        name: `${safeBaseName}.mp3`,
        buffer: mp3Bytes,
        mime: 'audio/mpeg',
        size: mp3Bytes.length
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function trim({ name, buffer, start, end, asAudio = false }) {
    const rawSafeName = path.basename(name || 'media');
    const baseName = rawSafeName.replace(/\.[^.]+$/, '');
    const ext = path.extname(rawSafeName).toLowerCase() || '.mp4';
    const safeName = asAudio ? `${baseName}.mp3` : rawSafeName;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'evil-trim-'));
    const inputPath = path.join(tempDir, `input${ext}`);
    const outputPath = path.join(tempDir, `trimmed_${safeName}`);
    try {
      await fs.writeFile(inputPath, Buffer.from(buffer));
      const ffmpegBin = resolveFfmpeg(isPackaged);

      const duration = Math.max(0.1, end - start);
      let trimmed = false;

      if (asAudio) {
        try {
          await execFileAsync(ffmpegBin, [
            '-y',
            '-ss', String(start),
            '-i', inputPath,
            '-t', String(duration),
            '-vn',
            '-c:a', 'libmp3lame',
            '-q:a', '2',
            outputPath
          ], { windowsHide: true });
          trimmed = true;
        } catch (audioErr) {}

        if (!trimmed) {
          const fallbackWav = path.join(tempDir, `trimmed_${baseName}.wav`);
          try {
            await execFileAsync(ffmpegBin, [
              '-y',
              '-ss', String(start),
              '-i', inputPath,
              '-t', String(duration),
              '-vn',
              '-f', 'wav',
              fallbackWav
            ], { windowsHide: true });
            const wavBytes = await fs.readFile(fallbackWav);
            return {
              name: `trim_${baseName}.wav`,
              buffer: wavBytes,
              mime: 'audio/wav',
              size: wavBytes.length
            };
          } catch (wavErr) {
            throw new Error('Impossible de découper la piste audio de cette vidéo.');
          }
        }
      } else if (ext === '.webm') {
        // Stream copy preserves per-frame dynamic resolution, aspect ratio animations,
        // and alpha channels in WebM without re-encoding.
        try {
          await execFileAsync(ffmpegBin, [
            '-y',
            '-ss', String(start),
            '-i', inputPath,
            '-t', String(duration),
            '-c', 'copy',
            '-avoid_negative_ts', 'make_zero',
            outputPath
          ], { windowsHide: true });
          trimmed = true;
        } catch (copyErr) {}
      }

      if (!trimmed) {
        try {
          await execFileAsync(ffmpegBin, [
            '-y',
            '-ss', String(start),
            '-i', inputPath,
            '-t', String(duration),
            '-preset', 'veryfast',
            outputPath
          ], { windowsHide: true });
        } catch (presetErr) {
          try {
            await execFileAsync(ffmpegBin, [
              '-y',
              '-ss', String(start),
              '-i', inputPath,
              '-t', String(duration),
              outputPath
            ], { windowsHide: true });
          } catch (reencErr) {
            await execFileAsync(ffmpegBin, [
              '-y',
              '-ss', String(start),
              '-i', inputPath,
              '-t', String(duration),
              '-c', 'copy',
              '-avoid_negative_ts', 'make_zero',
              outputPath
            ], { windowsHide: true });
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

module.exports = { createMediaTools };
