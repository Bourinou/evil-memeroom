# Architecture

MemeRoom comporte trois parties : un serveur de rooms, une télécommande dans l’application Electron et une fenêtre d’overlay locale. Le site public sert les installateurs et leurs métadonnées. Une page web ordinaire ne peut pas afficher une fenêtre par-dessus les autres applications.

| Dossier | Responsabilité et points d’entrée |
| --- | --- |
| `server/` | `index.mjs` : HTTP, WebSocket et sessions ; `room-store.mjs` : persistance ; `room-access.mjs` et `password-limiter.mjs` : accès ; `media-storage.mjs` : flux et expiration ; `media-scan.mjs` : antivirus et inspection |
| `desktop/` | `main.cjs` : fenêtres, IPC, raccourcis et stockage utilisateur ; `control-page.cjs` : pages privées ; `overlay-layer.cjs` : ordre des fenêtres ; `media-files.cjs` : téléchargement ; `presets.cjs` : messages enregistrés |
| `public/` | `downloads.html` : site public ; `index.html` et `app.mjs` : contrôle privé ; `connection.mjs` : connexion ; `media-view.mjs` : rendu partagé entre aperçu et overlay |
| `shared/` | `protocol.mjs` : validation, normalisation, limites et réglages communs |
| `scripts/` | Compilation, packaging et installation Mac |
| `deploy/` | Configuration de ClamAV ; les fichiers Compose et Nginx sont à la racine |
| `tests/` | Tests unitaires et vérifications Electron ciblées avec profils temporaires |

## Chemin d’un message

1. Le client rejoint une room par WebSocket ; le serveur valide le mot de passe ou un jeton mémorisé.
2. Un import HTTP authentifié est écrit en flux sur disque. Le format, les quotas et, selon la configuration, l’antivirus sont vérifiés avant publication.
3. Un envoi référence les identifiants de médias de cette room. Le serveur valide le texte et les options, puis diffuse l’événement aux membres connectés.
4. Chaque participant applique pause, délai entre messages et déduplication. Le processus principal télécharge complètement les fichiers avant de demander le rendu.
5. Le renderer confirme que les médias sont prêts. L’overlay apparaît sans focus ; le texte et les images utilisent une durée, les médias temporels utilisent leur fin réelle. L’audio ajouté remplace le son d’une vidéo.
6. Fin de lecture, raccourci d’arrêt, pause ou remplacement détruisent le rendu et suppriment les copies temporaires. Les messages enregistrés restent dans le stockage personnel.

## HTTP et WebSocket

`GET /api/health` donne la version et les fonctionnalités ; `GET /api/rooms` liste les rooms publiques ; `GET /api/downloads` donne les installateurs disponibles. `POST /api/media` nécessite la session membre ; `GET/HEAD /media/:id` servent les médias temporaires par identifiant opaque, avec requêtes Range. `GET /releases/:filename` sert les fichiers autorisés par les manifestes. `/ws` transporte le protocole de room.

Le contrat exact des messages, erreurs et limites est défini dans `shared/protocol.mjs` et dans le traitement WebSocket de `server/index.mjs`. Modifier les deux extrémités ensemble et conserver la compatibilité avec les clients déjà installés. Les routes publiques ne doivent jamais exposer automatiquement tout `public/` : certains fichiers appartiennent au contrôle privé.

## Données et concurrence

Les rooms sont persistées séparément des médias éphémères. Les nouveaux mots de passe révoquent les sessions concernées. Les médias valides sont évincés du plus ancien au plus récent quand un quota est atteint et expirent au bout de dix minutes. Les générations de lecture et AbortController empêchent qu’un téléchargement ancien réaffiche un contenu après une interruption.

Le délai de l’overlay doit commencer à la confirmation du renderer, jamais à la réception réseau. Le maintien au premier plan ne doit jamais appeler `focus()` ; voir [PLEIN-ECRAN.md](PLEIN-ECRAN.md).
