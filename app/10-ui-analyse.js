"use strict";

/* ============================================================================
   F4 · Analyse détaillée d'un titre.
   ============================================================================ */

/* ============================= ONGLET 4 : ANALYSE ============================= */

// Génère un texte de synthèse en français à partir des indicateurs en cache.
// Purement descriptif : ce n'est pas un conseil en investissement.
function buildAnalysisText(ticker, entry) {
  const { ind, score, signal } = entry;
  const parts = [];

  // Momentum / RSI
  if (ind.rsi !== null) {
    if (ind.rsi <= 30) {
      parts.push(`Le RSI 14 jours ressort à ${fmtNum.format(ind.rsi)}, en zone de survente (< 30) : le titre a subi une pression vendeuse marquée sur les dernières séances.`);
    } else if (ind.rsi >= 70) {
      parts.push(`Le RSI 14 jours ressort à ${fmtNum.format(ind.rsi)}, en zone de surachat (> 70) : le momentum haussier récent est fort, avec un risque accru de consolidation.`);
    } else {
      parts.push(`Le RSI 14 jours ressort à ${fmtNum.format(ind.rsi)}, en zone neutre (30–70) : pas d'excès de momentum notable.`);
    }
  }

  // Tendance / moyennes mobiles
  if (ind.sma50 !== null && ind.sma200 !== null) {
    if (ind.sma50 > ind.sma200) {
      parts.push(`Configuration de golden cross : la SMA 50 (${fnum(ind.sma50)}) évolue au-dessus de la SMA 200 (${fnum(ind.sma200)}), ce qui caractérise une tendance de fond haussière.`);
    } else {
      parts.push(`Configuration de death cross : la SMA 50 (${fnum(ind.sma50)}) évolue sous la SMA 200 (${fnum(ind.sma200)}), ce qui caractérise une tendance de fond baissière.`);
    }
    parts.push(`Le cours actuel (${fnum(ind.price)}) se situe ${ind.price >= ind.sma50 ? "au-dessus" : "en dessous"} de sa SMA 50 et ${ind.price >= ind.sma200 ? "au-dessus" : "en dessous"} de sa SMA 200.`);
  } else {
    parts.push(`Historique insuffisant pour calculer les deux moyennes mobiles (50 et 200 jours).`);
  }

  // Momentum court terme / MACD
  if (ind.macd) {
    parts.push(ind.macd.bullish
      ? `Le MACD (12/26/9) est positif par rapport à sa ligne de signal (écart ${fnum(ind.macd.hist)}) : la dynamique de court terme confirme le biais haussier.`
      : `Le MACD (12/26/9) est négatif par rapport à sa ligne de signal (écart ${fnum(ind.macd.hist)}) : la dynamique de court terme penche plutôt à la baisse.`);
  }

  // Position dans le range 52 semaines
  const posPct = Math.round(ind.rangePos * 100);
  parts.push(`Sur 52 semaines, le titre évolue entre ${fnum(ind.low52)} et ${fnum(ind.high52)} ; le cours actuel se situe à ${posPct} % de ce range (${posPct <= 25 ? "proche du plus bas annuel" : posPct >= 75 ? "proche du plus haut annuel" : "en milieu de range"}).`);

  // Performance multi-horizons
  const perfVals = [ind.perf.w1, ind.perf.m1, ind.perf.m3, ind.perf.m6, ind.perf.y1].filter(v => v !== null);
  if (perfVals.length) {
    const positives = perfVals.filter(v => v > 0).length;
    const trend = positives === perfVals.length ? "uniformément haussière sur toutes les périodes observées"
      : positives === 0 ? "uniformément baissière sur toutes les périodes observées"
      : "mixte selon l'horizon (détail ci-dessus)";
    parts.push(`Tendance de performance : ${trend}.`);
  }

  // Volatilité
  if (ind.vol !== null) {
    const volLabel = ind.vol < 20 ? "faible" : ind.vol < 40 ? "modérée" : "élevée";
    parts.push(`Volatilité annualisée (3 mois) : ${fmtNum.format(ind.vol)} % — niveau ${volLabel}.`
      + (ind.vol >= 40 ? " Amplitude de mouvement importante : à calibrer dans la taille de position et la gestion du risque." : ""));
  }

  // Bandes de Bollinger
  if (ind.bollinger) {
    const pb = ind.bollinger.percentB;
    if (pb <= 0.2) parts.push(`Bandes de Bollinger (20j) : le cours est proche ou sous la bande inférieure (%B = ${fmtNum.format(pb * 100)} %) — configuration de survente potentielle.`);
    else if (pb >= 0.8) parts.push(`Bandes de Bollinger (20j) : le cours est proche ou au-dessus de la bande supérieure (%B = ${fmtNum.format(pb * 100)} %) — configuration de surachat potentielle.`);
    else parts.push(`Bandes de Bollinger (20j) : le cours évolue dans la partie médiane du canal (%B = ${fmtNum.format(pb * 100)} %).`);
  }

  // Oscillateur stochastique
  if (ind.stochastic) {
    if (ind.stochastic.k <= 20) parts.push(`Oscillateur stochastique 14 jours : %K à ${fmtNum.format(ind.stochastic.k)} (zone de survente), signal potentiellement haussier à très court terme.`);
    else if (ind.stochastic.k >= 80) parts.push(`Oscillateur stochastique 14 jours : %K à ${fmtNum.format(ind.stochastic.k)} (zone de surachat), signal potentiellement baissier à très court terme.`);
    else parts.push(`Oscillateur stochastique 14 jours : %K à ${fmtNum.format(ind.stochastic.k)}, zone neutre.`);
  }

  // Convergence des signaux
  let bullishCount = 0, totalCount = 0;
  if (ind.rsi !== null) { totalCount++; if (ind.rsi <= 50) bullishCount++; }
  if (ind.sma50 !== null && ind.sma200 !== null) { totalCount++; if (ind.sma50 > ind.sma200) bullishCount++; }
  if (ind.macd) { totalCount++; if (ind.macd.bullish) bullishCount++; }
  totalCount++; if (ind.rangePos <= 0.5) bullishCount++;
  if (ind.bollinger) { totalCount++; if (ind.bollinger.percentB <= 0.5) bullishCount++; }
  if (ind.stochastic) { totalCount++; if (ind.stochastic.k <= 50) bullishCount++; }
  parts.push(`Convergence des signaux : ${bullishCount}/${totalCount} orientés haussiers, ${totalCount - bullishCount}/${totalCount} orientés baissiers.`);

  // Synthèse score
  parts.push(`Score d'opportunité technique : ${score}/100 → signal « ${signal} ». Ce score agrège mécaniquement RSI, croisement SMA 50/200 et position dans le range 52 semaines.`);

  return parts;
}

