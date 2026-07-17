# Filtres & tri avancés — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter le tri par colonnes cliquables et un panneau de filtres numériques (Score global, Score fondamental, PER, dividende) sur la watchlist (F1) et le tableau du Marché (F5), avec les filtres persistés par profil.

**Architecture:** Logique pure (extracteurs de colonnes, tri, prédicat de filtre) + intégration dans `renderWatchlist`/`renderMarketTable` + markup (panneaux de filtres, en-têtes `data-sort`) et câblage délégué. État des filtres persisté par profil (localStorage), tri en mémoire de session.

**Tech Stack:** HTML/CSS/JS vanilla, fichier unique `terminal-tout-en-un.html`. Aucune modif serveur.

## Global Constraints

- **Pas de build front** : tout dans `terminal-tout-en-un.html`. Français, `esc()` pour le contenu injecté.
- **Non-régression** : sans filtre ni tri actif, watchlist et marché rendus exactement comme avant.
- **Robustesse** : valeurs « — » (absentes) toujours triées en bas ; un titre sans fondamental est masqué uniquement si un filtre fondamental est actif.
- **Tests headless** : serveur lancé avec `PYTHONIOENCODING=utf-8` (`py` ou chemin complet `C:\Users\amagu\AppData\Local\Programs\Python\Python311\python.exe`) ; pré-remplir `localStorage` (`term_profiles=["Test"]`, `term_current_profile="Test"`) ; ouvrir `http://localhost:8750/terminal-tout-en-un.html`.
- Encodage UTF-8.

---

### Task 1: État + logique pure (filtres & tri)

**Files:**
- Modify: `terminal-tout-en-un.html` — `LS` (~ligne 993, ajout clé) ; état global (~après ligne 1020, `FUND_PILLAR_WEIGHTS`) ; nouvelles fonctions pures (à placer juste après `signalFromScore` / avant `analyzeTicker`, ou près de `matchesWatchlistFilter` ~ligne 1808).

**Interfaces:**
- Consumes: `computeGlobalScore`, `lsGet`, `lsSet` (existant).
- Produces:
  - `LS.filters` ; `let filters` ; `let sortState` ; `function saveFilters()`.
  - `const COLUMN_VALUE` (map clé→(entry)→number|null).
  - `function sortByColumn(list, getEntry, state) -> array` (nulls en bas).
  - `function passesFilters(entry, f) -> boolean`.
  - `function hasActiveFundFilter(f) -> boolean`.

- [ ] **Step 1: Add the LS key**

Dans l'objet `LS`, après `weightTech: ...`, ajouter :
```js
  filters: "term_filters", // critères de filtre par tableau {wl:{...}, mk:{...}}, par profil
```

- [ ] **Step 2: Add state (filters + sortState)**

Juste après la ligne `const FUND_PILLAR_WEIGHTS = { ... };` (~ligne 1020), ajouter :
```js
// Filtres numériques par tableau (wl = watchlist, mk = marché). Valeur absente = critère inactif.
// Persistés par profil. Le tri (sortState) est volontairement en mémoire de session seulement.
let filters = lsGet(LS.filters, { wl: {}, mk: {} });
if (!filters || typeof filters !== "object") filters = { wl: {}, mk: {} };
if (!filters.wl) filters.wl = {};
if (!filters.mk) filters.mk = {};
let sortState = { wl: { col: null, dir: 1 }, mk: { col: null, dir: 1 } };

function saveFilters() { lsSet(LS.filters, filters); }
```

- [ ] **Step 3: Add pure logic (COLUMN_VALUE, sortByColumn, passesFilters, hasActiveFundFilter)**

