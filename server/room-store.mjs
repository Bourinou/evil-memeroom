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
    try { contents = readFileSync(this.file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    if (contents.length > 1024 * 1024) throw new Error('Le fichier de rooms est trop volumineux.');
    const saved = JSON.parse(contents);
    if (![1, 2, 3].includes(saved.version) || !Array.isArray(saved.rooms) || saved.rooms.length > 100) throw new Error('Le fichier de rooms est invalide.');
    for (const room of saved.rooms) {
      if (!room || !/^[A-Z2-9]{8}$/.test(room.code) || !cleanText(room.name, 40) || this.records.has(room.code)) throw new Error('Une room enregistrée est invalide.');
      const access = saved.version === 1 ? { isPrivate: true, passwordHash: null, ownerHash: null, accessKey: secret() } : room;
      if (typeof access.isPrivate !== 'boolean' || !validPasswordHash(access.passwordHash) || !(access.ownerHash === null || typeof access.ownerHash === 'string' && /^[a-f0-9]{64}$/.test(access.ownerHash)) || typeof access.accessKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(access.accessKey)) throw new Error('Les accès d’une room enregistrée sont invalides.');
      const lastActive = Number.isFinite(room.lastActive) ? room.lastActive : Date.now(); // Versions 1-2 predate lastActive.
      this.records.set(room.code, { code: room.code, name: cleanText(room.name, 40), isPrivate: access.isPrivate, passwordHash: access.passwordHash, ownerHash: access.ownerHash, accessKey: access.accessKey, lastActive });
    }
    return [...this.records.values()];
  }
  record(room) { return { code: room.code, name: room.name, isPrivate: room.isPrivate, passwordHash: room.passwordHash, ownerHash: room.ownerHash, accessKey: room.accessKey, lastActive: room.lastActive }; }
  write(next) {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify({ version: 3, rooms: [...next.values()] }, null, 2), { mode: 0o600 });
    renameSync(this.file + '.tmp', this.file);
    this.records = next;
  }
  add(room) {
    if (!this.file) return;
    this.write(new Map(this.records).set(room.code, this.record(room)));
  }
  remove(code) {
    if (!this.file || !this.records.has(code)) return;
    const next = new Map(this.records); next.delete(code);
    this.write(next);
  }
  // One write for every saved room whose activity time changed since the last save.
  touch(rooms) {
    if (!this.file) return;
    let next = null;
    for (const room of rooms) if (this.records.get(room.code)?.lastActive !== room.lastActive) { next ||= new Map(this.records); next.set(room.code, this.record(room)); }
    if (next) this.write(next);
  }
}