// Bloc de statistiques compact (volatilité, MACD, performances) affiché en tête de carte.
function buildAnalysisStatsHtml(ind) {
  const volLabel = ind.vol === null ? "—" : `${fmtNum.format(ind.vol)} %`;
  const macdLabel = ind.macd ? (ind.macd.bullish ? "Haussier" : "Baissier") : "—";
  const macdClass = ind.macd ? (ind.macd.bullish ? "up" : "down") : "";
  const bbLabel = ind.bollinger ? `${fmtNum.format(ind.bollinger.percentB * 100)} %` : "—";
  const bbClass = ind.bollinger ? (ind.bollinger.percentB <= 0.2 ? "up" : ind.bollinger.percentB >= 0.8 ? "down" : "") : "";
  const stoLabel = ind.stochastic ? fmtNum.format(ind.stochastic.k) : "—";
  const stoClass = ind.stochastic ? (ind.stochastic.k <= 20 ? "up" : ind.stochastic.k >= 80 ? "down" : "") : "";
  const items = [
    ["Volatilité (3M, ann.)", volLabel, ""],
    ["MACD 12/26/9", macdLabel, macdClass],
    ["Bollinger %B (20j)", bbLabel, bbClass],
    ["Stochastique %K (14j)", stoLabel, stoClass],
    ["Perf. 1 mois", fpct(ind.perf.m1), pctClass(ind.perf.m1)],
    ["Perf. 3 mois", fpct(ind.perf.m3), pctClass(ind.perf.m3)],
    ["Perf. 1 an", fpct(ind.perf.y1), pctClass(ind.perf.y1)],
  ];
  return `<dl class="impact-grid analysis-stats">`
    + items.map(([k, v, cls]) => `<div><dt>${esc(k)}</dt><dd class="${cls}">${esc(v)}</dd></div>`).join("")
    + `</dl>`;
}

