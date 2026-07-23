"use strict";

/* ============================================================================
   F9 · Comparer, export/import, devise de référence, rendu global.
   ============================================================================ */

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
  // Le « meilleur » suit le sens de lecture de chaque indicateur : un PEG bas gagne,
  // un FCF Yield haut gagne, un avis analyste proche de 1 (achat fort) gagne.
  ["PEG", e => e.fund ? e.fund.pegRatio : null, "low", v => fnum(v)],
  ["VE/EBITDA", e => e.fund ? e.fund.enterpriseToEbitda : null, "low", v => fnum(v)],
  ["FCF Yield", e => e.fund ? fcfYield(e.fund) : null, "high", v => fnum(v * 100) + " %"],
  ["Rendement dividende", e => e.fund ? e.fund.dividendYield : null, "high", v => ffrac(v)],
  ["Marge nette", e => e.fund ? e.fund.profitMargins : null, "high", v => ffrac(v)],
  ["ROE", e => e.fund ? e.fund.returnOnEquity : null, "high", v => ffrac(v)],
  ["Croissance CA", e => e.fund ? e.fund.revenueGrowth : null, "high", v => ffrac(v)],
  ["Résultat net en hausse", e => e.fund ? epsTrendRatio(e.fund) : null, "high", v => `${Math.round(v * 3)}/3`],
  ["Dette / cap. propres", e => e.fund && e.fund.debtToEquity != null ? e.fund.debtToEquity / 100 : null, "low", v => fnum(v)],
  ["Dette nette / EBITDA", e => e.fund ? netDebtToEbitda(e.fund) : null, "low", v => fnum(v) + "×"],
  ["Avis analystes (1=achat)", e => (e.fund && fundHasConsensus(e.fund)) ? e.fund.recommendationMean : null, "low", v => fnum(v) + "/5"],
  ["Potentiel vs objectif", e => (e.fund && fundHasConsensus(e.fund)) ? targetUpsidePct(e.fund, e.ind ? e.ind.price : null) : null, "high", v => fpct(v)],
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

  document.getElementById("compare-periods").innerHTML = CHART_PERIODS.map(p =>
    `<button type="button" class="btn btn-small period-btn ${comparePeriod === p.key ? "btn-accent" : "btn-ghost"}" data-period="${p.key}">${p.label}</button>`
  ).join("");

  if (compareSel.length < 2) {
    tableEl.innerHTML = `<p class="analysis-empty">Cochez au moins 2 titres pour les comparer.</p>`;
    if (compareChart) { compareChart.destroy(); compareChart = null; }
    return;
  }

  const entries = compareSel.map(t => cache[t]);
  const header = `<th>Métrique</th>` + compareSel.map((t, i) => `<th class="num" style="color:${COMPARE_COLORS[i]}">${esc(t)}</th>`).join("");
  const rows = COMPARE_METRICS.map(([label, get, dir, fmt]) => {
    const vals = entries.map(e => { const v = get(e); return (v != null && isFinite(v)) ? v : null; });
    const best = compareBest(vals, dir);
    const cells = vals.map((v, i) => `<td class="num ${i === best ? "best" : ""}">${v == null ? "—" : esc(fmt(v, entries[i]))}</td>`).join("");
    return `<tr><td>${esc(label)}</td>${cells}</tr>`;
  }).join("");
  tableEl.innerHTML = `<div class="table-wrap"><table class="data-table compare-data"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;

  renderCompareChart();
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

// Courbes de prix normalisées à 100 au début de la période, superposées.
function renderCompareChart() {
  const canvas = document.getElementById("compare-canvas");
  if (!canvas || typeof Chart === "undefined") return;
  if (compareChart) { compareChart.destroy(); compareChart = null; }
  if (compareSel.length < 2) return;

  const period = CHART_PERIODS.find(p => p.key === comparePeriod) || CHART_PERIODS[4];
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

// Raccourcis clavier F1–F4 façon terminal (sans bloquer si un champ est actif)
document.addEventListener("keydown", e => {
  const map = { F1: "dashboard", F2: "positions", F3: "buysim", F4: "analyse", F5: "marche", F6: "allocation", F7: "alerts", F8: "bot", F9: "compare" };
  if (map[e.key]) {
    e.preventDefault();
    document.getElementById("tab-" + map[e.key]).click();
  }
});

/* ============================= PROFIL (en-tête) ============================= */

document.getElementById("profile-name-label").textContent = currentProfile;
document.getElementById("btn-profile").addEventListener("click", switchProfile);

/* ============================= EXPORT / IMPORT ============================= */

function exportData() {
  const payload = {
    app: "terminal-boursier",
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: currentProfile,
    data: { watchlist, positions, tickerNames, filters, weightTech, alerts, perfJournal },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `terminal-${currentProfile}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast("Données exportées (fichier JSON téléchargé).", "success");
}
document.getElementById("btn-export").addEventListener("click", exportData);

