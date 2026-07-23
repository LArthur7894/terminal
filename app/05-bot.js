"use strict";

/* ============================================================================
   Bot de paper-trading v2 : sessions de marché, profil par titre, moteur,
   apprentissage, statistiques. Auto-tests : botSelfTest().
   ============================================================================ */

/* ============================= BOT V2 — SESSIONS ============================= */

// EU / US / ASIA d'après le suffixe Yahoo (ex. ASML.AS → EU, 7203.T → ASIA, BRK-B → US).
function botMarketOf(symbol) {
  if (typeof symbol !== "string" || !symbol) return "US";
  const s = symbol.toUpperCase();
  const dot = s.lastIndexOf(".");
  if (dot < 0) return "US"; // pas de suffixe → US (couvre BRK-B, MSFT, etc.)
  const suf = s.slice(dot); // inclut le point
  const EU   = new Set([".PA",".AS",".BR",".LS",".MC",".MI",".DE",".F",".SW",".L",".VI",".HE",".ST",".OL",".CO",".IR"]);
  const ASIA = new Set([".T",".KS",".KQ",".HK",".SS",".SZ",".AX",".NS",".BO",".SI",".TW"]);
  if (EU.has(suf)) return "EU";
  if (ASIA.has(suf)) return "ASIA";
  return "US";
}

// Séances (heure locale via Intl → le passage à l'heure d'été est géré par le navigateur). Lun–ven.
// Jours fériés non gérés (YAGNI) : en paper trading, un trade au dernier cours connu est sans conséquence.
const BOT_SESSIONS = {
  EU:   { tz: "Europe/Paris",     openMin:  9*60,      closeMin: 17*60 + 30 },
  US:   { tz: "America/New_York", openMin:  9*60 + 30, closeMin: 16*60      },
  ASIA: { tz: "Asia/Tokyo",       openMin:  9*60,      closeMin: 15*60      },
};

// { weekday: "Mon"|… , hour, minute } pour un fuseau donné à l'instant `now`.
function botLocalParts(tz, now) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit",
  }).formatToParts(now);
  const get = (t) => { const p = parts.find(x => x.type === t); return p ? p.value : ""; };
  return { weekday: get("weekday"), hour: Number(get("hour")), minute: Number(get("minute")) };
}

function botIsWeekday(weekday) {
  return weekday === "Mon" || weekday === "Tue" || weekday === "Wed" || weekday === "Thu" || weekday === "Fri";
}

// Places de cotation actuellement ouvertes.
function botOpenMarkets(now = new Date()) {
  const open = new Set();
  for (const m of ["EU", "US", "ASIA"]) {
    const s = BOT_SESSIONS[m];
    const { weekday, hour, minute } = botLocalParts(s.tz, now);
    if (!botIsWeekday(weekday)) continue;
    const mins = hour * 60 + minute;
    if (mins >= s.openMin && mins < s.closeMin) open.add(m);
  }
  return open;
}

// ms avant la prochaine ouverture du marché `market`. 0 si déjà ouvert. Plafonné à 7 jours.
function botNextOpen(market, now = new Date()) {
  if (botOpenMarkets(now).has(market)) return 0;
  const stepMs = 15 * 60 * 1000;
  for (let i = 1; i <= 7 * 24 * 4; i++) {
    const t = new Date(now.getTime() + i * stepMs);
    if (botOpenMarkets(t).has(market)) return i * stepMs;
  }
  return 7 * 24 * 3600 * 1000;
}

/* ============================= BOT V2 — SELF TEST =============================
 * Le projet n'a pas de harnais JS (seuls les tests serveur existent, tests/).
 * On garde la convention mono-fichier : `botSelfTest()` s'appelle depuis la
 * console du navigateur et assertionne toutes les fonctions pures du bot.
 * ============================================================================ */

const BOT_TEST_CASES = [];

