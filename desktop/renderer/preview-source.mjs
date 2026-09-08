export async function preparePreview(asset, server, signal) {
  const id = crypto.randomUUID();
  const release = () => window.memeroom.releasePreview(id);
  signal.throwIfAborted();
  signal.addEventListener('abort', release, { once: true });
  try {
    const url = await window.memeroom.preparePreview(id, asset, server);
    signal.throwIfAborted();
    return {
      url,
      release: () => {
        signal.removeEventListener('abort', release);
        release();
      },
    };
  } catch (error) {
    signal.removeEventListener('abort', release);
    release();
    throw error;
  }
}
