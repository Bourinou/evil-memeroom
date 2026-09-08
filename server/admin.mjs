import { normalizeServer } from '../shared/protocol.mjs';

const [action, code] = process.argv.slice(2);
if (!['list', 'delete'].includes(action) || (action === 'delete' && !/^[A-Z2-9]{8}$/.test(code))) {
  throw new Error('Utilisation : npm run rooms -- list | delete CODE');
}
const server = normalizeServer(
  process.env.MEMEROOM_ADMIN_URL || `http://127.0.0.1:${process.env.PORT || 3210}`,
);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(server).hostname))
  throw new Error('L’administration doit être exécutée sur le serveur local.');
if (!process.env.MEMEROOM_ADMIN_TOKEN)
  throw new Error('Configurer MEMEROOM_ADMIN_TOKEN sur le serveur et dans cet environnement.');
const response = await fetch(`${server}/api/admin/rooms${action === 'delete' ? '/' + code : ''}`, {
  method: action === 'delete' ? 'DELETE' : 'GET',
  headers: { Authorization: `Bearer ${process.env.MEMEROOM_ADMIN_TOKEN}` },
  redirect: 'error',
  signal: AbortSignal.timeout(6000),
});
const result = await response.json();
if (!response.ok) throw new Error(result.error || 'Administration impossible.');
console.log(JSON.stringify(result, null, 2));
