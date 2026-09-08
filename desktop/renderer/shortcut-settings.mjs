import { validDismissShortcut } from '../../shared/settings.mjs';
const $ = (selector) => document.querySelector(selector);
export function createShortcutSettings({ native, getSettings, onChange, isMac }) {
  let recordingShortcut = false,
    shortcutBusy = false;
  const shortcutLabel = (value) =>
    value
      ? value
          .split('+')
          .map(
            (key) =>
              ({
                Control: 'Ctrl',
                Shift: 'Maj',
                Super: isMac() ? 'Cmd' : 'Windows',
                Space: 'Espace',
                Up: 'Haut',
                Down: 'Bas',
                Left: 'Gauche',
                Right: 'Droite',
              })[key] || key,
          )
          .join(' + ')
      : 'Choisir un raccourci';

  function render() {
    if (!recordingShortcut)
      $('#dismiss-shortcut').textContent = shortcutLabel(getSettings().dismissShortcut);
    $('#dismiss-shortcut').disabled = shortcutBusy;
    $('#disable-dismiss-shortcut').disabled = shortcutBusy || !getSettings().dismissShortcut;
  }
  async function stopShortcutCapture() {
    recordingShortcut = false;
    render();
    if (native) await native.recordShortcut(false);
  }
  async function saveDismissShortcut(value) {
    shortcutBusy = true;
    try {
      await stopShortcutCapture();
      onChange(await native.saveDismissShortcut(value));
      $('#shortcut-hint').textContent = value
        ? 'Raccourci enregistré. Arrête uniquement le contenu en cours sur votre écran.'
        : 'Raccourci désactivé.';
    } catch (error) {
      $('#shortcut-hint').textContent = error.message;
    } finally {
      shortcutBusy = false;
      render();
    }
  }
  $('#dismiss-shortcut').addEventListener('click', async () => {
    if (recordingShortcut) {
      await stopShortcutCapture();
      return;
    }
    try {
      await native.recordShortcut(true);
      recordingShortcut = true;
      $('#dismiss-shortcut').textContent = 'Appuyez sur les touches…';
      $('#shortcut-hint').textContent =
        `Ctrl, Alt ou ${isMac() ? 'Cmd' : 'Windows'} + une touche, ou F1 à F24. Échap pour annuler.`;
    } catch (error) {
      $('#shortcut-hint').textContent = error.message;
    }
  });
  $('#disable-dismiss-shortcut').addEventListener('click', () => saveDismissShortcut(''));
  $('#dismiss-shortcut').addEventListener('blur', () => {
    if (recordingShortcut) void stopShortcutCapture();
  });
  $('#settings-dialog').addEventListener('close', () => {
    if (recordingShortcut) void stopShortcutCapture();
  });
  window.addEventListener('blur', () => {
    if (recordingShortcut) void stopShortcutCapture();
  });
  document.addEventListener(
    'keydown',
    (event) => {
      if (!recordingShortcut) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape' || event.key === 'Tab') {
        void stopShortcutCapture();
        return;
      }
      if (event.repeat || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
      const aliases = {
        ' ': 'Space',
        ArrowUp: 'Up',
        ArrowDown: 'Down',
        ArrowLeft: 'Left',
        ArrowRight: 'Right',
      };
      const key =
        aliases[event.key] || (event.key.length === 1 ? event.key.toUpperCase() : event.key);
      const shortcut = [
        event.ctrlKey && 'Control',
        event.altKey && 'Alt',
        event.shiftKey && 'Shift',
        event.metaKey && 'Super',
        key,
      ]
        .filter(Boolean)
        .join('+');
      if (!validDismissShortcut(shortcut)) {
        $('#shortcut-hint').textContent =
          'Combinaison invalide. Ctrl + Maj + F8 reste réservé à la pause.';
        return;
      }
      void saveDismissShortcut(shortcut);
    },
    true,
  );

  return { render };
}
