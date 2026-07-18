# Journal de performance — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Courbe d'évolution de la valeur du portefeuille (positions) dans le temps, en bas de l'onglet F2, avec 1 point/jour enregistré à chaque ouverture.

**Tech Stack:** HTML/CSS/JS vanilla, Chart.js (déjà chargé). Aucune modif serveur.

## Global Constraints
- Pas de build ; français ; `esc()` pour le contenu injecté.
- Persisté par profil ; inclus dans l'export/import existant.
- Tests headless : serveur `PYTHONIOENCODING=utf-8` ; localStorage seedé ; ouvrir `http://localhost:8750/terminal-tout-en-un.html`.

---

### Task 1: État + enregistrement + export/import

**Files:** Modify `terminal-tout-en-un.html` — `LS` (clé) ; état + `recordPerfSnapshot` (près de `refPrice` ~ligne 2568) ; hook init (~ligne 3503) ; export (~ligne 4026) ; import (~ligne 4079).

**Interfaces:**
- Consumes: `positions`, `refPrice`, `lsGet`, `lsSet` (existant).
- Produces: `LS.perfJournal` ; `let perfJournal` ; `recordPerfSnapshot()`.

- [ ] **Step 1: LS key + state + recordPerfSnapshot**

Dans `LS`, après `bot: "term_bot",`, ajouter :
```js
  perfJournal: "term_perf_journal", // historique valeur portefeuille {date,value}, par profil
```
Juste avant `function refPrice(pos) {` (~ligne 2568), ajouter :
```js
let perfJournal = lsGet(LS.perfJournal, []);
if (!Array.isArray(perfJournal)) perfJournal = [];

// Enregistre la valeur du portefeuille du jour (1 point/jour). Rien si aucune position.
function recordPerfSnapshot() {
  if (!Array.isArray(perfJournal)) perfJournal = [];
  if (positions.length === 0) return;
  const value = positions.reduce((s, p) => s + p.qty * refPrice(p), 0);
  if (!isFinite(value) || value <= 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const last = perfJournal[perfJournal.length - 1];
  if (last && last.date === today) {
    if (Math.abs(last.value - value) < 0.005) return;
    last.value = value;
  } else {
    perfJournal.push({ date: today, value });
  }
  if (perfJournal.length > 1500) perfJournal = perfJournal.slice(-1500);
  lsSet(LS.perfJournal, perfJournal);
}
```
(Placer après cette insertion la fonction `refPrice` existante — l'insertion est juste au-dessus d'elle.)

- [ ] **Step 2: Record at init**

Après `loadMarketCache(); // repeuple…` (~ligne 3503), ajouter :
```js
recordPerfSnapshot(); // point de performance du jour (si positions)
```

- [ ] **Step 3: Include perfJournal in export**

Remplacer (~ligne 4026) :
```js
    data: { watchlist, positions, tickerNames, filters, weightTech, alerts },
```
par :
```js
    data: { watchlist, positions, tickerNames, filters, weightTech, alerts, perfJournal },
```

- [ ] **Step 4: Merge perfJournal on import**

Après la ligne `// weightTech et filters : inchangés (préférences du profil courant).` (~ligne 4079), ajouter :
```js
    // Journal de perf : si le profil courant n'en a pas, on récupère l'importé (sinon on garde).
    if ((!Array.isArray(perfJournal) || perfJournal.length === 0) && Array.isArray(d.perfJournal)) {
      perfJournal = d.perfJournal;
      lsSet(LS.perfJournal, perfJournal);
    }
```

- [ ] **Step 5: Verify snapshot logic (console)**

