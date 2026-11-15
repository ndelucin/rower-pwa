# Brief — PWA d'entraînement pour WaterRower (S4 + BLE)

## 1. Contexte et objectif

- Rameur **WaterRower** avec moniteur **S4** équipé d'un module Bluetooth (nom annoncé : `S4 BLE 50`).
- L'appli officielle **WaterRower Connect** est devenue inutilisable en paysage après une mise à jour : les valeurs sont illisibles à cause d'un mauvais redimensionnement.
- **Objectif** : une **PWA** sous mon contrôle qui
  - affiche en temps réel et **en paysage** les données du rameur ;
  - gère plusieurs **types de séance** et des **programmes** sauvegardés ;
  - ajoute une dimension **ludique** (fantôme, records, défis) ;
  - exporte chaque séance vers un **dashboard** d'analyse (Rowerboard, ou un artefact Claude).

## 2. Faisabilité : validée avec nRF Connect

| Point | Résultat |
|---|---|
| Nom BLE | `S4 BLE 50` |
| Appairage | **Aucun** : CONNECTED / NOT BONDED, pas de secret |
| Service | **Fitness Machine (FTMS) `0x1826`**, standard Bluetooth SIG |
| Flux temps réel | **Rower Data `0x2AD1`** (NOTIFY), tous les champs dans une seule trame |
| Autres caractéristiques | Fitness Machine Feature `0x2ACC` (READ), Training Status `0x2AD3` (NOTIFY, READ), Control Point `0x2AD9` (INDICATE, WRITE), Machine Status `0x2ADA` (NOTIFY), Supported Speed Range `0x2AD4` (READ) |

Trame observée (décodée par nRF Connect), à garder comme référence de test :

