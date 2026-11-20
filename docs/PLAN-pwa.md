# Plan : squelette PWA installable

Brief § 13. Décisions prises avec Nico le 2026-11-15.

| Sujet | Décision |
|---|---|
| Nom | **RowerMonitor** (nom et nom court ; 12 caractères, tient sous l'icône). « RowerConnect » écarté : trop proche de l'appli officielle « WaterRower Connect ». |
| Mise à jour | **Silencieuse** : la nouvelle version s'applique au lancement suivant, sans message. Jamais de rechargement pendant une séance. |
| Hors ligne | Tout le code est mis en cache : l'appli démarre sans réseau. |
| Stratégie de cache | **Réseau d'abord, cache en secours** (délai court) : en ligne, on a toujours la dernière version publiée, ce qui donne la mise à jour silencieuse sans numéro de version à incrémenter à la main ; hors ligne, le cache prend le relais. Alternative écartée : cache d'abord + cache versionné (démarrage un peu plus rapide, mais un oubli d'incrément = version figée sur le téléphone). |
| Développement | Pas de service worker sur `localhost` (sinon le téléphone garde l'ancien code pendant qu'on modifie), sauf avec `?sw=1` pour le tester. |
| Icône | Ligne de battement de cœur bleue dans un anneau partiel jaune, sur fond sombre. SVG source + PNG 192 et 512 (Chrome les exige pour l'installation), version « maskable » avec marge de sécurité. |

## Fichiers
- `manifest.webmanifest` : `name`/`short_name` RowerMonitor, `start_url` et `scope` `./`, `id` `./`, `display: fullscreen` (repli `display_override` : `fullscreen`, `standalone`), `orientation: landscape` (aucun écran en portrait depuis la suppression de l'accueil ; l'appli redemande aussi le verrouillage par code, `screen.orientation.lock`), couleurs du thème, icônes.
- `icons/` : `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (PNG générés depuis le SVG avec Chrome headless).
- `sw.js` : réseau d'abord (délai 3 s), copie en cache de chaque réponse réussie (même arrivée après le délai), cache en secours (aussi sur une réponse 404 ou 5xx) ; préchargement de tous les fichiers de l'appli à l'installation ; à l'activation, suppression des seuls anciens caches `rower-monitor*` (l'origine github.io est partagée avec d'autres sites).
- `index.html` : lien vers le manifeste, titre RowerMonitor.
- `src/app.js` : enregistrement du service worker (chemin relatif `./sw.js`), sauf sur `localhost` sans `?sw=1`.
- `test/pwa.test.js` : le manifeste est valide, ses chemins sont relatifs, les icônes existent, aucun chemin absolu dans `sw.js`.

## Critères de fin
1. `npm test` passe.
2. Navigateur (`localhost/?sw=1`) : le service worker est actif, le cache contient l'appli, et la page se recharge hors ligne.
3. Installation réelle sur le S23 : seulement une fois l'appli servie en HTTPS (GitHub Pages, dépôt public : décision de Nico).
