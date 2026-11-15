import { LIMITS } from '../shared/protocol.mjs';
import { native, state, resolveServer } from './state.mjs';

function createSilentWavBlob(seconds) {
  const sampleRate = 8000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = Math.floor(seconds * byteRate);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
  }
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function extractAudioFromFileOrBuffer(name, arrayBuffer) {
  const result = await native.extractAudio({
    name,
    buffer: new Uint8Array(arrayBuffer)
  });
  const mime = result.mime || (result.name.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg');
  const blob = new Blob([result.buffer], { type: mime });
  return new File([blob], result.name, { type: mime });
}

export async function uploadMedia(file, currentEpoch, currentRoom) {
  const server = resolveServer(state.target.server);
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (currentEpoch !== state.epoch || state.room !== currentRoom) throw new Error('Connexion interrompue.');
    response = await fetch(`${server}/api/media`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${currentRoom.token}`,
        'Content-Type': 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name)
      },
      body: file,
      signal: AbortSignal.timeout(LIMITS.transferTimeoutMs)
    });
    if (response.status !== 429 || attempt === 2) break;
    await response.arrayBuffer();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Import impossible.');
  return data;
}

export async function uploadSilentAudio(durationSec) {
  const blob = createSilentWavBlob(durationSec);
  const file = new File([blob], 'silent_audio.wav', { type: 'audio/wav' });
  return uploadMedia(file, state.epoch, state.room);
}
