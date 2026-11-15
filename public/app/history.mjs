import { hasTimedMedia } from '../shared/protocol.mjs';
import { $, native, node, state, notify, resolveServer, SAVED_MIME_TYPES } from './state.mjs';
import { attach, uploadFiles, renderAttachments, renderSend, renderSubtitles, showPreview } from './composer.mjs';
import { showTab } from '../app.mjs';

function historyStorageKey() {
  return 'evil-memeroom:history';
}
export function cleanHistory(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(item => {
    if (!item || typeof item !== 'object') return false;
    const hasCaption = typeof item.caption === 'string' && item.caption.trim().length > 0;
    const hasMedia = item.media && typeof item.media === 'object' && (item.media.url || item.media.name);
    const hasAudio = item.audio && typeof item.audio === 'object' && (item.audio.url || item.audio.name);
    return hasCaption || hasMedia || hasAudio;
  }).slice(0, 100);
}
export function loadHistoryFromStorage() {
  try {
    const raw = localStorage.getItem(historyStorageKey());
    const parsed = raw ? JSON.parse(raw) : [];
    return cleanHistory(parsed);
  } catch { return []; }
}
export function saveHistoryToStorage(list) {
  const clean = cleanHistory(list);
  try {
    localStorage.setItem(historyStorageKey(), JSON.stringify(clean));
  } catch {}
  native.saveHistory(clean).catch(() => {});
}
export function updateHistoryBadge() {
  const countEl = $('#history-count');
  if (countEl) countEl.textContent = String(state.messageHistory.length);
}
function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
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

  const filesToUpload = [];

  if (item.media) {
    const existing = state.library.find(m => m.id === item.media.id);
    if (existing) {
      attach(existing, false);
    } else {
      let file = null;
      const mediaBase = item.server || resolveServer(state.target?.server);
      const url = item.media.url ? new URL(item.media.url, mediaBase).href : '';
      if (url) {
        try {
          const resp = await fetch(url);
          if (resp.ok) {
            const blob = await resp.blob();
            file = new File([blob], item.media.name || 'image', { type: item.media.mime || blob.type });
          }
        } catch {}
      }
      if (!file && item.media.name) {
        try {
          const data = await native.readSavedMeme(item.media.name);
          const ext = item.media.name.slice(item.media.name.lastIndexOf('.')).toLowerCase();
          const mime = item.media.mime || SAVED_MIME_TYPES[ext] || 'application/octet-stream';
          file = new File([data.buffer], item.media.name, { type: mime });
        } catch {}
      }
      if (file) filesToUpload.push(file);
    }
  } else {
    state.visual = null;
  }

  if (item.audio) {
    const existing = state.library.find(m => m.id === item.audio.id);
    if (existing) {
      attach(existing, true);
    } else {
      let file = null;
      const mediaBase = item.server || resolveServer(state.target?.server);
      const url = item.audio.url ? new URL(item.audio.url, mediaBase).href : '';
      if (url) {
        try {
          const resp = await fetch(url);
          if (resp.ok) {
            const blob = await resp.blob();
            file = new File([blob], item.audio.name || 'audio.mp3', { type: item.audio.mime || blob.type });
          }
        } catch {}
      }
      if (!file && item.audio.name) {
        try {
          const data = await native.readSavedMeme(item.audio.name);
          const ext = item.audio.name.slice(item.audio.name.lastIndexOf('.')).toLowerCase();
          const mime = item.audio.mime || SAVED_MIME_TYPES[ext] || 'audio/mpeg';
          file = new File([data.buffer], item.audio.name, { type: mime });
        } catch {}
      }
      if (file) filesToUpload.push(file);
    }
  } else {
    state.audio = null;
  }

  renderAttachments();
  renderSend();

  if (filesToUpload.length > 0) {
    await uploadFiles(filesToUpload);
  }
  notify('Message inséré dans le compositeur.');
}

export function renderHistory() {
  const validHistory = cleanHistory(state.messageHistory);
  if (validHistory.length !== state.messageHistory.length) {
    state.messageHistory = validHistory;
    saveHistoryToStorage(state.messageHistory);
  }
  updateHistoryBadge();
  const container = $('#history-list');
  if (!container) return;
  for (const player of container.querySelectorAll('video')) { player.pause(); player.removeAttribute('src'); player.load(); }
  container.replaceChildren();

  if (!state.messageHistory.length) {
    const emptyMsg = node('p', 'Aucun message dans l’historique pour le moment.', 'muted');
    emptyMsg.style.padding = '30px 10px';
    emptyMsg.style.textAlign = 'center';
    container.append(emptyMsg);
    return;
  }

  for (const item of state.messageHistory) {
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
          if (!fallbackDone && item.media?.name) {
            fallbackDone = true;
            img.src = `/saved-memes/${encodeURIComponent(item.media.name)}`;
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
          if (!vidFallbackDone && item.media?.name) {
            vidFallbackDone = true;
            vid.src = `/saved-memes/${encodeURIComponent(item.media.name)}#t=0.001`;
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
      saveHistoryToStorage(state.messageHistory);
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
  state.messageHistory = [];
  saveHistoryToStorage(state.messageHistory);
  renderHistory();
  updateHistoryBadge();
  notify('Historique effacé.');
});
