// Recognize allowed containers from their bytes; never trust a filename or Content-Type.
export function detectMedia(buffer) {
  if (buffer.length < 12) return null;
  const ascii = (a, b) => buffer.toString('ascii', a, b);
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return { mime: 'image/png', kind: 'image' };
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return { mime: 'image/jpeg', kind: 'image' };
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return { mime: 'image/gif', kind: 'image' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP')
    return { mime: 'image/webp', kind: 'image' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE')
    return { mime: 'audio/wav', kind: 'audio' };
  if (ascii(4, 8) === 'ftyp') return { mime: 'video/mp4', kind: 'video' };
  if (
    buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
    buffer.subarray(0, 4096).includes(Buffer.from('webm'))
  )
    return { mime: 'video/webm', kind: 'video' };
  if (ascii(0, 3) === 'ID3' || (buffer[0] === 255 && (buffer[1] & 0xe0) === 0xe0))
    return { mime: 'audio/mpeg', kind: 'audio' };
  if (
    ascii(0, 4) === 'OggS' &&
    (buffer.subarray(0, 4096).includes(Buffer.from('OpusHead')) ||
      buffer.subarray(0, 4096).includes(Buffer.from('vorbis')))
  )
    return { mime: 'audio/ogg', kind: 'audio' };
  return null;
}
