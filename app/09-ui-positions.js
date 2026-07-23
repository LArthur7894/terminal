"use strict";

/* ============================================================================
   F2 · Positions et F3 · Simulateur d'achat.
   ============================================================================ */

/* ============================= ONGLET 2 : POSITIONS ============================= */

// Cours de référence d'une position : dernier cours en cache, sinon PRU.
let perfJournal = lsGet(LS.perfJournal, []);
if (!Array.isArray(perfJournal)) perfJournal = [];

// Enregistre la valeur du portefeuille du jour (1 point/jour). Rien si aucune position.
function recordPerfSnapshot() {
  if (!Array.isArray(perfJournal)) perfJournal = [];
  if (positions.length === 0) return;
  let value = 0;
  for (const p of positions) {
    const c = positionValueBase(p);
    if (!c.ok) return;            // au moins une position non convertible → on saute ce jour
    value += c.value;
  }
  if (!isFinite(value) || value <= 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const last = perfJournal[perfJournal.length - 1];
  if (last && last.date === today) {
    if (Math.abs(last.value - value) < 0.005) return;
    last.value = value;
  } else {
    perfJournal.push({ date: today, value });
  }
  if (perfJournal.length > 1500) perfJournal = perfJournal.slice(-1500);
  lsSet(LS.perfJournal, perfJournal);
}

function refPrice(pos) {
  const entry = cache[pos.ticker];
  return entry ? entry.ind.price : pos.pru;
}

const CURRENCY_SYMBOLS = { EUR: "€", USD: "$", GBP: "£", CHF: "CHF", CAD: "C$", JPY: "¥", AUD: "A$" };
function currencySymbol(code) { return CURRENCY_SYMBOLS[code] || code || ""; }

// Convertit un montant depuis fromCur vers la devise de référence.
// Devise inconnue (jamais analysée) → supposée en devise de réf. et incluse.
// ok=false seulement si le taux d'une devise connue n'est pas encore chargé → agrégat marqué dégradé.
function convertToBase(amount, fromCur) {
  const base = getBaseCurrency();
  if (!fromCur) return { value: amount, ok: true };     // devise inconnue → supposée en devise de réf. (incluse ; marqueur discret sur la ligne)
  if (fromCur === base) return { value: amount, ok: true };
  const r = fxRateCached(fromCur, base);
  if (r === null) return { value: null, ok: false };    // taux pas encore chargé
  return { value: amount * r, ok: true };
}

// Valeur d'une position exprimée en devise de référence.
function positionValueBase(pos) {
  return convertToBase(pos.qty * refPrice(pos), positionCurrency(pos));
}

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
  // Charger les taux de change avant le bilan : sinon une ligne en devise étrangère
  // tombe à une valeur nulle et fausse silencieusement la répartition et la santé.
  try { await ensureFxRates(); } catch (_) { /* best-effort */ }

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

function renderPositions() {
  const tbody = document.getElementById("positions-body");
  renderReviewSummary();
  tbody.innerHTML = "";

  let totalValue = 0, totalCost = 0, degraded = false;
  const base = getBaseCurrency();

  if (positions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="na">Aucune position — ajoutez-en une ci-dessus.</td></tr>`;
  }

  for (const pos of positions) {
    const price = refPrice(pos);
    const value = pos.qty * price;          // devise native
    const cost  = pos.qty * pos.pru;        // devise native
    const pnl   = value - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;

    const cur = positionCurrency(pos);
    const vConv = convertToBase(value, cur);
    const cConv = convertToBase(cost, cur);
    if (vConv.ok && cConv.ok) {
      totalValue += vConv.value;
      totalCost  += cConv.value;
    } else {
      degraded = true;                       // au moins une ligne non convertible
    }

    const noCache = !cache[pos.ticker];
    const curBadge = cur && cur !== base
      ? `<span class="cur-badge" title="Cours en ${cur}">${esc(cur)}</span>`
      : (!cur ? `<span class="cur-badge" title="Devise inconnue (jamais analysé) — supposée en devise de référence ; analysez la valeur pour la convertir au taux réel">?</span>` : "");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="card-title"><span class="cell-ticker">${esc(pos.ticker)}</span>${noCache ? `<span class="stale-badge" title="Pas de cours en cache : PRU utilisé">PRU</span>` : ""}${curBadge}</td>
      <td class="num" data-label="Qté">${fmtNum.format(pos.qty)}</td>
      <td class="num" data-label="PRU">${fnum(pos.pru)}</td>
      <td class="num" data-label="Cours">${fnum(price)}</td>
      <td class="num" data-label="Valeur">${fnum(value)}</td>
      <td class="num ${pctClass(pnl)}" data-label="P&L">${fnum(pnl)}</td>
      <td class="num ${pctClass(pnlPct)}" data-label="P&L %">${fpct(pnlPct)}</td>
      <td data-label="Verdict">${reviewVerdictCell(pos)}</td>
      <td class="num" data-label="Stop">${reviewStopCell(pos)}</td>
      <td class="actions-col"></td>`;

    const actions = tr.querySelector(".actions-col");

    const btnEdit = document.createElement("button");
    btnEdit.className = "btn btn-small btn-ghost";
    btnEdit.textContent = "✎";
    btnEdit.title = `Modifier la position ${pos.ticker}`;
    btnEdit.setAttribute("aria-label", `Modifier la position ${pos.ticker}`);
    btnEdit.addEventListener("click", () => startEditPosition(pos));
    actions.appendChild(btnEdit);

    const btnDel = document.createElement("button");
    btnDel.className = "btn btn-small btn-ghost btn-danger";
    btnDel.textContent = "✕";
    btnDel.title = `Supprimer la position ${pos.ticker}`;
    btnDel.setAttribute("aria-label", `Supprimer la position ${pos.ticker}`);
    btnDel.addEventListener("click", () => {
      positions = positions.filter(p => p.id !== pos.id);
      lsSet(LS.positions, positions);
      renderAll();
    });
    actions.appendChild(btnDel);

    tbody.appendChild(tr);
    const detail = reviewDetailRow(pos);
    if (detail) tbody.appendChild(detail);
  }

  // Ligne de total — exprimée en devise de référence
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const sym = currencySymbol(base);
  const suffix = degraded ? ` ${sym} ⚠` : ` ${sym}`;
  const degradedTitle = degraded
    ? "Certaines positions n'ont pas pu être converties (devise inconnue ou taux indisponible) et sont exclues du total."
    : "";
  const elVal = document.getElementById("total-value");
  elVal.textContent = fnum(totalValue) + suffix;
  elVal.title = degradedTitle;
  const elPnl = document.getElementById("total-pnl");
  const elPct = document.getElementById("total-pnl-pct");
  elPnl.textContent = fnum(totalPnl) + suffix;
  elPct.textContent = fpct(totalPnlPct) + (degraded ? " ⚠" : "");
  elPnl.title = degradedTitle;
  elPct.title = degradedTitle;
  elPnl.className = "num " + pctClass(totalPnl);
  elPct.className = "num " + pctClass(totalPnl);

  renderAllocationChart();
  recordPerfSnapshot();
  renderPerfJournal();
}

let perfChart = null;

function renderPerfJournal() {
  const statsEl = document.getElementById("perf-stats");
  const canvas = document.getElementById("perf-canvas");
  if (!statsEl) return;

  if (perfChart) { perfChart.destroy(); perfChart = null; }

  if (!perfJournal.length) {
    statsEl.innerHTML = `<p class="analysis-empty">Aucun historique pour l'instant. Ajoutez des positions : la courbe se construira à chaque ouverture (1 point/jour).</p>`;
    return;
  }

  const first = perfJournal[0].value, cur = perfJournal[perfJournal.length - 1].value;
  const chg = cur - first, chgPct = first > 0 ? (chg / first) * 100 : 0;
  const vals = perfJournal.map(p => p.value);
  const hi = Math.max(...vals), lo = Math.min(...vals);
  statsEl.innerHTML = `
    <div><dt>Valeur actuelle</dt><dd>${fnum(cur)} €</dd></div>
    <div><dt>Depuis le début</dt><dd class="${pctClass(chg)}">${fnum(chg)} € (${fpct(chgPct)})</dd></div>
    <div><dt>Plus haut</dt><dd>${fnum(hi)} €</dd></div>
    <div><dt>Plus bas</dt><dd>${fnum(lo)} €</dd></div>`;

  if (perfJournal.length < 2 || typeof Chart === "undefined") return;
  perfChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: perfJournal.map(p => fdateShort(p.date)),
      datasets: [{ data: vals, borderColor: "#ffb000", backgroundColor: "rgba(255,176,0,0.08)", borderWidth: 2, pointRadius: 0, tension: 0.15, fill: true }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fnum(ctx.parsed.y) + " €" } } },
      scales: {
        x: { ticks: { color: "#7b8794", maxTicksLimit: 6, font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: "#1a2028" } },
        y: { ticks: { color: "#7b8794", font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: "#1a2028" } },
      },
    },
  });
}

