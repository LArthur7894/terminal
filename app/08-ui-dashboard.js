"use strict";

/* ============================================================================
   F1 · Dashboard : watchlist, filtres, meilleures opportunités, bandeau.
   ============================================================================ */

/* ============================= ONGLET 1 : DASHBOARD ============================= */

// Filtre texte de la watchlist (page 1) : recherche par ticker ou nom d'entreprise,
// utile dès qu'il y a beaucoup de lignes à retrouver.
let watchlistFilterQuery = "";

function matchesWatchlistFilter(ticker) {
  if (!watchlistFilterQuery) return true;
  const q = watchlistFilterQuery.toLowerCase();
  const name = (tickerNames[ticker] || "").toLowerCase();
  return ticker.toLowerCase().includes(q) || name.includes(q);
}

/* ============================= FILTRES & TRI ============================= */

// Extracteurs de valeur par colonne : (entry) -> nombre ou null (null = trié en bas / non filtrable).
const COLUMN_VALUE = {
  price:  e => e.ind ? e.ind.price : null,
  change: e => e.ind ? e.ind.changePct : null,
  rsi:    e => e.ind ? e.ind.rsi : null,
  score:  e => (e.score != null ? e.score : null),
  fonda:  e => (e.fundScore ? e.fundScore.total : null),
  global: e => (e.score != null ? computeGlobalScore(e) : null),
  perf1y: e => (e.ind && e.ind.perf ? e.ind.perf.y1 : null),
  // Fondamentaux avancés : null tant que le titre n'a pas été enrichi (trié en bas).
  peg:    e => (e.fund ? e.fund.pegRatio : null),
  fcf:    e => (e.fund ? fcfYield(e.fund) : null),
  evEbitda: e => (e.fund ? e.fund.enterpriseToEbitda : null),
  netDebt:  e => (e.fund ? netDebtToEbitda(e.fund) : null),
  upside:   e => (e.fund && fundHasConsensus(e.fund) ? targetUpsidePct(e.fund, e.ind ? e.ind.price : null) : null),
};

// Trie une liste selon COLUMN_VALUE[state.col] ; nulls toujours en bas quel que soit le sens.
function sortByColumn(list, getEntry, state) {
  if (!state.col || !COLUMN_VALUE[state.col]) return list;
  const val = COLUMN_VALUE[state.col];
  return [...list].sort((a, b) => {
    const va = val(getEntry(a)), vb = val(getEntry(b));
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * state.dir;
  });
}

// Un filtre fondamental (PER, dividende, fonda, global) est-il actif ?
function hasActiveFundFilter(f) {
  return f.globalMin != null || f.fondaMin != null || f.perMax != null || f.divMin != null;
}

// Prédicat de filtre. Un critère fondamental actif rejette une entrée sans la donnée.
function passesFilters(entry, f) {
  if (!entry) return false;
  if (f.globalMin != null) {
    const g = entry.score != null ? computeGlobalScore(entry) : null;
    if (g == null || g < f.globalMin) return false;
  }
  if (f.fondaMin != null) {
    const v = entry.fundScore ? entry.fundScore.total : null;
    if (v == null || v < f.fondaMin) return false;
  }
  if (f.perMax != null) {
    const v = entry.fund ? entry.fund.trailingPE : null;
    if (v == null || v > f.perMax) return false;
  }
  if (f.divMin != null) {
    const v = entry.fund ? entry.fund.dividendYield : null; // fraction
    if (v == null || v * 100 < f.divMin) return false;       // divMin exprimé en %
  }
  return true;
}

