# Refonte de maintenance

Contraintes : conserver les fonctionnalités, l'interface, les données existantes et la licence CC BY-NC-SA 4.0. Les commits utilisent l'identité Git existante de Louis Roubaud et des messages en français.

La méthode suit des tests de caractérisation pour les extractions, et le cycle test en échec → correction minimale → simplification pour chaque nouveau comportement ou défaut. Les contrôles natifs restent exécutés sur un bureau Windows isolé.

## Suivi des lots

- [x] Socle de tests fiable, scénarios indépendants et CI.
- [ ] Formatage, règles de qualité et CSS organisé sans changement visuel.
- [ ] Cycle de vie des rooms et des temporaires.
- [ ] Frontières serveur, renderer, lecture et contrats partagés.
- [ ] Livrables indépendants et documentation des contributions/forks.
- [ ] Optimisations mesurées, hébergement à la demande et diagnostics.
- [x] Décision de licence : conserver le non-commercial.

## Journal TDD

### Point de départ

L'audit a reproduit l'échec de la suite desktop : assertion `18px` contre le style actuel adaptatif `clamp(26px,4vw,54px)`. Le test de caractérisation est adapté au comportement actuel, sans modifier le CSS. Les 38 tests Node existants sont la référence initiale.

La suite complète passe après adaptation de l'assertion. Les scénarios apparence, lecture et reconnexion sont ensuite exécutés dans trois processus indépendants : tous passent. Le runner poursuit les autres scénarios après un échec. Prettier et ESLint sont configurés ; les sources sont formatées mécaniquement. La CI versionnée couvre Node 24 sur Linux/Windows et Electron sous Windows ; son exécution distante devra être constatée après publication de la branche.

### Cycle de vie des rooms

Trois tests ajoutés avant l'implémentation échouent avec « Action inconnue. » : suppression par le propriétaire avec révocation des médias/sessions, capacité libérée après redémarrage, et conservation des accès si l'écriture sur disque échoue. La suppression sera accessible par le protocole et l'administration, sans changement de l'interface.
