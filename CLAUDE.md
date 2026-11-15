# rower-pwa

PWA d'entraînement pour rameur WaterRower (moniteur S4 + module BLE `S4 BLE 50`, service FTMS `0x1826`), utilisée sur un Samsung Galaxy S23.

Documents de référence, à relire avant toute décision de conception :
- [docs/BRIEF.md](docs/BRIEF.md) : la spécification d'origine (source de vérité, sauf là où un document plus récent la précise) ;
- [docs/ECRAN.md](docs/ECRAN.md) : les écrans de séance décidés sur maquettes, qui **remplacent le brief § 7** ;
- [docs/S4-OBSERVATIONS.md](docs/S4-OBSERVATIONS.md) : le comportement réel du S4 en Bluetooth (valeurs périmées, coup fantôme, pas de pause…) ;
- [docs/PLAN-ecran-v1.md](docs/PLAN-ecran-v1.md) : le plan en cours.

## Principes non négociables
- **HTML / CSS / JS vanilla, modules ES, aucune étape de build, aucune dépendance runtime.** Pas de framework ni de librairie graphique (rendu natif HTML / CSS / SVG).
- **Cible : Galaxy S23, Chrome Android** (Web Bluetooth ; jamais Samsung Internet, le navigateur par défaut). Paysage plein écran.
  - Viewport CSS en paysage : **780 × 360** en plein écran, environ **780 × 300** avec la barre d'adresse. Vérifier toute mise en page aux deux tailles.
  - Densité × 3 ; caméra perforée sur le côté → marges `env(safe-area-inset-*)` avec `viewport-fit=cover`.
  - Tailles en `min(vw, vh)` pour rester lisible dans les deux cas, à 1,5 m.
- **Chemins relatifs partout** (site servi en sous-chemin sur GitHub Pages) : imports, manifeste (`start_url`, `scope`), service worker.
- **Aucun secret dans le code** : le dépôt et le site seront publics. Les données de séance restent sur le téléphone.
- Le format d'export `rower-session/1` (brief § 11) est le **seul contrat** avec le dashboard : toute évolution passe par une nouvelle version du schéma.
- Le décodeur FTMS parse **selon les flags**, jamais selon une valeur de flags codée en dur.

## Structure
```
index.html  manifest.webmanifest*  sw.js*  .nojekyll
src/  ftms.js          décodeur Rower Data (pur)
      ftms-encoder.js  encodeur de trames (simulateur, tests)
      sim.js           faux rameur (scénarios repos / continu / HIIT)
      ble.js           connexion Web Bluetooth + reconnexion
      activity.js      détection d'arrêt (attente / en cours / arrêt)
      wakelock.js      écran maintenu allumé
      session.js       chrono, pause auto, cumuls et bilan de la séance (pur)
      store.js         IndexedDB : copie de secours, historique
      engine.js*  audio.js*  export.js*   (v2 et suivantes)
      app.js           câblage
      ui/  components.js  layouts.js  format.js  styles.css
test/  *.test.js  helpers.js  fixtures/ (séances réelles du S4)
docs/  BRIEF.md  ECRAN.md  S4-OBSERVATIONS.md  PLAN-*.md  maquette-*.html
scripts/  phone-eval.js  sim-demo.js
```
`*` : à venir.

## Commandes
- Serveur local : `python3 -m http.server 8080`, puis http://localhost:8080.
  - `?sim=steady` (ou `hiit`, `startstop`, `rest`) démarre directement le simulateur ; `&speed=10` accélère (10 s simulées par seconde).
  - Maquettes : http://localhost:8080/docs/maquette-seance-libre.html (et `maquette-hiit.html`, `maquette-phases.html`).
- Tests : `npm test` (= `node --test test/*.test.js`, runner intégré à Node, sans dépendance). Trames de test : `encodeRowerData` (`src/ftms-encoder.js`) et `test/helpers.js`.
- Capture d'une page à la taille du S23, sans téléphone :
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --force-device-scale-factor=3 --window-size=780,300 --screenshot=out.png "http://localhost:8080/?sim=steady"`
- Démo du faux rameur en terminal : `node scripts/sim-demo.js [rest|steady|hiit] [secondes] [pas]`.

### Sur le téléphone (USB)
- `adb reverse tcp:8080 tcp:8080`, puis ouvrir `http://localhost:8080` dans Chrome Android (localhost = contexte sécurisé : Web Bluetooth et service worker sans HTTPS).
- Ouvrir la page : `adb shell am start -a android.intent.action.VIEW -d "http://localhost:8080/" com.android.chrome`. Capture : `adb exec-out screencap -p > s23.png`.
- Journal de la page (`window.__rower` : trames brutes, série seconde par seconde, événements) : `node scripts/phone-eval.js` ; `--reload` recharge sans cache après une modification. L'écran du téléphone doit rester allumé et Chrome au premier plan. Sinon `chrome://inspect` sur le Mac.
- `adb` vient de `~/Brewfile` (`android-platform-tools`). Le S23 apparaît dans `adb devices` sous le numéro `RFCW90GPR7V`. Si la liste est vide ou indique `unauthorized` :
  1. sur le Mac, autoriser l'accessoire USB (Réglages Système → Confidentialité et sécurité → « Autoriser les accessoires à se connecter ») ;
  2. sur le S23, Options de développement : « Débogage USB » activé, anciennes autorisations révoquées, configuration USB par défaut sur « Transfert de fichiers » ; rebrancher et accepter la fenêtre ;
  3. vérifier que l'Auto Blocker Samsung est désactivé.