| Champ | Au repos | En ramant |
|---|---|---|
| Stroke Rate | 0.0 | 18.0 coups/min |
| Stroke Count | 0 | 6 |
| Average Stroke Rate | 0.0 | 18.5 |
| Total Distance | 0 m | 45 m |
| Instantaneous Pace | **65535** (pas de donnée) | 278 s, soit 4:38 /500 m |
| Average Pace | **65535** | 284 s, soit 4:44 /500 m |
| Instantaneous Power | 0 W | 21 W |
| Average Power | 0 W | 16 W |
| Resistance Level | 170 | 170 (valeur fixe, à ignorer) |
| Total Energy | 0 | 2 kcal |
| Energy per Hour | 0 | 374 kcal |
| Energy per Minute | 0 | 6 kcal |
| Heart Rate | 0 | 0 (rien n'est relayé, à ignorer) |
| Elapsed Time | 0 s | 25 s |

## 3. Décodage de Rower Data (`0x2AD1`)

Tout est en **little-endian**. La trame commence par **16 bits de flags**, puis les champs présents **dans cet ordre**. Le tableau ci-dessous est à vérifier contre la spécification FTMS 1.0.

| Bit | Champ(s) | Type | Résolution / unité |
|---|---|---|---|
| 0 | **More Data** (logique inversée : **0 = présent**) → Stroke Rate + Stroke Count | uint8 + uint16 | 0.5 /min ; nombre de coups |
| 1 | Average Stroke Rate | uint8 | 0.5 /min |
| 2 | Total Distance | **uint24** | m |
| 3 | Instantaneous Pace | uint16 | s /500 m |
| 4 | Average Pace | uint16 | s /500 m |
| 5 | Instantaneous Power | **sint16** | W |
| 6 | Average Power | sint16 | W |
| 7 | Resistance Level | sint16 | sans unité |
| 8 | Total Energy + Energy/Hour + Energy/Minute | uint16 + uint16 + uint8 | kcal |
| 9 | Heart Rate | uint8 | bpm |
| 10 | Metabolic Equivalent | uint8 | 0.1 |
| 11 | Elapsed Time | uint16 | s |
| 12 | Remaining Time | uint16 | s |

- Flags probables pour ce module : `0x0BFE`. **Ne pas coder en dur** : toujours parser selon les flags.
- Valeurs sentinelles : un pace à `0xFFFF` ou une valeur au maximum de son type signifie « pas de donnée » → afficher `--`.
- Le décodeur doit rester robuste au cas où des champs arrivent répartis sur plusieurs notifications.

## 4. Architecture

```
S4 --USB série--> module BLE --FTMS--> PWA (Chrome Android)
                                         |-- moteur de séance (programmes)
                                         |-- affichage paysage (gabarit + composants)
                                         |-- signaux (bip, voix, vibration)
                                         |-- stockage local (IndexedDB)
                                         '-- export séance JSON --> Dashboard (Rowerboard ou artefact Claude)
```

- **Temps réel** (PWA) et **analyse** (dashboard) sont **découplés** par un format de séance JSON (§ 11). Ce format est le seul contrat entre les deux.
- **Code HTML/JS vanilla**, sans framework ni étape de build. Modules ES séparés :
  - `ftms.js` : décodeur pur, testable ;
  - `ble.js` : connexion, abonnement, reconnexion ;
  - `engine.js` : moteur de séance ;
  - `ui/` : gabarit et composants ;
  - `store.js` : IndexedDB ;
  - `audio.js` : signaux ;
  - `export.js`.

## 5. Connexion BLE

- Bouton « Connecter » : Web Bluetooth exige un geste utilisateur.
- `requestDevice({ filters: [{ namePrefix: 'S4 BLE' }], optionalServices: [0x1826] })`. Ne pas filtrer uniquement par service : on ne sait pas si `0x1826` figure dans l'annonce.
- Abonnement à `0x2AD1`. `0x2AD3` et `0x2ADA` sont optionnels, pour détecter début et fin de séance.
- Reconnexion automatique sur `gattserverdisconnected`, avec un indicateur d'état de connexion toujours visible.
- **Ne pas utiliser le Control Point (`0x2AD9`) en v1.** Les objectifs de séance sont gérés **côté PWA**, sans dépendre du module. Si on l'utilise un jour, il faut d'abord envoyer « Request Control » (opcode `0x00`).

## 6. Types de séance et moteur de programmes

Tous les types de séance sont **des cas particuliers d'un même modèle de programme** : un seul moteur.

| Type | Programme équivalent |
|---|---|
| Libre | aucun segment, pas d'objectif |
| Durée | 1 segment `duration` |
| Distance | 1 segment `distance` |
| HIIT (fractionné) | segments effort/repos répétés |
| Programme personnalisé | suite libre de segments (échauffement, blocs, retour au calme…) |

Modèle de programme :

```json
{
  "id": "hiit-6x40",
  "name": "HIIT 6 x 40 s",
  "kind": "intervals",
  "segments": [
    { "type": "warmup", "duration": 300 },
    { "type": "work", "duration": 40, "target": { "split": 125, "spm": [26, 30] } },
    { "type": "rest", "duration": 60 },
    { "type": "cooldown", "duration": 180 }
  ],
  "repeat": { "from": 1, "to": 2, "times": 6 }
}
```

- Un segment a **soit** `duration` (en s), **soit** `distance` (en m).
- `type` vaut `warmup`, `work`, `rest` ou `cooldown`, et détermine la couleur.
- `target` est optionnel : split en s/500 m, cadence `spm` en [min, max], watts en [min, max].
- `repeat` répète un bloc de segments ; la syntaxe est à affiner.
- Le moteur calcule les **deltas** à partir des cumuls FTMS (temps, distance) au début de chaque segment, et gère la **pause** sans fausser les segments.
- Événements émis par le moteur : `segmentStart`, `segmentEnd`, `countdown(3,2,1)`, `targetIn` / `targetOut`, `sessionEnd`.

## 7. Interface : gabarit commun et variantes par type

**Look and feel commun** : mêmes zones, polices, couleurs et position des métriques. Fond sombre, fort contraste, lisible à 1,5 m, en paysage plein écran.

```
+--------------------------------------------------+
| [Bandeau]  type / segment          [état BLE]     |
+---------------------------+----------------------+
|   [Zone principale]       |  Métriques           |
|   grand chiffre           |  secondaires (2x2)   |
+---------------------------+----------------------+
| [Zone de progression]                            |
+--------------------------------------------------+
```

| Type | Zone principale | Zone de progression | Bandeau |
|---|---|---|---|
| Libre | Split instantané | Mini-courbe split/watts (dernières minutes) | « Séance libre » + temps écoulé |
| Durée | Temps restant | Barre de progression temps (+ fantôme) | Objectif + distance parcourue |
| Distance | Mètres restants | Barre de progression distance (+ fantôme) | Objectif + temps écoulé + projection d'arrivée |
| HIIT | Compte à rebours de l'intervalle | **Frise des intervalles** | « Effort 3/6 » + intervalle suivant |
| Programme | Temps ou distance restant du segment | Frise des segments | Nom du programme + segment en cours |

- **Implémentation** : chaque zone est un **composant** (une fonction qui reçoit l'état et met le DOM à jour). Chaque type de séance est une **configuration** qui dit quel composant va dans quelle zone. Ajouter un type = ajouter une configuration.
- **Métriques secondaires** par défaut : split, watts, cadence, distance (ou temps, selon le type).

**Frise des intervalles (HIIT / programme)** :
- un bloc par segment, de largeur proportionnelle à la durée (ou à la distance, convertie en durée estimée) ;
- couleur selon le type : effort = orange/rouge, repos = vert, échauffement/retour au calme = gris ;
- les blocs passés sont foncés, les blocs à venir estompés ; le bloc en cours est encadré et se remplit progressivement ;
- **la couleur de fond de l'écran suit le type de l'intervalle en cours**, pour une lecture en vision périphérique ;
- le compte à rebours de l'intervalle est affiché très gros, dans la couleur du type ;
- le bandeau donne un aperçu de l'intervalle suivant (« Ensuite : repos 1:00 »).

## 8. Rendu graphique : pas de librairie

- **HTML, CSS et SVG natifs uniquement.** Les éléments sont simples et rafraîchis environ une fois par seconde. Pas de dépendance = PWA légère, robuste hors ligne, et pas de régression imposée par une mise à jour de librairie.

| Élément | Technique |
|---|---|
| Grands chiffres | Texte HTML, taille en `vw`, `font-variant-numeric: tabular-nums` |
| Chrono / compte à rebours | Calculés à partir d'un horodatage de référence (pas d'incrément, qui dérive) ; rendu dans `requestAnimationFrame` ou à chaque trame |
| Barres de progression | CSS |
| Anneaux, jauges, zone cible | SVG (`stroke-dasharray` / `stroke-dashoffset`, arcs) |
| Mini-courbe | `<canvas>` ou polyligne SVG |
| Transitions | Animations CSS |

- Si une courbe temps réel plus riche devient nécessaire : **uPlot** (léger). Pas de Chart.js, ECharts ou D3 dans la PWA ; les graphiques d'analyse vont dans le dashboard.

## 9. Signaux sonores, vocaux et vibration

- **Bip** : Web Audio API (oscillateur, pas de fichier son). L'`AudioContext` doit être créé ou repris **au clic « Démarrer »**. Le son sort au volume média.
- **Voix** : `speechSynthesis`, en français. Par exemple « Repos, une minute », « 500 mètres restants », « Nouveau record ».
- **Vibration** : `navigator.vibrate` en complément, peu perceptible quand le téléphone est sur son support.
- Règles par défaut :
  - 3 bips courts aux 3 dernières secondes ou aux 3 derniers… mètres d'un segment (à définir) ;
  - un bip long à chaque transition ;
  - une annonce vocale du segment suivant ;
  - un son spécial en cas de record ;
  - tout est désactivable dans les réglages.

## 10. Stockage local

- **IndexedDB** : programmes, historique des séances (résumé et échantillons), records et réglages.
- **Import et export JSON** des programmes et de l'historique : sauvegarde manuelle, édition sur PC. C'est le filet de sécurité si les données de Chrome sont effacées.
- La séance en cours est sauvegardée au fil de l'eau, pour ne rien perdre en cas de coupure ou de rechargement.
- Programmes fournis par défaut : Libre, Durée 20 min, Distance 2 000 m, HIIT 6 x 40 s / 60 s, Pyramide.

## 11. Export de séance (contrat avec le dashboard)

Format JSON versionné :

```json
{
  "schema": "rower-session/1",
  "id": "2026-11-15T14:12:00+01:00",
  "program": { "id": "hiit-6x40", "name": "HIIT 6 x 40 s", "kind": "intervals" },
  "summary": { "duration": 1260, "distance": 3850, "avgSplit": 131, "avgPower": 142, "avgSpm": 24, "strokes": 498, "kcal": 210 },
  "segments": [ { "index": 1, "type": "work", "start": 300, "end": 340, "distance": 162, "avgSplit": 123, "avgPower": 188, "avgSpm": 28 } ],
  "samples": [ { "t": 0, "d": 0, "split": null, "w": 0, "spm": 0, "strokes": 0 } ],
  "records": [ { "kind": "500m", "value": 118 } ]
}
```

En fin de séance :
- **Télécharger** le fichier JSON ;
- **Partager** via le Web Share API (`navigator.share({ files })`) vers une autre appli, par exemple une conversation Claude.
- Un convertisseur TCX ou CSV pourra être ajouté si Rowerboard l'exige.

Cible dashboard : Rowerboard, ou un artefact Claude avec base de données. **Aucune API publique ne permet à la PWA d'écrire directement dans l'artefact** : le transfert passe par un import de fichier dans l'artefact, ou par un partage vers une conversation Claude. Une synchronisation automatique, via un dossier Google Drive par exemple, est hors périmètre.

## 12. Gamification (toujours contre soi-même)

Les watts d'un WaterRower ne sont comparables qu'entre séances sur **la même machine** : pas de comparaison externe.

**Pendant la séance (PWA)**
- **Fantôme** : ta meilleure séance précédente sur le même objectif (distance ou durée), affichée comme un second marqueur sur la barre de progression, avec l'écart en mètres ou en secondes.
- **Couloir** : zone cible de split ou de cadence, avec un score de régularité en % du temps passé dans la zone.
- **Record en direct** : signal sonore et message à l'écran quand un record est battu.

**Entre les séances (PWA et/ou dashboard)**
- **Records personnels** détectés automatiquement : meilleur temps sur 500 m, 1 000 m, 2 000 m et 5 000 m ; meilleure puissance moyenne sur 1 min et 5 min.
- **Régularité** : nombre de semaines consécutives avec au moins 2 séances (et pas de jours consécutifs, qui poussent à ramer fatigué).
- **Défi de distance cumulée** : parcours virtuel, par exemple le tour du lac d'Annecy (environ 40 km), avec la progression affichée.

## 13. Exigences PWA et hébergement

- `manifest.webmanifest` avec `"display": "fullscreen"`, `"orientation": "landscape"` et des icônes.
- **Service worker** pour la mise en cache et le fonctionnement **hors ligne** ; prévoir aussi une stratégie de mise à jour (affichage « nouvelle version disponible »).
- **Screen Wake Lock** pendant la séance.
- **Hébergement : GitHub Pages**, en HTTPS (Web Bluetooth et service worker exigent un contexte sécurisé).
  - Le site est servi dans un sous-chemin (`https://<user>.github.io/<repo>/`) : **chemins relatifs partout**, y compris `start_url` et `scope` dans le manifeste, et l'enregistrement du service worker.
  - Ajouter un fichier `.nojekyll` à la racine.
  - Le dépôt (offre gratuite) et le site sont publics : **aucun secret dans le code**. Les données de séance restent sur le téléphone.

## 14. Contraintes et pièges connus

- **Plateforme cible : Android + Chrome uniquement.** Firefox et iOS ne gèrent pas Web Bluetooth.
- **Une seule connexion à la fois** au module : WaterRower Connect doit être fermée.
- Le module se met en veille avec le S4 : il faut réveiller le moniteur avant de se connecter.
- Pas d'exécution en arrière-plan : écran éteint ou appli quittée = pause et déconnexion. C'est acceptable, d'où le Wake Lock.
- Audio, vibration et Web Bluetooth exigent un geste utilisateur : tout initialiser au clic « Connecter » ou « Démarrer ».

## 15. Débogage et tests

- Débogage USB sur le téléphone, puis `chrome://inspect` sur le PC.
- **Mode simulation** : un faux flux FTMS (scénarios repos, effort, HIIT) pour développer l'interface et le moteur sans le rameur.
- **Tests unitaires** :
  - le décodeur, avec des trames construites selon les flags et comparées aux valeurs de référence du § 2 ;
  - le moteur de séance : transitions, répétitions, pause, segments en distance.

## 16. Découpage en versions

| Version | Contenu |
|---|---|
| **v1** | Décodeur + simulation, connexion BLE, séance **libre** en paysage, Wake Lock, enregistrement et export JSON, PWA installable sur GitHub Pages |
| **v2** | Moteur de programmes, types **Durée / Distance / HIIT / Programme**, frise et couleurs, signaux sonores et vocaux, IndexedDB, import/export des programmes |
| **v3** | Cibles et couloir, fantôme, records automatiques, régularité, défi de distance cumulée |
| **v4** | Intégration au dashboard (Rowerboard ou artefact Claude), convertisseurs d'export |

## 17. Questions ouvertes

- Quel **format d'entrée** pour Rowerboard, ou bascule vers un artefact Claude ?
- Démarrage de séance : manuel (bouton) ou automatique au premier coup ?
- Pour les intervalles en distance : comment estimer la largeur des blocs dans la frise (avec un split de référence) ?
- Le contenu exact des métriques secondaires par type de séance.