// Capitalisation lisible : milliers de milliards (Bn), milliards (Md), millions (M).
function fmtMarketCap(v, currency) {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const cur = currency ? " " + currency : "";
  const abs = Math.abs(v);
  if (abs >= 1e12) return fmtNum.format(v / 1e12) + " Bn" + cur;   // billions (10^12)
  if (abs >= 1e9)  return fmtNum.format(v / 1e9) + " Md" + cur;    // milliards
  if (abs >= 1e6)  return fmtNum.format(v / 1e6) + " M" + cur;     // millions
  return fmtNum.format(v) + cur;
}

// Affiche une fraction (0.253) en pourcentage (25,3 %). null → "—".
function ffrac(v) { return v === null || v === undefined || !isFinite(v) ? "—" : fpct(v * 100); }

// Lecture qualitative de la soutenabilité du dividende à partir du taux de distribution.
// payout = fraction (0.45 = 45 %). Renvoie null si non calculable.
function dividendSustainability(payout) {
  if (payout == null || !isFinite(payout)) return null;
  if (payout < 0) return "tendu (bénéfices négatifs)";
  if (payout < 0.40) return "largement couvert, marge de croissance";
  if (payout < 0.60) return "confortable";
  if (payout < 0.80) return "à surveiller";
  return "tendu, potentiellement non soutenable";
}