document.getElementById("btn-perf-clear").addEventListener("click", () => {
  if (!window.confirm("Effacer l'historique de performance du portefeuille ?")) return;
  perfJournal = []; lsSet(LS.perfJournal, perfJournal); renderPerfJournal();
});

// Passage du formulaire en mode "édition"
function startEditPosition(pos) {
  editingPositionId = pos.id;
  document.getElementById("pos-ticker").value = pos.ticker;
  document.getElementById("pos-qty").value = pos.qty;
  document.getElementById("pos-pru").value = pos.pru;
  document.getElementById("btn-position-submit").textContent = "✓ Enregistrer";
  document.getElementById("btn-position-cancel").classList.remove("hidden");
  document.getElementById("pos-ticker").focus();
}

function resetPositionForm() {
  editingPositionId = null;
  document.getElementById("form-add-position").reset();
  document.getElementById("btn-position-submit").textContent = "+ Ajouter";
  document.getElementById("btn-position-cancel").classList.add("hidden");
}

document.getElementById("btn-position-cancel").addEventListener("click", resetPositionForm);

document.getElementById("form-add-position").addEventListener("submit", e => {
  e.preventDefault();
  const ticker = document.getElementById("pos-ticker").value.trim().toUpperCase();
  const qty = parseFloat(document.getElementById("pos-qty").value);
  const pru = parseFloat(document.getElementById("pos-pru").value);

  if (!/^[A-Z0-9.\-]{1,12}$/.test(ticker)) { toast("Ticker invalide.", "error"); return; }
  if (!isFinite(qty) || qty <= 0)          { toast("Quantité invalide.", "error"); return; }
  if (!isFinite(pru) || pru <= 0)          { toast("PRU invalide.", "error"); return; }

  if (editingPositionId !== null) {
    const pos = positions.find(p => p.id === editingPositionId);
    if (pos) { pos.ticker = ticker; pos.qty = qty; pos.pru = pru; }
  } else {
    positions.push({ id: newPositionId(), ticker, qty, pru });
  }
  lsSet(LS.positions, positions);
  resetPositionForm();
  renderAll();
});

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

