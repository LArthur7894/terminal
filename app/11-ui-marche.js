"use strict";

/* ============================================================================
   F5 · Scan du marché, puis le câblage du tri des tableaux — placé ici car
   il doit s'exécuter une fois renderWatchlist ET renderMarketTable définies.
   ============================================================================ */

/* ============================= ONGLET 5 : MARCHÉ ============================= */

// Sélection curatée de grandes capitalisations mondiales, tous secteurs confondus.
// Pas une liste exhaustive/vérifiée des 3000 premières mondiales (aucune API gratuite
// fiable ne l'expose) : un large échantillon représentatif, pour donner une base de
// scan raisonnable sans dépendre d'un fournisseur de données payant.
const MARKET_UNIVERSE = [
  // --- Technologie (US) ---
  { symbol: "AAPL", name: "Apple" }, { symbol: "MSFT", name: "Microsoft" }, { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "AMZN", name: "Amazon" }, { symbol: "NVDA", name: "Nvidia" }, { symbol: "META", name: "Meta Platforms" },
  { symbol: "TSLA", name: "Tesla" }, { symbol: "AVGO", name: "Broadcom" }, { symbol: "ORCL", name: "Oracle" },
  { symbol: "CRM", name: "Salesforce" }, { symbol: "ADBE", name: "Adobe" }, { symbol: "CSCO", name: "Cisco" },
  { symbol: "ACN", name: "Accenture" }, { symbol: "IBM", name: "IBM" }, { symbol: "INTC", name: "Intel" },
  { symbol: "AMD", name: "AMD" }, { symbol: "QCOM", name: "Qualcomm" }, { symbol: "TXN", name: "Texas Instruments" },
  { symbol: "INTU", name: "Intuit" }, { symbol: "NOW", name: "ServiceNow" }, { symbol: "UBER", name: "Uber" },
  { symbol: "PYPL", name: "PayPal" }, { symbol: "SHOP", name: "Shopify" }, { symbol: "TSM", name: "TSMC" },
  // --- Santé (US) ---
  { symbol: "UNH", name: "UnitedHealth" }, { symbol: "JNJ", name: "Johnson & Johnson" }, { symbol: "LLY", name: "Eli Lilly" },
  { symbol: "ABBV", name: "AbbVie" }, { symbol: "MRK", name: "Merck" }, { symbol: "PFE", name: "Pfizer" },
  { symbol: "TMO", name: "Thermo Fisher" }, { symbol: "ABT", name: "Abbott" }, { symbol: "DHR", name: "Danaher" },
  { symbol: "BMY", name: "Bristol-Myers Squibb" }, { symbol: "AMGN", name: "Amgen" }, { symbol: "GILD", name: "Gilead Sciences" },
  { symbol: "CVS", name: "CVS Health" }, { symbol: "ISRG", name: "Intuitive Surgical" }, { symbol: "VRTX", name: "Vertex Pharmaceuticals" },
  { symbol: "REGN", name: "Regeneron" },
  // --- Financières (US) ---
  { symbol: "BRK-B", name: "Berkshire Hathaway" }, { symbol: "JPM", name: "JPMorgan Chase" }, { symbol: "V", name: "Visa" },
  { symbol: "MA", name: "Mastercard" }, { symbol: "BAC", name: "Bank of America" }, { symbol: "WFC", name: "Wells Fargo" },
  { symbol: "GS", name: "Goldman Sachs" }, { symbol: "MS", name: "Morgan Stanley" }, { symbol: "C", name: "Citigroup" },
  { symbol: "SCHW", name: "Charles Schwab" }, { symbol: "BLK", name: "BlackRock" }, { symbol: "AXP", name: "American Express" },
  { symbol: "SPGI", name: "S&P Global" }, { symbol: "PGR", name: "Progressive" }, { symbol: "CB", name: "Chubb" },
  // --- Consommation (US) ---
  { symbol: "WMT", name: "Walmart" }, { symbol: "PG", name: "Procter & Gamble" }, { symbol: "COST", name: "Costco" },
  { symbol: "HD", name: "Home Depot" }, { symbol: "MCD", name: "McDonald's" }, { symbol: "NKE", name: "Nike" },
  { symbol: "SBUX", name: "Starbucks" }, { symbol: "TGT", name: "Target" }, { symbol: "LOW", name: "Lowe's" },
  { symbol: "DIS", name: "Disney" }, { symbol: "KO", name: "Coca-Cola" }, { symbol: "PEP", name: "PepsiCo" },
  { symbol: "PM", name: "Philip Morris" }, { symbol: "CL", name: "Colgate-Palmolive" }, { symbol: "EL", name: "Estée Lauder" },
  { symbol: "MDLZ", name: "Mondelez" }, { symbol: "BKNG", name: "Booking Holdings" }, { symbol: "CMG", name: "Chipotle" },
  // --- Industrie / Énergie (US) ---
  { symbol: "XOM", name: "ExxonMobil" }, { symbol: "CVX", name: "Chevron" }, { symbol: "CAT", name: "Caterpillar" },
  { symbol: "BA", name: "Boeing" }, { symbol: "GE", name: "General Electric" }, { symbol: "HON", name: "Honeywell" },
  { symbol: "UNP", name: "Union Pacific" }, { symbol: "UPS", name: "UPS" }, { symbol: "RTX", name: "RTX" },
  { symbol: "LMT", name: "Lockheed Martin" }, { symbol: "DE", name: "Deere" }, { symbol: "ETN", name: "Eaton" },
  { symbol: "EMR", name: "Emerson Electric" }, { symbol: "COP", name: "ConocoPhillips" }, { symbol: "SLB", name: "Schlumberger" },
  // --- Communication / Utilities (US) ---
  { symbol: "VZ", name: "Verizon" }, { symbol: "T", name: "AT&T" }, { symbol: "TMUS", name: "T-Mobile US" },
  { symbol: "CMCSA", name: "Comcast" }, { symbol: "NFLX", name: "Netflix" }, { symbol: "DUK", name: "Duke Energy" },
  { symbol: "SO", name: "Southern Company" }, { symbol: "NEE", name: "NextEra Energy" },
  // --- Europe ---
  { symbol: "MC.PA", name: "LVMH" }, { symbol: "OR.PA", name: "L'Oréal" }, { symbol: "TTE.PA", name: "TotalEnergies" },
  { symbol: "SAN.PA", name: "Sanofi" }, { symbol: "AI.PA", name: "Air Liquide" }, { symbol: "BNP.PA", name: "BNP Paribas" },
  { symbol: "SAP.DE", name: "SAP" }, { symbol: "SIE.DE", name: "Siemens" }, { symbol: "ALV.DE", name: "Allianz" },
  { symbol: "DTE.DE", name: "Deutsche Telekom" }, { symbol: "MBG.DE", name: "Mercedes-Benz" }, { symbol: "BMW.DE", name: "BMW" },
  { symbol: "NESN.SW", name: "Nestlé" }, { symbol: "NOVN.SW", name: "Novartis" }, { symbol: "ROG.SW", name: "Roche" },
  { symbol: "UBSG.SW", name: "UBS" }, { symbol: "ASML.AS", name: "ASML" }, { symbol: "SHEL.L", name: "Shell" },
  { symbol: "AZN.L", name: "AstraZeneca" }, { symbol: "HSBA.L", name: "HSBC" }, { symbol: "ULVR.L", name: "Unilever" },
  { symbol: "BP.L", name: "BP" }, { symbol: "GSK.L", name: "GSK" }, { symbol: "RIO.L", name: "Rio Tinto" },
  { symbol: "DGE.L", name: "Diageo" },
  // --- Asie ---
  { symbol: "7203.T", name: "Toyota" }, { symbol: "6758.T", name: "Sony" }, { symbol: "9984.T", name: "SoftBank Group" },
  { symbol: "005930.KS", name: "Samsung Electronics" }, { symbol: "0700.HK", name: "Tencent" }, { symbol: "9988.HK", name: "Alibaba" },
];

