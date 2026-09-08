# Contrats réseau et IPC

Les validations exécutées restent dans `shared/*.mjs` et les transports. `shared/contracts.d.ts` fournit les types des objets principaux pour l’éditeur ; il ne remplace ni les validations d’entrée ni les tests. Le projet reste en JavaScript, sans compilation TypeScript supplémentaire.

## WebSocket

Connexion à `/ws`, enveloppe JSON `{ "id": "identifiant-requête", "type": "join", "data": { ... } }`. L’identifiant corrèle la réponse `{ replyTo, ok, data, serverTime }`, ou `{ replyTo, ok: false, error, code? }`. Les messages binaires sont refusés et la taille maximale est 48 Kio. Les champs de texte sont nettoyés avant utilisation.

| Type | Données principales | Autorisation / effet |
| --- | --- | --- |
| `ping` | Aucune | Horloge et maintien de connexion |
| `create` | `name`, `roomName`, `desktop`, `paused`, `isPrivate`, `password?` | Crée puis persiste ; renvoie code, état et jetons |
| `join` | `name`, `code`, `desktop`, `paused`, `password?`, `joinToken?`, `ownerToken?` | Vérifie les accès de cette room ; renvoie notamment `token` pour les imports |
| `status` | `paused` | Session membre active ; diffuse la présence |
| `leave` | Aucune | Quitte la room courante sans supprimer la room ni ses favoris |
| `room-settings` | `isPrivate`, `passwordAction: keep/set/remove`, `password?` | Gestionnaire, ou prise de gestion explicite d’une room ancienne non revendiquée |
| `room-delete` | `code` exact | Propriétaire identifié ; persistance avant réponse, fermeture des sessions et suppression des médias |
| `broadcast` | `caption`, `mediaId?`, `audioId?`, `duration`, `subtitles?` | Session active ; médias appartenant à la room ; délai entre envois appliqué |

Les événements non sollicités portent `type` : `members`, `library`, `reaction`, `room-access`, `access-changed`, `room-deleted`. Le client ne doit pas interpréter un texte d’erreur pour décider d’une reconnexion. `ROOM_PASSWORD_REQUIRED` et `ROOM_RATE_LIMITED` sont les codes métier actuellement transmis. La connexion locale utilise `NETWORK_UNAVAILABLE`, `NETWORK_INTERRUPTED`, `NETWORK_DISCONNECTED`, `NETWORK_TIMEOUT` pour ses propres pannes.

Les jetons membre, accès mémorisé, propriétaire et administrateur ont des usages distincts. Ne jamais les insérer dans une URL ou un journal. Le client sauvegarde les accès autorisés dans son profil ; il ne conserve pas les mots de passe en clair. La révocation d’accès vide les médias et interrompt les participants concernés.

## HTTP

| Route | Contrat |
| --- | --- |
| `GET /api/health` | Version issue de `package.json`, capacités et persistance |
| `GET /api/rooms` | Annuaire des rooms publiques, sans secrets |
| `GET /api/downloads` | Plateformes disponibles et URL de téléchargement |
| `POST /api/media` | `Authorization: Bearer <token membre>`, corps binaire, `X-Filename` encodé ; réponse 201 avec `MediaAsset` après validation |
| `GET/HEAD /media/:id` | Identifiant opaque, taille, type validé et Range ; 404 après expiration ou révocation |
| `GET/HEAD /releases/:filename` | Fichier autorisé et contenu dans le dossier de releases |
| `GET /api/admin/rooms`, `GET /api/admin/status`, `DELETE /api/admin/rooms/:code` | Administration optionnelle, secret distinct, accès direct de bouclage local sans Origin |

Les URL de serveur acceptent uniquement une origine HTTP(S), sans identifiants, chemin, requête ni fragment. Les flux vérifient leur taille même en l’absence d’en-tête Content-Length ; les téléchargements desktop refusent les redirections. Les limites restent dans `shared/limits.mjs`.

## IPC desktop

`desktop/preload.cjs` expose une API limitée via `window.memeroom` ; il n’expose ni `ipcRenderer` ni accès direct au disque. Le processus principal accepte les demandes uniquement de la frame principale de la télécommande privée. Les signaux de lecture sont réservés à la frame de l’overlay.

- Informations et hébergement : `info`, `ensureHosting`, `onHosting`. `info` n’ouvre pas le serveur ; `ensureHosting` renvoie le port et les adresses réellement utilisés.
- Persistance : `saveClient`, `saveSettings`, `saveDismissShortcut`. Une réponse réussie attend l’écriture atomique. Les réglages sont validés à la frontière native.
- Messages enregistrés : `listPresets`, `savePreset`, `renamePreset`, `removePreset`, `loadPreset`. Les identifiants sont validés avant tout accès disque ; les fichiers chargés sont réimportés dans la room.
- Lecture : `show`, `test`, `clear`, `preparePreview`, `releasePreview`. Un aperçu reçoit une URL privée opaque et limitée à sa durée de vie, jamais un chemin arbitraire.
- Fenêtre et raccourcis : `minimize`, `recordShortcut`, `onSettings`, `onError`.

L’overlay utilise `ready`, `progress`, `done`, `error` avec l’identifiant de génération. Un signal d’une ancienne génération est ignoré. Le compteur des images démarre à `ready` ; les médias temporels dépendent de leur fin réelle et d’une surveillance de progression.

## Compatibilité

Conserver les champs compris par les anciennes versions. Une nouvelle capacité serveur doit être annoncée dans `features` si le client doit la vérifier avant usage. Les formats de rooms v1/v2 et les favoris existants restent lus ; la suppression explicite est additive. Les clients anciens peuvent garder un favori vers une room supprimée, mais ne récupèrent pas une session révoquée.
