export const LIMITS = Object.freeze({ uploadBytes: 1024 ** 3, roomBytes: 2 * 1024 ** 3, totalBytes: 8 * 1024 ** 3, mediaTtlMs: 10 * 60 * 1000, transferTimeoutMs: 30 * 60 * 1000, durationMin: 0.1, durationMax: 15, playbackStallMs: 30000, cooldownMs: 3000, members: 16, mediaCount: 30 });
export function hasTimedMedia(reaction) { return reaction.media?.kind === 'video' || reaction.media?.kind === 'audio' || reaction.audio?.kind === 'audio' || reaction.audio?.kind === 'video'; }
export const DEFAULT_SETTINGS = Object.freeze({ paused: false, hideSelf: false, autoStart: true, volume: 45, size: 60, cooldown: 2, position: 'center', display: 'primary', dismissShortcut: 'Control+Shift+F9' });
export function validDismissShortcut(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || value.length > 80 || value === 'Control+Shift+F8') return false;
  const parts = value.split('+'), key = parts.pop();
  if (!key) return false;
  const validModifiers = new Set(['Control','Alt','Shift','Super','Command','Cmd','Option']);
  for (const part of parts) if (!validModifiers.has(part)) return false;
  return true;
}
export function cleanSettings(input = {}) {
  const number = (key, min, max) => Number.isFinite(Number(input[key])) ? Math.max(min, Math.min(max, Number(input[key]))) : DEFAULT_SETTINGS[key];
  return { paused: input.paused === true, hideSelf: input.hideSelf === true, autoStart: true, volume: number('volume', 0, 100), size: number('size', 20, 60), cooldown: 2, position: ['bottom-right', 'bottom-left', 'center', 'top-right'].includes(input.position) ? input.position : DEFAULT_SETTINGS.position, display: typeof input.display === 'string' ? input.display.slice(0, 50) : 'primary', dismissShortcut: validDismissShortcut(input.dismissShortcut) ? input.dismissShortcut : DEFAULT_SETTINGS.dismissShortcut };
}
export function cleanText(value, max) { return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : ''; }
export function parseSubtitles(input) {
  if (typeof input !== 'string' || input.length > 32000) throw new Error('Sous-titres trop volumineux (32 Ko maximum).');
  const stamp = '(\\d{1,2}):(\\d{2}):(\\d{2})[,.](\\d{3})';
  const re = new RegExp(`^${stamp}\\s*-->\\s*${stamp}`);
  const cues = [];
  for (const block of input.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.trim().split('\n');
    const i = lines.findIndex(line => re.test(line));
    if (i < 0) continue;
    const m = lines[i].match(re);
    const time = j => Number(m[j]) * 3600 + Number(m[j + 1]) * 60 + Number(m[j + 2]) + Number(m[j + 3]) / 1000;
    const start = time(1), end = time(5);
    const text = cleanText(lines.slice(i + 1).join('\n').replace(/<[^>]*>/g, ''), 300);
    if (end > start && text) cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start).slice(0, 80);
}
export function validCues(cues) {
  if (!Array.isArray(cues)) return [];
  return cues.slice(0, 80).filter(c => c && Number.isFinite(c.start) && Number.isFinite(c.end) && c.start >= 0 && c.end > c.start).map(c => ({ start: c.start, end: c.end, text: cleanText(c.text, 300) }));
}

export const META_CUE_PREFIX = '@@evil-meta:';

export function embedReactionMeta(cues, meta) {
  const cleanCues = Array.isArray(cues) ? cues.filter(c => !c.text?.startsWith(META_CUE_PREFIX)) : [];
  if (!meta) return cleanCues;
  cleanCues.push({
    start: 9999,
    end: 10000,
    text: `${META_CUE_PREFIX}${JSON.stringify(meta)}`
  });
  return cleanCues;
}

export function extractReactionMeta(reaction) {
  if (!reaction) return null;
  const list = reaction.subtitles || reaction.cues || [];
  if (!Array.isArray(list)) return null;
  const cue = list.find(c => c.text && typeof c.text === 'string' && c.text.startsWith(META_CUE_PREFIX));
  if (!cue) return null;
  try {
    return JSON.parse(cue.text.slice(META_CUE_PREFIX.length));
  } catch {
    return null;
  }
}

export function applyReactionMeta(reaction) {
  if (!reaction) return reaction;
  const meta = extractReactionMeta(reaction);
  if (meta) {
    if (meta.customDuration) {
      reaction.customDuration = true;
      reaction.durationMode = 'fixed';
    }
    if (Number.isFinite(meta.duration)) {
      reaction.duration = meta.duration;
    }
  }
  if (Array.isArray(reaction.subtitles)) {
    reaction.subtitles = reaction.subtitles.filter(c => !c.text?.startsWith(META_CUE_PREFIX));
  }
  if (Array.isArray(reaction.cues)) {
    reaction.cues = reaction.cues.filter(c => !c.text?.startsWith(META_CUE_PREFIX));
  }
  return reaction;
}

