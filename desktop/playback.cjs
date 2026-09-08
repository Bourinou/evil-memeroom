const { pathToFileURL } = require('node:url');

function createPlayback({ protocol, cache, getSettings, show, hide, reveal }) {
  let generation = 0,
    lastShown = 0,
    abort,
    timer,
    automatic,
    duration;
  const seen = new Set();
  let leases = [];
  function clear() {
    generation++;
    clearTimeout(timer);
    abort?.abort();
    hide();
    for (const lease of leases) lease.release();
    leases = [];
  }
  const current = (id) => id === generation && !getSettings().paused;
  async function display(payload, test = false) {
    const settings = getSettings(),
      now = Date.now();
    if (settings.paused) return { shown: false, reason: 'paused' };
    if (!test && (now - lastShown < settings.cooldown * 1000 || seen.has(payload?.id)))
      return { shown: false, reason: 'cooldown' };
    if (!payload || typeof payload !== 'object') throw new Error('Réaction invalide.');
    const server = protocol.normalizeServer(payload.server),
      media = new Map();
    for (const item of [payload.media, payload.audio].filter(Boolean)) {
      if (
        !/^[A-Za-z0-9_-]{32}$/.test(item.id) ||
        item.url !== `/media/${item.id}` ||
        !['image', 'video', 'audio'].includes(item.kind)
      )
        throw new Error('Média invalide.');
      media.set(item.id, { ...item, name: protocol.cleanText(item.name, 80) });
    }
    const reaction = protocol.validateReaction(
      { ...payload, mediaId: payload.media?.id, audioId: payload.audio?.id },
      media,
    );
    lastShown = now;
    if (typeof payload.id === 'string') {
      seen.add(payload.id.slice(0, 80));
      if (seen.size > 100) seen.delete(seen.values().next().value);
    }
    clear();
    const id = generation,
      controller = new AbortController();
    abort = controller;
    const delay = Number.isFinite(payload.delay) ? Math.max(0, Math.min(payload.delay, 1000)) : 0;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (!current(id)) return { shown: false, reason: 'cancelled' };
    try {
      for (const key of ['media', 'audio'])
        if (reaction[key]) {
          const lease = await cache.acquire(reaction[key], server, controller.signal);
          if (!current(id) || controller.signal.aborted) {
            lease.release();
            return { shown: false, reason: 'cancelled' };
          }
          leases.push(lease);
          reaction[key].playbackURL = pathToFileURL(lease.file).href;
        }
      automatic = protocol.hasTimedMedia(reaction);
      duration = reaction.duration;
      show({
        ...reaction,
        server,
        playbackId: id,
        volume: getSettings().volume,
        sender: protocol.cleanText(payload.sender?.name, 24),
      });
      timer = setTimeout(clear, 65000);
      return { shown: true };
    } catch (error) {
      if (controller.signal.aborted || !current(id)) return { shown: false, reason: 'cancelled' };
      clear();
      throw error;
    }
  }
  return {
    display,
    clear,
    done(id) {
      if (!current(id)) return false;
      clear();
      return true;
    },
    ready(id) {
      if (!current(id)) return false;
      clearTimeout(timer);
      reveal();
      timer = setTimeout(
        clear,
        automatic ? protocol.LIMITS.playbackStallMs : duration * 1000 + 250,
      );
      return true;
    },
    progress(id) {
      if (!current(id) || !automatic) return;
      clearTimeout(timer);
      timer = setTimeout(clear, protocol.LIMITS.playbackStallMs);
    },
  };
}
module.exports = { createPlayback };