function renderWatchlist() {
  const tbody = document.getElementById("watchlist-body");
  tbody.innerHTML = "";
  if (typeof paintSortIndicators === "function") paintSortIndicators("watchlist-table", "wl");

  if (watchlist.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13" class="na">Watchlist vide — ajoutez un ticker ci-dessus (ex. AAPL, MSFT, MC.PA, TTE.PA).</td></tr>`;
    return;
  }

  let filtered = watchlist.filter(matchesWatchlistFilter);
  // Filtre numérique : un titre non analysé (sans cache) est masqué si un filtre fondamental est actif.
  filtered = filtered.filter(t => cache[t] ? passesFilters(cache[t], filters.wl) : !hasActiveFundFilter(filters.wl));
  // Tri par colonne (si actif).
  filtered = sortByColumn(filtered, t => cache[t] || {}, sortState.wl);
  if (filtered.length === 0) {
    const why = watchlistFilterQuery ? `pour « ${esc(watchlistFilterQuery)} »` : "avec les filtres actifs";
    tbody.innerHTML = `<tr><td colspan="13" class="na">Aucun résultat ${why}.</td></tr>`;
    return;
  }

  for (const ticker of filtered) {
    const entry = cache[ticker];
    const tr = document.createElement("tr");

    if (entry) {
      const { ind, score, signal } = entry;
      const stale = isStale(entry) ? `<span class="stale-badge" title="Données de plus de 24 h">cache</span>` : "";
      tr.innerHTML = `
        <td class="card-title">${tickerCellHtml(ticker)}${stale}</td>
        <td class="num" data-label="Cours">${fnum(ind.price)}</td>
        <td class="num ${pctClass(ind.changePct)}" data-label="Var. %">${fpct(ind.changePct)}</td>
        <td class="num mobile-hide ${ind.rsi !== null && ind.rsi <= 30 ? "up" : ind.rsi >= 70 ? "down" : ""}" data-label="RSI 14">${ind.rsi === null ? "—" : fmtNum.format(ind.rsi)}</td>
        <td class="num mobile-hide" data-label="SMA 50">${fnum(ind.sma50)}</td>
        <td class="num mobile-hide" data-label="SMA 200">${fnum(ind.sma200)}</td>
        <td class="mobile-hide" data-label="Range 52 sem.">
          <div class="range52">
            <span>${fnum(ind.low52)}</span>
            <span class="range-bar"><span class="range-dot" style="left:${(ind.rangePos * 100).toFixed(1)}%"></span></span>
            <span>${fnum(ind.high52)}</span>
          </div>
        </td>
        <td class="num" data-label="Score">
          <span class="score-cell">
            <span class="score-bar"><span class="score-fill" style="width:${score}%"></span></span>
            <span>${score}</span>
          </span>
        </td>
        <td class="num" data-label="Fonda">${entry.fundScore ? entry.fundScore.total : "—"}</td>
        <td class="num" data-label="Global">
          <span class="score-cell">
            <span class="score-bar"><span class="score-fill" style="width:${computeGlobalScore(entry)}%"></span></span>
            <span>${computeGlobalScore(entry)}</span>
          </span>
        </td>
        <td data-label="Signal"><span class="signal signal-${signal.toLowerCase()}">${signal}</span></td>
        <td class="na mobile-hide" data-label="MàJ">${fdate(entry.updated)}</td>
        <td class="actions-col"></td>`;
    } else {
      tr.innerHTML = `
        <td class="card-title">${tickerCellHtml(ticker)}</td>
        <td class="num na" data-label="Cours">—</td><td class="num na" data-label="Var. %">—</td><td class="num na mobile-hide" data-label="RSI 14">—</td>
        <td class="num na mobile-hide" data-label="SMA 50">—</td><td class="num na mobile-hide" data-label="SMA 200">—</td><td class="na mobile-hide" data-label="Range 52 sem.">—</td>
        <td class="num na" data-label="Score">—</td><td class="num na" data-label="Fonda">—</td><td class="num na" data-label="Global">—</td><td class="na" data-label="Signal">—</td><td class="na mobile-hide" data-label="MàJ">jamais</td>
        <td class="actions-col"></td>`;
    }

    // Boutons d'action (créés en JS pour attacher proprement les handlers)
    const actions = tr.querySelector(".actions-col");

    const btnAnalyze = document.createElement("button");
    btnAnalyze.className = "btn btn-small btn-accent";
    btnAnalyze.textContent = "Analyser";
    btnAnalyze.title = "1 requête Yahoo Finance (gratuit, sans quota)";
    btnAnalyze.addEventListener("click", () => analyzeTicker(ticker, btnAnalyze));
    actions.appendChild(btnAnalyze);

    const btnRemove = document.createElement("button");
    btnRemove.className = "btn btn-small btn-ghost btn-danger";
    btnRemove.textContent = "✕";
    btnRemove.title = `Retirer ${ticker} de la watchlist`;
    btnRemove.setAttribute("aria-label", `Retirer ${ticker} de la watchlist`);
    btnRemove.addEventListener("click", () => {
      watchlist = watchlist.filter(t => t !== ticker);
      lsSet(LS.watchlist, watchlist);
      renderAll();
    });
    actions.appendChild(btnRemove);

    tbody.appendChild(tr);
  }
}

