# Comportement réel du S4 en Bluetooth (FTMS)

Relevés du 2026-11-15 : WaterRower S4 + module `S4 BLE 50`, Galaxy S23, Chrome Android.
Données brutes décodées, une ligne par seconde S4 : [`test/fixtures/s4-2026-11-15-series.json`](../test/fixtures/s4-2026-11-15-series.json).

## Transport
- Chaque notification Rower Data fait **27 octets**, en **un seul envoi** : jamais de découpage (bit More Data toujours à 0). Chrome négocie un MTU suffisant.
- Flags **toujours `0x0BFE`** (201 trames sur 201).
- Environ **2,3 notifications par seconde**, y compris au repos.
- Connexion en ~1 s, sans appairage.

## Rythme de mise à jour des champs
- **Chaque seconde** : temps écoulé, distance, allure moyenne.
- **À chaque coup de rame** (toutes les ~3 s à 20 coups/min) : cadence, nombre de coups, allure instantanée, puissance, énergie par heure / minute.
- La puissance suit la formule classique des ergomètres : `P = 2,8 × (500 / split)³` (ex. split 139 s → 130 W calculés, 127 W reçus).

## Pièges pour l'affichage et le moteur de séance
1. **Valeurs périmées au démarrage** : à la connexion, le S4 renvoie la cadence et l'allure de la séance précédente (17 coups/min, 3:05) tant qu'on n'a pas ramé.
2. **Le chrono démarre au premier mouvement** de la poignée, quelques secondes avant le premier coup compté ; la distance augmente aussi avant.
3. **À l'arrêt (~4 s après le dernier coup)** : allure instantanée à « pas de donnée » (`0xFFFF`) et cadence à 0, mais **puissance et énergie restent figées** sur la dernière valeur.
4. **Après ~13 s d'arrêt**, une trame bascule dans un état incohérent : un coup « fantôme » (+1), cadence et allure instantanée **reprennent leurs dernières valeurs**, tandis que puissance, puissance moyenne, cadence moyenne et énergie/h retombent à 0.
5. **Le chrono et l'allure moyenne continuent** pendant l'arrêt (le S4 n'a pas de pause) ; la distance progresse encore de quelques mètres (inertie de la roue à eau).

→ L'appli ne doit pas afficher les valeurs instantanées telles quelles : il faut une **détection d'arrêt** côté PWA (par exemple : coups qui n'augmentent plus depuis quelques secondes, ou puissance nulle) qui affiche `--`, et le moteur de séance doit gérer la pause lui-même (brief § 6).

## Détection d'arrêt validée (2026-11-15, séance start-stop)
- Trames brutes : [`test/fixtures/s4-2026-11-15-startstop-raw.json`](../test/fixtures/s4-2026-11-15-startstop-raw.json) (254 trames, 137 s, 4 périodes d'effort).
- Chaque arrêt est détecté **6 s après le dernier coup**, chaque reprise **au premier coup** ; rejouée dans les tests, la séance donne exactement les mêmes transitions que celles vues sur le téléphone.
- Le chrono du S4 démarre au mouvement de la poignée : ici **11 s** avant le premier coup compté.
- Un coup très léger (25 W) juste après un arrêt est compté comme une reprise : c'est le comportement voulu.

## Essai du nouvel écran v1 (2026-11-15, séance avec pause automatique)
- Trames brutes : [`test/fixtures/s4-2026-11-15-ecran-v1-raw.json`](../test/fixtures/s4-2026-11-15-ecran-v1-raw.json) (712 trames, 3 périodes de rame, fin par ■). Rejouée hors ligne, la séance donne exactement le bilan affiché sur le téléphone : 2:17, 604 m, split moyen 2:13, 106 W, 20 coups/min, meilleur 500 m 2:12.
- **Le coup fantôme ne remet pas toujours la puissance à 0** : ici il est arrivé 12 s puis 20 s après l'arrêt avec la puissance figée (127 W, 111 W), ce qui faisait reprendre la séance 0,2 à 0,7 s. Sa signature : le nombre de coups augmente alors que la **puissance et la distance sont exactement celles de la trame précédente**. Une vraie reprise change la puissance (même un coup léger à 16 W). Règle ajoutée à `src/activity.js`.
- Un coup léger (16 W) après un arrêt a bien relancé la séance, suivi d'une vraie période de rame.

## Comparaison avec l'écran du S4 (séance du 18/11/2026)
Export de la PWA : [`test/fixtures/rower-session-2026-11-18.json`](../test/fixtures/rower-session-2026-11-18.json) (`rower-session/1`, 312 échantillons). Comparé à la vidéo de l'écran du S4 : 313 s de rame, 5 min d'effort continu puis reprise. Méthode : une image toutes les 10 s (AVFoundation), lecture manuelle, alignement par la distance et le chrono du S4 ; incertitude de quelques secondes après les pauses.

- **Distance** : PWA − S4 = +2,6 m en moyenne (de −1 à +6 m) sur les 2 premières minutes sans arrêt.
- **Cadence** : identique à ±0,2 coup/min en moyenne (de −3 à +4 en instantané).
- **Split instantané** : celui de la PWA est plus lent que l'écran du S4 de 3,2 s en moyenne (pics à +14 s au redémarrage). Les splits reçus en BLE sont des entiers de secondes, mis à jour à chaque coup. À 1019 m, un instantané : le S4 affichait 2:34 /500 m (26 c/min), le BLE donnait 2:02 (24 c/min) : l'affichage du S4 a du retard ou lisse.
- **Modes d'affichage du S4** : « /2km » (valeur = 4 × split : 9:07 = 2:16,75 aux 500 m), « /500m », « average » et « watts », selon le mode choisi sur l'appareil.
- **Horloge** : celle du S4 se fige quand on ne rame plus (arrêt de quelques secondes). Celle de la PWA exclut les pauses (datées au dernier coup) : en fin de séance elle affichait environ 70 s de moins que le S4, et un split moyen de 2:09,5 contre environ 2:26 sur le S4. **Cause non établie**, probablement une pause automatique déclenchée trop tôt en rame lente : le S4 affichait 16 à 20 coups/min pendant ~45 s alors que la PWA les comptait en pause. Les trames brutes n'ont pas été conservées (`window.__rower.raw` est en mémoire seulement, jamais exporté) : à capturer à la prochaine séance test (`node scripts/phone-eval.js`).
- **Puissance** : les watts BLE valent en moyenne 0,8 × la formule 2,8 × (500/split)³. Le S4 affiche une valeur lissée (125–133 W en régime stable) alors que la valeur BLE instantanée saute de ±7 W d'un coup à l'autre (127–141 W). Pas de lissage dans la PWA aujourd'hui ; piste, non implémentée : lisser sur les 3 derniers **coups** (pas 3 secondes : les valeurs n'arrivent qu'à chaque coup).
- **Distance du bilan** : `summary.distance` (1341 m) dépasse de 136 m la dernière distance échantillonnée (1205 m) : la première est la distance totale depuis le premier coup, la seconde la distance « active » (hors pauses de la PWA).
