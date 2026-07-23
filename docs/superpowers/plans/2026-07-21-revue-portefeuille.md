# Revue de portefeuille — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter à l'onglet F2 Positions une revue d'aide à la décision : verdict par ligne, stop-loss, alternative sectorielle, bilan global et suggestions d'achat — le tout sur des règles transparentes.

**Architecture:** Fonctions **pures** (`reviewVerdict`, `reviewStops`, `reviewSectorAlt`, `reviewPortfolio`, `reviewAdditions`) testées par un `reviewSelfTest()` en console. Le secteur vient d'un champ backend ajouté à `/api/fundamentals`. L'UI enrichit F2 sans nouvel onglet.

**Tech Stack:** HTML/CSS/JS vanilla, fichier unique `terminal-tout-en-un.html` ; `server.py` (stdlib) ; tests serveur `unittest`.

## Global Constraints

- **Aide à la décision, pas un conseil.** Chaque verdict = règle transparente. Avertissement permanent affiché : « Analyse descriptive fondée sur des règles, pas un conseil en investissement. Les décisions et tout engagement réel relèvent de vous ; pour un conseil personnalisé, consultez un professionnel agréé. »
- Pas de build, fichier unique, français, `esc()` sur tout contenu injecté, virgule décimale.
- Tests JS : fonctions pures dans `reviewSelfTest()` (réutilise `botTest`/`botAssert`/`botAssertEq`/`botAssertClose` déjà définis). Tests serveur : `py -m unittest discover tests`.
- Réutiliser l'existant : `computeGlobalScore(entry)`, `positionValueBase(pos)` → `{value, ok}`, `refPrice(pos)`, `clamp(x,a,b)`, `esc`, `fnum`, `fpct`, `pctClass`, `analyzeTicker`, `cache`, `marketCache`, `marketCandidates`, `positions`, `watchlist`.
- Lancement local : `C:\Users\amagu\AppData\Local\Programs\Python\Python311\python.exe -X utf8 server.py`, ouvrir `http://localhost:8750/terminal-tout-en-un.html?v=N` (le `?v=N` contourne le cache navigateur). Sur Render les fondamentaux dépendent du crumb Yahoo (voir mémoire projet).

---

### Task 1 : Backend — secteur et industrie

**Files:**
- Modify: `server.py` — `FUND_URL` (~ligne 52) et `_normalize_fundamentals` (~ligne 247).
- Test: `tests/test_fundamentals.py`.

**Interfaces:**
- Produces: champs `sector` (str|None) et `industry` (str|None) dans la réponse `/api/fundamentals`.

- [ ] **Step 1 : Test qui échoue**

Dans `tests/test_fundamentals.py`, ajouter `assetProfile` à `_sample_node` (dans le `return {...}`) :
```python
            "assetProfile": {
                "sector": "Technology",
                "industry": "Consumer Electronics",
            },
```
Puis une méthode de test :
```python
    def test_extracts_sector(self):
        out = server._normalize_fundamentals("AAPL", self._sample_node())
        self.assertEqual(out["sector"], "Technology")
        self.assertEqual(out["industry"], "Consumer Electronics")

    def test_sector_absent_returns_none(self):
        node = self._sample_node()
        del node["assetProfile"]
        out = server._normalize_fundamentals("AAPL", node)
        self.assertIsNone(out["sector"])
        self.assertIsNone(out["industry"])
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `C:\Users\amagu\AppData\Local\Programs\Python\Python311\python.exe -X utf8 -m unittest discover tests`
Attendu : FAIL — `KeyError: 'sector'`.

- [ ] **Step 3 : Ajouter le module à l'URL**

Remplacer `FUND_URL` :
```python
FUND_URL = ("https://query1.finance.yahoo.com/v10/finance/quoteSummary/{sym}"
            "?modules=summaryDetail,financialData,defaultKeyStatistics,price,incomeStatementHistory,assetProfile"
            "&crumb={crumb}")
```

- [ ] **Step 4 : Extraire secteur et industrie**

Dans `_normalize_fundamentals`, après la ligne `price = node.get("price") or {}`, ajouter :
```python
    profile = node.get("assetProfile") or {}
```
Puis, dans le `return {...}`, juste avant `"netIncomeHistory": _net_income_history(node),` :
```python
        "sector": profile.get("sector") if isinstance(profile.get("sector"), str) else None,
        "industry": profile.get("industry") if isinstance(profile.get("industry"), str) else None,
```

- [ ] **Step 5 : Vérifier le succès**

Run: `C:\Users\amagu\AppData\Local\Programs\Python\Python311\python.exe -X utf8 -m unittest discover tests`
Attendu : `OK`.

- [ ] **Step 6 : Commit**

```bash
git add server.py tests/test_fundamentals.py
git commit -m "feat(revue): secteur et industrie depuis assetProfile (même requête)"
```

---

### Task 2 : Stops + scaffold `reviewSelfTest`

**Files:**
- Modify: `terminal-tout-en-un.html` — nouvelle section « REVUE DE PORTEFEUILLE » à insérer **juste après** la section SCORE FONDAMENTAL, avant `/* ===== FETCH FONDAMENTAUX ===== */` (~ligne 3363, repère : `function fetchFundamentals`).

**Interfaces:**
- Consumes: `clamp`, `computeGlobalScore`, `botTest`/`botAssert*`.
- Produces:
  - `reviewStopPct(vol) → number` (5..20)
  - `reviewHighest(entry) → number|null`
  - `reviewGlobal(entry) → number|null`
  - `reviewStops(pos, entry) → { stopPct, initialLevel, trailLevel, highest, initialVsPru, trailVsPru }`
  - `reviewSelfTest() → { pass, fail, total, report }` + `reviewTest(name, fn)`.

- [ ] **Step 1 : Insérer scaffold + fonctions**

Insérer avant `/* ============================= FETCH FONDAMENTAUX ============================= */` :
```js
/* ============================= REVUE DE PORTEFEUILLE =============================
 * Aide à la décision fondée sur des règles transparentes — pas un conseil. Fonctions
 * pures testées par reviewSelfTest() (réutilise le harnais botTest/botAssert*).
 * ============================================================================ */

