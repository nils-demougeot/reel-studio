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
5. Ajoutez un **Texte** ou un **Sticker** avec les boutons au-dessus de l'aperçu, déplacez-les directement dans l'aperçu.
6. **Exporter** : MP4 H.264 1080×1920, avec la musique en AAC.

Tout est enregistré automatiquement (indicateur « Enregistré » en haut). `Ctrl+Z` / `Ctrl+Y` pour annuler / rétablir.

### Aimant, coupe précise

Le bouton **Aimant** (à côté de Couper / Supprimer) fait s'accrocher coupes, durées, calques et sons aux temps de la
musique et aux autres éléments, *seulement quand ils en sont tout proches*. Désactivé, tout se place au pixel près.
`Alt` inverse l'aimant le temps d'un geste. Les touches `,` et `.` déplacent la tête de lecture d'une image.

### Musique : choisir les passages

*Choisir les passages* (panneau Musique, bouton de la piste Musique, ou double-clic dessus) affiche tout le morceau :
glissez pour sélectionner, puis *Garder seulement ça*, *Ajouter* ou *Retirer*. Les parties gardées sont jouées à la suite.

### Transitions

Bouton **Transition** au-dessus de l'aperçu : 8 transitions avec aperçu animé — Fondu, Flash blanc, Flash noir,
Zoom, Glissé, Flou, Lumière (brûlure de pellicule) et **Silhouette** (flash, le sujet de la photo reste un instant
sur l'image suivante). Glissez-en une sur une coupe de la timeline, ou cliquez pour l'appliquer à la coupe la plus
proche de la tête de lecture. Une pastille apparaît sur la coupe : cliquez-la pour changer le type, la durée, ou
l'appliquer à toutes les coupes. La Silhouette détoure automatiquement le sujet (modèle `models/u2netp.onnx`,
exécuté localement par `onnxruntime-node`).

### Fondus du son

Panneau Musique : *Fondu début* et *Fondu final* de la vidéo. Cliquez un passage de musique dans la timeline pour
régler son fondu d'entrée et de sortie (par exemple juste avant une coupe). La forme d'onde montre les fondus.

### Effets sonores

Bouton **Son** au-dessus de l'aperçu : 29 effets fournis, dont 12 très courts (≤ 0,5 s : swish de vent, clic sec,
pop, bulle, claquement de doigts…), plus (whoosh, arrivée avec impact, montée, clic, appareil photo,
pop, ding, paillettes, applaudissements…), à écouter avant de les placer. Vous pouvez importer les vôtres (« Mes sons »).
Les effets fournis sont synthétisés par `tools/generate-sfx.mjs` (aucun droit d'auteur) ; ils sont aussi conservés
dans l'export « sans musique ».

### Couleurs et polices

Chaque couleur (fond, carton, texte, fond du texte) peut être unie ou un **dégradé** (bouton à droite des pastilles).
Polices : Montserrat, Inter, Bebas Neue, Bungee, Abril Fatface, Cinzel, Pacifico, Great Vibes, Permanent Marker.

### Stickers et calques

Un **sticker** est une image, une image animée ou une vidéo posée par-dessus le montage (un logo est un sticker).
Formats acceptés : PNG, JPG, WebP, AVIF, SVG, BMP, GIF / WebP / APNG animés, MP4, MOV, WebM, et via conversion
automatique ProRes, AVI, MKV, WMV, MTS, TIFF, JPEG 2000… La transparence est conservée (PNG, GIF, WebM, ProRes 4444).
Les stickers animés ou vidéo tournent en boucle (ou une seule fois) ; le son des vidéos n'est pas utilisé.

La piste **Calques** de la timeline contient textes et stickers, un par ligne : **la ligne du haut est au premier plan**.
Glissez une barre vers le haut ou le bas pour changer l'ordre, ou utilisez les boutons du panneau (touches `[` et `]`).

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
| `public/js/transition-menu.js` | Menu des transitions (aperçus animés, glisser-déposer) |
| `models/u2netp.onnx` | Modèle de détourage du sujet (U²-Net léger, licence Apache 2.0) |
| `public/js/music-editor.js` | Fenêtre « Choisir les passages » de la musique |
| `public/js/sound-picker.js` | Choix des effets sonores |
| `tools/generate-sfx.mjs` | Génère la bibliothèque d'effets sonores `public/sfx` |
| `public/js/stickers.js` | Import des stickers (détection des images animées, conversion) et décodage image par image |

Les durées sont stockées en temps (beats) : changer le BPM recale tout le montage sur la musique.

## Limites actuelles

- Le son des vidéos est coupé (seule la musique est conservée).
- Les photos HEIC/RAW ne sont pas lues : convertissez-les en JPG.
- Les vidéos que le navigateur ne lit pas (souvent HEVC d'iPhone) sont converties automatiquement en H.264 à l'import.