// Ajoute un ticker à la watchlist (réutilisé par le formulaire et l'onglet Marché).
// Pas de limite de taille : Yahoo Finance (source par défaut) est gratuit et illimité.
// Mémorise le nom d'une entreprise pour un ticker (affichage plus lisible que le seul
// symbole boursier). Persisté par profil, réutilisé partout où le ticker est affiché.
function rememberTickerName(ticker, name) {
  if (!ticker || !name || tickerNames[ticker] === name) return;
  tickerNames[ticker] = name;
  lsSet(LS.tickerNames, tickerNames);
}

// Résolution best-effort en tâche de fond quand on ne connaît pas encore le nom
// (ex. ticker tapé à la main sans passer par la recherche). Ne bloque rien, échoue
// silencieusement si le serveur n'est pas disponible (mode file://, etc.).
async function resolveTickerName(ticker) {
  if (tickerNames[ticker] || location.protocol === "file:") return;
  try {
    const resp = await fetch("/api/search?q=" + encodeURIComponent(ticker));
    const data = await resp.json();
    if (data.error || !Array.isArray(data.results)) return;
    const match = data.results.find(r => r.symbol === ticker) || data.results[0];
    if (match) { rememberTickerName(ticker, match.name); renderAll(); }
  } catch { /* best-effort : pas grave si ça échoue */ }
}

// Affiche "Nom (TICKER)" si le nom est connu, sinon juste le ticker.
function tickerDisplayName(ticker) {
  return tickerNames[ticker] || null;
}

// Cellule ticker + nom d'entreprise (sur 2 lignes) si le nom est connu, sinon le ticker seul.
function tickerCellHtml(ticker) {
  const name = tickerDisplayName(ticker);
  return `<span class="cell-ticker">${esc(ticker)}</span>${name ? `<div class="cell-company">${esc(name)}</div>` : ""}`;
}

function addTickerToWatchlist(ticker, name) {
  if (!ticker || !/^[A-Z0-9.\-]{1,12}$/.test(ticker)) {
    toast("Format de ticker invalide (lettres, chiffres, points et tirets uniquement).", "error");
    return false;
  }
  if (watchlist.includes(ticker)) {
    toast(`${ticker} est déjà dans la watchlist.`, "warn");
    return false;
  }
  watchlist.push(ticker);
  lsSet(LS.watchlist, watchlist);
  // Promotion : si le ticker a déjà été analysé via le scan marché (cache mémoire),
  // on récupère cette analyse dans le cache persistant plutôt que de la refaire.
  if (marketCache[ticker] && !cache[ticker]) {
    cache[ticker] = marketCache[ticker];
    lsSet(LS.cache, cache);
  }
  if (name) rememberTickerName(ticker, name);
  else resolveTickerName(ticker);
  renderAll();
  return true;
}

document.getElementById("watchlist-filter").addEventListener("input", e => {
  watchlistFilterQuery = e.target.value.trim();
  renderWatchlist();
});

document.getElementById("form-add-ticker").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("input-ticker");
  const ticker = input.value.trim().toUpperCase();
  if (!ticker) return;
  if (addTickerToWatchlist(ticker)) input.value = "";
});

/* ============================= MEILLEURES OPPORTUNITÉS (SÉLECTION HORAIRE) ============================= */

const AUTO_PICK_INTERVAL_MS = 3600_000; // 1 heure

// Meilleurs tickers de la watchlist en cache dont le signal est "Achat", triés par score.
// Pas de limite par défaut : autant d'opportunités que la watchlist en contient.
function computeTopPicks(limit = Infinity) {
  return watchlist
    .map(t => ({ ticker: t, entry: cache[t] }))
    .filter(x => x.entry && x.entry.signal === "Achat")
    .sort((a, b) => computeGlobalScore(b.entry) - computeGlobalScore(a.entry))
    .slice(0, limit);
}

