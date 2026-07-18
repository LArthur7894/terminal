# Journal de performance — Design

**Date :** 2026-07-18
**Statut :** Validé (design)

## Objectif

Une **courbe d'évolution de la valeur du portefeuille** (positions de l'onglet F2) dans le temps,
construite automatiquement à chaque ouverture de l'app. Placée **en bas de l'onglet Positions (F2)**.

## Décisions validées

- Un **point par jour** (date + valeur totale), mis à jour si on rouvre le même jour.
- Enregistré **uniquement si ≥ 1 position** (pas de ligne plate à zéro).
- Valeur = somme des positions au **dernier cours en cache** (`refPrice`, PRU en secours).
- Persisté **par profil** ; inclus dans l'**export/import**.
- Placement : **section dans F2**, pas de nouvel onglet.

## Architecture

### 1. État

`LS.perfJournal = "term_perf_journal"`. `let perfJournal = lsGet(LS.perfJournal, [])` →
tableau `[{ date: "YYYY-MM-DD", value: number }, ...]` (chronologique).

### 2. Enregistrement — `recordPerfSnapshot()`

```js
function recordPerfSnapshot() {
  if (!Array.isArray(perfJournal)) perfJournal = [];
  if (positions.length === 0) return;                 // pas de point si pas de position
  const value = positions.reduce((s, p) => s + p.qty * refPrice(p), 0);
  if (!isFinite(value) || value <= 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const last = perfJournal[perfJournal.length - 1];
  if (last && last.date === today) {
    if (Math.abs(last.value - value) < 0.005) return;  // rien de neuf
    last.value = value;
  } else {
    perfJournal.push({ date: today, value });
  }
  if (perfJournal.length > 1500) perfJournal = perfJournal.slice(-1500); // ~4 ans
  lsSet(LS.perfJournal, perfJournal);
}
```

**Appels** : à l'init (après `loadMarketCache()`), et à la fin de `renderPositions()` (met à jour
le point du jour dès qu'on ouvre F2 ou qu'une position change). `renderPositions` appelle ensuite
`renderPerfJournal()`.

### 3. Rendu — `renderPerfJournal()`

- **Statistiques** (si ≥ 1 point) : valeur actuelle, variation depuis le 1er point (€ et %), plus
  haut, plus bas.
- **Courbe** (si ≥ 2 points, Chart.js line, ambre, `maintainAspectRatio:false`) : `value` en
  fonction de `date`. Instance `perfChart` détruite avant recréation.
- Si < 2 points : message « la courbe se construira au fil de vos visites (1 point/jour) ».
- Si 0 position et journal vide : message d'invite discret.

### 4. UI (section dans F2)

Ajouter, avant `</section>` de `panel-positions`, une carte :
```html
<div class="chart-card">
  <div class="perf-head">
    <h2>Évolution du portefeuille</h2>
    <button class="btn btn-small btn-ghost" id="btn-perf-clear">Effacer l'historique</button>
  </div>
  <div id="perf-stats" class="impact-grid"></div>
  <div class="chart-holder"><canvas id="perf-canvas"></canvas></div>
  <p class="hint">Un point est enregistré par jour d'ouverture de l'app, tant que vous avez au moins une position.</p>
</div>
```
Bouton « Effacer » : confirmation → `perfJournal = []`, `lsSet`, `renderPerfJournal()`.

### 5. Export / Import

- **Export** : ajouter `perfJournal` à `data`.
- **Import (fusion)** : si le journal du profil courant est **vide**, prendre l'importé ; sinon
  **garder l'actuel** (fusionner deux courbes temporelles n'a pas de sens). `lsSet(LS.perfJournal…)`.

## Gestion des erreurs / cas limites

| Cas | Comportement |
|-----|--------------|
| Aucune position | Pas d'enregistrement ; message d'invite |
| 1 seul point | Stats affichées, message « courbe à venir » |
| Cours manquant | `refPrice` retombe sur le PRU |
| Chart.js indisponible | Stats affichées, pas de courbe |
| Rouvre le même jour | Le point du jour est mis à jour (pas de doublon) |

## Tests / vérification

- **Snapshot** : avec 1 position, `recordPerfSnapshot()` ajoute 1 point (date du jour, valeur =
  qty×cours) ; ré-appel le même jour → met à jour, pas de doublon ; sans position → aucun point.
- **Rendu** : injecter un journal de plusieurs points → stats correctes (variation depuis le 1er),
  courbe avec N points ; bouton Effacer vide le journal.
- **Export/import** : `perfJournal` présent dans l'export ; import sur profil vide le récupère.
- **Non-régression** : reste de F2 inchangé ; responsive ; `py -m unittest discover tests` vert.

## Non-objectifs

- Pas de reconstruction rétroactive de l'historique (on ne connaît pas les valeurs passées) : la
  courbe démarre à la première visite avec des positions.
- Pas de comparaison à un indice de référence (pourrait venir plus tard).
