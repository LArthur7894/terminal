"use strict";

/* ============================================================================
   F7 · Alertes et F8 · Bot, avec la boucle intraday du bot.
   ============================================================================ */

/* ============================= ONGLET 7 : ALERTES — UI ============================= */

// Options de direction + valeur par défaut selon le type choisi.
function updateAlertFormOptions() {
  const type = document.getElementById("alert-type").value;
  const dir = document.getElementById("alert-direction");
  const val = document.getElementById("alert-value");
  const opts = {
    price:  [["above", "au-dessus de"], ["below", "en dessous de"]],
    global: [["above", "≥"], ["below", "≤"]],
    rsi:    [["oversold", "survente (≤)"], ["overbought", "surachat (≥)"]],
    change: [["move", "|variation| ≥"]],
  }[type];
  dir.innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("");
  const defVal = { price: "", global: "70", rsi: "30", change: "5" }[type];
  val.value = defVal;
}

function renderAlerts() {
  // Formulaire : liste des tickers de la watchlist.
  const tickerSel = document.getElementById("alert-ticker");
  if (tickerSel) {
    const cur = tickerSel.value;
    tickerSel.innerHTML = watchlist.length
      ? watchlist.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("")
      : `<option value="">— watchlist vide —</option>`;
    if (watchlist.includes(cur)) tickerSel.value = cur;
  }
  // Liste des alertes.
  const list = document.getElementById("alerts-list");
  if (list) {
    if (alerts.length === 0) {
      list.innerHTML = `<p class="analysis-empty">Aucune alerte. Ajoutez-en une ci-dessus.</p>`;
    } else {
      list.innerHTML = alerts.map(a => `
        <div class="alert-item ${a.triggeredAt ? "triggered" : ""}">
          <span class="alert-ticker">${esc(a.ticker)}</span>
          <span class="alert-cond">${esc(alertLabel(a))}</span>
          <span class="alert-state">${a.triggeredAt ? "🔔 Déclenchée " + fdate(a.triggeredAt) : (a.enabled ? "Active" : "Désactivée")}</span>
          <label class="alert-toggle"><input type="checkbox" class="js-alert-toggle" data-id="${a.id}" ${a.enabled ? "checked" : ""}> active</label>
          <button type="button" class="btn btn-small btn-ghost js-alert-del" data-id="${a.id}">✕</button>
        </div>`).join("");
    }
  }
  // Journal.
  const log = document.getElementById("alerts-log");
  if (log) {
    log.innerHTML = alertLog.length
      ? alertLog.map(l => `<div class="alert-log-row">🔔 <strong>${esc(l.ticker)}</strong> — ${esc(l.label)} <span class="muted">${esc(fdate(l.at))}</span></div>`).join("")
      : `<p class="analysis-empty">Aucun déclenchement dans cette session.</p>`;
  }
}

document.getElementById("alert-type").addEventListener("change", updateAlertFormOptions);

document.getElementById("form-alert").addEventListener("submit", e => {
  e.preventDefault();
  const ticker = document.getElementById("alert-ticker").value;
  const type = document.getElementById("alert-type").value;
  const direction = document.getElementById("alert-direction").value;
  const value = Number(document.getElementById("alert-value").value);
  if (!ticker) { toast("Ajoutez d'abord un ticker à la watchlist.", "warn"); return; }
  if (!isFinite(value)) { toast("Entrez une valeur numérique.", "error"); return; }
  alerts.push({ id: newAlertId(), ticker, type, direction, value, enabled: true, triggeredAt: null });
  saveAlerts();
  renderAlerts();
  checkAlerts(); // évaluation immédiate
  toast(`Alerte ajoutée : ${ticker} — ${alertLabel(alerts[alerts.length - 1])}.`, "success");
});

