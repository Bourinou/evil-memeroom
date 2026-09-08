# Architecture

MemeRoom comporte trois parties : un serveur de rooms, une télécommande dans l’application Electron et une fenêtre d’overlay locale. Le site public sert les installateurs et leurs métadonnées. Une page web ordinaire ne peut pas afficher une fenêtre par-dessus les autres applications.

| Dossier | Responsabilité et points d’entrée |
| --- | --- |
| `server/` | `index.mjs` assemble HTTP (`http.mjs`), WebSocket (`websocket.mjs`), registre des rooms (`rooms.mjs`) et politique des requêtes ; stockage, accès et inspection restent dans leurs modules dédiés |
| `desktop/` | `main.cjs` assemble fenêtres et IPC ; `playback.cjs` pilote la lecture ; `media-cache.cjs` partage les téléchargements ; `preview-media.cjs` limite les URL privées aux aperçus actifs ; `presets.cjs` conserve les messages |
| `desktop/renderer/` | Télécommande : HTML, styles, composition et connexion ; chargée par la liste autorisée de `control-page.cjs` |
| `public/` | Site de téléchargement et icônes ; aucune télécommande |
| `shared/` | `protocol.mjs` réexporte les contrats spécialisés ; `render/` partage le rendu et son CSS ; `node/` contient les opérations disque communes, jamais importées par un renderer |
| `scripts/` | Compilation, packaging et installation Mac |
| `deploy/` | Configuration de ClamAV ; les fichiers Compose et Nginx sont à la racine |
| `tests/` | Tests unitaires et vérifications Electron ciblées avec profils temporaires |

## Chemin d’un message

1. Le client rejoint une room par WebSocket ; le serveur valide le mot de passe ou un jeton mémorisé.
2. Un import HTTP authentifié est écrit en flux sur disque. Le format, les quotas et, selon la configuration, l’antivirus sont vérifiés avant publication.
3. Un envoi référence les identifiants de médias de cette room. Le serveur valide le texte et les options, puis diffuse l’événement aux membres connectés.
4. Chaque participant applique pause, délai entre messages et déduplication. Le processus principal télécharge complètement les fichiers avant de demander le rendu.
5. Le renderer confirme que les médias sont prêts. L’overlay apparaît sans focus ; le texte et les images utilisent une durée, les médias temporels utilisent leur fin réelle. L’audio ajouté remplace le son d’une vidéo.
6. Fin de lecture, raccourci d’arrêt, pause ou remplacement détruisent le rendu et libèrent les références au cache. Les copies libres expirent après dix minutes ou sont évincées au besoin ; l’arrêt de l’app attend leur suppression. Les messages enregistrés restent dans le stockage personnel.

## HTTP et WebSocket

`GET /api/health` donne la version et les fonctionnalités ; `GET /api/rooms` liste les rooms publiques ; `GET /api/downloads` donne les installateurs disponibles. `POST /api/media` nécessite la session membre ; `GET/HEAD /media/:id` servent les médias temporaires par identifiant opaque, avec requêtes Range. `GET /releases/:filename` sert les fichiers autorisés par les manifestes. `/ws` transporte le protocole de room.

Le contrat des messages, erreurs et limites est défini dans `shared/protocol.mjs` et `server/websocket.mjs`. Modifier les deux extrémités ensemble et conserver la compatibilité avec les clients déjà installés. Les routes publiques utilisent une liste explicite ; les fichiers du renderer privé ne doivent jamais y être ajoutés.

## Données et concurrence

Les rooms sont persistées séparément des médias éphémères. Les nouveaux mots de passe révoquent les sessions concernées. Les médias valides sont évincés du plus ancien au plus récent quand un quota est atteint et expirent au bout de dix minutes. Les générations de lecture et AbortController empêchent qu’un téléchargement ancien réaffiche un contenu après une interruption.

Le délai de l’overlay doit commencer à la confirmation du renderer, jamais à la réception réseau. Le maintien au premier plan ne doit jamais appeler `focus()` ; voir [PLEIN-ECRAN.md](PLEIN-ECRAN.md).

Le cache desktop réserve au maximum 2 Gio, avec 64 entrées maximum. Une copie utilisée n’est pas évincée. Les téléchargements simultanés du même identifiant et serveur sont mutualisés ; annuler un lecteur ne coupe pas les autres. Un aperçu lit une URL opaque de la session privée ; aucun chemin fourni par le renderer ne devient un accès disque. Le transport local suit l’API [protocol.handle d’Electron](https://www.electronjs.org/docs/latest/api/protocol/).

Les sauvegardes utilisateur sont atomiques et regroupent les changements rapprochés (80 ms). Chaque promesse n’est résolue qu’après persistance. L’arrêt attend les écritures, les transferts et la suppression du cache. Les temporaires portent un propriétaire ; seules les instances identifiées comme terminées sont récupérées au prochain démarrage.