function botTest(name, fn) { BOT_TEST_CASES.push({ name, fn }); }
function botAssert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function botAssertEq(a, b, msg) {
  const eq = (Number.isFinite(a) && Number.isFinite(b)) ? Math.abs(a - b) < 1e-9 : a === b;
  if (!eq) throw new Error(`${msg || "not equal"} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}
function botAssertClose(a, b, tol, msg) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > tol) {
    throw new Error(`${msg || "not close"} — got ${a}, expected ~${b} (tol ${tol})`);
  }
}

function botSelfTest() {
  let pass = 0, fail = 0;
  const report = [];
  for (const { name, fn } of BOT_TEST_CASES) {
    try { fn(); pass++; report.push({ name, ok: true }); }
    catch (e) { fail++; report.push({ name, ok: false, err: String((e && e.message) || e) }); }
  }
  const total = BOT_TEST_CASES.length;
  console.log(`[botSelfTest] ${pass}/${total} passed, ${fail} failed`);
  for (const r of report) console.log(r.ok ? `  ✓ ${r.name}` : `  ✗ ${r.name} — ${r.err}`);
  return { pass, fail, total, report };
}

/* ---------- tests : sessions ---------- */

botTest("botMarketOf: suffixes", () => {
  botAssertEq(botMarketOf("ASML.AS"), "EU");
  botAssertEq(botMarketOf("MC.PA"),   "EU");
  botAssertEq(botMarketOf("7203.T"),  "ASIA");
  botAssertEq(botMarketOf("0700.HK"), "ASIA");
  botAssertEq(botMarketOf("AAPL"),    "US");
  botAssertEq(botMarketOf("BRK-B"),   "US");   // tiret ≠ point
  botAssertEq(botMarketOf("ZZZ.XX"),  "US");   // suffixe inconnu → défaut US
  botAssertEq(botMarketOf(""),        "US");
});

botTest("botOpenMarkets: hiver — matin EU seul", () => {
  // lundi 2027-01-11, 09:00 UTC = 10:00 Paris (CET) / 04:00 New York / 18:00 Tokyo
  const o = botOpenMarkets(new Date(Date.UTC(2027, 0, 11, 9, 0)));
  botAssert( o.has("EU"),   "EU devrait être ouvert");
  botAssert(!o.has("US"),   "US devrait être fermé");
  botAssert(!o.has("ASIA"), "ASIA devrait être fermé");
});

botTest("botOpenMarkets: hiver — chevauchement EU + US", () => {
  // lundi 2027-01-11, 15:00 UTC = 16:00 Paris / 10:00 New York
  const o = botOpenMarkets(new Date(Date.UTC(2027, 0, 11, 15, 0)));
  botAssert(o.has("EU") && o.has("US"), "EU et US doivent être ouverts simultanément");
});

botTest("botOpenMarkets: été — chevauchement EU + US (DST)", () => {
  // lundi 2027-07-05, 14:00 UTC = 16:00 Paris (CEST) / 10:00 New York (EDT)
  const o = botOpenMarkets(new Date(Date.UTC(2027, 6, 5, 14, 0)));
  botAssert(o.has("EU") && o.has("US"), "EU et US doivent être ouverts en été aussi");
});

botTest("botOpenMarkets: soirée US seule", () => {
  // lundi 2027-01-11, 20:00 UTC = 21:00 Paris / 15:00 New York
  const o = botOpenMarkets(new Date(Date.UTC(2027, 0, 11, 20, 0)));
  botAssert(!o.has("EU") && o.has("US") && !o.has("ASIA"));
});

botTest("botOpenMarkets: nuit — tout fermé", () => {
  // lundi 2027-01-11, 06:00 UTC = 07:00 Paris / 01:00 New York / 15:00 Tokyo (clôture exclue)
  botAssertEq(botOpenMarkets(new Date(Date.UTC(2027, 0, 11, 6, 0))).size, 0, "aucun marché ouvert attendu");
});

botTest("botOpenMarkets: week-end fermé partout", () => {
  botAssertEq(botOpenMarkets(new Date(Date.UTC(2027, 0, 9, 12, 0))).size, 0); // samedi
});

botTest("botNextOpen: 0 quand ouvert", () => {
  botAssertEq(botNextOpen("EU", new Date(Date.UTC(2027, 0, 11, 9, 0))), 0);
});

botTest("botNextOpen: strictement positif quand fermé", () => {
  botAssert(botNextOpen("US", new Date(Date.UTC(2027, 0, 9, 12, 0))) > 0); // samedi
});

/* ============================= BOT V2 — CONFIG PAR DÉFAUT ============================= */

const BOT_V2_DEFAULT_CONFIG = {
  capital: 10000,
  qualityMin: 60, exitScore: 40,
  stopVolFactor: 0.40, stopMin: 5, stopMax: 20,
  rrMin: 1.5, rrMax: 3,
  riskPerTradePct: 1.0, maxPositionPct: 15, maxMarketPct: 60,
  feePct: 0.10, slipPct: 0.05,
  autoLoop: true, loopMinutes: 15,
  learnEnabled: true, learnMinTrades: 10,
};

/* ============================= BOT V2 — PROFIL PAR TITRE =============================
 * Le bot ne se règle plus à la main : chaque titre reçoit ses propres paramètres,
 * déduits de sa volatilité, de son score, de sa tendance et de l'apprentissage.
 * ==================================================================================== */

function botVolBucket(vol) {
  if (vol < 20) return "faible";
  if (vol < 40) return "moyenne";
  return "forte";
}

function botHorizonDays(bucket) {
  return bucket === "faible" ? 60 : bucket === "moyenne" ? 45 : 30;
}

// Profil complet d'un candidat. `entry` = objet marketCache enrichi de `ticker`.
// `learn` = état d'apprentissage (vide → neutre). `marketExposure` = € déjà exposé sur ce marché.
function botProfile(entry, cfg, learn, portfolioValue, cash, marketExposure = 0) {
  const ticker = entry.ticker;
  const ind = entry.ind || {};
  const market = botMarketOf(ticker);
  const vol = (ind.vol != null && isFinite(ind.vol)) ? ind.vol : 30;
  const volBucket = botVolBucket(vol);
  const family = `${market}:${volBucket}`;
  const fam = (learn && learn[family]) || { stopMult: 1, rrMult: 1, qualityAdj: 0 };
  const score = (entry.score != null) ? computeGlobalScore(entry) : cfg.qualityMin;

  // Stop initial : proportionnel à la volatilité, borné, corrigé par l'apprentissage.
  const stopPct = clamp(cfg.stopVolFactor * fam.stopMult * vol, cfg.stopMin, cfg.stopMax);

  // Stop suiveur : plus serré que l'initial — une fois en gain, on protège davantage.
  const trailPct = 0.8 * stopPct;

  // Ratio gain/risque : croît avec le score, bonifié par la tendance, pénalisé en haut de range.
  let rr = cfg.rrMin + Math.max(0, score - cfg.qualityMin) / Math.max(1, 100 - cfg.qualityMin) * (cfg.rrMax - cfg.rrMin);
  if (ind.price > 0 && ind.sma50 > 0 && ind.sma200 > 0 && ind.price > ind.sma50 && ind.sma50 > ind.sma200) rr += 0.3;
  // rangePos est une FRACTION 0..1 (voir computeIndicators), pas un pourcentage :
  // le seuil du haut de range est donc 0,9 et non 90. Comparé à 90, ce test ne pouvait
  // jamais être vrai et la pénalité n'était jamais appliquée.
  if (ind.rangePos != null && ind.rangePos > 0.9) rr -= 0.3;
  rr = clamp(rr * fam.rrMult, 1.2, 4);
  const targetPct = stopPct * rr;

  // Taille par le risque : chaque position risque le même montant (v1 ignorait le stop).
  const amountRisque = (portfolioValue * (cfg.riskPerTradePct / 100)) / (stopPct / 100);
  let amount = clamp(amountRisque * (score / 75), 0.5 * amountRisque, 1.5 * amountRisque);

  // Plafonds : par position, par marché, et cash disponible.
  const capPos = portfolioValue * (cfg.maxPositionPct / 100);
  const margeMarche = Math.max(0, portfolioValue * (cfg.maxMarketPct / 100) - marketExposure);
  amount = Math.min(amount, capPos, margeMarche, Math.max(0, cash));

  const horizonDays = botHorizonDays(volBucket);
  const dec = (x, n) => x.toFixed(n).replace(".", ",");   // séparateur décimal français
  const why = `score ${Math.round(score)}, volatilité ${Math.round(vol)} % (famille ${family}). `
    + `Stop ${dec(stopPct, 1)} %, cible ${dec(targetPct, 1)} % (RR ${dec(rr, 1)}). `
    + `Mise ${Math.round(amount)} € = ${dec(cfg.riskPerTradePct, 1)} % de risque du capital.`;

  return { market, volBucket, family, stopPct, trailPct, rr, targetPct, amount, horizonDays, why };
}

/* ---------- tests : profil ---------- */

// Fixture minimale d'un candidat.
function botMkEntry(ticker, over = {}) {
  return {
    ticker,
    score: over.score != null ? over.score : 75,
    // rangePos en fraction 0..1, comme le renvoie computeIndicators (0,5 = milieu de range).
    ind: { price: 100, vol: 30, sma50: 95, sma200: 90, rangePos: 0.5, ...(over.ind || {}) },
  };
}

botTest("botProfile: stop borné 5–20 %", () => {
  const cfg = BOT_V2_DEFAULT_CONFIG;
  botAssertEq(botProfile(botMkEntry("A", { ind: { vol:  5 } }), cfg, {}, 10000, 10000).stopPct,  5);
  botAssertEq(botProfile(botMkEntry("B", { ind: { vol: 80 } }), cfg, {}, 10000, 10000).stopPct, 20);
});

botTest("botProfile: RR croît avec le score", () => {
  const cfg = BOT_V2_DEFAULT_CONFIG;
  const lo = botProfile(botMkEntry("A", { score: 60 }), cfg, {}, 10000, 10000);
  const hi = botProfile(botMkEntry("B", { score: 95 }), cfg, {}, 10000, 10000);
  botAssert(hi.rr > lo.rr, "RR devrait croître avec le score");
});

botTest("botProfile: +0,3 tendance haussière confirmée", () => {
  const cfg = BOT_V2_DEFAULT_CONFIG;
  const trend = botProfile(botMkEntry("A", { ind: { price: 100, sma50:  95, sma200:  90 } }), cfg, {}, 10000, 10000);
  const flat  = botProfile(botMkEntry("B", { ind: { price: 100, sma50: 100, sma200: 100 } }), cfg, {}, 10000, 10000);
  botAssertClose(trend.rr - flat.rr, 0.3, 1e-9, "la tendance devrait ajouter 0,3 au RR");
});

botTest("botProfile: −0,3 en haut de range", () => {
  const cfg = BOT_V2_DEFAULT_CONFIG;
  const top = botProfile(botMkEntry("A", { ind: { rangePos: 0.95 } }), cfg, {}, 10000, 10000);
  const mid = botProfile(botMkEntry("B", { ind: { rangePos: 0.5 } }), cfg, {}, 10000, 10000);
  botAssertClose(mid.rr - top.rr, 0.3, 1e-9, "le haut de range devrait retirer 0,3 au RR");
});

botTest("botProfile: risque € constant quelle que soit la volatilité", () => {
  const cfg = { ...BOT_V2_DEFAULT_CONFIG, maxPositionPct: 100, maxMarketPct: 100 };
  const calm = botProfile(botMkEntry("A", { ind: { vol: 15 } }), cfg, {}, 100000, 100000);
  const wild = botProfile(botMkEntry("B", { ind: { vol: 45 } }), cfg, {}, 100000, 100000);
  const riskCalm = calm.amount * calm.stopPct / 100;
  const riskWild = wild.amount * wild.stopPct / 100;
  botAssertClose(riskCalm, riskWild, riskCalm * 0.02, "le risque € doit être identique");
});

botTest("botProfile: plafond par position", () => {
  const cfg = BOT_V2_DEFAULT_CONFIG; // maxPositionPct 15 %
  const p = botProfile(botMkEntry("A", { score: 95, ind: { vol: 10 } }), cfg, {}, 100000, 100000);
  botAssert(p.amount <= 100000 * 0.15 + 1e-6, "montant plafonné à 15 % du portefeuille");
});

botTest("botProfile: plafond par marché", () => {
  const cfg = BOT_V2_DEFAULT_CONFIG; // maxMarketPct 60 % → 55 % déjà pris ⇒ reste 5 %
  const p = botProfile(botMkEntry("AAPL"), cfg, {}, 100000, 100000, 55000);
  botAssert(p.amount <= 5000 + 1e-6, "montant plafonné par la marge marché restante");
});

botTest("botProfile: horizon par bucket de volatilité", () => {
  const cfg = BOT_V2_DEFAULT_CONFIG;
  botAssertEq(botProfile(botMkEntry("A", { ind: { vol: 10 } }), cfg, {}, 1e5, 1e5).horizonDays, 60);
  botAssertEq(botProfile(botMkEntry("B", { ind: { vol: 30 } }), cfg, {}, 1e5, 1e5).horizonDays, 45);
  botAssertEq(botProfile(botMkEntry("C", { ind: { vol: 60 } }), cfg, {}, 1e5, 1e5).horizonDays, 30);
});

botTest("botProfile: l'apprentissage est appliqué", () => {
  const cfg = BOT_V2_DEFAULT_CONFIG;
  const neutral = botProfile(botMkEntry("A", { ind: { vol: 30 } }), cfg, {}, 1e5, 1e5);
  const learn = { "US:moyenne": { stopMult: 1.3, rrMult: 0.8, qualityAdj: 0 } };
  const learned = botProfile(botMkEntry("A", { ind: { vol: 30 } }), cfg, learn, 1e5, 1e5);
  botAssert(learned.stopPct > neutral.stopPct, "stopMult devrait élargir le stop");
  botAssert(learned.rr < neutral.rr, "rrMult devrait réduire le RR");
});

/* ============================= BOT V2 — ÉTAT + MIGRATION =============================
 * Des bots v1 tournent déjà : la migration doit être sans perte. Les champs absents
 * sont complétés, `ticketPct` (v1) est abandonné au profit du dimensionnement par le risque.
 * ==================================================================================== */

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

// Retourne un état v2 valide à partir d'un état brut (v1, v2, null ou corrompu).
function botMigrateV1(raw) {
  const cfg = { ...BOT_V2_DEFAULT_CONFIG, ...((raw && raw.config) || {}) };
  delete cfg.ticketPct;  // v1 : remplacé par riskPerTradePct
  const b = {
    started:   !!(raw && raw.started),
    startDate: (raw && raw.startDate) || null,
    cash:      (raw && isFinite(raw.cash)) ? raw.cash : cfg.capital,
    positions: Array.isArray(raw && raw.positions) ? raw.positions : [],
    history:   Array.isArray(raw && raw.history)   ? raw.history   : [],
    log:       Array.isArray(raw && raw.log)       ? raw.log       : [],
    equity:    Array.isArray(raw && raw.equity)    ? raw.equity    : [],
    learn:     (raw && raw.learn && typeof raw.learn === "object") ? raw.learn : {},
    config:    cfg,
  };
  // Positions v1 → complétées avec les champs v2.
  b.positions = b.positions.map(p => {
    const market = p.market || botMarketOf(p.ticker);
    const volBucket = p.volBucket || (p.family ? String(p.family).split(":")[1] : null) || "moyenne";
    const family = p.family || `${market}:${volBucket}`;
    const stopPct = isFinite(p.stopPct) ? p.stopPct : 10;
    return {
      ticker: p.ticker, market, family,
      entryDate: p.entryDate, entryPrice: p.entryPrice, qty: p.qty,
      stopPct,
      trailPct:  isFinite(p.trailPct)  ? p.trailPct  : 0.8 * stopPct,
      targetPct: isFinite(p.targetPct) ? p.targetPct : stopPct * 2,
      stopLevel: isFinite(p.stopLevel) ? p.stopLevel : p.entryPrice * (1 - stopPct / 100),
      highest:   isFinite(p.highest)   ? p.highest   : p.entryPrice,
      horizonDays: isFinite(p.horizonDays) ? p.horizonDays : botHorizonDays(volBucket),
      scaledOut: !!p.scaledOut,
      entryScore: isFinite(p.entryScore) ? p.entryScore : null,
    };
  });
  // Historique v1 : famille déduite du ticker (le bucket exact est perdu, « moyenne » par défaut).
  b.history = b.history.map(h => h.family ? h : { ...h, family: `${botMarketOf(h.ticker)}:moyenne` });
  return b;
}

let bot = botMigrateV1(lsGet(LS.bot, null));
function saveBot() { lsSet(LS.bot, bot); }

// Journal des décisions : 150 entrées, les plus récentes en tête.
// kind ∈ achat | vente | partiel | ignoré | info
function botLog(kind, ticker, msg) {
  bot.log.unshift({ ts: new Date().toISOString(), kind, ticker, msg });
  if (bot.log.length > 150) bot.log = bot.log.slice(0, 150);
}

/* ============================= BOT V2 — APPRENTISSAGE =============================
 * Le bot corrige ses réglages famille par famille (`marché:volatilité`, 9 au plus)
 * à partir de ses propres trades. Les statistiques sont TOUJOURS recalculées depuis
 * bot.history, jamais accumulées : pas de dérive silencieuse, et vider l'historique
 * remet l'apprentissage à neutre tout seul.
 * ============================================================================== */

function botClampMult(x) { return clamp(x, 0.70, 1.30); }
function botClampQAdj(x) { return clamp(x, 0, 15); }
// Déplace `from` d'au plus 10 % de l'écart vers `target` : impossible de partir
// en vrille sur une série chanceuse.
function botSmooth(from, target) { return from + (target - from) * 0.10; }

function botComputeLearning(history, cfg, previous = {}) {
  // Apprentissage désactivé : tout est neutre, mais les statistiques restent affichées.
  if (!cfg.learnEnabled) {
    const neutre = {};
    for (const k of Object.keys(previous)) neutre[k] = { ...previous[k], stopMult: 1, rrMult: 1, qualityAdj: 0 };
    return neutre;
  }

  const parFamille = {};
  for (const h of history) {
    if (!h.family) continue;
    (parFamille[h.family] = parFamille[h.family] || []).push(h);
  }

  const out = { ...previous };
  for (const [family, trades] of Object.entries(parFamille)) {
    const n = trades.length;
    const gagnants = trades.filter(t => t.pnl > 0);
    const perdants = trades.filter(t => t.pnl <= 0);
    const stops    = trades.filter(t => t.reason === "stop-loss");
    const winRate  = gagnants.length / n;
    const stopRate = stops.length / n;
    const avgWin   = gagnants.length ? gagnants.reduce((s, t) => s + t.pnl, 0) / gagnants.length : 0;
    const avgLoss  = perdants.length ? Math.abs(perdants.reduce((s, t) => s + t.pnl, 0) / perdants.length) : 0;
    const avgPnl   = trades.reduce((s, t) => s + t.pnl, 0) / n;

    const prec = previous[family] || { stopMult: 1, rrMult: 1, qualityAdj: 0 };
    let { stopMult, rrMult, qualityAdj } = prec;

    // Sous le seuil de trades, la famille reste neutre : on n'apprend pas du bruit.
    if (n >= cfg.learnMinTrades) {
      // Trop de stops touchés → on sort sur du bruit, il faut élargir. Trop peu → stop inutilement large.
      if      (stopRate > 0.45) stopMult = botSmooth(stopMult, 1.30);
      else if (stopRate < 0.15) stopMult = botSmooth(stopMult, 0.70);
      else                      stopMult = botSmooth(stopMult, 1.00);

      // Souvent gagnant mais petits gains → on coupe trop tôt. Rarement gagnant mais gros gains → cible inatteignable.
      if      (winRate > 0.60 && avgWin < avgLoss)     rrMult = botSmooth(rrMult, 1.30);
      else if (winRate < 0.40 && avgWin > 2 * avgLoss) rrMult = botSmooth(rrMult, 0.70);
      else                                             rrMult = botSmooth(rrMult, 1.00);

      // Famille qui perd de l'argent → on y devient plus exigeant à l'achat.
      if      (n >= 15 && avgPnl < 0) qualityAdj = botClampQAdj(qualityAdj + 5);
      else if (n >= 15 && avgPnl > 0) qualityAdj = botClampQAdj(qualityAdj - 5);
    }

    out[family] = {
      stopMult: botClampMult(stopMult), rrMult: botClampMult(rrMult), qualityAdj,
      n, winRate, stopRate, avgWin, avgLoss, avgPnl,
      updatedAt: new Date().toISOString(),
    };
  }
  return out;
}

// Correctif de seuil de qualité appliqué à un candidat (familles perdantes = plus exigeantes).
function botQualityAdjFor(ticker, ind, learn) {
  const vol = (ind && ind.vol != null && isFinite(ind.vol)) ? ind.vol : 30;
  const fam = learn[`${botMarketOf(ticker)}:${botVolBucket(vol)}`];
  return (fam && fam.qualityAdj) || 0;
}

/* ============================= BOT V2 — STATISTIQUES ============================= */

// Un point de capital par jour : le dernier de la journée écrase le précédent.
function botRecordEquity() {
  const today = new Date().toISOString().slice(0, 10);
  const value = botPortfolioValue();
  const dernier = bot.equity[bot.equity.length - 1];
  if (dernier && dernier.date === today) dernier.value = value;
  else bot.equity.push({ date: today, value });
  if (bot.equity.length > 400) bot.equity = bot.equity.slice(-400);
}

// Statistiques de performance — fonction pure sur l'historique et la courbe de capital.
function botStats(history, equity) {
  const n = history.length;
  const gagnants = history.filter(h => h.pnl > 0);
  const perdants = history.filter(h => h.pnl <= 0);
  const sommeGains  = gagnants.reduce((s, h) => s + h.pnl, 0);
  const sommePertes = Math.abs(perdants.reduce((s, h) => s + h.pnl, 0));

  const winRate      = n ? gagnants.length / n : 0;
  const profitFactor = sommePertes > 0 ? sommeGains / sommePertes : (sommeGains > 0 ? Infinity : 0);
  const avgWin       = gagnants.length ? sommeGains / gagnants.length : 0;
  const avgLoss      = perdants.length ? sommePertes / perdants.length : 0;
  const expectancy   = n ? (sommeGains - sommePertes) / n : 0;

  const premier = equity[0], dernier = equity[equity.length - 1];
  const totalPct = (premier && dernier && premier.value > 0) ? (dernier.value / premier.value - 1) * 100 : 0;

  // Drawdown maximum : pire repli depuis un sommet de la courbe.
  let sommet = -Infinity, pire = 0;
  for (const p of equity) {
    if (p.value > sommet) sommet = p.value;
    if (sommet > 0) pire = Math.max(pire, (sommet - p.value) / sommet);
  }

  const grouper = (cle) => {
    const g = {};
    for (const h of history) {
      const k = cle(h);
      if (!k) continue;
      g[k] = g[k] || { n: 0, pnl: 0, gagnants: 0 };
      g[k].n++; g[k].pnl += h.pnl; if (h.pnl > 0) g[k].gagnants++;
    }
    return g;
  };

  return {
    n, totalPct, drawdownPct: pire * 100, winRate, profitFactor, avgWin, avgLoss, expectancy,
    byMarket: grouper(h => h.family ? String(h.family).split(":")[0] : null),
    byFamily: grouper(h => h.family),
    byReason: grouper(h => h.reason),
  };
}

/* ============================= BOT V2 — MOTEUR ============================= */

// Valeur totale du portefeuille virtuel (cash + positions au cours courant).
function botPortfolioValue() {
  let v = bot.cash;
  for (const pos of bot.positions) {
    const e = cache[pos.ticker] || marketCache[pos.ticker];
    const price = (e && e.ind && e.ind.price > 0) ? e.ind.price : pos.entryPrice;
    v += pos.qty * price;
  }
  return v;
}

// Vente manuelle immédiate au cours courant.
function botSellManual(ticker) {
  const idx = bot.positions.findIndex(p => p.ticker === ticker);
  if (idx < 0) return;
  const pos = bot.positions[idx];
  const e = cache[ticker] || marketCache[ticker];
  const price = (e && e.ind && e.ind.price > 0) ? e.ind.price : pos.entryPrice;
  const { cashIn, net } = botApplyExitProceeds(price, pos.qty, bot.config);
  bot.cash += cashIn;
  bot.history.unshift({ ticker, family: pos.family, entryDate: pos.entryDate, entryPrice: pos.entryPrice,
    exitDate: new Date().toISOString().slice(0, 10), exitPrice: price, qty: pos.qty,
    pnl: cashIn - pos.entryPrice * pos.qty, pnlPct: (net / pos.entryPrice - 1) * 100, reason: "manuelle" });
  botLog("vente", ticker, `VENTE MANUELLE ${ticker} à ${fnum(price)}, ${fpct((net / pos.entryPrice - 1) * 100)} net de frais.`);
  bot.positions.splice(idx, 1);
  saveBot();
  if (typeof renderBot === "function") renderBot();
}

/* Applique un cours à une position et décide d'une éventuelle sortie.
 * Fonction pure : renvoie une copie mise à jour, ne touche pas à `pos`.
 *
 * Le stop suiveur ne s'arme qu'une fois le gain latent supérieur au risque initial
 * (avant cela, le stop reste fixe à l'entrée). Une fois armé, il ne redescend jamais. */
function botApplyTick(pos, price, dateStr) {
  const p = { ...pos };
  if (!isFinite(price) || price <= 0) return { updated: p, exit: null };

  if (price > p.highest) p.highest = price;

  const initialStop = pos.entryPrice * (1 - pos.stopPct / 100);
  const gainLatent = (p.highest - pos.entryPrice) / pos.entryPrice;
  if (gainLatent >= pos.stopPct / 100) {
    const trail = p.highest * (1 - pos.trailPct / 100);
    if (trail > p.stopLevel) p.stopLevel = trail;   // monotone croissant
  }

  if (price <= p.stopLevel) {
    const reason = p.stopLevel > initialStop + 1e-9 ? "stop suiveur" : "stop-loss";
    return { updated: p, exit: { price, date: dateStr, reason } };
  }
  if (price >= pos.entryPrice * (1 + pos.targetPct / 100)) {
    // La cible ne solde plus la position : on encaisse la moitié et on laisse
    // courir le reste sous stop suiveur. Une seule prise partielle par position.
    if (!pos.scaledOut) {
      return { updated: p, exit: { price, date: dateStr, reason: "prise partielle", partial: true } };
    }
    return { updated: p, exit: null };
  }
  return { updated: p, exit: null };
}

// Âge d'une position en jours calendaires.
function botAgeDays(entryDate, now = Date.now()) {
  return (now - new Date(entryDate).getTime()) / 86400000;
}

/* Frais et slippage — appliqués à l'entrée ET à la sortie.
 * Les trades déjà présents dans bot.history ne sont pas réécrits : leurs
 * chiffres restent ceux du moment où ils ont été enregistrés. */

// Achat : on paie un peu plus cher que l'affiché (slippage) et on règle la commission.
function botApplyEntryCost(price, amount, cfg) {
  const filled = price * (1 + cfg.slipPct / 100);
  const cashOut = amount * (1 + cfg.feePct / 100);
  return { filled, cashOut, qty: amount / filled };
}

// Vente : on reçoit un peu moins que l'affiché, commission déduite du produit.
function botApplyExitProceeds(price, qty, cfg) {
  const filled = price * (1 - cfg.slipPct / 100);
  const cashIn = filled * qty * (1 - cfg.feePct / 100);
  return { filled, cashIn, net: qty > 0 ? cashIn / qty : 0 };
}

/* Compte rendu d'une évaluation, en une phrase — fonction pure.
 * Sans cela, une évaluation qui ne fait rien (marché fermé, pas de scan, aucun
 * candidat au niveau) est indiscernable d'un bouton cassé. */
function botSummarizeRun(res) {
  const actions = [];
  if (res.achats)   actions.push(`${res.achats} achat${res.achats > 1 ? "s" : ""}`);
  if (res.ventes)   actions.push(`${res.ventes} vente${res.ventes > 1 ? "s" : ""}`);
  if (res.partiels) actions.push(`${res.partiels} prise${res.partiels > 1 ? "s" : ""} partielle${res.partiels > 1 ? "s" : ""}`);
  if (actions.length) return `Évaluation terminée : ${actions.join(", ")}.`;

  if (!res.marchesOuverts.length) {
    return "Hors séance : aucun marché ouvert, le bot n'achète pas. Positions mises à jour sur les dernières clôtures.";
  }
  if (!res.candidats) {
    return "Aucun titre en cache : lancez d'abord un scan du marché (onglet Marché).";
  }
  if (res.retenus === 0) {
    return `Aucun titre n'atteint le score d'achat minimum (${bot.config.qualityMin}) parmi les ${res.candidats} titres scannés.`;
  }
  if (res.refus.length) return res.refus[0];
  return "Évaluation terminée : rien à faire.";
}

let botRunning = false;  // garde de réentrance : un seul runBot() à la fois

// Moteur : rafraîchit les positions, applique les sorties, puis achète sur les marchés ouverts.
async function runBot() {
  if (!bot.started || botRunning) return null;
  botRunning = true;
  const bilan = { achats: 0, ventes: 0, partiels: 0, refus: [], candidats: 0, retenus: 0, marchesOuverts: [] };
  try {
    const cfg = bot.config;
    const today = new Date().toISOString().slice(0, 10);
    const openMarkets = botOpenMarkets();

    // Recalcul complet de l'apprentissage depuis l'historique, avant toute décision.
    bot.learn = botComputeLearning(bot.history, cfg, bot.learn);

    // Les refus ne sont journalisés qu'une fois par cause et par évaluation :
    // sinon la boucle de 15 min noierait le journal.
    const refusJournalises = new Set();
    const refuser = (cause) => {
      if (refusJournalises.has(cause)) return;
      refusJournalises.add(cause);
      bilan.refus.push(cause);
      botLog("ignoré", null, cause);
    };
    bilan.marchesOuverts = [...openMarkets];

    if (openMarkets.size === 0) botLog("info", null, "Hors séance — rattrapage des clôtures seulement, aucun achat.");

    // a) rafraîchir les positions détenues (best-effort : une panne n'interrompt pas l'évaluation)
    for (const pos of bot.positions) {
      const e = cache[pos.ticker] || marketCache[pos.ticker];
      if (!e || isStale(e)) {
        try { await analyzeTicker(pos.ticker, null, { silent: true, skipRender: true, store: cache[pos.ticker] ? cache : marketCache }); }
        catch (_) { /* on évalue avec ce qu'on a */ }
      }
    }

    // b) sorties
    const stillOpen = [];
    for (const pos of bot.positions) {
      const e = cache[pos.ticker] || marketCache[pos.ticker];
      const livePrice = (e && e.ind && isFinite(e.ind.price) && e.ind.price > 0) ? e.ind.price : null;
      let cur = { ...pos };
      let exit = null;

      // Horizon : une position dormante immobilise du capital, on la libère.
      if (botAgeDays(pos.entryDate) > pos.horizonDays) {
        exit = { price: livePrice != null ? livePrice : pos.entryPrice, date: today, reason: "horizon" };
      }

      // Rejeu des clôtures postérieures à l'achat : le stop suiveur monte jour après jour,
      // et la sortie est datée du jour exact du franchissement.
      if (!exit && e && e.hist && Array.isArray(e.hist.closes) && Array.isArray(e.hist.dates)) {
        const { dates, closes } = e.hist;  // du plus récent au plus ancien → parcours à l'envers
        for (let i = dates.length - 1; i >= 0; i--) {
          if (dates[i] <= pos.entryDate) continue;
          const c = closes[i];
          if (c == null || !isFinite(c)) continue;
          const r = botApplyTick(cur, c, dates[i]);
          cur = r.updated;
          if (r.exit) { exit = r.exit; break; }
        }
      }

      // En direct : seulement si le marché du titre est ouvert (pas de vente sur un prix périmé).
      if (!exit && livePrice != null && openMarkets.has(cur.market)) {
        const r = botApplyTick(cur, livePrice, today);
        cur = r.updated;
        if (r.exit) exit = r.exit;
      }

      // Réévaluation par le score : indépendante des sessions (le score ne périme pas comme un cours).
      if (!exit && e && e.ind) {
        const g = e.score != null ? computeGlobalScore(e) : null;
        if ((g != null && g <= cfg.exitScore) || e.signal === "Vente") {
          exit = { price: e.ind.price, date: today, reason: "réévaluation" };
        }
      }

      if (exit && isFinite(exit.price) && exit.price > 0) {
        // Prise partielle : on vend la moitié, le reliquat reste ouvert sous stop suiveur.
        const soldQty = exit.partial ? cur.qty / 2 : cur.qty;
        const { cashIn, net } = botApplyExitProceeds(exit.price, soldQty, cfg);
        bot.cash += cashIn;
        bot.history.unshift({ ticker: cur.ticker, family: cur.family, entryDate: cur.entryDate, entryPrice: cur.entryPrice,
          exitDate: exit.date, exitPrice: exit.price, qty: soldQty,
          pnl: cashIn - cur.entryPrice * soldQty,            // net de frais et de slippage
          pnlPct: (net / cur.entryPrice - 1) * 100, reason: exit.reason });

        const pctNet = (net / cur.entryPrice - 1) * 100;
        if (exit.partial) {
          cur.qty -= soldQty;
          cur.scaledOut = true;
          botLog("partiel", cur.ticker, `PARTIEL ${cur.ticker} — cible ${fpct(cur.targetPct)} atteinte, `
            + `50 % vendus à ${fnum(exit.price)}, stop suiveur à ${fnum(cur.stopLevel)}.`);
          bilan.partiels++;
          stillOpen.push(cur);
        } else {
          botLog("vente", cur.ticker, `VENTE ${cur.ticker} — ${exit.reason} à ${fnum(exit.price)}, `
            + `${fpct(pctNet)} net de frais.`);
          bilan.ventes++;
        }
      } else {
        stillOpen.push(cur);
      }
    }
    bot.positions = stillOpen;

    // c) entrées : uniquement sur les marchés ouverts, dimensionnées par le risque.
    const held = new Set(bot.positions.map(p => p.ticker));
    const exposureByMarket = {};
    for (const pos of bot.positions) {
      const e = cache[pos.ticker] || marketCache[pos.ticker];
      const price = (e && e.ind && e.ind.price > 0) ? e.ind.price : pos.entryPrice;
      exposureByMarket[pos.market] = (exposureByMarket[pos.market] || 0) + pos.qty * price;
    }
    const portfolioValue = botPortfolioValue();

    const enCache = Object.keys(marketCache).map(t => ({ t, e: marketCache[t] }))
      .filter(x => x.e && x.e.ind && x.e.ind.price > 0 && x.e.score != null);
    bilan.candidats = enCache.length;

    const candidates = enCache
      .filter(x => !held.has(x.t) && computeGlobalScore(x.e) >= cfg.qualityMin)
      .sort((a, b) => computeGlobalScore(b.e) - computeGlobalScore(a.e));
    bilan.retenus = candidates.length;

    if (!bilan.candidats) botLog("info", null, "Aucun titre en cache — lancez un scan du marché pour donner des candidats au bot.");
    else if (!bilan.retenus && openMarkets.size) {
      botLog("info", null, `Aucun des ${bilan.candidats} titres scannés n'atteint le score d'achat minimum (${cfg.qualityMin}).`);
    }

    for (const cand of candidates) {
      const market = botMarketOf(cand.t);
      if (!openMarkets.has(market)) { refuser(`Marché ${market} fermé — achats suspendus.`); continue; }

      // Seuil de qualité relevé sur les familles qui perdent de l'argent.
      const qAdj = botQualityAdjFor(cand.t, cand.e.ind, bot.learn);
      if (qAdj > 0 && computeGlobalScore(cand.e) < cfg.qualityMin + qAdj) {
        refuser(`Famille ${market} en perte — seuil de qualité relevé de ${qAdj} points.`);
        continue;
      }

      const marketExp = exposureByMarket[market] || 0;
      const prof = botProfile({ ticker: cand.t, ...cand.e }, cfg, bot.learn, portfolioValue, bot.cash, marketExp);
      if (prof.amount < 1) {
        const plafondMarche = portfolioValue * (cfg.maxMarketPct / 100);
        if (marketExp >= plafondMarche - 1) refuser(`Plafond marché ${market} atteint (${cfg.maxMarketPct} %).`);
        else refuser("Cash insuffisant pour ouvrir une nouvelle position.");
        continue;
      }
      const { filled, cashOut, qty } = botApplyEntryCost(cand.e.ind.price, prof.amount, cfg);
      if (cashOut > bot.cash) { refuser("Cash insuffisant pour ouvrir une nouvelle position."); continue; }
      bot.cash -= cashOut;
      bot.positions.push({
        ticker: cand.t, market: prof.market, family: prof.family,
        entryDate: today, entryPrice: filled, qty,
        stopPct: prof.stopPct, trailPct: prof.trailPct, targetPct: prof.targetPct,
        stopLevel: filled * (1 - prof.stopPct / 100),
        highest: filled,
        horizonDays: prof.horizonDays,
        scaledOut: false,
        entryScore: computeGlobalScore(cand.e),
      });
      exposureByMarket[market] = marketExp + prof.amount;
      held.add(cand.t);
      botLog("achat", cand.t, `ACHAT ${cand.t} — ${prof.why}`);
      bilan.achats++;
    }

    if (bot.history.length > 200) bot.history = bot.history.slice(0, 200);
    botRecordEquity();
    saveBot();
    if (typeof renderBot === "function") renderBot();
    return bilan;
  } finally {
    botRunning = false;
  }
}

function botStart() {
  bot.started = true; bot.startDate = new Date().toISOString();
  bot.cash = bot.config.capital;
  bot.positions = []; bot.history = []; bot.log = []; bot.equity = []; bot.learn = {};
  botRecordEquity();   // point de départ de la courbe de capital
  saveBot();
  if (typeof renderBot === "function") renderBot();
  runBot().finally(() => { if (typeof botScheduleNext === "function") botScheduleNext(); });
}

function botReset() {
  if (!window.confirm("Réinitialiser le bot ? Positions, historique, journal et apprentissage seront effacés.")) return;
  if (typeof botStopTimer === "function") botStopTimer();
  bot.started = false; bot.startDate = null;
  bot.cash = bot.config.capital;
  bot.positions = []; bot.history = []; bot.log = []; bot.equity = []; bot.learn = {};
  saveBot();
  if (typeof renderBot === "function") renderBot();
}

/* ---------- tests : migration ---------- */

botTest("botMigrateV1: état null → v2 vide valide", () => {
  const b = botMigrateV1(null);
  botAssertEq(b.started, false);
  botAssertEq(b.positions.length, 0);
  botAssert(Array.isArray(b.log) && Array.isArray(b.equity), "log et equity créés");
  botAssert(b.learn && typeof b.learn === "object", "learn créé");
  botAssertEq(b.config.riskPerTradePct, 1);
});

botTest("botMigrateV1: état v1 → positions complétées, rien de perdu", () => {
  const v1 = {
    started: true, startDate: "2026-07-01", cash: 5000,
    positions: [{ ticker: "ASML.AS", entryDate: "2026-07-02", entryPrice: 800, qty: 5, stopPct: 12, targetPct: 24, entryScore: 78 }],
    history: [{ ticker: "MC.PA", entryDate: "2026-06-01", exitDate: "2026-06-10", entryPrice: 700, exitPrice: 720, qty: 10, pnl: 200, pnlPct: 2.86, reason: "prise de bénéfice" }],
    config: { capital: 10000, ticketPct: 0.1, qualityMin: 60 },
  };
  const b = botMigrateV1(v1);
  botAssertEq(b.positions.length, 1);
  botAssertEq(b.history.length, 1);
  const p = b.positions[0];
  botAssertEq(p.market, "EU");
  botAssertEq(p.family, "EU:moyenne");
  botAssertEq(p.trailPct, 0.8 * 12);
  botAssertEq(p.stopLevel, 800 * 0.88);
  botAssertEq(p.highest, 800);
  botAssertEq(p.scaledOut, false);
  botAssertEq(p.horizonDays, 45);
  botAssertEq(b.history[0].family, "EU:moyenne");
  botAssert(!("ticketPct" in b.config), "ticketPct doit disparaître");
  botAssertEq(b.config.riskPerTradePct, 1, "riskPerTradePct rempli par défaut");
  botAssertEq(b.config.qualityMin, 60, "réglage v1 conservé");
});

/* ---------- tests : stop suiveur et horizon ---------- */

// Position type : entrée 100, stop 10 %, suiveur 8 %, cible lointaine (on isole le suiveur).
function botMkPos(over = {}) {
  return { ticker: "X", market: "US", family: "US:moyenne", entryDate: "2026-01-01",
    entryPrice: 100, qty: 10, stopPct: 10, trailPct: 8, targetPct: 100,
    stopLevel: 90, highest: 100, horizonDays: 45, scaledOut: false, ...over };
}

botTest("botApplyTick: le stop suiveur ne redescend jamais", () => {
  let s = botApplyTick(botMkPos(), 120, "d1");
  botAssertEq(s.exit, null, "pas de sortie à 120");
  s = botApplyTick(s.updated, 130, "d2");
  botAssert(s.updated.stopLevel > 90, "le stop doit avoir monté");
  const atteint = s.updated.stopLevel;
  s = botApplyTick(s.updated, 125, "d3"); botAssertEq(s.updated.stopLevel, atteint, "stable en repli");
  s = botApplyTick(s.updated, 120, "d4"); botAssertEq(s.updated.stopLevel, atteint, "toujours stable");
});

botTest("botApplyTick: le suiveur ne s'arme qu'une fois le risque couvert", () => {
  // +5 % de gain latent < 10 % de risque → stop encore fixe à l'entrée
  const s = botApplyTick(botMkPos(), 105, "d1");
  botAssertEq(s.updated.stopLevel, 90, "le stop doit rester à son niveau initial");
});

botTest("botApplyTick: déclenchement au bon prix, raison « stop suiveur »", () => {
  let s = botApplyTick(botMkPos(), 130, "d1");
  botAssertClose(s.updated.stopLevel, 130 * 0.92, 1e-9, "suiveur à 8 % sous le plus haut");
  s = botApplyTick(s.updated, 118, "d2");
  botAssert(s.exit && s.exit.reason === "stop suiveur", "sortie « stop suiveur » attendue");
});

botTest("botApplyTick: chute directe → « stop-loss », pas « stop suiveur »", () => {
  const s = botApplyTick(botMkPos(), 85, "d1");
  botAssert(s.exit && s.exit.reason === "stop-loss", "le suiveur n'a jamais été armé");
});

botTest("botApplyTick: la cible déclenche une prise partielle", () => {
  const s = botApplyTick(botMkPos({ targetPct: 20 }), 125, "d1");
  botAssert(s.exit && s.exit.reason === "prise partielle", "la cible ne solde plus la position");
  botAssertEq(s.exit.partial, true);
});

botTest("botApplyTick: une seule prise partielle par position", () => {
  const s = botApplyTick(botMkPos({ targetPct: 20, scaledOut: true }), 130, "d1");
  botAssertEq(s.exit, null, "position déjà allégée : elle ne resort que sur le suiveur");
});

botTest("botApplyTick: après le partiel, le suiveur reste actif", () => {
  // scaledOut, plus haut à 130 → suiveur à 119,6 ; une chute à 118 doit sortir
  let s = botApplyTick(botMkPos({ targetPct: 20, scaledOut: true }), 130, "d1");
  botAssertClose(s.updated.stopLevel, 130 * 0.92, 1e-9);
  s = botApplyTick(s.updated, 118, "d2");
  botAssert(s.exit && s.exit.reason === "stop suiveur", "le reliquat sort sur le suiveur");
});

botTest("botApplyTick: prix invalide ignoré", () => {
  botAssertEq(botApplyTick(botMkPos(), 0, "d1").exit, null);
  botAssertEq(botApplyTick(botMkPos(), NaN, "d1").exit, null);
});

/* ---------- tests : apprentissage ---------- */

function botMkTrade(family, pnl, reason) {
  return { ticker: "X", family, entryDate: "2026-01-01", exitDate: "2026-01-10",
    entryPrice: 100, exitPrice: 100 + pnl / 10, qty: 10, pnl, pnlPct: pnl / 10, reason };
}

botTest("botComputeLearning: neutre sous le seuil de trades", () => {
  const h = Array.from({ length: 9 }, () => botMkTrade("US:moyenne", -10, "stop-loss"));
  const l = botComputeLearning(h, BOT_V2_DEFAULT_CONFIG, {});
  botAssertEq(l["US:moyenne"].stopMult, 1);
  botAssertEq(l["US:moyenne"].rrMult, 1);
  botAssertEq(l["US:moyenne"].qualityAdj, 0);
  botAssertEq(l["US:moyenne"].n, 9, "les stats restent calculées");
});

botTest("botComputeLearning: > 45 % de stops élargit le stop", () => {
  const h = [];
  for (let i = 0; i < 6; i++) h.push(botMkTrade("US:forte", -5, "stop-loss"));
  for (let i = 0; i < 4; i++) h.push(botMkTrade("US:forte",  8, "prise partielle"));
  const l = botComputeLearning(h, BOT_V2_DEFAULT_CONFIG, {});
  botAssert(l["US:forte"].stopMult > 1, "le stop doit s'élargir (on sort sur du bruit)");
});

botTest("botComputeLearning: < 15 % de stops resserre le stop", () => {
  const h = [];
  h.push(botMkTrade("EU:faible", -5, "stop-loss"));
  for (let i = 0; i < 19; i++) h.push(botMkTrade("EU:faible", 6, "prise partielle"));
  const l = botComputeLearning(h, BOT_V2_DEFAULT_CONFIG, {});
  botAssert(l["EU:faible"].stopMult < 1, "un stop jamais touché est inutilement large");
});

botTest("botComputeLearning: multiplicateurs bornés [0,70 ; 1,30]", () => {
  const h = Array.from({ length: 20 }, () => botMkTrade("US:forte", -5, "stop-loss"));
  let l = { "US:forte": { stopMult: 1, rrMult: 1, qualityAdj: 0 } };
  for (let i = 0; i < 200; i++) l = botComputeLearning(h, BOT_V2_DEFAULT_CONFIG, l);
  botAssert(l["US:forte"].stopMult <= 1.30 + 1e-9, "stopMult borné en haut");
  botAssert(l["US:forte"].stopMult >= 0.70 - 1e-9, "stopMult borné en bas");
  botAssert(l["US:forte"].rrMult   <= 1.30 + 1e-9 && l["US:forte"].rrMult >= 0.70 - 1e-9, "rrMult borné");
});

botTest("botComputeLearning: lissage de 10 % par passe au plus", () => {
  const h = Array.from({ length: 20 }, () => botMkTrade("US:forte", -5, "stop-loss"));
  const prec = { "US:forte": { stopMult: 1.0, rrMult: 1.0, qualityAdj: 0 } };
  const l = botComputeLearning(h, BOT_V2_DEFAULT_CONFIG, prec);
  // cible 1,30 depuis 1,00 → au plus 1,00 + 0,10 × 0,30 = 1,03
  botAssertClose(l["US:forte"].stopMult, 1.03, 1e-9, "un seul pas de lissage");
});

botTest("botComputeLearning: qualityAdj borné [0 ; 15]", () => {
  const perdante = Array.from({ length: 20 }, () => botMkTrade("EU:moyenne", -10, "réévaluation"));
  let l = {};
  for (let i = 0; i < 10; i++) l = botComputeLearning(perdante, BOT_V2_DEFAULT_CONFIG, l);
  botAssertEq(l["EU:moyenne"].qualityAdj, 15, "plafonné à +15");

  const gagnante = Array.from({ length: 20 }, () => botMkTrade("EU:moyenne", 10, "prise partielle"));
  for (let i = 0; i < 10; i++) l = botComputeLearning(gagnante, BOT_V2_DEFAULT_CONFIG, l);
  botAssertEq(l["EU:moyenne"].qualityAdj, 0, "revient à 0, jamais négatif");
});

botTest("botComputeLearning: learnEnabled=false neutralise tout", () => {
  const h = Array.from({ length: 20 }, () => botMkTrade("US:forte", -5, "stop-loss"));
  const cfg = { ...BOT_V2_DEFAULT_CONFIG, learnEnabled: false };
  const l = botComputeLearning(h, cfg, { "US:forte": { stopMult: 1.2, rrMult: 0.8, qualityAdj: 5, n: 20 } });
  botAssertEq(l["US:forte"].stopMult, 1);
  botAssertEq(l["US:forte"].rrMult, 1);
  botAssertEq(l["US:forte"].qualityAdj, 0);
  botAssertEq(l["US:forte"].n, 20, "les stats restent affichées");
});

botTest("botComputeLearning: historique vidé → apprentissage neutre", () => {
  const l = botComputeLearning([], BOT_V2_DEFAULT_CONFIG, {});
  botAssertEq(Object.keys(l).length, 0, "aucune famille sans trade");
});

botTest("botQualityAdjFor: correctif retrouvé par famille", () => {
  const learn = { "US:forte": { stopMult: 1, rrMult: 1, qualityAdj: 10 } };
  botAssertEq(botQualityAdjFor("AAPL", { vol: 55 }, learn), 10);
  botAssertEq(botQualityAdjFor("AAPL", { vol: 25 }, learn), 0, "autre bucket, pas de correctif");
  botAssertEq(botQualityAdjFor("MC.PA", { vol: 55 }, learn), 0, "autre marché, pas de correctif");
});

/* ---------- tests : compte rendu d'évaluation ---------- */

botTest("botSummarizeRun: annonce les achats et les ventes", () => {
  const m = botSummarizeRun({ achats: 2, ventes: 1, partiels: 0, refus: [], candidats: 12, marchesOuverts: ["EU"] });
  botAssert(m.includes("2 achat"), "doit annoncer les achats");
  botAssert(m.includes("1 vente"), "doit annoncer les ventes");
});

botTest("botSummarizeRun: explique le silence hors séance", () => {
  const m = botSummarizeRun({ achats: 0, ventes: 0, partiels: 0, refus: [], candidats: 12, marchesOuverts: [] });
  botAssert(/hors séance|aucun marché/i.test(m), `doit expliquer la fermeture — reçu : ${m}`);
});

botTest("botSummarizeRun: explique l'absence de scan marché", () => {
  const m = botSummarizeRun({ achats: 0, ventes: 0, partiels: 0, refus: [], candidats: 0, marchesOuverts: ["US"] });
  botAssert(/scan/i.test(m), `doit renvoyer vers le scan marché — reçu : ${m}`);
});

botTest("botSummarizeRun: reprend la cause de refus", () => {
  const m = botSummarizeRun({ achats: 0, ventes: 0, partiels: 0, refus: ["Cash insuffisant pour ouvrir une nouvelle position."], candidats: 5, marchesOuverts: ["US"] });
  botAssert(/cash insuffisant/i.test(m), `doit citer la cause — reçu : ${m}`);
});

botTest("botSummarizeRun: aucun candidat au niveau requis", () => {
  const m = botSummarizeRun({ achats: 0, ventes: 0, partiels: 0, refus: [], candidats: 8, marchesOuverts: ["US"], retenus: 0 });
  botAssert(/score|qualité|niveau/i.test(m), `doit expliquer le seuil de qualité — reçu : ${m}`);
});

/* ---------- tests : statistiques ---------- */

botTest("botStats: drawdown maximum", () => {
  const eq = [{date:"d1",value:100},{date:"d2",value:120},{date:"d3",value:90},{date:"d4",value:110}];
  botAssertClose(botStats([], eq).drawdownPct, (120 - 90) / 120 * 100, 1e-9);
});

botTest("botStats: drawdown nul sur une courbe qui ne baisse jamais", () => {
  const eq = [{date:"d1",value:100},{date:"d2",value:110},{date:"d3",value:130}];
  botAssertEq(botStats([], eq).drawdownPct, 0);
});

botTest("botStats: profit factor", () => {
  const h = [botMkTrade("US:moyenne", 30, "prise partielle"), botMkTrade("US:moyenne", -10, "stop-loss")];
  botAssertClose(botStats(h, []).profitFactor, 3, 1e-9);
});

botTest("botStats: performance totale depuis la courbe", () => {
  const eq = [{date:"d1",value:10000},{date:"d2",value:11500}];
  botAssertClose(botStats([], eq).totalPct, 15, 1e-9);
});

botTest("botStats: espérance par trade", () => {
  const h = [botMkTrade("US:moyenne", 30, "prise partielle"), botMkTrade("US:moyenne", -10, "stop-loss")];
  botAssertClose(botStats(h, []).expectancy, 10, 1e-9);
});

botTest("botStats: groupements par marché, famille et raison", () => {
  const h = [
    botMkTrade("US:moyenne", 10, "prise partielle"),
    botMkTrade("EU:faible",  -5, "stop-loss"),
    botMkTrade("US:moyenne",  2, "réévaluation"),
  ];
  const s = botStats(h, []);
  botAssertEq(s.byMarket.US.n, 2);
  botAssertEq(s.byMarket.US.gagnants, 2);
  botAssertEq(s.byFamily["EU:faible"].n, 1);
  botAssertEq(s.byReason["stop-loss"].n, 1);
});

botTest("botStats: historique vide ne casse rien", () => {
  const s = botStats([], []);
  botAssertEq(s.n, 0);
  botAssertEq(s.totalPct, 0);
  botAssertEq(s.drawdownPct, 0);
  botAssertEq(s.winRate, 0);
});

/* ---------- tests : journal ---------- */

botTest("botLog: plafonné à 150 entrées, plus récent en tête", () => {
  const sauvegarde = bot.log;
  bot.log = [];
  for (let i = 0; i < 200; i++) botLog("info", null, `msg ${i}`);
  botAssertEq(bot.log.length, 150);
  botAssertEq(bot.log[0].msg, "msg 199", "le plus récent doit être en tête");
  botAssertEq(bot.log[149].msg, "msg 50", "les plus anciens sont écartés");
  bot.log = sauvegarde;
});

/* ---------- tests : frais et slippage ---------- */

botTest("frais/slippage: un aller-retour à prix constant est perdant", () => {
  const cfg = { ...BOT_V2_DEFAULT_CONFIG, feePct: 0.10, slipPct: 0.05 };
  const prix = 100, mise = 1000;
  const entree = botApplyEntryCost(prix, mise, cfg);
  const sortie = botApplyExitProceeds(prix, entree.qty, cfg);

  // Coût réel = ce qui sort de la poche moins ce qui y revient.
  // 2× slippage (0,05 %) + 2× frais (0,10 %) ≈ 0,30 % de 1000 € ≈ 3 €.
  const coutReel = entree.cashOut - sortie.cashIn;
  botAssert(coutReel > 0, "un aller-retour à prix inchangé doit coûter de l'argent");
  botAssertClose(coutReel, 3, 0.1, "coût total attendu ≈ 3 € sur 1000 €");

  // Le P&L historisé se mesure sur le prix d'entrée (slippage inclus, commission
  // d'entrée exclue — conformément au spec) : il montre donc ≈ 2 € de perte.
  const pnlHistorise = sortie.cashIn - entree.filled * entree.qty;
  botAssertClose(-pnlHistorise, 2, 0.1, "P&L historisé ≈ -2 € (hors commission d'entrée)");
});

botTest("frais/slippage: appliqués des deux côtés", () => {
  const cfg = { ...BOT_V2_DEFAULT_CONFIG, feePct: 0.10, slipPct: 0.05 };
  const e = botApplyEntryCost(100, 1000, cfg);
  botAssert(e.filled > 100, "on achète au-dessus du cours affiché (slippage)");
  botAssert(e.cashOut > 1000, "la commission s'ajoute à la mise");
  const s = botApplyExitProceeds(100, 10, cfg);
  botAssert(s.filled < 100, "on vend sous le cours affiché (slippage)");
  botAssert(s.cashIn < 1000, "la commission se déduit du produit");
});

botTest("botAgeDays: dépassement d'horizon détecté", () => {
  const vieux = new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10);
  botAssert(botAgeDays(vieux) > 60, "100 jours doivent dépasser tous les horizons");
  const recent = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
  botAssert(botAgeDays(recent) < 30, "5 jours ne dépassent aucun horizon");
});
