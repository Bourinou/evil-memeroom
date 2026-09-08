const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { rm } = require('node:fs/promises');
const { createTempDirectory } = require('../shared/node/temp-directory.cjs');
const { LIMITS } = require('../shared/limits.mjs');
const { assetURL, downloadAsset } = require('./media-files.cjs');

class MediaCache {
  /** @param {{root?: string, maxBytes?: number, ttlMs?: number, now?: () => number, download?: typeof downloadAsset}} [options] */
  constructor({
    root,
    maxBytes = LIMITS.roomBytes,
    ttlMs = LIMITS.mediaTtlMs,
    now = Date.now,
    download = downloadAsset,
  } = {}) {
    this.maxBytes = maxBytes;
    this.ttlMs = ttlMs;
    this.now = now;
    this.download = download;
    this.entries = new Map();
    this.tasks = new Set();
    this.bytes = 0;
    this.queue = Promise.resolve();
    this.directory = createTempDirectory('memeroom-playback-', { root });
    this.sweep = setInterval(
      () => {
        this.queue = this.queue
          .catch(() => {})
          .then(async () => {
            for (const entry of this.entries.values())
              if (!entry.refs && this.now() - entry.created >= this.ttlMs) await this.remove(entry);
          });
        this.queue.catch(() => {});
      },
      Math.min(ttlMs, 60000),
    );
    this.sweep.unref();
  }

  async remove(entry) {
    if (this.entries.get(entry.key) !== entry) return;
    this.entries.delete(entry.key);
    this.bytes -= entry.bytes;
    entry.abort.abort();
    await entry.ready.catch(() => {});
    await rm(entry.file, { force: true, maxRetries: 3, retryDelay: 100 });
  }

  /** @param {import('../shared/contracts.js').MediaAsset} asset
   * @param {string} server
   * @param {AbortSignal} [signal]
   * @returns {Promise<import('../shared/contracts.js').MediaLease>} */
  async acquire(asset, server, signal) {
    if (this.closed) throw new Error('Cache fermé.');
    signal?.throwIfAborted();
    const key = `${assetURL(asset, server)}|${asset.kind}|${asset.bytes ?? ''}`;
    const reserved =
      Number.isSafeInteger(asset.bytes) && asset.bytes > 0 ? asset.bytes : LIMITS.uploadBytes;
    if (reserved > LIMITS.uploadBytes || reserved > this.maxBytes)
      throw new Error('Fichier trop volumineux.');
    const selection = this.queue
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new DOMException('Cache fermé.', 'AbortError');
        signal?.throwIfAborted();
        let entry = this.entries.get(key);
        if (entry && this.now() - entry.created >= this.ttlMs) {
          if (entry.refs) throw new Error('Média expiré. Importez-le à nouveau.');
          await this.remove(entry);
          entry = null;
        }
        if (!entry) {
          for (const candidate of this.entries.values()) {
            if (this.bytes + reserved <= this.maxBytes && this.entries.size < 64) break;
            if (!candidate.refs) await this.remove(candidate);
          }
          if (this.bytes + reserved > this.maxBytes || this.entries.size >= 64)
            throw new Error('Cache occupé par des lectures en cours. Réessayez après leur arrêt.');
          entry = {
            key,
            bytes: reserved,
            refs: 0,
            created: this.now(),
            abort: new AbortController(),
            file: path.join(await this.directory, randomUUID()),
          };
          this.entries.set(key, entry);
          this.bytes += reserved;
          entry.ready = this.download(asset, server, entry.file, entry.abort.signal).then(
            (metadata) => {
              entry.abort.signal.throwIfAborted();
              if (
                !Number.isSafeInteger(metadata.bytes) ||
                metadata.bytes < 1 ||
                metadata.bytes > reserved
              )
                throw new Error('Taille du fichier invalide.');
              this.bytes += metadata.bytes - entry.bytes;
              entry.bytes = metadata.bytes;
              entry.mime = metadata.mime;
              entry.complete = true;
            },
          );
          this.tasks.add(entry.ready);
          entry.ready.finally(() => this.tasks.delete(entry.ready)).catch(() => {});
        }
        entry.refs++;
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry;
      });
    this.queue = selection;
    const entry = await selection;
    let released = false,
      abortListener;
    const release = () => {
      if (released) return;
      released = true;
      entry.refs--;
      signal?.removeEventListener('abort', abortListener);
      if (!entry.refs && !entry.complete) {
        entry.abort.abort();
        this.queue = this.queue.catch(() => {}).then(() => this.remove(entry));
        this.queue.catch(() => {});
      }
    };
    try {
      await Promise.race([
        entry.ready,
        new Promise((_, reject) => {
          abortListener = () => reject(signal.reason);
          signal?.addEventListener('abort', abortListener, { once: true });
          if (signal?.aborted) abortListener();
        }),
      ]);
      return { file: entry.file, bytes: entry.bytes, mime: entry.mime, release };
    } catch (error) {
      release();
      throw error;
    } finally {
      signal?.removeEventListener('abort', abortListener);
    }
  }

  async close() {
    if (this.closing) return this.closing;
    this.closed = true;
    clearInterval(this.sweep);
    for (const entry of this.entries.values()) entry.abort.abort();
    this.closing = (async () => {
      await this.queue.catch(() => {});
      for (const entry of this.entries.values()) entry.abort.abort();
      await Promise.allSettled([...this.tasks]);
      await rm(await this.directory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
      this.entries.clear();
      this.bytes = 0;
    })();
    return this.closing;
  }
}
module.exports = { MediaCache };
