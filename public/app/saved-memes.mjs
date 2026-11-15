import { normalizeSearch } from '../shared/protocol.mjs';
import { $, native, node, state, notify } from './state.mjs';
import { importSavedMeme, showPreview } from './composer.mjs';
import { savedMemeRenamed, savedMemeRemoved } from './history.mjs';
import { showTab } from '../app.mjs';

let savedMemes = [];
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
export async function loadSavedMemes() {
  try {
    savedMemes = await native.listSavedMemes();
    renderSavedMemes();
  } catch (err) {
    console.error('Failed to list saved memes:', err);
  }
}
let memeToRename = null;
function openRenameDialog(meme) {
  memeToRename = meme;
  const dialog = $('#rename-dialog');
  const input = $('#rename-input');
  const err = $('#rename-error');
  if (!dialog || !input) return;
  if (err) err.textContent = '';
  input.value = meme.name;
  dialog.showModal();
  const lastDot = meme.name.lastIndexOf('.');
  input.focus();
  if (lastDot > 0) input.setSelectionRange(0, lastDot);
  else input.select();
}
$('#rename-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  if (!memeToRename) return;
  const input = $('#rename-input');
  const err = $('#rename-error');
  const dialog = $('#rename-dialog');
  const newName = (input?.value || '').trim();
  if (!newName) {
    if (err) err.textContent = 'Le nom ne peut pas être vide.';
    return;
  }
  if (newName === memeToRename.name) {
    dialog?.close();
    return;
  }
  try {
    const finalName = await native.renameSavedMeme(memeToRename.name, newName);
    savedMemeRenamed(memeToRename.name, finalName);
    dialog?.close();
    notify('Mème renommé.');
    await loadSavedMemes();
  } catch (ex) {
    if (err) err.textContent = ex.message;
    else notify(ex.message, true);
  }
});
let savedTypeFilter = 'all';
let savedSortMode = 'date-desc';
function renderSavedMemes() {
  $('#preset-count').textContent = String(savedMemes.length);
  const grid = $('#saved-memes-grid');
  if (!grid) return;
  for (const player of grid.querySelectorAll('video')) { player.pause(); player.removeAttribute('src'); player.load(); }
  grid.replaceChildren();
  const rawQuery = $('#saved-search')?.value || '';
  const query = normalizeSearch(rawQuery);
  let filtered = savedMemes;
  if (query) {
    filtered = filtered.filter(item => normalizeSearch(item.name).includes(query));
  }
  if (savedTypeFilter !== 'all') {
    filtered = filtered.filter(item => item.kind === savedTypeFilter);
  }
  filtered = filtered.slice().sort((a, b) => {
    switch (savedSortMode) {
      case 'date-desc':
        return (b.mtime || 0) - (a.mtime || 0) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'date-asc':
        return (a.mtime || 0) - (b.mtime || 0) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'name-asc':
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'name-desc':
        return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'size-asc':
        return (a.size || 0) - (b.size || 0) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'size-desc':
        return (b.size || 0) - (a.size || 0) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'kind-asc':
        return (a.kind || '').localeCompare(b.kind || '') || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'kind-desc':
        return (b.kind || '').localeCompare(a.kind || '') || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      default:
        return 0;
    }
  });
  if (!filtered.length) {
    const emptyMsg = node('p', savedMemes.length ? 'Aucun mème ne correspond à votre recherche ou filtre.' : 'Aucun mème enregistré pour le moment. Les mèmes reçus s’enregistrent automatiquement ici.', 'muted');
    emptyMsg.style.gridColumn = '1 / -1';
    emptyMsg.style.padding = '30px 10px';
    emptyMsg.style.textAlign = 'center';
    grid.append(emptyMsg);
    return;
  }
  for (const meme of filtered) {
    const card = node('div', undefined, 'saved-meme-card');
    card.setAttribute('title', `${meme.name} (cliquer pour un aperçu)`);
    const thumbBox = node('div', undefined, 'saved-meme-thumb-box');
    if (meme.kind === 'image') {
      const img = node('img', undefined, 'saved-meme-thumb');
      img.src = meme.url;
      img.alt = meme.name;
      img.loading = 'lazy';
      thumbBox.append(img);
    } else if (meme.kind === 'video') {
      const vid = node('video', undefined, 'saved-meme-thumb');
      vid.src = `${meme.url}#t=0.001`;
      vid.muted = true;
      vid.preload = 'metadata';
      thumbBox.append(vid);
      thumbBox.append(node('span', 'VID', 'saved-meme-badge'));
    } else if (meme.kind === 'audio') {
      thumbBox.append(node('span', '🎵', 'saved-meme-icon'));
      thumbBox.append(node('span', 'AUD', 'saved-meme-badge'));
    } else {
      thumbBox.append(node('span', '📁', 'saved-meme-icon'));
    }
    thumbBox.append(node('span', formatBytes(meme.size), 'saved-meme-size-badge'));

    const name = node('span', meme.name, 'saved-meme-name');
    name.setAttribute('title', meme.name);

    const actions = node('div', undefined, 'saved-meme-actions');
    const insertBtn = node('button', 'Insérer', 'saved-meme-btn-insert');
    insertBtn.type = 'button';
    insertBtn.setAttribute('title', meme.kind === 'video' ? 'Insérer la vidéo' : 'Utiliser dans le compositeur');
    insertBtn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!state.connected || !state.room) { notify('Rejoignez une room avant d’insérer un mème.'); return; }
      try {
        showTab(false);
        await importSavedMeme(meme.name);
      } catch (err) { notify(`Impossible de charger le fichier : ${err.message}`, true); }
    });
    let insertAudioBtn = null;
    if (meme.kind === 'video') {
      insertAudioBtn = node('button', 'Insérer audio', 'saved-meme-btn-insert saved-meme-btn-insert-audio');
      insertAudioBtn.type = 'button';
      insertAudioBtn.setAttribute('title', 'Utiliser uniquement le son de cette vidéo');
      insertAudioBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!state.connected || !state.room) { notify('Rejoignez une room avant d’insérer un audio.'); return; }
        insertAudioBtn.disabled = true;
        try {
          notify('Extraction du son de la vidéo…');
          showTab(false);
          await importSavedMeme(meme.name, true);
        } catch (err) {
          notify(`Impossible d’extraire l’audio : ${err.message}`, true);
        } finally {
          insertAudioBtn.disabled = false;
        }
      });
    }
    const renameBtn = node('button', 'Renommer', 'saved-meme-btn-rename');
    renameBtn.type = 'button';
    renameBtn.setAttribute('title', 'Renommer ce mème');
    renameBtn.addEventListener('click', e => {
      e.stopPropagation();
      openRenameDialog(meme);
    });
    const delBtn = node('button', '✕', 'saved-meme-delete');
    delBtn.type = 'button';
    delBtn.setAttribute('title', 'Supprimer ce mème');
    delBtn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Supprimer « ${meme.name} » ?`)) return;
      try {
        await native.deleteSavedMeme(meme.name);
        savedMemeRemoved(meme.name);
        savedMemes = savedMemes.filter(item => item.name !== meme.name);
        renderSavedMemes();
        notify(`« ${meme.name} » supprimé.`);
      } catch (err) { notify(err.message, true); }
    });
    if (insertAudioBtn) {
      actions.append(insertBtn, insertAudioBtn, renameBtn, delBtn);
    } else {
      actions.append(insertBtn, renameBtn, delBtn);
    }
    card.append(thumbBox, name, actions);
    card.addEventListener('click', () => {
      const reaction = {
        caption: '',
        media: meme.kind !== 'audio' ? { kind: meme.kind, url: meme.url, name: meme.name } : null,
        audio: meme.kind === 'audio' ? { kind: 'audio', url: meme.url, name: meme.name } : null,
        duration: 5,
        server: location.origin
      };
      showPreview(reaction);
    });
    grid.append(card);
  }
}
let searchDebounceTimer;
$('#saved-search')?.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(renderSavedMemes, 120);
});
document.querySelectorAll('.saved-type-filters button').forEach(btn => {
  btn.addEventListener('click', () => {
    savedTypeFilter = btn.dataset.type || 'all';
    document.querySelectorAll('.saved-type-filters button').forEach(b => {
      b.classList.toggle('selected', b === btn);
    });
    renderSavedMemes();
  });
});
$('#saved-sort')?.addEventListener('change', e => {
  savedSortMode = e.target.value;
  renderSavedMemes();
});
$('#open-saved-folder')?.addEventListener('click', async () => {
  try { await native.openSavedMemesFolder(); } catch (err) { notify(err.message, true); }
});
