# Reel Studio

Petit logiciel de montage local pour créer des reels Instagram (9:16) rythmés sur une musique.

## Lancer

- **Windows** : double-cliquez sur `Lancer Reel Studio.bat` (la première fois, il installe les dépendances).
- Ou dans un terminal : `npm install` puis `npm start`, et ouvrez <http://localhost:5173>.

Navigateur conseillé : Chrome ou Edge.

## Utilisation en 30 secondes

1. Sur l'accueil, glissez un dossier (photos + vidéos + éventuellement une musique). Un projet est créé.
2. La musique est analysée : le tempo (BPM) et le premier temps sont détectés. Chaque photo dure **1 temps** par défaut.
3. Réglez la durée de toutes les photos dans *Projet → Rythme*, ou sélectionnez des vignettes dans la timeline
   (clic, Maj+clic, Ctrl+clic) pour régler leur durée à part (touches `1` à `5`, ou glisser le bord droit d'une vignette).
4. Glissez les vignettes pour changer l'ordre. *Mélanger*, *Inverser* et *Trier* agissent sur la sélection (ou sur tout).
5. Ajoutez un **Texte** ou un **Logo** avec les boutons au-dessus de l'aperçu, déplacez-les directement dans l'aperçu.
6. **Exporter** : MP4 H.264 1080×1920, avec la musique en AAC.

Tout est enregistré automatiquement (indicateur « Enregistré » en haut). `Ctrl+Z` / `Ctrl+Y` pour annuler / rétablir.

### Couper un passage (photo, vidéo ou musique)

1. Cliquez la piste à couper dans la timeline (**Médias** ou **Musique** : son nom passe en surbrillance).
2. Placez la tête de lecture et cliquez **Couper** (touche `S`) aux deux bords du passage.
3. Cliquez le morceau du milieu et appuyez sur `Suppr` : la suite se recolle automatiquement.

Les coupes se calent sur la grille des temps (Alt pour une coupe libre), ce qui garde photos et musique en rythme.
Une vidéo coupée reprend exactement là où elle a été coupée. *Rétablir la musique entière* (panneau Musique) annule toutes les coupes de la musique ; `Ctrl+Z` fonctionne aussi.

### Format des photos

Par défaut, les photos et vidéos gardent leur format d'origine (**Adapter** : image entière, bandes noires).
Le bouton au-dessus de l'aperçu bascule tous les médias en **Recadrer** (plein écran) ou **Fond flou**.
On peut aussi régler un média précis dans le panneau de droite.

### Modèles (le plus rapide)

Sur l'accueil, choisissez un modèle, tapez le nom de l'événement, déposez le dossier de photos : la musique,
son meilleur passage (refrain / drop), le rythme, le titre, le logo et le carton de fin se placent tout seuls.
Tout reste modifiable ensuite.

- 5 modèles fournis : *Récap express*, *Classique*, *Montée en puissance*, *Souvenirs*, *Format 30 s*.
- **Vos propres modèles** : dans l'éditeur, *Modèles → Enregistrer ce montage comme modèle*. La musique et son passage,
  le rythme, les textes (le premier devient le titre), le logo et les cartons sont mémorisés.
- *Modèles → Appliquer un modèle* refait le montage d'un projet existant (annulable).

### Bibliothèque musicale

Les musiques ajoutées (bouton *Bibliothèque musicale* de l'accueil, ou copiées dans `bibliotheque/musiques`)
sont analysées une fois (tempo) et proposées dans tous les projets et modèles.

Pour publier avec un morceau connu, le plus sûr est d'exporter **sans la musique** (option de l'export) puis
d'ajouter le même titre depuis la bibliothèque musicale d'Instagram : l'application indique où placer le début
du morceau pour retrouver la synchronisation.

## Où sont mes fichiers ?

Dans le dossier `projets/` :

```
projets/<id>/project.json     le montage (ordre, durées, textes…)
projets/<id>/media/           copies des photos, vidéos, musique et logos importés
projets/<id>/exports/         les vidéos exportées
projets/<id>/sauvegardes/     copies de sécurité horodatées du montage (30 dernières)
projets/_corbeille/           projets supprimés (rien n'est effacé définitivement)
bibliotheque/musiques/        musiques partagées entre projets (+ index.json : tempo, durée)
bibliotheque/logos/           logos partagés
bibliotheque/modeles/         vos modèles (un fichier .json chacun)
```

Pour stocker les projets ailleurs : variable d'environnement `REEL_DATA_DIR`.

## Architecture (pour faire évoluer l'outil)

Aucune étape de compilation : modifiez un fichier, rechargez la page.

| Fichier | Rôle |
| --- | --- |
| `server.js` | Serveur Node local : fichiers, sauvegarde des projets, export ffmpeg (x264 + AAC) |
| `public/js/model.js` | Modèle de données, valeurs par défaut, calcul des durées (en *temps* musicaux) |
| `public/js/store.js` | État central, historique annuler/rétablir, sauvegarde automatique |
| `public/js/render.js` | Dessin d'une image à l'instant t — **partagé par l'aperçu et l'export** |
| `public/js/audio.js` | Lecture synchronisée, forme d'onde, détection du tempo, tap tempo |
| `public/js/media.js` | Import (miniatures, proxys), chargement des images pour l'aperçu et l'export |
| `public/js/actions.js` | Toutes les actions de montage |
| `public/js/preview.js` | Aperçu et manipulation directe |
| `public/js/timeline.js` | Timeline |
| `public/js/inspector.js` | Panneau de réglages |
| `public/js/export.js` + `jpeg-worker.js` | Export image par image vers ffmpeg |
| `public/js/templates.js` | Modèles fournis, application d'un modèle, capture d'un montage en modèle |
| `public/js/template-ui.js` | Cartes et fenêtre de configuration des modèles |
| `public/js/library.js` | Bibliothèque musicale et logos partagés |

Les durées sont stockées en temps (beats) : changer le BPM recale tout le montage sur la musique.

## Limites actuelles

- Le son des vidéos est coupé (seule la musique est conservée).
- Les photos HEIC/RAW ne sont pas lues : convertissez-les en JPG.
- Les vidéos que le navigateur ne lit pas (souvent HEVC d'iPhone) sont converties automatiquement en H.264 à l'import.