document.getElementById("alerts-list").addEventListener("click", e => {
  const del = e.target.closest(".js-alert-del");
  if (del) {
    alerts = alerts.filter(a => a.id !== Number(del.dataset.id));
    saveAlerts(); renderAlerts();
  }
});
document.getElementById("alerts-list").addEventListener("change", e => {
  const tog = e.target.closest(".js-alert-toggle");
  if (tog) {
    const a = alerts.find(x => x.id === Number(tog.dataset.id));
    if (a) { a.enabled = tog.checked; a.triggeredAt = null; saveAlerts(); checkAlerts(); }
  }
});

updateAlertFormOptions();
renderAlerts();

/* ============================= ONGLET 8 : BOT — UI ============================= */

// Stop, cible et taille ne sont plus réglables : ils sont calculés par titre (botProfile).
// Seuls restent pilotables le capital, le risque, les plafonds, les frais et la boucle.
const BOT_CONFIG_FIELDS = [
  ["capital", "Capital (€)", 100],
  ["riskPerTradePct", "Risque par trade (%)", 0.1],
  ["maxPositionPct", "Plafond par position (%)", 1],
  ["maxMarketPct", "Plafond par marché (%)", 5],
  ["qualityMin", "Score d'achat mini", 1],
  ["exitScore", "Score de sortie", 1],
  ["feePct", "Frais (%)", 0.01],
  ["slipPct", "Slippage (%)", 0.01],
  ["loopMinutes", "Boucle auto (minutes)", 1],
];

function botCurrentPrice(ticker, fallback) {
  const e = cache[ticker] || marketCache[ticker];
  return (e && e.ind && e.ind.price > 0) ? e.ind.price : fallback;
}

let botEquityChart = null;

const BOT_MARKET_LABEL = { EU: "🇪🇺 Europe", US: "🇺🇸 US", ASIA: "🇯🇵 Asie" };

// « 1 h 12 » / « 43 min » — délai lisible avant la prochaine ouverture.
function botFmtDelay(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

function renderBotSession() {
  const el = document.getElementById("bot-session");
  if (!el) return;
  const open = botOpenMarkets();
  const sessions = ["EU", "US", "ASIA"].map(m => {
    if (open.has(m)) return `<span class="sess open">${BOT_MARKET_LABEL[m]} ouverte</span>`;
    return `<span class="sess closed">${BOT_MARKET_LABEL[m]} ouvre dans ${botFmtDelay(botNextOpen(m))}</span>`;
  }).join("");

  const prochaine = (bot.started && botNextRunAt)
    ? `prochaine évaluation à ${botNextRunAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
    : (bot.started ? "boucle en pause (onglet en arrière-plan)" : "bot à l'arrêt");

  el.innerHTML = `${sessions}
    <label class="loop-toggle">
      <input type="checkbox" class="js-bot-cfg" data-key="autoLoop" ${bot.config.autoLoop ? "checked" : ""}>
      Boucle auto (${bot.config.loopMinutes} min) — ${esc(prochaine)}
    </label>`;
}

// Barres d'exposition par marché, avec le plafond en repère.
function renderBotExposure(total) {
  const expo = {};
  for (const p of bot.positions) {
    expo[p.market] = (expo[p.market] || 0) + p.qty * botCurrentPrice(p.ticker, p.entryPrice);
  }
  const marches = Object.keys(expo);
  if (!marches.length || total <= 0) return "";
  const rows = marches.sort().map(m => {
    const pct = (expo[m] / total) * 100;
    const depasse = pct > bot.config.maxMarketPct;
    return `<div class="bot-expo-row">
      <span>${esc(m)}</span>
      <span class="bot-expo-bar"><i class="${depasse ? "over" : ""}" style="width:${Math.min(100, pct).toFixed(1)}%"></i></span>
      <span class="num">${fpct(pct).replace("+", "")}</span>
    </div>`;
  }).join("");
  return `<div class="bot-expo">${rows}
    <p class="hint">Plafond ${bot.config.maxMarketPct} % par marché, ${bot.config.maxPositionPct} % par position.</p></div>`;
}

function renderBotStats() {
  const el = document.getElementById("bot-stats");
  if (!el) return;
  const s = botStats(bot.history, bot.equity);

  if (!s.n && bot.equity.length < 2) {
    el.innerHTML = `<p class="analysis-empty">Pas encore assez d'historique. Les statistiques apparaîtront après les premiers trades clôturés.</p>`;
    if (botEquityChart) { botEquityChart.destroy(); botEquityChart = null; }
    return;
  }

  const pf = s.profitFactor === Infinity ? "∞" : fnum(s.profitFactor);
  el.innerHTML = `<dl class="impact-grid">
    <div><dt>Performance totale</dt><dd class="${pctClass(s.totalPct)}">${fpct(s.totalPct)}</dd></div>
    <div><dt>Drawdown maximum</dt><dd class="neg">−${fnum(s.drawdownPct)} %</dd></div>
    <div><dt>Taux de réussite</dt><dd>${Math.round(s.winRate * 100)} %</dd></div>
    <div><dt>Profit factor</dt><dd>${pf}</dd></div>
    <div><dt>Gain moyen</dt><dd class="pos">${fnum(s.avgWin)} €</dd></div>
    <div><dt>Perte moyenne</dt><dd class="neg">${fnum(s.avgLoss)} €</dd></div>
    <div><dt>Espérance / trade</dt><dd class="${pctClass(s.expectancy)}">${fnum(s.expectancy)} €</dd></div>
    <div><dt>Trades clôturés</dt><dd>${s.n}</dd></div>
  </dl>
  ${botGroupTable("Par marché", s.byMarket)}
  ${botGroupTable("Par famille", s.byFamily)}
  ${botGroupTable("Par raison de sortie", s.byReason)}`;

  renderBotEquityChart();
}

