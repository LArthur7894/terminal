"use strict";

/* ============================================================================
   Backtest : rejeu de la stratégie du bot sur l'historique en cache.
   Moteur pur (aucun réseau, aucun DOM) + son UI (section de l'onglet Bot).
   Chargé après 05-bot (réutilise botProfile/botApplyTick/botStats…) et après les
   modules UI dont il emprunte les helpers de rendu. Auto-tests : backtestSelfTest().

   LIMITES ASSUMÉES, à garder en tête en lisant tout résultat :
   - Biais du survivant : l'univers vient des écrans Yahoo d'AUJOURD'HUI ; les
     sociétés qui ont fait faillite ou ont été retirées n'y sont pas → résultats
     flattés.
   - Exécution sur clôtures quotidiennes : pas d'intraday, les stops se déclenchent
     à la clôture qui les casse, jamais pire → optimiste sur les trous de cotation.
   - Fondamentaux non « point-in-time » : on ne dispose que du fondamental ACTUEL,
     appliqué à tout l'historique (biais d'anticipation). Pour un backtest propre,
     mettre le curseur technique/fondamental à 100 % technique (onglet Analyse).
   - Un backtest n'est pas une prédiction. Il mesure ce qu'une règle AURAIT fait sur
     un passé connu, pas ce qu'elle fera.
   ============================================================================ */

const BACKTEST_TEST_CASES = [];
function backtestTest(name, fn) { BACKTEST_TEST_CASES.push({ name, fn }); }

function backtestSelfTest() {
  let pass = 0, fail = 0;
  const report = [];
  for (const { name, fn } of BACKTEST_TEST_CASES) {
    try { fn(); pass++; report.push({ name, ok: true }); }
    catch (e) { fail++; report.push({ name, ok: false, err: String((e && e.message) || e) }); }
  }
  const total = BACKTEST_TEST_CASES.length;
  console.log(`[backtestSelfTest] ${pass}/${total} passed, ${fail} failed`);
  for (const r of report) console.log(r.ok ? `  ✓ ${r.name}` : `  ✗ ${r.name} — ${r.err}`);
  return { pass, fail, total, report };
}

/* ---------- helpers purs ---------- */

// hist (closes/dates du plus récent au plus ancien) → série chronologique {dates, closes}
// ancien→récent, nulls et cours ≤ 0 écartés. null si structure inexploitable.
function backtestChrono(hist) {
  if (!hist || !Array.isArray(hist.closes) || !Array.isArray(hist.dates)) return null;
  const pairs = [];
  for (let i = 0; i < hist.closes.length; i++) {
    const c = hist.closes[i], d = hist.dates[i];
    if (c == null || !isFinite(c) || c <= 0 || !d) continue;
    pairs.push([d, c]);
  }
  if (pairs.length < 2) return null;
  pairs.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return { dates: pairs.map(p => p[0]), closes: pairs.map(p => p[1]) };
}

// Indicateurs « tels qu'ils étaient » à l'indice chronologique j (inclus). On ne passe que
// la fenêtre utile (≈ 1 an) à computeIndicators : suffisant pour SMA 200 et range 52 sem.,
// et borne le coût du rejeu jour par jour.
function backtestIndicatorsAsOf(chrono, j, windowLen = 260) {
  if (j == null || j < 1) return null;
  const lo = Math.max(0, j - windowLen + 1);
  const closes = [], dates = [];
  for (let k = j; k >= lo; k--) { closes.push(chrono.closes[k]); dates.push(chrono.dates[k]); } // récent→ancien
  if (closes.length < 2) return null;
  return computeIndicators({ closes, dates });
}

/* ---------- moteur ---------- */

