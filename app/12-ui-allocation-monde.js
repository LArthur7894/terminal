"use strict";

/* ============================================================================
   F6 · Allocation, F10 · Monde, et la navigation par onglets.
   ============================================================================ */

/* ============================= ONGLET 6 : ALLOCATION ============================= */

// Meilleures opportunités toutes sources confondues (watchlist + scan marché),
// à la différence de computeTopPicks() qui ne regarde que la watchlist.
function bestOpportunities(limit = 5) {
  // cache (watchlist, persistant) ET marketCache (scan marché, mémoire) — cache est
  // prioritaire en cas de doublon (analyse plus susceptible d'être à jour/complète).
  const merged = { ...marketCache, ...cache };
  return Object.keys(merged)
    .map(t => ({ ticker: t, entry: merged[t] }))
    .filter(x => x.entry && x.entry.signal === "Achat")
    .sort((a, b) => b.entry.score - a.entry.score)
    .slice(0, limit);
}

document.getElementById("form-allocation").addEventListener("submit", e => {
  e.preventDefault();
  const amount = parseFloat(document.getElementById("allocation-amount").value);
  if (!isFinite(amount) || amount <= 0) { toast("Montant invalide.", "error"); return; }
  renderAllocationResult(amount);
});

// Calcule une répartition pondérée par score parmi les meilleures opportunités
// « Achat » connues, et l'affiche avec un bouton pour l'appliquer aux positions.
function renderAllocationResult(amount) {
  const result = document.getElementById("allocation-result");
  const picks = bestOpportunities(5);

  if (picks.length === 0) {
    result.innerHTML = `<p class="analysis-empty">Aucune opportunité « Achat » détectée pour l'instant. Analysez des tickers (Dashboard ou Marché) avant de répartir un budget.</p>`;
    lastAllocationPlan = null;
    return;
  }

  const totalScore = picks.reduce((s, p) => s + p.entry.score, 0);
  const plan = picks.map(p => {
    const weight = p.entry.score / totalScore;
    const alloc = amount * weight;
    const price = p.entry.ind.price;
    return { ticker: p.ticker, score: p.entry.score, weight, alloc, price, qty: alloc / price };
  });
  lastAllocationPlan = plan;

  const rows = plan.map(p => `
    <tr>
      <td><span class="cell-ticker">${esc(p.ticker)}</span></td>
      <td class="num">${p.score}/100</td>
      <td class="num">${fmtNum.format(p.weight * 100)} %</td>
      <td class="num">${fnum(p.alloc)}</td>
      <td class="num">${fnum(p.price)}</td>
      <td class="num">${fmtNum.format(p.qty)}</td>
    </tr>`).join("");

  result.innerHTML = `
    <h2>Répartition proposée — ${fnum(amount)}</h2>
    <p class="hint">Pondération proportionnelle au score technique parmi vos ${picks.length} meilleure(s) opportunité(s) « Achat ».</p>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Ticker</th><th class="num">Score</th><th class="num">Poids</th><th class="num">Montant</th><th class="num">Prix</th><th class="num">Quantité</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <button type="button" class="btn btn-accent" id="btn-allocation-apply">✓ Appliquer cette répartition à mes positions</button>`;
  document.getElementById("btn-allocation-apply").addEventListener("click", applyAllocation);
}

function applyAllocation() {
  if (!lastAllocationPlan) return;
  for (const p of lastAllocationPlan) applyPurchase(p.ticker, p.price, p.alloc);
  lsSet(LS.positions, positions);
  renderAll();
  toast(`Répartition appliquée sur ${lastAllocationPlan.length} ligne(s).`, "success");
  lastAllocationPlan = null;
  document.getElementById("allocation-result").innerHTML =
    `<p class="analysis-empty">Répartition appliquée. Relancez une simulation si besoin.</p>`;
}

/* ============================= ONGLET MONDE ============================= */

const MONDE_GROUPS = [
  { key: "indices", label: "Indices", items: [
    { sym: "^GSPC", name: "S&P 500" }, { sym: "^IXIC", name: "Nasdaq" }, { sym: "^DJI", name: "Dow Jones" },
    { sym: "^FCHI", name: "CAC 40" }, { sym: "^GDAXI", name: "DAX" }, { sym: "^FTSE", name: "FTSE 100" }, { sym: "^N225", name: "Nikkei 225" } ] },
  { key: "taux", label: "Taux & volatilité", items: [
    { sym: "^TNX", name: "US 10 ans" }, { sym: "^VIX", name: "VIX" } ] },
  { key: "devises", label: "Devises", items: [
    { sym: "EURUSD=X", name: "EUR/USD" }, { sym: "USDJPY=X", name: "USD/JPY" }, { sym: "DX-Y.NYB", name: "Indice dollar" } ] },
  { key: "matieres", label: "Matières premières", items: [
    { sym: "CL=F", name: "Pétrole WTI" }, { sym: "GC=F", name: "Or" } ] },
  { key: "crypto", label: "Crypto", items: [
    { sym: "BTC-USD", name: "Bitcoin" } ] },
];
const MONDE_SECTORS = [
  { sym: "XLK", name: "Technologie" }, { sym: "XLE", name: "Énergie" }, { sym: "XLF", name: "Finance" },
  { sym: "XLV", name: "Santé" }, { sym: "XLY", name: "Conso discrétionnaire" }, { sym: "XLP", name: "Conso de base" },
  { sym: "XLI", name: "Industrie" }, { sym: "XLU", name: "Services publics" }, { sym: "XLB", name: "Matériaux" },
  { sym: "XLRE", name: "Immobilier" }, { sym: "XLC", name: "Communication" },
];
const MONDE_ALL_SYMBOLS = [
  ...MONDE_GROUPS.flatMap(g => g.items.map(i => i.sym)),
  ...MONDE_SECTORS.map(s => s.sym),
];

