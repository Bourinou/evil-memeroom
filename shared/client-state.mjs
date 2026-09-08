import { cleanText } from './text.mjs';

export function normalizeServer(value) {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Saisissez une adresse de serveur HTTP(S), sans chemin.');
  return url.origin;
}

export function cleanClientState(input = {}) {
  const cleanServer = (value) => (value === 'local' ? 'local' : normalizeServer(value));
  const rooms = [];
  for (const entry of Array.isArray(input.rooms) ? input.rooms.slice(0, 30) : []) {
    try {
      if (!entry || !/^[A-Z2-9]{8}$/.test(entry.code)) continue;
      const server = cleanServer(entry.server);
      if (!rooms.some((r) => r.code === entry.code && r.server === server))
        rooms.push({
          code: entry.code,
          name: cleanText(entry.name, 40) || entry.code,
          server,
          ...(typeof entry.joinToken === 'string' &&
          /^[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(entry.joinToken)
            ? { joinToken: entry.joinToken }
            : {}),
          ...(typeof entry.ownerToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(entry.ownerToken)
            ? { ownerToken: entry.ownerToken }
            : {}),
        });
    } catch {
      /* Ignore malformed local bookmarks. */
    }
  }
  const active = rooms.find(
    (r) => r.code === input.active?.code && r.server === input.active?.server,
  );
  return {
    nickname: cleanText(input.nickname, 24),
    rooms,
    active: active ? { code: active.code, server: active.server } : null,
    autoJoin: input.autoJoin !== false,
  };
}