// Camembert de répartition (Chart.js)
function renderAllocationChart() {
  const canvas = document.getElementById("allocation-chart");
  if (!canvas || typeof Chart === "undefined") return;

  const base = getBaseCurrency();
  const conv = positions
    .map(p => ({ ticker: p.ticker, c: positionValueBase(p) }))
    .filter(x => x.c.ok && isFinite(x.c.value) && x.c.value > 0);
  const labels = conv.map(x => x.ticker);
  const values = conv.map(x => x.c.value);

  // Palette dérivée du thème
  const colors = ["#ffb000", "#2ecc71", "#4aa8ff", "#ff4d4d", "#b87f0a", "#9b59b6", "#1abc9c", "#e67e22"];

  if (allocationChart) allocationChart.destroy();
  if (conv.length === 0) return;

  allocationChart = new Chart(canvas, {
    type: "pie",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: labels.map((_, i) => colors[i % colors.length]),
        borderColor: "#12161b",
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#d7dde3", font: { family: "'IBM Plex Mono', monospace", size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label} : ${fmtNum.format(ctx.parsed)} ${currencySymbol(base)} (${fmtNum.format(ctx.parsed / values.reduce((a, b) => a + b, 0) * 100)} %)`,
          },
        },
      },
    },
  });
}

/* ============================= ONGLET 3 : SIMULATEUR D'ACHAT ============================= */

attachTickerAutocomplete(
  document.getElementById("buysim-ticker"),
  document.getElementById("buysim-suggestions"),
  item => {
    document.getElementById("buysim-ticker").value = item.symbol;
    rememberTickerName(item.symbol, item.name);
  }
);

