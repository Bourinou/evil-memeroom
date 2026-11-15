import { normalizeServer, applyReactionMeta } from '../shared/protocol.mjs';
import { Connection } from '../connection.mjs';
import { $, native, node, state, notify, saveClient, keyFor, resolveServer, referenceFor } from './state.mjs';
import { renderNickname } from './settings.mjs';
import { renderSend, renderAttachments, renderSubtitles, getCachedGifInfo } from './composer.mjs';
import { recordHistory, updateHistoryBadge, renderHistory } from './history.mjs';
import { toHistoryItem } from '../shared/history.mjs';

const DEFAULT_SERVER = 'https://memeroom.tonamielarose.fr/';
let connecting = false, joining = false, mode = 'create', retryTimer, retries = 0, directoryRequest;
export function renderRooms() {
  renderNickname();
  const select = $('#saved-room'); select.replaceChildren(new Option('Choisir une room', ''));
  for (const saved of state.client.rooms) select.add(new Option(saved.name, keyFor(saved)));
  select.value = keyFor(state.target);
  $('#connection-status').textContent = state.status;
  $('#copy-code').hidden = !state.target?.code;
  $('#leave-room').hidden = !state.target;
  $('#room-access').hidden = !state.connected || !state.room?.access?.canManage;
  $('#copy-code').textContent = state.target?.code ? `Code : ${state.target.code} · copier` : 'Copier le code';
  $('#members').hidden = !state.connected;
  $('#members').textContent = state.room?.members.map(member => `${member.name}${member.desktop ? member.paused ? ' (en pause)' : '' : ' (web)'}`).join(', ') || '';
  const list = $('#saved-rooms-list'); list.replaceChildren();
  if (!state.client.rooms.length) list.append(node('p', 'Aucune room enregistrée.', 'muted'));
  for (const saved of state.client.rooms) {
    const row = node('div', undefined, 'saved-entry'), text = node('div');
    text.append(node('strong', saved.name), node('small', `${saved.code} · ${saved.server === 'local' ? 'Ce PC' : saved.server}`));
    const remove = node('button', 'Retirer', 'text-button');
    remove.setAttribute('aria-label', `Retirer ${saved.name} des rooms enregistrées`);
    remove.addEventListener('click', async () => {
      if (keyFor(state.target) === keyFor(saved)) disconnect();
      state.client.rooms = state.client.rooms.filter(entry => keyFor(entry) !== keyFor(saved));
      if (keyFor(state.client.active) === keyFor(saved)) state.client.active = null;
      await saveClient(); renderRooms();
    });
    row.append(text, remove); list.append(row);
  }
  renderSend();
}
export function renderLibrary() {
  const select = $('#existing-media');
  if (!select) return;
  select.replaceChildren(new Option('Choisir un fichier', ''));
  for (const asset of state.library) select.add(new Option(asset.name, asset.id));
}
function handleEvent(event) {
  if (!state.connected || !state.room) return;
  if (event.type === 'members') { state.room.members = event.members; renderRooms(); }
  if (event.type === 'library') {
    state.library = event.media;
    const isVisualTrimmed = state.visual?.isTrimmed;
    const isAudioTrimmed = state.audio?.isTrimmed;
    const prevVisual = state.visual;
    const prevAudio = state.audio;
    state.visual = state.library.find(item => item.id === prevVisual?.id) || state.visual;
    state.audio = state.library.find(item => item.id === prevAudio?.id) || state.audio;
    if (state.visual && isVisualTrimmed) state.visual.isTrimmed = true;
    if (state.audio && isAudioTrimmed) state.audio.isTrimmed = true;
    if (state.visual) {
      if (prevVisual?.gifDuration) {
        state.visual.gifDuration = prevVisual.gifDuration;
        state.visual.gifFrameCount = prevVisual.gifFrameCount;
      }
      const cached = getCachedGifInfo(state.visual);
      if (cached) {
        state.visual.gifDuration = cached.durationSec;
        state.visual.gifFrameCount = cached.frameCount;
      }
    }
    renderLibrary();
    renderAttachments();
  }
  if (event.type === 'room-access') { state.room.access = event.access; renderRooms(); }
  if (event.type === 'access-changed') { if (state.target) delete state.target.joinToken; notify('Les accès de la room ont changé. Rejoignez-la à nouveau.'); }
  if (event.type === 'reaction') {
    applyReactionMeta(event);
    const caption = event.caption || '';
    const media = event.media || null;
    const audio = event.audio || null;
    if (!caption && !media && !audio) return;
    recordHistory([toHistoryItem(event, resolveServer(state.target.server))]);
    const isSelf = !!state.room?.memberId && event.sender?.id === state.room.memberId;
    if (isSelf && state.settings.hideSelf) return;
    if (!state.settings.paused) {
      const now = Date.now() + state.connection.skew;
      native.show({ ...event, server: resolveServer(state.target.server), delay: Math.max(0, event.startAt - now), age: Math.max(0, now - event.startAt) }).catch(error => notify(error.message, true));
    }
  }
}
export function disconnect() {
  state.epoch++; clearTimeout(retryTimer); state.connection?.close(); state.connection = null; state.room = null; state.target = null;
  state.connected = false; connecting = false; state.library = []; state.visual = null; state.audio = null; state.cues = []; retries = 0;
  if ($('#custom-duration-toggle')) $('#custom-duration-toggle').checked = false;
  updateHistoryBadge(); if (state.currentTab === 'history') renderHistory();
  native.clear(); state.status = 'Aucune room sélectionnée.'; renderRooms(); renderAttachments(); renderLibrary(); renderSubtitles();
  $('#password-dialog').close(); $('#access-dialog').close();
}
function scheduleRetry(currentEpoch) {
  clearTimeout(retryTimer);
  if (currentEpoch !== state.epoch || !state.target) return;
  state.status = 'Serveur indisponible. Reconnexion automatique…'; renderRooms();
  retryTimer = setTimeout(() => attemptJoin(currentEpoch, false).catch(() => {}), Math.min(15000, 1000 * 2 ** retries++));
}
export async function attemptJoin(currentEpoch, create) {
  if (currentEpoch !== state.epoch || !state.target) return;
  connecting = true; state.connection?.close();
  const current = new Connection(resolveServer(state.target.server), event => { if (current === state.connection) handleEvent(event); }, () => {
    if (current !== state.connection || currentEpoch !== state.epoch) return;
    state.connected = false; state.room = null; native.clear(); renderRooms();
    if (!connecting) scheduleRetry(currentEpoch);
  });
  state.connection = current;
  try {
    await current.open();
    if (create) {
      const health = await fetch(`${resolveServer(state.target.server)}/api/health`, { signal: AbortSignal.timeout(6000) });
      if (!health.ok || !(await health.json()).features?.roomAccess) throw new Error('Mettez le serveur à jour pour créer une room avec ces accès.');
    }
    if (currentEpoch !== state.epoch) return;
    const data = await current.request(create ? 'create' : 'join', { name: state.client.nickname, roomName: state.target.name, code: state.target.code, desktop: true, paused: state.settings.paused, isPrivate: state.target.isPrivate, password: state.target.password, joinToken: state.target.joinToken, ownerToken: state.target.ownerToken });
    if (currentEpoch !== state.epoch) return;
    state.target = { code: data.code, name: data.name, server: state.target.server, joinToken: data.joinToken, ownerToken: data.ownerToken || state.target.ownerToken };
    state.room = data; state.connected = true; connecting = false; retries = 0; clearTimeout(retryTimer);
    state.library = data.media;
    const isVisualTrimmed = state.visual?.isTrimmed;
    const isAudioTrimmed = state.audio?.isTrimmed;
    state.visual = state.library.find(item => item.id === state.visual?.id) || state.visual;
    state.audio = state.library.find(item => item.id === state.audio?.id) || state.audio;
    if (state.visual && isVisualTrimmed) state.visual.isTrimmed = true;
    if (state.audio && isAudioTrimmed) state.audio.isTrimmed = true;
    if (Array.isArray(data.history)) {
      const server = resolveServer(state.target.server);
      recordHistory(data.history.map(item => toHistoryItem(item, server)));
    }
    state.client.rooms = [state.target, ...state.client.rooms.filter(entry => keyFor(entry) !== keyFor(state.target))];
    state.client.active = { code: state.target.code, server: state.target.server };
    const saved = await saveClient();
    state.status = saved ? 'Connecté' : 'Connecté · enregistrement local impossible';
    if (data.persistent !== true) notify('Ce serveur doit être mis à jour pour conserver ses rooms après un redémarrage.', true);
    renderRooms(); renderLibrary(); renderAttachments();
  } catch (error) {
    if (currentEpoch !== state.epoch) return;
    connecting = false; state.connected = false; state.room = null; current.close();
    const unavailable = /inaccessible|interrompue|déconnecté|ne répond pas/.test(error.message);
    if (!create && unavailable && state.client.rooms.some(entry => keyFor(entry) === keyFor(state.target))) scheduleRetry(currentEpoch);
    else { state.status = error.message; renderRooms(); }
    if (error.code === 'ROOM_PASSWORD_REQUIRED' && !joining) showPasswordPrompt(error.message);
    throw error;
  }
}
export async function chooseRoom(record, create = false) {
  disconnect(); state.target = { ...record }; state.status = 'Connexion…'; renderRooms();
  if (!create && state.client.rooms.some(entry => keyFor(entry) === keyFor(record))) { state.client.active = { code: record.code, server: record.server }; await saveClient(); }
  return attemptJoin(state.epoch, create);
}
function setMode(value) {
  mode = value;
  for (const entry of ['create','join','browse']) { $(`#mode-${entry}`).classList.toggle('selected', mode === entry); $(`#mode-${entry}`).setAttribute('aria-pressed', String(mode === entry)); }
  $('#room-name-field').hidden = mode !== 'create'; $('#new-room-name').required = mode === 'create';
  $('#room-visibility-field').hidden = mode !== 'create';
  $('#join-code-field').hidden = mode !== 'join'; $('#join-code').required = mode === 'join';
  $('#room-directory').hidden = mode !== 'browse';
  $('#room-password-label').hidden = mode === 'browse'; $('#room-password').hidden = mode === 'browse';
  $('#room-password').autocomplete = mode === 'create' ? 'new-password' : 'current-password';
  $('#room-submit').hidden = mode === 'browse';
  $('#room-submit').textContent = mode === 'create' ? 'Créer et enregistrer' : 'Rejoindre et enregistrer';
  $('#room-error').textContent = '';
  if (mode === 'browse') void loadDirectory();
}
function updateHostAddress() {
  let ownServer = false;
  try { const server = normalizeServer($('#server-url').value.trim()); ownServer = server === state.localServer || state.addresses.includes(server); } catch { /* Wait for a complete URL. */ }
  $('#host-address').hidden = !ownServer || !state.addresses.length;
}
$('#add-room').addEventListener('click', () => {
  $('#nickname').value = state.client.nickname; $('#server-url').value = (state.target?.server && state.target.server !== 'local') ? resolveServer(state.target.server) : DEFAULT_SERVER;
  $('#host-address').textContent = state.addresses.length ? `Adresse de ce PC pour vos amis : ${state.addresses.join(' ou ')}` : '';
  updateHostAddress();
  $('#room-password').value = ''; $('#join-code').value = ''; $('#new-room-name').value = ''; $('#room-visibility').value = 'private';
  $('#room-error').textContent = ''; setMode('create'); $('#room-dialog').showModal();
});
$('#mode-create').addEventListener('click', () => setMode('create'));
$('#mode-join').addEventListener('click', () => setMode('join'));
$('#mode-browse').addEventListener('click', () => setMode('browse'));
async function loadDirectory() {
  directoryRequest?.abort(); const request = new AbortController(); directoryRequest = request;
  const timer = setTimeout(() => request.abort(), 6000);
  $('#server-rooms').replaceChildren(); $('#directory-status').textContent = 'Chargement des rooms…'; $('#refresh-rooms').disabled = true;
  try {
    const server = normalizeServer($('#server-url').value.trim());
    const response = await fetch(`${server}/api/rooms`, { signal: request.signal });
    if (response.status === 404) throw new Error('Ce serveur doit être mis à jour pour afficher ses rooms.');
    if (!response.ok) throw new Error('Impossible de charger les rooms du serveur.');
    const data = await response.json(); if (!Array.isArray(data.rooms)) throw new Error('Réponse du serveur invalide.');
    if (request !== directoryRequest) return;
    $('#directory-status').textContent = data.rooms.length ? 'Les rooms privées se rejoignent par leur code.' : 'Aucune room publique sur ce serveur.';
    for (const entry of data.rooms.slice(0, 100)) {
      if (!entry || !/^[A-Z2-9]{8}$/.test(entry.code)) continue;
      const row = node('div', undefined, 'directory-entry'), info = node('div');
      info.append(node('strong', String(entry.name).slice(0, 40)), node('small', `${Number(entry.members) || 0} participant(s)${entry.passwordRequired ? ' · Mot de passe' : ''}`));
      const join = node('button', 'Rejoindre'); join.type = 'button'; join.setAttribute('aria-label', `Rejoindre ${String(entry.name).slice(0, 40)}`);
      join.addEventListener('click', () => { setMode('join'); $('#join-code').value = entry.code; $('#room-password').value = ''; if (entry.passwordRequired) $('#room-password').focus(); else $('#room-form').requestSubmit(); });
      row.append(info, join); $('#server-rooms').append(row);
    }
  } catch (error) { if (request === directoryRequest) $('#directory-status').textContent = error.name === 'AbortError' ? 'Serveur inaccessible. Réessayez.' : error.message; }
  finally { clearTimeout(timer); if (request === directoryRequest) $('#refresh-rooms').disabled = false; }
}
$('#refresh-rooms').addEventListener('click', loadDirectory);
$('#server-url').addEventListener('input', () => { updateHostAddress(); directoryRequest?.abort(); directoryRequest = null; $('#server-rooms').replaceChildren(); $('#directory-status').textContent = 'Cliquez sur Afficher les rooms pour ce serveur.'; $('#refresh-rooms').disabled = false; });
$('#room-dialog').addEventListener('close', () => { directoryRequest?.abort(); $('#room-password').value = ''; });
$('#room-form').addEventListener('submit', async event => {
  event.preventDefault(); if (joining || mode === 'browse') return;
  if (state.client.rooms.length >= 30) { $('#room-error').textContent = 'Retirez une room enregistrée pour en ajouter une autre (30 maximum).'; return; }
  joining = true; $('#room-submit').disabled = true; $('#room-error').textContent = '';
  try {
    const server = normalizeServer($('#server-url').value.trim());
    if (location.protocol === 'https:' && server.startsWith('http:')) throw new Error('Utilisez une adresse HTTPS depuis cette page.');
    state.client.nickname = $('#nickname').value.trim();
    await chooseRoom({ name: $('#new-room-name').value.trim() || 'Ma room', code: $('#join-code').value.toUpperCase().replace(/[-\s]/g, ''), server: referenceFor(server), isPrivate: $('#room-visibility').value === 'private', password: $('#room-password').value }, mode === 'create');
    $('#room-dialog').close();
  } catch (error) { $('#room-error').textContent = error.message; }
  finally { joining = false; $('#room-submit').disabled = false; }
});
$('#saved-room').addEventListener('change', async event => {
  const saved = state.client.rooms.find(entry => keyFor(entry) === event.target.value);
  if (saved) { try { await chooseRoom(saved); } catch { /* Status and automatic retry are shown in the room bar. */ } }
  else { disconnect(); state.client.active = null; await saveClient(); }
});
$('#leave-room').addEventListener('click', async () => { disconnect(); state.client.active = null; await saveClient(); });
$('#copy-code').addEventListener('click', async () => {
  if (!state.target?.code) return;
  try { await navigator.clipboard.writeText(state.target.code); notify('Code copié.'); } catch { notify(`Code : ${state.target.code}`); }
});
function showPasswordPrompt(message = '') {
  if (!state.target || $('#room-dialog').open) return;
  $('#password-room-name').textContent = state.target.name; $('#password-error').textContent = message; $('#saved-room-password').value = '';
  if (!$('#password-dialog').open) $('#password-dialog').showModal();
}
$('#password-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!state.target) return;
  $('#password-submit').disabled = true;
  try {
    state.target.password = $('#saved-room-password').value; delete state.target.joinToken;
    await attemptJoin(state.epoch, false); $('#password-dialog').close();
  } catch (error) { $('#password-error').textContent = error.message; }
  finally { $('#password-submit').disabled = false; }
});
$('#password-dialog').addEventListener('close', () => { $('#saved-room-password').value = ''; if (state.target) delete state.target.password; });
$('#room-access').addEventListener('click', () => {
  if (!state.room?.access?.canManage) return;
  $('#access-visibility').value = state.room.access.isPrivate ? 'private' : 'public';
  $('#access-password-action').value = 'keep'; $('#access-password').value = ''; $('#access-password').hidden = true; $('#access-password').required = false; $('#access-password-label').hidden = true;
  $('#access-legacy-note').hidden = !state.room.access.unclaimed; $('#access-error').textContent = ''; $('#access-dialog').showModal();
});
$('#access-password-action').addEventListener('change', event => { const show = event.target.value === 'set'; $('#access-password').hidden = !show; $('#access-password').required = show; $('#access-password-label').hidden = !show; });
$('#access-dialog').addEventListener('close', () => { $('#access-password').value = ''; });
$('#access-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!state.room?.access?.canManage) return;
  const selected = state.target, current = state.room; $('#access-submit').disabled = true;
  try {
    const data = await state.connection.request('room-settings', { isPrivate: $('#access-visibility').value === 'private', passwordAction: $('#access-password-action').value, password: $('#access-password').value });
    if (state.target !== selected || state.room !== current) return;
    state.room.access = data.access; state.target.joinToken = data.joinToken; if (data.ownerToken) state.target.ownerToken = data.ownerToken;
    state.client.rooms = state.client.rooms.map(entry => keyFor(entry) === keyFor(state.target) ? { ...state.target } : entry);
    await saveClient(); renderRooms(); $('#access-dialog').close(); notify('Accès de la room enregistrés.');
  } catch (error) { $('#access-error').textContent = error.message; }
  finally { $('#access-submit').disabled = false; }
});