const REVIEW_TEST_CASES = [];
function reviewTest(name, fn) { REVIEW_TEST_CASES.push({ name, fn }); }

function reviewSelfTest() {
  let pass = 0, fail = 0;
  const report = [];
  for (const { name, fn } of REVIEW_TEST_CASES) {
    try { fn(); pass++; report.push({ name, ok: true }); }
    catch (e) { fail++; report.push({ name, ok: false, err: String((e && e.message) || e) }); }
  }
  const total = REVIEW_TEST_CASES.length;
  console.log(`[reviewSelfTest] ${pass}/${total} passed, ${fail} failed`);
  for (const r of report) console.log(r.ok ? `  ✓ ${r.name}` : `  ✗ ${r.name} — ${r.err}`);
  return { pass, fail, total, report };
}

// Score global d'une entrée (technique + fondamental), ou null si jamais analysée.
function reviewGlobal(entry) {
  if (!entry || entry.score == null) return null;
  return computeGlobalScore(entry);
}

// Distance de stop (%) adaptée à la volatilité — même logique que le bot, bornée 5–20.
function reviewStopPct(vol) { return clamp(0.40 * (isFinite(vol) ? vol : 30), 5, 20); }

// Plus haut exploitable : max des clôtures en cache et du cours courant. null si rien.
function reviewHighest(entry) {
  const price = (entry && entry.ind && isFinite(entry.ind.price)) ? entry.ind.price : null;
  const closes = (entry && entry.hist && Array.isArray(entry.hist.closes))
    ? entry.hist.closes.filter(c => isFinite(c) && c > 0) : [];
  if (!closes.length) return price;
  return Math.max(Math.max(...closes), price || 0);
}

// Stops initial (sous le cours) et suiveur (sous le plus haut), + effet vs PRU en %.
function reviewStops(pos, entry) {
  const price = entry.ind.price;
  const stopPct = reviewStopPct(entry.ind.vol);
  const initialLevel = price * (1 - stopPct / 100);
  const highest = reviewHighest(entry);
  const trailLevel = (highest || price) * (1 - 0.8 * stopPct / 100);
  const vsPru = (lvl) => (pos.pru > 0 && isFinite(lvl)) ? (lvl / pos.pru - 1) * 100 : null;
  return { stopPct, initialLevel, trailLevel, highest, initialVsPru: vsPru(initialLevel), trailVsPru: vsPru(trailLevel) };
}

/* ---------- tests : stops ---------- */

function reviewMkEntry(over = {}) {
  return {
    ticker: over.ticker || "TEST",
    score: over.score != null ? over.score : 70,
    signal: over.signal || "Neutre",
    fund: over.fund || null,
    fundScore: over.fundScore || null,
    hist: over.hist || null,
    ind: { price: 100, vol: 30, rsi: 50, rangePos: 50, perf: { m1: 0, m3: 0, y1: 0 }, ...(over.ind || {}) },
  };
}
function reviewMkPos(over = {}) { return { id: 1, ticker: "TEST", qty: 10, pru: 90, ...over }; }

reviewTest("reviewStopPct: borné 5–20", () => {
  botAssertEq(reviewStopPct(5), 5);
  botAssertEq(reviewStopPct(80), 20);
  botAssertClose(reviewStopPct(30), 12, 1e-9);
});

reviewTest("reviewHighest: max clôtures + cours, null si rien", () => {
  botAssertEq(reviewHighest(reviewMkEntry({ ind: { price: 100 }, hist: { closes: [90, 120, 80] } })), 120);
  botAssertEq(reviewHighest(reviewMkEntry({ ind: { price: 150 }, hist: { closes: [90, 120] } })), 150);
  botAssertEq(reviewHighest(reviewMkEntry({ ind: { price: 100 } })), 100);
});

reviewTest("reviewStops: initial sous le cours, effet vs PRU", () => {
  const s = reviewStops(reviewMkPos({ pru: 90 }), reviewMkEntry({ ind: { price: 100, vol: 30 } }));
  botAssertClose(s.stopPct, 12, 1e-9);
  botAssertClose(s.initialLevel, 88, 1e-9);            // 100 × (1 − 12 %)
  botAssert(s.initialVsPru < 0, "88 < PRU 90 → limite une perte");
});

reviewTest("reviewStops: stop sécurisant un gain quand le cours a monté", () => {
  const s = reviewStops(reviewMkPos({ pru: 50 }), reviewMkEntry({ ind: { price: 100, vol: 10 } }));
  botAssert(s.initialVsPru > 0, "stop au-dessus du PRU → sécurise un gain");
});
```

- [ ] **Step 2 : Vérifier**

Lancer le serveur, ouvrir `http://localhost:8750/terminal-tout-en-un.html?v=1`, console → `reviewSelfTest()`.
Attendu : `4/4 passed`. Vérifier aussi `botSelfTest()` et `fundSelfTest()` inchangés (53 et 14).

