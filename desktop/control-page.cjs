const path = require('node:path');
const os = require('node:os');
const { readFile } = require('node:fs/promises');

const MEMEROOM_DIR = path.join(os.homedir(), 'evil-memeroom');
const MIMES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg'
};

// This origin is resolved inside the control window's private Electron session.
// No HTTP server or public route serves the remote control.
const CONTROL_URL = 'http://localhost/remote';
const files = new Map([
  ['/remote', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['public/app.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/media-view.mjs', ['public/media-view.mjs', 'text/javascript; charset=utf-8']],
  ['/connection.mjs', ['public/connection.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/protocol.mjs', ['shared/protocol.mjs', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['public/favicon.svg', 'image/svg+xml']],
  ['/icon.png', ['public/icon.png', 'image/png']]
]);
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: http: https:; media-src 'self' blob: http: https:; connect-src http: https: ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

function installControlPage(controlSession) {
  controlSession.protocol.handle('http', async request => {
    const url = new URL(request.url);
    if (url.origin !== new URL(CONTROL_URL).origin) {
      // Room API requests still use the network, with their body and headers intact.
      return controlSession.fetch(request, { bypassCustomProtocolHandlers: true });
    }
    if (url.pathname.startsWith('/saved-memes/')) {
      const rawName = decodeURIComponent(url.pathname.slice('/saved-memes/'.length));
      const safeName = path.basename(rawName);
      if (!safeName || safeName.startsWith('.')) return new Response('Fichier introuvable.', { status: 404 });
      const target = path.join(MEMEROOM_DIR, safeName);
      try {
        const ext = path.extname(safeName).toLowerCase();
        const contentType = MIMES[ext] || 'application/octet-stream';
        const headers = { 'Content-Type': contentType, 'Content-Security-Policy': csp, 'Cache-Control': 'max-age=3600', 'Accept-Ranges': 'bytes' };
        const data = await readFile(target);
        return new Response(request.method === 'HEAD' ? null : data, { headers });
      } catch {
        return new Response('Fichier introuvable.', { status: 404 });
      }
    }
    const file = files.get(url.pathname);
    if (!file || !['GET', 'HEAD'].includes(request.method)) return new Response('Page introuvable.', { status: 404 });
    const headers = { 'Content-Type': file[1], 'Content-Security-Policy': csp, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    try {
      const data = await readFile(path.join(__dirname, '..', file[0]));
      return new Response(request.method === 'HEAD' ? null : data, { headers });
    } catch {
      return new Response('Fichiers de l’application manquants. Réinstallez evil memeroom.', { status: 500, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  });
}
module.exports = { CONTROL_URL, installControlPage };
