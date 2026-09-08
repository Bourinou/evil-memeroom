# Configuration

Les valeurs ci-dessous décrivent les valeurs par défaut du code. Docker lit `.env` pour la substitution Compose. Node/Electron lisent les variables du processus ; `node --env-file=.env server/index.mjs` charge explicitement un fichier pour le serveur. Ne jamais versionner les secrets ni un profil réel.

| Variable | Valeur / rôle |
| --- | --- |
| `HOST`, `PORT` | Serveur autonome : `0.0.0.0`, `3210` |
| `MEMEROOM_PORT` | Hébergement desktop : `3210` ; `0` alloue un port libre ; un port déjà occupé déclenche aussi cette allocation |
| `MEMEROOM_DATA_DIR` | Serveur autonome : `data/` ; dans Docker : `/data` ; le desktop utilise son profil personnel |
| `MEMEROOM_RELEASES_DIR` | Téléchargements : `releases/` ; Docker : montage `/releases` en lecture seule |
| `ALLOWED_ORIGINS` | Origines supplémentaires séparées par des virgules ; liste vide par défaut |
| `MEMEROOM_TRUST_PROXY` | `1` uniquement derrière le proxy de confiance ; Compose l’active derrière Nginx/Caddy |
| `MEMEROOM_ADMIN_TOKEN` | Vide : administration désactivée. Secret indépendant de 32 octets en base64url ; voir [ADMINISTRATION.md](ADMINISTRATION.md) |
| `MEMEROOM_ADMIN_URL` | CLI locale : `http://127.0.0.1:3210`, ou port défini par `PORT` |
| `MEMEROOM_TEMP_DIR` | Racine des dossiers temporaires serveur/lecture ; dossier temporaire système par défaut |
| `CLAMAV_HOST`, `CLAMAV_PORT` | Hôte absent par défaut en Node/desktop, port `3310` ; Compose utilise le service privé `clamav` |
| `MEMEROOM_SCAN_REQUIRED` | `1` refuse un import si l’antivirus est indisponible ; activé dans Compose |
| `MEMEROOM_FFPROBE` | Chemin optionnel de FFprobe ; `/usr/bin/ffprobe` dans Compose |
| `MEMEROOM_USER_DATA` | Profil desktop isolé pour tests ; sinon chemin habituel Electron |
| `MEMEROOM_ALLOW_MULTIPLE` | `1` pour ouvrir plusieurs profils de test ; verrou d’instance conservé par défaut |
| `MEMEROOM_DISABLE_UPDATES` | `1` pour les tests ou un lancement sans recherche de mise à jour |
| `MEMEROOM_DOMAIN`, `ACME_EMAIL` | Configuration du domaine et des certificats Caddy |
| `MEMEROOM_HTTP_PORT` | Port local du Compose Nginx : `3210` |
| `MEMEROOM_KEEP_BUILD` | `1` conserve le dossier temporaire de compilation Linux/Mac pour diagnostic |

Les variables de fork sont détaillées dans [FORKS.md](FORKS.md). Les limites métier restent centralisées dans `shared/limits.mjs` : 1 Gio par fichier, 2 Gio et 30 médias par room, 8 Gio au total, expiration serveur à 10 min, quatre imports simultanés au maximum. Elles sont conservées pour compatibilité ; les diminuer demande une décision produit et une mise à jour coordonnée du contrat et des messages de l’interface.

Le cache desktop est borné séparément à 2 Gio/64 entrées. Une entrée utilisée n’est pas évincée ; un téléchargement impossible faute de place doit être retenté après la fin d’une lecture. Les copies inutilisées sont évincées ou expirent, puis le dossier est supprimé à l’arrêt. Les dossiers anciens sans marqueur de propriétaire ne sont pas effacés automatiquement.
