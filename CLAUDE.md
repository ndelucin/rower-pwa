# rower-pwa

PWA d'entraînement pour rameur WaterRower (moniteur S4 + module BLE `S4 BLE 50`, service FTMS `0x1826`).
La spécification complète est dans [docs/BRIEF.md](docs/BRIEF.md) : c'est la source de vérité. La relire avant toute décision de conception.

## Principes non négociables
- **HTML / CSS / JS vanilla, modules ES, aucune étape de build, aucune dépendance runtime.** Pas de framework ni de librairie graphique (rendu natif HTML/CSS/SVG/canvas).
- **Cible : Samsung Galaxy S23, Chrome Android** (Web Bluetooth ; ne pas utiliser Samsung Internet, le navigateur par défaut). Paysage plein écran.
  - Viewport CSS en paysage : **780 × 360** en plein écran, environ **780 × 300** avec la barre d'adresse de Chrome. Vérifier toute mise en page à ces deux tailles.
  - Densité ×3 ; caméra perforée sur le côté en paysage → marges `env(safe-area-inset-*)` avec `viewport-fit=cover`.
  - Tailles de police en `min(vw, vh)` pour rester lisible dans les deux cas.
- **Chemins relatifs partout** (site servi en sous-chemin sur GitHub Pages) : imports, manifeste (`start_url`, `scope`), enregistrement du service worker.
- **Aucun secret dans le code** : le dépôt et le site seront publics. Les données de séance restent sur le téléphone.
- Le format d'export `rower-session/1` (brief § 11) est le **seul contrat** avec le dashboard : toute évolution passe par une nouvelle version du schéma.
- Le décodeur FTMS parse **selon les flags**, jamais selon une valeur de flags codée en dur.

## Structure cible
```
index.html  manifest.webmanifest  sw.js  .nojekyll
src/  ftms.js  ftms-encoder.js  ble.js  engine.js  store.js  audio.js  export.js  sim.js  ui/
test/ *.test.js
icons/
docs/ BRIEF.md
```

## Commandes
- Serveur local : `python3 -m http.server 8080` puis http://localhost:8080
  - `?sim=hiit` (ou `steady`, `rest`) démarre directement le simulateur ; `&speed=10` accélère la séance (10 s simulées par seconde).
- Tests unitaires : `npm test` (= `node --test test/*.test.js`, runner intégré à Node, sans dépendance). `test/frame-builder.js` fabrique des trames FTMS pour les tests.
- Test sur le téléphone (USB) : `adb reverse tcp:8080 tcp:8080`, puis ouvrir `http://localhost:8080` dans Chrome Android (localhost = contexte sécurisé, donc Web Bluetooth et service worker fonctionnent sans HTTPS).
  - Ouvrir directement sur le téléphone : `adb shell am start -a android.intent.action.VIEW -d "http://localhost:8080/" com.android.chrome`. Capture d'écran : `adb exec-out screencap -p > s23.png`.
  - `adb` vient de `~/Brewfile` (`android-platform-tools`). S23 détecté par `adb devices` sous le numéro `RFCW90GPR7V`.
  - Si `adb devices` est vide ou indique `unauthorized` :
    1. sur le Mac, autoriser l'accessoire USB (Réglages Système → Confidentialité et sécurité → « Autoriser les accessoires à se connecter ») ;
    2. sur le S23, dans les Options de développement : activer « Débogage USB », révoquer les anciennes autorisations, régler la configuration USB par défaut sur « Transfert de fichiers », puis rebrancher et accepter la fenêtre ;
    3. vérifier que l'Auto Blocker Samsung est désactivé.
- Débogage : `chrome://inspect` sur le Mac, ou `node scripts/phone-eval.js` qui lit le journal `window.__rower` de la page ouverte sur le téléphone (trames brutes, série seconde par seconde, événements). `node scripts/phone-eval.js --reload` recharge la page sans cache après une modification. L'écran du téléphone doit rester allumé.
- Démo du faux rameur en terminal : `node scripts/sim-demo.js [rest|steady|hiit] [secondes] [pas]`

## Interface : gabarit + composants + configurations
- `index.html` contient le gabarit commun : zones `banner`, `status`, `main`, `side`, `progress`.
- Un composant est une fabrique `{ mount(el), update(model) }`. `mount` construit le DOM une fois, `update` ne change que les textes. `model = { values, history, status, sourceLabel }`.
- Un type de séance = une entrée de `LAYOUTS` (zone → composant). Ajouter un type ne touche ni le gabarit ni les composants existants.
- Fonctions d'affichage pures (formats, tracé de courbe) dans `src/ui/format.js`, testées sous Node.

## Contrat « source de données »
`src/sim.js` (`createSimSource`) et le futur `src/ble.js` exposent la **même interface**, pour que l'appli ne sache pas si elle parle au vrai rameur ou au simulateur : un `EventTarget` avec `connect()`, `disconnect()`, des événements `status` (`connecting` | `connected` | `disconnected`) et `data` (un `DataView` par notification Rower Data).

