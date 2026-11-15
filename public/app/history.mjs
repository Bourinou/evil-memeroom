import { hasTimedMedia } from '../shared/protocol.mjs';
import { mergeHistory, isInRoom, withRoom, savedFileName, setSavedName, renameSavedName, removeSavedName } from '../shared/history.mjs';
import { $, native, node, state, notify, resolveServer, SAVED_MIME_TYPES } from './state.mjs';
import { attach, uploadFiles, renderAttachments, renderSend, renderSubtitles, showPreview } from './composer.mjs';
import { showTab } from '../app.mjs';

const LEGACY_STORAGE_KEY = 'evil-memeroom:history';

// The history file (native.saveHistory) is the only store. The old localStorage copy is
// read one last time, merged into the file, then removed.
export async function loadHistory(fileList) {
  let legacy = [];
  let hadLegacy = false;
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw !== null) {
      hadLegacy = true;
      legacy = JSON.parse(raw);
    }
  } catch {}
  const merged = mergeHistory(fileList, legacy);
  if (hadLegacy) {
    try {
      await native.saveHistory(merged);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {}
  }
  return merged;
}
function saveHistory() {
  native.saveHistory(state.messageHistory).catch(() => {});
}
// Saved file names announced by the main process before their item reached the history.
const pendingSaved = new Map(); // asset id -> saved file name
const sameList = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);
function updateSavedNames(next) {
  if (sameList(next, state.messageHistory)) return;
  state.messageHistory = next;
  saveHistory();
  if (state.currentTab === 'history') renderHistory();
}
function forgetPending(name) {
  for (const [id, saved] of pendingSaved) if (saved === name) pendingSaved.delete(id);
}
// The main process saved asset `id` as file `name` (new file or duplicate of an existing one).
function markSaved({ id, name } = {}) {
  if (typeof id !== 'string' || typeof name !== 'string' || !name) return;
  if (state.messageHistory.some(item => item.media?.id === id || item.audio?.id === id)) {
    updateSavedNames(setSavedName(state.messageHistory, id, name));
    return;
  }
  pendingSaved.set(id, name);
  if (pendingSaved.size > 200) pendingSaved.delete(pendingSaved.keys().next().value);
}
native.onSavedMemesUpdated(markSaved);
export function savedMemeRenamed(oldName, newName) {
  forgetPending(oldName);
  updateSavedNames(renameSavedName(state.messageHistory, oldName, newName));
}
export function savedMemeRemoved(name) {
  forgetPending(name);
  updateSavedNames(removeSavedName(state.messageHistory, name));
}
// Add items (live events or server history); incoming items win over stored duplicates.
export function recordHistory(items) {
  for (const [id, name] of pendingSaved) {
    const named = setSavedName(items, id, name);
    if (!sameList(named, items)) { items = named; pendingSaved.delete(id); }
  }
  state.messageHistory = mergeHistory(withRoom(items, state.target?.code), state.messageHistory);
  saveHistory();
  updateHistoryBadge();
  if (state.currentTab === 'history') renderHistory();
}
// Items of the current room and server (plus old items without a room).
function visibleHistory() {
  const server = state.target ? resolveServer(state.target.server) : undefined;
  return state.messageHistory.filter(item => isInRoom(item, server, state.target?.code));
}
export function updateHistoryBadge() {
  const countEl = $('#history-count');
  if (countEl) countEl.textContent = String(visibleHistory().length);
}
function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
async function fetchHistoryFile(asset, server, fallbackName, fallbackMime) {
  const base = server || resolveServer(state.target?.server);
  if (asset.url) {
    try {
      const resp = await fetch(new URL(asset.url, base).href);
      if (resp.ok) {
        const blob = await resp.blob();
        return new File([blob], asset.name || fallbackName, { type: asset.mime || blob.type });
      }
    } catch {}
  }
  const savedName = savedFileName(asset);
  if (savedName) {
    try {
      const data = await native.readSavedMeme(savedName);
      const ext = savedName.slice(savedName.lastIndexOf('.')).toLowerCase();
      return new File([data.buffer], savedName, { type: asset.mime || SAVED_MIME_TYPES[ext] || fallbackMime });
    } catch {}
  }
  return null;
}
async function insertHistoryItem(item) {
  if (!state.connected || !state.room) {
    notify('Rejoignez une room avant d’insérer un message.', true);
    return;
  }
  showTab('composer');
  $('#caption').value = item.caption || '';
  if (item.duration) $('#duration').value = String(item.duration);
  if (hasTimedMedia(item) && item.customDuration) {
    if ($('#custom-duration-toggle')) $('#custom-duration-toggle').checked = true;
  }
  state.cues = item.subtitles || item.cues || [];
  renderSubtitles();

  // Empty both slots first: a missing media must not leave the previous attachment behind.
  state.visual = null;
  state.audio = null;
  let visualFile = null;
  let audioFile = null;
  if (item.media) {
    const existing = state.library.find(m => m.id === item.media.id);
    if (existing) attach(existing, false);
    else visualFile = await fetchHistoryFile(item.media, item.server, 'image', 'application/octet-stream');
  }
  if (item.audio) {
    const existing = state.library.find(m => m.id === item.audio.id);
    if (existing) attach(existing, true);
    else audioFile = await fetchHistoryFile(item.audio, item.server, 'audio.mp3', 'audio/mpeg');
  }
  renderAttachments();
  renderSend();

  if (visualFile) await uploadFiles([visualFile]);
  if (audioFile) await uploadFiles([audioFile], true);
  if ((item.media && !state.visual) || (item.audio && !state.audio)) {
    notify('Média introuvable : message inséré sans son média.', true);
    return;
  }
  notify('Message inséré dans le compositeur.');
}

