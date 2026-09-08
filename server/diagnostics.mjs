const codes = new Set(['EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EIO', 'ECONNRESET', 'ETIMEDOUT']);
export function createDiagnostics({ write = console.error, now = Date.now } = {}) {
  const counts = new Map(),
    last = new Map();
  return {
    error(operation, error) {
      if (!['http', 'websocket', 'storage'].includes(operation)) operation = 'storage';
      const count = (counts.get(operation) || 0) + 1;
      counts.set(operation, count);
      const at = now();
      if (last.has(operation) && at - last.get(operation) < 10000) return;
      last.set(operation, at);
      write(
        JSON.stringify({
          event: 'server-error',
          operation,
          code: codes.has(error?.code) ? error.code : 'INTERNAL_ERROR',
          count,
        }),
      );
    },
    snapshot: () => Object.fromEntries(counts),
  };
}
