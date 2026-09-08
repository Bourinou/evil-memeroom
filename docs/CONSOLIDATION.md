# Consolidation après refonte

Contraintes conservées : fonctionnalités et interface identiques, licence CC BY-NC-SA 4.0, tests avant correction ou extraction, commits en français avec l’identité Git existante de Louis Roubaud.

- [ ] Préparation Linux/Mac complète et reproductible.
- [ ] Télécommande organisée par connexion, composition, messages enregistrés et réglages.
- [ ] Contrats vérifiés automatiquement.
- [ ] Mesures reproductibles de CPU, mémoire, transferts et latence.
- [ ] Validation de livraison sur les environnements disponibles et CI distante.

## Journal TDD

Le script Linux est reproduit dans un dossier temporaire avec sa liste exacte de sources : le packaging serveur échoue sur `ENOENT .../deploy`. Deux tests précèdent une préparation commune aux scripts Linux/Mac et au ZIP serveur. Le nouveau test contrôle également l’absence des dépendances locales, des secrets, des données et des anciennes compilations.