// universe : [{ ticker, hist:{closes,dates}, fund }]. cfg : config bot. opts : { startDate, warmup }.
// Renvoie { ok, stats, equity, history, benchmarkPct, params } ou { ok:false, reason }.
function backtestRun(universe, cfg, opts = {}) {
  const warmup = opts.warmup != null ? opts.warmup : 200;
  // Scoreur technique injectable → permet un A/B (momentum vs retour à la moyenne) sur
  // exactement les mêmes données. Par défaut, le score par défaut de l'app.
  const scoreFn = opts.scoreFn || computeScore;

  const prepared = [];
  for (const u of universe || []) {
    const chrono = backtestChrono(u.hist);
    if (!chrono || chrono.closes.length < warmup + 5) continue;
    const idxByDate = new Map();
    chrono.dates.forEach((d, i) => idxByDate.set(d, i));
    // Le fondamental ne dépend plus du cours (le sentiment analystes a été retiré du calcul)
    // → fundScore constant par titre, calculé une fois.
    prepared.push({ ticker: u.ticker, chrono, idxByDate,
                    fund: u.fund || null, fundScore: computeFundScore(u.fund || null, null) });
  }
  if (!prepared.length) {
    return { ok: false, reason: "Aucun titre avec assez d'historique en cache (il faut ~1 an de données). Lancez un scan du marché (F5), puis « ★ Enrichir »." };
  }

  const allDates = new Set();
  for (const p of prepared) for (const d of p.chrono.dates) allDates.add(d);
  const timeline = [...allDates].sort();

  // Fenêtre : `lookbackTradingDays` dernières séances (défaut 252 ≈ 1 an) ou une date de début.
  const lookback = opts.lookbackTradingDays || 252;
  let startIdx = Math.max(0, timeline.length - lookback);
  if (opts.startDate) { const k = timeline.findIndex(d => d >= opts.startDate); if (k >= 0) startIdx = k; }
  if (startIdx < 0) startIdx = 0;
  let tradeDates = timeline.slice(startIdx);
  // Date de fin optionnelle : sert au découpage walk-forward (réglage / hors échantillon).
  if (opts.endDate) tradeDates = tradeDates.filter(d => d <= opts.endDate);
  if (tradeDates.length < 5) return { ok: false, reason: "Fenêtre trop courte pour un backtest." };

  let cash = cfg.capital || 10000;
  const startCapital = cash;
  let positions = [];
  const history = [];
  const equity = [];
  let learn = {};

  const priceAt = (prep, d) => { const i = prep.idxByDate.get(d); return i == null ? null : prep.chrono.closes[i]; };

  // Filtre de régime : un indice équipondéré de l'univers sert de baromètre du marché.
  // Régime « risque-on » (achats autorisés) tant que l'indice est au-dessus de sa SMA 200 ;
  // sinon on cesse d'ouvrir des positions (on continue de gérer et sortir les existantes).
  // Faute d'historique pour la SMA 200 (début de fenêtre), on laisse passer (true).
  let regimeOK = null;
  if (opts.regimeFilter || opts.regimeSwitch) {
    const first = new Map();
    const mDates = [], mLevel = [];
    for (const d of timeline) {
      let sum = 0, cnt = 0;
      for (const prep of prepared) {
        const c = priceAt(prep, d);
        if (c == null) continue;
        if (!first.has(prep.ticker)) first.set(prep.ticker, c);
        sum += c / first.get(prep.ticker); cnt++;
      }
      if (cnt) { mDates.push(d); mLevel.push(sum / cnt); }
    }
    regimeOK = new Map();
    for (let i = 0; i < mDates.length; i++) {
      if (i < 200) { regimeOK.set(mDates[i], true); continue; }
      let s = 0; for (let k = i - 200; k < i; k++) s += mLevel[k];
      regimeOK.set(mDates[i], mLevel[i] > s / 200);
    }
  }

  for (let di = 0; di < tradeDates.length; di++) {
    const d = tradeDates[di];
    const dMs = new Date(d + "T00:00:00Z").getTime();

    // Bascule de régime : momentum quand le marché est haussier, retour à la moyenne quand il
    // baisse — chaque signal joue là où il excelle. Sinon, le scoreur unique fourni.
    const dayScore = opts.regimeSwitch
      ? (regimeOK.get(d) === false ? scoreMeanReversion : scoreMomentum)
      : scoreFn;

    // Apprentissage recalculé périodiquement depuis l'historique accumulé (comme le bot en direct).
    if (cfg.learnEnabled && di % 5 === 0) learn = botComputeLearning(history, cfg, learn);

    // --- sorties ---
    const stillOpen = [];
    for (const pos of positions) {
      const prep = pos._prep;
      const c = priceAt(prep, d);
      let cur = { ...pos };
      let exit = null;

      if (botAgeDays(pos.entryDate, dMs) > pos.horizonDays) {
        exit = { price: c != null ? c : pos.entryPrice, date: d, reason: "horizon" };
      }
      if (!exit && c != null) { const r = botApplyTick(cur, c, d); cur = r.updated; if (r.exit) exit = r.exit; }
      if (!exit && c != null) {
        const ind = backtestIndicatorsAsOf(prep.chrono, prep.idxByDate.get(d));
        if (ind) {
          const sc = dayScore(ind);
          const g = computeGlobalScore({ score: sc, fundScore: prep.fundScore });
          if ((g != null && g <= cfg.exitScore) || signalFromScore(sc) === "Vente") {
            exit = { price: c, date: d, reason: "réévaluation" };
          }
        }
      }

      if (exit && isFinite(exit.price) && exit.price > 0) {
        const soldQty = exit.partial ? cur.qty / 2 : cur.qty;
        const { cashIn, net } = botApplyExitProceeds(exit.price, soldQty, cfg);
        cash += cashIn;
        history.unshift({ ticker: cur.ticker, market: cur.market, family: cur.family,
          entryDate: cur.entryDate, entryPrice: cur.entryPrice, exitDate: exit.date, exitPrice: exit.price,
          qty: soldQty, pnl: cashIn - cur.entryPrice * soldQty, pnlPct: (net / cur.entryPrice - 1) * 100, reason: exit.reason });
        if (exit.partial) { cur.qty -= soldQty; cur.scaledOut = true; stillOpen.push(cur); }
      } else {
        stillOpen.push(cur);
      }
    }
    positions = stillOpen;

    // --- entrées (suspendues en régime baissier si le filtre est actif) ---
    const held = new Set(positions.map(p => p.ticker));
    const exposureByMarket = {};
    let portfolioValue = cash;
    for (const pos of positions) {
      const v = pos.qty * (priceAt(pos._prep, d) ?? pos.entryPrice);
      portfolioValue += v;
      exposureByMarket[pos.market] = (exposureByMarket[pos.market] || 0) + v;
    }

    const regimeBloque = opts.regimeFilter && regimeOK.get(d) === false;

    const cands = [];
    if (!regimeBloque) for (const prep of prepared) {
      if (held.has(prep.ticker)) continue;
      const j = prep.idxByDate.get(d);
      if (j == null || j < warmup) continue;
      const ind = backtestIndicatorsAsOf(prep.chrono, j);
      if (!ind || !(ind.price > 0)) continue;
      const score = dayScore(ind);
      const entry = { ticker: prep.ticker, ind, score, signal: signalFromScore(score), fund: prep.fund, fundScore: prep.fundScore };
      const g = computeGlobalScore(entry);
      if (g >= cfg.qualityMin) cands.push({ prep, entry, g, close: ind.price });
    }
    cands.sort((a, b) => b.g - a.g);

    for (const cand of cands) {
      if (cash < 1) break;
      const market = botMarketOf(cand.prep.ticker);
      const qAdj = botQualityAdjFor(cand.prep.ticker, cand.entry.ind, learn);
      if (qAdj > 0 && cand.g < cfg.qualityMin + qAdj) continue;
      const marketExp = exposureByMarket[market] || 0;
      const prof = botProfile({ ticker: cand.prep.ticker, ...cand.entry }, cfg, learn, portfolioValue, cash, marketExp);
      if (prof.amount < 1) continue;
      const { filled, cashOut, qty } = botApplyEntryCost(cand.close, prof.amount, cfg);
      if (cashOut > cash) continue;
      cash -= cashOut;
      positions.push({ ticker: cand.prep.ticker, market: prof.market, family: prof.family,
        entryDate: d, entryPrice: filled, qty, stopPct: prof.stopPct, trailPct: prof.trailPct, targetPct: prof.targetPct,
        stopLevel: filled * (1 - prof.stopPct / 100), highest: filled, horizonDays: prof.horizonDays,
        scaledOut: false, entryScore: cand.g, _prep: cand.prep });
      exposureByMarket[market] = marketExp + prof.amount;
      held.add(cand.prep.ticker);
    }

    // --- valeur du portefeuille en fin de journée ---
    let val = cash;
    for (const pos of positions) val += pos.qty * (priceAt(pos._prep, d) ?? pos.entryPrice);
    equity.push({ date: d, value: val });
  }

  // Repère : achat-conservation équipondéré de l'univers sur la même fenêtre.
  let bsum = 0, bn = 0;
  for (const prep of prepared) {
    let first = null, last = null;
    for (const d of tradeDates) { const c = priceAt(prep, d); if (c != null) { if (first == null) first = c; last = c; } }
    if (first != null && last != null && first > 0) { bsum += last / first - 1; bn++; }
  }
  const benchmarkPct = bn ? (bsum / bn) * 100 : null;

  return {
    ok: true,
    stats: botStats(history, equity),
    equity, history, benchmarkPct,
    params: { from: tradeDates[0], to: tradeDates[tradeDates.length - 1], days: tradeDates.length,
              tickers: prepared.length, capital: startCapital, openAtEnd: positions.length },
  };
}

