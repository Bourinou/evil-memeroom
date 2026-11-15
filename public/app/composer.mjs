import { hasTimedMedia, LIMITS, parseSubtitles, getGifDuration, embedReactionMeta, applyReactionMeta } from '../shared/protocol.mjs';
import { mountReaction } from '../media-view.mjs';
import { $, node, state, notify, resolveServer } from './state.mjs';
import { extractAudioFromFileOrBuffer, uploadMedia, uploadSilentAudio } from './upload.mjs';
import { renderLibrary } from './rooms.mjs';
import { openTrimDialog } from './trim.mjs';
import { showTab } from '../app.mjs';

let sending = false, importing = false, nextSend = 0, preview;
let gifDurationMode = 'plays';
const gifDurationCache = new Map();
function isVisualGif(asset) {
  if (!asset) return false;
  return asset.mime === 'image/gif' || /\.gif$/i.test(asset.name || '');
}
export function cacheGifInfo(asset, info) {
  if (!asset) return;
  if (asset.id) gifDurationCache.set(asset.id, info);
  if (asset.url) gifDurationCache.set(asset.url, info);
  if (asset.name) gifDurationCache.set(asset.name, info);
}
export function getCachedGifInfo(asset) {
  if (!asset) return undefined;
  if (asset.id && gifDurationCache.has(asset.id)) return gifDurationCache.get(asset.id);
  if (asset.url && gifDurationCache.has(asset.url)) return gifDurationCache.get(asset.url);
  if (asset.name && gifDurationCache.has(asset.name)) return gifDurationCache.get(asset.name);
  return undefined;
}
function loadGifDuration(asset) {
  if (!asset || !isVisualGif(asset)) return;
  const cached = getCachedGifInfo(asset);
  if (cached !== undefined) {
    if (cached) {
      asset.gifDuration = cached.durationSec;
      asset.gifFrameCount = cached.frameCount;
    }
    return;
  }
  if (asset._loadingGif) return;
  asset._loadingGif = true;
  const mediaUrl = asset.url ? new URL(asset.url, resolveServer(state.target?.server || 'local')).href : '';
  if (!mediaUrl) {
    asset._loadingGif = false;
    return;
  }
  fetch(mediaUrl)
    .then(r => r.arrayBuffer())
    .then(buf => {
      const info = getGifDuration(buf);
      cacheGifInfo(asset, info || false);
      if (info) {
        asset.gifDuration = info.durationSec;
        asset.gifFrameCount = info.frameCount;
      }
      renderSend();
    })
    .catch(() => {
      cacheGifInfo(asset, false);
    })
    .finally(() => {
      asset._loadingGif = false;
    });
}
export function renderSend() {
  const timed = hasTimedMedia({ media: state.visual, audio: state.audio });
  const isTrimmed = !!(state.visual?.isTrimmed || state.audio?.isTrimmed);
  if (isTrimmed && $('#custom-duration-toggle')) {
    $('#custom-duration-toggle').checked = false;
  }
  const custom = timed && !isTrimmed && !!$('#custom-duration-toggle')?.checked;
  $('#custom-duration-wrap').hidden = !timed || isTrimmed;
  if (timed) {
    $('#automatic-duration').textContent = state.visual?.kind === 'video' ? 'Vidéo complète' : 'Audio complet';
  }
  const showDurationControls = !timed || custom;
  $('#automatic-duration').hidden = !timed || custom;

  const isGif = isVisualGif(state.visual);
  if (isGif) loadGifDuration(state.visual);
  const cachedGif = getCachedGifInfo(state.visual);
  const isAnimatedGif = isGif && cachedGif !== false;
  const gifModeSelect = $('#gif-mode-select');
  const gifPlaysWrap = $('#gif-plays-wrap');
  const gifPlaysInput = $('#gif-plays');
  const gifPlaysHint = $('#gif-plays-hint');
  const durationInput = $('#duration');
  const durationLabel = $('#duration-label');
  const durationUnit = $('#duration-unit');

  if (showDurationControls && isAnimatedGif) {
    if (durationLabel) durationLabel.hidden = true;
    if (gifModeSelect) {
      gifModeSelect.style.display = 'inline-block';
      gifModeSelect.value = gifDurationMode;
    }
    if (gifDurationMode === 'plays') {
      if (gifPlaysWrap) gifPlaysWrap.style.display = 'inline-flex';
      if (durationInput) { durationInput.hidden = true; durationInput.disabled = false; }
      if (durationUnit) durationUnit.hidden = true;
      const plays = Math.max(1, Math.min(100, Math.round(Number(gifPlaysInput?.value || 1))));
      const gifDur = state.visual?.gifDuration || (cachedGif ? cachedGif.durationSec : null);
      if (gifDur) {
        const totalSec = Math.max(0.1, Math.round(plays * gifDur * 10) / 10);
        if (durationInput) durationInput.value = String(totalSec);
        if (gifPlaysHint) {
          gifPlaysHint.textContent = plays > 1 ? `lectures (${totalSec}s)` : `lecture (${totalSec}s)`;
        }
      } else {
        if (durationInput && !durationInput.value) durationInput.value = '5';
        if (gifPlaysHint) {
          gifPlaysHint.textContent = plays > 1 ? 'lectures' : 'lecture';
        }
      }
    } else {
      if (gifPlaysWrap) gifPlaysWrap.style.display = 'none';
      if (durationInput) { durationInput.hidden = false; durationInput.disabled = false; }
      if (durationUnit) durationUnit.hidden = false;
    }
  } else {
    if (gifModeSelect) gifModeSelect.style.display = 'none';
    if (gifPlaysWrap) gifPlaysWrap.style.display = 'none';
    if (durationLabel) durationLabel.hidden = !showDurationControls;
    if (durationInput) {
      durationInput.hidden = !showDurationControls;
      durationInput.disabled = !showDurationControls;
    }
    if (durationUnit) durationUnit.hidden = !showDurationControls;
  }

  const hasContent = !!($('#caption').value.trim() || state.visual || state.audio);
  const busy = sending || importing || Date.now() < nextSend;
  $('#broadcast').disabled = !state.connected || !hasContent || busy;
  $('#broadcast').textContent = sending ? 'Envoi…' : 'Envoyer';
  $('#preview-play').disabled = !hasContent || importing;
  $('#attach-file').disabled = importing;
  $('#attach-audio').disabled = importing;
  $('#attach-file').textContent = importing ? 'Import…' : 'Image / vidéo';
  $('#attach-audio').textContent = state.audio ? 'Remplacer l’audio' : 'Ajouter un audio';
  $('#audio-replacement').hidden = !(state.visual?.kind === 'video' && state.audio);
  $('#send-status').textContent = !state.connected ? 'Sélectionnez une room pour envoyer.' : importing ? 'Import et vérification du fichier…' : Date.now() < nextSend ? 'Patientez quelques secondes avant le prochain envoi.' : '';
}
function currentReaction() {
  const timed = hasTimedMedia({ media: state.visual, audio: state.audio });
  const isTrimmed = !!(state.visual?.isTrimmed || state.audio?.isTrimmed);
  const custom = timed && !isTrimmed && !!$('#custom-duration-toggle')?.checked;
  const isGif = isVisualGif(state.visual);
  const cachedGif = getCachedGifInfo(state.visual);
  const isAnimatedGif = isGif && cachedGif !== false;
  let duration = Number($('#duration').value);
  if (isAnimatedGif && (!timed || custom) && gifDurationMode === 'plays') {
    const plays = Math.max(1, Math.min(100, Math.round(Number($('#gif-plays')?.value || 1))));
    const gifDur = state.visual?.gifDuration || (cachedGif ? cachedGif.durationSec : null);
    if (gifDur) {
      duration = Math.max(0.1, Math.round(plays * gifDur * 10) / 10);
    }
  }
  const payloadCues = custom ? embedReactionMeta(state.cues, { customDuration: true, duration }) : state.cues;
  return {
    caption: $('#caption').value,
    sender: state.client.nickname,
    mediaId: state.visual?.id || null,
    audioId: state.audio?.id || null,
    media: state.visual,
    audio: state.audio,
    duration,
    durationMode: custom ? 'fixed' : (timed ? 'media' : 'fixed'),
    subtitles: payloadCues,
    server: resolveServer(state.target?.server || 'local'),
    ...(custom ? { customDuration: true } : {})
  };
}
export function renderAttachments() {
  const list = $('#attachments');
  for (const player of list.querySelectorAll('audio,video')) { player.pause(); player.removeAttribute('src'); player.load(); }
  list.replaceChildren();
  for (const asset of [state.visual, state.audio].filter(Boolean)) {
    const isAudioSlot = asset === state.audio;
    const row = node('div', undefined, 'attachment');
    if (asset.kind !== 'audio') {
      const image = node(asset.kind === 'video' ? 'video' : 'img');
      image.src = new URL(asset.url, resolveServer(state.target?.server || 'local')).href;
      if (asset.kind === 'video') { image.muted = true; image.preload = 'metadata'; } else image.alt = asset.name;
      row.append(image);
    }
    const info = node('div', undefined, 'attachment-info');
    const hasOriginalVideo = Boolean(asset._originalVideo);
    const kindLabel = hasOriginalVideo
      ? 'Son extrait d’une vidéo'
      : asset.kind === 'video'
        ? (isAudioSlot ? 'Vidéo (son uniquement)' : 'Vidéo')
        : asset.kind === 'audio' ? 'Audio' : 'Image';
    info.append(node('strong', asset.name), node('small', `${kindLabel} · ${(asset.bytes / 1024 / 1024).toFixed(1)} Mo`));

    if (asset.kind === 'video' || hasOriginalVideo) {
      const checkLabel = node('label', undefined, 'check');
      checkLabel.style.margin = '4px 0 0 0';
      checkLabel.style.fontSize = '12px';
      checkLabel.style.gap = '5px';
      checkLabel.style.cursor = 'pointer';
      const checkbox = node('input');
      checkbox.type = 'checkbox';
      checkbox.checked = isAudioSlot;
      checkbox.addEventListener('change', async () => {
        if (checkbox.checked) {
          checkbox.disabled = true;
          try {
            const targetVideoId = asset.id;
            const wasVisual = state.visual === asset || state.visual?.id === targetVideoId;
            let audioAsset = asset;
            if (asset.kind === 'video') {
              notify('Extraction du son de la vidéo…');
              const mediaUrl = new URL(asset.url, resolveServer(state.target?.server || 'local')).href;
              const resp = await fetch(mediaUrl);
              const arrayBuf = await resp.arrayBuffer();
              const audioFile = await extractAudioFromFileOrBuffer(asset.name, arrayBuf);
              audioAsset = await uploadMedia(audioFile, state.epoch, state.room);
              audioAsset._originalVideo = asset;
              if (!state.library.some(a => a.id === audioAsset.id)) state.library.push(audioAsset);
            }
            state.audio = audioAsset;
            if (wasVisual || state.visual?.id === targetVideoId || state.visual === asset || state.visual?._originalVideo?.id === targetVideoId) {
              state.visual = null;
            }
            notify('Piste audio prête.');
          } catch (err) {
            checkbox.checked = false;
            notify(`Erreur lors de l’extraction audio : ${err.message}`, true);
            return;
          } finally {
            checkbox.disabled = false;
          }
        } else {
          if (asset._originalVideo) {
            state.visual = asset._originalVideo;
            state.audio = null;
          } else {
            state.visual = asset;
            if (state.audio === asset) state.audio = null;
          }
        }
        if (!hasTimedMedia({ media: state.visual, audio: state.audio })) {
          const toggle = $('#custom-duration-toggle');
          if (toggle) toggle.checked = false;
        }
        renderAttachments();
        renderSend();
      });
      checkLabel.append(checkbox, document.createTextNode('Utiliser uniquement le son'));
      info.append(checkLabel);
    }

    const actions = node('div', undefined, 'row');
    actions.style.gap = '8px';
    if (asset.kind === 'video' || asset.kind === 'audio') {
      const customActive = $('#custom-duration-toggle')?.checked;
      const trimBtn = node('button', asset.isTrimmed ? 'Découpé' : 'Découper', 'attachment-trim-btn text-button');
      trimBtn.type = 'button';
      trimBtn.setAttribute('aria-label', `Découper ${asset.name}`);
      if (customActive) {
        trimBtn.disabled = true;
        trimBtn.title = 'Désactivez « Choisir la durée » pour découper le média.';
        trimBtn.style.opacity = '0.4';
        trimBtn.style.cursor = 'not-allowed';
      } else {
        trimBtn.addEventListener('click', () => openTrimDialog(asset));
      }
      actions.append(trimBtn);
    }
    const remove = node('button', 'Retirer', 'text-button'); remove.type = 'button'; remove.setAttribute('aria-label', `Retirer ${asset.name}`);
    remove.addEventListener('click', () => {
      if (asset === state.visual) state.visual = null; else state.audio = null;
      if (!hasTimedMedia({ media: state.visual, audio: state.audio })) {
        const toggle = $('#custom-duration-toggle');
        if (toggle) toggle.checked = false;
      }
      renderAttachments();
    });
    actions.append(remove);
    row.append(info, actions); list.append(row);
  }
  renderSend();
}
$('#caption').addEventListener('input', renderSend);
$('#custom-duration-toggle')?.addEventListener('change', () => {
  renderSend();
  renderAttachments();
});
$('#gif-mode-select')?.addEventListener('change', () => {
  gifDurationMode = $('#gif-mode-select').value;
  const cached = getCachedGifInfo(state.visual);
  const gifDur = state.visual?.gifDuration || (cached ? cached.durationSec : null);
  if (gifDurationMode === 'plays' && gifDur) {
    const plays = Math.max(1, Math.min(100, Math.round(Number($('#gif-plays')?.value || 1))));
    const totalSec = Math.max(0.1, Math.round(plays * gifDur * 10) / 10);
    if ($('#duration')) $('#duration').value = String(totalSec);
  }
  renderSend();
});
const updateGifPlays = () => {
  const plays = Math.max(1, Math.min(100, Math.round(Number($('#gif-plays')?.value || 1))));
  const cached = getCachedGifInfo(state.visual);
  const gifDur = state.visual?.gifDuration || (cached ? cached.durationSec : null);
  if (gifDur) {
    const totalSec = Math.max(0.1, Math.round(plays * gifDur * 10) / 10);
    if ($('#duration')) $('#duration').value = String(totalSec);
    const hint = $('#gif-plays-hint');
    if (hint) hint.textContent = plays > 1 ? `lectures (${totalSec}s)` : `lecture (${totalSec}s)`;
  }
};
$('#gif-plays')?.addEventListener('input', updateGifPlays);
$('#gif-plays')?.addEventListener('change', updateGifPlays);
$('#send-form').addEventListener('submit', async event => {
  event.preventDefault(); if ($('#broadcast').disabled) return;
  sending = true; renderSend();
  try {
    if (state.audio && state.audio.kind === 'video') {
      notify('Préparation de la piste audio…');
      const mediaUrl = new URL(state.audio.url, resolveServer(state.target?.server || 'local')).href;
      const resp = await fetch(mediaUrl);
      const arrayBuf = await resp.arrayBuffer();
      const audioFile = await extractAudioFromFileOrBuffer(state.audio.name, arrayBuf);
      const audioAsset = await uploadMedia(audioFile, state.epoch, state.room);
      audioAsset._originalVideo = state.audio;
      if (!state.library.some(a => a.id === audioAsset.id)) state.library.push(audioAsset);
      state.audio = audioAsset;
    }
    const payload = currentReaction();
    const durationVal = Number(payload.duration);
    if (!state.audio && state.visual?.kind !== 'video' && Number.isFinite(durationVal) && (durationVal < 2 || durationVal > LIMITS.durationMax)) {
      const silentAsset = await uploadSilentAudio(durationVal);
      payload.audioId = silentAsset.id;
      payload.audio = silentAsset;
      payload.customDuration = true;
    }
    await state.connection.request('broadcast', payload);
    nextSend = Date.now() + LIMITS.cooldownMs;
    setTimeout(renderSend, LIMITS.cooldownMs + 50);
    notify('Envoyé.');
  }
  catch (error) { notify(error.message, true); }
  finally { sending = false; renderSend(); }
});
export function attach(asset, asAudio = false) {
  if (asAudio || asset.kind === 'audio') {
    state.audio = asset;
  } else {
    state.visual = asset;
    if (isVisualGif(asset)) {
      gifDurationMode = 'plays';
      const playsInput = $('#gif-plays');
      if (playsInput) playsInput.value = '1';
      loadGifDuration(asset);
    }
  }
  renderAttachments();
  renderSend();
}
export async function uploadFiles(files, asAudio = false) {
  if (importing) return;
  if (!state.connected || !state.room) { notify('Sélectionnez une room avant d’ajouter un fichier.'); return; }
  if (files.length > 2) notify('2 fichiers maximum : seuls les 2 premiers sont ajoutés.');
  importing = true; renderSend(); const currentEpoch = state.epoch, currentRoom = state.room;
  try {
    for (let file of files.slice(0, 2)) {
      if (asAudio && (file.type.startsWith('video/') || /\.(mp4|webm|mkv|mov)$/i.test(file.name))) {
        notify('Extraction du son de la vidéo…');
        const arrayBuf = await file.arrayBuffer();
        file = await extractAudioFromFileOrBuffer(file.name, arrayBuf);
      }
      let gifInfo = file._gifInfo || null;
      if (!gifInfo && !asAudio && (file.type === 'image/gif' || /\.gif$/i.test(file.name))) {
        try {
          const arrayBuf = await file.arrayBuffer();
          gifInfo = getGifDuration(arrayBuf);
        } catch {}
      }
      if (file.size > LIMITS.uploadBytes) throw new Error(`${file.name} dépasse 1 Go.`);
      const data = await uploadMedia(file, currentEpoch, currentRoom);
      if (currentEpoch !== state.epoch || state.room !== currentRoom) return;
      if (gifInfo) {
        data.gifDuration = gifInfo.durationSec;
        data.gifFrameCount = gifInfo.frameCount;
        cacheGifInfo(data, gifInfo);
        cacheGifInfo({ id: data.id, url: data.url, name: file.name }, gifInfo);
      }
      if (!state.library.some(asset => asset.id === data.id)) state.library.push(data);
      attach(data, asAudio); renderLibrary();
    }
  } catch (error) { notify(error.name === 'TimeoutError' ? 'L’import a pris trop de temps.' : error.message, true); }
  finally { importing = false; renderSend(); }
}
$('#attach-file').addEventListener('click', () => {
  if (!state.connected) { notify('Sélectionnez une room avant d’ajouter un fichier.'); return; }
  $('#file-input').click();
});
$('#file-input').addEventListener('change', event => { uploadFiles([...event.target.files]); event.target.value = ''; });
$('#attach-audio').addEventListener('click', () => { if (!state.connected) { notify('Sélectionnez une room avant d’ajouter un audio.'); return; } $('#audio-input').click(); });
$('#audio-input').addEventListener('change', event => { uploadFiles([...event.target.files], true); event.target.value = ''; });
for (const type of ['dragenter','dragover']) $('#drop-zone').addEventListener(type, event => { event.preventDefault(); $('#drop-zone').classList.add('dragging'); });
$('#drop-zone').addEventListener('dragleave', () => $('#drop-zone').classList.remove('dragging'));
$('#drop-zone').addEventListener('drop', event => { event.preventDefault(); $('#drop-zone').classList.remove('dragging'); uploadFiles([...event.dataTransfer.files]); });
window.addEventListener('paste', async event => {
  const modal = document.querySelector('dialog[open]:not(#preview-dialog)');
  if (modal) return;
  const clipboard = event.clipboardData;
  if (!clipboard) return;
  const files = [];
  if (clipboard.files && clipboard.files.length > 0) {
    for (const f of clipboard.files) {
      if (f.type.startsWith('image/') || f.type.startsWith('video/') || f.type.startsWith('audio/') || /\.(png|jpe?g|gif|webp|mp4|webm|mp3|wav|ogg)$/i.test(f.name)) {
        files.push(f);
      }
    }
  }
  if (!files.length && clipboard.items) {
    for (const item of clipboard.items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f && (f.type.startsWith('image/') || f.type.startsWith('video/') || f.type.startsWith('audio/'))) {
          const namedFile = f.name ? f : new File([f], f.type.startsWith('image/') ? 'image.png' : (f.type.startsWith('video/') ? 'video.mp4' : 'audio.mp3'), { type: f.type });
          files.push(namedFile);
        }
      }
    }
  }
  if (files.length > 0) {
    event.preventDefault();
    if (!state.connected || !state.room) {
      notify('Sélectionnez une room avant d’ajouter un fichier.');
      return;
    }
    showTab(false);
    await uploadFiles(files);
  }
});
$('#existing-media')?.addEventListener('change', event => { const asset = state.library.find(item => item.id === event.target.value); if (asset) attach(asset); event.target.value = ''; });
export function renderSubtitles() { $('#subtitle-label').textContent = state.cues.length ? `${state.cues.length} sous-titre(s)` : ''; $('#clear-subtitles').hidden = !state.cues.length; }
$('#subtitle-button').addEventListener('click', () => $('#subtitle-input').click());
$('#subtitle-input').addEventListener('change', async event => {
  try {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 32000) throw new Error('Le fichier SRT dépasse 32 Ko.');
    const parsed = parseSubtitles(await file.text()); if (!parsed.length) throw new Error('Aucun sous-titre valide dans ce fichier.');
    state.cues = parsed; renderSubtitles();
  } catch (error) { notify(error.message, true); } finally { event.target.value = ''; }
});
$('#clear-subtitles').addEventListener('click', () => { state.cues = []; renderSubtitles(); });
export function showPreview(reaction) {
  applyReactionMeta(reaction);
  $('#preview-dialog').showModal(); preview?.destroy(); $('#preview-loading').hidden = false;
  preview = mountReaction($('#large-preview'), reaction, { volume:state.settings.volume, autoplay:true, onReady:() => { $('#preview-loading').hidden = true; }, onDone:() => $('#preview-dialog').close(), onError:() => { $('#preview-dialog').close(); notify('Impossible de lire ce fichier.', true); } });
}
$('#preview-play').addEventListener('click', () => showPreview(currentReaction()));
$('#preview-dialog').addEventListener('close', () => { preview?.destroy(); preview = null; });
