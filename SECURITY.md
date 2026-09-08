# Sécurité

## Signaler une vulnérabilité

Utiliser [Report a vulnerability](https://github.com/Rose-Roubaud/memeroom/security/advisories/new) pour contacter les responsables en privé. Fournir une reproduction minimale avec des données fictives et la version concernée. Ne pas publier d’issue contenant des accès, médias privés ou une procédure exploitable contre le serveur public. Si le signalement privé n’est pas disponible, demander un canal privé dans une issue sans détail de la faille.

## Données à protéger

Les mots de passe, jetons de rooms, médias envoyés, messages enregistrés, logs réels, fichiers `.env`, clés de signature et accès serveur ne doivent jamais apparaître dans Git, une capture ou un journal CI. Le serveur conserve les rooms dans un volume séparé ; voir [README.md](README.md). Ne pas mettre ce volume dans une archive de sources.

`.gitignore` exclut les fichiers locaux non suivis. Relire les changements avant publication : il ne protège pas les fichiers déjà suivis ou ajoutés de force.

Un secret déjà publié doit être révoqué immédiatement, puis retiré de l’historique et des artefacts ; une suppression dans un nouveau commit ne suffit pas.

## Frontières de confiance

- L’interface publique propose les téléchargements. La télécommande est chargée uniquement dans l’application de bureau.
- Les fenêtres Electron sont isolées et sandboxées ; les appels IPC vérifient l’expéditeur. Ne pas activer Node.js dans les renderers.
- Les formats de médias sont reconnus par leurs octets, puis analysés par ClamAV et FFprobe dans Docker. Une analyse obligatoire indisponible bloque l’import. Aucun antivirus ne garantit l’absence de menaces inconnues.
- Le serveur Node local n’embarque pas d’antivirus ; ne pas confondre contrôle de format et analyse antivirus.
- Les mots de passe utilisent scrypt avec sel et limitation des tentatives. Les jetons restent des accès sensibles ; les rooms ne constituent pas un stockage chiffré de bout en bout.
- HTTPS protège le transport vers le serveur. Le proxy doit écraser les en-têtes d’adresse client et être le seul point d’entrée lorsque `MEMEROOM_TRUST_PROXY=1`.
- Les mises à jour exécutent du code sur les appareils : seuls les mainteneurs publient les tags et contrôlent le serveur des releases. Les sommes de contrôle détectent une corruption ; elles ne remplacent pas une signature éditeur.

Conserver ClamAV, Node.js, Electron et les dépendances à jour. Les installations Windows et Mac communautaires ne possèdent pas encore de certificat éditeur officiel. Voir [DEPLOYER.md](DEPLOYER.md).
