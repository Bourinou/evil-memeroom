import net from 'node:net';
import { createReadStream } from 'node:fs';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mediaError } from './media-storage.mjs';
const execute = promisify(execFile);

// INSTREAM keeps the ClamAV service isolated from the application's filesystem.
export async function scanClam(
  file,
  {
    host = process.env.CLAMAV_HOST,
    port = Number(process.env.CLAMAV_PORT || 3310),
    timeoutMs = 5 * 60 * 1000,
  } = {},
) {
  if (!host)
    throw mediaError('Analyse antivirus indisponible. Contactez le gestionnaire du serveur.', 503);
  const socket = net.createConnection({ host, port });
  const timer = setTimeout(() => socket.destroy(new Error('Antivirus timeout')), timeoutMs);
  const input = createReadStream(file, { highWaterMark: 64 * 1024 });
  let reply = '';
  const result = new Promise((resolve, reject) => {
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      reply += chunk.toString();
      if (reply.length > 4096) socket.destroy(new Error('Invalid antivirus response'));
      else if (reply.includes('\0')) resolve(reply.slice(0, reply.indexOf('\0')));
    });
    socket.on('end', () => {
      if (!reply.includes('\0')) reject(new Error('Incomplete antivirus response'));
    });
  });
  // Attach immediately: an early rejection must not escape while the file streams.
  result.catch(() => {});
  try {
    await once(socket, 'connect');
    socket.write('zINSTREAM\0');
    const sending = (async () => {
      for await (const chunk of input) {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length);
        if (!socket.write(Buffer.concat([length, chunk]))) await once(socket, 'drain');
      }
      socket.write(Buffer.alloc(4));
      return result;
    })();
    const response = await Promise.race([sending, result]);
    if (response.endsWith(' FOUND'))
      throw mediaError(
        'Fichier refusé par l’antivirus (menace détectée ou limites d’analyse dépassées).',
        422,
      );
    if (response !== 'stream: OK') throw new Error('Antivirus did not return OK');
  } catch (error) {
    if (error.status) throw error;
    throw mediaError(
      'Analyse antivirus indisponible ou incomplète. Le fichier n’a pas été partagé.',
      503,
    );
  } finally {
    clearTimeout(timer);
    input.destroy();
    socket.destroy();
  }
}

export async function inspectMedia(asset) {
  if (process.env.CLAMAV_HOST || process.env.MEMEROOM_SCAN_REQUIRED === '1')
    await scanClam(asset.file);
  if (process.env.MEMEROOM_FFPROBE) {
    try {
      const { stdout } = await execute(
        process.env.MEMEROOM_FFPROBE,
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'file',
          '-show_entries',
          'stream=codec_type,width,height',
          '-of',
          'json',
          asset.file,
        ],
        { timeout: 30000, maxBuffer: 128 * 1024, windowsHide: true },
      );
      const streams = JSON.parse(stdout).streams;
      if (
        !streams?.length ||
        streams.some(
          (s) =>
            !['video', 'audio'].includes(s.codec_type) ||
            (s.width || 1) * (s.height || 1) > 100000000,
        )
      )
        throw new Error('Invalid streams');
      if (!streams.some((s) => s.codec_type === (asset.kind === 'audio' ? 'audio' : 'video')))
        throw new Error('Wrong media kind');
    } catch {
      throw mediaError(
        'Le fichier est illisible, contient des pistes non autorisées ou dépasse les limites de décodage.',
        415,
      );
    }
  }
}
