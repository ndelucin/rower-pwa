# rower-pwa

PWA d'entraînement pour rameur WaterRower (moniteur S4 + module BLE `S4 BLE 50`, service FTMS `0x1826`), utilisée sur un Samsung Galaxy S23.

Documents de référence, à relire avant toute décision de conception :
- [docs/BRIEF.md](docs/BRIEF.md) : la spécification d'origine (source de vérité, sauf là où un document plus récent la précise) ;
- [docs/ECRAN.md](docs/ECRAN.md) : les écrans de séance décidés sur maquettes, qui **remplacent le brief § 7** ;
- [docs/S4-OBSERVATIONS.md](docs/S4-OBSERVATIONS.md) : le comportement réel du S4 en Bluetooth (valeurs périmées, coup fantôme, pas de pause…) ;
- [docs/PLAN-ecran-v1.md](docs/PLAN-ecran-v1.md) : le plan en cours ;
- [docs/cinematique.md](docs/cinematique.md) : le parcours des écrans de bout en bout (diagramme d'états, écarts à trancher) ; maquette cliquable [docs/maquette-cinematique.html](docs/maquette-cinematique.html).

## Principes non négociables
- **HTML / CSS / JS vanilla, modules ES, aucune étape de build, aucune dépendance runtime.** Pas de framework ni de librairie graphique (rendu natif HTML / CSS / SVG).
- **Cible : Galaxy S23, Chrome Android** (Web Bluetooth ; jamais Samsung Internet, le navigateur par défaut). Accueil en portrait (par défaut) ou paysage ; **écran de séance en paysage plein écran** (bascule automatique à la connexion).
  - Viewport CSS en paysage : **780 × 360** en plein écran, environ **780 × 300** avec la barre d'adresse. Vérifier toute mise en page aux deux tailles.
  - Densité × 3 ; caméra perforée sur le côté → marges `env(safe-area-inset-*)` avec `viewport-fit=cover`.
  - Tailles en `min(vw, vh)` pour rester lisible dans les deux cas, à 1,5 m.
- **Chemins relatifs partout** (site servi en sous-chemin sur GitHub Pages) : imports, manifeste (`start_url`, `scope`), service worker.
- **Aucun secret dans le code** : le dépôt et le site seront publics. Les données de séance restent sur le téléphone.
- Le format d'export `rower-session/1` (brief § 11) est le **seul contrat** avec le dashboard : toute évolution passe par une nouvelle version du schéma.
- Le décodeur FTMS parse **selon les flags**, jamais selon une valeur de flags codée en dur.

## Structure
```
index.html  manifest.webmanifest  sw.js  .nojekyll  icons/
src/  ftms.js          décodeur Rower Data (pur)
      ftms-encoder.js  encodeur de trames (simulateur, tests)
      sim.js           faux rameur (scénarios repos / continu / HIIT)
      ble.js           connexion Web Bluetooth + reconnexion
      activity.js      détection d'arrêt (attente / en cours / arrêt)
      wakelock.js      écran maintenu allumé
      session.js       chrono, pause auto, cumuls et bilan de la séance (pur)
      goal.js          objectif durée / distance : bornes, valeur depuis l'angle, progression (pur)
      store.js         IndexedDB : copie de secours, historique
      export.js        fichier d'export `rower-session/1` et son nom (pur)
      version.js       numéro de build affiché sur l'accueil (écrit par `npm run stamp`)
      programs.js      les 6 programmes d'intervalles (données)
      engine.js        moteur de programme : phase, segment, compte à rebours, frise (pur)
      target.js        repère personnel et zone cible de split (pur)
      audio.js*        (v2 et suivantes)
      app.js           câblage
      ui/  components.js  layouts.js  choice.js  format.js  styles.css   (choice.js : écrans de choix, sélecteur circulaire, liste des programmes)
test/  *.test.js  helpers.js  fixtures/ (séances réelles du S4 + un export rower-session/1)
docs/  BRIEF.md  ECRAN.md  S4-OBSERVATIONS.md  PLAN-*.md  cinematique.md  maquette-cinematique.html  artefact-dashboard.html
scripts/  phone-eval.js  sim-demo.js  stamp-version.js  import-rowerboard.js (import ponctuel des séances de l'autre dépôt rowerboard)
```
`*` : à venir.

## Commandes
- Serveur local : `python3 -m http.server 8080`, puis http://localhost:8080 (`?sw=1` active le service worker en local ; le panneau navigateur de l'app Claude refuse les service workers : tester dans Chrome).
  - `?dev` affiche les boutons du simulateur sur l'accueil ; `?sim=steady` (ou `hiit`, `startstop`, `rest`) démarre directement le simulateur ; `&speed=10` accélère (10 s simulées par seconde, mais l'horloge de séance reste réelle) ; `&mode=program&program=pyramide` démarre un programme d'intervalles (ids : `pyramide`, `6x1`, `8x1`, `4x2`, `4x4`, `3x6x30`) ; `&frames=full` envoie des trames entières (sans lui, le simulateur découpe en 20 octets et la séance reste « en attente »). Sans `?sim=`, `?mode=` ne fait rien : il faut le simulateur. `&mode=duration|distance&target=1200` (s) ou `2000` (m) démarre une séance à objectif, `&mode=choice` s'arrête sur l'écran de choix.
  - Maquette (une seule, cliquable, tous les écrans) : http://localhost:8080/docs/maquette-cinematique.html.