document.getElementById("form-buysim").addEventListener("submit", async e => {
  e.preventDefault();
  const ticker = document.getElementById("buysim-ticker").value.trim().toUpperCase();
  const amount = parseFloat(document.getElementById("buysim-amount").value);

  if (!/^[A-Z0-9.\-]{1,12}$/.test(ticker)) { toast("Ticker invalide.", "error"); return; }
  if (!isFinite(amount) || amount <= 0) { toast("Montant invalide.", "error"); return; }

  let entry = cache[ticker];
  if (!entry) {
    toast(`${ticker} n'est pas encore en cache — analyse en cours…`, "info");
    await analyzeTicker(ticker, null, { silent: true });
    entry = cache[ticker];
  }
  if (!entry) { toast(`Impossible de récupérer un cours pour ${ticker}.`, "error"); return; }

  renderBuysimResult(ticker, entry.ind.price, amount);
});

// Calcule et affiche l'impact d'un achat simulé : nouvelle quantité, nouveau PRU
// (moyenne pondérée si la position existe déjà), poids dans le portefeuille, P&L.
function renderBuysimResult(ticker, price, amount) {
  const qtyBought = amount / price;
  const existing = positions.find(p => p.ticker === ticker);

  const oldQty = existing ? existing.qty : 0;
  const oldPru = existing ? existing.pru : null;
  const oldValue = oldQty * price;

  const newQty = oldQty + qtyBought;
  const newPru = existing ? (existing.qty * existing.pru + amount) / newQty : price;
  const newValue = newQty * price;

  const totalBefore = positions.reduce((s, p) => s + p.qty * refPrice(p), 0);
  const totalAfter = totalBefore + amount;

  const weightBefore = totalBefore > 0 ? (oldValue / totalBefore) * 100 : 0;
  const weightAfter = totalAfter > 0 ? (newValue / totalAfter) * 100 : 0;

  const pnlBefore = existing ? (price - oldPru) * oldQty : 0;
  const pnlAfter = (price - newPru) * newQty;

  lastBuysimResult = { ticker, price, amount };

  const result = document.getElementById("buysim-result");
  result.innerHTML = `
    <h2>Impact simulé — ${esc(ticker)}</h2>
    <dl class="impact-grid">
      <div><dt>Prix utilisé</dt><dd>${fnum(price)}</dd></div>
      <div><dt>Quantité achetée</dt><dd>${fmtNum.format(qtyBought)}</dd></div>
      <div><dt>Nouveau PRU</dt><dd>${fnum(newPru)}${existing ? ` <span class="muted">(était ${fnum(oldPru)})</span>` : ""}</dd></div>
      <div><dt>Poids portefeuille</dt><dd>${fmtNum.format(weightAfter)} % <span class="muted">(${existing ? fmtNum.format(weightBefore) : "0"} % avant)</span></dd></div>
    </dl>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th></th><th class="num">Avant</th><th class="num">Après</th></tr></thead>
        <tbody>
          <tr><td>Quantité</td><td class="num">${existing ? fmtNum.format(oldQty) : "—"}</td><td class="num">${fmtNum.format(newQty)}</td></tr>
          <tr><td>Valeur de la ligne</td><td class="num">${existing ? fnum(oldValue) : "—"}</td><td class="num">${fnum(newValue)}</td></tr>
          <tr><td>P&amp;L de la ligne</td><td class="num ${pctClass(pnlBefore)}">${existing ? fnum(pnlBefore) : "—"}</td><td class="num ${pctClass(pnlAfter)}">${fnum(pnlAfter)}</td></tr>
          <tr><td>Valeur totale portefeuille</td><td class="num">${fnum(totalBefore)}</td><td class="num">${fnum(totalAfter)}</td></tr>
        </tbody>
      </table>
    </div>
    <p class="hint">${existing ? "Position existante : le PRU est recalculé en moyenne pondérée." : "Nouvelle ligne : elle n'existe pas encore dans vos positions."}</p>
    <button type="button" class="btn btn-accent" id="btn-buysim-apply">✓ Appliquer cet achat à mes positions</button>`;
  document.getElementById("btn-buysim-apply").addEventListener("click", applyBuysim);
}

// Transforme la simulation en position réelle (créée ou mise à jour).
function applyBuysim() {
  if (!lastBuysimResult) return;
  const { ticker, price, amount } = lastBuysimResult;
  applyPurchase(ticker, price, amount);
  lsSet(LS.positions, positions);
  renderAll();
  toast(`Achat appliqué : ${ticker} mis à jour dans vos positions.`, "success");

  lastBuysimResult = null;
  document.getElementById("buysim-result").innerHTML =
    `<p class="analysis-empty">Achat appliqué. Lancez une nouvelle simulation si besoin.</p>`;
}

MODULES_CHARGES.push("09-ui-positions");   // doit rester la dernière ligne du fichier