- [ ] **Step 3 : Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(revue): stops par titre (initial + suiveur) et reviewSelfTest"
```

---

### Task 3 : Verdict multi-facteurs

**Files:**
- Modify: `terminal-tout-en-un.html` — à la fin de la section REVUE (après les tests stops).

**Interfaces:**
- Consumes: `reviewGlobal`, `fpct`, `reviewMkEntry`, `reviewMkPos`.
- Produces: `reviewVerdict(pos, entry) → { verdict: "vendre"|"alleger"|"garder", conviction: "faible"|"moyenne"|"forte", reasons: string[] }`.

- [ ] **Step 1 : Implémentation**

Ajouter :
```js
// Verdict d'une ligne à partir de règles lisibles. La « cassure de stop » n'existe pas pour
// une ligne détenue (le stop est sous le cours) : on lit à la place une chute déjà subie (m1).
function reviewVerdict(pos, entry) {
  const ind = entry.ind || {};
  const g = reviewGlobal(entry);
  const price = ind.price;
  const pnlPct = (price > 0 && pos.pru > 0) ? (price / pos.pru - 1) * 100 : null;
  const m1 = ind.perf ? ind.perf.m1 : null;

  const sell = [], trim = [];
  if (g != null && g <= 35) sell.push(`score global effondré (${g}/100)`);
  if (entry.signal === "Vente") sell.push("signal technique à la vente");
  if (g != null && g < 50 && m1 != null && m1 < -10) sell.push(`score faible et forte baisse récente (${fpct(m1)})`);

  if (ind.rangePos != null && ind.rangePos > 90) trim.push("au sommet de son range 52 semaines");
  if (ind.rsi != null && ind.rsi > 70) trim.push(`suracheté (RSI ${Math.round(ind.rsi)})`);
  if (pnlPct != null && pnlPct > 40 && g != null && g < 60) trim.push(`forte plus-value (${fpct(pnlPct)}) sur un titre qui faiblit — sécuriser`);
  if (g != null && g >= 35 && g < 50) trim.push(`signaux mitigés (${g}/100)`);

  let verdict, reasons;
  if (sell.length)      { verdict = "vendre";  reasons = sell; }
  else if (trim.length) { verdict = "alleger"; reasons = trim; }
  else {
    verdict = "garder";
    reasons = [(g != null && g >= 60) ? `fondamentaux/technique solides (${g}/100)` : `rien d'alarmant (${g == null ? "non analysé" : g + "/100"})`];
  }

  let conviction;
  if ((g != null && (g <= 25 || g >= 75)) || reasons.length >= 2) conviction = "forte";
  else if (g != null && g >= 45 && g <= 55) conviction = "faible";
  else conviction = "moyenne";

  return { verdict, conviction, reasons };
}

/* ---------- tests : verdict ---------- */

reviewTest("reviewVerdict: score ≤ 35 → vendre", () => {
  const v = reviewVerdict(reviewMkPos(), reviewMkEntry({ score: 20 }));
  botAssertEq(v.verdict, "vendre");
  botAssertEq(v.conviction, "forte");        // g ≤ 25
  botAssert(v.reasons.length >= 1);
});

reviewTest("reviewVerdict: signal Vente → vendre", () => {
  botAssertEq(reviewVerdict(reviewMkPos(), reviewMkEntry({ score: 55, signal: "Vente" })).verdict, "vendre");
});

reviewTest("reviewVerdict: haut de range → alléger", () => {
  botAssertEq(reviewVerdict(reviewMkPos(), reviewMkEntry({ score: 60, ind: { price: 100, rangePos: 95 } })).verdict, "alleger");
});

reviewTest("reviewVerdict: forte plus-value + score faible → alléger", () => {
  // cours 100, PRU 60 → +67 % ; score 55 < 60
  botAssertEq(reviewVerdict(reviewMkPos({ pru: 60 }), reviewMkEntry({ score: 55, ind: { price: 100 } })).verdict, "alleger");
});

reviewTest("reviewVerdict: score ≥ 60 solide → garder", () => {
  const v = reviewVerdict(reviewMkPos(), reviewMkEntry({ score: 72 }));
  botAssertEq(v.verdict, "garder");
});

// Score 50 : la règle « signaux mitigés » couvre 35 ≤ g < 50, donc 50 n'y tombe pas → aucune
// raison sell/trim → « garder », conviction faible (45 ≤ 50 ≤ 55).
reviewTest("reviewVerdict: zone grise (50) → garder, conviction faible", () => {
  const v = reviewVerdict(reviewMkPos(), reviewMkEntry({ score: 50, ind: { price: 100, rangePos: 50, rsi: 50 } }));
  botAssertEq(v.verdict, "garder");
  botAssertEq(v.conviction, "faible");
});

reviewTest("reviewVerdict: non analysé → garder sans crash", () => {
  const v = reviewVerdict(reviewMkPos(), reviewMkEntry({ score: null }));
  botAssert(v.verdict === "garder" && v.reasons.length === 1);
});
```

- [ ] **Step 2 : Vérifier**

Recharger `?v=2`, console → `reviewSelfTest()`. Attendu : `11/11 passed`.

- [ ] **Step 3 : Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(revue): verdict multi-facteurs (garder/alléger/vendre + conviction)"
```

---

### Task 4 : Alternative sectorielle

**Files:**
- Modify: `terminal-tout-en-un.html` — après les tests verdict.

**Interfaces:**
- Consumes: `reviewGlobal`, `reviewMkEntry`.
- Produces: `reviewSectorAlt(entry, universe) → { ticker, sector, scoreThem, scoreYou } | null`. `entry` et chaque élément de `universe` portent un champ `.ticker` et éventuellement `.fund.sector`.

