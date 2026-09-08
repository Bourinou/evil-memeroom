# Déployer MemeRoom 0.6.0

Cette version modifie le serveur, la configuration Nginx et l’application. Remplacer seulement `releases/` ne suffit pas. Aucun déploiement distant n’est effectué automatiquement.

## Serveur existant avec Nginx sur l’hôte

1. Décompresser `release/MemeRoom-0.6.0-Serveur.zip`. Transférer son contenu dans **le même dossier de déploiement** que la version actuelle, en conservant `.env` et les volumes. Garder provisoirement les anciens téléchargements dans `releases/` jusqu’au démarrage du nouveau serveur. Copier notamment `server/`, `shared/`, `public/`, le nouveau dossier `deploy/`, les fichiers Compose, `Dockerfile`, `package.json` et `package-lock.json`.
2. Mettre à jour les blocs `location /` et `location = /ws` du site Nginx à partir de `nginx-location.conf.example`. Garder le domaine et les certificats HTTPS existants. Les changements nécessaires sont :

   ```nginx
   client_max_body_size 1024m;
   proxy_request_buffering off;
   proxy_send_timeout 1800s;
   proxy_read_timeout 1800s;
   proxy_set_header X-Forwarded-For $remote_addr;
   ```

   Utiliser le fichier d’exemple complet pour conserver les en-têtes WebSocket. Les deux blocs doivent remplacer les en-têtes d’adresse client, sans accepter une adresse envoyée arbitrairement par le client.