Juste après `matchesWatchlistFilter` (~ligne 1813), ajouter :
```js
/* ============================= FILTRES & TRI ============================= */

// Extracteurs de valeur par colonne : (entry) -> nombre ou null (null = trié en bas / non filtrable).
const COLUMN_VALUE = {
  price:  e => e.ind ? e.ind.price : null,
  change: e => e.ind ? e.ind.changePct : null,
  rsi:    e => e.ind ? e.ind.rsi : null,
  score:  e => (e.score != null ? e.score : null),
  fonda:  e => (e.fundScore ? e.fundScore.total : null),
  global: e => (e.score != null ? computeGlobalScore(e) : null),
  perf1y: e => (e.ind && e.ind.perf ? e.ind.perf.y1 : null),
};

// Trie une liste selon COLUMN_VALUE[state.col] ; nulls toujours en bas quel que soit le sens.
function sortByColumn(list, getEntry, state) {
  if (!state.col || !COLUMN_VALUE[state.col]) return list;
  const val = COLUMN_VALUE[state.col];
  return [...list].sort((a, b) => {
    const va = val(getEntry(a)), vb = val(getEntry(b));
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * state.dir;
  });
}

// Un filtre fondamental (PER, dividende, fonda, global) est-il actif ?
function hasActiveFundFilter(f) {
  return f.globalMin != null || f.fondaMin != null || f.perMax != null || f.divMin != null;
}

// Prédicat de filtre. Un critère fondamental actif rejette une entrée sans la donnée.
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
    if (v == null || v * 100 < f.divMin) return false;       // divMin exprimé en %
  }
  return true;
}
```

- [ ] **Step 4: Verify the pure logic in the browser console**

Lancer le serveur, ouvrir la page (profil pré-rempli). En console :
```js
(function(){
  const cheap = { score: 40, fundScore:{total:80}, fund:{ trailingPE:10, dividendYield:0.04 }, ind:{ perf:{y1:0.1} } };
  const pricey = { score: 70, fundScore:{total:30}, fund:{ trailingPE:50, dividendYield:0 }, ind:{ perf:{y1:0.5} } };
  const noFund = { score: 65, fundScore:null, fund:null, ind:{ perf:{y1:0.2} } };
  return JSON.stringify({
    passCheap_globalMin50: passesFilters(cheap, { globalMin: 50 }),   // global=0.5*40+0.5*80=60 → true
    passPricey_perMax20: passesFilters(pricey, { perMax: 20 }),       // PER 50 > 20 → false
    passNoFund_divMin3: passesFilters(noFund, { divMin: 3 }),         // pas de fund → false
    passNoFund_noFilter: passesFilters(noFund, {}),                   // aucun filtre → true
    hasActive_empty: hasActiveFundFilter({}),                         // false
    hasActive_per: hasActiveFundFilter({ perMax: 20 }),               // true
    sorted: sortByColumn([cheap, pricey, noFund], e => e, { col:"fonda", dir:-1 }).map(e => e.fundScore ? e.fundScore.total : "—")
  });
})();
```
Expected : `passCheap_globalMin50` true, `passPricey_perMax20` false, `passNoFund_divMin3` false, `passNoFund_noFilter` true, `hasActive_empty` false, `hasActive_per` true, `sorted` = `[80, 30, "—"]` (desc, null en bas).

- [ ] **Step 5: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(client): état + logique pure des filtres & tri (COLUMN_VALUE, sortByColumn, passesFilters)"
```

---

### Task 2: Intégration filtres + tri dans les rendus

**Files:**
- Modify: `terminal-tout-en-un.html` — `renderWatchlist` (~ligne 1815) ; `renderMarketTable` (~ligne 2920).

**Interfaces:**
- Consumes: `passesFilters`, `hasActiveFundFilter`, `sortByColumn`, `filters`, `sortState`, `rankScore` (Task 1 + existant).
- Produces: watchlist et marché appliquent filtre + tri à partir de l'état. `paintSortIndicators` appelé (défini en Task 3 ; si absent au moment du test, remplacer temporairement l'appel par un `typeof` — voir note).

> Note : `paintSortIndicators` est défini en Task 3. Pour que Task 2 soit testable seule, les
> appels sont protégés : `if (typeof paintSortIndicators === "function") paintSortIndicators(...)`.

- [ ] **Step 1: Integrate filter + sort into renderWatchlist**

Dans `renderWatchlist`, repérer :
```js
  const tbody = document.getElementById("watchlist-body");
  tbody.innerHTML = "";

  if (watchlist.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13" class="na">Watchlist vide — ajoutez un ticker ci-dessus (ex. AAPL, MSFT, MC.PA, TTE.PA).</td></tr>`;
    return;
  }

  const filtered = watchlist.filter(matchesWatchlistFilter);
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13" class="na">Aucun résultat pour « ${esc(watchlistFilterQuery)} ».</td></tr>`;
    return;
  }
