import { Connection, isNetworkError } from './connection.mjs';

/** @param {{
 * identity: () => Pick<import('../../shared/contracts.js').RoomRequests['create'], 'name' | 'desktop' | 'paused'>,
 * resolveServer: (server: string) => Promise<string>,
 * isSaved: (target: import('../../shared/contracts.js').RoomTarget) => boolean,
 * onChange: (reason: string, session: unknown, error?: Error & {code?: string}) => void,
 * onEvent: (event: import('../../shared/contracts.js').RoomEvent) => void,
 * onJoined: (target: import('../../shared/contracts.js').RoomTarget, room: import('../../shared/contracts.js').JoinedRoom) => Promise<boolean>,
 * connectionFactory?: (server: string, onEvent: (event: import('../../shared/contracts.js').RoomEvent) => void, onClose: () => void) => Connection,
 * checkCreation?: (server: string) => Promise<void>
 * }} options */
export function createRoomSession({
  identity,
  resolveServer,
  isSaved,
  onChange,
  onEvent,
  onJoined,
  connectionFactory = (server, event, close) => new Connection(server, event, close),
  checkCreation = async (server) => {
    const response = await fetch(`${server}/api/health`, { signal: AbortSignal.timeout(6000) });
    if (!response.ok || !(await response.json()).features?.roomAccess)
      throw new Error('Mettez le serveur à jour en 0.4.0 pour créer une room avec ces accès.');
  },
}) {
  /** @type {import('../../shared/contracts.js').RoomTarget} */
  let target = null;
  /** @type {import('../../shared/contracts.js').JoinedRoom} */
  let room = null;
  /** @type {Connection} */
  let connection = null;
  let epoch = 0,
    timer,
    retries = 0,
    origin;
  let connected = false,
    connecting = false,
    status = 'Aucune room sélectionnée.';
  const changed = (reason, error) => onChange(reason, api, error);
  const current = (generation, transport) => epoch === generation && connection === transport;
  function disconnect() {
    epoch++;
    clearTimeout(timer);
    connection?.close();
    connection = null;
    room = null;
    target = null;
    connected = connecting = false;
    retries = 0;
    status = 'Aucune room sélectionnée.';
    changed('disconnect');
  }
  function schedule(generation) {
    clearTimeout(timer);
    if (epoch !== generation || !target) return;
    status = 'Serveur indisponible. Reconnexion automatique…';
    changed('retry');
    timer = setTimeout(
      () => void attempt(generation, false).catch(() => {}),
      Math.min(15000, 1000 * 2 ** retries++),
    );
  }
  async function attempt(generation, create) {
    if (epoch !== generation || !target) return;
    connecting = true;
    connection?.close();
    const transport = connectionFactory(
      origin,
      (event) => {
        if (current(generation, transport)) onEvent(event);
      },
      () => {
        if (!current(generation, transport)) return;
        connected = false;
        room = null;
        changed('offline');
        if (!connecting) schedule(generation);
      },
    );
    connection = transport;
    try {
      await transport.open();
      if (!current(generation, transport)) return;
      if (create) await checkCreation(origin);
      if (!current(generation, transport)) return;
      const data = await transport.request(create ? 'create' : 'join', {
        ...identity(),
        roomName: target.name,
        code: target.code,
        isPrivate: target.isPrivate,
        password: target.password,
        joinToken: target.joinToken,
        ownerToken: target.ownerToken,
      });
      if (!current(generation, transport)) return;
      target = {
        code: data.code,
        name: data.name,
        server: target.server,
        joinToken: data.joinToken,
        ownerToken: data.ownerToken || target.ownerToken,
      };
      room = data;
      connected = true;
      connecting = false;
      retries = 0;
      clearTimeout(timer);
      const saved = await onJoined(target, data);
      if (!current(generation, transport)) return;
      status = saved ? 'Connecté · room enregistrée' : 'Connecté · enregistrement local impossible';
      changed('joined');
    } catch (error) {
      if (!current(generation, transport)) return;
      connecting = connected = false;
      room = null;
      transport.close();
      if (!create && isNetworkError(error) && isSaved(target)) schedule(generation);
      else {
        status = error.message;
        changed('error', error);
      }
      throw error;
    }
  }
  const api = {
    get target() {
      return target;
    },
    get room() {
      return room;
    },
    get epoch() {
      return epoch;
    },
    get connected() {
      return connected;
    },
    get status() {
      return status;
    },
    get skew() {
      return connection?.skew || 0;
    },
    disconnect,
    /** @param {import('../../shared/contracts.js').RoomTarget} record */
    async choose(record, create = false) {
      disconnect();
      const generation = epoch;
      target = { ...record };
      status = 'Connexion…';
      changed('connecting');
      try {
        const resolved = await resolveServer(record.server);
        if (epoch !== generation) return;
        origin = resolved;
        return await attempt(generation, create);
      } catch (error) {
        if (epoch === generation && !connection) {
          status = error.message;
          changed('error', error);
        }
        throw error;
      }
    },
    retry() {
      clearTimeout(timer);
      return attempt(++epoch, false);
    },
    request(type, data) {
      if (!connected) return Promise.reject(new Error('Serveur déconnecté.'));
      return connection.request(type, data);
    },
  };
  return api;
}