// Petit pool de concurrence : lance `worker` sur chaque item, au plus `concurrency`
// en parallèle à la fois. Une erreur isolée sur un item n'interrompt pas les autres.
async function runPool(items, worker, concurrency) {
  let i = 0;
  async function next() {
    while (i < items.length) {
      const idx = i++;
      try { await worker(items[idx], idx); } catch { /* on continue malgré une erreur isolée */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}

// Catégories de listes prédéfinies Yahoo ("screeners") : chacune est déjà calculée
// côté Yahoo à partir de l'ensemble du marché (plusieurs milliers de titres), ce qui
// permet de couvrir un univers bien plus large que ce qu'on pourrait analyser titre
// par titre nous-mêmes (Yahoo bloquerait un balayage manuel de 10-15 000 requêtes).
const SCREENER_CATEGORIES = [
  "day_gainers", "day_losers", "most_actives", "undervalued_large_caps",
  "growth_technology_stocks", "aggressive_small_caps", "small_cap_gainers",
  "undervalued_growth_stocks", "most_shorted_stocks",
];

// Univers courant analysé/classé par le scan marché : démarre avec la liste curatée
// statique, puis s'étend avec les résultats des screeners au premier scan de la session.
let marketCandidates = [...MARKET_UNIVERSE];

async function fetchScreenerCandidates() {
  const perCategory = await Promise.all(SCREENER_CATEGORIES.map(async scrId => {
    try {
      const resp = await fetch(`/api/screener?scrId=${scrId}&count=250`);
      const data = await resp.json();
      return (!data.error && Array.isArray(data.results)) ? data.results : [];
    } catch {
      return [];
    }
  }));
  const merged = new Map(MARKET_UNIVERSE.map(m => [m.symbol, m]));
  for (const item of perCategory.flat()) {
    if (item.symbol && !merged.has(item.symbol)) merged.set(item.symbol, { symbol: item.symbol, name: item.name });
  }
  return [...merged.values()];
}

async function runMarketScan() {
  const btn = document.getElementById("btn-market-scan");
  const status = document.getElementById("market-status");
  btn.disabled = true;
  status.textContent = "Récupération des listes de marché (screeners Yahoo)…";

  marketCandidates = await fetchScreenerCandidates();
  marketCandidates.forEach(c => rememberTickerName(c.symbol, c.name));

  let done = 0;
  const total = marketCandidates.length;
  status.textContent = `Analyse en cours… 0/${total}`;

  await runPool(marketCandidates, async ({ symbol }) => {
    // Si le ticker est déjà suivi (watchlist), on garde son cache persistant à jour ;
    // sinon on utilise le cache mémoire du scan marché (voir déclaration de marketCache).
    const target = cache[symbol] ? cache : marketCache;
    const entry = target[symbol];
    if (!entry || isStale(entry)) {
      // skipRender: un scan de plusieurs milliers de valeurs ne doit pas déclencher
      // un renderAll() complet à CHAQUE ticker (coûteux, et ça écraserait le message
      // de progression) — le tableau est rafraîchi par paliers juste après.
      await analyzeTicker(symbol, null, { silent: true, skipRender: true, store: target, skipFund: true });
    }
    done++;
    // Rafraîchit l'affichage par paliers (pas à chaque ticker) pour ne pas
    // surcharger le rendu sur un univers de plusieurs milliers de valeurs.
    // renderMarketTable() seul (pas renderMarketResults()) pour ne pas écraser
    // ce message de progression avec le texte "Dernier scan..." du statut.
    if (done % 25 === 0 || done === total) {
      status.textContent = `Analyse en cours… ${done}/${total}`;
      renderMarketTable();
    }
  }, 8);

  lsSet(LS.marketScanLast, new Date().toISOString());
  btn.disabled = false;
  // renderAll() (pas seulement renderMarketResults()) : des tickers scannés peuvent
  // aussi être dans la watchlist / les picks auto, qu'on n'a pas rafraîchis pendant
  // la boucle (skipRender) pour des raisons de performance.
  renderAll();
  saveMarketCache();
  toast(`Scan du marché terminé (${total} valeurs passées en revue).`, "success");
}

// Texte "Dernier scan..." — séparé du rendu du tableau pour ne pas écraser le
// message de progression ("Analyse en cours… X/Y") pendant qu'un scan tourne.
function updateMarketStatusText() {
  const status = document.getElementById("market-status");
  const lastScan = lsGet(LS.marketScanLast, null);
  status.textContent = lastScan
    ? `Dernier scan : ${fdate(lastScan)} — ${marketCandidates.length} valeurs passées en revue`
    : "Aucun scan encore lancé.";
}

// Reconstruit uniquement le tableau de classement (n'écrase pas le texte de statut) —
// utilisé pour les rafraîchissements en cours de scan.
// Score de classement : global si le fondamental est présent (enrichi), sinon technique.
function rankScore(entry) { return entry.fundScore ? computeGlobalScore(entry) : entry.score; }

/* Colonnes fondamentales du scan : « — » tant que le titre n'a pas été enrichi
 * (bouton « ★ Enrichir le top »). Colorées selon le sous-score, comme dans l'analyse. */
function marketFundCells(entry) {
  const f = entry.fund;
  const LABELS = ["PEG", "FCF", "VE/EBITDA", "Dette nette", "Potentiel"];
  const cell = (txt, score, label) => {
    const cls = score == null ? "" : score >= 0.66 ? "pos" : score >= 0.33 ? "" : "neg";
    return `<td class="num fund-col ${cls}" data-label="${label}">${txt}</td>`;
  };
  if (!f) return LABELS.map(l => `<td class="num fund-col na" data-label="${l}">—</td>`).join("");

  const peg = f.pegRatio, ev = f.enterpriseToEbitda;
  const fcf = fcfYield(f), ndE = netDebtToEbitda(f);
  const up = fundHasConsensus(f) ? targetUpsidePct(f, entry.ind ? entry.ind.price : null) : null;

  return cell(peg == null ? "—" : fnum(peg), peg == null || peg <= 0 ? null : piecewise(peg, [[1, 1], [2, 0.5], [3, 0]]), LABELS[0])
    + cell(fcf == null ? "—" : fnum(fcf * 100) + " %", scoreFcfYield(fcf), LABELS[1])
    + cell(ev == null ? "—" : fnum(ev), ev == null || ev <= 0 ? null : piecewise(ev, [[8, 1], [12, 0.5], [18, 0]]), LABELS[2])
    + cell(ndE == null ? "—" : fnum(ndE) + "×", scoreNetDebtToEbitda(ndE), LABELS[3])
    + cell(up == null ? "—" : fpct(up), up == null ? null : scoreTargetUpside(up), LABELS[4]);
}

function renderMarketTable() {
  const tbody = document.getElementById("market-body");
  let list = marketCandidates
    .map(m => ({ ...m, entry: cache[m.symbol] || marketCache[m.symbol] }))
    .filter(m => m.entry)
    .filter(m => passesFilters(m.entry, filters.mk));
  list = sortState.mk.col
    ? sortByColumn(list, m => m.entry, sortState.mk)
    : list.sort((a, b) => rankScore(b.entry) - rankScore(a.entry));
  const ranked = list.slice(0, 30);

  tbody.innerHTML = "";
  if (typeof paintSortIndicators === "function") paintSortIndicators("market-table", "mk");
  if (ranked.length === 0) {
    tbody.innerHTML = `<tr><td colspan="15" class="na">Aucune valeur ne correspond (lancez un scan, ou assouplissez les filtres).</td></tr>`;
    return;
  }

  ranked.forEach((m, i) => {
    const tr = document.createElement("tr");
    const fs = m.entry.fundScore;
    tr.innerHTML = `
      <td class="na" data-label="Rang">#${i + 1}</td>
      <td class="card-title"><span class="cell-ticker">${esc(m.symbol)}</span></td>
      <td data-label="Entreprise">${esc(m.name)}</td>
      <td class="num" data-label="Cours">${fnum(m.entry.ind.price)}</td>
      <td class="num" data-label="Score">${m.entry.score}/100</td>
      <td class="num" data-label="Fonda">${fs ? fs.total : "—"}</td>
      <td class="num" data-label="Global">${fs ? computeGlobalScore(m.entry) : "—"}</td>
      <td data-label="Signal"><span class="signal signal-${m.entry.signal.toLowerCase()}">${m.entry.signal}</span></td>
      <td class="num ${pctClass(m.entry.ind.perf.y1)}" data-label="Perf. 1 an">${fpct(m.entry.ind.perf.y1)}</td>
      ${marketFundCells(m.entry)}
      <td class="actions-col"></td>`;

    const actions = tr.querySelector(".actions-col");
    if (watchlist.includes(m.symbol)) {
      actions.innerHTML = `<span class="muted">✓ suivi</span>`;
    } else {
      const btnAdd = document.createElement("button");
      btnAdd.className = "btn btn-small btn-accent";
      btnAdd.textContent = "+ Ajouter";
      btnAdd.addEventListener("click", () => addTickerToWatchlist(m.symbol, m.name));
      actions.appendChild(btnAdd);
    }
    tbody.appendChild(tr);
  });
}

// Rendu complet (statut + tableau) — utilisé partout SAUF pendant la boucle de
// progression d'un scan (où seul renderMarketTable() est appelé, pour ne pas
// écraser le message "Analyse en cours…").
function renderMarketResults() {
  updateMarketStatusText();
  renderMarketTable();
}

document.getElementById("btn-market-scan").addEventListener("click", runMarketScan);

// Enrichissement fondamental à la demande : récupère le fondamental des 30 titres du top
// affiché (30 requêtes, concurrence douce), puis reclasse par score global.
async function enrichMarketTop() {
  const btn = document.getElementById("btn-market-enrich");
  const status = document.getElementById("market-status");
  const ranked = marketCandidates
    .map(m => ({ ...m, entry: cache[m.symbol] || marketCache[m.symbol] }))
    .filter(m => m.entry)
    .sort((a, b) => rankScore(b.entry) - rankScore(a.entry))
    .slice(0, 100); // enrichit un vivier large ; l'affichage (top 30) est reclassé par score global

  if (ranked.length === 0) {
    toast("Lancez d'abord un scan du marché.", "warn");
    return;
  }

  btn.disabled = true;
  let done = 0, touchedCache = false;
  await runPool(ranked, async ({ symbol, entry }) => {
    if (!entry.fundScore) { // pas déjà enrichi
      let fund = null;
      try { fund = await fetchFundamentals(symbol); } catch (e) { fund = null; }
      entry.fund = fund;
      entry.fundScore = computeFundScore(fund, (entry.ind || {}).price);
      if (cache[symbol] === entry) touchedCache = true; // aussi en watchlist → persister
    }
    done++;
    status.textContent = `Enrichissement fondamental… ${done}/${ranked.length}`;
    if (done % 5 === 0 || done === ranked.length) renderMarketTable();
  }, 5);

  if (touchedCache) lsSet(LS.cache, cache);
  btn.disabled = false;
  renderMarketResults();
  saveMarketCache();
  toast(`Top ${ranked.length} enrichi avec les données fondamentales.`, "success");
}
document.getElementById("btn-market-enrich").addEventListener("click", enrichMarketTop);

renderMarketResults(); // affichage initial depuis le cache existant (watchlist déjà analysée, etc.)
loadMarketCache(); // repeuple le cache marché depuis IndexedDB (best-effort)
/* ============================= FILTRES & TRI — CÂBLAGE ============================= */

// Met à jour les indicateurs ▲/▼ sur les en-têtes triables d'un tableau.
function paintSortIndicators(tableId, scope) {
  const st = sortState[scope];
  document.querySelectorAll(`#${tableId} thead th[data-sort]`).forEach(th => {
    if (!th.dataset.label) th.dataset.label = th.textContent;
    const arrow = th.dataset.sort === st.col ? (st.dir === 1 ? " ▲" : " ▼") : "";
    th.textContent = th.dataset.label + arrow;
  });
}

// Rend les en-têtes [data-sort] cliquables : 1er clic = desc, re-clic = inverse.
function wireSortHeaders(tableId, scope, renderFn) {
  document.querySelectorAll(`#${tableId} thead th[data-sort]`).forEach(th => {
    th.classList.add("sortable");
    th.addEventListener("click", () => {
      const col = th.dataset.sort, st = sortState[scope];
      if (st.col === col) st.dir = -st.dir; else { st.col = col; st.dir = -1; }
      renderFn();
    });
  });
}

(function initFiltersAndSort() {
  // Pré-remplissage des filtres depuis l'état (persisté par profil).
  document.querySelectorAll(".js-filter").forEach(inp => {
    const { scope, key } = inp.dataset;
    if (filters[scope] && filters[scope][key] != null) inp.value = filters[scope][key];
    inp.addEventListener("input", () => {
      const raw = inp.value;
      const v = raw === "" ? null : Number(raw);
      filters[scope][key] = (v == null || isNaN(v)) ? null : v;
      saveFilters();
      scope === "wl" ? renderWatchlist() : renderMarketTable();
    });
  });
  document.querySelectorAll(".js-filter-reset").forEach(btn => {
    btn.addEventListener("click", () => {
      const scope = btn.dataset.scope;
      filters[scope] = {};
      saveFilters();
      document.querySelectorAll(`.js-filter[data-scope="${scope}"]`).forEach(i => { i.value = ""; });
      scope === "wl" ? renderWatchlist() : renderMarketTable();
    });
  });
  wireSortHeaders("watchlist-table", "wl", renderWatchlist);
  wireSortHeaders("market-table", "mk", renderMarketTable);
  // Applique un éventuel filtre déjà persisté au premier affichage.
  renderWatchlist();
  renderMarketTable();
})();