- [ ] **Step 1 : Implémentation**

```js
// Meilleur titre du même secteur dans `universe`, si son score dépasse d'au moins 8 points.
function reviewSectorAlt(entry, universe) {
  const sector = entry.fund && entry.fund.sector;
  if (!sector) return null;
  const you = reviewGlobal(entry);
  if (you == null) return null;
  let best = null;
  for (const c of universe) {
    if (!c || c.ticker === entry.ticker) continue;
    if (!c.fund || c.fund.sector !== sector) continue;
    const s = reviewGlobal(c);
    if (s == null || s < you + 8) continue;
    if (!best || s > best.scoreThem) best = { ticker: c.ticker, sector, scoreThem: s, scoreYou: you };
  }
  return best;
}

/* ---------- tests : alternative sectorielle ---------- */

reviewTest("reviewSectorAlt: trouve un meilleur titre du même secteur", () => {
  const you = reviewMkEntry({ ticker: "MC.PA", score: 55, fund: { sector: "Consumer Cyclical" } });
  const uni = [
    reviewMkEntry({ ticker: "RMS.PA", score: 78, fund: { sector: "Consumer Cyclical" } }),
    reviewMkEntry({ ticker: "AAPL",   score: 90, fund: { sector: "Technology" } }),
  ];
  const alt = reviewSectorAlt(you, uni);
  botAssertEq(alt.ticker, "RMS.PA");
  botAssertEq(alt.scoreThem, 78);
  botAssertEq(alt.scoreYou, 55);
});

reviewTest("reviewSectorAlt: écart < 8 → aucune alternative", () => {
  const you = reviewMkEntry({ ticker: "MC.PA", score: 72, fund: { sector: "Consumer Cyclical" } });
  const uni = [reviewMkEntry({ ticker: "RMS.PA", score: 76, fund: { sector: "Consumer Cyclical" } })];
  botAssertEq(reviewSectorAlt(you, uni), null);
});

reviewTest("reviewSectorAlt: secteur inconnu → null", () => {
  const you = reviewMkEntry({ ticker: "X", score: 40, fund: null });
  botAssertEq(reviewSectorAlt(you, [reviewMkEntry({ ticker: "Y", score: 90, fund: { sector: "Technology" } })]), null);
});

reviewTest("reviewSectorAlt: ignore soi-même et les autres secteurs", () => {
  const you = reviewMkEntry({ ticker: "MC.PA", score: 55, fund: { sector: "Consumer Cyclical" } });
  const uni = [
    reviewMkEntry({ ticker: "MC.PA", score: 99, fund: { sector: "Consumer Cyclical" } }), // soi-même
    reviewMkEntry({ ticker: "TTE.PA", score: 99, fund: { sector: "Energy" } }),           // autre secteur
  ];
  botAssertEq(reviewSectorAlt(you, uni), null);
});
```

- [ ] **Step 2 : Vérifier**

Recharger `?v=3`, console → `reviewSelfTest()`. Attendu : `15/15 passed`.

- [ ] **Step 3 : Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(revue): alternative sectorielle (meilleur titre du même secteur)"
```

---

### Task 5 : Bilan du portefeuille

**Files:**
- Modify: `terminal-tout-en-un.html` — après les tests alternative.

**Interfaces:**
- Consumes: `reviewVerdict`, `reviewGlobal`.
- Produces: `reviewPortfolio(positions, entryOf, valueOf) → { total, bySector, alerts, health, counts, priorities }`.
  - `entryOf(pos) → entry|null` ; `valueOf(pos) → { value, ok }`.
  - `priorities` : `[{ ticker, verdict, reason, score, weight }]` trié urgence décroissante.

- [ ] **Step 1 : Implémentation**

```js
// Synthèse du portefeuille. entryOf/valueOf injectés pour rester pur et testable.
function reviewPortfolio(positions, entryOf, valueOf) {
  let total = 0, healthNum = 0, healthDen = 0;
  const bySector = {};
  const counts = { garder: 0, alleger: 0, vendre: 0 };
  const priorities = [];

  for (const pos of positions) {
    const entry = entryOf(pos);
    const v = valueOf(pos);
    const val = (v && v.ok && isFinite(v.value)) ? v.value : 0;
    total += val;
    const sector = (entry && entry.fund && entry.fund.sector) || "Secteur inconnu";
    bySector[sector] = (bySector[sector] || 0) + val;

    if (entry && entry.ind) {
      const vd = reviewVerdict(pos, entry);
      counts[vd.verdict]++;
      const g = reviewGlobal(entry);
      if (g != null) { healthNum += g * val; healthDen += val; }
      priorities.push({ ticker: pos.ticker, verdict: vd.verdict, reason: vd.reasons[0], score: g,
        weight: vd.verdict === "vendre" ? 2 : vd.verdict === "alleger" ? 1 : 0 });
    } else {
      priorities.push({ ticker: pos.ticker, verdict: null, reason: "non analysé", score: null, weight: -1 });
    }
  }

  const alerts = [];
  for (const pos of positions) {
    const v = valueOf(pos);
    const val = (v && v.ok && isFinite(v.value)) ? v.value : 0;
    if (total > 0 && val / total > 0.40) alerts.push(`${pos.ticker} pèse ${Math.round(val / total * 100)} % du portefeuille`);
  }
  for (const [sec, val] of Object.entries(bySector)) {
    if (sec !== "Secteur inconnu" && total > 0 && val / total > 0.40) alerts.push(`${Math.round(val / total * 100)} % en ${sec}`);
  }

  priorities.sort((a, b) => (b.weight - a.weight) || ((a.score == null ? 999 : a.score) - (b.score == null ? 999 : b.score)));
  const health = healthDen > 0 ? Math.round(healthNum / healthDen) : null;
  return { total, bySector, alerts, health, counts, priorities };
}