// Bloc fondamental complet pour une carte d'analyse.
function buildFundamentalStatsHtml(entry) {
  const f = entry.fund, fs = entry.fundScore;
  if (!f || !fs) {
    return `<div class="fund-block"><p class="fund-unavailable">Données fondamentales indisponibles pour ce titre (ETF, indice, ou source momentanément inaccessible). L'analyse technique reste valable.</p></div>`;
  }
  const metrics = [
    ["Capitalisation", fmtMarketCap(f.marketCap, f.currency), ""],
    ["PER (12 m)", fnum(f.trailingPE), ""],
    ["PER prévisionnel", fnum(f.forwardPE), ""],
    ["PEG", fnum(f.pegRatio), ""],
    ["Price / Book", fnum(f.priceToBook), ""],
    ["EV / EBITDA", fnum(f.enterpriseToEbitda), ""],
    ["Marge nette", ffrac(f.profitMargins), pctClass(f.profitMargins)],
    ["Marge opér.", ffrac(f.operatingMargins), pctClass(f.operatingMargins)],
    ["ROE", ffrac(f.returnOnEquity), pctClass(f.returnOnEquity)],
    ["ROA", ffrac(f.returnOnAssets), pctClass(f.returnOnAssets)],
    ["Croissance CA", ffrac(f.revenueGrowth), pctClass(f.revenueGrowth)],
    ["Croissance bénéf.", ffrac(f.earningsGrowth), pctClass(f.earningsGrowth)],
    ["Dette / capitaux propres", f.debtToEquity === null ? "—" : fnum(f.debtToEquity / 100), ""],
    ["Ratio de liquidité", fnum(f.currentRatio), ""],
  ];
  const grid = `<dl class="impact-grid fund-metrics">`
    + metrics.map(([k, v, cls]) => `<div><dt>${esc(k)}</dt><dd class="${cls}">${esc(v)}</dd></div>`).join("")
    + `</dl>`;

  const pillarLabels = { valuation: "Valorisation", profitability: "Rentabilité", growth: "Croissance", health: "Santé + dividende" };
  const pillars = Object.keys(pillarLabels).map(k => {
    const val = fs.pillars[k];
    const disp = val === null ? "—" : `${val}/100`;
    const width = val === null ? 0 : val;
    return `<div class="fund-pillar"><span class="fund-pillar-label">${esc(pillarLabels[k])}</span>`
      + `<span class="fund-pillar-bar"><span style="width:${width}%"></span></span>`
      + `<span class="fund-pillar-val">${esc(disp)}</span></div>`;
  }).join("");

  // --- Bloc dividende dédié ---
  const paysDividend = (f.dividendYield != null && isFinite(f.dividendYield) && f.dividendYield > 0)
                    || (f.dividendRate != null && isFinite(f.dividendRate) && f.dividendRate > 0);
  let dividendBlock;
  if (!paysDividend) {
    dividendBlock = `<div class="fund-dividend"><h3 class="fund-dividend-title">💸 Dividende</h3>`
      + `<p class="fund-dividend-none">Ne verse pas de dividende.</p></div>`;
  } else {
    const sust = dividendSustainability(f.payoutRatio);
    const amount = (f.dividendRate != null && isFinite(f.dividendRate))
      ? fnum(f.dividendRate) + (f.currency ? " " + esc(f.currency) : "")
      : "—";
    dividendBlock = `<div class="fund-dividend"><h3 class="fund-dividend-title">💸 Dividende</h3>`
      + `<dl class="impact-grid fund-dividend-grid">`
      + `<div><dt>Rendement</dt><dd>${ffrac(f.dividendYield)}</dd></div>`
      + `<div><dt>Taux de distribution</dt><dd>${ffrac(f.payoutRatio)}</dd></div>`
      + `<div><dt>Montant annuel / action</dt><dd>${amount}</dd></div>`
      + `</dl>`
      + (sust ? `<p class="fund-dividend-sust">Soutenabilité : ${esc(sust)}.</p>` : "")
      + `</div>`;
  }

  const global = computeGlobalScore(entry);
  return `<div class="fund-block">
    <div class="fund-scores">
      <div class="fund-score-badge"><span class="fund-score-num">${fs.total}</span><span class="fund-score-cap">Score fondamental /100</span><span class="fund-verdict">${esc(fs.verdict)}</span></div>
      <div class="fund-score-badge fund-score-global"><span class="fund-score-num">${global}</span><span class="fund-score-cap">Score global /100</span><span class="fund-verdict">${Math.round(weightTech*100)}% tech / ${Math.round((1-weightTech)*100)}% fonda</span></div>
    </div>
    ${pillars}
    ${buildKeyMetricsTable(f, (entry.ind || {}).price)}
    ${dividendBlock}
    ${grid}
    <p class="fund-caveat">Seuils de valorisation absolus, non ajustés par secteur : à interpréter avec le contexte du secteur. Analyse descriptive, pas un conseil.</p>
  </div>`;
}

/* Tableau des indicateurs clés : valeur, appréciation colorée et rappel du seuil.
 * La pastille suit le sous-score (pas la valeur brute), donc « bas » et « haut »
 * vont dans le bon sens selon l'indicateur. */
function fundDot(score) {
  if (score === null || score === undefined) return `<span class="fund-dot none">—</span>`;
  const cls = score >= 0.66 ? "good" : score >= 0.33 ? "mid" : "bad";
  const mot = score >= 0.66 ? "Bien" : score >= 0.33 ? "Moyen" : "Faible";
  return `<span class="fund-dot ${cls}">${mot}</span>`;
}

