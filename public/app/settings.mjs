import { cleanSettings, validDismissShortcut } from '../shared/protocol.mjs';
import { $, native, state, notify, saveClient } from './state.mjs';
import { attemptJoin, renderRooms } from './rooms.mjs';

let recordingShortcut = false, shortcutBusy = false;
const shortcutLabel = value => value ? value.split('+').map(key => ({ Control:'Ctrl', Shift:'Maj', Super:state.mac ? 'Cmd' : 'Windows', Space:'Espace', Up:'Haut', Down:'Bas', Left:'Gauche', Right:'Droite' }[key] || key)).join(' + ') : 'Choisir un raccourci';
export function renderNickname() {
  const nick = state.client.nickname || 'Anonyme';
  if ($('#current-nickname')) $('#current-nickname').textContent = nick;
  if ($('#settings-nickname')) $('#settings-nickname').value = state.client.nickname || '';
}
async function setNickname(newName) {
  const clean = (newName || '').trim();
  if (!clean) return;
  state.client.nickname = clean;
  renderNickname();
  await saveClient();
  if (state.connected && state.connection) {
    try {
      await state.connection.request('rename', { name: clean });
    } catch {
      if (state.target) attemptJoin(state.epoch, false).catch(() => {});
    }
  }
  notify(`Pseudo mis à jour : ${clean}`);
}
$('#edit-nickname')?.addEventListener('click', () => {
  $('#change-nickname-input').value = state.client.nickname || '';
  $('#nickname-dialog')?.showModal();
  $('#change-nickname-input')?.focus();
});
$('#nickname-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  const val = $('#change-nickname-input').value;
  await setNickname(val);
  $('#nickname-dialog')?.close();
});
$('#save-settings-nickname')?.addEventListener('click', async () => {
  const val = $('#settings-nickname').value;
  await setNickname(val);
});
export function renderSettings() {
  const { settings } = state;
  if (!recordingShortcut) $('#dismiss-shortcut').textContent = shortcutLabel(settings.dismissShortcut);
  $('#dismiss-shortcut').disabled = shortcutBusy;
  $('#disable-dismiss-shortcut').disabled = shortcutBusy || !settings.dismissShortcut;
  $('#auto-join').checked = state.client.autoJoin;
  $('#setting-paused').checked = settings.paused;
  if ($('#setting-hide-self')) $('#setting-hide-self').checked = settings.hideSelf;
  if ($('#setting-save-received')) $('#setting-save-received').checked = settings.saveReceived;
  for (const key of ['volume','size','position','display']) $(`#setting-${key}`).value = settings[key];
  $('#volume-value').textContent = `${settings.volume} %`; $('#size-value').textContent = `${settings.size} %`;
  $('#pause-reception').textContent = settings.paused ? 'Reprendre la réception' : 'Mettre en pause';
}
$('#open-settings').addEventListener('click', () => { renderSettings(); renderRooms(); $('#settings-dialog').showModal(); });
$('#auto-join').addEventListener('change', async event => { state.client.autoJoin = event.target.checked; await saveClient(); });
async function stopShortcutCapture() {
  recordingShortcut = false; renderSettings();
  await native.recordShortcut(false);
}
async function saveDismissShortcut(value) {
  shortcutBusy = true;
  try {
    await stopShortcutCapture();
    state.settings = await native.saveDismissShortcut(value);
    $('#shortcut-hint').textContent = value ? 'Raccourci enregistré. Arrête uniquement le contenu en cours sur votre écran.' : 'Raccourci désactivé.';
  } catch (error) { $('#shortcut-hint').textContent = error.message; }
  finally { shortcutBusy = false; renderSettings(); }
}
$('#dismiss-shortcut').addEventListener('click', async () => {
  if (recordingShortcut) { await stopShortcutCapture(); return; }
  try {
    await native.recordShortcut(true); recordingShortcut = true;
    $('#dismiss-shortcut').textContent = 'Appuyez sur les touches…';
    $('#shortcut-hint').textContent = 'Appuyez sur une touche ou combinaison (ex: Fin, F9, Ctrl+Fin…). Échap pour annuler.';
  } catch (error) { $('#shortcut-hint').textContent = error.message; }
});
$('#disable-dismiss-shortcut').addEventListener('click', () => saveDismissShortcut(''));
$('#dismiss-shortcut').addEventListener('blur', () => { if (recordingShortcut) void stopShortcutCapture(); });
$('#settings-dialog').addEventListener('close', () => { if (recordingShortcut) void stopShortcutCapture(); });
window.addEventListener('blur', () => { if (recordingShortcut) void stopShortcutCapture(); });
document.addEventListener('keydown', event => {
  if (!recordingShortcut) return;
  event.preventDefault(); event.stopPropagation();
  if (event.key === 'Escape') { void stopShortcutCapture(); return; }
  if (event.repeat || ['Control','Alt','Shift','Meta'].includes(event.key)) return;
  const aliases = { ' ':'Space', ArrowUp:'Up', ArrowDown:'Down', ArrowLeft:'Left', ArrowRight:'Right' };
  const key = aliases[event.key] || (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  const shortcut = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super', key].filter(Boolean).join('+');
  if (!validDismissShortcut(shortcut)) { $('#shortcut-hint').textContent = 'Combinaison réservée. Ctrl + Maj + F8 reste réservé à la pause.'; return; }
  void saveDismissShortcut(shortcut);
}, true);
async function updateSettings(value) {
  const pauseChanged = state.settings.paused !== value.paused; state.settings = cleanSettings(value); renderSettings();
  try { await native.saveSettings(state.settings); } catch { notify('Impossible d’enregistrer les réglages.', true); }
  if (pauseChanged && state.connected) state.connection.request('status', { paused:state.settings.paused }).catch(() => {});
}
$('#pause-reception').addEventListener('click', () => updateSettings({ ...state.settings, paused:!state.settings.paused }));
for (const [id, key] of [['setting-paused','paused'],['setting-hide-self','hideSelf'],['setting-save-received','saveReceived'],['setting-volume','volume'],['setting-size','size'],['setting-position','position'],['setting-display','display']]) {
  $(`#${id}`)?.addEventListener('input', event => { const input = event.target; updateSettings({ ...state.settings, [key]:input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value }); });
}
$('#check-updates')?.addEventListener('click', async () => { await native.restart(); });
