import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMedia } from '../server/media.mjs';

const ftyp = brand => {
  const buffer = Buffer.alloc(24);
  buffer.writeUInt32BE(24, 0);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write(brand, 8, 'ascii');
  return buffer;
};
const mp3Frame = (b1, b2, b3 = 0) => Buffer.from([0xff, b1, b2, b3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

test('accepts known MP4 brands', () => {
  for (const brand of ['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash', 'MSNV', 'mmp4', 'f4v ', '3gp4', '3gp5', '3gp6', '3gp7']) {
    assert.deepEqual(detectMedia(ftyp(brand)), { mime: 'video/mp4', kind: 'video' }, brand);
  }
});

test('rejects non-MP4 ftyp containers', () => {
  for (const brand of ['heic', 'heix', 'mif1', 'avif', 'avis', 'qt  ', 'M4A ', 'M4B ']) {
    assert.equal(detectMedia(ftyp(brand)), null, brand);
  }
});

test('accepts ID3 and valid MP3 frame headers', () => {
  const mpeg = { mime: 'audio/mpeg', kind: 'audio' };
  assert.deepEqual(detectMedia(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(13)])), mpeg);
  assert.deepEqual(detectMedia(mp3Frame(0xfb, 0x90)), mpeg); // MPEG1 L3 128k 44.1k
  assert.deepEqual(detectMedia(mp3Frame(0xf3, 0x90)), mpeg); // MPEG2 L3
  assert.deepEqual(detectMedia(mp3Frame(0xe3, 0x90)), mpeg); // MPEG2.5 L3
});

test('rejects invalid MP3 frame headers', () => {
  assert.equal(detectMedia(mp3Frame(0xeb, 0x90)), null); // reserved version (01)
  assert.equal(detectMedia(mp3Frame(0xf9, 0x90)), null); // reserved layer (00)
  assert.equal(detectMedia(mp3Frame(0xfb, 0xf0)), null); // bad bitrate (1111)
  assert.equal(detectMedia(mp3Frame(0xfb, 0x0c)), null); // reserved sample rate (11)
  assert.equal(detectMedia(mp3Frame(0xe0, 0x00)), null); // free bitrate, reserved layer
});

test('keeps detecting WebM (video and audio-only) and Ogg unchanged', () => {
  const ebml = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]);
  const webm = Buffer.concat([ebml, Buffer.from('Bwebm'), Buffer.alloc(16)]);
  assert.deepEqual(detectMedia(webm), { mime: 'video/webm', kind: 'video' });
  const audioWebm = Buffer.concat([ebml, Buffer.from('Bwebm'), Buffer.from('A_OPUS'), Buffer.alloc(16)]);
  assert.deepEqual(detectMedia(audioWebm), { mime: 'video/webm', kind: 'video' });
  assert.equal(detectMedia(Buffer.concat([ebml, Buffer.from('matroska'), Buffer.alloc(16)])), null);
  assert.deepEqual(detectMedia(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(24), Buffer.from('OpusHead')])), { mime: 'audio/ogg', kind: 'audio' });
});
