import { randomBytes, createHash, createHmac, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
let activeHashes = 0;
export const secret = () => randomBytes(32).toString('base64url');
export const digest = (value) => createHash('sha256').update(value).digest('hex');
const equal = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function passwordInput(value = '') {
  if (typeof value !== 'string' || value.length > 128)
    throw new Error('Le mot de passe doit contenir au maximum 128 caractères.');
  return value;
}
async function key(password, salt) {
  if (activeHashes >= 4) throw new Error('Vérification occupée. Réessayez dans quelques secondes.');
  activeHashes++;
  try {
    return await derive(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  } finally {
    activeHashes--;
  }
}
export const validPasswordHash = (value) =>
  value === null ||
  (typeof value === 'string' && /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(value));
export async function hashPassword(value) {
  const password = passwordInput(value);
  if (!password) return null;
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await key(password, salt)).toString('hex')}`;
}
export async function verifyPassword(value, hash) {
  if (!hash) return true;
  const password = passwordInput(value);
  if (!password || !validPasswordHash(hash)) return false;
  const [, salt, expected] = hash.split('$');
  return equal((await key(password, salt)).toString('hex'), expected);
}
export function isOwner(room, value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(value) &&
    equal(digest(value), room.ownerHash)
  );
}
const signature = (room, nonce) =>
  createHmac('sha256', room.accessKey).update(`${room.code}:${nonce}`).digest('base64url');
export function issueJoinToken(room) {
  const nonce = randomBytes(16).toString('hex');
  return `${nonce}.${signature(room, nonce)}`;
}
export function validJoinToken(room, value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const [nonce, tag] = value.split('.');
  return equal(signature(room, nonce), tag);
}
export function accessInfo(room, owner = false) {
  return {
    isPrivate: room.isPrivate,
    passwordRequired: !!room.passwordHash,
    canManage: owner || !room.ownerHash,
    unclaimed: !room.ownerHash,
  };
}
export function passwordError() {
  return Object.assign(new Error('Mot de passe requis ou incorrect pour cette room.'), {
    code: 'ROOM_PASSWORD_REQUIRED',
  });
}
