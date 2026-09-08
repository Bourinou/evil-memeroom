// Reassert the window order without activating it or taking input from the game.
// Exclusive DirectX fullscreen is outside the desktop compositor's control.
function createOverlayLayer(window, platform = process.platform) {
  let timer;
  const alive = () => !window.isDestroyed();
  function stop() {
    clearInterval(timer);
    timer = undefined;
  }
  function refresh() {
    if (!alive() || !window.isVisible()) {
      stop();
      return;
    }
    if (platform === 'linux') window.setAlwaysOnTop(true);
    else window.setAlwaysOnTop(true, 'screen-saver');
    window.moveTop();
  }
  window.setIgnoreMouseEvents(true, platform === 'linux' ? undefined : { forward: true });
  if (platform !== 'linux') window.setFocusable(false);
  if (platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (platform === 'linux') window.setVisibleOnAllWorkspaces(true);
  window.on('hide', stop);
  window.on('closed', stop);
  return {
    refresh,
    show() {
      if (!alive()) return;
      window.showInactive();
      refresh();
      if (!timer) {
        timer = setInterval(refresh, 500);
        timer.unref();
      }
    },
    hide() {
      stop();
      if (alive()) window.hide();
    },
  };
}
module.exports = { createOverlayLayer };