document.getElementById("btn-import").addEventListener("click", () => document.getElementById("import-file").click());
document.getElementById("import-file").addEventListener("change", e => {
  const file = e.target.files && e.target.files[0];
  if (file) importData(file);
  e.target.value = ""; // permet de ré-importer le même fichier
});

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try { parsed = JSON.parse(reader.result); }
    catch { return toast("Fichier illisible (JSON invalide).", "error"); }
    if (!parsed || parsed.app !== "terminal-boursier" || !parsed.data) {
      return toast("Ce fichier n'est pas un export du terminal.", "error");
    }
    if (!window.confirm("Fusionner ces données avec votre profil actuel ?")) return;

    const d = parsed.data;
    let addedT = 0, addedP = 0, addedA = 0;

    // Watchlist : union.
    for (const t of (d.watchlist || [])) {
      if (!watchlist.includes(t)) { watchlist.push(t); addedT++; }
    }
    // Noms : l'actuel prime, l'import comble les manques.
    tickerNames = { ...(d.tickerNames || {}), ...tickerNames };
    // Positions : fusion par ticker (PRU moyen pondéré), via applyPurchase.
    for (const p of (d.positions || [])) {
      if (!p || !p.ticker || !(p.pru > 0) || !(p.qty > 0)) continue;
      applyPurchase(p.ticker, p.pru, p.qty * p.pru); addedP++;
    }
    // Alertes : union en dédupliquant (ticker+type+direction+value).
    const sig = a => `${a.ticker}|${a.type}|${a.direction}|${a.value}`;
    const existing = new Set(alerts.map(sig));
    for (const a of (d.alerts || [])) {
      if (!a || !a.ticker || existing.has(sig(a))) continue;
      alerts.push({ id: newAlertId(), ticker: a.ticker, type: a.type, direction: a.direction, value: a.value, enabled: a.enabled !== false, triggeredAt: null });
      existing.add(sig(a)); addedA++;
    }
    // weightTech et filters : inchangés (préférences du profil courant).
    // Journal de perf : si le profil courant n'en a pas, on récupère l'importé (sinon on garde).
    if ((!Array.isArray(perfJournal) || perfJournal.length === 0) && Array.isArray(d.perfJournal)) {
      perfJournal = d.perfJournal;
      lsSet(LS.perfJournal, perfJournal);
    }

    lsSet(LS.watchlist, watchlist);
    lsSet(LS.positions, positions);
    lsSet(LS.tickerNames, tickerNames);
    saveAlerts();
    renderAll();
    if (typeof renderAlerts === "function") renderAlerts();
    toast(`Import fusionné : +${addedT} tickers, +${addedP} positions, +${addedA} alertes.`, "success");
  };
  reader.onerror = () => toast("Erreur de lecture du fichier.", "error");
  reader.readAsText(file);
}

/* ============================= DEVISE DE RÉFÉRENCE ============================= */
(function initBaseCurrency() {
  const sel = document.getElementById("base-currency");
  if (!sel) return;
  sel.value = getBaseCurrency();
  sel.addEventListener("change", () => {
    lsSet(LS.baseCurrency, sel.value);
    ensureFxRates();   // pré-charge les taux de la nouvelle devise
    renderAll();       // recalcul immédiat (état dégradé si taux pas encore là)
  });
})();

/* ============================= RENDU GLOBAL ============================= */

function renderAll() {
  renderAutopick();
  renderWatchlist();
  renderTape();
  renderPositions();
  renderAnalysis();
  renderMarketResults();
  checkAlerts();
}

MODULES_CHARGES.push("14-ui-comparer");   // doit rester la dernière ligne du fichier