## Conventions
- Code, identifiants et commentaires : anglais. Documentation et messages de commit : français.
- Modules purs (`ftms.js`, `engine.js`) sans accès au DOM ni à Web Bluetooth, pour rester testables sous Node.
- Remote : https://github.com/ndelucin/rower-pwa (**privé**, sauvegarde). **Aucun push sans accord explicite de Nico.** Passage en public + GitHub Pages plus tard, sur décision.
- Identité Git locale au dépôt : e-mail anonyme GitHub (`…+ndelucin@users.noreply.github.com`), jamais l'adresse personnelle : le dépôt deviendra public.
- Rien d'identifiant dans le dépôt (adresse Bluetooth du rameur, e-mail, etc.).

## Avancement
Versions et périmètre : brief § 16. Version en cours : **v1**.
- [x] Décodeur Rower Data `src/ftms.js` + tests (trames de référence du brief § 2, trames fragmentées, tronquées)
- [x] Encodeur `src/ftms-encoder.js` (avec découpage en trames de 20 octets) + faux rameur `src/sim.js` (scénarios repos / continu / HIIT, bruit reproductible)
- [x] Écran séance libre en paysage : gabarit `index.html` (zones `data-zone`), composants `src/ui/components.js`, configuration par type `src/ui/layouts.js`, câblage `src/app.js`
- [x] Connexion Bluetooth `src/ble.js` (reconnexion automatique), **validée sur le vrai rameur** : voir [docs/S4-OBSERVATIONS.md](docs/S4-OBSERVATIONS.md)
- [x] Détection d'arrêt `src/activity.js` (attente / en cours / arrêt), testée en rejouant la vraie séance enregistrée
- [x] Écran maintenu allumé pendant la séance (`src/wakelock.js`, Screen Wake Lock), vérifié sur le S23
- [ ] Squelette PWA (manifeste, SW, icônes), export JSON, GitHub Pages
- Vérifié sur le vrai matériel : trames de 27 octets en un seul envoi, jamais découpées.

### Prochaines étapes et points ouverts
1. **Squelette PWA installable** : manifeste (`display: fullscreen`, `orientation: landscape`, chemins relatifs), icônes, service worker avec message « nouvelle version disponible ».
2. **Enregistrement + export JSON** `rower-session/1` (brief § 11), téléchargement et partage.
3. **GitHub Pages** : implique de passer le dépôt en **public** (décision de Nico).
4. **Retouches de l'écran « à froid »** (décision de Nico : Bluetooth d'abord, affichage ensuite) : lisibilité à 1,5 m sur le support du rameur, libellés, métriques utiles.
   - Retour de Nico sur l'appli officielle WaterRower Connect (2026-11-15) :
     - à garder : le **gros chrono central** (temps écoulé), entouré d'un **anneau de progression** (distance parcourue / 2000 m) ;
     - à éviter : les 6 petits panneaux autour, avec des chiffres minuscules ;
     - inutiles : les **calories**, et le temps écoulé en double dans un panneau.
   - Maquette retenue (séance libre) : chrono central + anneau distance / 2000 m ; autour, 4 grandes valeurs : **split /500 m**, **puissance (W)**, **cadence**, **distance**. Vitesse en m/s écartée (même information que le split, moins lisible, ne correspond pas aux consignes des programmes).      - En bas, la courbe du split est remplacée par une **barre de split** horizontale, plus lisible à distance :
       - échelle fixe de **2:30 (à gauche) à 1:50 (à droite)**, centrée sur 2:10 ; vers la droite = plus vite ;
       - **curseur ▲** pour le split instantané ; **ligne │** pour le split moyen depuis le début ;
       - hors de l'échelle, le curseur reste collé au bord avec ◀ ou ▶ ;
       - bornes choisies d'après les 10 séances de rowerboard (sept.–nov. 2026) : médiane 2:08, 90 % du temps entre 1:55 et 2:28 ;
       - les bornes sont une constante, à décaler quand l'allure habituelle approchera 1:55–2:00 ;
       - v2 : une zone cible verte s'y ajoute pour les programmes.
       - L'historique de la séance (courbe) relève du tableau de bord, après export.
     - **Pas de ligne du haut** (type de séance + état de connexion), pour gagner de la hauteur :
       - l'état de la séance (« en attente du premier coup », « arrêt ») s'affiche sous le chrono ;
       - la connexion : un petit point dans un coin quand tout va bien, et un **bandeau bien visible seulement en cas de déconnexion ou de reconnexion**.
5. Questions en suspens :
   - Distance affichée par le S4 en fin de 2e essai, à comparer aux 174 m reçus.
   - Un coup très léger (≈ 25 W) juste après un arrêt compte comme une reprise : comportement à confirmer.
   - Rattrapage `brew bundle` : le Mac diverge de `~/Brewfile` (node, git, gh, pyenv, quelques apps) ; `~/Brewfile` n'est versionné nulle part.
