# Écrans de séance : décisions de conception

Décisions prises avec Nico le 2026-11-15, sur maquettes. Elles **précisent ou remplacent** le brief § 7 (gabarit à bandeau + zone principale + grille 2 × 2 + mini-courbe), qui est abandonné.

Une **seule maquette de référence**, cliquable : [maquette-cinematique.html](maquette-cinematique.html) (http://localhost:8080/docs/maquette-cinematique.html ; voir aussi [cinematique.md](cinematique.md)). Elle contient l'accueil (portrait et paysage), le choix de séance, les sélecteurs durée / distance, la liste des 6 programmes d'intervalles, la séance libre (avec pause), la séance durée / distance, la séance HIIT (boutons « Segment suivant » et « Phase suivante » pour dérouler échauffement, frise d'un bloc, récup, retour au calme) et le bilan. Les anciennes maquettes séparées (accueil, séance libre, HIIT, phases) ont été retirées : elles restent dans l'historique Git.

## Gabarit commun

```
┌──────────────────────────────────────────────────────────┐
│ SPLIT /500 m            ╭──────────╮          CADENCE  • │
│ 2:06                  ╭─╯  anneau  ╰─╮        22 /min    │
│                       │  libellé     │                   │
│ PUISSANCE             │  CHRONO      │        DISTANCE   │
│ 178 W                 ╰─╮  [⏸]     ╭─╯        1 250 m    │
│                         ╰──────────╯                     │
│ 2:30 ───────────── barre de split ──────────────── 1:50  │
└──────────────────────────────────────────────────────────┘
```

- **Pas de ligne du haut** : toute la hauteur va aux chiffres.
- **Au centre, un anneau** autour du chrono (ou du compte à rebours).
- **4 grandes valeurs**, deux de chaque côté : **split /500 m**, **puissance W**, **cadence** et **distance** (tout en **blanc** : la couleur est réservée au type de séance et aux phases, voir « Code couleur »). Pas de calories, pas de vitesse en m/s (même information que le split, moins lisible).
- **En bas, la barre de split** (à la place de la mini-courbe, trop écrasée pour être lue à 1,5 m).
- **Connexion** : un petit point vert dans un coin quand tout va bien ; un **bandeau bien visible seulement en cas de déconnexion ou de reconnexion**.
- Tailles en `min(vw, vh)` (unité `--u` des maquettes) : valeurs latérales à 20 `--u`, chrono à 18 `--u` (au-dessus de la taille de l'appli WaterRower, qui est la limite basse). Vérifier à 780 × 360 et 780 × 300.
- Couleurs : celles de `src/ui/styles.css` ; règles dans « Code couleur » ci-dessous.

## Code couleur
La couleur porte l'information, les boutons restent neutres (blanc cassé `#e8edf4`).

| Quoi | Couleur | Où |
|---|---|---|
| Durée | bleu `#4fc3f7` | icône ◔, arc de l'anneau en séance durée |
| Distance | violet `#b197fc` | icône ↔, arc de l'anneau en séance distance et en séance libre (un tour = 2000 m) |
| Séance libre | gris `#aab4c3` | icône ∞ |
| Intervalles | jaune `#ffd23f` | icône ▮▯▮ |
| **Phase effort** | **jaune** `#ffd23f` | arc, libellé, compte à rebours, zone cible de la barre de split, fond teinté |
| **Phase récupération** | **vert** `#4cd97b` | idem (récup longue entre séries comprise) |
| **Échauffement et retour au calme** | **bleu** `#4fc3f7` | idem ; même couleur pour les deux |

- Le bleu sert donc à la durée et à l'échauffement : pas de confusion possible, ce sont deux écrans différents, et le libellé écrit (« ÉCHAUFFEMENT », « EFFORT 3 / 8 », « RÉCUP ») reste toujours affiché.
- Jaune et vert se confondent pour certains daltoniens : la phase est aussi donnée par le libellé, par la longueur des arcs de la frise et par la teinte du fond.
- L'icône du type de séance est en haut de l'anneau (15 `--u`) ; les boutons du bas de l'anneau (« ‹ Retour » avant le premier coup, ⏸ en pause) sont **centrés entre le bas du texte et le bord intérieur de l'anneau** : marges égales au-dessus et en dessous.
- Maquette : [maquette-cinematique.html](maquette-cinematique.html) (bouton « ▶ Séance HIIT » ; fond teinté et zone cible jaune à l'effort).

## Zone cible de split (programmes)
- **Pendant les efforts seulement**, une bande jaune sur la barre de split : la fourchette à tenir.
- Elle se calcule **sans réglage** : un **repère personnel** (médiane du split moyen des 5 dernières séances enregistrées de plus de 10 min ; **2:15 sans historique**, valeur prudente de débutant) plus un **décalage selon la durée de l'effort**, sur 4 à 5 s de large :

| Durée de l'effort | Décalage sur le repère | Exemple avec 2:08 |
|---|---|---|
| ≤ 30 s | −8 à −4 s | 2:00 – 2:04 |
| ≤ 1 min | −6 à −2 s | 2:02 – 2:06 |
| ≤ 2 min | −3 à 0 s | 2:05 – 2:08 |
| plus long | −1 à +3 s | 2:07 – 2:11 |

- La zone se recalcule à **chaque effort** (dans une pyramide, elle change avec la durée de l'effort).
- Les décalages sont des conventions à ajuster sur le ressenti ; le repère suit les progrès.
- On préfère la médiane au meilleur 500 m, qui est un record trop optimiste pour des répétitions.

## Lissage des valeurs instantanées
- Le S4 envoie une valeur brute par coup : la puissance saute de ±7 W d'un coup à l'autre, le split est un nombre entier de secondes. Son écran, lui, est lissé (séance du 18/11, voir [S4-OBSERVATIONS.md](S4-OBSERVATIONS.md)).
- **Puissance et split affichés = moyenne des 3 derniers coups** (**2** pendant un programme, où les efforts sont courts). Le split est moyenné en **vitesse** (500 / split) puis ré-inversé : un seul coup très lent ne fausse pas la moyenne (120 s et 180 s donnent 144 s, pas 150 s). Une mesure n'est prise que sur un **nouveau coup** : les valeurs n'arrivent qu'à chaque coup.
- À l'arrêt (valeurs masquées par la détection d'arrêt), la fenêtre est **vidée** : une reprise n'est pas mélangée aux anciens coups.
- Cadence, distance et chrono ne sont pas lissés. Le curseur de la barre de split et le chiffre du split viennent de la même valeur lissée.
- **Affichage seulement** : la séance, ses moyennes, la copie de secours et l'export gardent les valeurs brutes. Retard introduit : environ 4 à 5 s au centre de la fenêtre à 20 coups/min (`src/smooth.js`).

## Barre de split
- Échelle **fixe**, de **2:30 à gauche à 1:50 à droite**, centrée sur 2:10 : vers la droite = plus vite. Bornes choisies d'après les 10 séances de rowerboard (sept.–nov. 2026 : médiane 2:08, 90 % du temps entre 1:55 et 2:28). C'est une constante, à décaler quand l'allure habituelle approchera 1:55–2:00.
- **Curseur** = split instantané **lissé** (voir « Lissage ») : un **rectangle étroit** lumineux, qui dépasse de la barre (pas un disque).
- **Losange blanc ◆** = split moyen (de la séance en libre ; de l'intervalle en cours en programme), posé **sur** la barre, au-dessus du curseur. Choisi sur rendu à l'échelle (variantes triangle ▼ au-dessus, losange, pastille avec valeur) : il ne coûte aucune hauteur, alors qu'un triangle au-dessus de la barre aurait rétréci l'anneau d'environ 5 %, et sa forme se distingue du rectangle bleu.
- Hors échelle : le curseur et le losange restent collés au bord, avec **◀** ou **▶**.
- Pas d'allure instantanée (arrêt, pause) : le curseur disparaît, le losange de moyenne reste.
- Programmes (v2) : **zone cible jaune** (couleur de l'effort) pendant les efforts. Le vert est réservé à la récupération.

## Sélection de la séance (écran racine, remplace l'accueil)
Maquette : [maquette-cinematique.html](maquette-cinematique.html). **Plus d'écran d'accueil** : l'appli s'ouvre directement sur « Sélectionner la séance », rameur non connecté. **Tout est en paysage** (manifeste `orientation: landscape` ; en onglet Chrome non installé, « Tourne le téléphone en paysage » s'affiche en portrait).
- **Panneau de gauche** :
  - en haut, le nom **RowerMonitor** (« Rower » demi-gras blanc, « Monitor » fin bleu) et, **centré dessous, le logo** (ligne de battement de cœur, en SVG dans la page) ;
  - en bas, **sous l'axe médian**, le titre « Sélectionner la séance » et, dessous, un **bouton discret de connexion** : « ⌁ Connecter » → « Recherche… » (atténué) → « ✓ Connecté » (un appui **déconnecte**, ce qui libère le S4 pour une autre appli) ;
  - sous le bouton, **une ligne de message** en jaune, deux lignes réservées pour que le texte ne décale jamais la mise en page : « S4 non détecté » (toutes les causes d'échec ; le détail reste dans le journal `window.__rower.events`), « Séance enregistrée. Fichier partagé. », « Bluetooth indisponible » ;
  - tout en bas, le numéro de build, très discret.
- **Tuiles** (Libre, Durée, Distance, Intervalles) : **grisées tant que le rameur n'est pas connecté**.
- **Pas de point vert de connexion** (à peine visible sur le S23) : l'état est écrit (« ✓ Connecté »). Seul le bandeau rouge « Reconnexion… » signale une coupure en séance.
- **Titres sous l'axe médian** : sur cet écran, sur le sélecteur circulaire et sur la liste des programmes, le haut du titre reste sous le milieu de l'écran ; logo ou bouton « ‹ Retour » en haut, titre et icône groupés en bas.
- Le **sélecteur Bluetooth de Chrome** (fenêtre « … tente de s'associer ») ne peut être ni stylé ni évité par une page. « Connecter » essaie d'abord le rameur déjà autorisé (`navigator.bluetooth.getDevices()`) ; si ça échoue, le sélecteur s'ouvre. **Sur le S23, `getDevices()` demande d'activer `chrome://flags/#enable-web-bluetooth-new-permissions-backend`** ; la 1ʳᵉ connexion après activation passe par le sélecteur.
- Parcours : Connecter → tuiles actives → choix de la séance → écran de séance en attente du premier coup. **Avant le premier coup, un seul bouton « ‹ Retour »** (le même que sur les autres écrans, au centre bas de l'anneau, marges égales avec le texte au-dessus et le bord de l'anneau) ramène à la sélection, sans bilan, rameur toujours connecté. Après un bilan (Enregistrer ou Ignorer), retour à la sélection, **rameur toujours connecté** pour enchaîner deux séances.
- Les boutons du **simulateur** n'apparaissent qu'avec `?dev` dans l'adresse (en haut à droite de la sélection).
- Geste Retour d'Android sur cet écran : il quitte l'appli (écran racine ; la connexion Bluetooth est perdue, rien à sauver).

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
- En pause, **pas d'overlay** : chrono grisé, libellé « EN PAUSE », valeurs instantanées à `--`, curseur masqué, et un seul bouton rond **⏸** sous le chrono (« ‹ Retour » avant le premier coup) (fond sombre, symbole et liseré rouge adouci).
- **Terminer = un appui sur ⏸ (en pause seulement)**, effet immédiat (pas d'appui long ni de confirmation) : on arrive sur le bilan, où la séance peut encore être ignorée. Le bouton n'existe qu'en pause : il ne se montre jamais pendant l'effort. **Avant le premier coup** (connecté, en attente), c'est « ‹ Retour » qui est affiché à sa place : retour direct à la sélection, **sans bilan** (rien n'a été ramé : copie de secours éventuelle supprimée), rameur toujours connecté. Le libellé accessible de ⏸ reste « Terminer la séance ».
- Déconnexion Bluetooth : pause automatique + bandeau « Reconnexion… ».
- **Copie de secours** de la séance en cours (IndexedDB) toutes les quelques secondes : rien n'est perdu en cas de crash, de batterie vide ou de rechargement.
- **Écran bilan** : même gabarit. Durée au centre (« SÉANCE TERMINÉE »), autour : split moyen, puissance moyenne, cadence moyenne, distance ; meilleur 500 m.
- **Deux actions seulement** : **Enregistrer la séance** (la range dans l'historique local **et** la partage, dans le même geste, par le partage Android vers le dossier Drive lu par l'artefact RowerBoard ; voir CLAUDE.md, « Export et dashboard ») ou **Ignorer la séance** (supprime la séance ; appui long, rempli progressivement, sans mention à l'écran).

## Séances programmées (v2)
- Un programme est une suite de **phases** : un **segment seul** (échauffement, récup longue, retour au calme…) ou un **bloc d'intervalles répétés**. Le moteur regroupe tout seul les segments consécutifs qui se répètent ; le code utilise la **forme compacte** de la maquette (`src/programs.js` : phases = segment seul ou bloc `{ reps, work, rest }` / `{ efforts, rest }`), que `src/engine.js` développe en segments plats (`warmup`, `work`, `rest`, `cooldown`) équivalents à ceux du brief § 6. Le modèle du brief (segments + `repeat`) reste la référence conceptuelle ; il n'est pas stocké tel quel. Dans le fichier d'export, `program.kind` vaut `intervals`.
- **L'anneau montre la phase en cours** :
  - segment seul → un arc unique qui se remplit ;
  - bloc → la **frise** de ses intervalles, un arc par intervalle proportionnel à sa durée (effort jaune, récup vert) ; passés vifs, à venir estompés, l'arc en cours se remplit.
  - Pourquoi : avec toute la séance sur l'anneau, l'échauffement et le retour au calme écrasent les intervalles (10 s de Tabata = 1 mm) ; par phase, ≥ 4,5 mm.
- Au centre : le libellé (« ÉCHAUFFEMENT », « EFFORT 3 / 8 », « S2 · RÉCUP 3 / 8 » s'il y a plusieurs séries) et le **compte à rebours** du segment, en grand, dans la couleur de la phase. **Pas d'aperçu de l'intervalle suivant** (inutile et illisible à distance).
- **Fond teinté** selon la phase (jaune sombre en effort, vert sombre en récup, bleu sombre à l'échauffement et au retour au calme) pour la vision périphérique.
- Pas de cadence cible affichée sous la cadence (décision du 2026-11-20 : ces chiffres ne parlent pas à un débutant) ; seule la zone cible jaune de la barre de split reste.
- Pas de pause automatique pendant les récupérations (s'arrêter y est normal). **Implémentation** : le programme tourne sur l'horloge murale de la séance (`wallElapsed`, du premier coup à maintenant, pauses comprises), pas sur le chrono de séance ; la récupération dure donc ses 60 s que le rameur continue ou s'arrête. La séance date toujours ses arrêts en interne (moyennes justes) mais l'écran de programme ne montre jamais « EN PAUSE » ; le bouton ⏸ apparaît en attente et quand la séance est en arrêt, et sert de sortie.
- Limite connue : le losange blanc de la barre est le split moyen de toute la séance, pas encore celui de l'intervalle en cours.
- Fin automatique à la fin du programme, même bilan.
- Point à vérifier sur le téléphone : les arcs à venir, très estompés, se distinguent mal.