export function validateReaction(input, media) {
  if (!input || typeof input !== 'object') throw new Error('Contenu invalide.');
  const meta = extractReactionMeta(input);
  const inputCustom = input.customDuration === true || meta?.customDuration === true;
  const inputDuration = Number.isFinite(Number(input.duration)) ? Number(input.duration) : (meta && Number.isFinite(Number(meta.duration)) ? Number(meta.duration) : null);
  const asset = typeof input.mediaId === 'string' ? media.get(input.mediaId) : null;
  if (input.mediaId && !asset) throw new Error('Ce fichier ne fait pas partie de cette room.');
  const audio = typeof input.audioId === 'string' ? media.get(input.audioId) : (asset?.kind === 'audio' ? asset : null);
  if (input.audioId && (!audio || (audio.kind !== 'audio' && audio.kind !== 'video'))) throw new Error('Piste audio invalide.');
  const visual = asset?.kind === 'audio' ? null : asset;
  const caption = cleanText(input.caption, 500);
  if (!visual && !audio && !caption) throw new Error('Ajoutez du texte ou un fichier.');
  // A bounded numeric fallback keeps the wire format readable by older clients.
  // Updated receivers always use the players' ended events for video/audio.
  const timed = hasTimedMedia({ media: visual, audio });
  const custom = timed && inputCustom && Number.isFinite(inputDuration);
  const automatic = timed && !custom;
  const maxDuration = timed ? 600 : LIMITS.durationMax;
  const duration = automatic ? LIMITS.durationMax : inputDuration;
  if (!Number.isFinite(duration) || duration < LIMITS.durationMin || duration > maxDuration) {
    throw new Error(timed ? 'La durée doit être comprise entre 0.1 et 600 secondes.' : 'La durée doit être comprise entre 0.1 et 15 secondes.');
  }
  let cleanSubtitles = validCues(input.subtitles);
  if (custom && !cleanSubtitles.some(c => c.text?.startsWith(META_CUE_PREFIX))) {
    cleanSubtitles = embedReactionMeta(cleanSubtitles, { customDuration: true, duration });
  }
  return { media: visual ? publicMedia(visual) : null, audio: audio ? publicMedia(audio) : null, name: visual?.name || audio?.name || caption.slice(0, 60), caption, subtitles: cleanSubtitles, duration, durationMode: automatic ? 'media' : 'fixed', ...(custom ? { customDuration: true } : {}) };
}
export function publicMedia(asset) { return { id: asset.id, name: asset.name, kind: asset.kind, mime: asset.mime, url: `/media/${asset.id}`, bytes: asset.bytes }; }
export function normalizeServer(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Saisissez une adresse de serveur HTTP(S), sans chemin.');
  return url.origin;
}

export function cleanClientState(input = {}) {
  const cleanServer = value => value === 'local' ? 'local' : normalizeServer(value);
  const rooms = [];
  for (const entry of Array.isArray(input.rooms) ? input.rooms.slice(0, 30) : []) {
    try {
      if (!entry || !/^[A-Z2-9]{8}$/.test(entry.code)) continue;
      const server = cleanServer(entry.server);
      if (!rooms.some(r => r.code === entry.code && r.server === server)) rooms.push({ code: entry.code, name: cleanText(entry.name, 40) || entry.code, server,
        ...(typeof entry.joinToken === 'string' && /^[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(entry.joinToken) ? { joinToken: entry.joinToken } : {}),
        ...(typeof entry.ownerToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(entry.ownerToken) ? { ownerToken: entry.ownerToken } : {}) });
    } catch { /* Ignore malformed local bookmarks. */ }
  }
  const active = rooms.find(r => r.code === input.active?.code && r.server === input.active?.server);
  return { nickname: cleanText(input.nickname, 24), rooms, active: active ? { code: active.code, server: active.server } : null, autoJoin: input.autoJoin !== false };
}

export function normalizeSearch(value) {
  return String(value || '')
    .toLocaleLowerCase('fr')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-_\s]+/g, ' ')
    .trim();
}

export function getGifDuration(buffer) {
  try {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 13) return null;
    const header = String.fromCharCode(...bytes.subarray(0, 6));
    if (header !== 'GIF87a' && header !== 'GIF89a') return null;

    let pos = 13;
    const gctFlag = bytes[10] & 0x80;
    if (gctFlag) {
      const gctSize = 3 * (1 << ((bytes[10] & 0x07) + 1));
      pos += gctSize;
    }

    let totalDelayHundredths = 0;
    let frameCount = 0;
    let lastDelay = 10;

    while (pos < bytes.length) {
      const block = bytes[pos++];
      if (block === 0x3B) break;
      if (block === 0x21) {
        if (pos >= bytes.length) break;
        const label = bytes[pos++];
        if (label === 0xF9) {
          if (pos >= bytes.length) break;
          const blockSize = bytes[pos++];
          if (pos + 2 < bytes.length) {
            const delay = bytes[pos + 1] | (bytes[pos + 2] << 8);
            lastDelay = delay <= 1 ? 10 : delay;
          }
          pos += blockSize;
          while (pos < bytes.length && bytes[pos] !== 0) pos += bytes[pos] + 1;
          pos++;
        } else {
          while (pos < bytes.length && bytes[pos] !== 0) pos += bytes[pos] + 1;
          pos++;
        }
      } else if (block === 0x2C) {
        pos += 8;
        if (pos >= bytes.length) break;
        const lctFlag = bytes[pos++] & 0x80;
        if (lctFlag) {
          const lctSize = 3 * (1 << ((bytes[pos - 1] & 0x07) + 1));
          pos += lctSize;
        }
        pos++;
        while (pos < bytes.length && bytes[pos] !== 0) pos += bytes[pos] + 1;
        pos++;
        frameCount++;
        totalDelayHundredths += lastDelay;
        lastDelay = 10;
      } else {
        break;
      }
    }

    if (frameCount <= 1 || totalDelayHundredths <= 0) return null;
    return {
      frameCount,
      durationSec: Math.round((totalDelayHundredths / 100) * 100) / 100
    };
  } catch {
    return null;
  }
}

