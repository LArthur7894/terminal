# Filtres & tri avancés — Design

**Date :** 2026-07-17
**Statut :** Validé (design), en attente relecture spec
**Auteur :** Arthur + Claude

## Contexte

La watchlist (Dashboard F1) et le tableau du Marché (F5) affichent désormais les scores
technique, fondamental et global (voir specs précédentes). Aujourd'hui :
- La watchlist a un **filtre texte** (ticker/nom) via `watchlistFilterQuery` + `matchesWatchlistFilter`,
  et se rend dans l'ordre de la watchlist. Aucun tri par colonne.
- Le Marché se classe par `rankScore` (global si enrichi, sinon technique) et affiche le top 30.
  Aucun filtre, aucun tri manuel.

## Objectif

Ajouter, sur les deux tableaux : (1) le **tri par colonnes cliquables**, (2) un **panneau de
filtres numériques** (screener), avec les critères **mémorisés par profil**.

## Décisions validées

- Interface : **les deux** (colonnes cliquables + panneau de filtres).
- 4 critères de filtre : Score global ≥, Score fondamental ≥, PER ≤, Rendement dividende ≥ %.
- Filtres **persistés par profil** (localStorage scopé au profil, comme les autres réglages).
- Tri : état de session (réinitialisé au rechargement) — non persisté.
- Valeurs manquantes (« — ») : toujours en bas du tri ; masquées uniquement si un filtre
  fondamental est actif.

## Non-objectifs (YAGNI)

- Pas de critères au-delà des 4 (RSI, perf, capitalisation : plus tard si besoin).
- Pas de tri multi-colonnes.
- Pas de sauvegarde de « vues » nommées.

---

## Architecture

### 1. État et persistance

Nouvelle clé localStorage (profil-scopée par `lsGet`/`lsSet`) :

```js
// dans LS
filters: "term_filters",
```