/* ---------- tests : bilan ---------- */

reviewTest("reviewPortfolio: répartition secteur et santé pondérée par la valeur", () => {
  const positions = [reviewMkPos({ ticker: "A" }), reviewMkPos({ ticker: "B" })];
  const entries = {
    A: reviewMkEntry({ ticker: "A", score: 80, fund: { sector: "Tech" } }),
    B: reviewMkEntry({ ticker: "B", score: 40, fund: { sector: "Energy" } }),
  };
  const val = { A: 900, B: 100 };
  const r = reviewPortfolio(positions, p => entries[p.ticker], p => ({ value: val[p.ticker], ok: true }));
  botAssertEq(r.total, 1000);
  botAssertEq(r.bySector.Tech, 900);
  // santé pondérée : (80×900 + 40×100)/1000 = 76, pas la moyenne simple 60
  botAssertEq(r.health, 76);
});

reviewTest("reviewPortfolio: alerte concentration > 40 %", () => {
  const positions = [reviewMkPos({ ticker: "A" }), reviewMkPos({ ticker: "B" })];
  const entries = { A: reviewMkEntry({ ticker: "A", score: 70 }), B: reviewMkEntry({ ticker: "B", score: 70 }) };
  const val = { A: 800, B: 200 };
  const r = reviewPortfolio(positions, p => entries[p.ticker], p => ({ value: val[p.ticker], ok: true }));
  botAssert(r.alerts.some(a => a.includes("A") && a.includes("80")), "A pèse 80 %");
});

reviewTest("reviewPortfolio: priorités classent vendre avant garder", () => {
  const positions = [reviewMkPos({ ticker: "KEEP" }), reviewMkPos({ ticker: "SELL" })];
  const entries = {
    KEEP: reviewMkEntry({ ticker: "KEEP", score: 75 }),
    SELL: reviewMkEntry({ ticker: "SELL", score: 20 }),
  };
  const r = reviewPortfolio(positions, p => entries[p.ticker], p => ({ value: 500, ok: true }));
  botAssertEq(r.priorities[0].ticker, "SELL");
  botAssertEq(r.counts.vendre, 1);
  botAssertEq(r.counts.garder, 1);
});

reviewTest("reviewPortfolio: position non analysée → santé neutre, sans crash", () => {
  const r = reviewPortfolio([reviewMkPos({ ticker: "A" })], () => null, () => ({ value: 100, ok: true }));
  botAssertEq(r.health, null);
  botAssertEq(r.bySector["Secteur inconnu"], 100);
});

reviewTest("reviewPortfolio: portefeuille vide → bilan neutre", () => {
  const r = reviewPortfolio([], () => null, () => ({ value: 0, ok: true }));
  botAssertEq(r.total, 0);
  botAssertEq(r.health, null);
  botAssertEq(r.alerts.length, 0);
});
```

- [ ] **Step 2 : Vérifier**

Recharger `?v=4`, console → `reviewSelfTest()`. Attendu : `20/20 passed`.

- [ ] **Step 3 : Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(revue): bilan (secteurs, concentration, santé pondérée, priorités)"
```

---

### Task 6 : Suggestions d'ajout

**Files:**
- Modify: `terminal-tout-en-un.html` — après les tests bilan.

**Interfaces:**
- Consumes: `reviewGlobal`.
- Produces: `reviewAdditions(positions, marketEntries, bySector, total, n=5) → [{ ticker, sector, score }]`.
  - `marketEntries` : entrées du scan (avec `.ticker`) ; `bySector`/`total` : sortie de `reviewPortfolio`.

- [ ] **Step 1 : Implémentation**

```js
// Meilleures opportunités du scan non détenues, avec bonus aux secteurs peu exposés (< 10 %).
function reviewAdditions(positions, marketEntries, bySector, total, n = 5) {
  const held = new Set(positions.map(p => p.ticker));
  const share = (sec) => (total > 0 && bySector[sec]) ? bySector[sec] / total : 0;
  return marketEntries
    .filter(e => e && e.ticker && !held.has(e.ticker))
    .map(e => ({ e, g: reviewGlobal(e) }))
    .filter(x => x.g != null && x.g >= 65)
    .map(x => {
      const sector = (x.e.fund && x.e.fund.sector) || "Secteur inconnu";
      return { ticker: x.e.ticker, sector, score: x.g, sortKey: x.g + (share(sector) < 0.10 ? 10 : 0) };
    })
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, n)
    .map(({ ticker, sector, score }) => ({ ticker, sector, score }));
}

/* ---------- tests : suggestions ---------- */

reviewTest("reviewAdditions: exclut les titres détenus et sous le seuil 65", () => {
  const positions = [reviewMkPos({ ticker: "HELD" })];
  const market = [
    reviewMkEntry({ ticker: "HELD", score: 90 }),   // détenu → exclu
    reviewMkEntry({ ticker: "LOW",  score: 50 }),   // < 65 → exclu
    reviewMkEntry({ ticker: "GOOD", score: 80 }),
  ];
  const out = reviewAdditions(positions, market, {}, 0);
  botAssertEq(out.length, 1);
  botAssertEq(out[0].ticker, "GOOD");
});

reviewTest("reviewAdditions: bonus au secteur sous-exposé", () => {
  const market = [
    reviewMkEntry({ ticker: "TECHONLY", score: 82, fund: { sector: "Tech" } }),     // secteur déjà à 90 %
    reviewMkEntry({ ticker: "NEWSEC",   score: 74, fund: { sector: "Health" } }),   // secteur à 0 %
  ];
  const bySector = { Tech: 900 }, total = 1000;
  const out = reviewAdditions([], market, bySector, total);
  botAssertEq(out[0].ticker, "NEWSEC");   // 74 + 10 (sous-exposé) = 84 > 82
});
```