function botGroupTable(titre, groupe) {
  const cles = Object.keys(groupe);
  if (!cles.length) return "";
  const rows = cles.sort((a, b) => groupe[b].n - groupe[a].n).map(k => {
    const g = groupe[k];
    return `<tr>
      <td class="card-title">${esc(k)}</td>
      <td class="num" data-label="Trades">${g.n}</td>
      <td class="num" data-label="Réussite">${Math.round((g.gagnants / g.n) * 100)} %</td>
      <td class="num ${pctClass(g.pnl)}" data-label="P&L">${fnum(g.pnl)} €</td>
    </tr>`;
  }).join("");
  return `<h2 class="alerts-log-title">${esc(titre)}</h2>
    <div class="table-wrap"><table class="data-table"><thead><tr>
      <th>${esc(titre.replace("Par ", ""))}</th><th class="num">Trades</th><th class="num">Réussite</th><th class="num">P&L</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderBotEquityChart() {
  const canvas = document.getElementById("bot-equity-canvas");
  if (!canvas) return;
  if (botEquityChart) { botEquityChart.destroy(); botEquityChart = null; }
  if (bot.equity.length < 2 || typeof Chart === "undefined") return;
  botEquityChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: bot.equity.map(p => fdateShort(p.date)),
      datasets: [{ data: bot.equity.map(p => p.value), borderColor: "#ffb000",
        backgroundColor: "rgba(255,176,0,0.08)", borderWidth: 2, pointRadius: 0, tension: 0.15, fill: true }],
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

// Explique en clair ce que le bot a appris — sinon les multiplicateurs ne veulent rien dire.
function botLearnExplain(f) {
  const bouts = [];
  if (f.n < bot.config.learnMinTrades) {
    bouts.push(`neutre — ${f.n}/${bot.config.learnMinTrades} trades avant d'apprendre`);
  } else {
    if (f.stopMult > 1.02) bouts.push(`stop élargi ×${fnum(f.stopMult)} — ${Math.round(f.stopRate * 100)} % de stops touchés, on sortait sur du bruit`);
    else if (f.stopMult < 0.98) bouts.push(`stop resserré ×${fnum(f.stopMult)} — seulement ${Math.round(f.stopRate * 100)} % de stops touchés`);
    if (f.rrMult > 1.02) bouts.push(`cible relevée ×${fnum(f.rrMult)} — souvent gagnant mais gains trop petits`);
    else if (f.rrMult < 0.98) bouts.push(`cible abaissée ×${fnum(f.rrMult)} — cible rarement atteinte`);
    if (f.qualityAdj > 0) bouts.push(`seuil d'achat +${f.qualityAdj} points — famille en perte`);
  }
  return bouts.length ? bouts.join(" · ") : "réglages conformes, aucun correctif";
}

