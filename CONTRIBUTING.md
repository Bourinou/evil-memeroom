# Contribuer à MemeRoom

MemeRoom est un projet de **Rose Roubaud**. Le code est consultable et modifiable sous [CC BY-NC-SA 4.0](LICENSE) : attribution, usage non commercial et partage des adaptations sous la même licence. Citer l’autrice originale et indiquer vos modifications. Les dépendances gardent leurs licences propres.

## Première installation

Installer Git et Node.js 24 LTS, puis :

```bash
git clone https://github.com/Rose-Roubaud/memeroom.git
cd memeroom
npm ci
npm start
```

Utiliser une adresse Git de confidentialité fournie par votre compte GitHub si vous ne souhaitez pas publier votre adresse personnelle.

## Proposer un changement

1. Ouvrir une issue pour décrire le problème ou la fonctionnalité. Pour une faille, suivre [SECURITY.md](SECURITY.md).
2. Créer un fork puis une branche dédiée. Garder une modification cohérente par pull request.
3. Lire [l’architecture](docs/ARCHITECTURE.md) et [le guide de développement](docs/DEVELOPPEMENT.md). Conserver la séparation entre site public, contrôle privé de l’app et overlay.
4. Écrire un test qui échoue sur le défaut, corriger puis simplifier. Pour une extraction, caractériser le comportement existant. Compléter la documentation et lancer `npm run check`, `npm run lint`, `npm run format:check`, `npm test`, puis les tests de bureau pertinents.
5. Vérifier les fichiers avec `git diff --cached --stat`. Ne jamais ajouter de données réelles pour reproduire un bug.
6. Ouvrir une pull request expliquant le problème, le résultat attendu et les vérifications réalisées. Les modifications sensibles nécessitent une revue de l’autrice ou d’un mainteneur.

Les contributions doivent pouvoir être distribuées sous la licence du projet. Ne pas inclure de médias dont vous n’avez pas les droits. Les fichiers `.env`, accès aux rooms, médias personnels, certificats, builds et configurations locales telles que `.claude` restent hors du dépôt.

Les binaires sont joints aux [releases](https://github.com/Rose-Roubaud/memeroom/releases), jamais commités. La compilation et le déploiement sont décrits dans [DEPLOYER.md](DEPLOYER.md).

Pour une première contribution, le [guide de développement](docs/DEVELOPPEMENT.md#où-intervenir) relie chaque zone du code à ses tests. Le [contrat réseau et IPC](docs/PROTOCOLE.md) précise les frontières à respecter. Pour distribuer une adaptation sous la licence non commerciale, utiliser la [configuration de fork](docs/FORKS.md) afin de séparer le profil utilisateur et les mises à jour.
