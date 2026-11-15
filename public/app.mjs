import { cleanClientState } from './shared/protocol.mjs';
import { $, native, state, notify, keyFor } from './app/state.mjs';
import { renderRooms, renderLibrary, chooseRoom } from './app/rooms.mjs';
import { renderSettings } from './app/settings.mjs';
import { loadHistory, updateHistoryBadge, renderHistory } from './app/history.mjs';
import { loadSavedMemes } from './app/saved-memes.mjs';
import './app/composer.mjs';
import './app/trim.mjs';

document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
for (const dialog of document.querySelectorAll('dialog')) {
  let outsideDown = false;
  const outside = event => { const r = dialog.getBoundingClientRect(); return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom; };
  dialog.addEventListener('pointerdown', event => { outsideDown = event.target === dialog && outside(event); });
  dialog.addEventListener('click', event => { if (outsideDown && event.target === dialog && outside(event)) dialog.close(); outsideDown = false; });
}
export function showTab(tab) {
  if (typeof tab === 'boolean') tab = tab ? 'presets' : 'composer';
  state.currentTab = tab;
  const appEl = document.querySelector('main.app');
  if (appEl) appEl.dataset.tab = tab;
  $('#send-form').hidden = tab !== 'composer';
  $('#presets-panel').hidden = tab !== 'presets';
  $('#history-panel').hidden = tab !== 'history';
  $('#show-composer').setAttribute('aria-pressed', String(tab === 'composer'));
  $('#show-presets').setAttribute('aria-pressed', String(tab === 'presets'));
  $('#show-history').setAttribute('aria-pressed', String(tab === 'history'));
  if (tab === 'presets') void loadSavedMemes();
  if (tab === 'history') renderHistory();
}
$('#show-composer').addEventListener('click', () => showTab('composer'));
$('#show-presets').addEventListener('click', () => showTab('presets'));
$('#show-history').addEventListener('click', () => showTab('history'));
$('#duration')?.addEventListener('change', () => {
  const val = Number($('#duration').value);
  if (!Number.isFinite(val) || val < 0.1) $('#duration').value = '0.1';
  else if (val > 600) $('#duration').value = '600';
});

async function init() {
  const info = await native.info(); state.settings = info.settings; state.localServer = info.server; state.addresses = info.addresses;
  state.mac = info.platform === 'darwin';
  if (state.mac) $('#pause-shortcut-note').textContent = 'Pause rapide : Cmd + Maj + F8';
  if (info.shortcutError) $('#shortcut-hint').textContent = info.shortcutError;
  state.client = cleanClientState(info.clientState || state.client);
  state.messageHistory = await loadHistory(info.history);
  for (const display of info.displays) $('#setting-display').add(new Option(display.label, display.id));
  $('#pause-reception').hidden = false;
  native.onSettings(value => { const pauseChanged = state.settings.paused !== value.paused; state.settings = value; renderSettings(); if (pauseChanged && state.connected) state.connection.request('status', { paused:state.settings.paused }).catch(() => {}); });
  native.onError(message => notify(message, true));
  native.onSavedMemesUpdated(() => { void loadSavedMemes(); });
  await loadSavedMemes();
  updateHistoryBadge();
  renderRooms(); renderSettings(); renderLibrary(); showTab(state.currentTab);
  if (state.client.autoJoin && state.client.active) {
    const saved = state.client.rooms.find(entry => keyFor(entry) === keyFor(state.client.active));
    if (saved) try { await chooseRoom(saved); } catch { /* Saved room stays available while the server is offline. */ }
  }
  document.body.dataset.ready = 'true';
}
init().catch(error => { state.status = 'Initialisation impossible.'; renderRooms(); notify(error.message, true); });
