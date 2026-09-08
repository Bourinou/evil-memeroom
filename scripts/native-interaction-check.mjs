// Interactive native verification aid: only created test windows and test data are used.
// Run, then click/type through the overlay using Windows input. Ends after 3 minutes.
import { _electron as electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const output = path.resolve('.test-artifacts');
await mkdir(output, { recursive: true });
const target = path.join(output, 'native-input-target.html');
await writeFile(
  target,
  `<!doctype html><html lang="fr"><meta charset="utf-8"><title>MemeRoom — test clavier et clics</title><style>body{background:#223448;color:white;font:22px 'Segoe UI';margin:0;text-align:center}h1{font-size:26px;margin:45px 0}main{position:absolute;top:39%;width:100%}button,input{font:24px 'Segoe UI';padding:15px;border-radius:8px;width:80%;margin:8px}#result{font-size:22px}</style><h1>Vérification native du passage des interactions</h1><p>L’overlay vert recouvre volontairement les deux contrôles.</p><main><button id="click">Cliquer ici à travers l’overlay</button><input id="input" aria-label="Saisie de test" placeholder="Écrivez ici à travers l’overlay"><p id="result">Clics reçus : 0</p></main><script>let count=0;document.querySelector('#click').onclick=()=>document.querySelector('#result').textContent='Clics reçus : '+(++count);</script></html>`,
);
const env = {
  ...process.env,
  HOST: '127.0.0.1',
  MEMEROOM_PORT: '0',
  MEMEROOM_ALLOW_MULTIPLE: '1',
  MEMEROOM_USER_DATA: path.join(output, 'native-profile'),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env, chromiumSandbox: true });
try {
  let control;
  for (let i = 0; i < 100; i++) {
    control = app.windows().find((w) => w.url().startsWith('http:'));
    if (control) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await control.waitForFunction(() => !!window.memeroom);
  await control.evaluate(() =>
    window.memeroom.saveSettings({
      paused: false,
      size: 34,
      position: 'center',
      cooldown: 3,
      volume: 0,
      display: 'primary',
      receiveOwn: true,
    }),
  );
  const targetEvent = app.waitForEvent('window');
  await app.evaluate(async ({ BrowserWindow }, file) => {
    const target = new BrowserWindow({
      width: 1000,
      height: 800,
      title: 'MemeRoom — test clavier et clics',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    await target.loadFile(file);
    target.center();
    target.show();
    target.focus();
  }, target);
  const page = await targetEvent;
  const show = () =>
    control.evaluate(async () => {
      const info = await window.memeroom.info();
      return window.memeroom.show({
        id: String(Date.now()),
        server: info.server,
        duration: 15,
        caption: 'Test : cliquez et écrivez à travers cette fenêtre.',
        sender: { name: 'Vérification locale' },
      });
    });
  await show();
  const interval = setInterval(() => show().catch(() => {}), 12000);
  console.log('NATIVE_READY');
  await new Promise((resolve) => setTimeout(resolve, 180000));
  clearInterval(interval);
  const result = await page.evaluate(() => ({
    clicks: document.querySelector('#result').textContent,
    text: document.querySelector('#input').value,
  }));
  await writeFile(path.join(output, 'native-input-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await app.close();
}
