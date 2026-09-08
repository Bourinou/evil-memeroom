# Consolidation après refonte

Contraintes conservées : fonctionnalités et interface identiques, licence CC BY-NC-SA 4.0, tests avant correction ou extraction, commits en français avec l’identité Git existante de Louis Roubaud.

- [x] Préparation Linux/Mac complète et reproductible.
- [x] Télécommande organisée par connexion, composition, messages enregistrés et réglages.
- [x] Contrats vérifiés automatiquement.
- [x] Mesures reproductibles de CPU, mémoire, transferts et latence.
- [x] Validation locale Windows/Linux, installation Windows et antivirus réel.
- [ ] Exécution de la CI GitHub, notamment sur un Mac réel : configuration prête, publication de la branche encore bloquée.

## Journal TDD

Le script Linux est reproduit dans un dossier temporaire avec sa liste exacte de sources : le packaging serveur échoue sur `ENOENT .../deploy`. Deux tests précèdent une préparation commune aux scripts Linux/Mac et au ZIP serveur. Le nouveau test contrôle également l’absence des dépendances locales, des secrets, des données et des anciennes compilations.

Quatre tests de session précèdent l’extraction : sélection concurrente pendant le démarrage local, réponse reçue après avoir quitté, reconnexion réseau distincte des erreurs de mot de passe et événements d’une ancienne connexion. Le test du graphe d’imports détecte ensuite les nouveaux modules absents de la liste privée ; leur ajout le remet au vert. Les parcours Electron caractérisent l’interface avant et après le découpage.

Les sentinelles de `tests/contracts.ts` échouent d’abord parce que les mauvais types et la commande mal orthographiée passent inaperçus. Les annotations des fonctions et du transport rendent ces erreurs détectables. `checkJs` et `noEmit` couvrent les sources JavaScript du serveur, du bureau et les modules partagés. Les contrats des deux preloads sont contrôlés avec `@satisfies`. Le mode strict n’est pas activé partout : les zones dynamiques restent progressivement annotables ; la validation des données reçues reste indispensable à l’exécution.

## Résultats locaux du 8 septembre 2026

| Vérification | Résultat |
| --- | --- |
| Syntaxe, types, lint et format | Réussite |
| Suite Node Windows | 77 tests : 76 réussis, 1 test de liens symboliques réservé à Linux |
| Suite Node Linux / compilation isolée | 77 réussis, aucun ignoré |
| Electron Windows et Linux WSLg | Apparence, lectures longues, audio, sous-titres, rooms, reconnexion, réglages, messages enregistrés et raccourcis réussis |
| Ancien profil Windows 0.5.0 → nouveau programme 0.6.0 | Réglages, pseudo, code de room, droits du gestionnaire, reconnexion, message enregistré avec image, réimport et diffusion conservés |
| Installation Windows réelle | NSIS installé, exécuté, réinstallé et désinstallé avec l’identité distincte « MemeRoom Validation » |
| AppImage Linux | Construite ; reprise d’un profil et diffusion validées avec son programme empaqueté |
| Archives Mac Intel et Apple Silicon | Construites sous Linux ; 14 liens symboliques conservés dans chaque archive ; exécution et comportement sur Mac non validés localement |
| Distribution Windows/Linux | Vrais binaires téléchargés par electron-updater, empreintes vérifiées, version courante ignorée, binaire corrompu refusé, téléchargement tardif empêché après annulation |
| ClamAV 1.4, configuration du dépôt | PNG sain accepté ; signature EICAR standard refusée par le moteur ; format EICAR brut refusé par HTTP ; antivirus indisponible → HTTP 503 et aucune publication du fichier |

Les nouveaux artefacts restent dans `.test-artifacts/` et les dossiers WSL temporaires. Aucune release publique, version du projet ou installation MemeRoom existante n’a été remplacée. Les bibliothèques NSS, NSPR et ALSA nécessaires aux essais Linux ont été ajoutées à Ubuntu WSL. Le conteneur antivirus porte l’identité de test `memeroom-consolidation-clamav`.

## Mesures reproductibles

`npm run bench` lance un serveur séparé, huit participants WebSocket et huit caches natifs dans le processus de mesure. Chaque cache prépare simultanément un aperçu et un overlay, puis répète la lecture. Les assertions exigent une seule copie et un seul téléchargement par participant. Le fichier WAV est produit en flux sur disque ; aucune allocation de sa taille complète n’est nécessaire.

Machine : Ryzen 5 7600X, 12 processeurs logiques, Windows, Node 24.19.0. Vingt diffusions donnent 160 observations par essai. Les pics RSS sont échantillonnés toutes les 25 ms ; le temps CPU cumule les threads du processus.

| Mesure | WAV 32 Mio | WAV 128 Mio |
| --- | ---: | ---: |
| Latence WebSocket p95 | 0,52 ms | 0,61 ms |
| Import | 133 ms | 416 ms |
| Téléchargements simultanés à froid | 577 ms | 2 114 ms |
| Préparations depuis les caches chauds | 0,26 ms | 0,20 ms |
| Transferts / volume téléchargé | 8 / 256 Mio | 8 / 1 024 Mio |
| Pic RSS du serveur | 111,74 Mio | 131,91 Mio |
| Pic RSS du processus regroupant les caches | 115,71 Mio | 209,07 Mio |
| Temps CPU du serveur | 484 ms | 2 423 ms |
| Temps CPU du processus de mesure | 1 235 ms | 4 000 ms |

Ces mesures portent sur la boucle locale, les transferts et les caches ; elles excluent le décodage graphique, l’antivirus et la latence Internet. Elles ne constituent pas une comparaison avant/après ni une garantie sur d’autres machines. `BENCH_PARTICIPANTS` accepte 2 à 16 participants et `BENCH_MEDIA_MIB` 1 à 256 Mio. Les rapports JSON complets sont écrits dans `.test-artifacts/benchmark*.json`.

## Dernière validation externe

La CI prépare les vérifications Node et Electron sur Windows, Linux et macOS, la compilation des livrables, l’installation Windows isolée et un job avec ClamAV réel. Son exécution n’est pas confirmée tant que la branche n’est pas disponible sur GitHub. L’accès SSH local au dépôt a échoué et le contrôle automatique d’approbation a refusé l’essai de publication HTTPS sans accord explicite. La compilation croisée des ZIP Mac ne remplace pas cette validation native.