export function renderHistory() {
  updateHistoryBadge();
  const container = $('#history-list');
  if (!container) return;
  for (const player of container.querySelectorAll('video')) { player.pause(); player.removeAttribute('src'); player.load(); }
  container.replaceChildren();

  const visible = visibleHistory();
  if (!visible.length) {
    const emptyMsg = node('p', 'Aucun message dans l’historique pour le moment.', 'muted');
    emptyMsg.style.padding = '30px 10px';
    emptyMsg.style.textAlign = 'center';
    container.append(emptyMsg);
    return;
  }

  for (const item of visible) {
    const card = node('div', undefined, 'history-card');

    if (item.media || item.audio) {
      const thumbBox = node('div', undefined, 'history-thumb-box');
      const mediaBase = item.server || resolveServer(state.target?.server);
      if (item.media?.kind === 'image') {
        const img = node('img', undefined, 'history-thumb');
        img.alt = item.media.name || 'Image';
        img.loading = 'lazy';
        let fallbackDone = false;
        img.onerror = () => {
          if (!fallbackDone && savedFileName(item.media)) {
            fallbackDone = true;
            img.src = `/saved-memes/${encodeURIComponent(savedFileName(item.media))}`;
            return;
          }
          img.remove();
          if (!thumbBox.querySelector('.history-icon')) {
            thumbBox.append(node('span', '🖼️', 'history-icon'));
          }
        };
        img.src = item.media.url ? new URL(item.media.url, mediaBase).href : '';
        thumbBox.append(img);
      } else if (item.media?.kind === 'video') {
        const vid = node('video', undefined, 'history-thumb');
        vid.muted = true;
        vid.preload = 'metadata';
        let vidFallbackDone = false;
        vid.onerror = () => {
          if (!vidFallbackDone && savedFileName(item.media)) {
            vidFallbackDone = true;
            vid.src = `/saved-memes/${encodeURIComponent(savedFileName(item.media))}#t=0.001`;
            return;
          }
          vid.remove();
          if (!thumbBox.querySelector('.history-icon')) {
            thumbBox.append(node('span', '🎬', 'history-icon'));
          }
        };
        vid.src = item.media.url ? `${new URL(item.media.url, mediaBase).href}#t=0.001` : '';
        thumbBox.append(vid);
        thumbBox.append(node('span', 'VID', 'history-badge'));
      } else if (item.audio) {
        thumbBox.append(node('span', '🎵', 'history-icon'));
        thumbBox.append(node('span', 'AUD', 'history-badge'));
      }
      card.append(thumbBox);
    }

    const body = node('div', undefined, 'history-body');
    const header = node('div', undefined, 'history-header');
    const sender = node('span', item.sender || 'Inconnu', 'history-sender');
    const time = node('span', formatTime(item.sentAt), 'history-time');
    header.append(sender, time);
    body.append(header);

    if (item.caption) {
      const caption = node('div', item.caption, 'history-caption');
      body.append(caption);
    }
    card.append(body);

    const actions = node('div', undefined, 'history-actions');
    const insertBtn = node('button', 'Insérer', 'history-btn-insert');
    insertBtn.type = 'button';
    insertBtn.setAttribute('title', 'Insérer dans le compositeur pour modifier ou renvoyer');
    insertBtn.addEventListener('click', e => {
      e.stopPropagation();
      void insertHistoryItem(item);
    });
    const previewBtn = node('button', 'Aperçu', 'history-btn-preview');
    previewBtn.type = 'button';
    previewBtn.setAttribute('title', 'Voir l’aperçu dans l’application');
    previewBtn.addEventListener('click', e => {
      e.stopPropagation();
      showPreview({ ...item, server: item.server || resolveServer(state.target?.server || 'local') });
    });
    const delBtn = node('button', '✕', 'history-btn-delete');
    delBtn.type = 'button';
    delBtn.setAttribute('title', 'Supprimer ce message de l’historique');
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      state.messageHistory = state.messageHistory.filter(h => h.id !== item.id);
      saveHistory();
      updateHistoryBadge();
      renderHistory();
      notify('Message supprimé de l’historique.');
    });
    actions.append(insertBtn, previewBtn, delBtn);

    card.append(actions);
    card.setAttribute('title', 'Cliquer pour un aperçu');
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
      showPreview({ ...item, server: item.server || resolveServer(state.target?.server || 'local') });
    });
    container.append(card);
  }
}
$('#clear-history')?.addEventListener('click', () => {
  const cleared = new Set(visibleHistory());
  state.messageHistory = state.messageHistory.filter(item => !cleared.has(item));
  saveHistory();
  renderHistory();
  updateHistoryBadge();
  notify('Historique effacé.');
});
