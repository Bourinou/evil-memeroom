import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WebSocket } from 'ws';
import { createRoomServer } from '../server/index.mjs';
import { makeMediaSpace } from '../server/media-capacity.mjs';
let sequence=0;
async function client(base,ip){
  const ws=new WebSocket(base.replace('http:','ws:')+'/ws',ip?{headers:{'X-Forwarded-For':ip}}:undefined);await once(ws,'open');
  const events=[],pending=new Map();ws.on('message',raw=>{const value=JSON.parse(raw);if(value.replyTo&&pending.has(value.replyTo)){const p=pending.get(value.replyTo);pending.delete(value.replyTo);clearTimeout(p.timer);value.ok?p.resolve(value.data):p.reject(new Error(value.error));}else events.push(value);});
  return {ws,events,request(type,data={}){const id=String(++sequence);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Test timed out')),2000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,type,data}));});}};
}
async function fixture(t,options={}){const server=createRoomServer({host:'127.0.0.1',port:0,dataDir:null,...options});const address=await server.start();t.after(()=>server.stop());return `http://127.0.0.1:${address.port}`;}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('three participants share reactions, other rooms stay isolated',async t=>{
  const base=await fixture(t,{cooldownMs:0});const a=await client(base),b=await client(base),c=await client(base),outsider=await client(base);
  const room=await a.request('create',{name:'Alice',roomName:'Les potes',desktop:true});
  await b.request('join',{name:'Bob',code:room.code,desktop:true});await c.request('join',{name:'Chloé',code:room.code,desktop:false});await outsider.request('create',{name:'Autre'});
  await a.request('broadcast',{duration:4,caption:'Quel move !'});await pause(25);
  for(const member of [a,b,c]){const reaction=member.events.find(e=>e.type==='reaction');assert.equal(reaction.caption,'Quel move !');assert.equal(reaction.sender.name,'Alice');assert.equal(reaction.duration,4);}
  assert.equal(outsider.events.filter(e=>e.type==='reaction').length,0);
  await b.request('status',{paused:true});await pause(15);assert.equal(a.events.filter(e=>e.type==='members').at(-1).members.find(m=>m.name==='Bob').paused,true);
  await c.request('leave');await a.request('broadcast',{caption:'Salut',duration:2});await pause(15);assert.equal(c.events.filter(e=>e.type==='reaction').length,1);
});
test('uploads require membership, validate bytes, support range requests, stay in their room',async t=>{
  const base=await fixture(t,{cooldownMs:0});const a=await client(base),b=await client(base);const room=await a.request('create',{name:'Alice'});await b.request('create',{name:'Bob'});
  assert.equal((await fetch(base+'/api/media',{method:'POST',body:'test'})).status,401);
  const headers={Authorization:`Bearer ${room.token}`,'X-Filename':'hello.png','Content-Type':'image/png'};
  assert.equal((await fetch(base+'/api/media',{method:'POST',headers,body:'<script>attack</script>'})).status,415);
  const buffer=await readFile(new URL('../public/icon.png',import.meta.url));
  const response=await fetch(base+'/api/media',{method:'POST',headers,body:buffer});assert.equal(response.status,201);const asset=await response.json();
  const range=await fetch(base+asset.url,{headers:{Range:'bytes=0-7'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,8);
  const suffix=await fetch(base+asset.url,{headers:{Range:'bytes=-4'}});assert.equal((await suffix.arrayBuffer()).byteLength,4);
  assert.equal((await fetch(base+asset.url,{headers:{Range:'bytes=999999-'}})).status,416);
  await assert.rejects(b.request('broadcast',{mediaId:asset.id,duration:3}),/cette room/);
  await a.request('broadcast',{mediaId:asset.id,duration:3});
  await a.request('leave');assert.equal((await fetch(base+'/api/media',{method:'POST',headers,body:buffer})).status,401);
});
test('invalid room code, malformed payload, rate limit and untrusted origins are handled',async t=>{
  const base=await fixture(t);const a=await client(base);await assert.rejects(a.request('join',{name:'Alice',code:'WRONG'}),/introuvable/);
  await a.request('create',{name:'Alice'});await assert.rejects(a.request('broadcast',{caption:'Salut',duration:16}),/durée/);
  await a.request('broadcast',{caption:'Salut',duration:3});await assert.rejects(a.request('broadcast',{caption:'Salut',duration:3}),/Patientez/);
  assert.equal((await fetch(base+'/api/health',{headers:{Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await fetch(base+'/../package.json')).status,404);
  a.ws.send('not-json');await pause(10);assert.ok(a.events.some(e=>e.ok===false));
  assert.equal((await fetch(base+'/api/health')).status,200);
});
test('reconnect can rejoin a room and recover its recent history',async t=>{
  const base=await fixture(t,{cooldownMs:0});const a=await client(base);const room=await a.request('create',{name:'Alice'});await a.request('broadcast',{caption:'Salut',duration:2});a.ws.close();await once(a.ws,'close');
  const reconnect=await client(base);const snapshot=await reconnect.request('join',{name:'Alice',code:room.code});assert.equal(snapshot.history.length,1);assert.equal(snapshot.members.length,1);assert.notEqual(snapshot.token,room.token);
});
test('empty rooms and their media expire',async t=>{
  const base=await fixture(t,{emptyRoomTtlMs:40});const a=await client(base);const room=await a.request('create',{name:'Alice'});await a.request('leave');await pause(100);await assert.rejects(a.request('join',{name:'Alice',code:room.code}),/introuvable/);
});
test('saved rooms survive an idle expiry and a complete server restart with the same code',async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'memeroom-persistence-'));
  let server=createRoomServer({host:'127.0.0.1',port:0,dataDir,emptyRoomTtlMs:40});
  t.after(()=>server.stop());
  let address=await server.start();let a=await client(`http://127.0.0.1:${address.port}`);
  const room=await a.request('create',{name:'Alice',roomName:'Room permanente'});
  assert.equal(room.persistent,true);await a.request('leave');await pause(100);
  await a.request('join',{name:'Alice',code:room.code});
  const disk=JSON.parse(await readFile(path.join(dataDir,'rooms.json'),'utf8'));
  assert.deepEqual(disk.rooms.map(({code,name})=>({code,name})),[{code:room.code,name:'Room permanente'}]);
  assert.equal(disk.version,3); assert.equal(disk.rooms[0].isPrivate,true);assert.equal(typeof disk.rooms[0].lastActive,'number');
  assert.ok(!JSON.stringify(disk).includes(room.token));
  await server.stop();server=createRoomServer({host:'127.0.0.1',port:0,dataDir});address=await server.start();
  a=await client(`http://127.0.0.1:${address.port}`);const restored=await a.request('join',{name:'Alice',code:room.code});
  assert.equal(restored.code,room.code);assert.equal(restored.name,room.name);assert.equal(restored.members.length,1);
});
test('an unreadable saved-room file is not silently replaced',async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'memeroom-corrupt-'));await writeFile(path.join(dataDir,'rooms.json'),'not json');
  const server=createRoomServer({host:'127.0.0.1',port:0,dataDir});t.after(()=>server.stop());
  await assert.rejects(server.start());assert.equal(await readFile(path.join(dataDir,'rooms.json'),'utf8'),'not json');
});
test('creation reports storage failures and does not acknowledge an unsaved room',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'memeroom-storage-'));const dataDir=path.join(directory,'rooms');
  const server=createRoomServer({host:'127.0.0.1',port:0,dataDir});t.after(()=>server.stop());const address=await server.start();
  await writeFile(dataDir,'blocking file');const a=await client(`http://127.0.0.1:${address.port}`);
  await assert.rejects(a.request('create',{name:'Alice'}),/enregistrer/);
});
test('history keeps subtitles and custom duration for reconnecting clients',async t=>{
  const base=await fixture(t,{cooldownMs:0});const a=await client(base);const room=await a.request('create',{name:'Alice'});
  await a.request('broadcast',{caption:'Salut',duration:5,customDuration:true,subtitles:[{start:0,end:1,text:'hello'}]});await pause(25);
  const reaction=a.events.find(e=>e.type==='reaction');a.ws.close();await once(a.ws,'close');
  const item=(await (await client(base)).request('join',{name:'Alice',code:room.code})).history[0];
  assert.ok(item.subtitles.some(c=>c.text==='hello'));assert.deepEqual(item.subtitles,reaction.subtitles);assert.deepEqual(item.cues,item.subtitles);
  assert.equal(item.customDuration,reaction.customDuration);assert.equal(item.duration,reaction.duration);
});
test('unexpected upload errors are 500s and full storage carries an explicit status',async t=>{
  t.mock.method(console,'error',()=>{});
  const base=await fixture(t,{scanMedia:async()=>{throw new Error('boom');}});const a=await client(base);const room=await a.request('create',{name:'Alice'});
  const buffer=await readFile(new URL('../public/icon.png',import.meta.url));
  const response=await fetch(base+'/api/media',{method:'POST',headers:{Authorization:`Bearer ${room.token}`,'X-Filename':'a.png'},body:buffer});
  assert.equal(response.status,500);assert.doesNotMatch((await response.json()).error,/boom/);
  const limits={roomBytes:10,totalBytes:10,mediaCount:5};
  assert.throws(()=>makeMediaSpace({media:new Map(),bytes:0},new Map(),new Map(),11,0,limits),{status:413});
  assert.throws(()=>makeMediaSpace({media:new Map(),bytes:5},new Map(),new Map(),8,5,limits),{status:507});
});
test('health reports the version from package.json',async t=>{
  const base=await fixture(t);const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const health=await (await fetch(base+'/api/health')).json();
  assert.equal(health.version,pkg.version);
  assert.equal(health.features.nativeDuration,true);
});
const roomCodeAt=i=>'ROOM'+String.fromCharCode(65+Math.floor(i/26))+String.fromCharCode(65+i%26)+'AA';
const savedRoom=(i,extra={})=>({code:roomCodeAt(i),name:'Room '+i,isPrivate:true,passwordHash:null,ownerHash:null,accessKey:'k'.repeat(43),...extra});
async function seededServer(t,version,rooms){
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'memeroom-purge-'));await writeFile(path.join(dataDir,'rooms.json'),JSON.stringify({version,rooms}));
  const server=createRoomServer({host:'127.0.0.1',port:0,dataDir,trustProxy:true});t.after(()=>server.stop());const address=await server.start();
  return {dataDir,base:`http://127.0.0.1:${address.port}`};
}
const readRooms=async dataDir=>JSON.parse(await readFile(path.join(dataDir,'rooms.json'),'utf8'));
test('a full server evicts the oldest inactive room and saves the new one',async t=>{
  const rooms=Array.from({length:100},(_,i)=>savedRoom(i,{lastActive:1000+i}));rooms[50].lastActive=1;
  const {dataDir,base}=await seededServer(t,3,rooms);const a=await client(base);
  const created=await a.request('create',{name:'Alice'});
  const disk=await readRooms(dataDir);assert.equal(disk.version,3);assert.equal(disk.rooms.length,100);
  assert.ok(!disk.rooms.some(r=>r.code===roomCodeAt(50)));assert.ok(disk.rooms.some(r=>r.code===roomCodeAt(0)));assert.ok(disk.rooms.some(r=>r.code===created.code));
  await assert.rejects(a.request('join',{name:'Alice',code:roomCodeAt(50)}),/introuvable/);
});
test('a full server never evicts a room with members',async t=>{
  const {dataDir,base}=await seededServer(t,3,Array.from({length:100},(_,i)=>savedRoom(i,{lastActive:1000+i})));
  const members=[];for(let i=0;i<100;i++){const m=await client(base,`10.1.0.${i}`);await m.request('join',{name:'M'+i,code:roomCodeAt(i)});members.push(m);}
  const late=await client(base,'10.2.0.1');await assert.rejects(late.request('create',{name:'Late'}),/plein/);
  assert.equal((await readRooms(dataDir)).rooms.length,100);
});
test('rooms.json versions 1 and 2 still load and are saved as version 3',async t=>{
  for(const [version,room] of [[1,{code:roomCodeAt(1),name:'Ancienne'}],[2,savedRoom(2)]]){
    const {dataDir,base}=await seededServer(t,version,[room]);const a=await client(base);
    assert.equal((await a.request('join',{name:'Alice',code:room.code})).code,room.code);
    await a.request('create',{name:'Alice'});const disk=await readRooms(dataDir);
    assert.equal(disk.version,3);assert.equal(disk.rooms.length,2);assert.ok(disk.rooms.every(r=>Number.isFinite(r.lastActive)));
  }
});
