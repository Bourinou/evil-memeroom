// This module has no Electron dependency so failure/skip paths can be exercised in tests.
async function runStartupUpdate({
  updater,
  signal,
  status = (_value) => {},
  install,
  checkTimeoutMs = 6000,
  stallTimeoutMs = 30000,
}) {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  updater.allowPrerelease = false;
  let stopped = false,
    timer,
    cancelDownload,
    rejectInterrupted;
  const interrupted = new Promise((_, reject) => {
    rejectInterrupted = reject;
  });
  // Cancellation may precede the first awaited operation.
  interrupted.catch(() => {});
  const stop = (message) => {
    if (stopped) return;
    stopped = true;
    cancelDownload?.();
    rejectInterrupted(new Error(message));
  };
  const skip = () => stop('Mise à jour ignorée pour ce lancement.');
  const timeout = (milliseconds) => {
    clearTimeout(timer);
    timer = setTimeout(() => stop('Le serveur de mise à jour ne répond pas.'), milliseconds);
  };
  // electron-updater also emits errors for rejected checks and downloads.
  const onError = () => {};
  const progress = (info) => {
    if (stopped) return;
    timeout(stallTimeoutMs);
    status({
      phase: 'downloading',
      percent: Math.min(100, Math.max(0, Math.round(info.percent || 0))),
    });
  };
  updater.on('error', onError);
  updater.on('download-progress', progress);
  signal?.addEventListener('abort', skip, { once: true });
  try {
    if (signal?.aborted) return { installed: false };
    status({ phase: 'checking' });
    timeout(checkTimeoutMs);
    const result = await Promise.race([updater.checkForUpdates(), interrupted]);
    if (stopped || !result?.isUpdateAvailable) return { installed: false };
    cancelDownload = () => result.cancellationToken?.cancel();
    status({ phase: 'downloading', percent: 0 });
    timeout(stallTimeoutMs);
    await Promise.race([updater.downloadUpdate(result.cancellationToken), interrupted]);
    if (stopped || signal?.aborted) return { installed: false };
    clearTimeout(timer);
    status({ phase: 'installing' });
    // Once the verified installer starts, do not allow a simultaneous normal launch.
    signal?.removeEventListener('abort', skip);
    await install();
    return { installed: true };
  } catch (error) {
    return { installed: false, error: error.message };
  } finally {
    stopped = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', skip);
    updater.removeListener('download-progress', progress);
    // Keep the error sink: a skipped, in-flight network check can reject later.
  }
}
module.exports = { runStartupUpdate };
