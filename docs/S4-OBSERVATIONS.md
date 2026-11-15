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
