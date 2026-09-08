const fs = require('node:fs/promises');
const path = require('node:path');

function createAtomicWriter(
  file,
  {
    delayMs = 80,
    write = async (snapshot) => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file + '.tmp', snapshot, { mode: 0o600 });
      await fs.rename(file + '.tmp', file);
    },
  } = {},
) {
  let pending, timer, running;
  async function drain() {
    let failure;
    while (pending) {
      const batch = pending;
      pending = null;
      try {
        await write(batch.snapshot);
        for (const waiter of batch.waiters) waiter.resolve();
      } catch (error) {
        failure = error;
        for (const waiter of batch.waiters) waiter.reject(error);
      }
    }
    if (failure) throw failure;
  }
  function flush() {
    clearTimeout(timer);
    if (!running)
      running = drain().finally(() => {
        running = null;
      });
    return running;
  }
  return {
    save(value) {
      const snapshot = JSON.stringify(value, null, 2);
      if (!pending) pending = { waiters: [] };
      pending.snapshot = snapshot;
      const result = new Promise((resolve, reject) => pending.waiters.push({ resolve, reject }));
      clearTimeout(timer);
      timer = setTimeout(() => void flush().catch(() => {}), delayMs);
      return result;
    },
    flush,
  };
}
module.exports = { createAtomicWriter };