/* ---------- tests ---------- */

// Génère un historique déterministe : n barres suivant une fonction f(i) → prix.
function backtestMkHist(n, f, startDate = "2025-01-01") {
  const base = new Date(startDate + "T00:00:00Z").getTime();
  const dates = [], closes = [];
  for (let i = 0; i < n; i++) {
    dates.push(new Date(base + i * 86400000).toISOString().slice(0, 10));
    closes.push(Math.max(1, f(i)));
  }
  // stocké du plus récent au plus ancien (convention de l'app)
  return { dates: dates.slice().reverse(), closes: closes.slice().reverse() };
}

backtestTest("backtestChrono: trie ancien→récent et écarte les nulls", () => {
  const chrono = backtestChrono({ dates: ["2025-01-03", "2025-01-02", "2025-01-01"], closes: [30, null, 10] });
  botAssertEq(chrono.dates.length, 2, "le null est écarté");
  botAssertEq(chrono.closes[0], 10, "premier = plus ancien");
  botAssertEq(chrono.closes[1], 30, "dernier = plus récent");
});

backtestTest("backtestChrono: structure inexploitable → null", () => {
  botAssertEq(backtestChrono(null), null);
  botAssertEq(backtestChrono({ closes: [10], dates: ["2025-01-01"] }), null, "moins de 2 points");
});

