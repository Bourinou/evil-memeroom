# MemeRoom 0.6.0

MemeRoom partage du texte, des images, des vidéos et des sons entre les membres d’une room. L’application de bureau affiche un overlay transparent qui laisse passer les clics et le clavier. Le site propose les téléchargements ; la télécommande reste intégrée à l’application.

## Nouveautés de la version 0.6.0

- Maintien de l’overlay au-dessus des fenêtres plein écran sans bordure, sans activation, et adaptation aux changements d’écran. Voir les [limites du plein écran exclusif](docs/PLEIN-ECRAN.md).
- Dépôt public, contributions ouvertes et licence CC BY-NC-SA 4.0 avec attribution à **Rose Roubaud**, autrice originale.
- Exclusion des données locales via `.gitignore`.
- Liens vers les sources et la licence depuis la page de téléchargement.

## Documentation

- [Contribuer](CONTRIBUTING.md) et [crédits](AUTHORS.md)
- [Architecture et responsabilités des dossiers](docs/ARCHITECTURE.md)
- [Audit de structure, maintenance et ouverture aux contributions — septembre 2026](docs/AUDIT-2026-09-08.md)
- [Développement, interface et tests](docs/DEVELOPPEMENT.md)
- [Sécurité et signalement privé](SECURITY.md)
- [Installer le serveur derrière Nginx](DEPLOYER.md)

Le projet est distribué sous [CC BY-NC-SA 4.0](LICENSE) : attribution, usage non commercial et partage des adaptations sous la même licence. Les dépendances gardent leurs propres licences ; les médias des utilisateurs ne sont pas inclus.

## Fonctionnalités

- Réglages avec un bouton Fermer visible, conservé en haut pendant le défilement. Un clic à l’extérieur ferme les fenêtres.
- Téléchargement intégral avant affichage. Le compteur des images commence après chargement ; vidéos et audios se terminent à leur fin réelle. Avec une piste audio supplémentaire, le son original de la vidéo est coupé et l’ensemble reste affiché jusqu’à la fin du plus long média.
- 1 Go maximum par fichier (1 073 741 824 octets). Les fichiers sont reçus et servis en flux depuis le disque, sans les conserver intégralement en mémoire du serveur.
- Fichiers supprimés du serveur 10 minutes après validation, même si des participants restent connectés. Une lecture déjà téléchargée continue normalement.
- Texte et pseudo blancs avec un contour noir, dans un style mème. Largeur maximale par défaut : 60 % de l’écran. Les tailles déjà choisies restent conservées.
- Chaque participant reçoit ses propres messages ; l’ancien réglage permettant de les masquer est supprimé, même pour les anciennes préférences.
- Messages enregistrés avec un nom dans l’onglet Enregistrés : recherche, chargement dans le compositeur, renommage et suppression. Leurs fichiers sont conservés localement et réimportés dans la room lors du chargement.
- Protection des mots de passe par adresse et par room, conservée pendant les reconnexions. Analyse ClamAV obligatoire et inspection FFprobe dans les déploiements Docker fournis.
- Archives Mac avec un assistant d’installation qui recrée une signature locale. Il reste nécessaire de valider cet assistant sur un Mac ; il ne constitue pas une signature Apple Developer ID.

## Utilisation

1. Installer l’application depuis https://memeroom.tonamielarose.fr/telecharger.
2. Ajouter une room en indiquant son pseudo et le serveur commun, puis créer une room ou rejoindre une room existante.
3. Dans Composer, ajouter du texte, une image/vidéo et éventuellement un audio. Les sous-titres SRT et fichiers temporaires de la room sont dans Options.
4. Cliquer sur Envoyer pour diffuser, Aperçu pour voir le résultat, ou Enregistrer pour conserver ce message avec ses fichiers sur cet appareil.
5. Dans Enregistrés, Charger prépare un message dans la room actuelle. Il peut être modifié avant de cliquer sur Envoyer.

Une image ou un texte sans audio reste affiché de 2 à 15 secondes, après chargement. Vidéos et audios n’ont pas cette limite de durée. Le raccourci d’arrêt, la pause ou un nouvel envoi accepté peuvent interrompre le contenu. Un lecteur bloqué pendant 30 secondes est arrêté ; le téléchargement a un délai distinct de 30 minutes maximum.

**Ctrl + Maj + F9** arrête le contenu actuel. Ce raccourci est modifiable dans Réglages. **Ctrl + Maj + F8** met la réception en pause (Cmd + Maj + F8 sur Mac). Fermer la fenêtre conserve la réception ; utiliser Quitter MemeRoom dans la zone de notification pour arrêter l’application.

## Rooms et données

Les rooms sont privées par défaut et peuvent être publiques, avec ou sans mot de passe. Le créateur modifie les accès depuis Accès de la room. Changer le mot de passe révoque les anciennes connexions et vide les fichiers temporaires. Les mots de passe sont hachés avec scrypt ; seuls des jetons d’accès sont mémorisés chez les participants.

Les rooms et la dernière connexion sont enregistrées automatiquement. Retirer une room de la liste personnelle ne supprime pas la room commune. Le serveur doit rester accessible pour communiquer.

