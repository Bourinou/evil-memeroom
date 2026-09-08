import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, open, mkdir, writeFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRoomServer } from '../server/index.mjs';
import { MediaCache } from '../desktop/media-cache.cjs';
import { downloadAsset } from '../desktop/media-files.cjs';
import { client } from '../tests/helpers/room.mjs';

const MiB = 1024 ** 2;
const rounded = (value) => Math.round(value * 100) / 100;
function sampleProcess() {
  const start = process.cpuUsage(),
    began = performance.now(),
    initial = process.memoryUsage().rss;
  let peak = initial;
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 25);
  return () => {
    clearInterval(timer);
    const cpu = process.cpuUsage(start),
      elapsed = performance.now() - began;
    peak = Math.max(peak, process.memoryUsage().rss);
    return {
      elapsedMs: rounded(elapsed),
      cpuMs: rounded((cpu.user + cpu.system) / 1000),
      cpuPercentOneCore: rounded((cpu.user + cpu.system) / (elapsed * 10)),
      initialRssMiB: rounded(initial / MiB),
      peakRssMiB: rounded(peak / MiB),
    };
  };
}
if (process.argv.includes('--server')) {
  const server = createRoomServer({ host: '127.0.0.1', port: 0, dataDir: null, cooldownMs: 0 });
  const address = await server.start(),
    measurement = sampleProcess();
  process.send({ base: `http://127.0.0.1:${address.port}` });
  process.once('message', async () => {
    const stats = measurement();
    await server.stop();
    process.send(stats, () => process.disconnect());
  });
} else {
  const participants = Number(process.env.BENCH_PARTICIPANTS || 8);
  const mediaMiB = Number(process.env.BENCH_MEDIA_MIB || 32);
  if (
    !Number.isInteger(participants) ||
    participants < 2 ||
    participants > 16 ||
    !Number.isInteger(mediaMiB) ||
    mediaMiB < 1 ||
    mediaMiB > 256
  )
    throw new Error('BENCH_PARTICIPANTS : 2–16 ; BENCH_MEDIA_MIB : 1–256.');
  const directory = await mkdtemp(path.join(tmpdir(), 'memeroom-benchmark-'));
  const peers = [],
    caches = [];
  const child = fork(fileURLToPath(import.meta.url), ['--server'], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    windowsHide: true,
  });
  const exit = once(child, 'exit');
  try {
    const [{ base }] = await once(child, 'message');
    const measurement = sampleProcess();
    const first = await client(base);
    peers.push(first);
    const room = await first.request('create', { name: 'Mesure', desktop: true });
    for (let index = 1; index < participants; index++) {
      const peer = await client(base);
      peers.push(peer);
      await peer.request('join', { code: room.code, name: `Participant ${index}`, desktop: true });
    }
    const latencies = [];
    for (let index = 0; index < 20; index++) {
      const start = performance.now();
      const received = peers.map(
        (peer) =>
          new Promise((resolve, reject) => {
            const listener = (raw) => {
              if (JSON.parse(raw).type !== 'reaction') return;
              clearTimeout(timer);
              peer.ws.off('message', listener);
              latencies.push(performance.now() - start);
              resolve();
            };
            const timer = setTimeout(() => {
              peer.ws.off('message', listener);
              reject(new Error('Diffusion perdue.'));
            }, 5000);
            peer.ws.on('message', listener);
          }),
      );
      await first.request('broadcast', { caption: `Mesure ${index}`, duration: 2 });
      await Promise.all(received);
    }
    const bytes = mediaMiB * MiB,
      file = path.join(directory, 'silence.wav');
    const handle = await open(file, 'wx');
    try {
      const header = Buffer.alloc(44);
      header.write('RIFF');
      header.writeUInt32LE(bytes - 8, 4);
      header.write('WAVEfmt ', 8);
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
      header.writeUInt16LE(1, 22);
      header.writeUInt32LE(44100, 24);
      header.writeUInt32LE(88200, 28);
      header.writeUInt16LE(2, 32);
      header.writeUInt16LE(16, 34);
      header.write('data', 36);
      header.writeUInt32LE(bytes - 44, 40);
      await handle.write(header);
      await handle.truncate(bytes);
    } finally {
      await handle.close();
    }
    const uploadStart = performance.now();
    const response = await fetch(`${base}/api/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${room.token}`, 'X-Filename': 'silence.wav' },
      body: createReadStream(file),
      duplex: 'half',
    });
    if (!response.ok) throw new Error(await response.text());
    const asset = await response.json(),
      uploadMs = performance.now() - uploadStart;
    let downloads = 0;
    for (let index = 0; index < participants; index++)
      caches.push(
        new MediaCache({
          root: directory,
          download: (...args) => {
            downloads++;
            return downloadAsset(...args);
          },
        }),
      );
    const playback = () =>
      Promise.all(
        caches.map(async (cache) => {
          const leases = await Promise.all([
            cache.acquire(asset, base),
            cache.acquire(asset, base),
          ]);
          if (leases[0].file !== leases[1].file)
            throw new Error('Aperçu et overlay ont dupliqué le fichier.');
          leases.forEach((lease) => lease.release());
        }),
      );
    const coldStart = performance.now();
    await playback();
    const coldMs = performance.now() - coldStart;
    const warmStart = performance.now();
    await playback();
    const warmMs = performance.now() - warmStart;
    if (downloads !== participants) throw new Error(`Transferts inattendus : ${downloads}.`);
    const clientStats = measurement();
    const serverStats = once(child, 'message');
    child.send('stop');
    const [server] = await serverStats;
    await exit;
    latencies.sort((a, b) => a - b);
    const percentile = (p) => rounded(latencies[Math.ceil(latencies.length * p) - 1]);
    const report = {
      date: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      participants,
      mediaMiB,
      scope:
        'Serveur séparé et caches natifs sur boucle locale ; hors décodage graphique et antivirus.',
      messages: latencies.length,
      latencyMs: { p50: percentile(0.5), p95: percentile(0.95), max: percentile(1) },
      uploadMs: rounded(uploadMs),
      coldDownloadMs: rounded(coldMs),
      warmCacheMs: rounded(warmMs),
      downloadMiBPerSecond: rounded((participants * mediaMiB) / (coldMs / 1000)),
      downloads,
      networkMiB: participants * mediaMiB,
      server,
      clients: clientStats,
    };
    const output = path.resolve(process.argv[2] || '.test-artifacts/benchmark.json');
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    peers.forEach((peer) => peer.ws.terminate());
    await Promise.all(caches.map((cache) => cache.close()));
    if (child.exitCode === null) {
      child.kill();
      await exit;
    }
    await rm(directory, { recursive: true, force: true });
  }
}