backtestTest("backtestIndicatorsAsOf: le prix = la clôture à la date visée", () => {
  const chrono = backtestChrono(backtestMkHist(300, i => 100 + i)); // strictement croissant
  const ind = backtestIndicatorsAsOf(chrono, 250);
  botAssertEq(ind.price, 100 + 250, "le cours 'as of' est la clôture de l'indice j");
});

backtestTest("backtestRun: univers vide ou trop court → ok:false", () => {
  botAssertEq(backtestRun([], BOT_V2_DEFAULT_CONFIG).ok, false);
  botAssertEq(backtestRun([{ ticker: "X", hist: backtestMkHist(30, i => 100 + i) }], BOT_V2_DEFAULT_CONFIG).ok, false,
    "30 barres < warmup");
});

backtestTest("backtestRun: sur un univers valide, produit des stats cohérentes", () => {
  // Un titre en tendance avec des creux réguliers : de quoi déclencher des achats de retour
  // à la moyenne, puis des sorties. On vérifie surtout que le rejeu ne casse pas et reste borné.
  const univers = [
    { ticker: "AAA", fund: null, hist: backtestMkHist(320, i => 100 + i * 0.3 + 8 * Math.sin(i / 9)) },
    { ticker: "BBB", fund: null, hist: backtestMkHist(320, i => 120 + i * 0.1 + 6 * Math.sin(i / 7 + 1)) },
  ];
  const res = backtestRun(univers, { ...BOT_V2_DEFAULT_CONFIG, capital: 10000 });
  botAssert(res.ok, "le backtest doit aboutir");
  botAssertEq(res.equity.length, res.params.days, "un point de capital par jour simulé");
  botAssert(Number.isFinite(res.stats.totalPct), "performance totale finie");
  botAssert(res.equity[res.equity.length - 1].value > 0, "capital final positif");
  botAssert(Array.isArray(res.history), "historique des trades présent");
});

