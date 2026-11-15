# rower-pwa

PWA d'entraînement pour rameur WaterRower (moniteur S4 + module BLE `S4 BLE 50`, service FTMS `0x1826`).
La spécification complète est dans [docs/BRIEF.md](docs/BRIEF.md) : c'est la source de vérité. La relire avant toute décision de conception.

## Principes non négociables
- **HTML / CSS / JS vanilla, modules ES, aucune étape de build, aucune dépendance runtime.** Pas de framework ni de librairie graphique (rendu natif HTML/CSS/SVG/canvas).
- **Cible : Chrome Android uniquement** (Web Bluetooth). Paysage plein écran.
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
- Débogage : `chrome://inspect` sur le Mac.
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
- Git local uniquement : **aucun push sans accord explicite de Nico** (GitHub Pages viendra plus tard, sur décision).

## Avancement
Versions et périmètre : brief § 16. Version en cours : **v1**.
- [x] Décodeur Rower Data `src/ftms.js` + tests (trames de référence du brief § 2, trames fragmentées, tronquées)
- [x] Encodeur `src/ftms-encoder.js` (avec découpage en trames de 20 octets) + faux rameur `src/sim.js` (scénarios repos / continu / HIIT, bruit reproductible)
- [x] Écran séance libre en paysage : gabarit `index.html` (zones `data-zone`), composants `src/ui/components.js`, configuration par type `src/ui/layouts.js`, câblage `src/app.js`
- [ ] Squelette PWA (manifeste, SW, icônes), `ble.js`, Wake Lock, export JSON, GitHub Pages
- À vérifier sur le vrai matériel : une trame complète (flags `0x0BFE`) fait 27 octets, plus que les 20 octets du MTU BLE par défaut. Le module la découpe-t-il (bit More Data) ?
