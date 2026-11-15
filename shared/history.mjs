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

const ASSET_KEYS = ['media', 'audio'];

// Apply `change(asset)` to every media/audio asset of every item; unchanged items keep their identity.
function mapAssets(list, change) {
  if (!Array.isArray(list)) return [];
  return list.map(item => {
    if (!item || typeof item !== 'object') return item;
    let next = item;
    for (const key of ASSET_KEYS) {
      const asset = item[key];
      if (!asset || typeof asset !== 'object') continue;
      const changed = change(asset);
      if (changed !== asset) next = { ...next, [key]: changed };
    }
    return next;
  });
}

// Local file to fall back on when the server copy expired: the saved name, or the sender's
// name for old items recorded before `savedName` existed.
export function savedFileName(asset) {
  return asset?.savedName || asset?.name || '';
}

// savedName = file name under which the main process saved an asset (set by asset id).
export function setSavedName(list, assetId, name) {
  return mapAssets(list, asset => (asset.id === assetId && asset.savedName !== name ? { ...asset, savedName: name } : asset));
}
export function renameSavedName(list, oldName, newName) {
  return mapAssets(list, asset => (asset.savedName === oldName ? { ...asset, savedName: newName } : asset));
}
export function removeSavedName(list, name) {
  return mapAssets(list, asset => {
    if (asset.savedName !== name) return asset;
    const { savedName, ...rest } = asset;
    return rest;
  });
}

// Keep the winner's `savedName`, or take it from a duplicate of the same asset.
function carrySavedNames(winner, other) {
  let next = winner;
  for (const key of ASSET_KEYS) {
    const asset = winner[key];
    const saved = other[key]?.savedName;
    if (asset && saved && !asset.savedName && other[key].id === asset.id) next = { ...next, [key]: { ...asset, savedName: saved } };
  }
  return next;
}

// Merge lists into one clean history; on a duplicate id the earliest list wins.
export function mergeHistory(...lists) {
  const position = new Map();
  const merged = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      if (position.has(item.id)) {
        const index = position.get(item.id);
        merged[index] = carrySavedNames(merged[index], item);
        continue;
      }
      position.set(item.id, merged.length);
      merged.push(item);
    }
  }
  return cleanHistory(merged);
}

// Items are shown in the room they were recorded in. Old items have no `room` and stay visible everywhere.
export function isInRoom(item, server, room) {
  if (!item?.room) return true;
  return item.room === room && (!item.server || item.server === server);
}
// Stamp the current room on items that do not have one yet (optional field of history.json).
export function withRoom(items, room) {
  if (!room) return items;
  return items.map(item => (item && typeof item === 'object' && !item.room ? { ...item, room } : item));
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