backtestTest("backtestRun: déterministe (mêmes entrées → même résultat)", () => {
  const mk = () => [{ ticker: "AAA", fund: null, hist: backtestMkHist(320, i => 100 + i * 0.3 + 8 * Math.sin(i / 9)) }];
  const a = backtestRun(mk(), BOT_V2_DEFAULT_CONFIG);
  const b = backtestRun(mk(), BOT_V2_DEFAULT_CONFIG);
  botAssertClose(a.stats.totalPct, b.stats.totalPct, 1e-9, "le rejeu doit être reproductible");
});

backtestTest("backtestRun: un titre qui ne fait que chuter ne finit pas en gain", () => {
  const univers = [{ ticker: "DOWN", fund: null, hist: backtestMkHist(320, i => 300 - i * 0.6) }];
  const res = backtestRun(univers, BOT_V2_DEFAULT_CONFIG);
  botAssert(res.ok, "doit aboutir");
  botAssert(res.stats.totalPct <= 0.001, "sur une baisse continue, pas de performance positive");
});

/* ============================= BACKTEST — UI ============================= */

let backtestChart = null;

// Univers testable : tout ce qui a un historique en cache (scan marché + watchlist).
// Le cache persistant (watchlist) prime sur le cache mémoire du scan en cas de doublon.
function backtestGatherUniverse() {
  const seen = new Map();
  for (const src of [marketCache, cache]) {
    for (const [t, e] of Object.entries(src || {})) {
      if (!e || !e.hist || !Array.isArray(e.hist.closes) || e.hist.closes.length < 60) continue;
      seen.set(t, { ticker: t, hist: e.hist, fund: e.fund || null });
    }
  }
  return [...seen.values()];
}