3. Vérifier et recharger Nginx, puis reconstruire les services :

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   docker compose -f compose.nginx.yaml up -d --build
   docker compose -f compose.nginx.yaml ps
   curl -sS http://127.0.0.1:3210/api/health
   ```

   Exécuter ces commandes **sur le serveur Linux**. Dans PowerShell Windows, utiliser `curl.exe` pour interroger l’adresse HTTPS ; `127.0.0.1` désignerait alors le PC Windows.
4. MemeRoom démarre dès que le conteneur ClamAV est lancé, sans attendre que son moteur soit prêt. Le site, les rooms et les messages texte sont utilisables pendant son initialisation. Les imports de fichiers restent refusés tant que l’analyse antivirus ne peut pas réussir. Au premier démarrage, la base de signatures doit être téléchargée puis chargée en mémoire ; les signatures restent ensuite dans le volume `clamav_data`. Pour consulter sa progression :

   ```bash
   docker compose -f compose.nginx.yaml logs --tail=50 clamav
   ```

5. La réponse `/api/health` doit annoncer `0.6.0`, `largeUploads: true`, `mediaExpiry: true` et `antivirusRequired: true`. Le dernier champ indique la configuration obligatoire de l’analyse, pas une garantie de disponibilité permanente du moteur.
6. Copier les nouveaux exécutables, AppImage et ZIP Mac de `releases/`, puis publier **en dernier** `latest.yml`, `latest-linux.yml` et `downloads.json`. Transférer sous un nom temporaire puis renommer évite les téléchargements incomplets. Garder les anciennes versions. Ouvrir https://memeroom.tonamielarose.fr/telecharger.

Le fichier `compose.nginx.yaml` publie uniquement `127.0.0.1:3210`. Ne pas lancer `compose.yaml` sur ce serveur Nginx : cette autre configuration démarre Caddy sur 80/443. Si le port 3210 est occupé, définir `MEMEROOM_HTTP_PORT` dans `.env` et adapter les deux `proxy_pass`.

### Si le démarrage reste bloqué sur ClamAV

Dans une première archive 0.5.0, MemeRoom attendait `condition: service_healthy`. Le fichier Compose corrigé utilise `condition: service_started`. Remplacer uniquement `compose.nginx.yaml`, puis exécuter `docker compose -f compose.nginx.yaml up -d memeroom` dans le dossier existant. Aucune reconstruction de l’application n’est nécessaire. Le conteneur antivirus déjà en cours de chargement conserve sa configuration et ses données.

Si ClamAV ne devient jamais sain, consulter ses logs et `docker stats --no-stream`. Un téléchargement initial, une limite imposée par le serveur de signatures, un manque de mémoire ou une erreur de configuration nécessitent des corrections différentes. Ne pas supprimer le volume `clamav_data` : cela imposerait de télécharger à nouveau sa base. Référence : [démarrage et mémoire de ClamAV Docker](https://docs.clamav.net/manual/Installing/Docker.html).

## Ressources et protection antivirus

Les fichiers de 1 Go sont reçus sur disque, pas stockés dans un Buffer de 1 Go en mémoire Node. Le service MemeRoom garde une limite de 768 Mo de RAM. ClamAV dispose d’un service distinct limité à 4 Go : prévoir suffisamment de RAM pour les deux services et le système, ainsi qu’environ 20 Go libres pour les bibliothèques temporaires, les imports concurrents, les copies d’analyse et les bases antivirus.

`deploy/clamd.conf` autorise des fichiers et flux de 1 Go, limite la durée d’analyse et traite un dépassement des limites d’analyse comme un refus. Le conteneur ClamAV ne publie aucun port sur l’hôte. FreshClam maintient la base de signatures dans `clamav_data`. Une panne ou une analyse incomplète renvoie une erreur d’import, sans partager le fichier. FFprobe vérifie les pistes et rejette les médias illisibles ou de dimensions excessives.

Les fichiers publiés expirent après 10 minutes, avec une purge périodique de 30 secondes au maximum. Ils cessent immédiatement d’être téléchargeables à l’échéance. Les plus anciens imports peuvent aussi être supprimés si une room atteint 30 fichiers ou 2 Go, ou si le serveur atteint 8 Go. Un fichier déjà entièrement téléchargé chez un participant continue à jouer après sa suppression serveur. Les fichiers en cours d’import ne sont pas publiés ; le délai maximal de transfert est 30 minutes.

L’analyse antivirus réduit les risques connus ; elle ne garantit pas la détection de toutes les menaces. Maintenir l’image ClamAV et les dépendances à jour. Référence : [ressources et fonctionnement de ClamAV Docker](https://docs.clamav.net/manual/Installing/Docker.html).

Les serveurs lancés directement avec Node ou intégrés à l’application n’embarquent pas ClamAV : ils vérifient les signatures de format. Pour y imposer l’antivirus, fournir `CLAMAV_HOST`, éventuellement `CLAMAV_PORT`, et `MEMEROOM_SCAN_REQUIRED=1`. Pour l’inspection du conteneur, définir `MEMEROOM_FFPROBE` avec le chemin d’un FFprobe local. Ne pas exposer le port ClamAV sur Internet.

`MEMEROOM_TRUST_PROXY=1` est réservé à un serveur uniquement joignable derrière le proxy. Nginx écrase `X-Forwarded-For` avec l’adresse réelle. La limite est de cinq essais de mot de passe par adresse et par room sur cinq minutes, et vingt par adresse sur l’ensemble des rooms. Reconnecter le client ne remet pas le compteur à zéro ; un jeton d’accès valide reste utilisable.

## Installation Mac et erreur « application endommagée »

Les builds communautaires peuvent être produites localement sur macOS ou depuis Linux/WSL. Les ZIP conservent les liens symboliques et les permissions des frameworks. Elles ne disposent pas de signature Developer ID ni de notarisation Apple ; une simple copie de l’app peut donc être bloquée par macOS.

Décompresser le bon ZIP (Apple Silicon ou Intel), puis lancer **Installer MemeRoom.command**, placé à côté de l’application. L’assistant :

- demande un accord explicite et vérifie l’identité du bundle ;
- copie l’app dans un dossier temporaire de `~/Applications` ;
- recrée une signature locale ad hoc avec les autorisations JIT et la vérifie ;
- retire l’attribut de quarantaine uniquement de cette copie de MemeRoom ;
- conserve une éventuelle ancienne installation dans un dossier de sauvegarde, puis ouvre la nouvelle app.

Il ne désactive pas Gatekeeper globalement et ne requiert pas de mot de passe administrateur. L’utiliser uniquement avec une archive provenant de votre serveur de confiance. Si macOS bloque le script, l’option **Ouvrir quand même** peut être proposée dans Réglages Système → Confidentialité et sécurité. Les politiques d’un Mac administré peuvent empêcher cette exception. En cas d’échec, conserver le message du Terminal pour diagnostic.

**Cet assistant n’a pas été exécuté sur un Mac ici. Il constitue une solution locale à valider, pas une distribution Apple certifiée.** Les mises à jour Mac restent manuelles. Relancer l’assistant avec la nouvelle version conserve les données utilisateur.

### Distribution signée et notariée

Pour une installation sans cette exception locale, disposer d’un Mac, d’un certificat **Developer ID Application** et des accès de notarisation. Ne pas mettre les certificats, mots de passe ou clés Apple dans les sources ou cette conversation. Configurer les variables d’environnement d’electron-builder sur la machine de compilation ou dans son coffre de secrets : certificat via `CSC_LINK`/`CSC_KEY_PASSWORD` (ou identité du trousseau `CSC_NAME`), puis `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` ou un profil de trousseau `APPLE_KEYCHAIN_PROFILE`.

```bash
bash scripts/build-mac.sh --signed
```

Le script refuse la signature sur un autre système, exige une signature, puis vérifie les deux bundles avec `codesign`, `spctl` et `stapler` avant de copier les archives. La préparation est dans `scripts/mac-release.cjs`. Après publication d’une version, ne jamais remplacer ses fichiers par une autre compilation : incrémenter la version pour distribuer les futures archives signées. Adapter alors le texte d’installation de la page de téléchargement pour indiquer le déplacement direct de l’app.

Références : [signature et notarisation Electron](https://www.electronjs.org/docs/latest/tutorial/code-signing), [ouvrir une application sur Mac](https://support.apple.com/en-lamr/102445).

## Builds, mises à jour et données conservées

```powershell
npm run dist -- --config.directories.output=release/build-0.6.0
wsl -e bash scripts/build-linux.sh --skip-checks
wsl -e bash scripts/build-mac.sh
npm run stage:releases
npm run pack:server -- --with-releases
```

Les scripts vérifient tailles et empreintes avant de préparer `releases/`. `npm run pack:server` produit le serveur seul, sans dépendre d’une compilation desktop. L’option `--with-releases` y ajoute les téléchargements déjà préparés, même si une seule plateforme est disponible. Pour préparer uniquement Windows, utiliser `npm run stage:releases -- release/build-0.6.0 - -` ; les autres plateformes sont conservées. Les mises à jour Windows/Linux de la distribution officielle restent sur le serveur officiel. Pour une adaptation, voir [FORKS.md](docs/FORKS.md). SmartScreen peut encore avertir : le setup Windows ne possède pas de certificat éditeur.

Les rooms serveur restent dans `memeroom_data`. Les réglages et messages enregistrés restent dans le dossier utilisateur des applications, notamment `saved-messages/`. Le contenu de ce dossier est personnel et peut occuper de l’espace jusqu’à suppression explicite. Aucun fichier temporaire serveur n’est destiné à être sauvegardé.

Les validations effectuées pour cette version couvrent le serveur et la lecture sous Windows, avec des tests ciblés de l’expiration, du stockage local, de la limitation des mots de passe et du protocole antivirus simulé. Docker/ClamAV et l’assistant Mac nécessitent une validation dans leurs environnements réels.