- [ ] **Step 2 : Vérifier**

Recharger `?v=5`, console → `reviewSelfTest()`. Attendu : `22/22 passed`.

- [ ] **Step 3 : Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(revue): suggestions d'ajout depuis le scan (bonus secteurs sous-exposés)"
```

---

### Task 7 : UI F2 + câblage + vérification + déploiement

**Files:**
- Modify: `terminal-tout-en-un.html` — markup `#panel-positions` (~ligne 895, avant `.positions-layout`), en-tête du tableau (~ligne 900), `renderPositions()` (~ligne 4001), styles (près de `.fund-metrics`), et le gestionnaire d'événements de `#panel-positions`.

**Interfaces:**
- Consumes: toutes les fonctions des tâches 2–6, `analyzeTicker`, `positionValueBase`, `esc`, `fnum`, `fpct`, `pctClass`, `cache`, `marketCache`, `positions`, `watchlist`, `addTickerToWatchlist`.
- Produces: bloc Revue rendu + colonnes Verdict/Stop + détail dépliable par ligne.

- [ ] **Step 1 : Ajouter le bloc Revue dans le markup**

Juste après la fermeture de `</div>` du `.panel-head` de `#panel-positions` (avant `<div class="positions-layout">`), insérer :
```html
      <details class="review-block bot-settings">
        <summary>Revue du portefeuille — aide à la décision</summary>
        <div class="review-actions">
          <button class="btn btn-accent" id="btn-review-run">Analyser mon portefeuille</button>
          <button class="btn btn-ghost" id="btn-review-expand" title="Charger des titres du secteur de mes positions pour enrichir les alternatives">Élargir la recherche sectorielle</button>
        </div>
        <div id="review-summary"></div>
        <p class="fund-caveat" id="review-caveat">Analyse descriptive fondée sur des règles, pas un conseil en investissement. Les décisions et tout engagement réel relèvent de vous ; pour un conseil personnalisé, consultez un professionnel agréé.</p>
      </details>
```

- [ ] **Step 2 : Ajouter deux colonnes à l'en-tête du tableau**

Dans `#positions-table` `<thead>`, remplacer la ligne d'en-tête par (ajout de Verdict et Stop avant Actions) :
```html
              <tr>
                <th>Ticker</th>
                <th class="num">Qté</th>
                <th class="num">PRU</th>
                <th class="num">Cours</th>
                <th class="num">Valeur</th>
                <th class="num">P&amp;L</th>
                <th class="num">P&amp;L %</th>
                <th>Verdict</th>
                <th class="num">Stop</th>
                <th class="actions-col">Actions</th>
              </tr>
```

- [ ] **Step 3 : Styles**

Après le bloc `.fund-dot` (repère `.fund-dot.none`), ajouter :
```css
.review-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 12px; }
.verdict-dot { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; }
.verdict-dot.vendre  { background: rgba(255,77,77,0.15);  color: var(--red); }
.verdict-dot.alleger { background: rgba(255,176,0,0.15);  color: var(--amber); }
.verdict-dot.garder  { background: rgba(46,204,113,0.15); color: var(--green); }
.verdict-conv { color: var(--text-dim); font-size: 10px; display: block; }
.review-detail td { background: var(--bg-raised); font-size: 12px; }
.review-detail ul { margin: 4px 0 4px 18px; }
.review-alt { color: var(--amber); }
.review-alert { color: var(--red); font-size: 12px; }
```

- [ ] **Step 4 : Rendre le bloc Revue**

