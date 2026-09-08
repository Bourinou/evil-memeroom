import { DEFAULT_SETTINGS, cleanSettings } from '../../shared/protocol.mjs';
import { $, notify, bindDialogs } from './dom.mjs';
import { createShortcutSettings } from './shortcut-settings.mjs';
import { createRoomsUI } from './rooms-ui.mjs';
import { createComposerUI } from './composer-ui.mjs';
import { createPresetsUI } from './presets-ui.mjs';
const native = window.memeroom;
if (!native) location.replace('/');
let settings = { ...DEFAULT_SETTINGS },
  mac = false;
const shortcutUI = createShortcutSettings({
  native,
  getSettings: () => settings,
  onChange: (value) => {
    settings = value;
  },
  isMac: () => mac,
});
const rooms = createRoomsUI({
  native,
  getSettings: () => settings,
  onChange: () => composer.render(),
  onReset: () => composer.reset(),
  onLibrary: (value) => composer.setLibrary(value),
  onReaction(event) {
    $('#last-received').textContent = 'Dernier envoi : ' + event.sender.name;
    if (settings.paused) return;
    const now = Date.now() + rooms.session.skew;
    native
      .show({
        ...event,
        server: rooms.resolveServer(rooms.session.target.server),
        delay: Math.max(0, event.startAt - now),
        age: Math.max(0, now - event.startAt),
      })
      .catch((error) => notify(error.message, true));
  },
});
const composer = createComposerUI({ native, rooms, getSettings: () => settings });
const presets = createPresetsUI({ native, composer });
bindDialogs();
function renderSettings() {
  shortcutUI.render();
  $('#auto-join').checked = rooms.client.autoJoin;
  $('#setting-paused').checked = settings.paused;
  for (const key of ['volume', 'size', 'cooldown', 'position', 'display'])
    $(`#setting-${key}`).value = settings[key];
  $('#volume-value').textContent = `${settings.volume} %`;
  $('#size-value').textContent = `${settings.size} %`;
  $('#cooldown-value').textContent = `${settings.cooldown} s`;
  $('#pause-reception').textContent = settings.paused
    ? 'Reprendre la réception'
    : 'Mettre en pause';
}
$('#open-settings').addEventListener('click', () => {
  renderSettings();
  rooms.render();
  $('#settings-dialog').showModal();
});
$('#auto-join').addEventListener('change', async (event) => {
  rooms.client.autoJoin = event.target.checked;
  await rooms.saveClient();
});
async function updateSettings(value) {
  const pauseChanged = settings.paused !== value.paused;
  settings = cleanSettings(value);
  renderSettings();
  if (native)
    try {
      await native.saveSettings(settings);
    } catch {
      notify('Impossible d’enregistrer les réglages.', true);
    }
  if (pauseChanged && rooms.session.connected)
    rooms.session.request('status', { paused: settings.paused }).catch(() => {});
}
$('#pause-reception').addEventListener('click', () =>
  updateSettings({ ...settings, paused: !settings.paused }),
);
for (const [id, key] of [
  ['setting-paused', 'paused'],
  ['setting-volume', 'volume'],
  ['setting-size', 'size'],
  ['setting-cooldown', 'cooldown'],
  ['setting-position', 'position'],
  ['setting-display', 'display'],
]) {
  $(`#${id}`).addEventListener('input', (event) => {
    const input = event.target;
    updateSettings({
      ...settings,
      [key]:
        input.type === 'checkbox'
          ? input.checked
          : input.type === 'range'
            ? Number(input.value)
            : input.value,
    });
  });
}
$('#test-overlay').addEventListener('click', async () => {
  if (native) {
    const result = await native.test();
    if (!result.shown) notify('Reprenez la réception pour tester l’overlay.');
  }
});

async function init() {
  const info = await native.info();
  settings = info.settings;
  mac = info.platform === 'darwin';
  if (mac) $('#pause-shortcut-note').textContent = 'Pause rapide : Cmd + Maj + F8';
  if (info.shortcutError) $('#shortcut-hint').textContent = info.shortcutError;
  for (const display of info.displays)
    $('#setting-display').add(new Option(display.label, display.id));
  $('#pause-reception').hidden = false;
  $('#device-note').textContent = 'Fermer la fenêtre conserve la réception en arrière-plan.';
  native.onSettings((value) => {
    const pauseChanged = settings.paused !== value.paused;
    settings = value;
    renderSettings();
    if (pauseChanged && rooms.session.connected)
      rooms.session.request('status', { paused: settings.paused }).catch(() => {});
  });
  native.onError((message) => notify(message, true));
  await presets.init();
  await rooms.init(info);
  renderSettings();
  document.body.dataset.ready = 'true';
}
init().catch((error) => {
  $('#connection-status').textContent = 'Initialisation impossible.';
  notify(error.message, true);
});
