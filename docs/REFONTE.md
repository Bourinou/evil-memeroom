# Refonte de maintenance

Contraintes : conserver les fonctionnalités, l'interface, les données existantes et la licence CC BY-NC-SA 4.0. Les commits utilisent l'identité Git existante de Louis Roubaud et des messages en français.

La méthode suit des tests de caractérisation pour les extractions, et le cycle test en échec → correction minimale → simplification pour chaque nouveau comportement ou défaut. Les contrôles natifs restent exécutés sur un bureau Windows isolé.

## Suivi des lots

- [x] Socle de tests fiable, scénarios indépendants et CI.
- [x] Formatage, règles de qualité et CSS organisé sans changement visuel.
- [x] Cycle de vie des rooms et des temporaires.
- [x] Frontières serveur, renderer, lecture et contrats partagés.
- [x] Livrables indépendants et documentation des contributions/forks.
- [x] Optimisations mesurées, hébergement à la demande et diagnostics.
- [x] Décision de licence : conserver le non-commercial.

## Journal TDD

### Point de départ

L'audit a reproduit l'échec de la suite desktop : assertion `18px` contre le style actuel adaptatif `clamp(26px,4vw,54px)`. Le test de caractérisation est adapté au comportement actuel, sans modifier le CSS. Les 38 tests Node existants sont la référence initiale.

La suite complète passe après adaptation de l'assertion. Les scénarios apparence, lecture et reconnexion sont ensuite exécutés dans trois processus indépendants : tous passent. Le runner poursuit les autres scénarios après un échec. Prettier et ESLint sont configurés ; les sources sont formatées mécaniquement. La CI versionnée couvre Node 24 sur Linux/Windows et Electron sous Windows ; son exécution distante devra être constatée après publication de la branche.

### Cycle de vie des rooms

Trois tests ajoutés avant l'implémentation échouent avec « Action inconnue. » : suppression par le propriétaire avec révocation des médias/sessions, capacité libérée après redémarrage, et conservation des accès si l'écriture sur disque échoue. La suppression sera accessible par le protocole et l'administration, sans changement de l'interface.

Les trois tests passent après ajout de la suppression persistée. Un quatrième test d'administration, d'abord en échec (404 au lieu de 403), valide le secret distinct, l'activation facultative et la suppression durable. L'administration locale réutilise la même opération métier, sans éditer le fichier de rooms pendant que le serveur fonctionne.

### Temporaires

Deux tests écrits avant le module de gestion des temporaires valident la récupération d'une instance terminée, la conservation d'une instance active et des dossiers sans propriétaire, ainsi que le refus d'un préfixe traversant. Le stockage serveur utilise maintenant des marqueurs de propriété ; les builds temporaires sont nettoyés sauf `MEMEROOM_KEEP_BUILD=1`. Les anciens dossiers dépourvus de marqueur sont volontairement laissés au nettoyage système. L'intégration du cache desktop et de l'arrêt asynchrone suit dans le lot lecture.

### Frontières et contrats

Les tests de résolution des imports privés et des ressources HTML ont précédé le déplacement. La télécommande vit dans `desktop/renderer/`, le site dans `public/`, le rendu commun dans `shared/render/`. Le contrat partagé reste accessible par la façade `shared/protocol.mjs`, avec des modules distincts pour les réglages, limites, réactions, sous-titres et favoris. Le serveur assemble désormais les transports HTTP/WebSocket, la politique des requêtes et le registre des rooms.

Les 46 tests Node passent (un test de lien symbolique ignoré sous Windows). Les scénarios Electron apparence et lecture passent. Le scénario rooms a échoué pendant des modifications concurrentes aux fichiers, puis passe entièrement à sa réexécution sur les fichiers stables. Les prochaines suites natives seront exécutées sans modifier les sources en parallèle.

### Lecture et écritures

Six tests de cache, trois tests de lecture, deux tests d’URL privée et deux tests d’écriture sont ajoutés avant les composants correspondants. Ils passent après implémentation. Un test supplémentaire reproduit ensuite une sauvegarde déclenchée au moment de la résolution précédente qui restait en attente : le correctif la reprogramme systématiquement.

L’aperçu complet et l’overlay utilisent le même téléchargement borné sur disque, sans conversion intégrale en Blob. Le cache réserve 2 Gio maximum, conserve les lecteurs actifs et expire les copies libres. La lecture est extraite du processus principal ; l’arrêt attend cache, serveur et écritures. Les réactions sans sous-titres ne démarrent plus de boucle d’animation.

