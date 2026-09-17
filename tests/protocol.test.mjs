import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSettings, cleanClientState, parseSubtitles, validCues, validateReaction, normalizeServer, hasTimedMedia, normalizeSearch, getGifDuration, embedReactionMeta, extractReactionMeta, applyReactionMeta } from '../shared/protocol.mjs';
import { detectMedia } from '../server/media.mjs';
test('preferences always respect receiver limits',()=>{
  const p=cleanSettings({size:99,volume:-12,cooldown:0,paused:'true',position:'evil',display:42});
  assert.equal(p.size,60);assert.equal(p.volume,0);assert.equal(p.cooldown,2);assert.equal(p.paused,false);assert.equal(p.position,'center');assert.equal(p.display,'primary');
  assert.equal(p.autoStart,true);
  assert.equal(cleanSettings().position,'center');
  assert.equal(cleanSettings().autoStart,true);
  assert.equal(cleanSettings({autoStart:false}).autoStart,true);
  assert.equal(cleanSettings({position:'bottom-left'}).position,'bottom-left');
});
test('SRT parsing preserves cues beyond 15 seconds and strips markup',()=>{
  const expected=[{start:1,end:3.5,text:'Salut\nles potes'},{start:20,end:22,text:'Suite'}];
  assert.deepEqual(parseSubtitles('1\r\n00:00:01,000 --> 00:00:03,500\r\n<b>Salut</b>\r\nles potes\r\n\r\n2\r\n00:00:20,000 --> 00:00:22,000\r\nSuite'),expected);
  assert.deepEqual(validCues(expected),expected);
  assert.deepEqual(validCues([{start:-1,end:2,text:'bad'},{start:2,end:Infinity,text:'bad'}]),[]);
});
test('messages accept plain text and reject empty content or media from another room',()=>{
  assert.throws(()=>validateReaction({mediaId:'outside',duration:5},new Map()));
  assert.throws(()=>validateReaction({caption:'Salut',duration:200},new Map()));
  assert.throws(()=>validateReaction({caption:'   ',duration:5},new Map()));
  assert.throws(()=>validateReaction({duration:5,audioId:'outside'},new Map()));
  const reaction=validateReaction({duration:5,caption:'<script>alert(1)</script>'},new Map());
  assert.equal(reaction.caption,'<script>alert(1)</script>'); // Rendering always uses textContent.
});
test('audio can be sent by itself, or with a visual and text',()=>{
  const media=new Map([['sound',{id:'sound',kind:'audio',name:'son.wav'}],['image',{id:'image',kind:'image',name:'image.png'}]]);
  assert.equal(validateReaction({audioId:'sound',duration:5},media).media,null);
  assert.equal(validateReaction({mediaId:'sound',duration:5},media).audio.id,'sound');
  const combined=validateReaction({mediaId:'image',audioId:'sound',caption:'Salut',duration:5},media);
  assert.equal(combined.media.id,'image');assert.equal(combined.audio.id,'sound');assert.equal(combined.caption,'Salut');
});
test('video can be used as audio-only, or combined with another visual video',()=>{
  const media=new Map([['v1',{id:'v1',kind:'video',name:'clip1.webm'}],['v2',{id:'v2',kind:'video',name:'clip2.mp4'}]]);
  const audioOnly=validateReaction({audioId:'v1',duration:5},media);
  assert.equal(audioOnly.media,null);assert.equal(audioOnly.audio.id,'v1');
  assert.equal(hasTimedMedia(audioOnly),true);assert.equal(audioOnly.durationMode,'media');
  const dual=validateReaction({mediaId:'v1',audioId:'v2',duration:5},media);
  assert.equal(dual.media.id,'v1');assert.equal(dual.audio.id,'v2');
  assert.equal(hasTimedMedia(dual),true);assert.equal(dual.durationMode,'media');
});
test('video and audio use playback completion; text and images keep a fixed timer',()=>{
  const media=new Map([['video',{id:'video',kind:'video',name:'clip.webm'}],['sound',{id:'sound',kind:'audio',name:'sound.wav'}],['image',{id:'image',kind:'image',name:'image.png'}]]);
  for (const input of [{mediaId:'video'},{audioId:'sound'},{mediaId:'image',audioId:'sound'},{mediaId:'video',audioId:'sound'}]) {
    const reaction=validateReaction({...input,duration:0.5},media);
    assert.equal(reaction.durationMode,'media'); assert.equal(hasTimedMedia(reaction),true);
    assert.equal(reaction.duration,15); // Compatibility value, never the updated receiver's playback timer.
  }
  assert.equal(validateReaction({mediaId:'image',duration:1},media).durationMode,'fixed');
  assert.equal(validateReaction({mediaId:'image',duration:1},media).duration,1);
  assert.equal(validateReaction({mediaId:'image',duration:0.1},media).durationMode,'fixed');
  assert.equal(validateReaction({mediaId:'image',duration:0.1},media).duration,0.1);
  assert.equal(validateReaction({mediaId:'image',duration:2},media).durationMode,'fixed');
  const customReaction = validateReaction({mediaId:'video',duration:4.5,customDuration:true},media);
  assert.equal(customReaction.durationMode,'fixed');
  assert.equal(customReaction.duration,4.5);
  assert.equal(customReaction.customDuration,true);
  assert.throws(()=>validateReaction({caption:'Text',duration:0.05},media), /entre 0\.1 et 15 secondes/);
});
test('saved room state preserves local server identity and deduplicates bookmarks',()=>{
  const room={code:'ABCD2345',name:'Les amis',server:'local'};
  const saved=cleanClientState({nickname:'Alice',rooms:[room,room,{code:'../../bad',server:'file:///etc'}],active:room});
  assert.equal(saved.rooms.length,1);assert.equal(saved.active.server,'local');assert.equal(saved.autoJoin,true);
  assert.equal(cleanClientState({rooms:[room],active:{code:'NOTFOUND',server:'local'}}).active,null);
});
test('server URLs cannot contain credentials, paths or non HTTP schemes',()=>{
  for(const url of ['file:///C:/secret','javascript:alert(1)','https://u:p@server.test','https://server.test/path'])assert.throws(()=>normalizeServer(url));
  assert.equal(normalizeServer('http://192.168.1.4:3210/'),'http://192.168.1.4:3210');
});
test('HTML and SVG uploads are refused even with image extensions',()=>{
  assert.equal(detectMedia(Buffer.from('<html><script>alert(1)</script></html>')),null);
  assert.equal(detectMedia(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),null);
  const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);assert.deepEqual(detectMedia(png),{mime:'image/png',kind:'image'});
});
test('silent WAV header is valid and recognized as audio/wav',()=>{
  const sampleRate = 8000, numChannels = 1, bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = Math.floor(20 * byteRate);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  assert.deepEqual(detectMedia(buffer), { mime: 'audio/wav', kind: 'audio' });
});