```
et le remplacer par :
```js
  const tbody = document.getElementById("watchlist-body");
  tbody.innerHTML = "";
  if (typeof paintSortIndicators === "function") paintSortIndicators("watchlist-table", "wl");

  if (watchlist.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13" class="na">Watchlist vide — ajoutez un ticker ci-dessus (ex. AAPL, MSFT, MC.PA, TTE.PA).</td></tr>`;
    return;
  }

  let filtered = watchlist.filter(matchesWatchlistFilter);
  // Filtre numérique : un titre non analysé (sans cache) est masqué si un filtre fondamental est actif.
  filtered = filtered.filter(t => cache[t] ? passesFilters(cache[t], filters.wl) : !hasActiveFundFilter(filters.wl));
  // Tri par colonne (si actif).
  filtered = sortByColumn(filtered, t => cache[t] || {}, sortState.wl);
  if (filtered.length === 0) {
    const why = watchlistFilterQuery ? `pour « ${esc(watchlistFilterQuery)} »` : "avec les filtres actifs";
    tbody.innerHTML = `<tr><td colspan="13" class="na">Aucun résultat ${why}.</td></tr>`;
    return;
  }
```

- [ ] **Step 2: Integrate filter + sort into renderMarketTable**

Dans `renderMarketTable`, repérer :
```js
function renderMarketTable() {
  const tbody = document.getElementById("market-body");
  const ranked = marketCandidates
    .map(m => ({ ...m, entry: cache[m.symbol] || marketCache[m.symbol] }))
    .filter(m => m.entry)
    .sort((a, b) => rankScore(b.entry) - rankScore(a.entry))
    .slice(0, 30);

  tbody.innerHTML = "";
  if (ranked.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="na">Lancez un scan pour voir les meilleures opportunités du marché.</td></tr>`;
    return;
  }
```
et le remplacer par :
```js
function renderMarketTable() {
  const tbody = document.getElementById("market-body");
  let list = marketCandidates
    .map(m => ({ ...m, entry: cache[m.symbol] || marketCache[m.symbol] }))
    .filter(m => m.entry)
    .filter(m => passesFilters(m.entry, filters.mk));
  list = sortState.mk.col
    ? sortByColumn(list, m => m.entry, sortState.mk)
    : list.sort((a, b) => rankScore(b.entry) - rankScore(a.entry));
  const ranked = list.slice(0, 30);

  tbody.innerHTML = "";
  if (typeof paintSortIndicators === "function") paintSortIndicators("market-table", "mk");
  if (ranked.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="na">Aucune valeur ne correspond (lancez un scan, ou assouplissez les filtres).</td></tr>`;
    return;
  }
```

- [ ] **Step 3: Verify filtering/sorting via console (driving state directly)**

Serveur lancé, page ouverte. Ajouter et analyser 3 titres, puis piloter l'état :
```js
(async function(){
  for (const t of ["AAPL","KO","XOM"]) { try{addTickerToWatchlist(t);}catch(e){} }
  await analyzeTicker("AAPL"); await analyzeTicker("KO"); await analyzeTicker("XOM");
  // tri par PER absent de COLUMN_VALUE → on trie par fonda desc
  sortState.wl = { col: "fonda", dir: -1 }; renderWatchlist();
  const order1 = [...document.querySelectorAll("#watchlist-body tr")].map(r => r.children[0].textContent.trim().slice(0,4));
  // filtre : global >= 60
  filters.wl = { globalMin: 60 }; renderWatchlist();
  const kept = [...document.querySelectorAll("#watchlist-body tr")].map(r => r.children[0].textContent.trim().slice(0,4));
  // reset
  filters.wl = {}; sortState.wl = { col:null, dir:1 }; renderWatchlist();
  return JSON.stringify({ order1, kept });
})();
```
Expected : `order1` = les tickers triés par score fondamental décroissant ; `kept` = uniquement les tickers dont le score global ≥ 60 (sous-ensemble). Aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(client): applique filtres & tri dans renderWatchlist et renderMarketTable"
```

---

### Task 3: Interface (panneaux de filtres, en-têtes triables, câblage, indicateurs)

**Files:**
- Modify: `terminal-tout-en-un.html` — en-têtes de tableaux (`data-sort`, ~lignes 679-688 et 831-836) ; placeholder marché `colspan` (~ligne 841) ; markup panneaux de filtres (F1 ~ligne 669, F5 ~ligne 823) ; CSS (section tableaux) ; câblage + `wireSortHeaders` + `paintSortIndicators` + init (fin de script, ~ligne 3011).

**Interfaces:**
- Consumes: `filters`, `sortState`, `saveFilters`, `renderWatchlist`, `renderMarketTable`, `renderMarketResults` (Task 1/2 + existant).
- Produces: `function wireSortHeaders(tableId, scope, renderFn)` ; `function paintSortIndicators(tableId, scope)` ; panneaux `.filter-panel` ; en-têtes `th[data-sort]`.

- [ ] **Step 1: Add data-sort to watchlist headers**

Remplacer le bloc d'en-tête de la watchlist :
```html
              <th>Ticker</th>
              <th class="num">Cours</th>
              <th class="num">Var. %</th>
              <th class="num">RSI 14</th>
              <th class="num">SMA 50</th>
              <th class="num">SMA 200</th>
              <th>Range 52 sem.</th>
              <th class="num">Score</th>
              <th class="num">Fonda</th>
              <th class="num">Global</th>
              <th>Signal</th>
              <th>MàJ</th>
              <th class="actions-col">Actions</th>
```
par :
```html
              <th>Ticker</th>
              <th class="num" data-sort="price">Cours</th>
              <th class="num" data-sort="change">Var. %</th>
              <th class="num" data-sort="rsi">RSI 14</th>
              <th class="num">SMA 50</th>
              <th class="num">SMA 200</th>
              <th>Range 52 sem.</th>
              <th class="num" data-sort="score">Score</th>
              <th class="num" data-sort="fonda">Fonda</th>
              <th class="num" data-sort="global">Global</th>
              <th>Signal</th>
              <th>MàJ</th>
              <th class="actions-col">Actions</th>
```

- [ ] **Step 2: Add data-sort to market headers + fix placeholder colspan**

Remplacer le bloc d'en-tête du marché :
```html
              <th>Rang</th>
              <th>Ticker</th>
              <th>Entreprise</th>
              <th class="num">Cours</th>
              <th class="num">Score</th>
              <th class="num">Fonda</th>
              <th class="num">Global</th>
              <th>Signal</th>
              <th class="num">Perf. 1 an</th>
              <th class="actions-col">Actions</th>
```
par :
```html
              <th>Rang</th>
              <th>Ticker</th>
              <th>Entreprise</th>
              <th class="num" data-sort="price">Cours</th>
              <th class="num" data-sort="score">Score</th>
              <th class="num" data-sort="fonda">Fonda</th>
              <th class="num" data-sort="global">Global</th>
              <th>Signal</th>
              <th class="num" data-sort="perf1y">Perf. 1 an</th>
              <th class="actions-col">Actions</th>
```
Puis corriger le placeholder statique juste en dessous :
```html
            <tr><td colspan="8" class="na">Lancez un scan pour voir les meilleures opportunités du marché.</td></tr>
```
→ `colspan="10"`.

- [ ] **Step 3: Add the filter panel to the watchlist (F1)**

Remplacer la ligne de filtre existante :
```html
      <div class="watchlist-filter-row">
        <label class="sr-only" for="watchlist-filter">Filtrer la watchlist</label>
        <input type="text" id="watchlist-filter" placeholder="🔎 Filtrer par ticker ou nom d'entreprise…" autocomplete="off">
      </div>
```
par :
```html
      <div class="watchlist-filter-row">
        <label class="sr-only" for="watchlist-filter">Filtrer la watchlist</label>
        <input type="text" id="watchlist-filter" placeholder="🔎 Filtrer par ticker ou nom d'entreprise…" autocomplete="off">
      </div>
      <div class="filter-panel" data-scope="wl">
        <span class="filter-label">Filtres :</span>
        <label>Global ≥ <input type="number" class="js-filter" data-scope="wl" data-key="globalMin" min="0" max="100" step="1"></label>
        <label>Fonda ≥ <input type="number" class="js-filter" data-scope="wl" data-key="fondaMin" min="0" max="100" step="1"></label>
        <label>PER ≤ <input type="number" class="js-filter" data-scope="wl" data-key="perMax" min="0" step="0.5"></label>
        <label>Div. ≥ <input type="number" class="js-filter" data-scope="wl" data-key="divMin" min="0" step="0.1"> %</label>
        <button type="button" class="btn btn-small btn-ghost js-filter-reset" data-scope="wl">Réinitialiser</button>
      </div>
```

- [ ] **Step 4: Add the filter panel to the Marché (F5)**

Juste après le bloc `.weight-control` du Marché et avant `<div class="table-wrap">`, insérer :
```html
      <div class="filter-panel" data-scope="mk">
        <span class="filter-label">Filtres :</span>
        <label>Global ≥ <input type="number" class="js-filter" data-scope="mk" data-key="globalMin" min="0" max="100" step="1"></label>
        <label>Fonda ≥ <input type="number" class="js-filter" data-scope="mk" data-key="fondaMin" min="0" max="100" step="1"></label>
        <label>PER ≤ <input type="number" class="js-filter" data-scope="mk" data-key="perMax" min="0" step="0.5"></label>
        <label>Div. ≥ <input type="number" class="js-filter" data-scope="mk" data-key="divMin" min="0" step="0.1"> %</label>
        <button type="button" class="btn btn-small btn-ghost js-filter-reset" data-scope="mk">Réinitialiser</button>
      </div>
```

- [ ] **Step 5: Add CSS**

Dans la section CSS (par ex. juste avant `.watchlist-filter-row { ... }` ~ligne 321), ajouter :
```css
.filter-panel { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 10px; font-size: 12px; color: var(--text-dim); }
.filter-panel .filter-label { text-transform: uppercase; letter-spacing: 1px; }
.filter-panel label { display: inline-flex; align-items: center; gap: 4px; color: var(--text); }
.filter-panel input[type="number"] { width: 64px; }
th.sortable { cursor: pointer; user-select: none; }
th.sortable:hover { color: var(--amber); }
```

- [ ] **Step 6: Add wiring + wireSortHeaders + paintSortIndicators + init**

Juste après `renderMarketResults(); // affichage initial…` (~ligne 3011), ajouter :
```js
/* ============================= FILTRES & TRI — CÂBLAGE ============================= */

// Met à jour les indicateurs ▲/▼ sur les en-têtes triables d'un tableau.
function paintSortIndicators(tableId, scope) {
  const st = sortState[scope];
  document.querySelectorAll(`#${tableId} thead th[data-sort]`).forEach(th => {
    if (!th.dataset.label) th.dataset.label = th.textContent;
    const arrow = th.dataset.sort === st.col ? (st.dir === 1 ? " ▲" : " ▼") : "";
    th.textContent = th.dataset.label + arrow;
  });
}

