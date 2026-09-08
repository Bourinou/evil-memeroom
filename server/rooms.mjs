import { secret } from './room-access.mjs';
import { RoomStore } from './room-store.mjs';
import { MediaStorage } from './media-storage.mjs';
import { send } from './transport.mjs';

export function createRoomRegistry(dataDir, diagnostics) {
  const rooms = new Map(),
    sessions = new Map(),
    media = new Map();
  const store = new RoomStore(dataDir);
  const storage = new MediaStorage(diagnostics);
  const makeRoom = (code, name, access = {}) => ({
    code,
    name,
    isPrivate: true,
    passwordHash: null,
    ownerHash: null,
    accessKey: secret(),
    ...access,
    members: new Map(),
    media: new Map(),
    bytes: 0,
    history: [],
    revision: 0,
    failedPasswords: { start: Date.now(), count: 0 },
    lastActive: Date.now(),
    lastBroadcast: 0,
  });
  const transfers = { totalBytes: 0, uploads: 0 };
  function removeMedia(asset) {
    if (!media.delete(asset.id)) return;
    const room = rooms.get(asset.roomCode);
    if (room) {
      room.media.delete(asset.id);
      room.bytes -= asset.bytes;
    }
    transfers.totalBytes -= asset.bytes;
    storage.remove(asset);
  }
  const members = (room) =>
    [...room.members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      desktop: m.desktop,
      paused: m.paused,
    }));
  const emit = (room, event) => {
    for (const member of room.members.values()) send(member.ws, event);
  };
  const presence = (room) => emit(room, { type: 'members', members: members(room) });
  const leave = (ws) => {
    const member = ws.member;
    if (!member) return;
    sessions.delete(member.token);
    const room = rooms.get(member.code);
    if (room) {
      room.members.delete(member.id);
      room.lastActive = Date.now();
      presence(room);
    }
    ws.member = null;
  };
  function deleteRoom(room, onSaved = () => {}) {
    try {
      store.remove(room.code);
    } catch {
      throw Object.assign(new Error('Impossible d’enregistrer la suppression de la room.'), {
        status: 500,
      });
    }
    onSaved();
    for (const asset of room.media.values()) removeMedia(asset);
    for (const current of [...room.members.values()]) {
      send(current.ws, { type: 'room-deleted', code: room.code });
      leave(current.ws);
      current.ws.close(1000, 'Room supprimée');
    }
    rooms.delete(room.code);
  }

  return {
    rooms,
    sessions,
    media,
    store,
    storage,
    transfers,
    makeRoom,
    removeMedia,
    members,
    emit,
    presence,
    leave,
    deleteRoom,
  };
}