// Notes pédagogiques macro→actions. `headline` = symbole pilotant la mise en avant du jour ;
// `threshold` = seuil en % de |variation| au-delà duquel on met en avant le sens (up/down).
const MONDE_IMPACT = {
  indices: { why: "Baromètre de l'appétit pour le risque (US, Europe, Asie).",
    headline: "^GSPC", threshold: 1.0,
    up: "Climat « risk-on » : appétit pour les actions.",
    down: "Climat « risk-off » : repli vers les refuges (or, dollar, Treasuries)." },
  taux: { why: "Le 10 ans US actualise tous les actifs risqués ; le VIX mesure la peur du marché.",
    headline: "^TNX", threshold: 2.0,
    up: "Taux ↑ → pression sur croissance/tech (flux futurs actualisés plus fort), soutien aux banques (marges d'intérêt).",
    down: "Taux ↓ → soutien à la croissance/tech, marges bancaires sous pression." },
  devises: { why: "Le dollar pilote les multinationales US, les émergents et les matières premières.",
    headline: "DX-Y.NYB", threshold: 0.5,
    up: "Dollar ↑ → vent contraire pour exportateurs US, émergents et matières premières (cotées en $).",
    down: "Dollar ↓ → soutien aux exportateurs US, aux émergents et aux matières premières." },
  matieres: { why: "Le pétrole pèse sur l'inflation et les marges ; l'or est une valeur refuge.",
    headline: "CL=F", threshold: 1.0,
    up: "Pétrole ↑ → favorable à l'énergie, défavorable au transport aérien et à la consommation.",
    down: "Pétrole ↓ → soulage la consommation et le transport, pèse sur l'énergie." },
  crypto: { why: "Actif risqué très sensible à la liquidité et au sentiment de marché.",
    headline: "BTC-USD", threshold: 2.0,
    up: "Hausse → appétit pour le risque / liquidité abondante.",
    down: "Baisse → aversion au risque / resserrement de la liquidité." },
  sectors: { why: "La rotation sectorielle montre où va l'argent : cyclique vs défensif, croissance vs value." },
};

let mondeCache = {};        // { SYMBOL: {last, changePct} }, mémoire uniquement
let mondeUpdated = null;    // Date du dernier chargement réussi
let mondeLoading = false;
let mondeNews = null;       // [{title, link, publisher, date}] fusionnés, ou null si pas encore chargé
const MONDE_NEWS_SYMBOLS = ["^GSPC", "^IXIC", "^DJI"];

// "dd/mm/yyyy" -> timestamp (0 si absent/illisible), pour trier les actus par date décroissante.
function parseFrDate(s) {
  if (!s) return 0;
  const p = String(s).split("/").map(Number);
  if (p.length !== 3 || p.some(n => !isFinite(n))) return 0;
  return new Date(p[2], p[1] - 1, p[0]).getTime();
}

async function loadMondeNews() {
  await runPool(MONDE_NEWS_SYMBOLS, loadNews, 3); // remplit newsCache[sym] via la fonction existante
  const seen = new Set(), merged = [];
  for (const sym of MONDE_NEWS_SYMBOLS) {
    for (const n of (newsCache[sym] || [])) {
      if (!n.title || seen.has(n.title)) continue;
      seen.add(n.title);
      merged.push(n);
    }
  }
  merged.sort((a, b) => parseFrDate(b.date) - parseFrDate(a.date));
  mondeNews = merged.slice(0, 12);
}

// Variation du jour en % depuis [clôture la plus récente, précédente, ...]. null si non calculable.
function mondeChangePct(closes) {
  if (!Array.isArray(closes) || closes.length < 2) return null;
  const c0 = Number(closes[0]), c1 = Number(closes[1]);
  if (!isFinite(c0) || !isFinite(c1) || c1 === 0) return null;
  return (c0 - c1) / c1 * 100;
}

async function fetchMondeQuote(sym) {
  try {
    const resp = await fetch("/api/history?symbol=" + encodeURIComponent(sym));
    const data = await resp.json();
    if (data.error || !Array.isArray(data.closes) || data.closes.length < 2) return { last: null, changePct: null };
    return { last: Number(data.closes[0]), changePct: mondeChangePct(data.closes) };
  } catch {
    return { last: null, changePct: null };
  }
}

