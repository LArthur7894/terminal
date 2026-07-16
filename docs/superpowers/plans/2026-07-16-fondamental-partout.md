# Fondamental sur tout le terminal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher le fondamental (score fondamental + score global pondéré) sur le Dashboard (F1) et le Marché (F5) en plus de l'onglet Analyse (F4), avec un curseur de pondération synchronisé partout, sans alourdir le scan de marché.

**Architecture:** Le scan de marché redevient purement technique (option `skipFund` sur `analyzeTicker`) ; un bouton enrichit le top 30 à la demande. Un curseur de pondération partagé (classes + `setWeightTech`) apparaît sur F1/F5/F4. Les tableaux Dashboard et Marché gagnent des colonnes Fonda/Global et se classent par score global.

**Tech Stack:** HTML/CSS/JS vanilla (fichier unique `terminal-tout-en-un.html`, sans build). Serveur Python inchangé.

## Global Constraints

- **Pas de build front** : tout dans `terminal-tout-en-un.html`. Français, `esc()` pour tout contenu injecté, toasts pour les erreurs.
- **Économie de requêtes Yahoo** : le scan de marché ne doit émettre **aucune** requête `/api/fundamentals`. L'enrichissement se limite au top 30, concurrence 5.
- **Robustesse « zéro faille »** : un titre sans fondamental affiche « — » (Fonda/Global) et son score global retombe sur le technique. Jamais de plantage.
- **Interpréteur Python** : `py` (ou chemin complet `C:\Users\amagu\AppData\Local\Programs\Python\Python311\python.exe`). Pour les tests headless : lancer le serveur avec `PYTHONIOENCODING=utf-8`, et pré-remplir `localStorage` (`term_profiles=["Test"]`, `term_current_profile="Test"`) pour éviter le `window.prompt()` de `pickProfile`. Ouvrir `http://localhost:8750/terminal-tout-en-un.html` (pas `/`).
- Le serveur sert le dossier : pas d'`index.html`.
- Encodage UTF-8.

---

### Task 1: `analyzeTicker` — option `skipFund` + scan de marché allégé

Le scan appelle `analyzeTicker` sur des centaines de titres ; il ne doit plus récupérer les fondamentaux.

**Files:**
- Modify: `terminal-tout-en-un.html` — `analyzeTicker` (fonction, ~ligne 1487 après les ajouts précédents) ; `runMarketScan` (~ligne 2900+).

**Interfaces:**
- Consumes: `fetchFundamentals`, `computeFundScore` (existant).
- Produces: `analyzeTicker(ticker, button, opts)` accepte `opts.skipFund` (défaut `false`). Quand `true`, `fund`/`fundScore` restent `null` sans requête réseau.

- [ ] **Step 1: Add skipFund to analyzeTicker**

Repérer dans `analyzeTicker` la ligne de déstructuration des options et la récupération des fondamentaux. Remplacer :

```js
  const { silent = false, skipRender = false, store = cache } = opts;
```
par :
```js
  const { silent = false, skipRender = false, store = cache, skipFund = false } = opts;
```

Puis remplacer le bloc :
```js
    // Fondamentaux : facultatifs. Une panne ici ne doit pas casser l'analyse technique.
    let fund = null;
    try { fund = await fetchFundamentals(ticker); }
    catch (e) { fund = null; /* silencieux : l'UI affichera « indisponible » */ }
    const fundScore = computeFundScore(fund);
```
par :
```js
    // Fondamentaux : facultatifs, et sautés en masse (scan marché) via skipFund.
    // Une panne ici ne doit jamais casser l'analyse technique.
    let fund = null;
    if (!skipFund) {
      try { fund = await fetchFundamentals(ticker); }
      catch (e) { fund = null; /* silencieux : l'UI affichera « indisponible » */ }
    }
    const fundScore = computeFundScore(fund);
```

- [ ] **Step 2: Pass skipFund from the market scan**

