# Comparateur multi-titres — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Onglet F9 « Comparer » : sélection de 2-4 titres, tableau comparatif (meilleure valeur surlignée) + graphique de prix normalisés superposés.

**Tech Stack:** HTML/CSS/JS vanilla, Chart.js (déjà chargé). Aucune modif serveur.

## Global Constraints
- Pas de build ; français ; `esc()` pour le contenu injecté.
- Réutilise l'historique en cache (zéro requête réseau).
- Tests headless : serveur `PYTHONIOENCODING=utf-8` ; localStorage seedé ; ouvrir `http://localhost:8750/terminal-tout-en-un.html`.

---

### Task 1: Onglet F9 + sélection + tableau comparatif

**Files:** Modify `terminal-tout-en-un.html` — barre d'onglets (~ligne 711) ; panneau après `panel-bot` ; map clavier ; hook bascule ; état + `COMPARE_METRICS` + `compareBest` + `renderCompare` (table) + câblage ; CSS.

**Interfaces:**
- Consumes: `watchlist`, `cache`, `computeGlobalScore`, `fnum`, `fpct`, `ffrac`, `fmtMarketCap`, `esc` (existant).
- Produces: `let compareSel`, `let comparePeriod`, `let compareChart` ; `COMPARE_METRICS`, `COMPARE_COLORS`, `compareBest`, `renderCompare`.

- [ ] **Step 1: Tab button (F9)**

Après le bouton F8 (`data-tab="bot"`), ajouter :
```html
      <button class="tab" role="tab" aria-selected="false" aria-controls="panel-compare" id="tab-compare" data-tab="compare">F9 · COMPARER</button>
```

- [ ] **Step 2: Panel**

Après `</section>` de `panel-bot`, avant `</main>`, insérer :
```html
    <!-- ======================= ONGLET 9 : COMPARER ======================= -->
    <section class="panel" id="panel-compare" role="tabpanel" aria-labelledby="tab-compare" hidden>
      <div class="panel-head">
        <h1>Comparer <span class="muted">/ 2 à 4 titres de la watchlist, côte à côte</span></h1>
      </div>
      <div id="compare-select" class="compare-select"></div>
      <div id="compare-periods" class="chart-periods" role="tablist"></div>
      <div class="chart-holder"><canvas id="compare-canvas"></canvas></div>
      <div id="compare-table"></div>
    </section>
```

- [ ] **Step 3: Keyboard + tab-switch hook**

Map clavier → ajouter `F9: "compare"` :
```js
  const map = { F1: "dashboard", F2: "positions", F3: "buysim", F4: "analyse", F5: "marche", F6: "allocation", F7: "alerts", F8: "bot", F9: "compare" };
```
Hook de bascule → ajouter :
```js
    if (btn.dataset.tab === "compare") renderCompare();
```

- [ ] **Step 4: State + metrics + compareBest + renderCompare (table) + wiring**