async function loadMondeData() {
  if (mondeLoading) return;
  mondeLoading = true;
  renderMonde();
  await runPool(MONDE_ALL_SYMBOLS, async sym => { mondeCache[sym] = await fetchMondeQuote(sym); }, 6);
  await loadMondeNews();
  mondeUpdated = new Date();
  mondeLoading = false;
  renderMonde();
}

function mondeImpactHtml(key) {
  const imp = MONDE_IMPACT[key];
  if (!imp) return "";
  let html = `<p class="monde-why">${esc(imp.why)}</p>`;
  if (imp.headline && imp.up && imp.down) {
    const q = mondeCache[imp.headline];
    const chg = q ? q.changePct : null;
    if (chg != null && Math.abs(chg) >= imp.threshold) {
      const clause = chg > 0 ? imp.up : imp.down;
      html += `<p class="monde-impact-live">${chg > 0 ? "▲" : "▼"} ${esc(clause)}</p>`;
    }
  }
  return html;
}

function renderMondeNews() {
  if (mondeNews == null) return `<p class="hint">Chargement des actualités…</p>`;
  if (mondeNews.length === 0) return `<p class="hint">Aucune actualité récente disponible.</p>`;
  const rows = mondeNews.map(n => `
    <li>
      <a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
      <span class="muted">${esc(n.publisher || "")}${n.date ? " · " + esc(n.date) : ""}</span>
    </li>`).join("");
  return `<ul class="news-list">${rows}</ul>`;
}

function mondeCell(item) {
  const q = mondeCache[item.sym];
  const last = q && q.last != null ? fnum(q.last) : "—";
  const chg = q && q.changePct != null ? fpct(q.changePct) : "—";
  const cls = q && q.changePct != null ? pctClass(q.changePct) : "";
  return `<div class="monde-cell"><span class="monde-name">${esc(item.name)}</span>`
    + `<span class="monde-val">${last}</span>`
    + `<span class="monde-chg ${cls}">${chg}</span></div>`;
}

function renderMonde() {
  const panel = document.getElementById("monde-body");
  if (!panel) return;

  const groupsHtml = MONDE_GROUPS.map(g =>
    `<section class="monde-group"><h2 class="monde-group-title">${esc(g.label)}</h2>`
    + mondeImpactHtml(g.key)
    + `<div class="monde-grid">${g.items.map(mondeCell).join("")}</div></section>`
  ).join("");

  // Rotation sectorielle : triée du plus fort au plus faible du jour (indisponibles en fin).
  const sectors = MONDE_SECTORS
    .map(s => ({ item: s, chg: (mondeCache[s.sym] || {}).changePct }))
    .sort((a, b) => (b.chg ?? -Infinity) - (a.chg ?? -Infinity));
  const sectorsHtml = `<section class="monde-group"><h2 class="monde-group-title">Rotation sectorielle</h2>`
    + mondeImpactHtml("sectors")
    + `<div class="monde-grid">${sectors.map(s => mondeCell(s.item)).join("")}</div></section>`;

  const updated = mondeUpdated ? mondeUpdated.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—";
  const status = mondeLoading ? "Chargement…" : `Mis à jour : ${updated}`;

  panel.innerHTML =
    `<div class="monde-head"><button class="btn btn-small btn-ghost" id="btn-monde-refresh"${mondeLoading ? " disabled" : ""}>↻ Rafraîchir</button>`
    + `<span class="hint">${esc(status)}</span></div>`
    + groupsHtml + sectorsHtml
    + `<section class="monde-group"><h2 class="monde-group-title">Actualité monde</h2>${renderMondeNews()}</section>`;

  const btn = document.getElementById("btn-monde-refresh");
  if (btn) btn.addEventListener("click", () => { if (!mondeLoading) loadMondeData(); });
}

/* ============================= NAVIGATION PAR ONGLETS ============================= */

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-selected", b === btn ? "true" : "false");
    });
    document.querySelectorAll(".panel").forEach(p => {
      const active = p.id === "panel-" + btn.dataset.tab;
      p.classList.toggle("active", active);
      p.hidden = !active;
    });
    // Certains rendus dépendent de la visibilité (Chart.js notamment)
    if (btn.dataset.tab === "positions") { renderPositions(); ensureFxRates(); }
    if (btn.dataset.tab === "analyse") renderAnalysis();
    if (btn.dataset.tab === "alerts") renderAlerts();
    if (btn.dataset.tab === "bot") renderBot();
    if (btn.dataset.tab === "compare") renderCompare();
    if (btn.dataset.tab === "monde") { renderMonde(); if (!mondeUpdated && !mondeLoading) loadMondeData(); }
  });
});

MODULES_CHARGES.push("12-ui-allocation-monde");   // doit rester la dernière ligne du fichier