Dans `runMarketScan`, repérer l'appel :
```js
      await analyzeTicker(symbol, null, { silent: true, skipRender: true, store: target });
```
Le remplacer par :
```js
      await analyzeTicker(symbol, null, { silent: true, skipRender: true, store: target, skipFund: true });
```

- [ ] **Step 3: Verify the scan emits no fundamentals request**

Lancer le serveur (`PYTHONIOENCODING=utf-8 <python> server.py`), ouvrir `http://localhost:8750/terminal-tout-en-un.html` (profil pré-rempli). Dans la console, lancer un mini-scan et compter les requêtes `/api/fundamentals` :

```js
(async function(){
  let fundCalls = 0;
  const _f = window.fetch;
  window.fetch = (u, o) => { if (typeof u === "string" && u.includes("/api/fundamentals")) fundCalls++; return _f(u, o); };
  // Analyse 3 tickers façon scan (skipFund)
  await analyzeTicker("AAPL", null, { silent: true, skipRender: true, store: marketCache, skipFund: true });
  await analyzeTicker("MSFT", null, { silent: true, skipRender: true, store: marketCache, skipFund: true });
  window.fetch = _f;
  return JSON.stringify({ fundCalls, aaplFund: marketCache.AAPL && marketCache.AAPL.fund, aaplScore: marketCache.AAPL && marketCache.AAPL.score });
})();
```
Expected : `fundCalls` = 0, `aaplFund` = null, `aaplScore` = un nombre (technique calculé). Le scan reste technique.

- [ ] **Step 4: Verify individual analysis still fetches fundamentals**

```js
(async function(){
  await analyzeTicker("AAPL"); // sans skipFund
  return JSON.stringify({ hasFund: !!cache.AAPL.fund, fundScore: cache.AAPL.fundScore && cache.AAPL.fundScore.total });
})();
```
Expected : `hasFund` = true, `fundScore` un nombre. Le comportement watchlist est préservé.

- [ ] **Step 5: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(client): option skipFund sur analyzeTicker, scan marché redevient purement technique"
```

---

### Task 2: Curseur de pondération partagé et synchronisé (F1/F5/F4)

Un même curseur sur trois panneaux, lié à `weightTech`, qui recalcule tous les scores globaux affichés.

**Files:**
- Modify: `terminal-tout-en-un.html` — markup du curseur F4 (~ligne 787) converti en classes et dupliqué dans F1 (après `.panel-head` du Dashboard, ~ligne 651) et F5 (après le titre du Marché, ~ligne 802) ; remplacement de `initWeightSlider` (~ligne 2497) par `setWeightTech` + `paintWeightControls` + init générique ; CSS `.weight-control` (déjà présent, ajuster `label`/`input` sélecteurs).

**Interfaces:**
- Consumes: `weightTech`, `clamp01`, `lsSet`, `LS.weightTech`, `renderWatchlist`, `renderAutopick`, `renderMarketTable`, `renderAnalysis` (existant).
- Produces:
  - `function setWeightTech(v)` — clamp, persiste, repeint tous les curseurs, re-render F1/F5/F4.
  - `function paintWeightControls()` — met à jour tous les `.js-weight-slider` et `.js-weight-label`.
  - Markup réutilisable : `.weight-control` contenant `.js-weight-slider` et `.js-weight-label`.

- [ ] **Step 1: Convert the F4 slider markup to classes**

Remplacer le bloc actuel (F4, ~lignes 787-793) :
```html
      <div class="weight-control">
        <label for="weight-slider">Pondération du score global :
          <strong id="weight-label">50 % technique / 50 % fondamental</strong>
        </label>
        <input type="range" id="weight-slider" min="0" max="100" step="5" value="50">
        <span class="weight-ends"><span>100 % fonda</span><span>100 % tech</span></span>
      </div>
```
par :
```html
      <div class="weight-control">
        <label>Pondération du score global :
          <strong class="js-weight-label">50 % technique / 50 % fondamental</strong>
        </label>
        <input type="range" class="js-weight-slider" min="0" max="100" step="5" value="50" aria-label="Pondération technique / fondamental">
        <span class="weight-ends"><span>100 % fonda</span><span>100 % tech</span></span>
      </div>
