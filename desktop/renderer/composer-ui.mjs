import { hasTimedMedia, parseSubtitles, LIMITS } from '../../shared/protocol.mjs';
import { mountReaction } from '../../shared/render/media-view.mjs';
import { preparePreview } from './preview-source.mjs';
import { $, node, notify } from './dom.mjs';
export function createComposerUI({ native, rooms, getSettings }) {
  const { session } = rooms;
  let library = [],
    visual = null,
    audio = null,
    cues = [],
    sending = false,
    importing = false,
    presetBusy = false,
    nextSend = 0,
    preview;
  function renderSend() {
    const automatic = hasTimedMedia({ media: visual, audio });
    $('#duration').hidden = automatic;
    $('#duration').disabled = automatic;
    $('#duration-label').hidden = automatic;
    $('#automatic-duration').hidden = !automatic;
    const hasContent = !!($('#caption').value.trim() || visual || audio);
    const busy = sending || importing || Date.now() < nextSend;
    $('#broadcast').disabled = !session.connected || !hasContent || busy;
    $('#broadcast').textContent = sending ? 'Envoi…' : 'Envoyer';
    $('#preview-play').disabled = !hasContent || importing;
    $('#save-preset').disabled = !hasContent || importing || presetBusy;
    $('#attach-file').disabled = importing;
    $('#attach-audio').disabled = importing;
    $('#attach-file').textContent = importing ? 'Import…' : 'Image / vidéo';
    $('#attach-audio').textContent = audio ? 'Remplacer l’audio' : 'Ajouter un audio';
    $('#audio-replacement').hidden = !(visual?.kind === 'video' && audio);
    $('#send-status').textContent = !session.connected
      ? 'Sélectionnez une room pour envoyer.'
      : importing
        ? 'Import et vérification du fichier…'
        : Date.now() < nextSend
          ? 'Patientez quelques secondes avant le prochain envoi.'
          : automatic
            ? 'Lecture après téléchargement complet. Fichiers supprimés du serveur après 10 min.'
            : 'Le compteur démarre après chargement. Fichiers supprimés du serveur après 10 min.';
    for (const button of document.querySelectorAll('[data-load-preset]'))
      button.disabled = !session.connected || importing || sending;
  }
  function currentReaction() {
    return {
      caption: $('#caption').value,
      sender: rooms.client.nickname,
      mediaId: visual?.id || null,
      audioId: audio?.id || null,
      media: visual,
      audio,
      duration: Number($('#duration').value),
      subtitles: cues,
      server: rooms.resolveServer(session.target?.server || 'local'),
    };
  }
  function renderAttachments() {
    const list = $('#attachments');
    for (const player of list.querySelectorAll('audio,video')) {
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
    list.replaceChildren();
    for (const asset of [visual, audio].filter(Boolean)) {
      const row = node('div', undefined, 'attachment');
      if (asset.kind !== 'audio') {
        const image = node(asset.kind === 'video' ? 'video' : 'img');
        image.src = new URL(asset.url, rooms.resolveServer(session.target.server)).href;
        if (asset.kind === 'video') {
          image.muted = true;
          image.preload = 'metadata';
        } else image.alt = asset.name;
        row.append(image);
      }
      const info = node('div', undefined, 'attachment-info');
      info.append(
        node('strong', asset.name),
        node(
          'small',
          `${asset.kind === 'video' ? 'Vidéo' : asset.kind === 'audio' ? 'Audio' : 'Image'} · ${(asset.bytes / 1024 / 1024).toFixed(1)} Mo`,
        ),
      );
      const remove = node('button', 'Retirer', 'text-button');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Retirer ${asset.name}`);
      remove.addEventListener('click', () => {
        if (asset === visual) visual = null;
        else audio = null;
        renderAttachments();
      });
      row.append(info, remove);
      list.append(row);
    }
    renderSend();
  }
  function renderLibrary() {
    $('#existing-media').replaceChildren(new Option('Choisir un fichier', ''));
    for (const asset of library) $('#existing-media').add(new Option(asset.name, asset.id));
  }
  $('#caption').addEventListener('input', renderSend);
  $('#send-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if ($('#broadcast').disabled) return;
    sending = true;
    renderSend();
    try {
      await session.request('broadcast', currentReaction());
      nextSend = Date.now() + 3000;
      setTimeout(renderSend, 3050);
      notify('Envoyé.');
    } catch (error) {
      notify(error.message, true);
    } finally {
      sending = false;
      renderSend();
    }
  });
  function attach(asset) {
    if (asset.kind === 'audio') audio = asset;
    else visual = asset;
    renderAttachments();
  }
  async function uploadFiles(files) {
    if (importing) return;
    if (!session.connected || !session.room) {
      notify('Sélectionnez une room avant d’ajouter un fichier.');
      return;
    }
    importing = true;
    renderSend();
    const currentEpoch = session.epoch,
      currentRoom = session.room,
      server = rooms.resolveServer(session.target.server);
    try {
      for (const file of files.slice(0, 2)) {
        if (file.size > LIMITS.uploadBytes) throw new Error(`${file.name} dépasse 1 Go.`);
        let response;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (currentEpoch !== session.epoch || session.room !== currentRoom) return;
          response = await fetch(`${server}/api/media`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${currentRoom.token}`,
              'Content-Type': 'application/octet-stream',
              'X-Filename': encodeURIComponent(file.name),
            },
            body: file,
            signal: AbortSignal.timeout(LIMITS.transferTimeoutMs),
          });
          if (response.status !== 429 || attempt === 2) break;
          await response.arrayBuffer();
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Import impossible.');
        if (currentEpoch !== session.epoch || session.room !== currentRoom) return;
        if (!library.some((asset) => asset.id === data.id)) library.push(data);
        attach(data);
        renderLibrary();
      }
    } catch (error) {
      notify(
        error.name === 'TimeoutError' ? 'L’import a pris trop de temps.' : error.message,
        true,
      );
    } finally {
      importing = false;
      renderSend();
    }
  }
  $('#attach-file').addEventListener('click', () => {
    if (!session.connected) {
      notify('Sélectionnez une room avant d’ajouter un fichier.');
      return;
    }
    $('#file-input').click();
  });
  $('#file-input').addEventListener('change', (event) => {
    uploadFiles([...event.target.files]);
    event.target.value = '';
  });
  $('#attach-audio').addEventListener('click', () => {
    if (!session.connected) {
      notify('Sélectionnez une room avant d’ajouter un audio.');
      return;
    }
    $('#audio-input').click();
  });
  $('#audio-input').addEventListener('change', (event) => {
    uploadFiles([...event.target.files]);
    event.target.value = '';
  });
  for (const type of ['dragenter', 'dragover'])
    $('#drop-zone').addEventListener(type, (event) => {
      event.preventDefault();
      $('#drop-zone').classList.add('dragging');
    });
  $('#drop-zone').addEventListener('dragleave', () => $('#drop-zone').classList.remove('dragging'));
  $('#drop-zone').addEventListener('drop', (event) => {
    event.preventDefault();
    $('#drop-zone').classList.remove('dragging');
    uploadFiles([...event.dataTransfer.files]);
  });
  $('#existing-media').addEventListener('change', (event) => {
    const asset = library.find((item) => item.id === event.target.value);
    if (asset) attach(asset);
    event.target.value = '';
  });
  function renderSubtitles() {
    $('#subtitle-label').textContent = cues.length ? `${cues.length} sous-titre(s)` : '';
    $('#clear-subtitles').hidden = !cues.length;
  }
  $('#subtitle-button').addEventListener('click', () => $('#subtitle-input').click());
  $('#subtitle-input').addEventListener('change', async (event) => {
    try {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 32000) throw new Error('Le fichier SRT dépasse 32 Ko.');
      const parsed = parseSubtitles(await file.text());
      if (!parsed.length) throw new Error('Aucun sous-titre valide dans ce fichier.');
      cues = parsed;
      renderSubtitles();
    } catch (error) {
      notify(error.message, true);
    } finally {
      event.target.value = '';
    }
  });
  $('#clear-subtitles').addEventListener('click', () => {
    cues = [];
    renderSubtitles();
  });
  $('#preview-play').addEventListener('click', () => {
    $('#preview-dialog').showModal();
    preview?.destroy();
    $('#preview-loading').hidden = false;
    preview = mountReaction($('#large-preview'), currentReaction(), {
      prepareSource: preparePreview,
      volume: getSettings().volume,
      autoplay: true,
      onReady: () => {
        $('#preview-loading').hidden = true;
      },
      onDone: () => $('#preview-dialog').close(),
      onError: () => {
        $('#preview-dialog').close();
        notify('Impossible de lire ce fichier.', true);
      },
    });
  });
  $('#preview-dialog').addEventListener('close', () => {
    preview?.destroy();
    preview = null;
  });
  async function loadSavedMessage(value) {
    if (!session.connected || importing || sending) return;
    const currentEpoch = session.epoch,
      currentRoom = session.room,
      server = rooms.resolveServer(session.target.server);
    importing = true;
    renderSend();
    notify('Chargement du message et de ses fichiers…');
    try {
      const data = await native.loadPreset(value.id, server, currentRoom.token);
      if (session.epoch !== currentEpoch || session.room !== currentRoom) return;
      visual = data.media;
      audio = data.audio;
      cues = data.subtitles;
      $('#caption').value = data.caption;
      $('#duration').value = String(data.duration);
      for (const asset of [visual, audio].filter(Boolean))
        if (!library.some((item) => item.id === asset.id)) library.push(asset);
      renderLibrary();
      renderAttachments();
      renderSubtitles();
      notify(`« ${value.name} » prêt à envoyer.`);
      return true;
    } catch (error) {
      notify(error.message, true);
    } finally {
      importing = false;
      renderSend();
    }
  }

  function reset(clearCaption = false) {
    if (!clearCaption) library = [];
    visual = audio = null;
    cues = [];
    if (clearCaption) $('#caption').value = '';
    renderLibrary();
    renderAttachments();
    renderSubtitles();
  }
  return {
    reaction: currentReaction,
    render: renderSend,
    reset,
    load: loadSavedMessage,
    setPresetBusy(value) {
      presetBusy = value;
      renderSend();
    },
    setLibrary(value) {
      library = value;
      visual = library.find((item) => item.id === visual?.id) || null;
      audio = library.find((item) => item.id === audio?.id) || null;
      renderLibrary();
      renderAttachments();
    },
  };
}
