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
- [ ] Détection d'arrêt (le S4 garde des valeurs périmées, voir observations)
- [ ] Squelette PWA (manifeste, SW, icônes), Wake Lock, export JSON, GitHub Pages
- Vérifié sur le vrai matériel : trames de 27 octets en un seul envoi, jamais découpées.