Ajouter, juste avant `function renderPositions() {` :
```js
let reviewData = null; // { portfolio, additions } — calculé par « Analyser mon portefeuille »

// Univers de comparaison sectorielle : cache + scan marché, dédupliqués, avec .ticker.
function reviewUniverse() {
  const seen = new Map();
  for (const [t, e] of Object.entries(cache))       if (e) seen.set(t, { ...e, ticker: t });
  for (const [t, e] of Object.entries(marketCache)) if (e && !seen.has(t)) seen.set(t, { ...e, ticker: t });
  return [...seen.values()];
}

async function runReview() {
  const btn = document.getElementById("btn-review-run");
  if (btn) btn.disabled = true;
  let done = 0;
  for (const pos of positions) {
    const e = cache[pos.ticker];
    if (!e || !e.fund) {
      try { await analyzeTicker(pos.ticker, null, { silent: true, skipRender: true }); }
      catch (_) { /* best-effort : on affichera ce qu'on a */ }
    }
    done++;
    const s = document.getElementById("review-summary");
    if (s) s.innerHTML = `<p class="analysis-empty">Analyse en cours… ${done}/${positions.length}</p>`;
  }
  const entryOf = (pos) => cache[pos.ticker] || null;
  const portfolio = reviewPortfolio(positions, entryOf, positionValueBase);
  const marketEntries = Object.entries(marketCache).map(([t, e]) => ({ ...e, ticker: t }));
  const additions = reviewAdditions(positions, marketEntries, portfolio.bySector, portfolio.total);
  reviewData = { portfolio, additions };
  if (btn) btn.disabled = false;
  renderPositions();
}

function renderReviewSummary() {
  const el = document.getElementById("review-summary");
  if (!el) return;
  if (!reviewData) {
    el.innerHTML = `<p class="analysis-empty">Cliquez « Analyser mon portefeuille » : chaque ligne reçoit un verdict, ses stops et une alternative sectorielle, plus un bilan global.</p>`;
    return;
  }
  const { portfolio: p, additions } = reviewData;
  const base = getBaseCurrency();
  const health = p.health == null ? "—" : `${p.health}/100`;
  const synth = p.health == null ? "Analysez vos lignes pour obtenir une synthèse."
    : p.counts.vendre ? `${p.counts.vendre} ligne(s) à envisager de vendre, ${p.counts.alleger} à alléger.`
    : p.counts.alleger ? `Globalement sain, ${p.counts.alleger} ligne(s) à surveiller.`
    : "Portefeuille sain, rien d'urgent.";

  const secteurs = Object.entries(p.bySector).sort((a, b) => b[1] - a[1]).map(([sec, val]) => {
    const pct = p.total > 0 ? (val / p.total) * 100 : 0;
    return `<div class="bot-expo-row"><span>${esc(sec)}</span>
      <span class="bot-expo-bar"><i style="width:${Math.min(100, pct).toFixed(1)}%"></i></span>
      <span class="num">${fnum(pct)} %</span></div>`;
  }).join("");

  const alertes = p.alerts.length ? `<ul>${p.alerts.map(a => `<li class="review-alert">⚠ ${esc(a)}</li>`).join("")}</ul>` : "";

  const prio = p.priorities.filter(x => x.verdict && x.verdict !== "garder").slice(0, 6).map(x =>
    `<li><span class="verdict-dot ${x.verdict}">${x.verdict}</span> ${esc(x.ticker)} — ${esc(x.reason)}</li>`).join("")
    || `<li class="analysis-empty">Aucune action prioritaire.</li>`;

  const add = additions.length
    ? `<ul>${additions.map(a => `<li>${esc(a.ticker)} — ${esc(a.sector)} · score ${a.score} <button class="btn btn-small btn-ghost js-review-add" data-ticker="${esc(a.ticker)}">+ suivre</button></li>`).join("")}</ul>`
    : `<p class="analysis-empty">Lancez/enrichissez un scan marché (F5) pour des suggestions d'ajout.</p>`;

  el.innerHTML = `
    <dl class="impact-grid">
      <div><dt>Santé du portefeuille</dt><dd>${health}</dd></div>
      <div><dt>À garder / alléger / vendre</dt><dd>${p.counts.garder} / ${p.counts.alleger} / ${p.counts.vendre}</dd></div>
    </dl>
    <p class="fund-caveat">${esc(synth)}</p>
    <h2 class="alerts-log-title">Répartition par secteur (${esc(base)})</h2>
    <div class="bot-expo">${secteurs || "<p class='analysis-empty'>—</p>"}</div>
    ${alertes}
    <h2 class="alerts-log-title">Priorités d'action</h2><ul>${prio}</ul>
    <h2 class="alerts-log-title">À ajouter</h2>${add}`;
}
```

- [ ] **Step 4b : Appeler `renderReviewSummary()` depuis `renderPositions()`**

Au tout début de `renderPositions()`, après `const tbody = document.getElementById("positions-body");`, ajouter :
```js
  renderReviewSummary();
```

- [ ] **Step 5 : Cellules Verdict + Stop + ligne de détail par position**

Dans `renderPositions()`, la ligne construite pour chaque position se termine par
`<td class="actions-col"></td>`. Remplacer ce `tr.innerHTML = …` pour insérer les deux cellules **avant** `actions-col`. Repérer le gabarit existant et remplacer la dernière cellule par :
```js
      <td data-label="Verdict">${reviewVerdictCell(pos)}</td>
      <td class="num" data-label="Stop">${reviewStopCell(pos)}</td>
      <td class="actions-col"></td>`;
```
Puis, après l'ajout de la ligne au `tbody` (`tbody.appendChild(tr);` en fin de boucle), insérer la ligne de détail :
```js
    const detail = reviewDetailRow(pos);
    if (detail) tbody.appendChild(detail);
```

