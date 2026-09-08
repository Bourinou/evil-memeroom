import { rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import path from 'node:path';
import { createTempDirectory } from '../shared/node/temp-directory.cjs';
import { randomUUID } from 'node:crypto';
import { LIMITS } from '../shared/protocol.mjs';
import { detectMedia } from '../shared/media-format.mjs';

export const mediaError = (message, status = 400) => Object.assign(new Error(message), { status });
export class MediaStorage {
  constructor() {
    this.pending = new Set();
  }
  async start() {
    this.directory = await createTempDirectory('memeroom-media-', {
      root: process.env.MEMEROOM_TEMP_DIR,
    });
  }
  async receive(request) {
    const file = path.join(this.directory, randomUUID());
    let bytes = 0,
      header = Buffer.alloc(0);
    const limit = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > LIMITS.uploadBytes) {
          callback(mediaError('Le fichier dépasse 1 Go.', 413));
          return;
        }
        if (header.length < 4096)
          header = Buffer.concat([header, chunk.subarray(0, 4096 - header.length)]);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(request, limit, createWriteStream(file, { flags: 'wx', mode: 0o600 }), {
        signal: AbortSignal.timeout(LIMITS.transferTimeoutMs),
      });
      const format = detectMedia(header);
      if (!format)
        throw mediaError(
          'Format refusé. Utilisez PNG, JPEG, GIF, WebP, MP4, WebM, MP3, WAV ou OGG.',
          415,
        );
      return { file, bytes, ...format };
    } catch (error) {
      await rm(file, { force: true });
      throw error;
    }
  }
  remove(asset) {
    if (!asset?.file) return;
    const removing = rm(asset.file, { force: true, maxRetries: 3, retryDelay: 100 })
      .catch((error) => {
        console.error('Suppression du média impossible :', error.code);
      })
      .finally(() => this.pending.delete(removing));
    this.pending.add(removing);
  }
  async stop() {
    await Promise.allSettled([...this.pending]);
    if (this.directory)
      await rm(this.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