function buildKeyMetricsTable(f, price) {
  const consensus = fundHasConsensus(f);
  const nbAn = (f.numberOfAnalystOpinions != null && isFinite(f.numberOfAnalystOpinions))
    ? Math.round(f.numberOfAnalystOpinions) : 0;

  const fcf = fcfYield(f);
  const nd = netDebt(f);
  const ndE = netDebtToEbitda(f);
  const up = targetUpsidePct(f, price);
  const trend = epsTrendRatio(f);

  const val = (x, fmt) => (x === null || x === undefined || !isFinite(x)) ? "—" : fmt(x);
  const millions = (x) => {
    const abs = Math.abs(x);
    if (abs >= 1e9) return `${fnum(x / 1e9)} Md`;
    if (abs >= 1e6) return `${fnum(x / 1e6)} M`;
    return fnum(x);
  };

  const lignes = [
    ["PEG", val(f.pegRatio, fnum), f.pegRatio === null || f.pegRatio <= 0 ? null : piecewise(f.pegRatio, [[1, 1], [2, 0.5], [3, 0]]),
      "Inférieur à 1 : croissance payée bon marché"],
    ["FCF Yield", val(fcf, x => `${fnum(x * 100)} %`), scoreFcfYield(fcf),
      "Supérieur à 7 % : bien — inférieur à 2 % : faible"],
    ["VE/EBITDA", val(f.enterpriseToEbitda, fnum), f.enterpriseToEbitda === null || f.enterpriseToEbitda <= 0 ? null : piecewise(f.enterpriseToEbitda, [[8, 1], [12, 0.5], [18, 0]]),
      "Moins de 8 : bien — 9 à 12 : moyen — au-delà : cher"],
    ["BNA (résultat net)", trend === null ? "—" : (() => { const n = Math.round(trend * 3); return `${n}/3 exercice${n > 1 ? "s" : ""} en hausse`; })(), trend,
      "Progression régulière : bon signe"],
    ["Dette nette", nd === null ? "—" : `${millions(nd)}${f.currency ? " " + esc(f.currency) : ""}${ndE === null ? "" : ` (${fnum(ndE)}× EBITDA)`}`,
      scoreNetDebtToEbitda(ndE), "Négative : trésorerie excédentaire, très positif"],
    ["Avis des analystes", consensus ? `${esc(f.recommendationKey || "—")} (${fnum(f.recommendationMean)}/5, ${nbAn} analystes)` : (nbAn ? `${nbAn} analyste${nbAn > 1 ? "s" : ""} seulement` : "—"),
      consensus ? scoreAnalystRating(f.recommendationMean) : null,
      `Retenu à partir de ${FUND_MIN_ANALYSTS} analystes`],
    ["Objectif de cours", up === null ? "—" : `${fnum(f.targetMeanPrice)}${f.currency ? " " + esc(f.currency) : ""} (${fpct(up)})`,
      consensus ? scoreTargetUpside(up) : null,
      "Potentiel de +30 % ou plus : note maximale"],
  ];

  const rows = lignes.map(([nom, valeur, score, seuil]) => `<tr>
    <td class="card-title">${esc(nom)}</td>
    <td class="num" data-label="Valeur">${valeur}</td>
    <td data-label="Appréciation">${fundDot(score)}</td>
    <td class="fund-threshold" data-label="Repère">${esc(seuil)}</td>
  </tr>`).join("");

  return `<h3 class="fund-metrics-title">Indicateurs clés</h3>
    <div class="table-wrap"><table class="data-table fund-metrics"><thead><tr>
      <th>Indicateur</th><th class="num">Valeur</th><th>Appréciation</th><th>Repère</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Texte de synthèse fondamental en français, descriptif.
function buildFundamentalText(fund, fundScore) {
  if (!fund || !fundScore) return [];
  const f = fund, parts = [];
  if (f.trailingPE !== null) {
    const q = f.trailingPE <= 0 ? "négatif (bénéfices négatifs)" : f.trailingPE < 15 ? "bas" : f.trailingPE > 30 ? "élevé" : "modéré";
    parts.push(`Valorisation : PER de ${fnum(f.trailingPE)} (${q})${f.forwardPE !== null ? `, PER prévisionnel ${fnum(f.forwardPE)}` : ""}${f.pegRatio !== null ? `, PEG ${fnum(f.pegRatio)}` : ""}. Note de valorisation : ${fundScore.pillars.valuation ?? "—"}/100.`);
  }
  if (f.profitMargins !== null || f.returnOnEquity !== null) {
    parts.push(`Rentabilité : marge nette ${ffrac(f.profitMargins)}, ROE ${ffrac(f.returnOnEquity)}. Note de rentabilité : ${fundScore.pillars.profitability ?? "—"}/100.`);
  }
  const trend = epsTrendRatio(f);
  if (f.revenueGrowth !== null || f.earningsGrowth !== null || trend !== null) {
    const reg = trend === null ? ""
      : trend === 1 ? ", résultat net en hausse sur tous les exercices connus"
      : trend === 0 ? ", résultat net en baisse sur tous les exercices connus"
      : `, résultat net en hausse sur ${Math.round(trend * 3)} exercice${Math.round(trend * 3) > 1 ? "s" : ""} sur 3`;
    parts.push(`Croissance : chiffre d'affaires ${ffrac(f.revenueGrowth)}, bénéfices ${ffrac(f.earningsGrowth)}${reg}. Note de croissance : ${fundScore.pillars.growth ?? "—"}/100.`);
  }
  const healthBits = [];
  if (f.debtToEquity !== null) healthBits.push(`dette/capitaux propres ${fnum(f.debtToEquity / 100)}`);
  if (f.currentRatio !== null) healthBits.push(`ratio de liquidité ${fnum(f.currentRatio)}`);
  const ndE = netDebtToEbitda(f);
  if (ndE !== null) {
    healthBits.push(ndE < 0 ? "trésorerie nette excédentaire (dette nette négative)"
                            : `dette nette à ${fnum(ndE)}× l'EBITDA`);
  }
  if (healthBits.length) parts.push(`Santé financière : ${healthBits.join(", ")}. Note de santé : ${fundScore.pillars.health ?? "—"}/100.`);
  const paysDiv = (f.dividendYield !== null && f.dividendYield > 0) || (f.dividendRate != null && f.dividendRate > 0);
  if (paysDiv) {
    const sustText = dividendSustainability(f.payoutRatio);
    parts.push(`Dividende : rendement ${ffrac(f.dividendYield)}, distribution ${ffrac(f.payoutRatio)}${sustText ? `, soutenabilité ${sustText}` : ""}.`);
  }
  if (fundHasConsensus(f)) {
    const nb = Math.round(f.numberOfAnalystOpinions);
    parts.push(`Consensus : ${nb} analystes, avis moyen ${fnum(f.recommendationMean)}/5 (1 = achat fort)`
      + `${f.targetMeanPrice != null ? `, objectif de cours moyen ${fnum(f.targetMeanPrice)}${f.currency ? " " + f.currency : ""}` : ""}. `
      + `Opinion de marché, comptée dans la valorisation mais volontairement minoritaire.`);
  } else if (f.numberOfAnalystOpinions != null && f.numberOfAnalystOpinions > 0) {
    parts.push(`Consensus : trop peu d'analystes (${Math.round(f.numberOfAnalystOpinions)}) pour être retenu dans le score.`);
  }
  parts.push(`Score fondamental global : ${fundScore.total}/100 → « ${fundScore.verdict} ». Agrégation pondérée des piliers disponibles (valorisation 35 %, rentabilité 30 %, croissance 20 %, santé 15 %).`);
  return parts;
}

