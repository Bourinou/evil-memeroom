# Distribuer une adaptation

La licence reste **CC BY-NC-SA 4.0**, avec attribution à Rose Roubaud et indication des modifications. Les contributions sont ouvertes sous ces conditions. La restriction non commerciale est conservée par choix du projet ; ce n’est pas une licence open source au sens OSI.

Les commandes `dist`, `dist:linux` et `dist:mac` conservent les paramètres officiels. Un fork utilise `dist:fork` avec sa propre identité :

```powershell
$env:MEMEROOM_FORK_APP_ID = 'org.example.reactions'
$env:MEMEROOM_FORK_NAME = 'example-reactions'
$env:MEMEROOM_FORK_PRODUCT = 'Example Reactions'
npm run dist:fork -- --win nsis --x64
```

Sous bash, exporter les trois mêmes variables. `--linux AppImage --x64` ou `--mac zip --arm64 --x64` sélectionnent les autres plateformes sur un environnement de compilation adapté. Les paramètres passent par `scripts/fork-config.cjs` ; `scripts/distribution-config.cjs` les valide et conserve les options de sécurité et les fichiers du build officiel. Les artefacts sont écrits dans `release/fork/`.

Cette configuration change l’identifiant d’application, le nom du produit, le paquet, les raccourcis de lancement, les noms de fichiers et le profil utilisateur par défaut. Elle évite de partager involontairement les favoris et préférences de l’app officielle. Ne pas définir `MEMEROOM_USER_DATA` vers un profil officiel pour distribuer un fork.

Les mises à jour sont désactivées par défaut dans le paquet du fork. Pour les activer, définir explicitement `MEMEROOM_FORK_UPDATE_URL=https://votre-domaine.example/releases/` avant compilation et publier vos propres manifestes et binaires vérifiés. HTTPS est exigé ; le flux officiel MemeRoom est refusé. Le code d’installation vérifiée au démarrage reste commun. Les ZIP Mac non signés gardent les mises à jour manuelles.

Les scripts `stage:releases`, l’assistant Mac et le site public décrivent la distribution officielle : adapter leurs noms, liens et métadonnées avant de les réutiliser pour une autre marque. Changer aussi le nom dans l’interface et les icônes si votre adaptation le demande. Une configuration de build ne constitue pas une signature éditeur ; certificats et notarisation restent propres à chaque distributeur.
