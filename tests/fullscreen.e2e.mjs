import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

if (process.platform !== 'win32') throw new Error('Cette vérification native nécessite Windows.');
const env = { ...process.env, MEMEROOM_USER_DATA:path.resolve('.test-artifacts', `fullscreen-${Date.now()}`), MEMEROOM_ALLOW_MULTIPLE:'1', MEMEROOM_PORT:'0', HOST:'127.0.0.1', MEMEROOM_DISABLE_UPDATES:'1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args:['.'], env, chromiumSandbox:true });
try {
  await app.firstWindow();
  let control;
  for (let i=0; i<100; i++) { control=app.windows().find(w=>w.url()==='http://localhost/remote'); if(control) break; await new Promise(r=>setTimeout(r,50)); }
  assert.ok(control); await control.waitForFunction(()=>document.body.dataset.ready==='true');
  await app.evaluate(async ({BrowserWindow}) => {
    const target = new BrowserWindow({ title:'MemeRoom fullscreen test', fullscreen:true, autoHideMenuBar:true, webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false} });
    await target.loadURL('data:text/html,<title>MemeRoom fullscreen test</title><body style="background:%23223448;color:white"><h1>Test plein écran MemeRoom</h1><input autofocus placeholder="Application sous l’overlay">');
    target.setAlwaysOnTop(true); target.show(); target.focus();
  });
  await control.evaluate(async () => { const info=await window.memeroom.info(); await window.memeroom.show({id:'fullscreen',server:info.server,duration:15,caption:'PAR-DESSUS LE PLEIN ÉCRAN',sender:{name:'Rose'}}); });
  const overlay=app.windows().find(w=>w.url().endsWith('/overlay.html'));
  await overlay.waitForFunction(()=>document.querySelector('.reaction-view')?.hidden===false);
  // Simulate a game taking the topmost slot again while playback is in progress.
  const handles = await app.evaluate(({BrowserWindow}) => {
    const target=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='MemeRoom fullscreen test');
    const overlay=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='MemeRoom Overlay');
    target.moveTop(); target.focus();
    return {target:target.getNativeWindowHandle().readBigUInt64LE().toString(),overlay:overlay.getNativeWindowHandle().readBigUInt64LE().toString(),fullscreen:target.isFullScreen()};
  });
  assert.equal(handles.fullscreen,true);
  await new Promise(r=>setTimeout(r,800));
  const state=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',path.resolve('tests/window-order.ps1'),'-OverlayHandle',handles.overlay,'-TargetHandle',handles.target],{encoding:'utf8',windowsHide:true}));
  assert.equal(state.above,true,'Overlay above fullscreen window after the game raises itself');
  const focus=await app.evaluate(({BrowserWindow})=>({game:BrowserWindow.getAllWindows().find(w=>w.getTitle()==='MemeRoom fullscreen test').isFocused(),overlay:BrowserWindow.getAllWindows().find(w=>w.getTitle()==='MemeRoom Overlay').isFocused()}));
  assert.deepEqual(focus,{game:true,overlay:false},'Fullscreen test window retains Electron focus');
  assert.equal(state.clickThrough,true,'Windows transparent input style');
  assert.equal(state.noActivate,true,'Windows nonactivating style');
  console.log('OK · Plein écran Windows : overlay au-dessus après reprise du premier plan, focus conservé et passage des clics configuré.');
} finally { await app.close(); }
