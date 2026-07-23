"use strict";

/* ============================================================================
   Revue de portefeuille : verdict par ligne, stops, alternative sectorielle,
   bilan et suggestions. Auto-tests : reviewSelfTest().
   ============================================================================ */

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
    // rangePos en fraction 0..1, comme le renvoie computeIndicators (0,5 = milieu de range).
    ind: { price: 100, vol: 30, rsi: 50, rangePos: 0.5, perf: { m1: 0, m3: 0, y1: 0 }, ...(over.ind || {}) },
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

  // Seuil sur la fraction 0..1 renvoyée par computeIndicators (0,9 = 90 % du range).
  if (ind.rangePos != null && ind.rangePos > 0.9) trim.push("au sommet de son range 52 semaines");
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
  botAssertEq(reviewVerdict(reviewMkPos(), reviewMkEntry({ score: 60, ind: { price: 100, rangePos: 0.95 } })).verdict, "alleger");
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
  const v = reviewVerdict(reviewMkPos(), reviewMkEntry({ score: 50, ind: { price: 100, rangePos: 0.5, rsi: 50 } }));
  botAssertEq(v.verdict, "garder");
  botAssertEq(v.conviction, "faible");
});

reviewTest("reviewVerdict: non analysé → garder sans crash", () => {
  const v = reviewVerdict(reviewMkPos(), reviewMkEntry({ score: null }));
  botAssert(v.verdict === "garder" && v.reasons.length === 1);
});

/* ---------- test de bout en bout : indicateurs réels → verdict ----------
 * Les autres tests utilisent des fixtures écrites à la main. Rien n'y garantissait que
 * ces fixtures aient la même ÉCHELLE que les vraies sorties de computeIndicators — et
 * c'est précisément ce qui avait laissé passer un seuil `rangePos > 90` sur une valeur
 * qui vaut au plus 1. Ce test part donc d'un historique et traverse la vraie chaîne. */

// Historique synthétique : 260 clôtures montant de 50 à 100, le cours du jour au sommet.
function reviewMkHist(n = 260, low = 50, high = 100) {
  const chrono = Array.from({ length: n }, (_, i) => low + (high - low) * (i / (n - 1)));
  return { closes: chrono.reverse(), dates: chrono.map((_, i) => `2026-01-${String((i % 28) + 1).padStart(2, "0")}`) };
}

reviewTest("chaîne réelle : computeIndicators renvoie rangePos dans 0..1", () => {
  const ind = computeIndicators(reviewMkHist());
  botAssert(ind.rangePos >= 0 && ind.rangePos <= 1, `rangePos hors de 0..1 : ${ind.rangePos}`);
  botAssertClose(ind.rangePos, 1, 1e-9, "cours au plus haut → rangePos = 1");
});

reviewTest("chaîne réelle : titre au sommet du range → alléger", () => {
  const hist = reviewMkHist();
  const ind = computeIndicators(hist);
  const entry = { ticker: "TOP", score: 60, signal: "Neutre", fund: null, fundScore: null, hist, ind };
  botAssertEq(reviewVerdict(reviewMkPos({ pru: 95 }), entry).verdict, "alleger");
});

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