Serveur lancé, page ouverte. En console :
```js
(function(){
  perfJournal = []; positions = [{ id:1, ticker:"AAPL", qty:10, pru:100 }];
  // refPrice → cache[AAPL].ind.price si présent, sinon 100
  recordPerfSnapshot();
  const after1 = JSON.parse(JSON.stringify(perfJournal));
  recordPerfSnapshot(); // même jour → pas de doublon
  const lenAfter2 = perfJournal.length;
  positions = []; recordPerfSnapshot(); // aucune position → rien
  const lenNoPos = perfJournal.length;
  return JSON.stringify({ after1, lenAfter2, lenNoPos, persisted: !!localStorage.getItem("term_perf_journal::Test") });
})();
```
Expected : `after1` = 1 point `{date: <aujourd'hui>, value: 10×cours}` ; `lenAfter2` = 1 (pas de doublon) ; `lenNoPos` = 1 (inchangé, aucune position n'ajoute rien) ; `persisted` true.

- [ ] **Step 6: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(journal): enregistrement de la valeur du portefeuille (1 point/jour) + export/import"
```

---

### Task 2: UI (section F2 + courbe + stats)

**Files:** Modify `terminal-tout-en-un.html` — HTML dans `panel-positions` (~ligne 855) ; `renderPerfJournal` + hook dans `renderPositions` + bouton effacer ; CSS.

**Interfaces:**
- Consumes: `perfJournal`, `recordPerfSnapshot`, `lsSet`, `LS`, `fnum`, `fpct`, `fdateShort`, `Chart` (existant + Task 1).
- Produces: `renderPerfJournal()` ; `let perfChart`.

- [ ] **Step 1: Add the HTML section**

Repérer la fin de l'onglet Positions :
```html
          <p class="hint" id="chart-hint">Le cours utilisé est le dernier cours en cache (onglet Dashboard → Analyser). À défaut, le PRU est utilisé.</p>
        </div>
      </div>
    </section>
```
Insérer la carte journal **entre** `</div>` (fin du `.positions-layout`) et `</section>` :
```html
          <p class="hint" id="chart-hint">Le cours utilisé est le dernier cours en cache (onglet Dashboard → Analyser). À défaut, le PRU est utilisé.</p>
        </div>
      </div>

      <div class="chart-card">
        <div class="perf-head">
          <h2>Évolution du portefeuille</h2>
          <button class="btn btn-small btn-ghost" id="btn-perf-clear">Effacer l'historique</button>
        </div>
        <div id="perf-stats" class="impact-grid"></div>
        <div class="chart-holder"><canvas id="perf-canvas"></canvas></div>
        <p class="hint">Un point est enregistré par jour d'ouverture de l'app, tant que vous avez au moins une position.</p>
      </div>
    </section>
```

- [ ] **Step 2: Add renderPerfJournal + wiring**

Après `function renderPositions() { … }` (repérer sa fin) ou près des autres rendus, ajouter :
```js
let perfChart = null;

function renderPerfJournal() {
  const statsEl = document.getElementById("perf-stats");
  const canvas = document.getElementById("perf-canvas");
  if (!statsEl) return;

  if (perfChart) { perfChart.destroy(); perfChart = null; }

  if (!perfJournal.length) {
    statsEl.innerHTML = `<p class="analysis-empty">Aucun historique pour l'instant. Ajoutez des positions : la courbe se construira à chaque ouverture (1 point/jour).</p>`;
    return;
  }

  const first = perfJournal[0].value, cur = perfJournal[perfJournal.length - 1].value;
  const chg = cur - first, chgPct = first > 0 ? (chg / first) * 100 : 0;
  const vals = perfJournal.map(p => p.value);
  const hi = Math.max(...vals), lo = Math.min(...vals);
  statsEl.innerHTML = `
    <div><dt>Valeur actuelle</dt><dd>${fnum(cur)} €</dd></div>
    <div><dt>Depuis le début</dt><dd class="${pctClass(chg)}">${fnum(chg)} € (${fpct(chgPct)})</dd></div>
    <div><dt>Plus haut</dt><dd>${fnum(hi)} €</dd></div>
    <div><dt>Plus bas</dt><dd>${fnum(lo)} €</dd></div>`;

  if (perfJournal.length < 2 || typeof Chart === "undefined") return;
  perfChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: perfJournal.map(p => fdateShort(p.date)),
      datasets: [{ data: vals, borderColor: "#ffb000", backgroundColor: "rgba(255,176,0,0.08)", borderWidth: 2, pointRadius: 0, tension: 0.15, fill: true }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fnum(ctx.parsed.y) + " €" } } },
      scales: {
        x: { ticks: { color: "#7b8794", maxTicksLimit: 6, font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: "#1a2028" } },
        y: { ticks: { color: "#7b8794", font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: "#1a2028" } },
      },
    },
  });
}

document.getElementById("btn-perf-clear").addEventListener("click", () => {
  if (!window.confirm("Effacer l'historique de performance du portefeuille ?")) return;
  perfJournal = []; lsSet(LS.perfJournal, perfJournal); renderPerfJournal();
});
```

- [ ] **Step 3: Hook into renderPositions**

Repérer la fin de `renderPositions()` (juste avant son `}` final, après le rendu du total/allocation). Ajouter en dernière ligne de la fonction :
```js
  recordPerfSnapshot();
  renderPerfJournal();
```
(Chercher la dernière instruction de `renderPositions` — par ex. l'appel qui met à jour le total ou `renderAllocationChart()` — et insérer ces deux lignes juste avant la `}` de fermeture de la fonction.)

- [ ] **Step 4: CSS**

Près de `.filter-panel` :
```css
.perf-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
#perf-stats { margin: 8px 0 12px; }
#perf-stats dd { font-size: 16px; }
```

- [ ] **Step 5: Verify UI (console)**

Serveur lancé, page ouverte. En console :
```js
(function(){
  // journal fictif multi-points
  perfJournal = [
    { date:"2026-07-10", value:1000 },
    { date:"2026-07-11", value:1050 },
    { date:"2026-07-12", value:1030 },
  ];
  lsSet(LS.perfJournal, perfJournal);
  document.getElementById("tab-positions").click();
  renderPerfJournal();
  const statsCount = document.querySelectorAll("#perf-stats div").length;
  const chartPts = perfChart ? perfChart.data.datasets[0].data.length : 0;
  const statsText = document.querySelector("#perf-stats dd") ? document.querySelector("#perf-stats dd").textContent : null;
  return JSON.stringify({ statsCount, chartPts, valeurActuelle: statsText });
})();
```
Expected : `statsCount` = 4 (valeur, variation, haut, bas) ; `chartPts` = 3 ; `valeurActuelle` ≈ « 1 030,00 € ».

Puis **manuellement** : le bouton « Effacer l'historique » vide la courbe ; sur mobile le graphique s'adapte.

- [ ] **Step 6: Commit + déployer**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(journal): courbe d'évolution du portefeuille + stats dans l'onglet Positions"
git checkout main && git merge feat/journal-perf && git push origin main && git branch -d feat/journal-perf
```
(Vérifier `py -m unittest discover tests` vert avant push.)

---

## Vérification finale
- [ ] Snapshot : 1 point/jour, pas de doublon, rien sans position ; persisté ; dans l'export.
- [ ] Courbe + stats affichées dans F2 ; bouton Effacer ; responsive.
- [ ] Non-régression F1–F9 ; `py -m unittest discover tests` vert.
- [ ] Déployé sur Render.

## Notes
- Ordre : Task 1 → Task 2. `renderPerfJournal` défini en Task 2 ; l'init de Task 1 n'appelle que `recordPerfSnapshot`.
- Numéros de ligne indicatifs.
