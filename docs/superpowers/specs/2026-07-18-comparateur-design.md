# Comparateur multi-titres — Design

**Date :** 2026-07-18
**Statut :** Validé (design)

## Objectif

Un onglet **F9 « ⚖ Comparer »** pour comparer **2 à 4 titres** de la watchlist côte à côte :
un **graphique de performances superposées** (prix normalisés) + un **tableau comparatif** des
métriques technique et fondamental, avec la **meilleure valeur de chaque ligne surlignée**.

## Décisions validées

- Les deux : **tableau + graphique superposé**.
- **4 titres max**, sélection **depuis la watchlist** (titres déjà analysés).
- Nouvel onglet **F9**.

## Architecture

### 1. État (session, non persisté)

```js
let compareSel = [];          // tickers sélectionnés (max 4)
let comparePeriod = "1a";     // clé de CHART_PERIODS
let compareChart = null;      // instance Chart.js (détruite avant recréation)
```

### 2. Définition des métriques (table)

`COMPARE_METRICS` = liste de `{ label, get(entry)->number|null, dir: "high"|"low"|"none", fmt(v)->string }` :

| label | source | dir | format |
|-------|--------|-----|--------|
| Cours | `e.ind.price` | none | `fnum` |
| Perf. 1 mois | `e.ind.perf.m1` (déjà en %) | high | `fpct` |
| Perf. 3 mois | `e.ind.perf.m3` | high | `fpct` |
| Perf. 1 an | `e.ind.perf.y1` | high | `fpct` |
| RSI 14 | `e.ind.rsi` | none | `fnum` |
| Volatilité | `e.ind.vol` (en %) | low | `v+" %"` |
| Score technique | `e.score` | high | entier |
| Score fondamental | `e.fundScore?.total` | high | entier |
| Score global | `computeGlobalScore(e)` | high | entier |
| PER | `e.fund?.trailingPE` | low | `fnum` |
| PER prév. | `e.fund?.forwardPE` | low | `fnum` |
| Rendement dividende | `e.fund?.dividendYield` (fraction) | high | `ffrac` |
| Marge nette | `e.fund?.profitMargins` (fraction) | high | `ffrac` |
| ROE | `e.fund?.returnOnEquity` (fraction) | high | `ffrac` |
| Croissance CA | `e.fund?.revenueGrowth` (fraction) | high | `ffrac` |
| Dette / capitaux propres | `e.fund?.debtToEquity` ÷ 100 | low | `fnum` |
| Capitalisation | `e.fund?.marketCap` | high | `fmtMarketCap(v, currency)` |

`get` renvoie `null` si la donnée manque (titre non analysé côté fondamental, etc.).

### 3. Meilleure valeur par ligne

`compareBest(values, dir)` : parmi les valeurs non nulles, renvoie l'**index** de la meilleure
(max si `high`, min si `low`) ; `-1` si `dir === "none"` ou aucune valeur. La cellule à cet index
reçoit une classe `best` (surlignage vert). En cas d'égalité, la première gagne.

### 4. Rendu — `renderCompare()`

- **Sélection** : cases à cocher pour chaque ticker **analysé** de la watchlist
  (`watchlist.filter(t => cache[t])`). Cochées = `compareSel`. Quand 4 sont cochées, les autres sont
  **désactivées**. Toute (dé)sélection → `renderCompare()`.
- **Période** : boutons `CHART_PERIODS` ; le bouton actif = `comparePeriod`.
- **Graphique** (si ≥ 1 titre) : pour chaque ticker, `hist.closes.slice(0, n).reverse()` (n =
  jours de la période), **normalisé à 100** (chaque valeur ÷ première × 100). Labels = dates du
  titre ayant le plus de points, `slice(0,n).reverse().map(fdateShort)`. Un dataset par titre,
  couleur distincte (palette `COMPARE_COLORS`). `compareChart` détruit puis recréé (Chart.js line,
  `maintainAspectRatio:false`, légende visible).
  > Limite assumée : alignement par index (derniers n jours de bourse de chaque titre) ; un léger
  > décalage est possible si deux places boursières n'ont pas exactement les mêmes jours fériés.
- **Tableau** : titres en colonnes (`<th>` par ticker), une ligne par métrique ; la cellule
  « meilleure » reçoit la classe `best`. Valeurs manquantes → « — » (jamais « best »).
- Si `compareSel` est vide : message d'invite (« cochez au moins 2 titres… »).

### 5. UI (onglet F9)

- **Barre d'onglets** : `<button data-tab="compare">F9 · COMPARER</button>` après F8.
- **Clavier** : `F9: "compare"`.
- **Bascule** : `if (btn.dataset.tab === "compare") renderCompare();`.
- **Panneau `#panel-compare`** : zone de sélection (`#compare-select`), boutons période
  (`#compare-periods`), conteneur graphique (`<canvas id="compare-canvas">`), tableau
  (`#compare-table`).
- Réutilise `.data-table` (donc format cartes sur mobile), `.chart-holder`, `.chart-periods`.

## Gestion des erreurs / cas limites

| Cas | Comportement |
|-----|--------------|
| < 2 titres cochés | Message d'invite, pas de graphique/tableau (ou tableau à 1 colonne toléré) |
| Titre sans fondamental | Lignes fonda = « — », pas de « best » sur ces valeurs |
| Historique plus court que la période | On prend ce qui existe (`Math.min(n, closes.length)`) |
| Chart.js indisponible | On saute le graphique, le tableau reste |
| Aucun titre analysé dans la watchlist | Message : « analysez d'abord des titres (F1) » |
| > 4 cochés | Impossible : cases désactivées au-delà de 4 |

## Tests / vérification

- **compareBest** : `[3,7,5]` dir high → index 1 ; dir low → index 0 ; avec nulls ignorés ; `none`
  → -1.
- **Table** : 2 titres analysés → colonnes correctes, « best » surligné dans le bon sens (ex. PER
  le plus bas surligné, perf la plus haute surlignée), « — » pour un titre sans fondamental.
- **Graphique** : 2 titres → 2 datasets normalisés (première valeur = 100), légende affichée.
- **Sélection** : cocher 4 titres désactive le 5e ; décocher réactive.
- **Non-régression** : onglets F1–F8 inchangés ; responsive (cartes mobile) ; `py -m unittest
  discover tests` vert.

## Non-objectifs

- Pas d'alignement strict par date (index-based). Pas de comparaison de titres hors watchlist
  (sélection watchlist uniquement). Pas d'export du comparatif.