// Courbes de prix par ticker dans l'onglet Analyse : fermées par défaut, ouvertes
// à la demande (l'utilisateur choisit s'il veut la courbe ou non), avec un choix de
// période. 100 % réutilisé depuis l'historique déjà en cache — zéro requête réseau.
const CHART_PERIODS = [
  { key: "1s", label: "1 SEM.", days: 5 },
  { key: "1m", label: "1 MOIS", days: 21 },
  { key: "3m", label: "3 MOIS", days: 63 },
  { key: "6m", label: "6 MOIS", days: 126 },
  { key: "1a", label: "1 AN", days: 252 },
];
let openCharts = {};             // { TICKER: { period: "1a" } } — présence = courbe affichée
let analysisChartInstances = {}; // { TICKER: instance Chart.js } — pour destroy() avant re-création

// Actualités par ticker : fermées par défaut, chargées à la demande (1 requête par
// ticker ouvert, mise en cache mémoire pour la session — pas persistée, les actus
// changent vite et n'ont pas vocation à rester en localStorage indéfiniment).
let openNews = {};      // { TICKER: true } — présence = bloc actus affiché
let newsCache = {};     // { TICKER: [{title, link, publisher, date}] }
let newsPending = new Set(); // tickers dont le chargement est déjà en cours (évite les doublons)