La suite Electron complète passe avec ces composants : apparence, lecture (dont aperçu vidéo + audio et sous-titres tardifs) et reconnexion après redémarrage.

### Hébergement à la demande et interface

Trois tests écrits avant `local-host.cjs` couvrent l’absence de démarrage à la consultation des informations, la mutualisation des demandes, le port occupé et l’arrêt pendant le démarrage. Le scénario Electron rooms passe avec un participant qui n’héberge pas de serveur, y compris après redémarrage de l’hôte sur un autre port. La capture des raccourcis est extraite dans son propre module et son scénario natif passe. Un test réseau précède le remplacement des comparaisons de messages par des codes d’erreur stables.

### Distribution et diagnostics

Les tests de l’archive serveur sont ajoutés avant son module de préparation. Le test de staging partiel échoue d’abord sur le dossier Linux absent, puis passe après sélection indépendante des plateformes et conservation du manifeste existant. L’archive serveur exclut Electron et les données ; les téléchargements sont facultatifs. Les builds Windows décompressés officiel et fork sont compilés avec succès dans `.test-artifacts/`.

Les tests de configuration du fork précèdent la nouvelle configuration : identité et profil distincts, mises à jour désactivées par défaut, flux officiel refusé. Les paramètres de distribution officiels restent conservés.

Deux tests précèdent les diagnostics et l’accès aux statistiques administratives. Un cas supplémentaire reproduit l’acceptation d’une demande relayée par un proxy local ; les en-têtes de relais la font maintenant refuser. Les erreurs sont comptées et journalisées sans secrets, avec limitation des répétitions. La version annoncée par HTTP est lue dans le manifeste.

## Résultats et limites

| Contrôle exécuté localement | Résultat |
| --- | --- |
| Node 24.19.0 et Node 25.9.0 sous Windows | 70 tests réussis, un test de lien symbolique ignoré sous Windows |
| Syntaxe, ESLint, Prettier | Réussite |
| Electron 44.2.0, sources | Apparence, lecture, rooms réussis ; rooms rejoué après hébergement à la demande |
| Paquet Windows décompressé, profil isolé | Apparence, lecture et rooms réussis |
| Scénarios ciblés sur les sources finales | Réglages, sauvegarde de messages, téléchargement lent et raccourcis réussis |
| Contrôle natif plein écran Windows | Ordre des fenêtres, focus et styles de passage des clics réussis |
| Build de fork Windows | Réussite avec identifiant, exécutable et métadonnées distincts |
| Archive serveur extraite, Node 24 | `npm ci --omit=dev --ignore-scripts` puis HTTP, styles et création WebSocket réussis sans compilations desktop |
| Audit npm complet | Aucune vulnérabilité signalée au moment du contrôle ; registre interrogé hors bac à sable |
| Documentation | 15 documents Markdown contrôlés, aucun lien local vers un fichier manquant |

Les gains mesurés par les tests sont des comptes d’opérations, pas des pourcentages de vitesse : deux consommateurs du même média font un transfert au lieu de deux ; 50 changements rapprochés écrivent le dernier état une fois ; consulter les informations de l’app n’ouvre aucun serveur, et deux demandes d’hébergement partagent une seule instance. Les textes sans sous-titres ne demandent plus d’animation continue. Aucun gain CPU/RAM en production n’est revendiqué.

Les limites de 1 Gio par fichier et la persistance des rooms sont conservées. Les écritures de rooms restent synchrones et atomiques : elles concernent au maximum 100 petites fiches et ne sont pas dans le flux de diffusion des messages. Un passage en base de données ou un framework supplémentaire n’est pas justifié par les mesures disponibles. Le manifeste commun installe encore `electron-updater` sur le serveur autonome ; cette petite dépendance indirectement utile au desktop est conservée pour éviter un second graphe de dépendances à maintenir.

La CI est versionnée mais son exécution distante reste à constater après publication de la branche. Les tests Windows et le protocole antivirus simulé ne valident pas une installation Mac/Linux, le plein écran exclusif des jeux ou un moteur ClamAV réel. Les binaires de test ne sont pas publiés et ne portent pas une nouvelle version ; une livraison nécessite de choisir une nouvelle version et de valider les plateformes visées.

La revue du paquet de fork confirme le nom de paquet et de produit distincts, le renderer complet dans l’ASAR, les mises à jour désactivées et l’absence de manifeste de mise à jour officiel. Les types de contrat sont des aides d’édition ; ils ne constituent pas une vérification TypeScript globale. La licence CC BY-NC-SA 4.0 n’a pas été modifiée.
