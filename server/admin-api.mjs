import { timingSafeEqual } from 'node:crypto';
import { digest } from './room-access.mjs';

// Local administration is explicitly enabled and has no room/session privileges in common.
export function createAdminHandler({ adminToken, rooms, deleteRoom, json }) {
  if (adminToken && !/^[A-Za-z0-9_-]{43}$/.test(adminToken)) {
    throw new Error(
      'MEMEROOM_ADMIN_TOKEN doit être un secret aléatoire de 32 octets en base64url.',
    );
  }
  const expected = adminToken && Buffer.from(digest(adminToken));
  return (req, res, url) => {
    if (!expected || !url.pathname.startsWith('/api/admin/rooms')) return false;
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    const provided = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!local || req.headers.origin || !timingSafeEqual(expected, Buffer.from(digest(provided)))) {
      json(res, 403, { error: 'Administration refusée.' });
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/rooms') {
      json(res, 200, {
        rooms: [...rooms.values()].map((room) => ({
          code: room.code,
          name: room.name,
          members: room.members.size,
        })),
      });
    } else {
      const match = /^\/api\/admin\/rooms\/([A-Z2-9]{8})$/.exec(url.pathname);
      const room = match && rooms.get(match[1]);
      if (req.method === 'DELETE' && room) {
        deleteRoom(room);
        json(res, 200, { deleted: room.code });
      } else json(res, 404, { error: 'Room introuvable.' });
    }
    return true;
  };
}