async function loadNews(ticker) {
  try {
    const resp = await fetch("/api/news?symbol=" + encodeURIComponent(ticker));
    const data = await resp.json();
    newsCache[ticker] = (!data.error && Array.isArray(data.news)) ? data.news : [];
  } catch {
    newsCache[ticker] = [];
  }
}

function renderNewsBlock(ticker) {
  const items = newsCache[ticker];
  if (!items) {
    if (!newsPending.has(ticker)) {
      newsPending.add(ticker);
      loadNews(ticker).then(() => { newsPending.delete(ticker); renderAnalysis(); });
    }
    return `<div class="analysis-news"><p class="hint">Chargement des actualités…</p></div>`;
  }
  if (items.length === 0) {
    return `<div class="analysis-news"><p class="hint">Aucune actualité récente trouvée pour ${esc(ticker)}.</p></div>`;
  }
  const rows = items.map(n => `
    <li>
      <a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
      <span class="muted">${esc(n.publisher || "")}${n.date ? " · " + esc(n.date) : ""}</span>
    </li>`).join("");
  return `<div class="analysis-news"><ul class="news-list">${rows}</ul></div>`;
}

function fdateShort(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

function destroyAnalysisChart(ticker) {
  if (analysisChartInstances[ticker]) {
    analysisChartInstances[ticker].destroy();
    delete analysisChartInstances[ticker];
  }
}

function renderAnalysisChart(ticker, entry) {
  const state = openCharts[ticker];
  const canvas = document.getElementById(`chart-canvas-${ticker}`);
  if (!state || !canvas || typeof Chart === "undefined") return;

  const period = CHART_PERIODS.find(p => p.key === state.period) || CHART_PERIODS[4];
  const hist = entry.hist; // le plus récent en premier
  const n = Math.min(period.days, hist.closes.length);
  // Ordre chronologique (ancien → récent) pour l'axe des temps.
  const labels = hist.dates.slice(0, n).reverse().map(fdateShort);
  const closes = hist.closes.slice(0, n).reverse();

  destroyAnalysisChart(ticker);
  analysisChartInstances[ticker] = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: closes,
        borderColor: "#ffb000",
        backgroundColor: "rgba(255,176,0,0.08)",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.15,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => fnum(ctx.parsed.y) } },
      },
      scales: {
        x: { ticks: { color: "#7b8794", maxTicksLimit: 6, font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: "#1a2028" } },
        y: { ticks: { color: "#7b8794", font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: "#1a2028" } },
      },
    },
  });
}

