const { createWriteStream, createReadStream } = require('node:fs');
const { open, rm } = require('node:fs/promises');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const MAX_BYTES = 1024 ** 3;
const TRANSFER_MS = 30 * 60 * 1000;

function assetURL(asset, server) {
  const base = new URL(server);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    throw new Error('Serveur invalide.');
  if (
    !/^[A-Za-z0-9_-]{32}$/.test(asset?.id) ||
    asset.url !== `/media/${asset.id}` ||
    !['image', 'video', 'audio'].includes(asset.kind)
  )
    throw new Error('Média invalide.');
  return new URL(asset.url, base).href;
}
async function downloadAsset(asset, server, destination, signal) {
  const timedSignal = AbortSignal.timeout(TRANSFER_MS);
  const response = await fetch(assetURL(asset, server), {
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, timedSignal]) : timedSignal,
  });
  if (!response.ok) throw new Error('Fichier indisponible ou expiré. Importez-le à nouveau.');
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body.cancel();
    throw new Error('Le fichier dépasse 1 Go.');
  }
  let bytes = 0;
  const limit = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > MAX_BYTES ? new Error('Le fichier dépasse 1 Go.') : null, chunk);
    },
  });
  try {
    await pipeline(
      response.body,
      limit,
      createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
      { signal: signal ? AbortSignal.any([signal, timedSignal]) : timedSignal },
    );
    const fd = await open(destination, 'r');
    let header;
    try {
      header = Buffer.alloc(4096);
      const read = await fd.read(header, 0, 4096, 0);
      header = header.subarray(0, read.bytesRead);
    } finally {
      await fd.close();
    }
    const { detectMedia } = await import('../server/media.mjs');
    const format = detectMedia(header);
    if (
      !format ||
      format.kind !== asset.kind ||
      (Number.isFinite(asset.bytes) && asset.bytes !== bytes)
    )
      throw new Error('Fichier incomplet ou format incorrect.');
    return { name: String(asset.name || 'Média').slice(0, 80), bytes, ...format };
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
}
async function uploadAsset(file, asset, server, token) {
  const base = new URL(server);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    !/^[A-Za-z0-9_-]{32}$/.test(token)
  )
    throw new Error('Connexion invalide.');
  const stream = createReadStream(file);
  try {
    const response = await fetch(new URL('/api/media', base), {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(asset.bytes),
        'X-Filename': encodeURIComponent(asset.name),
      },
      body: stream,
      duplex: 'half',
      signal: AbortSignal.timeout(TRANSFER_MS),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Import impossible.');
    assetURL(result, server);
    return result;
  } finally {
    stream.destroy();
  }
}
module.exports = { downloadAsset, uploadAsset, assetURL };
