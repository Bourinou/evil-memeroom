import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanSettings,
  cleanClientState,
  parseSubtitles,
  validCues,
  validateReaction,
  normalizeServer,
  hasTimedMedia,
} from '../shared/protocol.mjs';
import { detectMedia } from '../server/media.mjs';
test('preferences always respect receiver limits', () => {
  const p = cleanSettings({
    size: 99,
    volume: -12,
    cooldown: 0,
    paused: 'true',
    position: 'evil',
    display: 42,
  });
  assert.equal(p.size, 60);
  assert.equal(p.volume, 0);
  assert.equal(p.cooldown, 3);
  assert.equal(p.paused, false);
  assert.equal(p.position, 'center');
  assert.equal(p.display, 'primary');
  assert.equal(cleanSettings().position, 'center');
  assert.equal(cleanSettings({ position: 'bottom-left' }).position, 'bottom-left');
});
test('SRT parsing preserves cues beyond 15 seconds and strips markup', () => {
  const expected = [
    { start: 1, end: 3.5, text: 'Salut\nles potes' },
    { start: 20, end: 22, text: 'Suite' },
  ];
  assert.deepEqual(
    parseSubtitles(
      '1\r\n00:00:01,000 --> 00:00:03,500\r\n<b>Salut</b>\r\nles potes\r\n\r\n2\r\n00:00:20,000 --> 00:00:22,000\r\nSuite',
    ),
    expected,
  );
  assert.deepEqual(validCues(expected), expected);
  assert.deepEqual(
    validCues([
      { start: -1, end: 2, text: 'bad' },
      { start: 2, end: Infinity, text: 'bad' },
    ]),
    [],
  );
});
test('messages accept plain text and reject empty content or media from another room', () => {
  assert.throws(() => validateReaction({ mediaId: 'outside', duration: 5 }, new Map()));
  assert.throws(() => validateReaction({ caption: 'Salut', duration: 200 }, new Map()));
  assert.throws(() => validateReaction({ caption: '   ', duration: 5 }, new Map()));
  assert.throws(() => validateReaction({ duration: 5, audioId: 'outside' }, new Map()));
  const reaction = validateReaction(
    { duration: 5, caption: '<script>alert(1)</script>' },
    new Map(),
  );
  assert.equal(reaction.caption, '<script>alert(1)</script>'); // Rendering always uses textContent.
});
test('audio can be sent by itself, or with a visual and text', () => {
  const media = new Map([
    ['sound', { id: 'sound', kind: 'audio', name: 'son.wav' }],
    ['image', { id: 'image', kind: 'image', name: 'image.png' }],
  ]);
  assert.equal(validateReaction({ audioId: 'sound', duration: 5 }, media).media, null);
  assert.equal(validateReaction({ mediaId: 'sound', duration: 5 }, media).audio.id, 'sound');
  const combined = validateReaction(
    { mediaId: 'image', audioId: 'sound', caption: 'Salut', duration: 5 },
    media,
  );
  assert.equal(combined.media.id, 'image');
  assert.equal(combined.audio.id, 'sound');
  assert.equal(combined.caption, 'Salut');
});
test('video and audio use playback completion; text and images keep a fixed timer', () => {
  const media = new Map([
    ['video', { id: 'video', kind: 'video', name: 'clip.webm' }],
    ['sound', { id: 'sound', kind: 'audio', name: 'sound.wav' }],
    ['image', { id: 'image', kind: 'image', name: 'image.png' }],
  ]);
  for (const input of [
    { mediaId: 'video' },
    { audioId: 'sound' },
    { mediaId: 'image', audioId: 'sound' },
    { mediaId: 'video', audioId: 'sound' },
  ]) {
    const reaction = validateReaction({ ...input, duration: 0.5 }, media);
    assert.equal(reaction.durationMode, 'media');
    assert.equal(hasTimedMedia(reaction), true);
    assert.equal(reaction.duration, 15); // Compatibility value, never the updated receiver's playback timer.
  }
  assert.equal(validateReaction({ mediaId: 'image', duration: 2 }, media).durationMode, 'fixed');
  assert.throws(() =>
    validateReaction({ caption: 'Text', duration: 0.5, durationMode: 'media' }, media),
  );
});
test('saved room state preserves local server identity and deduplicates bookmarks', () => {
  const room = { code: 'ABCD2345', name: 'Les amis', server: 'local' };
  const saved = cleanClientState({
    nickname: 'Alice',
    rooms: [room, room, { code: '../../bad', server: 'file:///etc' }],
    active: room,
  });
  assert.equal(saved.rooms.length, 1);
  assert.equal(saved.active.server, 'local');
  assert.equal(saved.autoJoin, true);
  assert.equal(
    cleanClientState({ rooms: [room], active: { code: 'NOTFOUND', server: 'local' } }).active,
    null,
  );
});
test('server URLs cannot contain credentials, paths or non HTTP schemes', () => {
  for (const url of [
    'file:///C:/secret',
    'javascript:alert(1)',
    'https://u:p@server.test',
    'https://server.test/path',
  ])
    assert.throws(() => normalizeServer(url));
  assert.equal(normalizeServer('http://192.168.1.4:3210/'), 'http://192.168.1.4:3210');
});
test('HTML and SVG uploads are refused even with image extensions', () => {
  assert.equal(detectMedia(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.equal(detectMedia(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  assert.deepEqual(detectMedia(png), { mime: 'image/png', kind: 'image' });
});