Après le câblage du bot (après `renderBot();`), ajouter :
```js
/* ============================= ONGLET 9 : COMPARER ============================= */

let compareSel = [];
let comparePeriod = "1a";
let compareChart = null;
const COMPARE_COLORS = ["#ffb000", "#4aa8ff", "#b980ff", "#2dd4bf"];

// Métriques comparées : get(entry) -> nombre|null ; dir "high"/"low"/"none" ; fmt(v)->string.
const COMPARE_METRICS = [
  ["Cours", e => e.ind ? e.ind.price : null, "none", v => fnum(v)],
  ["Perf. 1 mois", e => e.ind && e.ind.perf ? e.ind.perf.m1 : null, "high", v => fpct(v)],
  ["Perf. 3 mois", e => e.ind && e.ind.perf ? e.ind.perf.m3 : null, "high", v => fpct(v)],
  ["Perf. 1 an", e => e.ind && e.ind.perf ? e.ind.perf.y1 : null, "high", v => fpct(v)],
  ["RSI 14", e => e.ind ? e.ind.rsi : null, "none", v => fnum(v)],
  ["Volatilité", e => e.ind ? e.ind.vol : null, "low", v => fnum(v) + " %"],
  ["Score technique", e => e.score != null ? e.score : null, "high", v => String(v)],
  ["Score fondamental", e => e.fundScore ? e.fundScore.total : null, "high", v => String(v)],
  ["Score global", e => e.score != null ? computeGlobalScore(e) : null, "high", v => String(v)],
  ["PER", e => e.fund ? e.fund.trailingPE : null, "low", v => fnum(v)],
  ["PER prév.", e => e.fund ? e.fund.forwardPE : null, "low", v => fnum(v)],
  ["Rendement dividende", e => e.fund ? e.fund.dividendYield : null, "high", v => ffrac(v)],
  ["Marge nette", e => e.fund ? e.fund.profitMargins : null, "high", v => ffrac(v)],
  ["ROE", e => e.fund ? e.fund.returnOnEquity : null, "high", v => ffrac(v)],
  ["Croissance CA", e => e.fund ? e.fund.revenueGrowth : null, "high", v => ffrac(v)],
  ["Dette / cap. propres", e => e.fund && e.fund.debtToEquity != null ? e.fund.debtToEquity / 100 : null, "low", v => fnum(v)],
  ["Capitalisation", e => e.fund ? e.fund.marketCap : null, "high", (v, e) => fmtMarketCap(v, e.fund && e.fund.currency)],
];

// Index de la meilleure valeur (max si high, min si low). -1 si none/aucune.
function compareBest(values, dir) {
  if (dir === "none") return -1;
  let best = -1, bestVal = null;
  values.forEach((v, i) => {
    if (v == null || !isFinite(v)) return;
    if (bestVal == null || (dir === "high" ? v > bestVal : v < bestVal)) { bestVal = v; best = i; }
  });
  return best;
}

function renderCompare() {
  const selEl = document.getElementById("compare-select");
  const tableEl = document.getElementById("compare-table");
  if (!selEl) return;

  const analyzable = watchlist.filter(t => cache[t]);
  // Nettoyer la sélection des tickers disparus.
  compareSel = compareSel.filter(t => analyzable.includes(t));

  if (analyzable.length === 0) {
    selEl.innerHTML = `<p class="analysis-empty">Analysez d'abord des titres (onglet Dashboard F1) pour pouvoir les comparer.</p>`;
    tableEl.innerHTML = "";
    return;
  }

  const full = compareSel.length >= 4;
  selEl.innerHTML = analyzable.map(t => {
    const checked = compareSel.includes(t);
    return `<label class="compare-chk"><input type="checkbox" class="js-compare-chk" value="${esc(t)}" ${checked ? "checked" : ""} ${(!checked && full) ? "disabled" : ""}> ${esc(t)}</label>`;
  }).join("");

  // Boutons période
  document.getElementById("compare-periods").innerHTML = CHART_PERIODS.map(p =>
    `<button type="button" class="btn btn-small period-btn ${comparePeriod === p.key ? "btn-accent" : "btn-ghost"}" data-period="${p.key}">${p.label}</button>`
  ).join("");

  if (compareSel.length < 2) {
    tableEl.innerHTML = `<p class="analysis-empty">Cochez au moins 2 titres pour les comparer.</p>`;
    if (compareChart) { compareChart.destroy(); compareChart = null; }
    return;
  }

  // Tableau comparatif
  const entries = compareSel.map(t => cache[t]);
  const header = `<th>Métrique</th>` + compareSel.map((t, i) => `<th class="num" style="color:${COMPARE_COLORS[i]}">${esc(t)}</th>`).join("");
  const rows = COMPARE_METRICS.map(([label, get, dir, fmt]) => {
    const vals = entries.map(e => { const v = get(e); return (v != null && isFinite(v)) ? v : null; });
    const best = compareBest(vals, dir);
    const cells = vals.map((v, i) => `<td class="num ${i === best ? "best" : ""}">${v == null ? "—" : esc(fmt(v, entries[i]))}</td>`).join("");
    return `<tr><td>${esc(label)}</td>${cells}</tr>`;
  }).join("");
  tableEl.innerHTML = `<div class="table-wrap"><table class="data-table compare-data"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;

  renderCompareChart(); // défini en Task 2 (protégé si absent)
}

document.getElementById("compare-select").addEventListener("change", e => {
  const chk = e.target.closest(".js-compare-chk");
  if (!chk) return;
  if (chk.checked) { if (!compareSel.includes(chk.value) && compareSel.length < 4) compareSel.push(chk.value); }
  else { compareSel = compareSel.filter(t => t !== chk.value); }
  renderCompare();
});
document.getElementById("compare-periods").addEventListener("click", e => {
  const btn = e.target.closest(".period-btn");
  if (btn) { comparePeriod = btn.dataset.period; renderCompare(); }
});

function renderCompareChart() { /* remplacé en Task 2 */ }
```

> Note : `renderCompareChart` est un stub ici, remplacé par la vraie fonction en Task 2. `renderCompare` l'appelle — inoffensif tant qu'il est vide.

- [ ] **Step 5: CSS**

Près de `.filter-panel` :
```css
.compare-select { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }
.compare-chk { display: inline-flex; align-items: center; gap: 5px; font-family: var(--mono); font-size: 13px; }
.compare-data td.best { color: var(--green); font-weight: 700; }
.compare-data th:first-child, .compare-data td:first-child { text-align: left; color: var(--text-dim); }
```

- [ ] **Step 6: Verify table + selection (console)**

