import { LIMITS } from '../shared/protocol.mjs';

// Maps preserve insertion order: eviction is FIFO by successful upload.
export function makeMediaSpace(room, rooms, media, bytes, totalBytes, limits = LIMITS) {
  if (bytes > limits.roomBytes || bytes > limits.totalBytes) throw Object.assign(new Error('Le fichier dépasse la capacité de stockage.'), { status: 413 });
  const changed = new Set(), removed = [];
  const remove = asset => {
    if (!asset) throw Object.assign(new Error('Impossible de libérer le stockage.'), { status: 507 });
    const owner = rooms.get(asset.roomCode);
    owner.media.delete(asset.id); owner.bytes -= asset.bytes;
    media.delete(asset.id); totalBytes -= asset.bytes; changed.add(owner); removed.push(asset);
  };
  while (room.media.size >= limits.mediaCount || room.bytes + bytes > limits.roomBytes) remove(room.media.values().next().value);
  while (totalBytes + bytes > limits.totalBytes) remove(media.values().next().value);
  return { totalBytes, changed, removed };
}
