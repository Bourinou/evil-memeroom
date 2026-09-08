# Développement et vérifications

Installer Node.js 24 LTS et Git. À la racine du clone :

```bash
npm ci
npm start
```

`npm start` ouvre l’app. Le serveur local démarre lors de la création, de la consultation ou de la reconnexion à une room de ce PC ; rejoindre un serveur distant ne l’ouvre pas. `npm run server` lance uniquement le serveur et la page de téléchargement sur le port 3210. Les installateurs n’apparaissent qu’après préparation de `releases/` ; ce dossier n’est pas versionné. Copier `.env.example` vers `.env` pour Docker ; un lancement Node direct lit les variables du processus (ou utiliser `node --env-file=.env server/index.mjs`). Voir [CONFIGURATION.md](CONFIGURATION.md).

## Modifier l’interface

Le site de téléchargement est dans `public/downloads.html`, `downloads.css` et `downloads.mjs`. La télécommande utilise `desktop/renderer/index.html`, `app.mjs` et `styles.css` ; elle est servie par la session privée Electron. Ajouter un module privé nécessite de mettre à jour la liste autorisée de `desktop/control-page.cjs`. Ne pas créer de route HTTP publique pour contourner cette liste.

Le rendu des réactions est partagé dans `shared/render/media-view.mjs` et `reaction.css`. Le processus principal valide les fichiers et les messages IPC. Garder les pseudos et textes dans `textContent`, sans insertion de HTML envoyé par un participant.

## Vérifier selon la modification

| Commande | Usage |
| --- | --- |
| `npm run check` | Syntaxe de tout le JavaScript du projet |
| `npm run lint` | Erreurs statiques et variables inutilisées |
| `npm run format:check` | Formatage reproductible ; corriger avec `npm run format` |
| `npm test` | Protocole, accès, stockage et mises à jour |
| `node tests/updates-050.e2e.mjs` | Réglages, enregistrement local, téléchargement lent et durée |
| `npm run test:fullscreen` | Windows : ordre natif des fenêtres plein écran, styles de passage des clics et focus Electron |
| `node tests/shortcut.e2e.mjs` | Arrêt du contenu par raccourci configurable |
| `npm run test:desktop` | Suite longue de lecture : à réserver aux changements qui la nécessitent |
| `npm run test:focused` | Réglages, téléchargement lent et raccourcis |

Les tests Electron créent des fenêtres locales et des profils isolés dans `.test-artifacts/`. Ils nécessitent un bureau interactif ; les contrôles sans interface du CI ne les remplacent pas. Les tests antivirus simulent le protocole ClamAV ; valider le moteur réel dans Docker avant un changement de sa configuration.

## Compiler

```powershell
npm run dist -- --config.directories.output=release/build-0.6.0
wsl -e bash scripts/build-linux.sh --skip-checks
wsl -e bash scripts/build-mac.sh
npm run stage:releases
npm run pack:server
```

Exécuter ces commandes à la racine du projet. Sur Linux, appeler directement `bash scripts/build-linux.sh`. Les scripts WSL utilisent un dossier temporaire séparé pour éviter de mélanger les dépendances Windows et Linux. Le packaging Mac préserve les liens symboliques et les permissions ; ne pas remplacer ce ZIP par un outil qui les aplatit.

Modifier la version avec `npm version <version> --no-git-tag-version` avant une nouvelle publication : la réponse de santé lit maintenant `package.json`. Une version publiée est immuable. Ne pas commit les résultats de compilation.

Le serveur se prépare indépendamment avec `npm run pack:server`. Ajouter `-- --with-releases` pour inclure les téléchargements déjà préparés. Pour préparer seulement Windows : `npm run stage:releases -- release/build-0.6.0 - -` ; un tiret laisse les autres plateformes intactes. Les scripts temporaires de compilation nettoient leur dossier ; utiliser `MEMEROOM_KEEP_BUILD=1` uniquement pour inspecter un échec.

## Travailler en TDD

Reproduire le problème avec le plus petit test observable, constater son échec, corriger puis simplifier en gardant le test vert. Pour une extraction sans changement de comportement, conserver les tests de caractérisation et les exécuter avant/après. Les suites bureau peuvent être ciblées par `node tests/desktop.e2e.mjs appearance`, `playback` ou `rooms` ; ne pas modifier les fichiers pendant leur exécution.

La CI vérifie syntaxe, lint, format et tests Node sur Linux/Windows ; un job Windows exécute les scénarios Electron. Les tests ClamAV utilisent un service simulé. Ni une CI verte ni les tests Windows ne remplacent une installation réelle sur Mac/Linux et le contrôle du moteur antivirus réel.

## Où intervenir

| Changement | Point d’entrée | Vérification pertinente |
| --- | --- | --- |
| Validation d’un message | `shared/reactions.mjs`, `settings.mjs`, `subtitles.mjs` | `tests/protocol.test.mjs` |
| Accès ou persistance d’une room | `server/websocket.mjs`, `rooms.mjs`, `room-store.mjs` | Tests room-access et room-lifecycle, puis scénario rooms |
| Connexion et reconnexion | `desktop/renderer/connection.mjs`, `app.mjs`, `desktop/local-host.cjs` | Tests connection/local-host, puis rooms |
| Affichage ou durée d’une réaction | `shared/render/`, `desktop/playback.cjs` | Tests playback, puis appearance/playback |
| Téléchargement et cache | `desktop/media-files.cjs`, `media-cache.cjs`, `preview-media.cjs` | Tests cache/preview, puis playback et téléchargement lent |
| Raccourci ou fenêtre | `desktop/renderer/shortcut-settings.mjs`, `main.cjs`, `overlay-layer.cjs` | Raccourcis et contrôle natif fullscreen |
| Livrable | `scripts/server-bundle.mjs`, `stage-releases.mjs`, `distribution-config.cjs` | Tests bundle/releases/config puis paquet réel |

Les formats persistants restent compatibles avec les profils existants : aucun nettoyage des favoris ou migration destructive n’est nécessaire. Le [journal de refonte](REFONTE.md) consigne les cycles et les validations. Pour distribuer une adaptation, suivre [FORKS.md](FORKS.md).