Serveur lancé, page ouverte. Analyser 2 titres, cocher, vérifier le tableau et le surlignage :
```js
(async function(){
  for (const t of ["AAPL","KO"]) { try{addTickerToWatchlist(t);}catch(e){} await analyzeTicker(t); }
  document.getElementById("tab-compare").click();
  document.querySelectorAll(".js-compare-chk").forEach(c => { if (["AAPL","KO"].includes(c.value)) { c.checked = true; c.dispatchEvent(new Event("change", {bubbles:true})); } });
  const cols = document.querySelectorAll("#compare-table thead th").length;
  const rows = document.querySelectorAll("#compare-table tbody tr").length;
  const bestCells = document.querySelectorAll("#compare-table td.best").length;
  return JSON.stringify({ cols, rows, bestCells, compareBest_high: compareBest([3,7,5],"high"), compareBest_low: compareBest([3,7,5],"low"), compareBest_none: compareBest([3,7,5],"none") });
})();
```
Expected : `cols` = 3 (Métrique + 2 titres), `rows` = 17, `bestCells` ≥ 5 (plusieurs lignes surlignées), `compareBest_high` = 1, `compareBest_low` = 0, `compareBest_none` = -1.

- [ ] **Step 7: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(compare): onglet F9 comparateur — sélection + tableau comparatif (meilleure valeur surlignée)"
```

---

### Task 2: Graphique de performances superposées

**Files:** Modify `terminal-tout-en-un.html` — remplacer le stub `renderCompareChart`.

**Interfaces:**
- Consumes: `compareSel`, `comparePeriod`, `cache`, `CHART_PERIODS`, `COMPARE_COLORS`, `fdateShort`, `Chart` (existant).
- Produces: `renderCompareChart()` (vrai) ; `compareChart`.

- [ ] **Step 1: Replace the stub with the real chart**

Remplacer :
```js
function renderCompareChart() { /* remplacé en Task 2 */ }
```
par :
```js
// Courbes de prix normalisées à 100 au début de la période, superposées.
function renderCompareChart() {
  const canvas = document.getElementById("compare-canvas");
  if (!canvas || typeof Chart === "undefined") return;
  if (compareChart) { compareChart.destroy(); compareChart = null; }
  if (compareSel.length < 2) return;

  const period = CHART_PERIODS.find(p => p.key === comparePeriod) || CHART_PERIODS[4];
  // Labels : le titre avec le plus de points sur la période.
  let labels = [];
  const datasets = compareSel.map((t, i) => {
    const hist = cache[t] && cache[t].hist;
    if (!hist || !Array.isArray(hist.closes)) return null;
    const n = Math.min(period.days, hist.closes.length);
    const closes = hist.closes.slice(0, n).reverse();
    const dates = hist.dates.slice(0, n).reverse();
    if (dates.length > labels.length) labels = dates.map(fdateShort);
    const base = closes.find(c => c != null && isFinite(c) && c > 0) || closes[0];
    const norm = closes.map(c => (c != null && isFinite(c) && base) ? (c / base) * 100 : null);
    return {
      label: t,
      data: norm,
      borderColor: COMPARE_COLORS[i],
      backgroundColor: "transparent",
      borderWidth: 2, pointRadius: 0, tension: 0.15,
    };
  }).filter(Boolean);

  compareChart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: "#d7dde3", font: { family: "'IBM Plex Mono', monospace", size: 11 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fnum(ctx.parsed.y)} (base 100)` } },
      },
      scales: {
        x: { ticks: { color: "#7b8794", maxTicksLimit: 6, font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: "#1a2028" } },
        y: { ticks: { color: "#7b8794", font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: "#1a2028" } },
      },
    },
  });
}
```

- [ ] **Step 2: Verify the chart (console)**

Serveur lancé, page ouverte, AAPL + KO analysés et cochés (comme Task 1). Vérifier :
```js
(function(){
  document.getElementById("tab-compare").click();
  // s'assurer que 2 titres sont cochés
  document.querySelectorAll(".js-compare-chk").forEach(c => { if (["AAPL","KO"].includes(c.value) && !c.checked) { c.checked = true; c.dispatchEvent(new Event("change",{bubbles:true})); } });
  const ds = compareChart ? compareChart.data.datasets.length : 0;
  const firstVals = compareChart ? compareChart.data.datasets.map(d => Math.round(d.data.find(v=>v!=null))) : [];
  return JSON.stringify({ datasets: ds, firstValuesBase100: firstVals });
})();
```
Expected : `datasets` = 2 ; `firstValuesBase100` = [100, 100] (chaque série normalisée démarre à 100).

Puis **manuellement** : changer de période (boutons), vérifier que les courbes se recalculent ; sur mobile, le graphique s'adapte.

- [ ] **Step 3: Commit + déployer**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(compare): graphique de performances normalisées superposées"
git checkout main && git merge feat/comparateur && git push origin main && git branch -d feat/comparateur
```
(Vérifier `py -m unittest discover tests` vert avant push.)

---

## Vérification finale
- [ ] Sélection 2-4 titres (5e désactivé) ; tableau comparatif avec « best » surligné dans le bon sens ; « — » si donnée absente.
- [ ] Graphique : courbes normalisées base 100, légende, changement de période.
- [ ] Non-régression F1–F8 ; responsive ; `py -m unittest discover tests` vert.
- [ ] Déployé sur Render.

## Notes
- Ordre : Task 1 (stub chart) → Task 2 (vrai chart).
- Numéros de ligne indicatifs.
