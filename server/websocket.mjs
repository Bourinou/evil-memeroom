import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { LIMITS, cleanText, publicMedia, validateReaction } from '../shared/protocol.mjs';
import { PasswordLimiter, clientIP } from './password-limiter.mjs';
import {
  secret,
  digest,
  hashPassword,
  verifyPassword,
  isOwner,
  issueJoinToken,
  validJoinToken,
  accessInfo,
  passwordError,
} from './room-access.mjs';
import { token, roomCode, send } from './transport.mjs';

export function attachWebSocket(
  server,
  registry,
  policy,
  { trustProxy, dataDir, cooldownMs, diagnostics },
) {
  const {
    rooms,
    sessions,
    store,
    makeRoom,
    members,
    emit,
    presence,
    leave,
    removeMedia,
    deleteRoom,
  } = registry;
  const { originAllowed, limited } = policy;
  const passwordLimiter = new PasswordLimiter();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 48 * 1024,
    perMessageDeflate: false,
  });
  server.on('upgrade', (req, socket, head) => {
    if (
      req.url !== '/ws' ||
      !originAllowed(req.headers.origin, req) ||
      wss.clients.size >= 256 ||
      limited(clientIP(req, trustProxy))
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws, req) => {
    ws.alive = true;
    ws.rate = { start: Date.now(), count: 0 };
    ws.on('pong', () => {
      ws.alive = true;
    });
    ws.on('error', () => {});
    ws.on('close', () => leave(ws));
    ws.queue = Promise.resolve();
    ws.queued = 0;
    ws.on('message', (raw, isBinary) => {
      if (ws.queued >= 8) {
        ws.terminate();
        return;
      }
      ws.queued++;
      ws.queue = ws.queue
        .then(() => processMessage(raw, isBinary))
        .finally(() => {
          ws.queued--;
        });
    });
    async function processMessage(raw, isBinary) {
      if (ws.readyState !== WebSocket.OPEN) return;
      let message;
      try {
        if (isBinary) throw new Error('Message invalide.');
        message = JSON.parse(raw.toString());
        if (
          !message ||
          typeof message !== 'object' ||
          typeof message.id !== 'string' ||
          message.id.length > 80
        )
          throw new Error('Message invalide.');
        const now = Date.now();
        if (now - ws.rate.start > 10000) ws.rate = { start: now, count: 0 };
        if (++ws.rate.count > 40) throw new Error('Trop de demandes. Patientez quelques secondes.');
        const reply = (data) =>
          send(ws, { replyTo: message.id, ok: true, data, serverTime: Date.now() });
        const body = message.data || {};
        if (message.type === 'ping') {
          reply({});
          return;
        }
        if (message.type === 'leave') {
          leave(ws);
          reply({});
          return;
        }
        if (['create', 'join'].includes(message.type)) {
          if (limited(clientIP(req, trustProxy)))
            throw new Error('Trop de tentatives de connexion. Patientez une minute.');
          const name = cleanText(body.name, 24);
          if (!name) throw new Error('Choisissez un pseudo.');
          let code = cleanText(body.code, 20).toUpperCase().replace(/[-\s]/g, '');
          let room, ownerToken;
          if (message.type === 'create') {
            if (rooms.size >= 100) throw new Error('Le serveur est plein. Réessayez plus tard.');
            const passwordHash = await hashPassword(body.password);
            if (ws.readyState !== WebSocket.OPEN) return;
            if (rooms.size >= 100) throw new Error('Le serveur est plein. Réessayez plus tard.');
            do {
              code = roomCode();
            } while (rooms.has(code));
            ownerToken = secret();
            room = makeRoom(code, cleanText(body.roomName, 40) || 'Ma room', {
              isPrivate: body.isPrivate !== false,
              passwordHash,
              ownerHash: digest(ownerToken),
            });
            try {
              store.add(room);
            } catch (error) {
              diagnostics.error('storage', error);
              throw new Error(
                'Impossible d’enregistrer la room sur le serveur. Vérifiez son stockage.',
              );
            }
          } else {
            room = rooms.get(code);
            if (!room)
              throw new Error('Cette room est introuvable. Vérifiez le code et le serveur.');
            const accessKey = room.accessKey;
            if (
              room.passwordHash &&
              !isOwner(room, body.ownerToken) &&
              !validJoinToken(room, body.joinToken)
            ) {
              const passwordSucceeded = passwordLimiter.consume(clientIP(req, trustProxy), code);
              if (Date.now() - room.failedPasswords.start > 60000)
                room.failedPasswords = { start: Date.now(), count: 0 };
              if (room.failedPasswords.count >= 12)
                throw new Error('Trop de mots de passe incorrects. Réessayez dans une minute.');
              const budget = room.failedPasswords;
              budget.count++;
              if (!(await verifyPassword(body.password, room.passwordHash))) throw passwordError();
              budget.count--;
              passwordSucceeded();
            }
            if (ws.readyState !== WebSocket.OPEN) return;
            if (room.accessKey !== accessKey || rooms.get(code) !== room) throw passwordError();
            if (room.members.size >= LIMITS.members)
              throw new Error('Cette room est pleine (16 participants).');
          }
          leave(ws);
          rooms.set(code, room);
          const member = {
            id: randomUUID(),
            token: token(),
            name,
            code,
            owner: isOwner(room, ownerToken || body.ownerToken),
            desktop: body.desktop === true,
            paused: body.paused === true,
            ws,
          };
          ws.member = member;
          room.members.set(member.id, member);
          sessions.set(member.token, member);
          room.lastActive = now;
          reply({
            memberId: member.id,
            token: member.token,
            code,
            name: room.name,
            persistent: !!dataDir,
            members: members(room),
            media: [...room.media.values()].map(publicMedia),
            history: room.history,
            access: accessInfo(room, member.owner),
            joinToken: issueJoinToken(room),
            ...(ownerToken ? { ownerToken } : {}),
          });
          presence(room);
          return;
        }
        const member = ws.member,
          room = member && rooms.get(member.code);
        if (!room) throw new Error('Rejoignez une room pour continuer.');
        if (message.type === 'status') {
          member.paused = body.paused === true;
          presence(room);
          reply({});
          return;
        }
        if (message.type === 'room-delete') {
          if (!member.owner) throw new Error('Seul le gestionnaire peut supprimer cette room.');
          if (body.code !== room.code) throw new Error('Confirmez le code de la room à supprimer.');
          // Persist first, then acknowledge before the connection is closed.
          deleteRoom(room, () => reply({ deleted: room.code }));
          return;
        }
        if (message.type === 'room-settings') {
          if (!member.owner && room.ownerHash)
            throw new Error('Seul le gestionnaire peut modifier cette room.');
          if (
            typeof body.isPrivate !== 'boolean' ||
            !['keep', 'set', 'remove'].includes(body.passwordAction)
          )
            throw new Error('Réglages de room invalides.');
          const revision = room.revision;
          const passwordHash =
            body.passwordAction === 'set'
              ? await hashPassword(body.password)
              : body.passwordAction === 'remove'
                ? null
                : room.passwordHash;
          if (body.passwordAction === 'set' && !passwordHash)
            throw new Error('Saisissez le nouveau mot de passe.');
          if (ws.readyState !== WebSocket.OPEN || ws.member !== member) return;
          if (room.revision !== revision)
            throw new Error('La room a changé. Rouvrez ses réglages.');
          const ownerToken = room.ownerHash ? null : secret();
          const changed = body.passwordAction !== 'keep';
          const updated = {
            ...room,
            isPrivate: body.isPrivate,
            passwordHash,
            ownerHash: ownerToken ? digest(ownerToken) : room.ownerHash,
            accessKey: changed ? secret() : room.accessKey,
          };
          try {
            store.add(updated);
          } catch {
            throw new Error('Impossible d’enregistrer les accès de la room.');
          }
          Object.assign(room, {
            isPrivate: updated.isPrivate,
            passwordHash,
            ownerHash: updated.ownerHash,
            accessKey: updated.accessKey,
            revision: revision + 1,
          });
          member.owner = true;
          if (changed) {
            for (const other of [...room.members.values()])
              if (other !== member) {
                send(other.ws, { type: 'access-changed' });
                leave(other.ws);
                other.ws.close(1008, 'Accès modifié');
              }
            for (const asset of room.media.values()) removeMedia(asset);
            room.media.clear();
            room.bytes = 0;
            room.history = [];
            room.failedPasswords = { start: Date.now(), count: 0 };
            emit(room, { type: 'library', media: [] });
          }
          for (const current of room.members.values())
            send(current.ws, { type: 'room-access', access: accessInfo(room, current.owner) });
          reply({
            access: accessInfo(room, true),
            joinToken: issueJoinToken(room),
            ...(ownerToken ? { ownerToken } : {}),
          });
          return;
        }
        if (message.type === 'broadcast') {
          if (now - room.lastBroadcast < cooldownMs)
            throw new Error('Une réaction vient de partir. Patientez 3 secondes.');
          for (const id of [body.mediaId, body.audioId])
            if (room.media.get(id)?.expiresAt <= Date.now())
              throw new Error(
                'Ce fichier a expiré. Importez-le à nouveau ou chargez un message enregistré.',
              );
          const reaction = validateReaction(body, room.media);
          const event = {
            ...reaction,
            id: randomUUID(),
            sender: { id: member.id, name: member.name },
            sentAt: now,
            startAt: now + 350,
            type: 'reaction',
          };
          room.lastBroadcast = now;
          room.lastActive = now;
          room.history.unshift({
            id: event.id,
            name: event.name,
            sender: member.name,
            sentAt: now,
            kind: event.media?.kind || (event.audio ? 'audio' : 'text'),
          });
          room.history.length = Math.min(room.history.length, 30);
          emit(room, event);
          reply({ id: event.id });
          return;
        }
        throw new Error('Action inconnue.');
      } catch (error) {
        if (error.status >= 500 || /^E[A-Z]+$/.test(error.code || ''))
          diagnostics.error('websocket', error);
        send(ws, {
          replyTo: typeof message?.id === 'string' ? message.id.slice(0, 80) : null,
          ok: false,
          error: error.message,
          ...(['ROOM_PASSWORD_REQUIRED', 'ROOM_RATE_LIMITED'].includes(error.code)
            ? { code: error.code }
            : {}),
        });
      }
    }
  });

  return { wss, passwordLimiter };
}