function renderAutopick() {
  const meta = document.getElementById("autopick-meta");
  const body = document.getElementById("autopick-body");
  const lastRun = lsGet(LS.autopickLast, null);

  if (lastRun) {
    const next = new Date(new Date(lastRun).getTime() + AUTO_PICK_INTERVAL_MS);
    meta.textContent = `MàJ ${fdate(lastRun)} — prochaine vers ${next.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  } else {
    meta.textContent = "Première analyse en cours…";
  }

  body.innerHTML = "";
  if (watchlist.length === 0) {
    body.innerHTML = `<p class="autopick-empty">Ajoutez des tickers à la watchlist pour activer la sélection automatique.</p>`;
    return;
  }

  const picks = computeTopPicks();
  if (picks.length === 0) {
    body.innerHTML = `<p class="autopick-empty">Aucun signal d'achat clair (score ≥ 65) actuellement dans la watchlist.</p>`;
    return;
  }

  picks.forEach((p, i) => {
    const div = document.createElement("div");
    div.className = "autopick-item";
    div.innerHTML = `
      <span class="ap-rank">#${i + 1}</span>
      <span class="ap-ticker">${esc(p.ticker)}</span>
      ${tickerDisplayName(p.ticker) ? `<span class="muted">${esc(tickerDisplayName(p.ticker))}</span>` : ""}
      <span class="ap-score">${p.entry.score}/100</span>
      <span class="signal signal-achat">Achat</span>
      <span class="muted">${fnum(p.entry.ind.price)}</span>`;
    body.appendChild(div);
  });
}

// Réanalyse toute la watchlist pour rafraîchir la sélection. Yahoo étant sans quota,
// ce rafraîchissement peut tourner en tâche de fond sans rien consommer de précieux.
async function runAutoPick() {
  if (watchlist.length === 0) { renderAutopick(); return; }

  for (const ticker of watchlist) {
    await analyzeTicker(ticker, null, { silent: true });
    await new Promise(r => setTimeout(r, 400)); // éviter de saturer Yahoo Finance
  }
  lsSet(LS.autopickLast, new Date().toISOString());

  const picks = computeTopPicks();
  toast(picks.length
    ? `Sélection auto mise à jour : ${picks.map(p => p.ticker).join(", ")}.`
    : "Sélection auto mise à jour : aucun signal d'achat clair actuellement.", "success");
  renderAutopick();
}

// Affichage immédiat depuis le cache, puis rafraîchissement si la dernière analyse
// auto date de plus d'une heure (ou n'a jamais eu lieu). Ensuite, un rafraîchissement
// toutes les heures tant que l'onglet reste ouvert.
renderAutopick();
{
  const lastAutoRun = lsGet(LS.autopickLast, null);
  const autopickDue = !lastAutoRun || (Date.now() - new Date(lastAutoRun).getTime()) >= AUTO_PICK_INTERVAL_MS;
  if (autopickDue) runAutoPick();
}
setInterval(runAutoPick, AUTO_PICK_INTERVAL_MS);

/* ============================= BANDEAU DÉFILANT ============================= */

function renderTape() {
  const track = document.getElementById("tape-track");
  const items = watchlist
    .filter(t => cache[t])
    .map(t => {
      const ind = cache[t].ind;
      const cls = ind.changePct > 0 ? "up" : ind.changePct < 0 ? "down" : "";
      const arrow = ind.changePct > 0 ? "▲" : ind.changePct < 0 ? "▼" : "◆";
      return `<span class="tape-item"><span class="t-sym">${esc(t)}</span><span class="t-px">${fnum(ind.price)}</span><span class="${cls}">${arrow} ${fpct(ind.changePct)}</span></span>`;
    });

  if (items.length === 0) {
    track.innerHTML = `<span class="tape-empty">— Ajoutez des tickers à la watchlist puis lancez une analyse pour alimenter le bandeau —</span>`;
    return;
  }
  // Contenu dupliqué pour un défilement continu sans "trou"
  track.innerHTML = items.join("") + items.join("");
}