test('normalizeSearch treats spaces, hyphens, and underscores equivalently', () => {
  const query = 'meme drole';
  const queryNormalized = normalizeSearch(query);
  assert.equal(queryNormalized, 'meme drole');

  const filenames = ['meme drole.png', 'meme_drole.png', 'meme-drole.png', 'mème drôle.png', 'MÉMÉ-DRÔLE.mp4'];
  for (const name of filenames) {
    assert.ok(normalizeSearch(name).includes(queryNormalized), `"${name}" should match query "${query}"`);
  }

  assert.ok(normalizeSearch('meme drole.png').includes(normalizeSearch('meme_drole')));
  assert.ok(normalizeSearch('meme drole.png').includes(normalizeSearch('meme-drole')));
  assert.equal(normalizeSearch('autre_meme.png').includes(queryNormalized), false);
});

test('getGifDuration calculates animated GIF loop duration and handles static/corrupted files', () => {
  assert.equal(getGifDuration(Buffer.alloc(0)), null);
  assert.equal(getGifDuration(Buffer.from('not a gif')), null);

  const gifBytes = Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
    0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x21, 0xF9, 0x04, 0x00, 0x32, 0x00, 0x00, 0x00, // delay 50 = 0.5s
    0x2C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0x02, 0x00,
    0x21, 0xF9, 0x04, 0x00, 0x64, 0x00, 0x00, 0x00, // delay 100 = 1.0s
    0x2C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0x02, 0x00,
    0x3B
  ]);

  const result = getGifDuration(gifBytes);
  assert.ok(result);
  assert.equal(result.frameCount, 2);
  assert.equal(result.durationSec, 1.5);

  const staticGif = Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x2C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0x02, 0x00,
    0x3B
  ]);
  assert.equal(getGifDuration(staticGif), null);
});

test('validateReaction supports custom duration with image/gif and audio', () => {
  const media = new Map([
    ['gif', { id: 'gif', kind: 'image', name: 'animation.gif' }],
    ['sound', { id: 'sound', kind: 'audio', name: 'sound.wav' }]
  ]);
  const reaction = validateReaction({ mediaId: 'gif', audioId: 'sound', duration: 4.5, customDuration: true }, media);
  assert.equal(reaction.durationMode, 'fixed');
  assert.equal(reaction.duration, 4.5);
  assert.equal(reaction.customDuration, true);
});

test('embedReactionMeta and applyReactionMeta preserve customDuration through legacy server roundtrip', () => {
  const media = new Map([
    ['gif', { id: 'gif', kind: 'image', name: 'animation.gif' }],
    ['sound', { id: 'sound', kind: 'audio', name: 'sound.wav' }]
  ]);
  // Sender creates payload with customDuration
  const embedded = embedReactionMeta([{ start: 0, end: 2, text: 'Hello' }], { customDuration: true, duration: 2.5 });
  assert.equal(embedded.length, 2);

  // Simulate legacy v0.5.0 server: strips customDuration, sets durationMode='media', sets duration=15, but keeps subtitles
  const legacyServerBroadcast = {
    media: { id: 'gif', kind: 'image' },
    audio: { id: 'sound', kind: 'audio' },
    duration: 15,
    durationMode: 'media',
    subtitles: validCues(embedded)
  };

  // Receiver receives broadcast and applies reaction metadata
  const restored = applyReactionMeta({ ...legacyServerBroadcast });
  assert.equal(restored.customDuration, true);
  assert.equal(restored.duration, 2.5);
  assert.equal(restored.durationMode, 'fixed');
  assert.equal(restored.subtitles.length, 1);
  assert.equal(restored.subtitles[0].text, 'Hello');
});