function renderAnalysis() {
  const container = document.getElementById("analysis-container");
  container.innerHTML = "";

  const analyzable = watchlist.filter(t => cache[t]);
  if (analyzable.length === 0) {
    container.innerHTML = `<p class="analysis-empty">Aucune donnée en cache. Lancez au moins une analyse depuis l'onglet Dashboard (F1) pour générer les synthèses.</p>`;
    return;
  }

  for (const ticker of analyzable) {
    const entry = cache[ticker];
    const card = document.createElement("article");
    card.className = "analysis-card";
    const techParas = buildAnalysisText(ticker, entry).map(p => `<p>${esc(p)}</p>`).join("");
    const fundParas = buildFundamentalText(entry.fund, entry.fundScore).map(p => `<p>${esc(p)}</p>`).join("");
    const paragraphs = techParas + fundParas;

    const chartState = openCharts[ticker];
    const chartHtml = chartState ? `
      <div class="analysis-chart-wrap">
        <div class="chart-periods" role="tablist">
          ${CHART_PERIODS.map(p => `<button type="button" class="btn btn-small period-btn ${chartState.period === p.key ? "btn-accent" : "btn-ghost"}" data-ticker="${esc(ticker)}" data-period="${p.key}">${p.label}</button>`).join("")}
        </div>
        <div class="chart-holder analysis-chart-holder">
          <canvas id="chart-canvas-${ticker}"></canvas>
        </div>
      </div>` : "";

    const newsOpen = !!openNews[ticker];
    const newsHtml = newsOpen ? renderNewsBlock(ticker) : "";

    card.innerHTML = `
      <h3>${esc(ticker)}${tickerDisplayName(ticker) ? ` <span class="muted">— ${esc(tickerDisplayName(ticker))}</span>` : ""} <span class="signal signal-${entry.signal.toLowerCase()}">${entry.signal}</span>
        <button type="button" class="btn btn-small btn-ghost btn-chart-toggle" data-ticker="${esc(ticker)}">${chartState ? "▲ Masquer la courbe" : "📈 Afficher la courbe"}</button>
        <button type="button" class="btn btn-small btn-ghost btn-news-toggle" data-ticker="${esc(ticker)}">${newsOpen ? "▲ Masquer les actus" : "📰 Actualités"}</button>
      </h3>
      ${buildAnalysisStatsHtml(entry.ind)}
      <h4 class="fund-heading">Analyse fondamentale</h4>
      ${buildFundamentalStatsHtml(entry)}
      ${chartHtml}
      ${newsHtml}
      ${paragraphs}
      <p class="meta">Données du ${fdate(entry.updated)}${isStale(entry) ? " — cache de plus de 24 h, pensez à relancer une analyse" : ""}.</p>`;
    container.appendChild(card);

    if (chartState) renderAnalysisChart(ticker, entry);
  }
}

// Un seul écouteur délégué : survit à chaque reconstruction du innerHTML par renderAnalysis().
document.getElementById("analysis-container").addEventListener("click", e => {
  const toggleBtn = e.target.closest(".btn-chart-toggle");
  if (toggleBtn) {
    const ticker = toggleBtn.dataset.ticker;
    if (openCharts[ticker]) {
      delete openCharts[ticker];
      destroyAnalysisChart(ticker);
    } else {
      openCharts[ticker] = { period: "1a" };
    }
    renderAnalysis();
    return;
  }
  const periodBtn = e.target.closest(".period-btn");
  if (periodBtn && openCharts[periodBtn.dataset.ticker]) {
    openCharts[periodBtn.dataset.ticker].period = periodBtn.dataset.period;
    renderAnalysis();
    return;
  }
  const newsBtn = e.target.closest(".btn-news-toggle");
  if (newsBtn) {
    const ticker = newsBtn.dataset.ticker;
    if (openNews[ticker]) delete openNews[ticker];
    else openNews[ticker] = true;
    renderAnalysis();
  }
});

document.getElementById("btn-refresh-analysis").addEventListener("click", renderAnalysis);

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

MODULES_CHARGES.push("10-ui-analyse");   // doit rester la dernière ligne du fichier
