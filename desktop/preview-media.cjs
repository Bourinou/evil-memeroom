function createPreviewMedia(cache, serveFile) {
  const active = new Map();
  function release(id) {
    const entry = active.get(id);
    if (!entry) return;
    active.delete(id);
    entry.abort.abort();
    entry.lease?.release();
  }
  return {
    async prepare(id, asset, server) {
      if (
        typeof id !== 'string' ||
        !/^[A-Za-z0-9_-]{16,64}$/.test(id) ||
        active.has(id) ||
        active.size >= 4
      )
        throw new Error('Aperçu invalide.');
      const entry = { abort: new AbortController() };
      active.set(id, entry);
      try {
        entry.lease = await cache.acquire(asset, server, entry.abort.signal);
        if (entry.abort.signal.aborted) {
          entry.lease.release();
          entry.abort.signal.throwIfAborted();
        }
        return `http://localhost/playback/${id}`;
      } catch (error) {
        release(id);
        throw error;
      }
    },
    release,
    respond(request) {
      const entry = active.get(new URL(request.url).pathname.slice('/playback/'.length));
      if (!entry?.lease || !['GET', 'HEAD'].includes(request.method))
        return new Response('Média indisponible.', { status: 404 });
      return serveFile(entry.lease.file, request, entry.lease.mime);
    },
    clear() {
      for (const id of active.keys()) release(id);
    },
  };
}
module.exports = { createPreviewMedia };