// Rend les en-têtes [data-sort] cliquables : 1er clic = desc, re-clic = inverse.
function wireSortHeaders(tableId, scope, renderFn) {
  document.querySelectorAll(`#${tableId} thead th[data-sort]`).forEach(th => {
    th.classList.add("sortable");
    th.addEventListener("click", () => {
      const col = th.dataset.sort, st = sortState[scope];
      if (st.col === col) st.dir = -st.dir; else { st.col = col; st.dir = -1; }
      renderFn();
    });
  });
}

(function initFiltersAndSort() {
  // Pré-remplissage des filtres depuis l'état (persisté par profil).
  document.querySelectorAll(".js-filter").forEach(inp => {
    const { scope, key } = inp.dataset;
    if (filters[scope] && filters[scope][key] != null) inp.value = filters[scope][key];
    inp.addEventListener("input", () => {
      const raw = inp.value;
      const v = raw === "" ? null : Number(raw);
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
  wireSortHeaders("watchlist-table", "wl", renderWatchlist);
  wireSortHeaders("market-table", "mk", renderMarketTable);
  // Applique un éventuel filtre déjà persisté au premier affichage.
  renderWatchlist();
  renderMarketTable();
})();
```

- [ ] **Step 7: Verify interactively in the browser**

Serveur lancé, page ouverte, watchlist avec AAPL/KO/XOM analysés. Vérifs :
```js
(function(){
  // clic sur l'en-tête "Global" de la watchlist
  const gh = [...document.querySelectorAll("#watchlist-table thead th[data-sort]")].find(th => th.dataset.sort === "global");
  gh.click();
  const arrow = gh.textContent.includes("▼");
  // saisie d'un filtre PER <= 20 côté marché via l'input
  const per = document.querySelector('.js-filter[data-scope="mk"][data-key="perMax"]');
  per.value = 20; per.dispatchEvent(new Event("input"));
  const persisted = localStorage.getItem("term_filters::Test");
  return JSON.stringify({ arrowShown: arrow, persistedHasMkPer: (persisted||"").includes("perMax") });
})();
```
Expected : `arrowShown` true (indicateur ▼ sur Global), `persistedHasMkPer` true (filtre marché persisté).

Puis **manuellement** : saisir « Global ≥ 60 » sur la watchlist → seules les lignes ≥ 60 restent ; recharger la page (F5) → le champ « Global ≥ » est pré-rempli à 60 et le filtre appliqué (persistance par profil) ; cliquer « Réinitialiser » → tout revient.

- [ ] **Step 8: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(client): UI filtres & tri (panneaux, en-têtes cliquables ▲/▼, persistance par profil)"
```

---

## Vérification finale (après les 3 tâches)

- [ ] `py -m unittest discover tests` → tests serveur inchangés, verts.
- [ ] Tri : cliquer « Global », « Fonda » (watchlist), « Perf. 1 an » (marché) → tri asc/desc, ▲/▼ correct, « — » en bas.
- [ ] Filtres : Global ≥ 60, PER ≤ 20, Div ≥ 3 % → masquage correct sur les deux tableaux ; titres sans fondamental masqués si filtre fondamental actif.
- [ ] Persistance : filtres pré-remplis après rechargement ; propres à chaque profil.
- [ ] Réinitialiser : vide les champs et réaffiche tout.
- [ ] Non-régression : sans filtre ni tri, tableaux identiques à avant.
- [ ] Merge `feat/filtres-tri` → `main` + push (déploiement Render) via finishing-a-development-branch.

## Notes d'implémentation

- **Ordre** : Task 1 (état + logique) → Task 2 (rendus) → Task 3 (UI + câblage). Les appels à `paintSortIndicators` en Task 2 sont protégés par `typeof` jusqu'à sa définition en Task 3.
- **Numéros de ligne** indicatifs ; se repérer sur les extraits exacts.
- **`div` (dividende)** n'est pas dans `COLUMN_VALUE` (pas de colonne dédiée) ; il n'est donc que filtrable, pas triable — cohérent avec l'absence de colonne dividende dans ces tableaux.
- **PER** idem : filtrable, non trié (pas de colonne PER dans ces tableaux).