État global (initialisé au chargement, à placer près des autres `let` d'état) :

```js
// Filtres numériques par tableau. Valeurs null = critère inactif. Persistés par profil.
let filters = lsGet(LS.filters, { wl: {}, mk: {} });
if (!filters.wl) filters.wl = {};
if (!filters.mk) filters.mk = {};

// État de tri par tableau (session uniquement). col = clé de colonne, dir = 1 (asc) ou -1 (desc).
let sortState = { wl: { col: null, dir: 1 }, mk: { col: null, dir: 1 } };
```

`saveFilters()` : `lsSet(LS.filters, filters)`.

### 2. Extracteurs de colonnes (tri + accès valeurs)

Un mapping unique clé→fonction, réutilisé pour le tri. Chaque fonction renvoie un **nombre** ou
`null` (valeur absente → toujours en bas). `entry` est une entrée de cache (`cache[t]` ou
`marketCache[t]`).

```js
const COLUMN_VALUE = {
  price:  e => e.ind ? e.ind.price : null,
  change: e => e.ind ? e.ind.changePct : null,
  rsi:    e => e.ind ? e.ind.rsi : null,
  score:  e => (e.score ?? null),                     // technique
  fonda:  e => (e.fundScore ? e.fundScore.total : null),
  global: e => (e.score != null ? computeGlobalScore(e) : null),
  perf1y: e => (e.ind && e.ind.perf ? e.ind.perf.y1 : null),
  per:    e => (e.fund ? e.fund.trailingPE : null),
  div:    e => (e.fund ? e.fund.dividendYield : null), // fraction
};
```

Fonction de tri générique (nulls toujours en bas quel que soit `dir`) :

```js
function sortByColumn(list, getEntry, state) {
  if (!state.col) return list;
  const val = COLUMN_VALUE[state.col];
  if (!val) return list;
  return [...list].sort((a, b) => {
    const va = val(getEntry(a)), vb = val(getEntry(b));
    if (va == null && vb == null) return 0;
    if (va == null) return 1;   // a en bas
    if (vb == null) return -1;  // b en bas
    return (va - vb) * state.dir;
  });
}
```

### 3. Filtres (prédicat commun)

```js
// Renvoie true si l'entrée passe les critères f = {globalMin, fondaMin, perMax, divMin}.
// Un critère fondamental actif rejette une entrée sans la donnée correspondante.
function passesFilters(entry, f) {
  if (!entry) return false;
  if (f.globalMin != null) {
    const g = entry.score != null ? computeGlobalScore(entry) : null;
    if (g == null || g < f.globalMin) return false;
  }
  if (f.fondaMin != null) {
    const v = entry.fundScore ? entry.fundScore.total : null;
    if (v == null || v < f.fondaMin) return false;
  }
  if (f.perMax != null) {
    const v = entry.fund ? entry.fund.trailingPE : null;
    if (v == null || v > f.perMax) return false;
  }
  if (f.divMin != null) {
    const v = entry.fund ? entry.fund.dividendYield : null; // fraction
    if (v == null || v * 100 < f.divMin) return false;      // divMin en %
  }
  return true;
}
```

### 4. Markup du panneau de filtres (réutilisable)

Un même bloc HTML inséré au-dessus de chaque tableau, différencié par un attribut `data-scope`
(`wl` ou `mk`) sur les inputs (classe `.js-filter`, avec `data-key` = globalMin/fondaMin/perMax/divMin) :

```html
<div class="filter-panel" data-scope="wl">
  <span class="filter-label">Filtres :</span>
  <label>Global ≥ <input type="number" class="js-filter" data-scope="wl" data-key="globalMin" min="0" max="100" step="1"></label>
  <label>Fonda ≥ <input type="number" class="js-filter" data-scope="wl" data-key="fondaMin" min="0" max="100" step="1"></label>
  <label>PER ≤ <input type="number" class="js-filter" data-scope="wl" data-key="perMax" min="0" step="0.5"></label>
  <label>Div. ≥ <input type="number" class="js-filter" data-scope="wl" data-key="divMin" min="0" step="0.1"> %</label>
  <button type="button" class="btn btn-small btn-ghost js-filter-reset" data-scope="wl">Réinitialiser</button>
</div>
```

Idem pour le Marché avec `data-scope="mk"`. Placé : watchlist → dans/au-dessus de
`.watchlist-filter-row` (F1) ; marché → sous le curseur de pondération, avant `.table-wrap` (F5).

### 5. Câblage (délégué, unique)

```js
// Saisie d'un filtre → maj état + persistance + re-render du tableau concerné.
document.querySelectorAll(".js-filter").forEach(inp => {
  const { scope, key } = inp.dataset;
  if (filters[scope][key] != null) inp.value = filters[scope][key]; // pré-remplissage
  inp.addEventListener("input", () => {
    const v = inp.value === "" ? null : Number(inp.value);
    filters[scope][key] = (v == null || isNaN(v)) ? null : v;
    saveFilters();
    scope === "wl" ? renderWatchlist() : renderMarketTable();
  });
});

document.querySelectorAll(".js-filter-reset").forEach(btn => {
  btn.addEventListener("click", () => {
    const scope = btn.dataset.scope;
    filters[scope] = {};
    saveFilters();
    document.querySelectorAll(`.js-filter[data-scope="${scope}"]`).forEach(i => { i.value = ""; });
    scope === "wl" ? renderWatchlist() : renderMarketTable();
  });
});

// Tri : clic sur un <th data-sort="clé"> → bascule col/dir + re-render.
function wireSortHeaders(tableId, scope, renderFn) {
  document.querySelectorAll(`#${tableId} thead th[data-sort]`).forEach(th => {
    th.classList.add("sortable");
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      const st = sortState[scope];
      if (st.col === col) st.dir = -st.dir; else { st.col = col; st.dir = -1; } // 1er clic = desc
      renderFn();
    });
  });
}
```

Après le rendu, un helper `paintSortIndicators(tableId, scope)` ajoute ▲/▼ sur l'en-tête actif.
Les en-têtes triables reçoivent `data-sort="clé"` dans le HTML (price, change, rsi, score, fonda,
global, perf1y pour le marché ; price, change, rsi, score, fonda, global pour la watchlist).

### 6. Intégration dans les rendus

**`renderWatchlist`** : après avoir calculé `filtered` (filtre texte existant), appliquer le
filtre numérique puis le tri :

```js
let filtered = watchlist.filter(matchesWatchlistFilter);
filtered = filtered.filter(t => cache[t] ? passesFilters(cache[t], filters.wl) : !hasActiveFundFilter(filters.wl));
filtered = sortByColumn(filtered, t => cache[t] || {}, sortState.wl);
```
`hasActiveFundFilter(f)` = true si un des 4 critères est actif (tous sont « fondamentaux » ici sauf
qu'un titre non analysé n'a ni score ni fund → masqué si filtre actif ; sinon visible). Mettre à
jour les `colspan` inchangés (13). Appeler `paintSortIndicators("watchlist-table","wl")` en fin.

**`renderMarketTable`** : ordre → filtre → tri (colonne ou `rankScore` par défaut) → `slice(0,30)` :

```js
let list = marketCandidates
  .map(m => ({ ...m, entry: cache[m.symbol] || marketCache[m.symbol] }))
  .filter(m => m.entry)
  .filter(m => passesFilters(m.entry, filters.mk));