```

- [ ] **Step 2: Add the same slider block to the Dashboard (F1)**

Dans le panneau Dashboard, juste après la fermeture de `.panel-head` (après `</div>` de la ligne ~651, avant `<div class="autopick-card"...>`), insérer :
```html
      <div class="weight-control">
        <label>Pondération du score global :
          <strong class="js-weight-label">50 % technique / 50 % fondamental</strong>
        </label>
        <input type="range" class="js-weight-slider" min="0" max="100" step="5" value="50" aria-label="Pondération technique / fondamental">
        <span class="weight-ends"><span>100 % fonda</span><span>100 % tech</span></span>
      </div>
```

- [ ] **Step 3: Add the same slider block to the Marché panel (F5)**

Dans le panneau Marché, juste après `<p class="hint" id="market-status">…</p>` (~ligne 803), avant `<div class="table-wrap">`, insérer le même bloc :
```html
      <div class="weight-control">
        <label>Pondération du score global :
          <strong class="js-weight-label">50 % technique / 50 % fondamental</strong>
        </label>
        <input type="range" class="js-weight-slider" min="0" max="100" step="5" value="50" aria-label="Pondération technique / fondamental">
        <span class="weight-ends"><span>100 % fonda</span><span>100 % tech</span></span>
      </div>
```

- [ ] **Step 4: Update the weight-control CSS selectors**

Le CSS actuel cible `#weight-label`. Le remplacer par la classe. Repérer dans la section ANALYSE :
```css
.weight-control #weight-label { color: var(--text); font-family: var(--mono); }
```
et le remplacer par :
```css
.weight-control .js-weight-label { color: var(--text); font-family: var(--mono); }
```

- [ ] **Step 5: Replace initWeightSlider with setWeightTech + generic wiring**

Repérer le bloc actuel (ajouté par la fonctionnalité précédente, après le listener `btn-refresh-analysis`, ~ligne 2497) :
```js
// Curseur de pondération : la valeur du slider = part du TECHNIQUE (0..100).
(function initWeightSlider() {
  const slider = document.getElementById("weight-slider");
  const label = document.getElementById("weight-label");
  if (!slider || !label) return;
  const paint = () => {
    const tech = Math.round(weightTech * 100);
    slider.value = tech;
    label.textContent = `${tech} % technique / ${100 - tech} % fondamental`;
  };
  paint();
  slider.addEventListener("input", () => {
    weightTech = clamp01(Number(slider.value) / 100);
    lsSet(LS.weightTech, weightTech);
    label.textContent = `${Math.round(weightTech * 100)} % technique / ${Math.round((1 - weightTech) * 100)} % fondamental`;
    renderAnalysis(); // recalcule tous les scores globaux affichés, sans requête réseau
  });
})();
```
et le remplacer par :
```js
// Curseur de pondération partagé (Dashboard, Marché, Analyse) : la valeur = part du TECHNIQUE (0..100).
// Tous les curseurs .js-weight-slider sont synchronisés sur weightTech.
function paintWeightControls() {
  const tech = Math.round(weightTech * 100);
  document.querySelectorAll(".js-weight-slider").forEach(s => { s.value = tech; });
  document.querySelectorAll(".js-weight-label").forEach(l => {
    l.textContent = `${tech} % technique / ${100 - tech} % fondamental`;
  });
}

function setWeightTech(v) {
  weightTech = clamp01(v);
  lsSet(LS.weightTech, weightTech);
  paintWeightControls();
  // Recalcule tous les scores globaux affichés, sans requête réseau.
  renderWatchlist();
  renderAutopick();
  renderMarketTable();
  renderAnalysis();
}

(function initWeightControls() {
  paintWeightControls();
  document.querySelectorAll(".js-weight-slider").forEach(slider => {
    slider.addEventListener("input", () => setWeightTech(Number(slider.value) / 100));
  });
})();
```

