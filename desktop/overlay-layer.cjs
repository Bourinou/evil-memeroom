const { execFile } = require('node:child_process');

// Reassert the window order without activating it or taking input from the game.
// Exclusive DirectX fullscreen is outside the desktop compositor's control.
function createOverlayLayer(window, platform = process.platform, exec = execFile) {
  let timer, warned = false;
  const alive = () => !window.isDestroyed();
  function stop() { clearInterval(timer); timer = undefined; }
  function applyClickThrough() {
    if (!alive()) return;
    try { window.setIgnoreMouseEvents(true); } catch {}
    if (platform === 'linux') {
      // Passed as argv, never interpolated into the script.
      const script = `import subprocess, ctypes, sys
try:
    out = subprocess.check_output(['xwininfo', '-name', sys.argv[1]], stderr=subprocess.DEVNULL).decode()
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
except FileNotFoundError:
    sys.exit(3)
except BaseException:
    pass`;
      exec('python3', ['-c', script, window.getTitle()], { timeout: 1000 }, (error) => {
        if (!error || warned) return;
        if (error.code === 'ENOENT' || error.code === 3) {
          warned = true;
          console.warn('Overlay click-through on Linux needs python3 and xwininfo (x11-utils).');
        }
      });
    }
  }
  // Order only: runs on the timer, so it must stay cheap.
  function reassertOrder() {
    if (!alive() || !window.isVisible()) { stop(); return false; }
    if (platform === 'linux') window.setAlwaysOnTop(true);
    else window.setAlwaysOnTop(true, 'screen-saver');
    window.moveTop();
    return true;
  }
  // Explicit refresh (show, bounds change): order plus the X11 click-through shape.
  function refresh() { if (reassertOrder()) applyClickThrough(); }
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
      if (!timer) { timer = setInterval(reassertOrder, 500); timer.unref(); }
    },
    hide() { stop(); if (alive()) window.hide(); }
  };
}
module.exports = { createOverlayLayer };
