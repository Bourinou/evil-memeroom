import { cleanClientState, normalizeServer } from '../../shared/protocol.mjs';
import { createRoomSession } from './room-session.mjs';
import { $, node, notify, readStorage } from './dom.mjs';
export function createRoomsUI({ native, getSettings, onChange, onReset, onLibrary, onReaction }) {
  const storageKey = 'memeroom.client.v2';
  let client = cleanClientState(readStorage(storageKey) || {});
  let localServer = location.origin,
    addresses = [],
    mode = 'create',
    joining = false,
    directoryRequest;
  const keyFor = (value) => (value ? `${value.server}|${value.code}` : '');
  const resolveServer = (ref) => (ref === 'local' ? localServer : ref);
  function referenceFor(url) {
    const parsed = new URL(url),
      local = new URL(localServer);
    return native &&
      parsed.port === local.port &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
      ? 'local'
      : url;
  }

  const session = createRoomSession({
    identity: () => ({ name: client.nickname, desktop: !!native, paused: getSettings().paused }),
    resolveServer: async (ref) => {
      if (ref === 'local') applyHosting(await native.ensureHosting());
      return resolveServer(ref);
    },
    isSaved: (record) => client.rooms.some((entry) => keyFor(entry) === keyFor(record)),
    onChange(reason, _session, error) {
      if (reason === 'disconnect') {
        onReset();
        $('#password-dialog').close();
        $('#access-dialog').close();
      }
      if (reason === 'disconnect' || reason === 'offline') native?.clear();
      renderRooms();
      if (error?.code === 'ROOM_PASSWORD_REQUIRED' && !joining) showPasswordPrompt(error.message);
    },
    async onJoined(target, data) {
      onLibrary(data.media);
      client.rooms = [target, ...client.rooms.filter((entry) => keyFor(entry) !== keyFor(target))];
      client.active = { code: target.code, server: target.server };
      const saved = await saveClient();
      if (data.persistent !== true)
        notify(
          'Ce serveur doit être mis à jour pour conserver ses rooms après un redémarrage.',
          true,
        );
      return saved;
    },
    onEvent(event) {
      if (!session.connected || !session.room) return;
      if (event.type === 'room-deleted') {
        session.disconnect();
        client.active = null;
        void saveClient();
        notify('Cette room a été supprimée par son gestionnaire.');
      } else if (event.type === 'members') {
        session.room.members = event.members;
        renderRooms();
      } else if (event.type === 'library') onLibrary(event.media);
      else if (event.type === 'room-access') {
        session.room.access = event.access;
        renderRooms();
      } else if (event.type === 'access-changed') {
        delete session.target.joinToken;
        notify('Les accès de la room ont changé. Rejoignez-la à nouveau.');
      } else if (event.type === 'reaction') onReaction(event);
    },
  });
  async function saveClient() {
    client = cleanClientState(client);
    try {
      if (native) await native.saveClient(client);
      else localStorage.setItem(storageKey, JSON.stringify(client));
    } catch {
      notify('Impossible d’enregistrer les rooms sur cet appareil.', true);
      return false;
    }
    return true;
  }
  function renderRooms() {
    const select = $('#saved-room');
    select.replaceChildren(new Option('Choisir une room', ''));
    for (const saved of client.rooms) select.add(new Option(saved.name, keyFor(saved)));
    select.value = keyFor(session.target);
    $('#connection-status').textContent = session.status;
    $('#copy-code').hidden = !session.target?.code;
    $('#leave-room').hidden = !session.target;
    $('#room-access').hidden = !session.connected || !session.room?.access?.canManage;
    $('#copy-code').textContent = session.target?.code
      ? `Code : ${session.target.code} · copier`
      : 'Copier le code';
    $('#members').hidden = !session.connected;
    $('#members').textContent =
      session.room?.members
        .map(
          (member) =>
            `${member.name}${member.desktop ? (member.paused ? ' (en pause)' : '') : ' (web)'}`,
        )
        .join(', ') || '';
    const list = $('#saved-rooms-list');
    list.replaceChildren();
    if (!client.rooms.length) list.append(node('p', 'Aucune room enregistrée.', 'muted'));
    for (const saved of client.rooms) {
      const row = node('div', undefined, 'saved-entry'),
        text = node('div');
      text.append(
        node('strong', saved.name),
        node('small', `${saved.code} · ${saved.server === 'local' ? 'Ce PC' : saved.server}`),
      );
      const remove = node('button', 'Retirer', 'text-button');
      remove.setAttribute('aria-label', `Retirer ${saved.name} des rooms enregistrées`);
      remove.addEventListener('click', async () => {
        if (keyFor(session.target) === keyFor(saved)) session.disconnect();
        client.rooms = client.rooms.filter((entry) => keyFor(entry) !== keyFor(saved));
        if (keyFor(client.active) === keyFor(saved)) client.active = null;
        await saveClient();
        renderRooms();
      });
      row.append(text, remove);
      list.append(row);
    }
    onChange();
  }

  async function chooseRoom(record, create = false) {
    if (!create && client.rooms.some((entry) => keyFor(entry) === keyFor(record))) {
      client.active = { code: record.code, server: record.server };
      void saveClient();
    }
    return session.choose(record, create);
  }
  function setMode(value) {
    mode = value;
    for (const entry of ['create', 'join', 'browse']) {
      $(`#mode-${entry}`).classList.toggle('selected', mode === entry);
      $(`#mode-${entry}`).setAttribute('aria-pressed', String(mode === entry));
    }
    $('#room-name-field').hidden = mode !== 'create';
    $('#new-room-name').required = mode === 'create';
    $('#room-visibility-field').hidden = mode !== 'create';
    $('#join-code-field').hidden = mode !== 'join';
    $('#join-code').required = mode === 'join';
    $('#room-directory').hidden = mode !== 'browse';
    $('#room-password-label').hidden = mode === 'browse';
    $('#room-password').hidden = mode === 'browse';
    $('#room-password').autocomplete = mode === 'create' ? 'new-password' : 'current-password';
    $('#room-submit').hidden = mode === 'browse';
    $('#room-submit').textContent =
      mode === 'create' ? 'Créer et enregistrer' : 'Rejoindre et enregistrer';
    $('#room-error').textContent = '';
    if (mode === 'browse') void loadDirectory();
  }
  function updateHostAddress() {
    let ownServer = false;
    try {
      const server = normalizeServer($('#server-url').value.trim());
      ownServer = server === localServer || addresses.includes(server);
    } catch {
      /* Wait for a complete URL. */
    }
    $('#host-address').hidden = !ownServer || !addresses.length;
  }
  function applyHosting(info) {
    if ($('#server-url').value === localServer) $('#server-url').value = info.server;
    localServer = info.server;
    addresses = info.addresses;
    $('#host-address').textContent = addresses.length
      ? `Adresse de ce PC pour vos amis : ${addresses.join(' ou ')}`
      : '';
    updateHostAddress();
  }
  $('#add-room').addEventListener('click', () => {
    $('#nickname').value = client.nickname;
    $('#server-url').value = resolveServer(
      session.target?.server || (native ? 'local' : location.origin),
    );
    $('#host-address').textContent = addresses.length
      ? `Adresse de ce PC pour vos amis : ${addresses.join(' ou ')}`
      : '';
    updateHostAddress();
    $('#room-password').value = '';
    $('#join-code').value = '';
    $('#new-room-name').value = '';
    $('#room-visibility').value = 'private';
    $('#room-error').textContent = '';
    setMode('create');
    $('#room-dialog').showModal();
  });
  $('#mode-create').addEventListener('click', () => setMode('create'));
  $('#mode-join').addEventListener('click', () => setMode('join'));
  $('#mode-browse').addEventListener('click', () => setMode('browse'));
  async function loadDirectory() {
    directoryRequest?.abort();
    const request = new AbortController();
    directoryRequest = request;
    const timer = setTimeout(() => request.abort(), 6000);
    $('#server-rooms').replaceChildren();
    $('#directory-status').textContent = 'Chargement des rooms…';
    $('#refresh-rooms').disabled = true;
    try {
      let server = normalizeServer($('#server-url').value.trim());
      if (referenceFor(server) === 'local') {
        applyHosting(await native.ensureHosting());
        server = localServer;
      }
      const response = await fetch(`${server}/api/rooms`, { signal: request.signal });
      if (response.status === 404)
        throw new Error('Ce serveur doit être mis à jour en 0.4.0 pour afficher ses rooms.');
      if (!response.ok) throw new Error('Impossible de charger les rooms du serveur.');
      const data = await response.json();
      if (!Array.isArray(data.rooms)) throw new Error('Réponse du serveur invalide.');
      if (request !== directoryRequest) return;
      $('#directory-status').textContent = data.rooms.length
        ? 'Les rooms privées se rejoignent par leur code.'
        : 'Aucune room publique sur ce serveur.';
      for (const entry of data.rooms.slice(0, 100)) {
        if (!entry || !/^[A-Z2-9]{8}$/.test(entry.code)) continue;
        const row = node('div', undefined, 'directory-entry'),
          info = node('div');
        info.append(
          node('strong', String(entry.name).slice(0, 40)),
          node(
            'small',
            `${Number(entry.members) || 0} participant(s)${entry.passwordRequired ? ' · Mot de passe' : ''}`,
          ),
        );
        const join = node('button', 'Rejoindre');
        join.type = 'button';
        join.setAttribute('aria-label', `Rejoindre ${String(entry.name).slice(0, 40)}`);
        join.addEventListener('click', () => {
          setMode('join');
          $('#join-code').value = entry.code;
          $('#room-password').value = '';
          if (entry.passwordRequired) $('#room-password').focus();
          else $('#room-form').requestSubmit();
        });
        row.append(info, join);
        $('#server-rooms').append(row);
      }
    } catch (error) {
      if (request === directoryRequest)
        $('#directory-status').textContent =
          error.name === 'AbortError' ? 'Serveur inaccessible. Réessayez.' : error.message;
    } finally {
      clearTimeout(timer);
      if (request === directoryRequest) $('#refresh-rooms').disabled = false;
    }
  }
  $('#refresh-rooms').addEventListener('click', loadDirectory);
  $('#server-url').addEventListener('input', () => {
    updateHostAddress();
    directoryRequest?.abort();
    directoryRequest = null;
    $('#server-rooms').replaceChildren();
    $('#directory-status').textContent = 'Cliquez sur Afficher les rooms pour ce serveur.';
    $('#refresh-rooms').disabled = false;
  });
  $('#room-dialog').addEventListener('close', () => {
    directoryRequest?.abort();
    $('#room-password').value = '';
  });
  $('#room-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (joining || mode === 'browse') return;
    if (client.rooms.length >= 30) {
      $('#room-error').textContent =
        'Retirez une room enregistrée pour en ajouter une autre (30 maximum).';
      return;
    }
    joining = true;
    $('#room-submit').disabled = true;
    $('#room-error').textContent = '';
    try {
      const server = normalizeServer($('#server-url').value.trim());
      if (location.protocol === 'https:' && server.startsWith('http:'))
        throw new Error('Utilisez une adresse HTTPS depuis cette page.');
      client.nickname = $('#nickname').value.trim();
      await chooseRoom(
        {
          name: $('#new-room-name').value.trim() || 'Ma room',
          code: $('#join-code').value.toUpperCase().replace(/[-\s]/g, ''),
          server: referenceFor(server),
          isPrivate: $('#room-visibility').value === 'private',
          password: $('#room-password').value,
        },
        mode === 'create',
      );
      $('#room-dialog').close();
    } catch (error) {
      $('#room-error').textContent = error.message;
    } finally {
      joining = false;
      $('#room-submit').disabled = false;
    }
  });
  $('#saved-room').addEventListener('change', async (event) => {
    const saved = client.rooms.find((entry) => keyFor(entry) === event.target.value);
    if (saved) {
      try {
        await chooseRoom(saved);
      } catch {
        /* Status and automatic retry are shown in the room bar. */
      }
    } else {
      session.disconnect();
      client.active = null;
      await saveClient();
    }
  });
  $('#leave-room').addEventListener('click', async () => {
    session.disconnect();
    client.active = null;
    await saveClient();
  });
  $('#copy-code').addEventListener('click', async () => {
    if (!session.target?.code) return;
    try {
      await navigator.clipboard.writeText(session.target.code);
      notify('Code copié.');
    } catch {
      notify(`Code : ${session.target.code}`);
    }
  });
  function showPasswordPrompt(message = '') {
    if (!session.target || $('#room-dialog').open) return;
    $('#password-room-name').textContent = session.target.name;
    $('#password-error').textContent = message;
    $('#saved-room-password').value = '';
    if (!$('#password-dialog').open) $('#password-dialog').showModal();
  }
  $('#password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!session.target) return;
    $('#password-submit').disabled = true;
    try {
      session.target.password = $('#saved-room-password').value;
      delete session.target.joinToken;
      await session.retry();
      $('#password-dialog').close();
    } catch (error) {
      $('#password-error').textContent = error.message;
    } finally {
      $('#password-submit').disabled = false;
    }
  });
  $('#password-dialog').addEventListener('close', () => {
    $('#saved-room-password').value = '';
    if (session.target) delete session.target.password;
  });
  $('#room-access').addEventListener('click', () => {
    if (!session.room?.access?.canManage) return;
    $('#access-visibility').value = session.room.access.isPrivate ? 'private' : 'public';
    $('#access-password-action').value = 'keep';
    $('#access-password').value = '';
    $('#access-password').hidden = true;
    $('#access-password').required = false;
    $('#access-password-label').hidden = true;
    $('#access-legacy-note').hidden = !session.room.access.unclaimed;
    $('#access-error').textContent = '';
    $('#access-dialog').showModal();
  });
  $('#access-password-action').addEventListener('change', (event) => {
    const show = event.target.value === 'set';
    $('#access-password').hidden = !show;
    $('#access-password').required = show;
    $('#access-password-label').hidden = !show;
  });
  $('#access-dialog').addEventListener('close', () => {
    $('#access-password').value = '';
  });
  $('#access-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!session.room?.access?.canManage) return;
    const selected = session.target,
      current = session.room;
    $('#access-submit').disabled = true;
    try {
      const data = await session.request('room-settings', {
        isPrivate: $('#access-visibility').value === 'private',
        passwordAction: $('#access-password-action').value,
        password: $('#access-password').value,
      });
      if (session.target !== selected || session.room !== current) return;
      session.room.access = data.access;
      session.target.joinToken = data.joinToken;
      if (data.ownerToken) session.target.ownerToken = data.ownerToken;
      client.rooms = client.rooms.map((entry) =>
        keyFor(entry) === keyFor(session.target) ? { ...session.target } : entry,
      );
      await saveClient();
      renderRooms();
      $('#access-dialog').close();
      notify('Accès de la room enregistrés.');
    } catch (error) {
      $('#access-error').textContent = error.message;
    } finally {
      $('#access-submit').disabled = false;
    }
  });

  return {
    session,
    get client() {
      return client;
    },
    resolveServer,
    saveClient,
    render: renderRooms,
    async init(info) {
      if (info) {
        client = cleanClientState(info.clientState || client);
        applyHosting(info);
        native.onHosting(applyHosting);
      }
      renderRooms();
      if (client.autoJoin && client.active) {
        const saved = client.rooms.find((entry) => keyFor(entry) === keyFor(client.active));
        if (saved) await chooseRoom(saved).catch(() => {});
      }
    },
  };
}