- [ ] **Step 6: Verify synchronization in the browser**

Recharger. Analyser AAPL (F1). En console :
```js
(function(){
  const sliders = [...document.querySelectorAll(".js-weight-slider")];
  const labels = [...document.querySelectorAll(".js-weight-label")];
  // simule un déplacement du premier curseur à 20 % technique
  sliders[0].value = 20; sliders[0].dispatchEvent(new Event("input"));
  return JSON.stringify({
    count: sliders.length,
    allSlidersAt20: sliders.every(s => s.value === "20"),
    labelSample: labels[0].textContent,
    persisted: localStorage.getItem("term_weight_tech::Test")
  });
})();
```
Expected : `count` = 3, `allSlidersAt20` = true, `labelSample` = « 20 % technique / 80 % fondamental », `persisted` = « 0.2 ».

- [ ] **Step 7: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(client): curseur de pondération synchronisé sur Dashboard, Marché et Analyse"
```

---

### Task 3: Dashboard (F1) — colonnes Fonda/Global + top picks par score global

**Files:**
- Modify: `terminal-tout-en-un.html` — en-tête du tableau watchlist (~ligne 677) ; `renderWatchlist` (~ligne 1790, colspans + cellules) ; `computeTopPicks` (~ligne 1949).

**Interfaces:**
- Consumes: `computeGlobalScore`, `cache`, `pctClass`, `fnum`, `fpct` (existant).
- Produces: watchlist affiche Fonda + Global ; `computeTopPicks` trié par score global.

- [ ] **Step 1: Add the two header columns**

Dans l'en-tête du tableau watchlist, remplacer :
```html
              <th class="num">Score</th>
              <th>Signal</th>
```
par :
```html
              <th class="num">Score</th>
              <th class="num">Fonda</th>
              <th class="num">Global</th>
              <th>Signal</th>
```

- [ ] **Step 2: Update colspans in renderWatchlist (11 → 13)**

Dans `renderWatchlist`, remplacer les deux `colspan="11"` :
```js
    tbody.innerHTML = `<tr><td colspan="11" class="na">Watchlist vide — ajoutez un ticker ci-dessus (ex. AAPL, MSFT, MC.PA, TTE.PA).</td></tr>`;
```
→ `colspan="13"` ; et
```js
    tbody.innerHTML = `<tr><td colspan="11" class="na">Aucun résultat pour « ${esc(watchlistFilterQuery)} ».</td></tr>`;
