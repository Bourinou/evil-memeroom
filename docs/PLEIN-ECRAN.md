# Overlay et jeux en plein écran

L’overlay est une fenêtre transparente, sans interaction et sans activation. La version 0.6.0 réaffirme sa position au sommet de l’ordre des fenêtres toutes les 500 ms pendant son affichage. Elle se replace lorsque la résolution ou les paramètres d’écran changent. La boucle s’arrête dès que la fenêtre est cachée ou détruite.

Sur Windows et macOS, le niveau `screen-saver` est utilisé, puis `moveTop()` ; sur Linux, l’app utilise X11/XWayland et le maintien au premier plan du gestionnaire de fenêtres. Sur Mac, la fenêtre est déclarée visible sur les espaces plein écran.

## Si le contenu reste invisible en jeu

Choisir **plein écran sans bordure** (parfois appelé fenêtré plein écran) dans les paramètres graphiques du jeu. Vérifier également l’écran choisi dans MemeRoom et désactiver temporairement la pause de réception.

En plein écran exclusif, certains jeux possèdent directement la sortie graphique. Une fenêtre Electron ne peut pas garantir son affichage au-dessus de ce mode. Le correctif ne procède à aucune injection dans les jeux et ne modifie pas leurs protections. Certains gestionnaires Linux et espaces macOS imposent également leurs propres règles.

## Vérification reproductible

`npm run test:fullscreen` crée une fenêtre Windows plein écran au premier plan, affiche un message, puis remet volontairement la fenêtre de test au-dessus. Le contrôle natif vérifie que l’overlay repasse au-dessus et conserve les styles Windows non activable et transparent aux clics ; Electron confirme que le focus reste sur la fenêtre de test. Cela ne constitue pas une validation du plein écran DirectX exclusif, ni de tous les jeux ou de macOS/Linux.

Pour un signalement, indiquer système, version de MemeRoom, jeu, mode d’affichage, nombre d’écrans et résultat en sans bordure. Ne pas envoyer de captures contenant des données personnelles.

Références : [API des fenêtres Electron](https://www.electronjs.org/docs/latest/api/browser-window), [fonctionnement du plein écran Windows](https://devblogs.microsoft.com/directx/demystifying-full-screen-optimizations/).