| Données | Stockage |
| --- | --- |
| Rooms du serveur | `data/rooms.json`, ou volume Docker `memeroom_data` |
| Liste personnelle et accès | Dossier utilisateur de l’app, `saved-rooms.json` |
| Réglages | Dossier utilisateur de l’app, `preferences.json` |
| Messages enregistrés et fichiers | Dossier utilisateur de l’app, `saved-messages/` ; jusqu’à suppression explicite |
| Fichiers de la room | Disque temporaire du serveur ; expiration après 10 minutes ou éviction si plein |
| Cache de lecture | Disque temporaire du participant, partagé par aperçu et overlay ; 2 Gio maximum, expiration après 10 min, nettoyage à l’arrêt |

Une bibliothèque conserve au maximum 30 fichiers et 2 Go par room ; 8 Go au total. Un import valide peut supprimer les fichiers les plus anciens pour libérer de la place. Les fichiers invalides ou refusés par l’antivirus ne sont pas publiés et ne déclenchent pas d’éviction. Il peut y avoir quatre imports simultanés au maximum sur le serveur, un par participant.

## Sécurité

Seuls PNG, JPEG, GIF, WebP, MP4, WebM, MP3, WAV et OGG sont autorisés d’après leurs octets, jamais d’après leur nom. HTML, SVG et exécutables ne sont pas servis comme médias autorisés. Les textes et pseudos sont rendus avec `textContent` ; les fenêtres Electron n’ont pas accès à Node.js et utilisent un sandbox et des politiques CSP.

Dans les fichiers Compose fournis, chaque import passe par ClamAV et FFprobe avant publication. Une menace, une limite d’analyse dépassée ou un antivirus indisponible bloque le fichier. La base de signatures est mise à jour par FreshClam. Cela réduit le risque sans garantir l’absence de toute menace inconnue. ClamAV reste sur le réseau Docker privé, sans port exposé sur Internet.

Le site, les rooms et les messages texte démarrent sans attendre le chargement de ClamAV. Seuls les imports de fichiers nécessitent que l’antivirus soit prêt. Sa base est conservée dans le volume `clamav_data` pour les prochains démarrages.

**Le serveur lancé directement avec Node et le serveur intégré à l’app vérifient le format, mais n’embarquent pas d’antivirus.** Pour y imposer ClamAV, configurer `CLAMAV_HOST`, `CLAMAV_PORT` et `MEMEROOM_SCAN_REQUIRED=1`. `MEMEROOM_FFPROBE` peut désigner un exécutable FFprobe. Utiliser le serveur Docker commun pour bénéficier de la configuration complète prête à déployer.

Cinq tentatives de mot de passe par adresse et par room sont autorisées sur cinq minutes, avec une limite globale de vingt par adresse. Les connexions avec un jeton valide restent possibles. Le serveur conserve aussi une limite globale par room et limite le nombre de calculs scrypt simultanés. Derrière Nginx, la configuration fournie remplace l’en-tête d’adresse client ; `MEMEROOM_TRUST_PROXY=1` doit uniquement être activé derrière un proxy de confiance.

## Installation et compilation

- Windows : `releases/MemeRoom-Setup-0.6.0.exe`. Le setup propose le dossier d’installation. Il n’est pas signé avec un certificat éditeur ; les avertissements Windows restent possibles.
- Linux : `releases/MemeRoom-0.6.0-Linux-x86_64.AppImage`. Autoriser l’exécution, puis lancer le fichier. L’overlay utilise X11/XWayland. Sur Arch, les dépendances usuelles sont `fuse2 gtk3 nss alsa-lib xorg-xwayland`. Sans FUSE, utiliser `--appimage-extract-and-run`.
- Mac : choisir le ZIP Apple Silicon ou Intel, le décompresser, puis ouvrir `Installer MemeRoom.command` à côté de `MemeRoom.app`. Voir les limites et la procédure de signature Apple dans [DEPLOYER.md](DEPLOYER.md).

Prérequis de développement : Node.js 24 LTS (voir `.nvmrc`), et un bureau compatible Electron.

```powershell
npm ci
npm start
npm run server
npm run dist -- --config.directories.output=release/build-0.6.0
wsl -e bash scripts/build-linux.sh --skip-checks
wsl -e bash scripts/build-mac.sh
npm run stage:releases
npm run pack:server
```

Les vérifications de cette version sont ciblées : serveur, mots de passe, nettoyage, messages conservés après expiration, protocole antivirus avec un service simulé, réglages et téléchargement lent dans Electron Windows. Le moteur ClamAV Docker et l’installation Mac ne sont pas validés sur cette machine. Les suites longues de lecture ne sont pas systématiquement relancées.

Le déploiement complet, incluant les nouveaux réglages Nginx et ClamAV, est expliqué dans [DEPLOYER.md](DEPLOYER.md). Les mises à jour Windows/Linux sont recherchées au démarrage sur le serveur officiel. Les mises à jour Mac restent manuelles. Les rooms, préférences et messages enregistrés sont conservés.
