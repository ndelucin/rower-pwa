# Écrans de séance : décisions de conception

Décisions prises avec Nico le 2026-11-15, sur maquettes. Elles **précisent ou remplacent** le brief § 7 (gabarit à bandeau + zone principale + grille 2 × 2 + mini-courbe), qui est abandonné.

Maquettes de référence (pages statiques, à ouvrir sur le serveur local) :
- [maquette-seance-libre.html](maquette-seance-libre.html) : séance libre (`?pause` pour l'état en pause) ;
- [maquette-hiit.html](maquette-hiit.html) : séance programmée, un moment à la fois (`?s=1` à `?s=6`) ;
- [maquette-phases.html](maquette-phases.html) : planche des 6 moments d'une séance programmée.

## Gabarit commun

```
┌──────────────────────────────────────────────────────────┐
│ SPLIT /500 m            ╭──────────╮          CADENCE  • │
│ 2:06                  ╭─╯  anneau  ╰─╮        22 /min    │
│                       │  libellé     │                   │
│ PUISSANCE             │  CHRONO      │        DISTANCE   │
│ 178 W                 ╰─╮  [■]     ╭─╯        1 250 m    │
│                         ╰──────────╯                     │
│ 2:30 ───────────── barre de split ──────────────── 1:50  │
└──────────────────────────────────────────────────────────┘
```

- **Pas de ligne du haut** : toute la hauteur va aux chiffres.
- **Au centre, un anneau** autour du chrono (ou du compte à rebours).
- **4 grandes valeurs**, deux de chaque côté : **split /500 m** (bleu), **puissance W** (orange), **cadence** et **distance** (blanc). Pas de calories, pas de vitesse en m/s (même information que le split, moins lisible).
- **En bas, la barre de split** (à la place de la mini-courbe, trop écrasée pour être lue à 1,5 m).
- **Connexion** : un petit point vert dans un coin quand tout va bien ; un **bandeau bien visible seulement en cas de déconnexion ou de reconnexion**.
- Tailles en `min(vw, vh)` (unité `--u` des maquettes) : valeurs latérales à 20 `--u`, chrono à 18 `--u` (au-dessus de la taille de l'appli WaterRower, qui est la limite basse). Vérifier à 780 × 360 et 780 × 300.
- Couleurs : celles de `src/ui/styles.css` (`--pace` bleu, `--power` orange, `--ok` vert…).

## Barre de split
- Échelle **fixe**, de **2:30 à gauche à 1:50 à droite**, centrée sur 2:10 : vers la droite = plus vite. Bornes choisies d'après les 10 séances de rowerboard (sept.–nov. 2026 : médiane 2:08, 90 % du temps entre 1:55 et 2:28). C'est une constante, à décaler quand l'allure habituelle approchera 1:55–2:00.
- **Curseur** = split instantané : un **rectangle étroit** lumineux, qui dépasse de la barre (pas un disque).
- **Trait blanc** = split moyen (de la séance en libre ; de l'intervalle en cours en programme).
- Hors échelle : le curseur reste collé au bord, avec **◀** ou **▶**.
- Pas d'allure instantanée (arrêt, pause) : le curseur disparaît, le trait de moyenne reste.
- Programmes (v2) : **zone cible verte** pendant les efforts.

## Accueil (v1)
- En haut à gauche, l'icône et le nom **RowerMonitor**.
- Au centre, un **gros bouton « Connecter le rameur »** (bleu), avec en dessous le rappel « Réveille le S4 (appuie sur un bouton) et ferme WaterRower Connect », et la ligne des messages d'erreur.
- En bas, **la dernière séance** de l'historique : « Dernière séance : hier · 20:12 · 4 988 m · 2:00 /500 m ».
- Parcours : Connecter → choix du rameur par Chrome → **directement l'écran de séance** (en attente du premier coup). Pas de choix du type de séance en v1 (séance libre seulement) : il viendra avec la v2.
- Les boutons du **simulateur** n'apparaissent qu'avec `?dev` dans l'adresse (en haut à droite).

## Séance libre (v1)
- Anneau = **distance parcourue / 2000 m** (distance de référence en aviron) ; au-delà, il recommence un tour tous les 2000 m.
- Avant le premier coup : chrono à 0:00 et « Premier coup pour démarrer » sous le chrono.
- Au centre : « TEMPS ÉCOULÉ » et le chrono. Pas de distance dans l'anneau.
- **Aucun bouton pendant l'effort.**

## Pause, fin de séance, bilan (v1)
- **Pause automatique**, sans bouton : dès que la détection d'arrêt (`src/activity.js`) passe à « arrêt », la séance est en pause, **datée du dernier coup** (aucun temps mort compté). **Reprise automatique au premier coup.**
  - Délai de détection **adaptatif** : 1,5 × l'intervalle entre les deux derniers coups, entre 4 et 8 s (≈ 4 s à 21 coups/min, 6 s à 15 coups/min). Sur les séances réelles : arrêt vu 4,3 à 4,7 s après le dernier coup, sans fausse pause.
  - **Le chrono affiché ne recule jamais** : il s'arrête là où il est quand la pause est détectée. Le bilan, lui, retire ces quelques secondes (seul le temps de rame compte) : sa durée est donc un peu plus courte que le dernier chrono affiché.
- Le S4 n'a pas de pause : le chrono, la distance et les moyennes de la séance sont calculés par la PWA. La distance et les coups comptent à partir du premier coup ; le split moyen n'utilise que la distance parcourue en ramant (pas l'inertie pendant les pauses).
- En pause, **pas d'overlay** : chrono grisé, libellé « EN PAUSE », valeurs instantanées à `--`, curseur masqué, et un seul bouton rond **■** sous le chrono (fond sombre, carré et liseré rouge adouci).
- **Terminer = appui long ~1,5 s sur ■**, avec un anneau qui se remplit autour du bouton (pas de fenêtre de confirmation).
- Déconnexion Bluetooth : pause automatique + bandeau « Reconnexion… ».
- **Copie de secours** de la séance en cours (IndexedDB) toutes les quelques secondes : rien n'est perdu en cas de crash, de batterie vide ou de rechargement.
- **Écran bilan** : même gabarit. Durée au centre (« SÉANCE TERMINÉE »), autour : split moyen, puissance moyenne, cadence moyenne, distance ; meilleur 500 m.
- **Deux actions seulement** : **Ajouter au board** (export vers rowerboard, à coder plus tard ; en attendant, la séance est rangée dans l'historique local) ou **Ignorer la séance** (supprime la séance, appui long).

## Séances programmées (v2)
- Un programme est une suite de **phases** : un **segment seul** (échauffement, récup longue, retour au calme…) ou un **bloc d'intervalles répétés**. Le moteur regroupe tout seul les segments consécutifs qui se répètent ; le format de programme du brief § 6 ne change pas.
- **L'anneau montre la phase en cours** :
  - segment seul → un arc unique qui se remplit ;
  - bloc → la **frise** de ses intervalles, un arc par intervalle proportionnel à sa durée (effort orange, récup bleu-vert) ; passés vifs, à venir estompés, l'arc en cours se remplit.
  - Pourquoi : avec toute la séance sur l'anneau, l'échauffement et le retour au calme écrasent les intervalles (10 s de Tabata = 1 mm) ; par phase, ≥ 4,5 mm.
- Au centre : le libellé (« ÉCHAUFFEMENT », « EFFORT 3 / 8 », « S2 · RÉCUP 3 / 8 » s'il y a plusieurs séries) et le **compte à rebours** du segment, en grand, dans la couleur de la phase. **Pas d'aperçu de l'intervalle suivant** (inutile et illisible à distance).
- **Fond teinté** selon la phase (chaud en effort, froid en récup, neutre sinon) pour la vision périphérique.
- Cadence cible en petit sous la cadence pendant les efforts.
- Pas de pause automatique pendant les récupérations (s'arrêter y est normal).
- Fin automatique à la fin du programme, même bilan.
- Point à vérifier sur le téléphone : les arcs à venir, très estompés, se distinguent mal.