function renderBotLearn() {
  const el = document.getElementById("bot-learn");
  if (!el) return;
  const familles = Object.keys(bot.learn || {});
  if (!familles.length) {
    el.innerHTML = `<p class="analysis-empty">Aucune famille observée pour l'instant. Le bot classe ses trades par marché et volatilité (ex. « US:forte ») et ajuste ses réglages après ${bot.config.learnMinTrades} trades clôturés.</p>`;
    return;
  }
  const rows = familles.sort().map(k => {
    const f = bot.learn[k];
    return `<tr>
      <td class="card-title">${esc(k)}</td>
      <td class="num" data-label="Trades">${f.n}</td>
      <td class="num" data-label="Réussite">${Math.round((f.winRate || 0) * 100)} %</td>
      <td class="num" data-label="Stops">${Math.round((f.stopRate || 0) * 100)} %</td>
      <td data-label="Correctifs">${esc(botLearnExplain(f))}</td>
    </tr>`;
  }).join("");
  el.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr>
      <th>Famille</th><th class="num">Trades</th><th class="num">Réussite</th><th class="num">Stops</th><th>Correctifs appliqués</th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">${bot.config.learnEnabled ? "Apprentissage actif" : "Apprentissage désactivé — les statistiques restent affichées, aucun correctif n'est appliqué"}. Chaque recalcul déplace un multiplicateur de 10 % au plus, borné entre 0,70 et 1,30.</p>`;
}

