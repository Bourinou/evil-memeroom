import { DEFAULT_SETTINGS, cleanSettings, cleanClientState, normalizeServer, parseSubtitles, hasTimedMedia, validDismissShortcut, LIMITS, normalizeSearch } from './shared/protocol.mjs';
import { Connection } from './connection.mjs';
import { mountReaction } from './media-view.mjs';

const $ = selector => document.querySelector(selector);
const native = window.memeroom;
if (!native) location.replace('/');
const storageKey = 'memeroom.client.v2';
const node = (tag, text, className) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value; };
function readStorage(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
let client = cleanClientState(readStorage(storageKey) || {});
let settings = { ...DEFAULT_SETTINGS }, localServer = location.origin, addresses = [];
let room = null, connection = null, target = null, library = [], visual = null, audio = null, cues = [];
let connected = false, connecting = false, sending = false, importing = false, joining = false;
let mode = 'create', epoch = 0, retryTimer, retries = 0, toastTimer, preview, nextSend = 0, directoryRequest;
let status = 'Aucune room sélectionnée.';
let recordingShortcut = false, shortcutBusy = false;
let mac = false;
let savedMemes = [];
const SAVED_MIME_TYPES = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.gif':'image/gif', '.webp':'image/webp', '.mp4':'video/mp4', '.webm':'video/webm', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg' };
const shortcutLabel = value => value ? value.split('+').map(key => ({ Control:'Ctrl', Shift:'Maj', Super:mac ? 'Cmd' : 'Windows', Space:'Espace', Up:'Haut', Down:'Bas', Left:'Gauche', Right:'Droite' }[key] || key)).join(' + ') : 'Choisir un raccourci';
const keyFor = value => value ? `${value.server}|${value.code}` : '';
const DEFAULT_SERVER = 'https://memeroom.tonamielarose.fr/';
const resolveServer = ref => ref === 'local' ? localServer : ref;
function referenceFor(url) {
  const parsed = new URL(url), local = new URL(localServer);
  return native && parsed.port === local.port && ['127.0.0.1','localhost','[::1]'].includes(parsed.hostname) ? 'local' : url;
}
function notify(message, error = false) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.toggle('error', error); toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 6000 : 3500);
}
async function saveClient() {
  client = cleanClientState(client);
  try {
    if (native) await native.saveClient(client);
    else localStorage.setItem(storageKey, JSON.stringify(client));
  } catch { notify('Impossible d’enregistrer les rooms sur cet appareil.', true); return false; }
  return true;
}
function renderNickname() {
  const nick = client.nickname || 'Anonyme';
  if ($('#current-nickname')) $('#current-nickname').textContent = nick;
  if ($('#settings-nickname')) $('#settings-nickname').value = client.nickname || '';
}
async function setNickname(newName) {
  const clean = (newName || '').trim();
  if (!clean) return;
  client.nickname = clean;
  renderNickname();
  await saveClient();
  if (connected && connection) {
    try {
      await connection.request('rename', { name: clean });
    } catch {
      if (target) attemptJoin(epoch, false).catch(() => {});
    }
  }
  notify(`Pseudo mis à jour : ${clean}`);
}
function renderRooms() {
  renderNickname();
  const select = $('#saved-room'); select.replaceChildren(new Option('Choisir une room', ''));
  for (const saved of client.rooms) select.add(new Option(saved.name, keyFor(saved)));
  select.value = keyFor(target);
  $('#connection-status').textContent = status;
  $('#copy-code').hidden = !target?.code;
  $('#leave-room').hidden = !target;
  $('#room-access').hidden = !connected || !room?.access?.canManage;
  $('#copy-code').textContent = target?.code ? `Code : ${target.code} · copier` : 'Copier le code';
  $('#members').hidden = !connected;
  $('#members').textContent = room?.members.map(member => `${member.name}${member.desktop ? member.paused ? ' (en pause)' : '' : ' (web)'}`).join(', ') || '';
  const list = $('#saved-rooms-list'); list.replaceChildren();
  if (!client.rooms.length) list.append(node('p', 'Aucune room enregistrée.', 'muted'));
  for (const saved of client.rooms) {
    const row = node('div', undefined, 'saved-entry'), text = node('div');
    text.append(node('strong', saved.name), node('small', `${saved.code} · ${saved.server === 'local' ? 'Ce PC' : saved.server}`));
    const remove = node('button', 'Retirer', 'text-button');
    remove.setAttribute('aria-label', `Retirer ${saved.name} des rooms enregistrées`);
    remove.addEventListener('click', async () => {
      if (keyFor(target) === keyFor(saved)) disconnect();
      client.rooms = client.rooms.filter(entry => keyFor(entry) !== keyFor(saved));
      if (keyFor(client.active) === keyFor(saved)) client.active = null;
      await saveClient(); renderRooms();
    });
    row.append(text, remove); list.append(row);
  }
  renderSend();
}
function renderSend() {
  const automatic = hasTimedMedia({ media: visual, audio });
  $('#duration').hidden = automatic; $('#duration').disabled = automatic;
  $('#duration-label').hidden = automatic; $('#duration-unit').hidden = automatic; $('#automatic-duration').hidden = !automatic;
  const hasContent = !!($('#caption').value.trim() || visual || audio);
  const busy = sending || importing || Date.now() < nextSend;
  $('#broadcast').disabled = !connected || !hasContent || busy;
  $('#broadcast').textContent = sending ? 'Envoi…' : 'Envoyer';
  $('#preview-play').disabled = !hasContent || importing;
  $('#attach-file').disabled = importing;
  $('#attach-audio').disabled = importing;
  $('#attach-file').textContent = importing ? 'Import…' : 'Image / vidéo';
  $('#attach-audio').textContent = audio ? 'Remplacer l’audio' : 'Ajouter un audio';
  $('#audio-replacement').hidden = !(visual?.kind === 'video' && audio);
  $('#send-status').textContent = !connected ? 'Sélectionnez une room pour envoyer.' : importing ? 'Import et vérification du fichier…' : Date.now() < nextSend ? 'Patientez quelques secondes avant le prochain envoi.' : '';
}
function currentReaction() {
  return { caption: $('#caption').value, sender: client.nickname, mediaId: visual?.id || null, audioId: audio?.id || null, media: visual, audio, duration: Number($('#duration').value), subtitles: cues, server: resolveServer(target?.server || 'local') };
}
function renderAttachments() {
  const list = $('#attachments');
  for (const player of list.querySelectorAll('audio,video')) { player.pause(); player.removeAttribute('src'); player.load(); }
  list.replaceChildren();
  for (const asset of [visual, audio].filter(Boolean)) {
    const row = node('div', undefined, 'attachment');
    if (asset.kind !== 'audio') {
      const image = node(asset.kind === 'video' ? 'video' : 'img');
      image.src = new URL(asset.url, resolveServer(target.server)).href;
      if (asset.kind === 'video') { image.muted = true; image.preload = 'metadata'; } else image.alt = asset.name;
      row.append(image);
    }
    const info = node('div', undefined, 'attachment-info');
    info.append(node('strong', asset.name), node('small', `${asset.kind === 'video' ? 'Vidéo' : asset.kind === 'audio' ? 'Audio' : 'Image'} · ${(asset.bytes / 1024 / 1024).toFixed(1)} Mo`));
    const remove = node('button', 'Retirer', 'text-button'); remove.type = 'button'; remove.setAttribute('aria-label', `Retirer ${asset.name}`);
    remove.addEventListener('click', () => { if (asset === visual) visual = null; else audio = null; renderAttachments(); });
    row.append(info, remove); list.append(row);
  }
  renderSend();
}
function renderLibrary() {
  const select = $('#existing-media');
  if (!select) return;
  select.replaceChildren(new Option('Choisir un fichier', ''));
  for (const asset of library) select.add(new Option(asset.name, asset.id));
}
function renderSettings() {
  if (!recordingShortcut) $('#dismiss-shortcut').textContent = shortcutLabel(settings.dismissShortcut);
  $('#dismiss-shortcut').disabled = shortcutBusy;
  $('#disable-dismiss-shortcut').disabled = shortcutBusy || !settings.dismissShortcut;
  $('#auto-join').checked = client.autoJoin;
  $('#setting-paused').checked = settings.paused;
  if ($('#setting-hide-self')) $('#setting-hide-self').checked = settings.hideSelf;
  if ($('#setting-auto-start')) $('#setting-auto-start').checked = settings.autoStart !== false;
  for (const key of ['volume','size','cooldown','position','display']) $(`#setting-${key}`).value = settings[key];
  $('#volume-value').textContent = `${settings.volume} %`; $('#size-value').textContent = `${settings.size} %`; $('#cooldown-value').textContent = `${settings.cooldown} s`;
  $('#pause-reception').textContent = settings.paused ? 'Reprendre la réception' : 'Mettre en pause';
}
function handleEvent(event) {
  if (!connected || !room) return;
  if (event.type === 'members') { room.members = event.members; renderRooms(); }
  if (event.type === 'library') { library = event.media; visual = library.find(item => item.id === visual?.id) || null; audio = library.find(item => item.id === audio?.id) || null; renderLibrary(); renderAttachments(); }
  if (event.type === 'room-access') { room.access = event.access; renderRooms(); }
  if (event.type === 'access-changed') { if (target) delete target.joinToken; notify('Les accès de la room ont changé. Rejoignez-la à nouveau.'); }
  if (event.type === 'reaction') {
    const historyItem = {
      id: event.id,
      sender: event.sender?.name || 'Inconnu',
      caption: event.caption || '',
      media: event.media || null,
      audio: event.audio || null,
      duration: event.duration || 5,
      sentAt: event.sentAt || Date.now(),
      server: resolveServer(target.server),
      kind: event.media?.kind || (event.audio ? 'audio' : 'text')
    };
    if (!messageHistory.some(item => item.id === historyItem.id)) {
      messageHistory.unshift(historyItem);
      if (room?.code) saveHistoryToStorage(room.code, messageHistory);
      updateHistoryBadge();
      if (currentTab === 'history') renderHistory();
    }
    const isSelf = (room?.memberId && event.sender?.id === room.memberId) || (client?.nickname && event.sender?.name === client.nickname);
    if (isSelf && settings.hideSelf) return;
    if (native && !settings.paused) {
      const now = Date.now() + connection.skew;
      native.show({ ...event, server: resolveServer(target.server), delay: Math.max(0, event.startAt - now), age: Math.max(0, now - event.startAt) }).catch(error => notify(error.message, true));
    }
  }
}
function disconnect() {
  epoch++; clearTimeout(retryTimer); connection?.close(); connection = null; room = null; target = null;
  connected = false; connecting = false; library = []; visual = null; audio = null; cues = []; retries = 0;
  messageHistory = []; updateHistoryBadge(); if (currentTab === 'history') renderHistory();
  native?.clear(); status = 'Aucune room sélectionnée.'; renderRooms(); renderAttachments(); renderLibrary(); renderSubtitles();
  $('#password-dialog').close(); $('#access-dialog').close();
}
function scheduleRetry(currentEpoch) {
  clearTimeout(retryTimer);
  if (currentEpoch !== epoch || !target) return;
  status = 'Serveur indisponible. Reconnexion automatique…'; renderRooms();
  retryTimer = setTimeout(() => attemptJoin(currentEpoch, false).catch(() => {}), Math.min(15000, 1000 * 2 ** retries++));
}
async function attemptJoin(currentEpoch, create) {
  if (currentEpoch !== epoch || !target) return;
  connecting = true; connection?.close();
  const current = new Connection(resolveServer(target.server), event => { if (current === connection) handleEvent(event); }, () => {
    if (current !== connection || currentEpoch !== epoch) return;
    connected = false; room = null; native?.clear(); renderRooms();
    if (!connecting) scheduleRetry(currentEpoch);
  });
  connection = current;
  try {
    await current.open();
    if (create) {
      const health = await fetch(`${resolveServer(target.server)}/api/health`, { signal: AbortSignal.timeout(6000) });
      if (!health.ok || !(await health.json()).features?.roomAccess) throw new Error('Mettez le serveur à jour en 0.4.0 pour créer une room avec ces accès.');
    }
    if (currentEpoch !== epoch) return;
    const data = await current.request(create ? 'create' : 'join', { name: client.nickname, roomName: target.name, code: target.code, desktop: !!native, paused: settings.paused, isPrivate: target.isPrivate, password: target.password, joinToken: target.joinToken, ownerToken: target.ownerToken });
    if (currentEpoch !== epoch) return;
    target = { code: data.code, name: data.name, server: target.server, joinToken: data.joinToken, ownerToken: data.ownerToken || target.ownerToken };
    room = data; connected = true; connecting = false; retries = 0; clearTimeout(retryTimer);
    library = data.media;
    visual = library.find(item => item.id === visual?.id) || null; audio = library.find(item => item.id === audio?.id) || null;
    messageHistory = loadHistoryFromStorage(data.code);
    if (Array.isArray(data.history)) {
      for (const item of data.history.slice().reverse()) {
        const itemRecord = {
          id: item.id,
          sender: item.sender?.name || (typeof item.sender === 'string' ? item.sender : 'Inconnu'),
          caption: item.caption || '',
          media: item.media || null,
          audio: item.audio || null,
          duration: item.duration || 5,
          sentAt: item.sentAt || Date.now(),
          server: resolveServer(target.server),
          kind: item.kind || item.media?.kind || (item.audio ? 'audio' : 'text')
        };
        if (!messageHistory.some(existing => existing.id === itemRecord.id)) {
          messageHistory.unshift(itemRecord);
        }
      }
      saveHistoryToStorage(data.code, messageHistory);
    }
    updateHistoryBadge();
    if (currentTab === 'history') renderHistory();
    client.rooms = [target, ...client.rooms.filter(entry => keyFor(entry) !== keyFor(target))];
    client.active = { code: target.code, server: target.server };
    const saved = await saveClient();
    status = saved ? 'Connecté' : 'Connecté · enregistrement local impossible';
    if (data.persistent !== true) notify('Ce serveur doit être mis à jour pour conserver ses rooms après un redémarrage.', true);
    renderRooms(); renderLibrary(); renderAttachments();
  } catch (error) {
    if (currentEpoch !== epoch) return;
    connecting = false; connected = false; room = null; current.close();
    const unavailable = /inaccessible|interrompue|déconnecté|ne répond pas/.test(error.message);
    if (!create && unavailable && client.rooms.some(entry => keyFor(entry) === keyFor(target))) scheduleRetry(currentEpoch);
    else { status = error.message; renderRooms(); }
    if (error.code === 'ROOM_PASSWORD_REQUIRED' && !joining) showPasswordPrompt(error.message);
    throw error;
  }
}
async function chooseRoom(record, create = false) {
  disconnect(); target = { ...record }; status = 'Connexion…'; renderRooms();
  if (!create && client.rooms.some(entry => keyFor(entry) === keyFor(record))) { client.active = { code: record.code, server: record.server }; await saveClient(); }
  return attemptJoin(epoch, create);
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
  try { const server = normalizeServer($('#server-url').value.trim()); ownServer = server === localServer || addresses.includes(server); } catch { /* Wait for a complete URL. */ }
  $('#host-address').hidden = !ownServer || !addresses.length;
}
$('#add-room').addEventListener('click', () => {
  $('#nickname').value = client.nickname; $('#server-url').value = (target?.server && target.server !== 'local') ? resolveServer(target.server) : DEFAULT_SERVER;
  $('#host-address').textContent = addresses.length ? `Adresse de ce PC pour vos amis : ${addresses.join(' ou ')}` : '';
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
    if (response.status === 404) throw new Error('Ce serveur doit être mis à jour en 0.4.0 pour afficher ses rooms.');
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
  if (client.rooms.length >= 30) { $('#room-error').textContent = 'Retirez une room enregistrée pour en ajouter une autre (30 maximum).'; return; }
  joining = true; $('#room-submit').disabled = true; $('#room-error').textContent = '';
  try {
    const server = normalizeServer($('#server-url').value.trim());
    if (location.protocol === 'https:' && server.startsWith('http:')) throw new Error('Utilisez une adresse HTTPS depuis cette page.');
    client.nickname = $('#nickname').value.trim();
    await chooseRoom({ name: $('#new-room-name').value.trim() || 'Ma room', code: $('#join-code').value.toUpperCase().replace(/[-\s]/g, ''), server: referenceFor(server), isPrivate: $('#room-visibility').value === 'private', password: $('#room-password').value }, mode === 'create');
    $('#room-dialog').close();
  } catch (error) { $('#room-error').textContent = error.message; }
  finally { joining = false; $('#room-submit').disabled = false; }
});
$('#saved-room').addEventListener('change', async event => {
  const saved = client.rooms.find(entry => keyFor(entry) === event.target.value);
  if (saved) { try { await chooseRoom(saved); } catch { /* Status and automatic retry are shown in the room bar. */ } }
  else { disconnect(); client.active = null; await saveClient(); }
});
$('#leave-room').addEventListener('click', async () => { disconnect(); client.active = null; await saveClient(); });
$('#copy-code').addEventListener('click', async () => {
  if (!target?.code) return;
  try { await navigator.clipboard.writeText(target.code); notify('Code copié.'); } catch { notify(`Code : ${target.code}`); }
});
$('#edit-nickname')?.addEventListener('click', () => {
  $('#change-nickname-input').value = client.nickname || '';
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
function showPasswordPrompt(message = '') {
  if (!target || $('#room-dialog').open) return;
  $('#password-room-name').textContent = target.name; $('#password-error').textContent = message; $('#saved-room-password').value = '';
  if (!$('#password-dialog').open) $('#password-dialog').showModal();
}
$('#password-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!target) return;
  $('#password-submit').disabled = true;
  try {
    target.password = $('#saved-room-password').value; delete target.joinToken;
    await attemptJoin(epoch, false); $('#password-dialog').close();
  } catch (error) { $('#password-error').textContent = error.message; }
  finally { $('#password-submit').disabled = false; }
});
$('#password-dialog').addEventListener('close', () => { $('#saved-room-password').value = ''; if (target) delete target.password; });
$('#room-access').addEventListener('click', () => {
  if (!room?.access?.canManage) return;
  $('#access-visibility').value = room.access.isPrivate ? 'private' : 'public';
  $('#access-password-action').value = 'keep'; $('#access-password').value = ''; $('#access-password').hidden = true; $('#access-password').required = false; $('#access-password-label').hidden = true;
  $('#access-legacy-note').hidden = !room.access.unclaimed; $('#access-error').textContent = ''; $('#access-dialog').showModal();
});
$('#access-password-action').addEventListener('change', event => { const show = event.target.value === 'set'; $('#access-password').hidden = !show; $('#access-password').required = show; $('#access-password-label').hidden = !show; });
$('#access-dialog').addEventListener('close', () => { $('#access-password').value = ''; });
$('#access-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!room?.access?.canManage) return;
  const selected = target, current = room; $('#access-submit').disabled = true;
  try {
    const data = await connection.request('room-settings', { isPrivate: $('#access-visibility').value === 'private', passwordAction: $('#access-password-action').value, password: $('#access-password').value });
    if (target !== selected || room !== current) return;
    room.access = data.access; target.joinToken = data.joinToken; if (data.ownerToken) target.ownerToken = data.ownerToken;
    client.rooms = client.rooms.map(entry => keyFor(entry) === keyFor(target) ? { ...target } : entry);
    await saveClient(); renderRooms(); $('#access-dialog').close(); notify('Accès de la room enregistrés.');
  } catch (error) { $('#access-error').textContent = error.message; }
  finally { $('#access-submit').disabled = false; }
});
$('#caption').addEventListener('input', renderSend);
function createSilentWavBlob(seconds) {
  const sampleRate = 8000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = Math.floor(seconds * byteRate);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
  }
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  return new Blob([buffer], { type: 'audio/wav' });
}

