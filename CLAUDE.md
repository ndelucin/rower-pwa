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
src/  ftms.js  ble.js  engine.js  store.js  audio.js  export.js  sim.js  ui/
test/ *.test.js
icons/
docs/ BRIEF.md
```

## Commandes
- Serveur local : `python3 -m http.server 8080` puis http://localhost:8080
- Tests unitaires : `node --test` (runner intégré à Node, sans dépendance)
- Test sur le téléphone (USB) : `adb reverse tcp:8080 tcp:8080`, puis ouvrir `http://localhost:8080` dans Chrome Android (localhost = contexte sécurisé, donc Web Bluetooth et service worker fonctionnent sans HTTPS).
- Débogage : `chrome://inspect` sur le Mac.

## Conventions
- Code, identifiants et commentaires : anglais. Documentation et messages de commit : français.
- Modules purs (`ftms.js`, `engine.js`) sans accès au DOM ni à Web Bluetooth, pour rester testables sous Node.
- Git local uniquement : **aucun push sans accord explicite de Nico** (GitHub Pages viendra plus tard, sur décision).

## Avancement
Versions et périmètre : brief § 16. Version en cours : **v1** (non commencée).