```
→ `colspan="13"`.

- [ ] **Step 3: Add Fonda/Global cells for entries with cache**

Dans la branche `if (entry) {` de `renderWatchlist`, repérer la cellule du score technique et la cellule Signal :
```js
        <td class="num">
          <span class="score-cell">
            <span class="score-bar"><span class="score-fill" style="width:${score}%"></span></span>
            <span>${score}</span>
          </span>
        </td>
        <td><span class="signal signal-${signal.toLowerCase()}">${signal}</span></td>
```
Insérer les deux cellules Fonda/Global **entre** la cellule score et la cellule signal :
```js
        <td class="num">
          <span class="score-cell">
            <span class="score-bar"><span class="score-fill" style="width:${score}%"></span></span>
            <span>${score}</span>
          </span>
        </td>
        <td class="num">${entry.fundScore ? entry.fundScore.total : "—"}</td>
        <td class="num">
          <span class="score-cell">
            <span class="score-bar"><span class="score-fill" style="width:${computeGlobalScore(entry)}%"></span></span>
            <span>${computeGlobalScore(entry)}</span>
          </span>
        </td>
        <td><span class="signal signal-${signal.toLowerCase()}">${signal}</span></td>
```

- [ ] **Step 4: Add Fonda/Global cells for entries without cache**

Dans la branche `else {` de `renderWatchlist`, repérer la ligne des cellules « — » :
```js
        <td class="num na">—</td><td class="na">—</td><td class="na">jamais</td>
```
Cette ligne représente Score / Signal / MàJ. Insérer deux cellules « — » pour Fonda et Global entre Score et Signal :
```js
        <td class="num na">—</td><td class="num na">—</td><td class="num na">—</td><td class="na">—</td><td class="na">jamais</td>
```
(soit : Score —, Fonda —, Global —, Signal —, MàJ jamais).

- [ ] **Step 5: Rank top picks by global score**

Remplacer `computeTopPicks` :
```js
function computeTopPicks(limit = Infinity) {
  return watchlist
    .map(t => ({ ticker: t, entry: cache[t] }))
    .filter(x => x.entry && x.entry.signal === "Achat")
    .sort((a, b) => b.entry.score - a.entry.score)
    .slice(0, limit);
}
```
par :
```js
function computeTopPicks(limit = Infinity) {
  return watchlist
    .map(t => ({ ticker: t, entry: cache[t] }))
    .filter(x => x.entry && x.entry.signal === "Achat")
    .sort((a, b) => computeGlobalScore(b.entry) - computeGlobalScore(a.entry))
    .slice(0, limit);
}
```

- [ ] **Step 6: Verify in the browser**

Recharger, analyser AAPL et MSFT (F1). En console :
```js
(function(){
  const rows = [...document.querySelectorAll("#watchlist-body tr")];
  const headerCells = document.querySelectorAll("#watchlist-table thead th").length;
  const aaplRow = rows.find(r => r.textContent.includes("AAPL"));
  const cells = aaplRow ? [...aaplRow.querySelectorAll("td")].length : 0;
  return JSON.stringify({ headerCells, aaplCells: cells });
})();
```
Expected : `headerCells` = 13, `aaplCells` = 13. Vérifier visuellement que les colonnes Fonda/Global de la watchlist affichent des nombres pour AAPL/MSFT.

- [ ] **Step 7: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(client): Dashboard — colonnes Fonda/Global dans la watchlist + top picks par score global"
```

---

### Task 4: Marché (F5) — colonnes Fonda/Global + tri global + bouton « Enrichir le top »

**Files:**
- Modify: `terminal-tout-en-un.html` — en-tête du tableau marché (~ligne 812) ; bouton dans `.panel-head` du Marché (~ligne 801) ; `renderMarketTable` (~ligne 2965, colspan + tri + cellules) ; ajout de `rankScore` et `enrichMarketTop` + câblage du bouton (~ligne 3010).

**Interfaces:**
- Consumes: `marketCandidates`, `cache`, `marketCache`, `computeGlobalScore`, `computeFundScore`, `fetchFundamentals`, `runPool`, `renderMarketTable`, `renderMarketResults`, `lsSet`, `LS.cache` (existant).
- Produces: `function rankScore(entry)` ; `async function enrichMarketTop()` ; tableau marché avec Fonda/Global, classé par score de rang.

- [ ] **Step 1: Add the two header columns (market table)**

Dans l'en-tête du tableau marché, remplacer :
```html
              <th class="num">Score</th>
              <th>Signal</th>
```
par :
```html
              <th class="num">Score</th>
              <th class="num">Fonda</th>
              <th class="num">Global</th>
              <th>Signal</th>
```

- [ ] **Step 2: Add the enrich button**

Dans le `.panel-head` du Marché, remplacer :
```html
        <button class="btn btn-accent" id="btn-market-scan">Scanner le marché</button>
```
par :
```html
        <span class="market-actions">
          <button class="btn btn-accent" id="btn-market-scan">Scanner le marché</button>
          <button class="btn btn-ghost" id="btn-market-enrich">★ Enrichir le top (fondamental)</button>
        </span>
```

- [ ] **Step 3: Add rankScore and update renderMarketTable (colspan, sort, cells)**

Dans `renderMarketTable`, remplacer le début (construction de `ranked` + garde colspan) :
```js
function renderMarketTable() {
  const tbody = document.getElementById("market-body");
  const ranked = marketCandidates
    .map(m => ({ ...m, entry: cache[m.symbol] || marketCache[m.symbol] }))
    .filter(m => m.entry)
    .sort((a, b) => b.entry.score - a.entry.score)
    .slice(0, 30);

  tbody.innerHTML = "";
  if (ranked.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="na">Lancez un scan pour voir les meilleures opportunités du marché.</td></tr>`;
    return;
  }
```
par :
```js
// Score de classement : global si le fondamental est présent (enrichi), sinon technique.
function rankScore(entry) { return entry.fundScore ? computeGlobalScore(entry) : entry.score; }

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

Puis, dans la boucle `ranked.forEach(...)`, remplacer le template de ligne :
```js
    tr.innerHTML = `
      <td class="na">#${i + 1}</td>
      <td><span class="cell-ticker">${esc(m.symbol)}</span></td>
      <td>${esc(m.name)}</td>
      <td class="num">${fnum(m.entry.ind.price)}</td>
      <td class="num">${m.entry.score}/100</td>
      <td><span class="signal signal-${m.entry.signal.toLowerCase()}">${m.entry.signal}</span></td>
      <td class="num ${pctClass(m.entry.ind.perf.y1)}">${fpct(m.entry.ind.perf.y1)}</td>
      <td class="actions-col"></td>`;
```
par :
```js
    const fs = m.entry.fundScore;
    tr.innerHTML = `
      <td class="na">#${i + 1}</td>
      <td><span class="cell-ticker">${esc(m.symbol)}</span></td>
      <td>${esc(m.name)}</td>
      <td class="num">${fnum(m.entry.ind.price)}</td>
      <td class="num">${m.entry.score}/100</td>
      <td class="num">${fs ? fs.total : "—"}</td>
      <td class="num">${fs ? computeGlobalScore(m.entry) : "—"}</td>
      <td><span class="signal signal-${m.entry.signal.toLowerCase()}">${m.entry.signal}</span></td>
      <td class="num ${pctClass(m.entry.ind.perf.y1)}">${fpct(m.entry.ind.perf.y1)}</td>
      <td class="actions-col"></td>`;
```

- [ ] **Step 4: Add enrichMarketTop and wire the button**

Repérer le câblage existant du scan (~ligne 3010) :
```js
document.getElementById("btn-market-scan").addEventListener("click", runMarketScan);
renderMarketResults(); // affichage initial depuis le cache existant (watchlist déjà analysée, etc.)
```
Le remplacer par :
```js
document.getElementById("btn-market-scan").addEventListener("click", runMarketScan);

// Enrichissement fondamental à la demande : récupère le fondamental des 30 titres du top
// affiché (30 requêtes, concurrence douce), puis reclasse par score global.
async function enrichMarketTop() {
  const btn = document.getElementById("btn-market-enrich");
  const status = document.getElementById("market-status");
  const ranked = marketCandidates
    .map(m => ({ ...m, entry: cache[m.symbol] || marketCache[m.symbol] }))
    .filter(m => m.entry)
    .sort((a, b) => rankScore(b.entry) - rankScore(a.entry))
    .slice(0, 30);

  if (ranked.length === 0) {
    toast("Lancez d'abord un scan du marché.", "warn");
    return;
  }

  btn.disabled = true;
  let done = 0, touchedCache = false;
  await runPool(ranked, async ({ symbol, entry }) => {
    if (!entry.fundScore) { // pas déjà enrichi
      let fund = null;
      try { fund = await fetchFundamentals(symbol); } catch (e) { fund = null; }
      entry.fund = fund;
      entry.fundScore = computeFundScore(fund);
      if (cache[symbol] === entry) touchedCache = true; // aussi en watchlist → persister
    }
    done++;
    status.textContent = `Enrichissement fondamental… ${done}/${ranked.length}`;
    if (done % 5 === 0 || done === ranked.length) renderMarketTable();
  }, 5);

  if (touchedCache) lsSet(LS.cache, cache);
  btn.disabled = false;
  renderMarketResults();
  toast(`Top ${ranked.length} enrichi avec les données fondamentales.`, "success");
}
document.getElementById("btn-market-enrich").addEventListener("click", enrichMarketTop);

renderMarketResults(); // affichage initial depuis le cache existant (watchlist déjà analysée, etc.)
```

- [ ] **Step 5: Verify in the browser**

Recharger. En console, simuler un petit univers de scan puis enrichir :
```js
(async function(){
  // mini-scan technique (skipFund) sur quelques titres
  marketCandidates = [{symbol:"AAPL",name:"Apple"},{symbol:"MSFT",name:"Microsoft"},{symbol:"KO",name:"Coca-Cola"}];
  for (const c of marketCandidates) await analyzeTicker(c.symbol, null, { silent:true, skipRender:true, store: marketCache, skipFund:true });
  renderMarketTable();
  const beforeCols = document.querySelectorAll("#market-table thead th").length;
  const beforeFonda = [...document.querySelectorAll("#market-body tr")].map(r => r.children[5].textContent);
  // enrichir
  await enrichMarketTop();
  const afterFonda = [...document.querySelectorAll("#market-body tr")].map(r => r.children[5].textContent);
  return JSON.stringify({ beforeCols, beforeFonda, afterFonda });
})();
```
Expected : `beforeCols` = 10 ; `beforeFonda` = ["—","—","—"] (avant enrichissement) ; `afterFonda` = des nombres (après). Vérifier visuellement que le tableau se reclasse.

- [ ] **Step 6: Verify the market scan itself emits no fundamentals request (regression guard)**

```js
(async function(){
  let fundCalls = 0; const _f = window.fetch;
  window.fetch = (u,o)=>{ if (typeof u==="string" && u.includes("/api/fundamentals")) fundCalls++; return _f(u,o); };
  await analyzeTicker("NVDA", null, { silent:true, skipRender:true, store: marketCache, skipFund:true });
  window.fetch = _f;
  return JSON.stringify({ fundCalls });
})();
```
Expected : `fundCalls` = 0.

- [ ] **Step 7: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(client): Marché — colonnes Fonda/Global, tri par score global, bouton d'enrichissement du top"
```

---

## Vérification finale (après les 4 tâches)

- [ ] `py -m unittest discover tests` → tests serveur toujours verts (inchangés).
- [ ] Scan de marché réel → **zéro** requête `/api/fundamentals` pendant le scan (onglet Réseau), tableau technique rempli.
- [ ] Bouton « Enrichir le top » → ~30 requêtes `/api/fundamentals`, colonnes Fonda/Global remplies, tableau reclassé par global.
- [ ] Dashboard : watchlist affiche Fonda/Global (13 colonnes) ; top picks classés par global.
- [ ] Curseur bougé sur n'importe quel onglet → les 3 curseurs suivent, scores globaux recalculés partout, aucune requête réseau, valeur persistée après rechargement.
- [ ] ETF (SPY) en watchlist et dans le top → « — » propre, aucun plantage.
- [ ] `git log --oneline` : un commit par tâche.
- [ ] Merge `feat/fondamental-partout` → `main` puis push (déploiement Render) via finishing-a-development-branch.

## Notes d'implémentation

- **Ordre** : Task 1 (scan allégé) → Task 2 (curseur partagé) → Task 3 (Dashboard) → Task 4 (Marché). Task 2 avant 3/4 car `setWeightTech` re-render ces vues.
- **Numéros de ligne** : indicatifs (le fichier a évolué). Se repérer sur les extraits de code exacts.
- **`rankScore`** défini une seule fois (Task 4), utilisé par `renderMarketTable` et `enrichMarketTop`.
- **Persistance** : seules les entrées aussi présentes dans `cache` (watchlist) sont persistées après enrichissement ; `marketCache` reste en mémoire (volontaire, cf. commentaire existant).