async function uploadMedia(file, currentEpoch, currentRoom) {
  const server = resolveServer(target.server);
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (currentEpoch !== epoch || room !== currentRoom) throw new Error('Connexion interrompue.');
    response = await fetch(`${server}/api/media`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${currentRoom.token}`,
        'Content-Type': 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name)
      },
      body: file,
      signal: AbortSignal.timeout(LIMITS.transferTimeoutMs)
    });
    if (response.status !== 429 || attempt === 2) break;
    await response.arrayBuffer();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Import impossible.');
  return data;
}

async function uploadSilentAudio(durationSec) {
  const blob = createSilentWavBlob(durationSec);
  const file = new File([blob], 'silent_audio.wav', { type: 'audio/wav' });
  return uploadMedia(file, epoch, room);
}

$('#send-form').addEventListener('submit', async event => {
  event.preventDefault(); if ($('#broadcast').disabled) return;
  sending = true; renderSend();
  try {
    const payload = currentReaction();
    const durationVal = Number($('#duration').value);
    if (!audio && visual?.kind !== 'video' && Number.isFinite(durationVal) && (durationVal < 2 || durationVal > LIMITS.durationMax)) {
      const silentAsset = await uploadSilentAudio(durationVal);
      payload.audioId = silentAsset.id;
      payload.audio = silentAsset;
    }
    await connection.request('broadcast', payload);
    nextSend = Date.now() + 3000;
    setTimeout(renderSend, 3050);
    notify('Envoyé.');
  }
  catch (error) { notify(error.message, true); }
  finally { sending = false; renderSend(); }
});
function attach(asset) { if (asset.kind === 'audio') audio = asset; else visual = asset; renderAttachments(); }
async function uploadFiles(files) {
  if (importing) return;
  if (!connected || !room) { notify('Sélectionnez une room avant d’ajouter un fichier.'); return; }
  importing = true; renderSend(); const currentEpoch = epoch, currentRoom = room;
  try {
    for (const file of files.slice(0, 2)) {
      if (file.size > LIMITS.uploadBytes) throw new Error(`${file.name} dépasse 1 Go.`);
      const data = await uploadMedia(file, currentEpoch, currentRoom);
      if (currentEpoch !== epoch || room !== currentRoom) return;
      if (!library.some(asset => asset.id === data.id)) library.push(data);
      attach(data); renderLibrary();
    }
  } catch (error) { notify(error.name === 'TimeoutError' ? 'L’import a pris trop de temps.' : error.message, true); }
  finally { importing = false; renderSend(); }
}
$('#attach-file').addEventListener('click', () => {
  if (!connected) { notify('Sélectionnez une room avant d’ajouter un fichier.'); return; }
  $('#file-input').click();
});
$('#file-input').addEventListener('change', event => { uploadFiles([...event.target.files]); event.target.value = ''; });
$('#attach-audio').addEventListener('click', () => { if (!connected) { notify('Sélectionnez une room avant d’ajouter un audio.'); return; } $('#audio-input').click(); });
$('#audio-input').addEventListener('change', event => { uploadFiles([...event.target.files]); event.target.value = ''; });
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
    if (!connected || !room) {
      notify('Sélectionnez une room avant d’ajouter un fichier.');
      return;
    }
    showMessages(false);
    await uploadFiles(files);
  }
});
$('#existing-media')?.addEventListener('change', event => { const asset = library.find(item => item.id === event.target.value); if (asset) attach(asset); event.target.value = ''; });
function renderSubtitles() { $('#subtitle-label').textContent = cues.length ? `${cues.length} sous-titre(s)` : ''; $('#clear-subtitles').hidden = !cues.length; }
$('#subtitle-button').addEventListener('click', () => $('#subtitle-input').click());
$('#subtitle-input').addEventListener('change', async event => {
  try {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 32000) throw new Error('Le fichier SRT dépasse 32 Ko.');
    const parsed = parseSubtitles(await file.text()); if (!parsed.length) throw new Error('Aucun sous-titre valide dans ce fichier.');
    cues = parsed; renderSubtitles();
  } catch (error) { notify(error.message, true); } finally { event.target.value = ''; }
});
$('#clear-subtitles').addEventListener('click', () => { cues = []; renderSubtitles(); });
$('#preview-play').addEventListener('click', () => {
  $('#preview-dialog').showModal(); preview?.destroy(); $('#preview-loading').hidden = false;
  preview = mountReaction($('#large-preview'), currentReaction(), { volume:settings.volume, autoplay:true, onReady:() => { $('#preview-loading').hidden = true; }, onDone:() => $('#preview-dialog').close(), onError:() => { $('#preview-dialog').close(); notify('Impossible de lire ce fichier.', true); } });
});
$('#preview-dialog').addEventListener('close', () => { preview?.destroy(); preview = null; });
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
for (const dialog of document.querySelectorAll('dialog')) {
  let outsideDown = false;
  const outside = event => { const r = dialog.getBoundingClientRect(); return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom; };
  dialog.addEventListener('pointerdown', event => { outsideDown = event.target === dialog && outside(event); });
  dialog.addEventListener('click', event => { if (outsideDown && event.target === dialog && outside(event)) dialog.close(); outsideDown = false; });
}
$('#open-settings').addEventListener('click', () => { renderSettings(); renderRooms(); $('#settings-dialog').showModal(); });
$('#auto-join').addEventListener('change', async event => { client.autoJoin = event.target.checked; await saveClient(); });
async function stopShortcutCapture() {
  recordingShortcut = false; renderSettings();
  if (native) await native.recordShortcut(false);
}
async function saveDismissShortcut(value) {
  shortcutBusy = true;
  try {
    await stopShortcutCapture();
    settings = await native.saveDismissShortcut(value);
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
  const pauseChanged = settings.paused !== value.paused; settings = cleanSettings(value); renderSettings();
  if (native) try { await native.saveSettings(settings); } catch { notify('Impossible d’enregistrer les réglages.', true); }
  if (pauseChanged && connected) connection.request('status', { paused:settings.paused }).catch(() => {});
}
$('#pause-reception').addEventListener('click', () => updateSettings({ ...settings, paused:!settings.paused }));
for (const [id, key] of [['setting-paused','paused'],['setting-hide-self','hideSelf'],['setting-auto-start','autoStart'],['setting-volume','volume'],['setting-size','size'],['setting-cooldown','cooldown'],['setting-position','position'],['setting-display','display']]) {
  $(`#${id}`)?.addEventListener('input', event => { const input = event.target; updateSettings({ ...settings, [key]:input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value }); });
}
$('#test-overlay').addEventListener('click', async () => { if (native) { const result = await native.test(); if (!result.shown) notify('Reprenez la réception pour tester l’overlay.'); } });
let currentTab = 'composer';
let messageHistory = [];

function historyStorageKey(roomCode) {
  return `evil-memeroom:history:${roomCode || 'global'}`;
}
function loadHistoryFromStorage(roomCode) {
  try {
    const raw = localStorage.getItem(historyStorageKey(roomCode));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveHistoryToStorage(roomCode, list) {
  try {
    localStorage.setItem(historyStorageKey(roomCode), JSON.stringify(list.slice(0, 100)));
  } catch {}
}
function updateHistoryBadge() {
  const countEl = $('#history-count');
  if (countEl) countEl.textContent = String(messageHistory.length);
}
function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
async function replayMessage(item) {
  if (!connected || !room) {
    notify('Sélectionnez une room avant de rejouer un message.', true);
    return;
  }
  try {
    if (native) {
      const payload = {
        ...item,
        delay: 0,
        age: 0,
        replay: true,
        server: item.server || resolveServer(target.server)
      };
      const result = await native.show(payload);
      if (result && result.shown === false) {
        if (result.reason === 'paused') notify('Reprenez la réception pour rejouer le message.', true);
        else notify('Le message n’a pas pu être rejoué.', true);
      } else {
        notify('Message rejoué.');
      }
    } else {
      notify('Relecture disponible dans l’application installée.');
    }
  } catch (err) {
    notify(`Impossible de rejouer : ${err.message}`, true);
  }
}
function renderHistory() {
  updateHistoryBadge();
  const container = $('#history-list');
  if (!container) return;
  for (const player of container.querySelectorAll('video')) { player.pause(); player.removeAttribute('src'); player.load(); }
  container.replaceChildren();

  if (!messageHistory.length) {
    const emptyMsg = node('p', 'Aucun message dans l’historique pour le moment.', 'muted');
    emptyMsg.style.padding = '30px 10px';
    emptyMsg.style.textAlign = 'center';
    container.append(emptyMsg);
    return;
  }

  for (const item of messageHistory) {
    const card = node('div', undefined, 'history-card');

    if (item.media || item.audio) {
      const thumbBox = node('div', undefined, 'history-thumb-box');
      const mediaBase = item.server || resolveServer(target?.server);
      if (item.media?.kind === 'image') {
        const img = node('img', undefined, 'history-thumb');
        img.src = item.media.url ? new URL(item.media.url, mediaBase).href : '';
        img.alt = item.media.name || 'Image';
        img.loading = 'lazy';
        thumbBox.append(img);
      } else if (item.media?.kind === 'video') {
        const vid = node('video', undefined, 'history-thumb');
        vid.src = item.media.url ? `${new URL(item.media.url, mediaBase).href}#t=0.001` : '';
        vid.muted = true;
        vid.preload = 'metadata';
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
    const replayBtn = node('button', '▶ Rejouer', 'history-btn-replay primary');
    replayBtn.type = 'button';
    replayBtn.setAttribute('title', 'Rejouer ce message');
    replayBtn.addEventListener('click', e => {
      e.stopPropagation();
      replayMessage(item);
    });
    actions.append(replayBtn);

    card.append(actions);
    container.append(card);
  }
}
function showTab(tab) {
  if (typeof tab === 'boolean') tab = tab ? 'presets' : 'composer';
  currentTab = tab;
  const appEl = document.querySelector('main.app');
  if (appEl) appEl.dataset.tab = tab;
  $('#send-form').hidden = tab !== 'composer';
  $('#presets-panel').hidden = tab !== 'presets';
  $('#history-panel').hidden = tab !== 'history';
  $('#show-composer').setAttribute('aria-pressed', String(tab === 'composer'));
  $('#show-presets').setAttribute('aria-pressed', String(tab === 'presets'));
  $('#show-history').setAttribute('aria-pressed', String(tab === 'history'));
  if (tab === 'presets') void loadSavedMemes();
  if (tab === 'history') renderHistory();
}
const showMessages = showTab;
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
async function loadSavedMemes() {
  if (!native?.listSavedMemes) return;
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
    await native.renameSavedMeme(memeToRename.name, newName);
    dialog?.close();
    notify('Mème renommé.');
    await loadSavedMemes();
  } catch (ex) {
    if (err) err.textContent = ex.message;
    else notify(ex.message, true);
  }
});
function renderSavedMemes() {
  $('#preset-count').textContent = String(savedMemes.length);
  const grid = $('#saved-memes-grid');
  if (!grid) return;
  for (const player of grid.querySelectorAll('video')) { player.pause(); player.removeAttribute('src'); player.load(); }
  grid.replaceChildren();
  const rawQuery = $('#saved-search')?.value || '';
  const query = normalizeSearch(rawQuery);
  const filtered = query
    ? savedMemes.filter(item => normalizeSearch(item.name).includes(query))
    : savedMemes;
  if (!filtered.length) {
    const emptyMsg = node('p', savedMemes.length ? 'Aucun mème ne correspond à votre recherche.' : 'Aucun mème enregistré pour le moment. Les mèmes reçus s’enregistrent automatiquement ici.', 'muted');
    emptyMsg.style.gridColumn = '1 / -1';
    emptyMsg.style.padding = '30px 10px';
    emptyMsg.style.textAlign = 'center';
    grid.append(emptyMsg);
    return;
  }
  for (const meme of filtered) {
    const card = node('div', undefined, 'saved-meme-card');
    card.setAttribute('title', `${meme.name} (cliquer pour ouvrir)`);
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
    insertBtn.setAttribute('title', 'Utiliser dans le compositeur');
    insertBtn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!connected || !room) { notify('Rejoignez une room avant d’insérer un mème.'); return; }
      try {
        const fileData = await native.readSavedMeme(meme.name);
        const ext = meme.name.slice(meme.name.lastIndexOf('.')).toLowerCase();
        const mime = SAVED_MIME_TYPES[ext] || 'application/octet-stream';
        const file = new File([fileData.buffer], meme.name, { type: mime });
        showMessages(false);
        await uploadFiles([file]);
      } catch (err) { notify(`Impossible de charger le fichier : ${err.message}`, true); }
    });
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
        savedMemes = savedMemes.filter(item => item.name !== meme.name);
        renderSavedMemes();
        notify(`« ${meme.name} » supprimé.`);
      } catch (err) { notify(err.message, true); }
    });
    actions.append(insertBtn, renameBtn, delBtn);
    card.append(thumbBox, name, actions);
    card.addEventListener('click', () => {
      if (native?.openSavedMemeFile) native.openSavedMemeFile(meme.name).catch(err => notify(err.message, true));
    });
    grid.append(card);
  }
}
$('#show-composer').addEventListener('click', () => showTab('composer'));
$('#show-presets').addEventListener('click', () => showTab('presets'));
$('#show-history').addEventListener('click', () => showTab('history'));
$('#clear-history')?.addEventListener('click', () => {
  messageHistory = [];
  if (room?.code) saveHistoryToStorage(room.code, messageHistory);
  renderHistory();
  updateHistoryBadge();
  notify('Historique effacé.');
});
$('#duration')?.addEventListener('change', () => {
  const val = Number($('#duration').value);
  if (!Number.isFinite(val) || val < 1) $('#duration').value = '1';
  else if (val > 600) $('#duration').value = '600';
});
let searchDebounceTimer;
$('#saved-search')?.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(renderSavedMemes, 120);
});
$('#open-saved-folder')?.addEventListener('click', async () => {
  if (native?.openSavedMemesFolder) {
    try { await native.openSavedMemesFolder(); } catch (err) { notify(err.message, true); }
  }
});
async function init() {
  if (native) {
    const info = await native.info(); settings = info.settings; localServer = info.server; addresses = info.addresses;
    mac = info.platform === 'darwin';
    if (mac) $('#pause-shortcut-note').textContent = 'Pause rapide : Cmd + Maj + F8';
    if (info.shortcutError) $('#shortcut-hint').textContent = info.shortcutError;
    client = cleanClientState(info.clientState || client);
    for (const display of info.displays) $('#setting-display').add(new Option(display.label, display.id));
    $('#pause-reception').hidden = false;
    native.onSettings(value => { const pauseChanged = settings.paused !== value.paused; settings = value; renderSettings(); if (pauseChanged && connected) connection.request('status', { paused:settings.paused }).catch(() => {}); });
    native.onError(message => notify(message, true));
    if (native.onSavedMemesUpdated) native.onSavedMemesUpdated(() => { void loadSavedMemes(); });
    await loadSavedMemes();
  } else $('#reception-settings').hidden = true;
  renderRooms(); renderSettings(); renderLibrary(); showTab(currentTab);
  if (client.autoJoin && client.active) {
    const saved = client.rooms.find(entry => keyFor(entry) === keyFor(client.active));
    if (saved) try { await chooseRoom(saved); } catch { /* Saved room stays available while the server is offline. */ }
  }
  document.body.dataset.ready = 'true';
}
init().catch(error => { status = 'Initialisation impossible.'; renderRooms(); notify(error.message, true); });
