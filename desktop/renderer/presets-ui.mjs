import { $, node, notify } from './dom.mjs';
export function createPresetsUI({ native, composer }) {
  let presets = [],
    editingPreset = null,
    presetBusy = false;
  function showMessages(saved) {
    $('#send-form').hidden = saved;
    $('#presets-panel').hidden = !saved;
    $('#show-composer').setAttribute('aria-pressed', String(!saved));
    $('#show-presets').setAttribute('aria-pressed', String(saved));
    if (saved) renderPresets();
  }
  function renderPresets() {
    $('#preset-count').textContent = String(presets.length);
    const list = $('#presets-list');
    list.replaceChildren();
    const query = $('#preset-search').value.toLocaleLowerCase('fr');
    const filtered = presets.filter((value) => value.name.toLocaleLowerCase('fr').includes(query));
    if (!filtered.length)
      list.append(
        node(
          'p',
          presets.length
            ? 'Aucun message trouvé.'
            : 'Composez un message, puis cliquez sur Enregistrer.',
          'muted note',
        ),
      );
    for (const value of filtered) {
      const row = node('div', undefined, 'preset-entry'),
        info = node('div', undefined, 'preset-info'),
        actions = node('div', undefined, 'preset-actions');
      const kinds = [
        value.media?.kind === 'video' ? 'Vidéo' : value.media ? 'Image' : null,
        value.audio ? 'Audio' : null,
        value.caption ? 'Texte' : null,
      ]
        .filter(Boolean)
        .join(' + ');
      info.append(node('strong', value.name), node('small', kinds, 'muted'));
      if (value.caption) info.append(node('p', value.caption));
      const load = node('button', 'Charger');
      load.type = 'button';
      load.dataset.loadPreset = value.id;
      load.addEventListener('click', () =>
        composer.load(value).then((loaded) => {
          if (loaded) showMessages(false);
        }),
      );
      const rename = node('button', 'Renommer', 'text-button');
      rename.type = 'button';
      rename.addEventListener('click', () => openPresetDialog(value));
      const remove = node('button', 'Supprimer', 'text-button');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          await native.removePreset(value.id);
          presets = presets.filter((item) => item.id !== value.id);
          renderPresets();
        } catch (error) {
          notify(error.message, true);
          remove.disabled = false;
        }
      });
      actions.append(load, rename, remove);
      row.append(info, actions);
      list.append(row);
    }
    composer.render();
  }
  function openPresetDialog(value = null) {
    const reaction = composer.reaction();
    editingPreset = value?.id || null;
    $('#preset-dialog-title').textContent = value
      ? 'Renommer le message'
      : 'Enregistrer le message';
    $('#preset-name').value =
      value?.name ||
      reaction.caption.trim().slice(0, 60) ||
      reaction.media?.name ||
      reaction.audio?.name ||
      '';
    $('#preset-error').textContent = '';
    $('#preset-dialog').showModal();
    $('#preset-name').focus();
  }
  $('#show-composer').addEventListener('click', () => showMessages(false));
  $('#show-presets').addEventListener('click', () => showMessages(true));
  $('#preset-search').addEventListener('input', renderPresets);
  $('#new-message').addEventListener('click', () => {
    composer.reset(true);
    showMessages(false);
    $('#caption').focus();
  });
  $('#save-preset').addEventListener('click', () => openPresetDialog());
  $('#preset-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (presetBusy) return;
    const id = editingPreset,
      name = $('#preset-name').value,
      reaction = composer.reaction();
    presetBusy = true;
    composer.setPresetBusy(true);
    $('#preset-submit').disabled = true;
    $('#preset-submit').textContent = 'Enregistrement…';
    $('#preset-error').textContent = '';
    composer.render();
    try {
      if (id) await native.renamePreset(id, name);
      else await native.savePreset({ name, reaction });
      presets = await native.listPresets();
      renderPresets();
      $('#preset-dialog').close();
      notify('Message enregistré sur cet appareil.');
    } catch (error) {
      $('#preset-error').textContent = error.message;
      if (!$('#preset-dialog').open) notify(error.message, true);
    } finally {
      presetBusy = false;
      composer.setPresetBusy(false);
      $('#preset-submit').disabled = false;
      $('#preset-submit').textContent = 'Enregistrer';
      composer.render();
    }
  });

  return {
    async init() {
      presets = await native.listPresets();
      renderPresets();
    },
  };
}
