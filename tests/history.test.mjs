import test from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_LIMIT, cleanHistory, mergeHistory, toHistoryItem, setSavedName, renameSavedName, removeSavedName, savedFileName } from '../shared/history.mjs';

const text = (id, sentAt) => ({ id, caption: `m${id}`, sentAt });

test('cleanHistory drops empty items and sorts newest first', () => {
  const list = [text('a', 1), null, 'x', { id: 'e', caption: '  ' }, text('c', 3), text('b', 2), { id: 'm', media: { name: 'x.png' }, sentAt: 5 }];
  assert.deepEqual(cleanHistory(list).map(item => item.id), ['m', 'c', 'b', 'a']);
  assert.deepEqual(cleanHistory('nope'), []);
});

test('cleanHistory caps to the newest HISTORY_LIMIT items', () => {
  const list = Array.from({ length: HISTORY_LIMIT + 20 }, (_, i) => text(`i${i}`, i));
  const clean = cleanHistory(list);
  assert.equal(clean.length, HISTORY_LIMIT);
  assert.equal(clean[0].id, `i${HISTORY_LIMIT + 19}`);
  assert.equal(clean.at(-1).id, 'i20');
});

test('mergeHistory dedupes by id, earliest list wins, result sorted', () => {
  const merged = mergeHistory([{ ...text('a', 5), sender: 'first' }], [{ ...text('a', 5), sender: 'second' }, text('b', 9)], undefined);
  assert.deepEqual(merged.map(item => item.id), ['b', 'a']);
  assert.equal(merged[1].sender, 'first');
});

test('toHistoryItem keeps subtitles, customDuration and legacy cues', () => {
  const cues = [{ start: 0, end: 1, text: 'hi' }];
  const fromEvent = toHistoryItem({ id: 1, sender: { name: 'Ana' }, caption: 'x', subtitles: cues, customDuration: true, duration: 8, sentAt: 7 }, 'http://s');
  assert.deepEqual(fromEvent.subtitles, cues);
  assert.equal(fromEvent.customDuration, true);
  assert.equal(fromEvent.sender, 'Ana');
  const fromServer = toHistoryItem({ id: 2, sender: 'Bob', audio: { name: 'a.mp3' }, cues, sentAt: 1 }, 'http://s');
  assert.deepEqual(fromServer.subtitles, cues);
  assert.equal(fromServer.kind, 'audio');
  assert.equal('customDuration' in fromServer, false);
  assert.equal(fromServer.duration, 5);
});

test('savedName is set by asset id, renamed and removed without touching other items', () => {
  const item = (id, media, audio) => ({ id, sentAt: 1, media, audio });
  const list = [item('a', { id: 'm1', name: 'lol.gif' }), item('b', { id: 'm2', name: 'x.png' }, { id: 'a1', name: 'snd.mp3' }), text('c', 1)];
  const set = setSavedName(setSavedName(list, 'm1', 'lol 1.gif'), 'a1', 'snd.mp3');
  assert.equal(set[0].media.savedName, 'lol 1.gif');
  assert.equal(set[1].audio.savedName, 'snd.mp3');
  assert.equal(set[1].media.savedName, undefined);
  assert.equal(set[2], list[2]);
  assert.equal(list[0].media.savedName, undefined);
  const renamed = renameSavedName(set, 'lol 1.gif', 'better.gif');
  assert.equal(renamed[0].media.savedName, 'better.gif');
  assert.equal(renamed[1], set[1]);
  const removed = removeSavedName(renamed, 'better.gif');
  assert.equal('savedName' in removed[0].media, false);
  assert.equal(removed[0].media.name, 'lol.gif');
});

test('mergeHistory keeps savedName when a duplicate without it wins', () => {
  const stored = [{ id: 'a', sentAt: 1, media: { id: 'm1', name: 'lol.gif', savedName: 'lol 1.gif' } }];
  const incoming = [{ id: 'a', sentAt: 1, media: { id: 'm1', name: 'lol.gif', url: '/media/m1' } }];
  const [item] = mergeHistory(incoming, stored);
  assert.equal(item.media.url, '/media/m1');
  assert.equal(item.media.savedName, 'lol 1.gif');
  assert.equal(mergeHistory([{ id: 'a', sentAt: 1, media: { id: 'other', name: 'z.gif' } }], stored)[0].media.savedName, undefined);
});

test('savedFileName prefers savedName and keeps the legacy name fallback', () => {
  assert.equal(savedFileName({ name: 'lol.gif', savedName: 'lol 1.gif' }), 'lol 1.gif');
  assert.equal(savedFileName({ name: 'old.gif' }), 'old.gif');
  assert.equal(savedFileName(null), '');
});