function renderBacktestResults(res) {
  const el = document.getElementById("backtest-results");
  if (!el) return;
  if (!res.ok) {
    el.innerHTML = `<p class="analysis-empty">${esc(res.reason)}</p>`;
    if (backtestChart) { backtestChart.destroy(); backtestChart = null; }
    return;
  }
  const s = res.stats;
  const pf = s.profitFactor === Infinity ? "∞" : fnum(s.profitFactor);
  const bench = res.benchmarkPct;
  const surperf = (bench != null && isFinite(bench)) ? s.totalPct - bench : null;

  el.innerHTML = `
    <dl class="impact-grid">
      <div><dt>Performance stratégie</dt><dd class="${pctClass(s.totalPct)}">${fpct(s.totalPct)}</dd></div>
      <div><dt>Repère (achat-conservation)</dt><dd class="${pctClass(bench)}">${bench == null ? "—" : fpct(bench)}</dd></div>
      <div><dt>Sur/sous-performance</dt><dd class="${pctClass(surperf)}">${surperf == null ? "—" : fpct(surperf)}</dd></div>
      <div><dt>Drawdown maximum</dt><dd class="neg">−${fnum(s.drawdownPct)} %</dd></div>
      <div><dt>Taux de réussite</dt><dd>${Math.round(s.winRate * 100)} %</dd></div>
      <div><dt>Profit factor</dt><dd>${pf}</dd></div>
      <div><dt>Espérance / trade</dt><dd class="${pctClass(s.expectancy)}">${fnum(s.expectancy)} €</dd></div>
      <div><dt>Trades clôturés</dt><dd>${s.n}</dd></div>
    </dl>
    <p class="hint">${res.strategyLabel ? `Stratégie : <strong>${esc(res.strategyLabel)}</strong> · ` : ""}${res.params.tickers} titres · ${res.params.days} séances (${fdateShort(res.params.from)} → ${fdateShort(res.params.to)}) · ${res.params.openAtEnd} position(s) encore ouverte(s) en fin de période. Le mélange technique/fondamental suit le curseur de l'onglet Analyse.</p>
    <div class="bot-equity-holder"><canvas id="backtest-canvas"></canvas></div>
    ${botGroupTable("Par famille", s.byFamily)}
    ${botGroupTable("Par raison de sortie", s.byReason)}
    <p class="hint">⚠ Rejeu sur données passées, ce n'est pas une prédiction. Biais du survivant (univers d'aujourd'hui), exécution aux clôtures (optimiste sur les trous de cotation), fondamentaux non historisés (mettre le curseur à 100 % technique pour un rejeu sans anticipation). À lire comme un ordre de grandeur.</p>`;

  renderBacktestChart(res);
}

function renderBacktestChart(res) {
  const canvas = document.getElementById("backtest-canvas");
  if (!canvas || typeof Chart === "undefined" || res.equity.length < 2) return;
  if (backtestChart) { backtestChart.destroy(); backtestChart = null; }
  const base = res.equity[0].value || 1;
  backtestChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: res.equity.map(p => fdateShort(p.date)),
      datasets: [{ data: res.equity.map(p => p.value / base * 100), borderColor: "#ffb000",
        backgroundColor: "rgba(255,176,0,0.08)", borderWidth: 2, pointRadius: 0, tension: 0.15, fill: true }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => "base 100 → " + fnum(ctx.parsed.y) } } },
      scales: {
        x: { ticks: { color: "#7b8794", maxTicksLimit: 6, font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: "#1a2028" } },
        y: { ticks: { color: "#7b8794", font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: "#1a2028" } },
      },
    },
  });
}

// Plafond de titres téléchargés pour un backtest profond : borne le trafic vers Yahoo
// (chaque titre = une requête) tout en gardant un univers représentatif.
const BACKTEST_DEEP_CAP = 100;

// Stratégies comparables dans le laboratoire. Chacune se traduit en options du moteur.
// Le retour à la moyenne (défaut) est le score réellement utilisé par le bot en direct ;
// les autres ne servent qu'à l'exploration au backtest (voir la note walk-forward de 02).
const BACKTEST_STRATEGIES = {
  default:          { label: "retour à la moyenne (défaut du bot)", opts: {} },
  momentum:         { label: "momentum",                            opts: { scoreFn: scoreMomentum } },
  momentum_regime:  { label: "momentum + filtre de régime",         opts: { scoreFn: scoreMomentum, regimeFilter: true } },
  switch:           { label: "bascule de régime",                   opts: { regimeSwitch: true } },
};

