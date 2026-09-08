import { open, realpath, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { downloadFilenames } from './release-platforms.mjs';

const versionPattern = '\\d+\\.\\d+\\.\\d+';
const binaryPattern = new RegExp(`^MemeRoom-(?:Setup-${versionPattern}\\.exe(?:\\.blockmap)?|${versionPattern}-Linux-x86_64\\.AppImage|${versionPattern}-Mac-(?:arm64|x64)\\.zip)$`);
export const releaseFilename = name => typeof name === 'string' && (binaryPattern.test(name) || ['latest.yml', 'latest-linux.yml'].includes(name));

async function containedFile(directory, name) {
  const root = await realpath(directory);
  const file = await realpath(path.join(root, name));
  if (path.dirname(file) !== root) throw new Error('Invalid release path');
  return file;
}

export async function listDownloads(directory) {
  const result = { windows: null, linux: null, macArm64: null, macIntel: null };
  let manifest;
  try { manifest = JSON.parse(await readFile(await containedFile(directory, 'downloads.json'), 'utf8')); }
  catch { return result; }
  for (const platform of Object.keys(result)) {
    const item = manifest?.[platform];
    if (!item || !/^\d+\.\d+\.\d+$/.test(item.version)) continue;
    const expected = downloadFilenames(item.version)[platform];
    if (item.filename !== expected) continue;
    try {
      const info = await stat(await containedFile(directory, expected));
      if (info.isFile() && info.size > 0) result[platform] = { version: item.version, bytes: info.size, url: `/releases/${expected}` };
    } catch { /* An unpublished platform has no active download button. */ }
  }
  return result;
}

export async function serveRelease(req, res, directory, name) {
  if (!releaseFilename(name)) { res.writeHead(404); res.end(); return; }
  let handle;
  try { handle = await open(await containedFile(directory, name), 'r'); }
  catch { res.writeHead(404); res.end(); return; }
  try {
    const info = await handle.stat();
    if (!info.isFile() || !info.size) { res.writeHead(404); res.end(); return; }
    const metadata = name.endsWith('.yml');
    res.setHeader('Content-Type', metadata ? 'text/yaml; charset=utf-8' : 'application/octet-stream');
    res.setHeader('Cache-Control', metadata ? 'no-store' : 'public, max-age=31536000, immutable');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Accept-Ranges', 'bytes');
    if (!metadata) res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    let start = 0, end = info.size - 1, status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (match && (match[1] || match[2])) {
        if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
        else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      }
      if (!match || !(match[1] || match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return;
      }
      status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
    }
    res.writeHead(status, { 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') res.end();
    else await pipeline(handle.createReadStream({ start, end, autoClose: false }), res);
  } catch { if (!res.destroyed) res.destroy(); }
  finally { await handle.close(); }
}
