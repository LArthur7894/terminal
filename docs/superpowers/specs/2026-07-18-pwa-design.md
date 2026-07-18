# PWA (installable + hors-ligne) — Design

**Date :** 2026-07-18
**Statut :** Validé (design), implémentation directe (design déjà convenu avec Arthur)

## Objectif

Rendre le terminal **installable** (icône dédiée, fenêtre autonome) et **consultable hors-ligne**
(coquille + dernières données en cache), sans rien changer aux fonctionnalités.

## Décisions validées

- Nom « Terminal Boursier », court « Terminal ».
- Coquille mise en cache par un service worker ; `/api/*` jamais mis en cache (toujours réseau).
- Best-effort : l'app reste 100 % fonctionnelle même sans support PWA.

## Architecture

### Fichiers ajoutés (servis par `server.py`, répertoire statique)
- **`manifest.webmanifest`** : `name`, `short_name`, `start_url` `/terminal-tout-en-un.html`,
  `scope` `/`, `display` `standalone`, `background_color` `#0b0d10`, `theme_color` `#ffb000`,
  `icons` (SVG).
- **`icon.svg`** : icône sobre (chandelier ambre `#ffb000` sur fond `#0b0d10`).
- **`sw.js`** : service worker.
  - `install` : pré-cache la coquille (`/terminal-tout-en-un.html`, `/` et l'URL Chart.js CDN).
  - `activate` : supprime les anciens caches versionnés.
  - `fetch` : **ne touche pas** `/api/*` (laisse passer au réseau) ; navigation → **network-first**
    avec repli sur la coquille en cache (hors-ligne) ; autres GET même origine → cache-first.

### `server.py`
- Enregistrer le type MIME `application/manifest+json` pour `.webmanifest`
  (`extensions_map`) afin que le manifeste soit servi correctement.

### `terminal-tout-en-un.html` (`<head>` + script)
- `<link rel="manifest" href="/manifest.webmanifest">`
- `<meta name="theme-color" content="#ffb000">`
- Enregistrement best-effort du SW :
  `if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}));`

## Gestion des erreurs

| Cas | Comportement |
|-----|--------------|
| Service workers non supportés / bloqués | `try/catch`/`.catch` → app normale, non-PWA |
| Hors-ligne, coquille en cache | L'app s'ouvre, montre les données en cache ; `/api/*` échoue proprement (déjà géré) |
| Nouvelle version déployée | network-first sur la navigation → dernière version récupérée en ligne |

## Vérification

- `curl` `/manifest.webmanifest` et `/sw.js` → 200 ; manifeste = JSON valide, bon Content-Type.
- HTML contient le `<link rel="manifest">`, le `meta theme-color`, l'enregistrement du SW.
- En navigateur : `navigator.serviceWorker.getRegistration()` non nul, aucune erreur de chargement.
- `py -m unittest discover tests` reste vert.

## Non-objectifs

- Pas de notifications push. Pas de cache des données `/api/*`. Pas d'icônes PNG multi-tailles
  (l'icône SVG unique suffit pour l'installation sur les navigateurs modernes).