## Architecture
- **Chaîne de données** : source (`sim.js` ou `ble.js`) → `parseRowerData` → `createRowerState` (fusion) → `activity` (masque les valeurs instantanées hors effort) → séance → écran.
- **Contrat « source de données »** : `sim.js` et `ble.js` exposent la même interface, pour que l'appli ne sache pas à quoi elle parle : un `EventTarget` avec `connect()`, `disconnect()`, des événements `status` (`connecting` | `connected` | `disconnected`), `data` (un `DataView` par notification Rower Data) et `log` (texte, BLE seulement).
- **Interface : gabarit + composants + configurations.** `index.html` porte le gabarit commun (zones `data-zone`). Un composant est une fabrique `{ mount(el), update(model) }` : `mount` construit le DOM une fois, `update` ne change que textes et attributs. Un type de séance (ou le bilan) = une entrée de `LAYOUTS` (zone → composant) ; en ajouter un ne touche ni le gabarit ni les composants existants.
- Fonctions d'affichage et de calcul **pures** (`ftms.js`, `activity.js`, `session.js`, `ui/format.js`, futur `engine.js`) : ni DOM ni Web Bluetooth, testées sous Node. Le temps est passé en paramètre (`now`), jamais lu en interne.

## Conventions
- Code, identifiants et commentaires : anglais. Documentation et messages de commit : français.
- Remote : https://github.com/ndelucin/rower-pwa (**privé**, sauvegarde). **Aucun push sans accord explicite de Nico.** Passage en public + GitHub Pages plus tard, sur sa décision.
- Identité Git locale au dépôt : e-mail anonyme GitHub (`…+ndelucin@users.noreply.github.com`), jamais l'adresse personnelle.
- Rien d'identifiant dans le dépôt (adresse Bluetooth du rameur, e-mail…).

## Avancement
Versions et périmètre : brief § 16. Version en cours : **v1**.
- [x] Décodeur `ftms.js`, encodeur `ftms-encoder.js` et faux rameur `sim.js`, testés
- [x] Connexion Bluetooth `ble.js` (reconnexion automatique), validée sur le vrai rameur : trames de 27 octets en un seul envoi, jamais découpées
- [x] Détection d'arrêt `activity.js`, testée en rejouant deux séances réelles
- [x] Écran maintenu allumé (`wakelock.js`), vérifié sur le S23
- [x] Écrans de séance décidés sur maquettes : [docs/ECRAN.md](docs/ECRAN.md)
- [x] Nouvel écran de séance libre, pause auto (`session.js`), bilan, copie de secours (`store.js`) : [docs/PLAN-ecran-v1.md](docs/PLAN-ecran-v1.md). Vérifié au simulateur (scénario `startstop`) ; **reste l'essai sur le vrai rameur**
- [ ] Squelette PWA installable : manifeste (`display: fullscreen`, `orientation: landscape`, chemins relatifs), icônes, service worker avec « nouvelle version disponible »
- [ ] Export JSON `rower-session/1` (« Ajouter au board » du bilan)
- [ ] GitHub Pages : implique de passer le dépôt en public (décision de Nico)

## Questions en suspens
- Distance affichée par le S4 en fin de 2ᵉ essai, à comparer aux 174 m reçus.
- Un coup très léger (≈ 25 W) juste après un arrêt compte comme une reprise : à confirmer sur le rameur (avec la pause auto, il ferait repartir le chrono).
- À la détection d'un arrêt, le chrono recule des ~6 s de détection (la pause est datée du dernier coup) : à juger sur le rameur.
- Rowerboard : dans les fichiers TCX du S4, les watts donnent un split ~13 s plus lent que la distance (médiane 2:21 contre 2:08). Ça peut fausser les watts du dashboard.
- Rattrapage `brew bundle` : le Mac diverge de `~/Brewfile` (node, git, gh, pyenv, quelques apps) ; `~/Brewfile` n'est versionné nulle part.
