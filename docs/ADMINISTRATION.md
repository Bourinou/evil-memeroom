# Administrer les rooms

Les rooms persistantes restent conservées tant que leur propriétaire ou l'administrateur ne les supprime pas. Retirer une room des favoris conserve son sens actuel : cette opération ne supprime jamais la room commune. L'interface est inchangée.

Le protocole accepte `room-delete` avec `{ "code": "CODE1234" }` depuis une session propriétaire. La suppression est persistée avant l'accusé de réception, révoque les sessions et efface les médias. Un emplacement parmi les 100 rooms est alors disponible, y compris après redémarrage. Les autres participants reçoivent `room-deleted` et sont déconnectés. Un ancien client reçoit une fermeture de connexion et peut conserver son favori devenu invalide.

## Administration locale facultative

Configurer un secret indépendant dans `MEMEROOM_ADMIN_TOKEN` sur le serveur et dans l'environnement de la commande. Sa valeur doit être 32 octets aléatoires encodés en base64url (43 caractères). Le générer avec un gestionnaire de secrets ou `crypto.randomBytes(32).toString('base64url')`. Ne pas le versionner, l'intégrer aux clients ou le mettre dans les arguments de commande.

L'administration est désactivée sans ce secret. Ses routes ne répondent qu'aux connexions directes de bouclage local sans en-tête `Origin`. Les jetons de membre et de propriétaire ne donnent aucun droit d'administration globale. Le CLI transmet le secret dans l'en-tête Authorization, sans l'afficher ni suivre de redirection.

Sur l'hôte du processus Node, avec les mêmes variables d'environnement :

```sh
npm run rooms -- list
npm run rooms -- delete ABCDEFGH
```

`MEMEROOM_ADMIN_URL` permet de préciser l'adresse locale du serveur ; sinon le CLI utilise `http://127.0.0.1:${PORT}`, avec 3210 par défaut. L'argument `delete CODE` est une demande explicite de suppression définitive : vérifier la liste avant de l'exécuter.

Dans Docker, injecter `MEMEROOM_ADMIN_TOKEN` dans le service `memeroom`, puis exécuter la commande **dans le conteneur** avec `docker compose exec memeroom npm run rooms -- list` (ajouter `-f compose.nginx.yaml` pour cette variante). Il n'est pas nécessaire d'exposer les routes administratives à travers le proxy.
