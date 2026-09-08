import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createRoomServer } from '../server/index.mjs';
import { PasswordLimiter, clientIP } from '../server/password-limiter.mjs';
import { scanClam } from '../server/media-scan.mjs';
import { Presets } from '../desktop/presets.cjs';
import * as protocol from '../shared/protocol.mjs';

test('password budgets survive reconnects, isolate addresses, expire, and ignore untrusted proxy headers', () => {
  let now = 0; const limit = new PasswordLimiter({ now:() => now });
  for (let i=0;i<5;i++) limit.consume('a','room');
  assert.throws(() => limit.consume('a','room'), /300 s/);
  limit.consume('b','room')();
  now = 300001; limit.sweep(); limit.consume('a','room')();
  const request = { socket:{remoteAddress:'127.0.0.1'}, headers:{'x-forwarded-for':'1.1.1.1, 2.2.2.2'} };
  assert.equal(clientIP(request), '127.0.0.1'); assert.equal(clientIP(request,true),'2.2.2.2');
  assert.equal(protocol.cleanSettings({ receiveOwn:false }).receiveOwn,undefined); assert.equal(protocol.cleanSettings().size,60);
  assert.equal(protocol.LIMITS.uploadBytes,1024**3);
});

test('antivirus protocol accepts only OK, rejects detections and unavailable engines', async t => {
  let answer = 'stream: OK\0';
  const daemon = net.createServer(socket => {
    let buffer = Buffer.alloc(0), command = false;
    socket.on('error',()=>{});
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer,chunk]);
      if (!command) { const end=buffer.indexOf(0); if(end<0)return; assert.equal(buffer.subarray(0,end).toString(),'zINSTREAM'); buffer=buffer.subarray(end+1); command=true; }
      while (buffer.length>=4) { const length=buffer.readUInt32BE(); if(buffer.length<4+length)return; buffer=buffer.subarray(4+length); if(!length){socket.end(answer);return;} }
    });
  });
  await new Promise(r=>daemon.listen(0,'127.0.0.1',r)); t.after(()=>new Promise(r=>daemon.close(r)));
  const options={host:'127.0.0.1',port:daemon.address().port,timeoutMs:1000};
  const file=path.resolve('public/icon.png');
  await scanClam(file,options);
  answer='stream: Test-Signature FOUND\0'; await assert.rejects(scanClam(file,options), {status:422});
  answer='stream: scan failed ERROR\0'; await assert.rejects(scanClam(file,options), {status:503});
});

test('expired media is deleted from disk while members stay connected; saved messages reupload it',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'memeroom-presets-test-'));
  const files=[]; let rejectScan=false;
  const server=createRoomServer({host:'127.0.0.1',port:0,dataDir:null,mediaTtlMs:180,scanMedia:async asset=>{files.push(asset.file);if(rejectScan)throw Object.assign(new Error('Antivirus indisponible'),{status:503});}});
  const address=await server.start(),base=`http://127.0.0.1:${address.port}`;
  t.after(async()=>{await server.stop();await rm(directory,{recursive:true,force:true});});
  const ws=new WebSocket(base.replace('http:','ws:')+'/ws');await once(ws,'open');
  const reply=once(ws,'message');ws.send(JSON.stringify({id:'1',type:'create',data:{name:'Test'}}));const room=JSON.parse((await reply)[0]).data;
  const png=await readFile('public/icon.png');
  const upload=()=>fetch(base+'/api/media',{method:'POST',headers:{Authorization:`Bearer ${room.token}`,'X-Filename':'icon.png'},body:png});
  const uploaded=await upload();assert.equal(uploaded.status,201);const asset=await uploaded.json();
  const presets=new Presets(directory,protocol);
  const saved=await presets.save({name:'Réaction favorite',reaction:{server:base,media:asset,caption:'Salut',duration:2}});
  await new Promise(r=>setTimeout(r,420));
  assert.equal((await fetch(base+asset.url)).status,404);await assert.rejects(access(files[0]));
  assert.equal(ws.readyState,WebSocket.OPEN);
  const reopened=new Presets(directory,protocol);assert.equal((await reopened.list())[0].name,'Réaction favorite');
  const loaded=await reopened.load(saved.id,base,room.token);assert.equal(loaded.caption,'Salut');assert.notEqual(loaded.media.id,asset.id);
  assert.equal((await fetch(base+loaded.media.url)).status,200);
  rejectScan=true;assert.equal((await upload()).status,503);
  await new Promise(r=>setTimeout(r,20));await assert.rejects(access(files.at(-1)));
  await reopened.rename(saved.id,'Encore');assert.equal((await reopened.list())[0].name,'Encore');
  await reopened.remove(saved.id);assert.equal((await reopened.list()).length,0);
});
