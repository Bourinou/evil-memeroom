const { execFile } = require('node:child_process');

// Reassert the window order without activating it or taking input from the game.
// Exclusive DirectX fullscreen is outside the desktop compositor's control.
function createOverlayLayer(window, platform = process.platform) {
  let timer;
  const alive = () => !window.isDestroyed();
  function stop() { clearInterval(timer); timer = undefined; }
  function applyClickThrough() {
    if (!alive()) return;
    try { window.setIgnoreMouseEvents(true); } catch {}
    if (platform === 'linux') {
      const title = window.getTitle();
      const script = `import subprocess, ctypes
try:
    out = subprocess.check_output(['xwininfo', '-name', '${title}'], stderr=subprocess.DEVNULL).decode()
    for line in out.splitlines():
        if 'Window id:' in line:
            wid = int(line.split()[3], 16)
            x11 = ctypes.cdll.LoadLibrary('libX11.so.6')
            xfixes = ctypes.cdll.LoadLibrary('libXfixes.so.3')
            x11.XOpenDisplay.restype = ctypes.c_void_p
            xfixes.XFixesCreateRegion.restype = ctypes.c_ulong
            disp = x11.XOpenDisplay(None)
            if not disp: break
            empty = xfixes.XFixesCreateRegion(disp, None, 0)
            xfixes.XFixesSetWindowShapeRegion(disp, ctypes.c_ulong(wid), 2, 0, 0, ctypes.c_ulong(empty))
            xfixes.XFixesDestroyRegion(disp, ctypes.c_ulong(empty))
            x11.XFlush(disp)
            break
except BaseException:
    pass`;
      execFile('python3', ['-c', script], { timeout: 1000, stdio: 'ignore' }, () => {});
    }
  }
  function refresh() {
    if (!alive() || !window.isVisible()) { stop(); return; }
    if (platform === 'linux') window.setAlwaysOnTop(true);
    else window.setAlwaysOnTop(true, 'screen-saver');
    window.moveTop();
    applyClickThrough();
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
      applyClickThrough();
      if (!timer) { timer = setInterval(refresh, 500); timer.unref(); }
    },
    hide() { stop(); if (alive()) window.hide(); }
  };
}
module.exports = { createOverlayLayer };
