export const HISTORY_LIMIT = 100;

function hasContent(item) {
  const hasCaption = typeof item.caption === 'string' && item.caption.trim().length > 0;
  const hasMedia = item.media && typeof item.media === 'object' && (item.media.url || item.media.name);
  const hasAudio = item.audio && typeof item.audio === 'object' && (item.audio.url || item.audio.name);
  return Boolean(hasCaption || hasMedia || hasAudio);
}

// Keep usable items, newest first (by sentAt), at most HISTORY_LIMIT.
export function cleanHistory(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(item => item && typeof item === 'object' && hasContent(item))
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (Number(b.item.sentAt) || 0) - (Number(a.item.sentAt) || 0) || a.index - b.index)
    .slice(0, HISTORY_LIMIT)
    .map(entry => entry.item);
}

// Merge lists into one clean history; on a duplicate id the earliest list wins.
export function mergeHistory(...lists) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== 'object' || seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }
  return cleanHistory(merged);
}

// Build a history item from a live reaction event or a server history entry.
export function toHistoryItem(source, server) {
  const sender = source.sender?.name || (typeof source.sender === 'string' ? source.sender : 'Inconnu');
  const media = source.media || null;
  const audio = source.audio || null;
  const subtitles = Array.isArray(source.subtitles) ? source.subtitles : Array.isArray(source.cues) ? source.cues : [];
  return {
    id: source.id,
    sender,
    caption: source.caption || '',
    media,
    audio,
    subtitles,
    duration: source.duration || 5,
    ...(source.customDuration === true ? { customDuration: true } : {}),
    sentAt: source.sentAt || Date.now(),
    server,
    kind: source.kind || media?.kind || (audio ? 'audio' : 'text')
  };
}
