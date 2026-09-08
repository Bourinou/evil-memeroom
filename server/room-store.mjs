import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { cleanText } from '../shared/protocol.mjs';
import { secret, validPasswordHash } from './room-access.mjs';

// Access settings survive restarts. Passwords are stored only as salted scrypt hashes.
export class RoomStore {
  constructor(directory) {
    this.file = directory ? path.join(directory, 'rooms.json') : null;
    this.records = new Map();
  }
  load() {
    if (!this.file) return [];
    let contents;
    try {
      contents = readFileSync(this.file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    if (contents.length > 1024 * 1024) throw new Error('Le fichier de rooms est trop volumineux.');
    const saved = JSON.parse(contents);
    if (![1, 2].includes(saved.version) || !Array.isArray(saved.rooms) || saved.rooms.length > 100)
      throw new Error('Le fichier de rooms est invalide.');
    for (const room of saved.rooms) {
      if (
        !room ||
        !/^[A-Z2-9]{8}$/.test(room.code) ||
        !cleanText(room.name, 40) ||
        this.records.has(room.code)
      )
        throw new Error('Une room enregistrée est invalide.');
      const access =
        saved.version === 1
          ? { isPrivate: true, passwordHash: null, ownerHash: null, accessKey: secret() }
          : room;
      if (
        typeof access.isPrivate !== 'boolean' ||
        !validPasswordHash(access.passwordHash) ||
        !(
          access.ownerHash === null ||
          (typeof access.ownerHash === 'string' && /^[a-f0-9]{64}$/.test(access.ownerHash))
        ) ||
        typeof access.accessKey !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(access.accessKey)
      )
        throw new Error('Les accès d’une room enregistrée sont invalides.');
      this.records.set(room.code, {
        code: room.code,
        name: cleanText(room.name, 40),
        isPrivate: access.isPrivate,
        passwordHash: access.passwordHash,
        ownerHash: access.ownerHash,
        accessKey: access.accessKey,
      });
    }
    return [...this.records.values()];
  }
  add(room) {
    if (!this.file) return;
    const next = new Map(this.records);
    next.set(room.code, {
      code: room.code,
      name: room.name,
      isPrivate: room.isPrivate,
      passwordHash: room.passwordHash,
      ownerHash: room.ownerHash,
      accessKey: room.accessKey,
    });
    this.persist(next);
  }
  remove(code) {
    if (!this.file) return;
    const next = new Map(this.records);
    if (!next.delete(code)) throw new Error('Room introuvable.');
    this.persist(next);
  }
  persist(next) {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(
      this.file + '.tmp',
      JSON.stringify({ version: 2, rooms: [...next.values()] }, null, 2),
      { mode: 0o600 },
    );
    renameSync(this.file + '.tmp', this.file);
    this.records = next;
  }
}
