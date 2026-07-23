"use strict";

/* ============================================================================
   Barèmes et scores fondamentaux, score global technique+fondamental.
   Doit précéder 04-etat.js : la migration du cache y appelle computeFundScore.
   ============================================================================ */

/* ============================= SCORE FONDAMENTAL ============================= */

// Poids des quatre piliers du score fondamental.
const FUND_PILLAR_WEIGHTS = { valuation: 0.35, profitability: 0.30, growth: 0.20, health: 0.15 };

function clamp01(x) { return Math.max(0, Math.min(1, isFinite(x) ? x : 0.5)); }

// Interpolation linéaire bornée entre des points [[x,y],...] triés par x croissant.
// Renvoie y du premier point si v <= x0, y du dernier si v >= xn, sinon interpole.
function piecewise(v, points) {
  if (v === null || v === undefined || !isFinite(v)) return null;
  if (v <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (v <= points[i][0]) {
      const [x0, y0] = points[i - 1], [x1, y1] = points[i];
      return y0 + (y1 - y0) * (v - x0) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

// Moyenne des sous-scores non nuls ; null si aucun disponible.
function avgDefined(vals) {
  const ok = vals.filter(v => v !== null && v !== undefined && isFinite(v));
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
}

/* ============================= FONDAMENTAUX AVANCÉS =============================
 * Indicateurs dérivés des champs bruts Yahoo. Fonctions pures, testées par
 * fundSelfTest(). Toute donnée manquante ou aberrante renvoie null : les barèmes
 * et avgDefined savent l'ignorer sans fausser le score.
 * ============================================================================ */

// Nombre minimal d'analystes pour qu'un consensus en soit un.
const FUND_MIN_ANALYSTS = 3;

// Rendement du flux de trésorerie libre, en fraction (0.07 = 7 %).
function fcfYield(f) {
  if (!f || f.freeCashflow == null || !isFinite(f.freeCashflow)) return null;
  if (f.marketCap == null || !isFinite(f.marketCap) || f.marketCap <= 0) return null;
  return f.freeCashflow / f.marketCap;
}

// Dette nette = dette totale − trésorerie. Négative = l'entreprise a plus de cash que de dettes.
function netDebt(f) {
  if (!f || f.totalDebt == null || !isFinite(f.totalDebt)) return null;
  if (f.totalCash == null || !isFinite(f.totalCash)) return null;
  return f.totalDebt - f.totalCash;
}

// Dette nette rapportée à l'EBITDA (lecture standard du levier). EBITDA ≤ 0 → non calculable.
function netDebtToEbitda(f) {
  const nd = netDebt(f);
  if (nd === null) return null;
  if (!f.ebitda || !isFinite(f.ebitda) || f.ebitda <= 0) return null;
  return nd / f.ebitda;
}

// Potentiel vs objectif de cours moyen des analystes, en %.
function targetUpsidePct(f, price) {
  if (!f || f.targetMeanPrice == null || !isFinite(f.targetMeanPrice)) return null;
  if (price == null || !isFinite(price) || price <= 0) return null;
  return (f.targetMeanPrice / price - 1) * 100;
}

// Régularité du résultat net : part des exercices en hausse (0..1). null si série trop courte.
function epsTrendRatio(f) {
  const h = f && Array.isArray(f.netIncomeHistory) ? f.netIncomeHistory : [];
  if (h.length < 2) return null;
  let hausses = 0;
  for (let i = 1; i < h.length; i++) if (h[i].netIncome > h[i - 1].netIncome) hausses++;
  return hausses / (h.length - 1);
}

// Le consensus n'est retenu que s'il repose sur assez d'analystes.
function fundHasConsensus(f) {
  return !!f && f.numberOfAnalystOpinions != null && isFinite(f.numberOfAnalystOpinions)
    && f.numberOfAnalystOpinions >= FUND_MIN_ANALYSTS;
}

/* ---------- barèmes des nouveaux indicateurs (seuils validés) ---------- */

// > 7 % bien, < 2 % pas bien.
function scoreFcfYield(v) {
  return v === null ? null : piecewise(v, [[0.02, 0], [0.045, 0.5], [0.07, 1]]);
}
// Dette nette négative = très positif ; au-delà de 4× l'EBITDA = mauvais.
function scoreNetDebtToEbitda(v) {
  if (v === null) return null;
  return v < 0 ? 1 : piecewise(v, [[0, 1], [2, 0.6], [4, 0]]);
}
// recommendationMean Yahoo : 1 = achat fort, 5 = vente.
function scoreAnalystRating(v) {
  return v === null || v === undefined || !isFinite(v) ? null : piecewise(v, [[1, 1], [3, 0.5], [5, 0]]);
}
// Potentiel vs objectif : négatif ou nul = 0, +30 % = note maximale.
function scoreTargetUpside(v) {
  if (v === null) return null;
  return v <= 0 ? 0 : piecewise(v, [[0, 0.3], [15, 0.7], [30, 1]]);
}

// Barèmes (seuils absolus). Chaque métrique → sous-score 0..1.
// Valorisation : plus c'est bas, mieux c'est (PER/PEG/PB négatifs = perte/anomalie → 0).
function scoreValuation(f, currentPrice = null) {
  const pe = f.trailingPE;
  const peScore = (pe === null) ? null : (pe <= 0 ? 0 : piecewise(pe, [[8, 1], [10, 1], [25, 0.5], [50, 0]]));
  const fpe = f.forwardPE;
  const fpeScore = (fpe === null) ? null : (fpe <= 0 ? 0 : piecewise(fpe, [[8, 1], [10, 1], [25, 0.5], [50, 0]]));
  const peg = f.pegRatio;
  const pegScore = (peg === null) ? null : (peg <= 0 ? 0 : piecewise(peg, [[1, 1], [2, 0.5], [3, 0]]));
  const pb = f.priceToBook;
  const pbScore = (pb === null) ? null : (pb <= 0 ? 0 : piecewise(pb, [[1, 1], [3, 0.5], [6, 0]]));
  const ev = f.enterpriseToEbitda;
  // Resserré : < 8 bien, 9–12 moyen, au-delà moins bien.
  const evScore = (ev === null) ? null : (ev <= 0 ? 0 : piecewise(ev, [[8, 1], [12, 0.5], [18, 0]]));
  const fcfScore = scoreFcfYield(fcfYield(f));
  // Consensus : opinion de marché, retenue seulement si assez d'analystes la portent.
  // Deux sous-scores sur huit, soit ~9 % du score total — présents sans dominer.
  const consensus = fundHasConsensus(f);
  const ratingScore = consensus ? scoreAnalystRating(f.recommendationMean) : null;
  const upsideScore = consensus ? scoreTargetUpside(targetUpsidePct(f, currentPrice)) : null;
  return avgDefined([peScore, fpeScore, pegScore, pbScore, evScore, fcfScore, ratingScore, upsideScore]);
}

// Rentabilité : plus c'est haut, mieux c'est (marges/ROE/ROA en fraction : 0.25 = 25 %).
function scoreProfitability(f) {
  const pm = f.profitMargins;
  const pmScore = pm === null ? null : piecewise(pm, [[0, 0], [0.20, 0.7], [0.40, 1]]);
  const om = f.operatingMargins;
  const omScore = om === null ? null : piecewise(om, [[0, 0], [0.20, 0.7], [0.40, 1]]);
  const roe = f.returnOnEquity;
  const roeScore = roe === null ? null : piecewise(roe, [[0, 0], [0.15, 0.6], [0.30, 1]]);
  const roa = f.returnOnAssets;
  const roaScore = roa === null ? null : piecewise(roa, [[0, 0], [0.08, 0.6], [0.15, 1]]);
  return avgDefined([pmScore, omScore, roeScore, roaScore]);
}

// Croissance : plus c'est haut, mieux (fraction : 0.10 = 10 %).
function scoreGrowth(f) {
  const rg = f.revenueGrowth;
  const rgScore = rg === null ? null : piecewise(rg, [[-0.10, 0], [0, 0.4], [0.25, 1]]);
  const eg = f.earningsGrowth;
  const egScore = eg === null ? null : piecewise(eg, [[-0.10, 0], [0, 0.4], [0.25, 1]]);
  // Régularité du résultat net sur les exercices connus : une progression continue vaut mieux
  // qu'une seule bonne année. Déjà exprimée sur 0..1, utilisée telle quelle.
  const trendScore = epsTrendRatio(f);
  return avgDefined([rgScore, egScore, trendScore]);
}

// Santé financière + dividende. debtToEquity façon Yahoo en % (150 = 1.5x).
function scoreHealth(f) {
  const de = f.debtToEquity;
  const deScore = de === null ? null : (de < 0 ? 0 : piecewise(de, [[50, 1], [150, 0.5], [300, 0]]));
  const cr = f.currentRatio;
  const crScore = cr === null ? null : piecewise(cr, [[1, 0.2], [1.5, 0.7], [3, 1]]);
  // Levier réel : la dette nette rapportée à l'EBITDA. Négative = trésorerie excédentaire.
  const ndScore = scoreNetDebtToEbitda(netDebtToEbitda(f));
  let base = avgDefined([deScore, crScore, ndScore]);
  const dy = f.dividendYield; // fraction (0.03 = 3 %) ; == null couvre null ET undefined
  if (base === null && dy != null && isFinite(dy)) base = 0.5; // dividende seul → neutre
  if (base === null) return null;
  // Bonus dividende : +0.1 par point de % de rendement, plafonné à +0.3.
  const bonus = (dy == null || !isFinite(dy)) ? 0 : Math.min(0.3, Math.max(0, dy * 100 * 0.1));
  return Math.min(1, base + bonus);
}

/* ============================= FONDAMENTAUX — SELF TEST =============================
 * Même convention que botSelfTest() : appelable depuis la console du navigateur.
 * Réutilise le harnais botTest/botAssert* déclaré dans la section BOT V2.
 * ================================================================================= */

const FUND_TEST_CASES = [];
function fundTest(name, fn) { FUND_TEST_CASES.push({ name, fn }); }

function fundSelfTest() {
  let pass = 0, fail = 0;
  const report = [];
  for (const { name, fn } of FUND_TEST_CASES) {
    try { fn(); pass++; report.push({ name, ok: true }); }
    catch (e) { fail++; report.push({ name, ok: false, err: String((e && e.message) || e) }); }
  }
  const total = FUND_TEST_CASES.length;
  console.log(`[fundSelfTest] ${pass}/${total} passed, ${fail} failed`);
  for (const r of report) console.log(r.ok ? `  ✓ ${r.name}` : `  ✗ ${r.name} — ${r.err}`);
  return { pass, fail, total, report };
}

// Fixture : fondamentaux plausibles, surchargeables champ par champ.
function fundMk(over = {}) {
  return {
    symbol: "TEST", currency: "EUR", marketCap: 1000, trailingPE: 15, forwardPE: 13,
    pegRatio: 1.2, priceToBook: 2, enterpriseToEbitda: 10, priceToSales: 2,
    trailingEps: 5, forwardEps: 6, profitMargins: 0.15, operatingMargins: 0.18,
    grossMargins: 0.4, returnOnEquity: 0.2, returnOnAssets: 0.1,
    revenueGrowth: 0.08, earningsGrowth: 0.05, debtToEquity: 60, currentRatio: 1.6,
    quickRatio: 1.2, dividendYield: 0.02, payoutRatio: 0.4, dividendRate: 1,
    recommendationKey: "buy", recommendationMean: 2, numberOfAnalystOpinions: 20,
    targetMeanPrice: 120, freeCashflow: 50, totalDebt: 200, totalCash: 80,
    ebitda: 100, sharesOutstanding: 100,
    netIncomeHistory: [{ year: 2022, netIncome: 10 }, { year: 2023, netIncome: 12 },
                       { year: 2024, netIncome: 14 }, { year: 2025, netIncome: 16 }],
    ...over,
  };
}

/* ---------- calculs dérivés ---------- */

fundTest("fcfYield: FCF rapporté à la capitalisation", () => {
  botAssertClose(fcfYield(fundMk({ freeCashflow: 70, marketCap: 1000 })), 0.07, 1e-9);
  botAssertEq(fcfYield(fundMk({ marketCap: 0 })), null, "capitalisation nulle → non calculable");
  botAssertEq(fcfYield(fundMk({ freeCashflow: null })), null);
});

fundTest("netDebt: dette moins trésorerie, négative si cash excédentaire", () => {
  botAssertEq(netDebt(fundMk({ totalDebt: 200, totalCash: 80 })), 120);
  botAssertEq(netDebt(fundMk({ totalDebt: 50, totalCash: 300 })), -250, "trésorerie nette");
  botAssertEq(netDebt(fundMk({ totalCash: null })), null);
});

fundTest("netDebtToEbitda: EBITDA nul ou négatif → non calculable", () => {
  botAssertClose(netDebtToEbitda(fundMk({ totalDebt: 200, totalCash: 0, ebitda: 100 })), 2, 1e-9);
  botAssertEq(netDebtToEbitda(fundMk({ ebitda: 0 })), null);
  botAssertEq(netDebtToEbitda(fundMk({ ebitda: -50 })), null, "entreprise en perte");
});

fundTest("targetUpsidePct: potentiel vs cours courant", () => {
  botAssertClose(targetUpsidePct(fundMk({ targetMeanPrice: 120 }), 100), 20, 1e-9);
  botAssertClose(targetUpsidePct(fundMk({ targetMeanPrice: 80 }), 100), -20, 1e-9);
  botAssertEq(targetUpsidePct(fundMk(), 0), null, "cours nul → non calculable");
  botAssertEq(targetUpsidePct(fundMk({ targetMeanPrice: null }), 100), null);
});

fundTest("epsTrendRatio: régularité de la progression", () => {
  botAssertEq(epsTrendRatio(fundMk()), 1, "4 exercices en hausse continue → 1");
  const baisse = [{ year: 2022, netIncome: 20 }, { year: 2023, netIncome: 15 },
                  { year: 2024, netIncome: 12 }, { year: 2025, netIncome: 10 }];
  botAssertEq(epsTrendRatio(fundMk({ netIncomeHistory: baisse })), 0, "baisse continue → 0");
  const alterne = [{ year: 2022, netIncome: 10 }, { year: 2023, netIncome: 20 },
                   { year: 2024, netIncome: 15 }, { year: 2025, netIncome: 25 }];
  botAssertClose(epsTrendRatio(fundMk({ netIncomeHistory: alterne })), 2 / 3, 1e-9);
  botAssertEq(epsTrendRatio(fundMk({ netIncomeHistory: [{ year: 2025, netIncome: 10 }] })), null,
    "un seul exercice → pas de tendance");
  botAssertEq(epsTrendRatio(fundMk({ netIncomeHistory: [] })), null);
});

/* ---------- barèmes ---------- */

fundTest("scoreFcfYield: 7 % = max, 2 % = zéro", () => {
  botAssertEq(scoreFcfYield(0.07), 1);
  botAssertEq(scoreFcfYield(0.02), 0);
  botAssertEq(scoreFcfYield(0.10), 1, "au-delà de 7 % reste au maximum");
  botAssertClose(scoreFcfYield(0.045), 0.5, 1e-9);
});

fundTest("scoreNetDebtToEbitda: dette nette négative = note maximale", () => {
  botAssertEq(scoreNetDebtToEbitda(-1.5), 1, "trésorerie nette");
  botAssertEq(scoreNetDebtToEbitda(0), 1);
  botAssertClose(scoreNetDebtToEbitda(2), 0.6, 1e-9);
  botAssertEq(scoreNetDebtToEbitda(4), 0);
  botAssertEq(scoreNetDebtToEbitda(6), 0, "au-delà de 4× reste à zéro");
});

fundTest("scoreAnalystRating: 1 = achat fort, 5 = vente", () => {
  botAssertEq(scoreAnalystRating(1), 1);
  botAssertClose(scoreAnalystRating(3), 0.5, 1e-9);
  botAssertEq(scoreAnalystRating(5), 0);
  botAssertEq(scoreAnalystRating(null), null);
});

fundTest("scoreTargetUpside: +30 % = max, potentiel négatif = zéro", () => {
  botAssertEq(scoreTargetUpside(30), 1);
  botAssertEq(scoreTargetUpside(-10), 0, "objectif sous le cours");
  botAssertEq(scoreTargetUpside(0), 0);
  botAssertClose(scoreTargetUpside(15), 0.7, 1e-9);
});

fundTest("VE/EBITDA resserré : 8 = max, 12 = moyen", () => {
  const s = (ev) => scoreValuation(fundMk({ enterpriseToEbitda: ev, trailingPE: null, forwardPE: null,
    pegRatio: null, priceToBook: null, freeCashflow: null, numberOfAnalystOpinions: 0 }));
  botAssertEq(s(8), 1, "moins de 8 → très bien");
  botAssertClose(s(12), 0.5, 1e-9, "9-12 → moyen");
  botAssertEq(s(18), 0, "au-delà → mauvais");
});

/* ---------- consensus ---------- */

fundTest("consensus ignoré sous 3 analystes", () => {
  botAssertEq(fundHasConsensus(fundMk({ numberOfAnalystOpinions: 2 })), false);
  botAssertEq(fundHasConsensus(fundMk({ numberOfAnalystOpinions: 3 })), true);
  botAssertEq(fundHasConsensus(fundMk({ numberOfAnalystOpinions: null })), false);
});

fundTest("un titre sans consensus garde un pilier Valorisation", () => {
  const sans = computeFundScore(fundMk({ numberOfAnalystOpinions: 1, recommendationMean: 1, targetMeanPrice: 500 }));
  botAssert(sans && sans.pillars.valuation !== null, "la valorisation reste calculée sur les données comptables");
});

/* ---------- non-régression ---------- */

fundTest("un fund sans les nouveaux champs produit toujours un score", () => {
  const v1 = {
    marketCap: 1000, trailingPE: 15, forwardPE: 13, pegRatio: 1.2, priceToBook: 2,
    enterpriseToEbitda: 10, profitMargins: 0.15, operatingMargins: 0.18,
    returnOnEquity: 0.2, returnOnAssets: 0.1, revenueGrowth: 0.08, earningsGrowth: 0.05,
    debtToEquity: 60, currentRatio: 1.6, dividendYield: 0.02,
  };
  const s = computeFundScore(v1);
  botAssert(s && isFinite(s.total), "score calculable sans les champs v2");
  botAssert(s.total >= 0 && s.total <= 100, "score borné 0-100");
});

fundTest("un fund vide ne casse rien", () => {
  botAssertEq(computeFundScore(null), null);
  botAssertEq(computeFundScore({}), null, "aucun pilier calculable → null");
});

function fundVerdict(total) {
  if (total >= 65) return "Sous-évalué / solide";
  if (total <= 35) return "Cher / fragile";
  return "Correct";
}

// Score fondamental /100 : moyenne pondérée des piliers disponibles (poids renormalisés).
function computeFundScore(fund, currentPrice = null) {
  if (!fund) return null;
  const pillars = {
    valuation: scoreValuation(fund, currentPrice),
    profitability: scoreProfitability(fund),
    growth: scoreGrowth(fund),
    health: scoreHealth(fund),
  };
  let wsum = 0, acc = 0;
  for (const k of Object.keys(FUND_PILLAR_WEIGHTS)) {
    if (pillars[k] !== null) { acc += pillars[k] * FUND_PILLAR_WEIGHTS[k]; wsum += FUND_PILLAR_WEIGHTS[k]; }
  }
  if (wsum === 0) return null; // aucun pilier calculable
  const total = Math.round(Math.min(100, Math.max(0, (acc / wsum) * 100)));
  // Piliers exposés en /100 pour l'affichage (null conservé si indisponible).
  const pillars100 = {};
  for (const k of Object.keys(pillars)) pillars100[k] = pillars[k] === null ? null : Math.round(pillars[k] * 100);
  return { total, pillars: pillars100, verdict: fundVerdict(total) };
}

// Score global : mélange technique (entry.score) et fondamental selon weightTech.
// Sans fondamental → technique seul.
function computeGlobalScore(entry) {
  if (!entry.fundScore) return entry.score;
  return Math.round(entry.score * weightTech + entry.fundScore.total * (1 - weightTech));
}

MODULES_CHARGES.push("03-fondamentaux");   // doit rester la dernière ligne du fichier
