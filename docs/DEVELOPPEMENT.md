# Développement et vérifications

Installer Node.js 24 LTS et Git. À la racine du clone :

```bash
npm ci
npm start
```

`npm start` ouvre l’app et son serveur local. `npm run server` lance uniquement le serveur et la page de téléchargement sur le port 3210. Les installateurs n’apparaissent qu’après préparation de `releases/` ; ce dossier n’est pas versionné. Copier `.env.example` vers `.env` pour Docker uniquement ; un lancement Node direct lit les variables d’environnement du processus.

## Modifier l’interface

Le site de téléchargement est dans `public/downloads.html`, `downloads.css` et `downloads.mjs`. La télécommande utilise `public/index.html`, `app.mjs` et `styles.css` ; elle est servie par la session privée Electron. Ajouter un module privé nécessite de mettre à jour la liste autorisée de `desktop/control-page.cjs`. Ne pas créer de route HTTP publique pour contourner cette liste.

Le rendu des réactions est partagé dans `public/media-view.mjs`. Le processus principal valide les fichiers et les messages IPC. Garder les pseudos et textes dans `textContent`, sans insertion de HTML envoyé par un participant.

## Vérifier selon la modification

| Commande | Usage |
| --- | --- |
| `npm run check` | Syntaxe de tout le JavaScript du projet |
| `npm test` | Protocole, accès, stockage et mises à jour |
| `node tests/updates-050.e2e.mjs` | Réglages, enregistrement local, téléchargement lent et durée |
| `npm run test:fullscreen` | Windows : ordre natif des fenêtres plein écran, styles de passage des clics et focus Electron |
| `node tests/shortcut.e2e.mjs` | Arrêt du contenu par raccourci configurable |
| `npm run test:desktop` | Suite longue de lecture : à réserver aux changements qui la nécessitent |

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

Modifier la version dans `package.json`, `package-lock.json` et la réponse de santé du serveur avant une nouvelle publication. Une version publiée est immuable. Ne pas commit les résultats de compilation.