list = sortState.mk.col
  ? sortByColumn(list, m => m.entry, sortState.mk)
  : list.sort((a, b) => rankScore(b.entry) - rankScore(a.entry));
const ranked = list.slice(0, 30);
```
Appeler `paintSortIndicators("market-table","mk")` en fin.

### 7. CSS

- `.filter-panel` : ligne flex, gap, wrap ; inputs numériques étroits (~70 px).
- `th.sortable` : `cursor: pointer; user-select: none;` + indicateur `▲/▼` (via un `<span>` ajouté).

---

## Découpage en unités

- **État/persistance** : `LS.filters`, `filters`, `sortState`, `saveFilters`.
- **Logique pure** : `COLUMN_VALUE`, `sortByColumn`, `passesFilters`, `hasActiveFundFilter`.
- **Markup** : 2 panneaux de filtres (HTML), `data-sort` sur les en-têtes.
- **Câblage + rendu** : écouteurs délégués, `wireSortHeaders`, `paintSortIndicators`, retouches
  de `renderWatchlist` et `renderMarketTable`.

## Gestion des erreurs / cas limites

| Cas | Comportement |
|-----|--------------|
| Aucun filtre / aucun tri | Comportement actuel, inchangé |
| Filtre fondamental actif, titre sans fondamental | Masqué |
| Tri sur colonne, valeurs « — » | Toujours en bas |
| Marché non enrichi + filtre PER/div actif | Tableau se vide proprement (aucun match) — attendu |
| Saisie non numérique | Ignorée (critère = null) |
| Changement de profil | Filtres rechargés depuis le profil (page rechargée par `switchProfile`) |

## Tests / vérification

- **Tri** : cliquer l'en-tête « Global » de la watchlist → tri desc puis asc ; « — » en bas.
  Idem « Fonda », « Perf. 1 an » sur le marché.
- **Filtres** : saisir Global ≥ 60 sur la watchlist → seules les lignes au score global ≥ 60
  restent ; PER ≤ 20 → masque les PER élevés et les titres sans fondamental.
- **Persistance** : saisir des filtres, recharger la page → les valeurs sont pré-remplies et
  appliquées. Changer de profil → filtres propres au profil.
- **Marché** : filtrer par dividende ≥ 3 % sur un top enrichi → seuls les titres à dividende
  suffisant restent ; trier par PER asc.
- **Non-régression** : sans filtre ni tri, watchlist et marché identiques à avant.
- `py -m unittest discover tests` inchangé (aucune modif serveur).