- Tests : `npm test` (= `node --test test/*.test.js`, runner intégré à Node, sans dépendance). Trames de test : `encodeRowerData` (`src/ftms-encoder.js`) et `test/helpers.js`.
- Numéro de build (discret en bas de l'accueil : « build 38 · 15/11 22:09 ») : `npm run stamp` l'écrit dans `src/version.js` (n° = nombre de commits + 1, + l'heure). **À lancer juste avant chaque commit** pour que le numéro affiché sur le téléphone soit celui du commit ; un crochet Git `pre-commit` peut le faire tout seul (non installé : le dossier `.git/hooks` n'est pas versionné).
- Capture d'une page à la taille du S23, sans téléphone :
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --force-device-scale-factor=3 --window-size=780,300 --screenshot=out.png "http://localhost:8080/?sim=steady"`
- Démo du faux rameur en terminal : `node scripts/sim-demo.js [rest|steady|hiit] [secondes] [pas]`.

### Sur le téléphone (USB)
- `adb reverse tcp:8080 tcp:8080`, puis ouvrir `http://localhost:8080` dans Chrome Android (localhost = contexte sécurisé : Web Bluetooth et service worker sans HTTPS).
- Ouvrir la page : `adb shell am start -a android.intent.action.VIEW -d "http://localhost:8080/" com.android.chrome`. Capture : `adb exec-out screencap -p > s23.png`.
- Journal de la page (`window.__rower` : trames brutes, série seconde par seconde, événements) : `node scripts/phone-eval.js` ; `--reload` recharge sans cache après une modification. L'écran du téléphone doit rester allumé et Chrome au premier plan. Sinon `chrome://inspect` sur le Mac.
- `adb` vient de `~/Brewfile` (`android-platform-tools`). Le S23 doit apparaître dans `adb devices` avec l’état `device`. Si la liste est vide ou indique `unauthorized` :
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
- Remote : https://github.com/ndelucin/rower-pwa (**public** depuis le 2026-11-15), site sur GitHub Pages : https://ndelucin.github.io/rower-pwa/ (publié depuis `main`, chaque push met le site à jour). **Aucun push sans accord explicite de Nico.**
- Identité Git locale au dépôt : e-mail anonyme GitHub (`…+ndelucin@users.noreply.github.com`), jamais l'adresse personnelle.
- Rien d'identifiant dans le dépôt (adresse Bluetooth du rameur, e-mail…).

## Avancement
Versions et périmètre : brief § 16. Version en cours : **v1** terminée et validée sur le S23 (export compris) ; **v2 en cours** (choix de séance, durée / distance, intervalles) : codée et testée sous Node, **rien de cela n'a encore été essayé sur le S23**.
- [x] Décodeur `ftms.js`, encodeur `ftms-encoder.js` et faux rameur `sim.js`, testés
- [x] Connexion Bluetooth `ble.js` (reconnexion automatique), validée sur le vrai rameur : trames de 27 octets en un seul envoi, jamais découpées
- [x] Détection d'arrêt `activity.js` : seuil adaptatif (≈ 4 s), coup fantôme du S4 ignoré ; testée en rejouant trois séances réelles
- [x] Écran maintenu allumé (`wakelock.js`), vérifié sur le S23
- [x] Écrans décidés sur maquettes : [docs/ECRAN.md](docs/ECRAN.md)
- [x] Écran de séance libre, pause automatique (`session.js`), bilan, copie de secours et historique (`store.js`) : [docs/PLAN-ecran-v1.md](docs/PLAN-ecran-v1.md). Essai réel du 2026-11-15 concluant
- [x] Squelette PWA ([docs/PLAN-pwa.md](docs/PLAN-pwa.md)) : RowerMonitor, `sw.js` (réseau d'abord, mise à jour silencieuse, hors ligne). **Installée sur le S23 : plein écran paysage et icône vérifiés**
- [x] Écran d'accueil : logo et nom centrés, fond dégradé, portrait ou paysage, bouton de connexion, dernière séance, simulateur caché hors `?dev` ; bascule auto en paysage à la connexion ([docs/maquette-cinematique.html](docs/maquette-cinematique.html)). Fin de séance : ⏸ en pause ou en attente, appui immédiat ; bilan « Enregistrer la séance » / « Ignorer la séance »
- [x] Dépôt public + GitHub Pages (2026-11-15) : https://ndelucin.github.io/rower-pwa/
- [x] Reconnexion au rameur déjà autorisé sans le sélecteur Bluetooth de Chrome (`getDevices`), repli sur le sélecteur ; testée sous Node, **validée sur le S23 le 2026-11-15** (à condition d'activer le flag Chrome, voir ci-dessous)
- [x] Export de séance vers Drive (2026-11-15) : « Enregistrer la séance » → copie locale + partage Android → dossier Drive → artefact Claude qui l'affiche. **Validé de bout en bout sur le S23** (voir « Export et dashboard »)
- [x] Icône (ligne de battement de cœur bleue dans un anneau partiel jaune), numéro de build discret sur l'accueil, service worker qui revalide à chaque chargement

- [x] Écran de choix de séance (Libre / Durée / Distance / Intervalles), sélecteur circulaire d'objectif, séances Durée et Distance avec fin automatique « Objectif atteint » (`goal.js`, `ui/choice.js`). Couleurs : bleu = durée, violet = distance, gris = libre, jaune = intervalles et efforts, vert = récup (voir docs/ECRAN.md). **Pas encore essayé sur le S23.**
- [x] Séances par intervalles : liste de 6 programmes (`programs.js`), moteur (`engine.js`), zone cible de split (`target.js`), écran HIIT (anneau par phase, frise, fond teinté), fin automatique du programme. Tests sous Node seulement. **Pas encore essayé sur le S23.**
- Connu : le simulateur découpe ses trames en deux (`maxFrameBytes: 20`) et `activity.js` y voit un coup fantôme : la séance reste en « attente » avec `?sim=`. Le vrai S4 envoie des trames entières, donc sans effet réel.

## Export et dashboard
- **Parcours** : appui sur « Enregistrer la séance » → copie locale (IndexedDB) **et**, dans le même geste, `navigator.share({ files })` → l'utilisateur choisit Drive et le dossier `Personnel / RowerMonitor / data` → un artefact Claude lit ce dossier. Au retour, l'accueil affiche le résultat sous le bouton (« Séance enregistrée. Fichier partagé. », ou la cause d'un échec).
- **Le fichier est du JSON `rower-session/1` (brief § 11) enregistré en `.txt`** (`text/plain`, `rower-AAAA-MM-JJTHH-MM.txt`) : Chrome Android refuse de partager un `.json` (`NotAllowedError`). Ne pas passer de `title` à `share()` : le Drive l'utilise comme nom de fichier (toutes les séances se seraient appelées « Séance RowerMonitor »).
- **Pas de secret dans la PWA** : c'est l'appli Drive du téléphone, déjà connectée, qui envoie. Une page extérieure ne peut pas écrire dans un artefact Claude ; l'artefact, lui, **lit** Drive avec la capacité `mcp` (connecteur « Google Drive », outils `search_files` et `download_file_content`, identifiants du spectateur, accord demandé une fois).
- **Artefact « RowerBoard »** : source dans [docs/artefact-dashboard.html](docs/artefact-dashboard.html), publié avec l'outil Artifact (privé ; son URL n'est pas versionnée, le dépôt étant public). Dossier fixe `personnel/RowerMonitor/data` (constante `DEFAULT_FOLDER`, pas de champ de saisie), lecture de **tous** les fichiers du dossier, validés sur le contenu et non sur le nom ; exemples marqués « exemple » tant que le dossier est vide. Cartes, allure par séance, liste, courbes de split et de puissance.
- **Non vérifié** : l'ouverture de l'artefact depuis le téléphone (les deux séances se sont bien affichées, sur un appareil que je n'ai pas noté).
- Pas de lien vers l'artefact dans l'appli (décision du 2026-11-15) : l'adresse serait publique dans le dépôt.

## Reste à faire (dans l'ordre)
1. **Essayer sur le S23 ce qui est codé et jamais vu sur téléphone** : écran de choix, sélecteurs durée / distance, fin automatique à l'objectif, une séance par intervalles complète (lisibilité de l'anneau et de la frise à 1,5 m, arcs à venir trop estompés ?, zone cible de split).
2. **Reconnexion sans sélecteur : à revérifier sur l'appli installée** (le test du 2026-11-15 a eu lieu sur `http://localhost:8080` dans un onglet Chrome). Prérequis sur le S23 : activer `chrome://flags/#enable-web-bluetooth-new-permissions-backend` puis relancer Chrome ; sans lui, `getDevices()` renvoie une liste vide et le sélecteur revient à chaque fois. La 1ʳᵉ connexion après activation passe par le sélecteur, les suivantes sont directes. Le sélecteur revient aussi quand le S4 n'est pas joignable (`Device is no longer in range`, cause non élucidée). Journal : `window.__rower.events` via `scripts/phone-eval.js`.
3. **Vraie séance de 20 min** avec 2-3 arrêts, appli installée, et **capturer les trames brutes** (`node scripts/phone-eval.js`, `window.__rower.raw` n'est qu'en mémoire) pour trancher l'écart de chrono avec l'écran du S4 (voir S4-OBSERVATIONS.md, séance du 18/11).
4. **Écarts de la cinématique** à trancher : [docs/cinematique.md](docs/cinematique.md) (1, 2, 3 en priorité).
5. **Lissage de la puissance** sur les 3 derniers coups (piste, non implémentée).
6. **Rowerboard** (facultatif) : lui faire lire les exports `rower-session/1` (autre dépôt, prévu en v4) ; l'artefact Claude fait déjà office de dashboard.
7. **Suite de la v2** : signaux sonores (`audio.js`), trait blanc de la barre = split moyen de l'intervalle en cours.

## Questions en suspens
- Chrono de la PWA ≈ 70 s de moins que l'écran du S4 sur la séance du 18/11 (split moyen 2:09,5 contre ≈ 2:26) : pause automatique trop précoce en rame lente ? Cause non établie, trames brutes non conservées ([docs/S4-OBSERVATIONS.md](docs/S4-OBSERVATIONS.md)).
- Watts BLE ≈ 0,8 × la formule 2,8 × (500/split)³, et instantanés bruités (±7 W d'un coup à l'autre) alors que le S4 lisse : lisser côté PWA ?
- Distance affichée par le S4 en fin de 2ᵉ essai (15/11), à comparer aux 174 m reçus.
- Un coup très léger juste après un arrêt compte comme une reprise (vu à 16 W le 2026-11-15, suivi d’une vraie reprise) : comportement gardé, à revoir seulement s’il gêne.
- Rowerboard : dans les fichiers TCX du S4, les watts donnent un split ~13 s plus lent que la distance (médiane 2:21 contre 2:08). Ça peut fausser les watts du dashboard.
- Rattrapage `brew bundle` : le Mac diverge de `~/Brewfile` (node, git, gh, pyenv, quelques apps) ; `~/Brewfile` n'est versionné nulle part.