function renderBotLog() {
  const el = document.getElementById("bot-log");
  if (!el) return;
  if (!bot.log.length) {
    el.innerHTML = `<p class="analysis-empty">Le journal se remplira à la première évaluation.</p>`;
    return;
  }
  el.innerHTML = bot.log.slice(0, 40).map(l => {
    const heure = new Date(l.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return `<div class="bot-log-row">
      <span class="bot-log-time">${esc(heure)}</span>
      <span class="bot-log-kind ${esc(l.kind)}">${esc(l.kind)}</span>
      <span>${esc(l.msg)}</span>
    </div>`;
  }).join("");
}

function renderBot() {
  const actions = document.getElementById("bot-actions");
  const summary = document.getElementById("bot-summary");
  const posEl = document.getElementById("bot-positions");
  const histEl = document.getElementById("bot-history");
  const cfgEl = document.getElementById("bot-config");
  if (!summary) return;

  actions.innerHTML = bot.started
    ? `<button class="btn btn-accent" id="btn-bot-run">Évaluer maintenant</button><button class="btn btn-ghost" id="btn-bot-reset">Réinitialiser</button>`
    : `<button class="btn btn-accent" id="btn-bot-start">▶ Démarrer le bot</button>`;

  renderBotSession();

  if (!bot.started) {
    summary.innerHTML = `<p class="analysis-empty">Le bot est à l'arrêt. Cliquez « Démarrer » : il investira ${fnum(bot.config.capital)} € virtuels dans les meilleurs titres de votre dernier scan marché. Chaque position risque ${fnum(bot.config.riskPerTradePct)} % du capital, avec stop suiveur, prise partielle et horizon calculés automatiquement pour chaque titre.</p>`;
    posEl.innerHTML = ""; histEl.innerHTML = "";
  } else {
    const total = botPortfolioValue();
    const perf = (total / bot.config.capital - 1) * 100;
    summary.innerHTML = `<dl class="impact-grid">
      <div><dt>Valeur du portefeuille</dt><dd class="${pctClass(perf)}">${fnum(total)} €</dd></div>
      <div><dt>Performance</dt><dd class="${pctClass(perf)}">${fpct(perf)}</dd></div>
      <div><dt>Cash disponible</dt><dd>${fnum(bot.cash)} €</dd></div>
      <div><dt>Positions ouvertes</dt><dd>${bot.positions.length}</dd></div>
    </dl>
    ${renderBotExposure(total)}
    <p class="fund-caveat">Sorties évaluées sur les clôtures quotidiennes hors séance, en direct quand le marché du titre est ouvert. Frais ${fnum(bot.config.feePct)} % et slippage ${fnum(bot.config.slipPct)} % simulés. Jours fériés non gérés. Simulation, pas un conseil.</p>`;

    if (bot.positions.length === 0) {
      posEl.innerHTML = `<p class="analysis-empty">Aucune position ouverte. Lancez/enrichissez un scan marché puis « Évaluer maintenant » — le bot n'achète que sur les marchés ouverts.</p>`;
    } else {
      const rows = bot.positions.map(p => {
        const price = botCurrentPrice(p.ticker, p.entryPrice);
        const chg = (price / p.entryPrice - 1) * 100;
        const stopInitial = p.entryPrice * (1 - p.stopPct / 100);
        const suiveurArme = p.stopLevel > stopInitial + 1e-9;
        const cible = p.entryPrice * (1 + p.targetPct / 100);
        const restants = Math.max(0, Math.ceil(p.horizonDays - botAgeDays(p.entryDate)));
        return `<tr>
          <td class="card-title"><span class="cell-ticker">${esc(p.ticker)}</span></td>
          <td data-label="Famille">${esc(p.family)}</td>
          <td class="num" data-label="Achat">${fnum(p.entryPrice)}</td>
          <td class="num" data-label="Cours">${fnum(price)}</td>
          <td class="num ${pctClass(chg)}" data-label="+/−">${fpct(chg)}</td>
          <td class="num" data-label="Stop">${fnum(p.stopLevel)}${suiveurArme ? ` <span class="bot-trail" title="Stop suiveur armé">↑</span>` : ""}</td>
          <td class="num" data-label="Cible">${p.scaledOut ? "—" : fnum(cible)}</td>
          <td data-label="Partiel">${p.scaledOut ? "pris" : "—"}</td>
          <td class="num" data-label="Jours restants">${restants}</td>
          <td class="actions-col"><button class="btn btn-small btn-ghost btn-danger js-bot-sell" data-ticker="${esc(p.ticker)}">Vendre</button></td>
        </tr>`;
      }).join("");
      posEl.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr>
        <th>Ticker</th><th>Famille</th><th class="num">Achat</th><th class="num">Cours</th><th class="num">+/−</th>
        <th class="num">Stop</th><th class="num">Cible</th><th>Partiel</th><th class="num">Jours</th><th class="actions-col">Action</th>
        </tr></thead><tbody>${rows}</tbody></table></div>
        <p class="hint">Un « ↑ » signale un stop suiveur armé : il a remonté au-dessus du stop initial et ne redescendra plus.</p>`;
    }

    histEl.innerHTML = bot.history.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr>
          <th>Ticker</th><th>Famille</th><th class="num">Achat</th><th class="num">Vente</th><th class="num">P&L</th><th class="num">%</th><th>Raison</th>
        </tr></thead><tbody>${bot.history.map(h => `<tr>
          <td class="card-title"><span class="cell-ticker">${esc(h.ticker)}</span></td>
          <td data-label="Famille">${esc(h.family || "—")}</td>
          <td class="num" data-label="Achat">${fnum(h.entryPrice)}</td>
          <td class="num" data-label="Vente">${fnum(h.exitPrice)}</td>
          <td class="num ${pctClass(h.pnl)}" data-label="P&L">${fnum(h.pnl)} €</td>
          <td class="num ${pctClass(h.pnlPct)}" data-label="%">${fpct(h.pnlPct)}</td>
          <td data-label="Raison">${esc(h.reason)}</td>
        </tr>`).join("")}</tbody></table></div>`
      : `<p class="analysis-empty">Aucun trade clôturé pour l'instant.</p>`;
  }

  renderBotStats();
  renderBotLearn();
  renderBotLog();

  cfgEl.innerHTML = BOT_CONFIG_FIELDS.map(([k, label, step]) =>
    `<label>${esc(label)} <input type="number" class="js-bot-cfg" data-key="${k}" step="${step}" value="${bot.config[k]}"></label>`
  ).join("")
  + `<label class="compare-chk"><input type="checkbox" class="js-bot-cfg" data-key="learnEnabled" ${bot.config.learnEnabled ? "checked" : ""}> Apprentissage actif</label>`;
}

document.getElementById("panel-bot").addEventListener("click", e => {
  if (e.target.id === "btn-bot-start") botStart();
  else if (e.target.id === "btn-bot-run") {
    // Une évaluation qui ne fait rien doit le dire : sans retour visible,
    // le bouton passe pour cassé (marché fermé, pas de scan, aucun candidat au niveau).
    e.target.disabled = true;
    runBot()
      .then(bilan => {
        if (!bilan) return;
        const agi = bilan.achats || bilan.ventes || bilan.partiels;
        toast(botSummarizeRun(bilan), agi ? "info" : "warn");
      })
      .catch(() => toast("L'évaluation a échoué (réseau ?). Réessayez dans un instant.", "error"))
      .finally(() => { e.target.disabled = false; renderBot(); });
  }
  else if (e.target.id === "btn-bot-reset") botReset();
  else { const sell = e.target.closest(".js-bot-sell"); if (sell) botSellManual(sell.dataset.ticker); }
});
document.getElementById("panel-bot").addEventListener("change", e => {
  const inp = e.target.closest(".js-bot-cfg");
  if (!inp) return;
  const key = inp.dataset.key;
  const value = inp.type === "checkbox" ? inp.checked : Number(inp.value);
  if (inp.type !== "checkbox" && !isFinite(value)) return;
  bot.config[key] = value;
  saveBot();
  if (key === "autoLoop" || key === "loopMinutes") botScheduleNext();
  renderBot();
});

// Chart.js dimensionne son canvas au moment du rendu : si la section était repliée
// (ou la fenêtre d'une autre taille), on le redessine à l'ouverture.
const botEquityDetails = document.getElementById("bot-equity-canvas").closest("details");
if (botEquityDetails) {
  botEquityDetails.addEventListener("toggle", () => { if (botEquityDetails.open) renderBotEquityChart(); });
}

renderBot();

/* ---------- boucle intraday du bot ----------
 * Pas de serveur 24/7 : le bot ne tourne que quand l'app est ouverte. Tant qu'un
 * marché est ouvert et que l'onglet est visible, on réévalue toutes les
 * `loopMinutes`. Hors séance, on se replanifie à la prochaine ouverture (plafonné
 * à 30 min pour rester simple). Onglet en arrière-plan → timer suspendu.
 * ------------------------------------------------------------------------- */

let botTimer = null;
let botNextRunAt = null;  // Date de la prochaine évaluation, ou null si la boucle est à l'arrêt

function botStopTimer() {
  if (botTimer) { clearTimeout(botTimer); botTimer = null; }
  botNextRunAt = null;
}

function botScheduleNext() {
  botStopTimer();
  if (!bot.started || !bot.config.autoLoop) return;
  if (document.visibilityState !== "visible") return;

  let delayMs;
  if (botOpenMarkets().size > 0) {
    delayMs = Math.max(1, bot.config.loopMinutes) * 60 * 1000;
  } else {
    const next = Math.min(botNextOpen("EU"), botNextOpen("US"), botNextOpen("ASIA"));
    delayMs = Math.min(next || 30 * 60 * 1000, 30 * 60 * 1000);
  }
  botNextRunAt = new Date(Date.now() + delayMs);
  botTimer = setTimeout(async () => {
    try { await runBot(); } catch (_) { /* best-effort : on retentera au prochain tour */ }
    botScheduleNext();
  }, delayMs);
}

if (bot.started) {
  setTimeout(() => runBot().catch(() => {}).finally(botScheduleNext), 1500); // laisse le cache marché se charger d'abord
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") botScheduleNext();
  else botStopTimer();
});
recordPerfSnapshot(); // point de performance du jour (si positions)
