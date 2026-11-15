const path = require('node:path');
const os = require('node:os');
const { createReadStream } = require('node:fs');
const { readFile, stat } = require('node:fs/promises');
const { Readable } = require('node:stream');

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
  ['/app/state.mjs', ['public/app/state.mjs', 'text/javascript; charset=utf-8']],
  ['/app/rooms.mjs', ['public/app/rooms.mjs', 'text/javascript; charset=utf-8']],
  ['/app/composer.mjs', ['public/app/composer.mjs', 'text/javascript; charset=utf-8']],
  ['/app/upload.mjs', ['public/app/upload.mjs', 'text/javascript; charset=utf-8']],
  ['/app/history.mjs', ['public/app/history.mjs', 'text/javascript; charset=utf-8']],
  ['/app/saved-memes.mjs', ['public/app/saved-memes.mjs', 'text/javascript; charset=utf-8']],
  ['/app/trim.mjs', ['public/app/trim.mjs', 'text/javascript; charset=utf-8']],
  ['/app/settings.mjs', ['public/app/settings.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/media-view.mjs', ['public/media-view.mjs', 'text/javascript; charset=utf-8']],
  ['/connection.mjs', ['public/connection.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/protocol.mjs', ['shared/protocol.mjs', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['public/favicon.svg', 'image/svg+xml']],
  ['/icon.png', ['public/icon.png', 'image/png']]
]);
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: http: https:; media-src 'self' blob: http: https:; connect-src http: https: ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

async function serveSavedMeme(request, memesDir, rawName) {
  const notFound = () => new Response('Fichier introuvable.', { status: 404 });
  let decoded;
  try { decoded = decodeURIComponent(rawName); } catch { return notFound(); }
  const safeName = path.basename(decoded);
  if (!safeName || safeName.startsWith('.')) return notFound();
  const target = path.join(memesDir, safeName);
  try {
    const { parseByteRange } = await import('../server/releases.mjs');
    const { size } = await stat(target);
    const headers = { 'Content-Type': MIMES[path.extname(safeName).toLowerCase()] || 'application/octet-stream', 'Content-Security-Policy': csp, 'Cache-Control': 'max-age=3600', 'Accept-Ranges': 'bytes' };
    // An empty file cannot satisfy any range: serve it whole.
    const range = size ? parseByteRange(request.headers.get('range'), size) : { start: 0, end: -1, status: 200 };
    if (!range) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    headers['Content-Length'] = String(range.end - range.start + 1);
    if (range.status === 206) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    if (request.method === 'HEAD' || !size) return new Response(null, { status: range.status, headers });
    return new Response(Readable.toWeb(createReadStream(target, { start: range.start, end: range.end })), { status: range.status, headers });
  } catch {
    return notFound();
  }
}

function installControlPage(controlSession, { memesDir = MEMEROOM_DIR } = {}) {
  controlSession.protocol.handle('http', async request => {
    const url = new URL(request.url);
    if (url.origin !== new URL(CONTROL_URL).origin) {
      // Room API requests still use the network, with their body and headers intact.
      return controlSession.fetch(request, { bypassCustomProtocolHandlers: true });
    }
    if (url.pathname.startsWith('/saved-memes/')) {
      return serveSavedMeme(request, memesDir, url.pathname.slice('/saved-memes/'.length));
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
