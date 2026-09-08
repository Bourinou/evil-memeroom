import { LIMITS } from './limits.mjs';
import { cleanText } from './text.mjs';
import { validCues } from './subtitles.mjs';

export function hasTimedMedia(reaction) {
  return (
    reaction.media?.kind === 'video' ||
    reaction.media?.kind === 'audio' ||
    reaction.audio?.kind === 'audio'
  );
}

/** @param {import('./contracts').ReactionInput} input */
export function validateReaction(input, media) {
  if (!input || typeof input !== 'object') throw new Error('Contenu invalide.');
  const asset = typeof input.mediaId === 'string' ? media.get(input.mediaId) : null;
  if (input.mediaId && !asset) throw new Error('Ce fichier ne fait pas partie de cette room.');
  const audio =
    typeof input.audioId === 'string'
      ? media.get(input.audioId)
      : asset?.kind === 'audio'
        ? asset
        : null;
  if (input.audioId && (!audio || audio.kind !== 'audio')) throw new Error('Piste audio invalide.');
  const visual = asset?.kind === 'audio' ? null : asset;
  const caption = cleanText(input.caption, 500);
  if (!visual && !audio && !caption) throw new Error('Ajoutez du texte ou un fichier.');
  // A bounded numeric fallback keeps the wire format readable by older clients.
  // Updated receivers always use the players' ended events for video/audio.
  const automatic = hasTimedMedia({ media: visual, audio });
  const duration = automatic ? LIMITS.durationMax : Number(input.duration);
  if (!Number.isFinite(duration) || duration < LIMITS.durationMin || duration > LIMITS.durationMax)
    throw new Error('La durée doit être comprise entre 2 et 15 secondes.');
  return {
    media: visual ? publicMedia(visual) : null,
    audio: audio ? publicMedia(audio) : null,
    name: visual?.name || audio?.name || caption.slice(0, 60),
    caption,
    subtitles: validCues(input.subtitles),
    duration,
    durationMode: automatic ? 'media' : 'fixed',
  };
}

export function publicMedia(asset) {
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    mime: asset.mime,
    url: `/media/${asset.id}`,
    bytes: asset.bytes,
  };
}