// Télécharge un historique profond (5y/max) pour les titres déjà connus (scan + watchlist),
// sans rien persister : l'univers profond ne vit que le temps du backtest. Le cache 15 min
// du serveur absorbe les relances rapprochées.
async function backtestDeepUniverse(range, status) {
  const tickers = [...new Set([...Object.keys(cache), ...Object.keys(marketCache)])]
    .filter(t => { const e = cache[t] || marketCache[t]; return e && e.hist && Array.isArray(e.hist.closes); });
  const total = tickers.length;
  const list = tickers.slice(0, BACKTEST_DEEP_CAP);

  const universe = [];
  let done = 0;
  await runPool(list, async (t) => {
    try {
      const hist = await fetchDailySeries(t, { range });
      const e = cache[t] || marketCache[t];
      universe.push({ ticker: t, hist, fund: (e && e.fund) || null });
    } catch (_) { /* un titre qui échoue est simplement ignoré */ }
    done++;
    if (done % 5 === 0 || done === list.length) {
      status.textContent = `Téléchargement de l'historique ${done}/${list.length}…`;
    }
  }, 6);

  return { universe, truncated: total > BACKTEST_DEEP_CAP, total };
}

async function runBacktest() {
  const btn = document.getElementById("backtest-run");
  const status = document.getElementById("backtest-status");
  const sel = document.getElementById("backtest-period");
  if (!btn || !status) return;

  const value = sel ? sel.value : "252";
  const deep = value === "5y" || value === "10y";  // « max » exclu : Yahoo y dégrade le journalier en trimestriel
  btn.disabled = true;

  let universe, truncated = false;
  try {
    if (deep) {
      // On a besoin d'au moins un titre déjà en cache pour connaître la liste à télécharger.
      if (![...Object.keys(cache), ...Object.keys(marketCache)].some(t => (cache[t] || marketCache[t])?.hist)) {
        status.textContent = "Aucun titre en cache. Lancez un scan du marché (F5) avant un backtest profond.";
        btn.disabled = false;
        return;
      }
      status.textContent = "Téléchargement de l'historique profond…";
      const deepRes = await backtestDeepUniverse(value, status);  // "5y" ou "10y"
      universe = deepRes.universe;
      truncated = deepRes.truncated;
      if (!universe.length) {
        status.textContent = "Impossible de télécharger l'historique (Yahoo indisponible ?). Réessayez.";
        btn.disabled = false;
        return;
      }
    } else {
      universe = backtestGatherUniverse();
      if (!universe.length) {
        status.textContent = "Aucun titre en cache. Lancez un scan du marché (F5), puis « ★ Enrichir le top ».";
        btn.disabled = false;
        return;
      }
    }
  } catch (e) {
    status.textContent = "Erreur pendant le téléchargement : " + ((e && e.message) || e);
    btn.disabled = false;
    return;
  }

  // Fenêtre : périodes profondes → tout l'historique téléchargé ; sinon N dernières séances.
  const lookback = deep ? 100000 : (({ "126": 126, "252": 252 })[value] || 252);

  // Stratégie choisie (défaut = le score réel du bot).
  const stratSel = document.getElementById("backtest-strategy");
  const stratKey = (stratSel && BACKTEST_STRATEGIES[stratSel.value]) ? stratSel.value : "default";
  const strat = BACKTEST_STRATEGIES[stratKey];

  status.textContent = `Rejeu en cours sur ${universe.length} titres (${strat.label})…`;
  await new Promise(r => setTimeout(r, 30)); // laisse le statut se peindre avant le calcul synchrone

  let res;
  try {
    res = backtestRun(universe, { ...bot.config }, { lookbackTradingDays: lookback, ...strat.opts });
  } catch (e) {
    status.textContent = "Erreur pendant le rejeu : " + ((e && e.message) || e);
    btn.disabled = false;
    return;
  }
  status.textContent = res.ok
    ? `Rejeu terminé — ${res.params.tickers} titres, ${res.params.days} séances · stratégie : ${strat.label}.`
      + (truncated ? ` (univers limité aux ${BACKTEST_DEEP_CAP} premiers titres).` : "")
    : "";
  if (res.ok) res.strategyLabel = strat.label;
  renderBacktestResults(res);
  btn.disabled = false;
}

{
  const btn = document.getElementById("backtest-run");
  if (btn) btn.addEventListener("click", runBacktest);
}

MODULES_CHARGES.push("15-backtest");   // doit rester la dernière ligne du fichier