Ajouter ces trois helpers juste avant `function renderPositions()` :
```js
function reviewVerdictCell(pos) {
  const e = cache[pos.ticker];
  if (!reviewData || !e || !e.ind) return "—";
  const v = reviewVerdict(pos, e);
  return `<span class="verdict-dot ${v.verdict}">${v.verdict}</span><span class="verdict-conv">conviction ${esc(v.conviction)}</span>`;
}
function reviewStopCell(pos) {
  const e = cache[pos.ticker];
  if (!reviewData || !e || !e.ind) return "—";
  return fnum(reviewStops(pos, e).initialLevel);
}
function reviewDetailRow(pos) {
  const e = cache[pos.ticker];
  if (!reviewData || !e || !e.ind) return null;
  const v = reviewVerdict(pos, e);
  const s = reviewStops(pos, e);
  const alt = (v.verdict !== "garder") ? reviewSectorAlt({ ...e, ticker: pos.ticker }, reviewUniverse()) : null;
  const effet = (pct) => pct == null ? "" : pct >= 0 ? ` (sécurise ${fpct(pct)})` : ` (limite à ${fpct(pct)})`;
  const tr = document.createElement("tr");
  tr.className = "review-detail";
  tr.innerHTML = `<td colspan="10">
    <strong>Pourquoi :</strong>
    <ul>${v.reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>
    <strong>Stops :</strong> initial ${fnum(s.initialLevel)}${effet(s.initialVsPru)} · suiveur ${fnum(s.trailLevel)}${effet(s.trailVsPru)}
    ${alt ? `<br><span class="review-alt">Alternative ${esc(alt.sector)} : ${esc(alt.ticker)} (score ${alt.scoreThem} vs ${alt.scoreYou}).</span>` : ""}
  </td>`;
  return tr;
}
```

- [ ] **Step 6 : Câbler les boutons**

Chercher le gestionnaire d'événements du panneau positions. S'il n'existe pas de `addEventListener("click")` sur `#panel-positions`, ajouter à la fin de la section positions :
```js
document.getElementById("panel-positions").addEventListener("click", e => {
  if (e.target.id === "btn-review-run") runReview();
  else if (e.target.id === "btn-review-expand") reviewExpandSector();
  else { const add = e.target.closest(".js-review-add"); if (add) { addTickerToWatchlist(add.dataset.ticker); toast(`${add.dataset.ticker} ajouté à la watchlist.`, "success"); } }
});

// Enrichit à la demande quelques titres du scan partageant un secteur avec les positions,
// pour peupler les alternatives sectorielles quand le vivier connu est trop mince.
async function reviewExpandSector() {
  const secteurs = new Set(positions.map(p => (cache[p.ticker] && cache[p.ticker].fund && cache[p.ticker].fund.sector)).filter(Boolean));
  if (!secteurs.size) { toast("Analysez d'abord vos positions.", "warn"); return; }
  const cibles = (marketCandidates || [])
    .map(m => m.symbol).filter(sym => !cache[sym] || !marketCache[sym])
    .slice(0, 20);
  const btn = document.getElementById("btn-review-expand");
  if (btn) btn.disabled = true;
  for (const sym of cibles) {
    try { await analyzeTicker(sym, null, { silent: true, skipRender: true, store: marketCache }); } catch (_) {}
  }
  if (btn) btn.disabled = false;
  runReview();
}
```

- [ ] **Step 7 : Vérifier en local (fonctions + rendu)**

Recharger `?v=6`. Console : `reviewSelfTest()` → `22/22`, `botSelfTest()` → `53/53`, `fundSelfTest()` → `14/14`.
Puis, dans la console, seeder deux positions et lancer la revue :
```js
positions = [{id:1,ticker:"MC.PA",qty:2,pru:500},{id:2,ticker:"AAPL",qty:5,pru:150}];
document.querySelector('[data-tab="positions"]').click();
await runReview();
document.querySelector(".review-block").open = true;
```
Vérifier : bloc Revue rempli (santé, secteurs, priorités, à ajouter), colonnes Verdict/Stop remplies, bouton « ⓘ »/détail présent. Aucune erreur dans `read_console_messages`.

- [ ] **Step 8 : Responsive + non-régression**

Passer en mobile (375 px), vérifier absence de débordement horizontal de la page (le tableau défile dans `.table-wrap`). Cliquer F1→F9 et l'onglet Bot : aucune erreur.

- [ ] **Step 9 : Tests serveur**

Run: `C:\Users\amagu\AppData\Local\Programs\Python\Python311\python.exe -X utf8 -m unittest discover tests`
Attendu : `OK`.

- [ ] **Step 10 : Commit + déploiement**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(revue): UI F2 (bloc revue, verdict/stop par ligne, détail, suggestions)"
git push origin main
```
Après déploiement, vérifier `https://terminal-boursier.onrender.com/api/ping` (crumb) puis l'onglet F2 sur la prod.

---

## Auto-revue

**Couverture du spec :**
- §A backend secteur/industrie → Task 1 ✓
- §B.1 reviewGlobal → Task 2 ✓
- §B.2 stops (initial + suiveur + effet PRU) → Task 2 ✓
- §B.3 verdict multi-facteurs + conviction → Task 3 ✓
- §B.4 alternative sectorielle → Task 4 ✓
- §B.5 bilan (secteurs, alertes, santé pondérée, priorités) → Task 5 ✓
- §B.6 suggestions d'ajout → Task 6 ✓
- §C UI (bloc revue, colonnes, détail, boutons, avertissement) → Task 7 ✓
- §D tests reviewSelfTest → répartis tâches 2–6 ✓
- §E cas limites (non analysé, secteur inconnu, devise, scan vide, PRU ≤ 0) → gérés dans les helpers (guards `null`, « Secteur inconnu », `positionValueBase.ok`, sections masquées) ✓

**Placeholders :** aucun — chaque step contient le code réel. La seule subtilité est le test « zone grise » de la Task 3, explicitement corrigé par la note (utiliser la version « garder »).

**Cohérence des noms :** `reviewGlobal`, `reviewStopPct`, `reviewHighest`, `reviewStops`, `reviewVerdict`, `reviewSectorAlt`, `reviewPortfolio`, `reviewAdditions`, `reviewUniverse`, `runReview`, `renderReviewSummary`, `reviewData`, `reviewVerdictCell`, `reviewStopCell`, `reviewDetailRow`, `reviewExpandSector` — utilisés de façon identique entre tâches. Champs de verdict (`verdict`/`conviction`/`reasons`) et de bilan (`total`/`bySector`/`alerts`/`health`/`counts`/`priorities`) cohérents partout. `colspan="10"` cohérent avec les 10 colonnes de la Task 7.

---

## Handoff d'exécution

**Plan complet enregistré dans `docs/superpowers/plans/2026-07-21-revue-portefeuille.md`. Deux options :**

**1. Sous-agents (recommandé)** — un sous-agent frais par tâche, revue entre chaque.

**2. Exécution en ligne** — dans cette session, avec checkpoints.

**Quelle approche ?**
