// Recognize allowed containers from their bytes; never trust a filename or Content-Type.
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const WEBM_NEEDLE = Buffer.from('webm');
const OPUS_NEEDLE = Buffer.from('OpusHead');
const VORBIS_NEEDLE = Buffer.from('vorbis');

export function detectMedia(buffer) {
  if (buffer.length < 12) return null;
  const ascii = (a, b) => buffer.toString('ascii', a, b);
  if (buffer.subarray(0, 8).equals(PNG_MAGIC)) return { mime: 'image/png', kind: 'image' };
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return { mime: 'image/jpeg', kind: 'image' };
  const gif = ascii(0, 6);
  if (gif === 'GIF87a' || gif === 'GIF89a') return { mime: 'image/gif', kind: 'image' };
  const riff = ascii(0, 4);
  if (riff === 'RIFF') {
    const sub = ascii(8, 12);
    if (sub === 'WEBP') return { mime: 'image/webp', kind: 'image' };
    if (sub === 'WAVE') return { mime: 'audio/wav', kind: 'audio' };
  }
  if (ascii(4, 8) === 'ftyp') return { mime: 'video/mp4', kind: 'video' };
  const head = buffer.subarray(0, 4096);
  if (buffer.subarray(0, 4).equals(EBML_MAGIC) && head.includes(WEBM_NEEDLE)) return { mime: 'video/webm', kind: 'video' };
  if (ascii(0, 3) === 'ID3' || (buffer[0] === 255 && (buffer[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', kind: 'audio' };
  if (riff === 'OggS' && (head.includes(OPUS_NEEDLE) || head.includes(VORBIS_NEEDLE))) return { mime: 'audio/ogg', kind: 'audio' };
  return null;
}

