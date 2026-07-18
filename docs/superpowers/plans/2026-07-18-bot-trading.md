# Bot de trading (paper trading) — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Onglet F8 « Bot » : simulateur paper-trading qui achète les meilleurs titres du scan marché avec stop/cible adaptatifs, réévaluation, vente manuelle, et suivi de performance.

**Architecture:** État `bot` persisté par profil ; formules pures adaptatives ; moteur `runBot` (rejeu des clôtures pour les sorties + entrées pondérées) ; UI F8. Déclenché à l'ouverture + boutons.

**Tech Stack:** HTML/CSS/JS vanilla, fichier unique. Aucune modif serveur.

## Global Constraints

- **Paper trading strict** : aucun ordre réel, aucune connexion courtier. Tout est virtuel.
- **Best-effort** : une panne (réseau, données manquantes) ne casse jamais l'app.
- Pas de build ; français ; `esc()` pour le contenu injecté.
- Tests headless : serveur `PYTHONIOENCODING=utf-8` ; localStorage seedé ; ouvrir `http://localhost:8750/terminal-tout-en-un.html`.

---

### Task 1: État + formules adaptatives (pur)

**Files:** Modify `terminal-tout-en-un.html` — `LS` (ajout clé) ; état + fonctions près de l'état global (après la section ALERTES, ~ligne 1180) ou dans une nouvelle section BOT.

**Interfaces:**
- Consumes: `lsGet`, `lsSet` (existant).
- Produces: `LS.bot` ; `let bot` ; `saveBot()` ; `clamp(x,a,b)` ; `botStopPct`, `botRR`, `botTargetPct`, `botPositionAmount`.

- [ ] **Step 1: Add LS key + state + formulas**

Dans `LS`, après `alerts: "term_alerts",`, ajouter :
```js
  bot: "term_bot", // portefeuille du bot paper-trading, par profil
```
Ajouter une section (par ex. après le bloc ALERTES) :
```js
/* ============================= BOT (PAPER TRADING) ============================= */

const BOT_DEFAULT_CONFIG = {
  capital: 10000, ticketPct: 0.10, qualityMin: 60, exitScore: 40,
  stopVolFactor: 0.4, stopMin: 5, stopMax: 20, rrMin: 1.5, rrMax: 3,
};
let bot = lsGet(LS.bot, null);
if (!bot || typeof bot !== "object") {
  bot = { started: false, startDate: null, cash: BOT_DEFAULT_CONFIG.capital, positions: [], history: [], config: { ...BOT_DEFAULT_CONFIG } };
}
bot.config = { ...BOT_DEFAULT_CONFIG, ...(bot.config || {}) };  // migration douce
if (!Array.isArray(bot.positions)) bot.positions = [];
if (!Array.isArray(bot.history)) bot.history = [];
function saveBot() { lsSet(LS.bot, bot); }

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

// Stop-loss (%) adapté à la volatilité annualisée (ind.vol). Défaut 30 % si absente.
function botStopPct(ind, cfg) {
  const vol = (ind && ind.vol != null && isFinite(ind.vol)) ? ind.vol : 30;
  return clamp(cfg.stopVolFactor * vol, cfg.stopMin, cfg.stopMax);
}
// Ratio gain/risque croissant avec le score global (qualityMin → rrMin, 100 → rrMax).
function botRR(score, cfg) {
  const span = Math.max(1, 100 - cfg.qualityMin);
  const t = (score - cfg.qualityMin) / span;
  return clamp(cfg.rrMin + t * (cfg.rrMax - cfg.rrMin), cfg.rrMin, cfg.rrMax);
}
function botTargetPct(ind, score, cfg) { return botStopPct(ind, cfg) * botRR(score, cfg); }
// Montant pondéré par le score, borné, plafonné au cash. Pas de nombre max de positions.
function botPositionAmount(score, cfg, cash) {
  const base = cfg.capital * cfg.ticketPct;
  const weighted = clamp(base * (score / 70), 0.6 * base, 1.6 * base);
  return Math.min(weighted, cash);
}
```

- [ ] **Step 2: Verify formulas in console**

Serveur lancé, page ouverte. En console :
```js
(function(){
  const cfg = BOT_DEFAULT_CONFIG;
  return JSON.stringify({
    stopCalm: botStopPct({vol:15}, cfg),      // 0.4*15=6
    stopNervous: botStopPct({vol:60}, cfg),   // 0.4*60=24 -> borné 20
    stopNoVol: botStopPct({}, cfg),           // 30 -> 12
    rr60: botRR(60, cfg), rr100: botRR(100, cfg), // 1.5 ; 3
    target: botTargetPct({vol:25}, 80, cfg),  // stop=10, rr=1.5+0.5*1.5=2.25 -> 22.5
    amt60: Math.round(botPositionAmount(60, cfg, 99999)), // base=1000, w=1000*60/70=857
    amt100: Math.round(botPositionAmount(100, cfg, 99999)) // 1000*100/70=1428 -> borné 1600
  });
})();
```
Expected : `stopCalm`≈6, `stopNervous`=20, `stopNoVol`=12, `rr60`=1.5, `rr100`=3, `target`≈22.5, `amt60`≈857, `amt100`=1600.

- [ ] **Step 3: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(bot): état + formules adaptatives (stop/cible/taille) du bot paper-trading"
```

---

### Task 2: Moteur (runBot, sorties par rejeu, entrées, vente manuelle)

**Files:** Modify `terminal-tout-en-un.html` — fonctions après celles de Task 1.

**Interfaces:**
- Consumes: `bot`, `cache`, `marketCache`, `analyzeTicker`, `computeGlobalScore`, `isStale`, `saveBot`, formules (Task 1).
- Produces: `botFindExit`, `botPortfolioValue`, `runBot` (async), `botSellManual`, `botStart`, `botReset`. `renderBot` est appelé si défini (`typeof`).

- [ ] **Step 1: Add engine functions**

```js
// Cherche le 1er jour (chronologique) après l'achat où le stop ou la cible est franchi (sur clôtures).
function botFindExit(pos, e) {
  if (!e || !e.hist || !Array.isArray(e.hist.closes) || !Array.isArray(e.hist.dates)) return null;
  const stopLevel = pos.entryPrice * (1 - pos.stopPct / 100);
  const targetLevel = pos.entryPrice * (1 + pos.targetPct / 100);
  const { dates, closes } = e.hist; // du plus récent au plus ancien → on parcourt à l'envers
  for (let i = dates.length - 1; i >= 0; i--) {
    if (dates[i] <= pos.entryDate) continue;
    const c = closes[i];
    if (c == null || !isFinite(c)) continue;
    if (c <= stopLevel) return { price: c, date: dates[i], reason: "stop-loss" };
    if (c >= targetLevel) return { price: c, date: dates[i], reason: "prise de bénéfice" };
  }
  return null;
}

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
  bot.cash += pos.qty * price;
  bot.history.unshift({ ticker, entryDate: pos.entryDate, entryPrice: pos.entryPrice,
    exitDate: new Date().toISOString().slice(0, 10), exitPrice: price, qty: pos.qty,
    pnl: (price - pos.entryPrice) * pos.qty, pnlPct: (price / pos.entryPrice - 1) * 100, reason: "manuelle" });
  bot.positions.splice(idx, 1);
  saveBot();
  if (typeof renderBot === "function") renderBot();
}

// Moteur : rafraîchit les positions, applique les sorties (rejeu clôtures + réévaluation), puis achète.
async function runBot() {
  if (!bot.started) return;
  const cfg = bot.config;
  const today = new Date().toISOString().slice(0, 10);

  // a) rafraîchir les positions détenues (best-effort, ≤ N requêtes)
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
    let exit = e ? botFindExit(pos, e) : null;
    if (!exit && e && e.ind) {
      const g = e.score != null ? computeGlobalScore(e) : null;
      if ((g != null && g <= cfg.exitScore) || e.signal === "Vente") {
        exit = { price: e.ind.price, date: today, reason: "réévaluation" };
      }
    }
    if (exit && isFinite(exit.price) && exit.price > 0) {
      bot.cash += pos.qty * exit.price;
      bot.history.unshift({ ticker: pos.ticker, entryDate: pos.entryDate, entryPrice: pos.entryPrice,
        exitDate: exit.date, exitPrice: exit.price, qty: pos.qty,
        pnl: (exit.price - pos.entryPrice) * pos.qty, pnlPct: (exit.price / pos.entryPrice - 1) * 100, reason: exit.reason });
    } else {
      stillOpen.push(pos);
    }
  }
  bot.positions = stillOpen;

  // c) entrées : déployer le capital, sans limite de nombre
  const held = new Set(bot.positions.map(p => p.ticker));
  const base = cfg.capital * cfg.ticketPct;
  const candidates = Object.keys(marketCache)
    .map(t => ({ t, e: marketCache[t] }))
    .filter(x => x.e && x.e.ind && x.e.ind.price > 0 && !held.has(x.t) && x.e.score != null && computeGlobalScore(x.e) >= cfg.qualityMin)
    .sort((a, b) => computeGlobalScore(b.e) - computeGlobalScore(a.e));
  for (const cand of candidates) {
    if (bot.cash < 0.2 * base) break;
    const score = computeGlobalScore(cand.e), ind = cand.e.ind;
    const amount = botPositionAmount(score, cfg, bot.cash);
    if (amount < 1) break;
    bot.cash -= amount;
    bot.positions.push({ ticker: cand.t, entryDate: today, entryPrice: ind.price, qty: amount / ind.price,
      stopPct: botStopPct(ind, cfg), targetPct: botTargetPct(ind, score, cfg), entryScore: score });
    held.add(cand.t);
  }

  if (bot.history.length > 200) bot.history = bot.history.slice(0, 200);
  saveBot();
  if (typeof renderBot === "function") renderBot();
}

function botStart() {
  bot.started = true; bot.startDate = new Date().toISOString();
  bot.cash = bot.config.capital; bot.positions = []; bot.history = [];
  saveBot();
  if (typeof renderBot === "function") renderBot();
  runBot();
}
function botReset() {
  if (!window.confirm("Réinitialiser le bot ? Positions et historique seront effacés.")) return;
  bot.started = false; bot.startDate = null;
  bot.cash = bot.config.capital; bot.positions = []; bot.history = [];
  saveBot();
  if (typeof renderBot === "function") renderBot();
}
```

- [ ] **Step 2: Verify engine with mock data (console)**

Serveur lancé, page ouverte. On fabrique un marketCache fictif et on teste entrées/sorties :
```js
(async function(){
  // marketCache fictif : 3 titres notés, avec hist
  const mk = (price, vol, score, closes) => ({ ind:{price, vol}, score, signal:"Achat", fundScore:{total:score}, hist:{ dates:["2026-07-10","2026-07-11","2026-07-12"], closes } });
  marketCache = {
    AAA: mk(100, 20, 90, [130,110,100]),  // score 90
    BBB: mk(50, 30, 70, [50,50,50]),      // score 70
    CCC: mk(10, 20, 55, [10,10,10]),      // score 55 < seuil -> pas acheté
  };
  // forcer weightTech pour que global ~ fonda (mais fundScore.total pilote); on démarre le bot
  bot.started = true; bot.cash = 10000; bot.positions = []; bot.history = []; bot.config = {...BOT_DEFAULT_CONFIG};
  // entrées seulement (pas de refresh réseau car données déjà présentes et non stale? isStale peut être vrai)
  // on court-circuite le refresh en marquant updated récent :
  for (const k of Object.keys(marketCache)) marketCache[k].updated = new Date().toISOString();
  await runBot();
  const bought = bot.positions.map(p => p.ticker).sort();
  // test sortie stop : position AAA dont une clôture future passe sous le stop
  const pos = bot.positions.find(p=>p.ticker==="AAA");
  const exitTest = pos ? botFindExit({...pos, entryDate:"2026-07-09", entryPrice:100, stopPct:5, targetPct:50}, marketCache.AAA) : null;
  return JSON.stringify({ bought, ccInBought: bought.includes("CCC"), cash: Math.round(bot.cash), exitTestReason: exitTest && exitTest.reason });
})();
```
Expected : `bought` contient AAA et BBB (pas CCC, score 55 < 60) ; `cash` réduit (capital déployé) ; `exitTestReason` = "prise de bénéfice" (clôture 130 > 100*1.5=150 ? non → 110>105 stop ? entryPrice 100 stop 5% = 95, closes après 2026-07-09 = 130,110,100 tous > 95 ; target 50% = 150, 130<150 → pas de sortie → null). Ajuster : viser une clôture claire. **Attendu réel : `exitTestReason` = null** (aucun seuil franchi avec ces valeurs) — vérifier plutôt un cas dédié ci-dessous.

Puis un cas de sortie franc :
```js
(function(){
  const e = { hist:{ dates:["2026-07-10","2026-07-11"], closes:[80, 120] } };
  const stop = botFindExit({ entryDate:"2026-07-01", entryPrice:100, stopPct:10, targetPct:15 }, e); // 80 <= 90 -> stop au 2026-07-10
  return JSON.stringify({ reason: stop && stop.reason, date: stop && stop.date, price: stop && stop.price });
})();
```
Expected : `reason` = "stop-loss", `date` = "2026-07-10", `price` = 80.

- [ ] **Step 3: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(bot): moteur runBot (sorties par rejeu des clôtures, entrées, vente manuelle)"
```

---

### Task 3: UI onglet F8 + câblage + déclenchement à l'ouverture

**Files:** Modify `terminal-tout-en-un.html` — barre d'onglets (~ligne 704) ; panneau après `panel-alerts` (~ligne 990) ; map clavier (~ligne 3551) ; hook bascule ; `renderBot` + câblage ; hook init après `loadMarketCache()` (~ligne 3309) ; CSS.

**Interfaces:**
- Consumes: `bot`, `runBot`, `botSellManual`, `botStart`, `botReset`, `botPortfolioValue`, `botStopPct`, `botTargetPct`, `computeGlobalScore`, `cache`, `marketCache`, `esc`, `fnum`, `fpct`, `fmtNum`, `pctClass` (existant + Tasks 1/2).
- Produces: `renderBot()` ; onglet/panneau F8.

- [ ] **Step 1: Add the F8 tab button**

Après le bouton F7 (`data-tab="alerts"`), ajouter :
```html
      <button class="tab" role="tab" aria-selected="false" aria-controls="panel-bot" id="tab-bot" data-tab="bot">F8 · BOT</button>
```

- [ ] **Step 2: Add the panel**

Juste après `</section>` de `panel-alerts` (~ligne 990), avant `</main>`, insérer :
```html
    <!-- ======================= ONGLET 8 : BOT ======================= -->
    <section class="panel" id="panel-bot" role="tabpanel" aria-labelledby="tab-bot" hidden>
      <div class="panel-head">
        <h1>Bot <span class="muted">/ simulateur (paper trading) — argent 100 % virtuel, pas un conseil</span></h1>
        <span class="market-actions" id="bot-actions"></span>
      </div>
      <div id="bot-summary" class="bot-summary"></div>
      <div id="bot-positions"></div>
      <h2 class="alerts-log-title">Historique des trades</h2>
      <div id="bot-history"></div>
      <details class="bot-settings">
        <summary>Réglages du bot</summary>
        <div id="bot-config" class="filter-panel"></div>
      </details>
    </section>
```

- [ ] **Step 3: Keyboard + tab-switch hook**

Map clavier → ajouter `F8: "bot"` :
```js
  const map = { F1: "dashboard", F2: "positions", F3: "buysim", F4: "analyse", F5: "marche", F6: "allocation", F7: "alerts", F8: "bot" };
```
Hook de bascule (près de `if (btn.dataset.tab === "alerts") renderAlerts();`) → ajouter :
```js
    if (btn.dataset.tab === "bot") renderBot();
```

- [ ] **Step 4: Add renderBot + wiring**

Après le câblage des alertes (ou près des autres rendus) :
```js
/* ============================= ONGLET 8 : BOT — UI ============================= */

const BOT_CONFIG_FIELDS = [
  ["capital", "Capital (€)", 100],
  ["ticketPct", "Taille position (part du capital)", 0.01],
  ["qualityMin", "Score d'achat mini", 1],
  ["exitScore", "Score de sortie", 1],
  ["stopVolFactor", "Facteur stop (×volatilité)", 0.05],
  ["stopMin", "Stop min (%)", 1],
  ["stopMax", "Stop max (%)", 1],
  ["rrMin", "Ratio gain/risque min", 0.1],
  ["rrMax", "Ratio gain/risque max", 0.1],
];

function botCurrentPrice(ticker, fallback) {
  const e = cache[ticker] || marketCache[ticker];
  return (e && e.ind && e.ind.price > 0) ? e.ind.price : fallback;
}

function renderBot() {
  const actions = document.getElementById("bot-actions");
  const summary = document.getElementById("bot-summary");
  const posEl = document.getElementById("bot-positions");
  const histEl = document.getElementById("bot-history");
  const cfgEl = document.getElementById("bot-config");
  if (!summary) return;

  // Boutons
  actions.innerHTML = bot.started
    ? `<button class="btn btn-accent" id="btn-bot-run">Évaluer maintenant</button><button class="btn btn-ghost" id="btn-bot-reset">Réinitialiser</button>`
    : `<button class="btn btn-accent" id="btn-bot-start">▶ Démarrer le bot</button>`;

  if (!bot.started) {
    summary.innerHTML = `<p class="analysis-empty">Le bot est à l'arrêt. Cliquez « Démarrer » : il investira ${fnum(bot.config.capital)} € virtuels dans les meilleurs titres de votre dernier scan marché, avec stop-loss et prise de bénéfice adaptatifs.</p>`;
    posEl.innerHTML = ""; histEl.innerHTML = "";
  } else {
    const total = botPortfolioValue();
    const perf = (total / bot.config.capital - 1) * 100;
    const closed = bot.history.length;
    const wins = bot.history.filter(h => h.pnl > 0).length;
    const winRate = closed ? Math.round((wins / closed) * 100) : 0;
    summary.innerHTML = `<dl class="impact-grid">
      <div><dt>Valeur du portefeuille</dt><dd class="${pctClass(perf)}">${fnum(total)} €</dd></div>
      <div><dt>Performance</dt><dd class="${pctClass(perf)}">${fpct(perf)}</dd></div>
      <div><dt>Cash disponible</dt><dd>${fnum(bot.cash)} €</dd></div>
      <div><dt>Positions ouvertes</dt><dd>${bot.positions.length}</dd></div>
      <div><dt>Trades clôturés</dt><dd>${closed}</dd></div>
      <div><dt>Trades gagnants</dt><dd>${winRate} %</dd></div>
    </dl>
    <p class="fund-caveat">Stops/cibles évalués sur les clôtures quotidiennes ; réévaluation au score courant. Simulation, pas un conseil.</p>`;

    // Positions ouvertes
    if (bot.positions.length === 0) {
      posEl.innerHTML = `<p class="analysis-empty">Aucune position ouverte. Lancez/enrichissez un scan marché puis « Évaluer maintenant » pour que le bot achète.</p>`;
    } else {
      const rows = bot.positions.map(p => {
        const price = botCurrentPrice(p.ticker, p.entryPrice);
        const chg = (price / p.entryPrice - 1) * 100;
        const stopP = p.entryPrice * (1 - p.stopPct / 100);
        const tgtP = p.entryPrice * (1 + p.targetPct / 100);
        const e = cache[p.ticker] || marketCache[p.ticker];
        const score = (e && e.score != null) ? computeGlobalScore(e) : null;
        return `<tr>
          <td class="card-title"><span class="cell-ticker">${esc(p.ticker)}</span></td>
          <td class="num" data-label="Achat">${fnum(p.entryPrice)}</td>
          <td class="num" data-label="Cours">${fnum(price)}</td>
          <td class="num ${pctClass(chg)}" data-label="+/−">${fpct(chg)}</td>
          <td class="num" data-label="Stop">${fnum(stopP)}</td>
          <td class="num" data-label="Cible">${fnum(tgtP)}</td>
          <td class="num" data-label="Score">${score == null ? "—" : score}</td>
          <td class="actions-col"><button class="btn btn-small btn-ghost btn-danger js-bot-sell" data-ticker="${esc(p.ticker)}">Vendre</button></td>
        </tr>`;
      }).join("");
      posEl.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr>
        <th>Ticker</th><th class="num">Achat</th><th class="num">Cours</th><th class="num">+/−</th><th class="num">Stop</th><th class="num">Cible</th><th class="num">Score</th><th class="actions-col">Action</th>
        </tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    // Historique
    histEl.innerHTML = bot.history.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr>
          <th>Ticker</th><th class="num">Achat</th><th class="num">Vente</th><th class="num">P&L</th><th class="num">%</th><th>Raison</th>
        </tr></thead><tbody>${bot.history.map(h => `<tr>
          <td class="card-title"><span class="cell-ticker">${esc(h.ticker)}</span></td>
          <td class="num" data-label="Achat">${fnum(h.entryPrice)}</td>
          <td class="num" data-label="Vente">${fnum(h.exitPrice)}</td>
          <td class="num ${pctClass(h.pnl)}" data-label="P&L">${fnum(h.pnl)} €</td>
          <td class="num ${pctClass(h.pnlPct)}" data-label="%">${fpct(h.pnlPct)}</td>
          <td data-label="Raison">${esc(h.reason)}</td>
        </tr>`).join("")}</tbody></table></div>`
      : `<p class="analysis-empty">Aucun trade clôturé pour l'instant.</p>`;
  }

  // Réglages
  cfgEl.innerHTML = BOT_CONFIG_FIELDS.map(([k, label, step]) =>
    `<label>${esc(label)} <input type="number" class="js-bot-cfg" data-key="${k}" step="${step}" value="${bot.config[k]}"></label>`
  ).join("");
}

// Câblage délégué (survivant aux re-render)
document.getElementById("panel-bot").addEventListener("click", e => {
  if (e.target.id === "btn-bot-start") botStart();
  else if (e.target.id === "btn-bot-run") { e.target.disabled = true; runBot().finally(() => renderBot()); }
  else if (e.target.id === "btn-bot-reset") botReset();
  else { const sell = e.target.closest(".js-bot-sell"); if (sell) botSellManual(sell.dataset.ticker); }
});
document.getElementById("panel-bot").addEventListener("change", e => {
  const inp = e.target.closest(".js-bot-cfg");
  if (inp) {
    const v = Number(inp.value);
    if (isFinite(v)) { bot.config[inp.dataset.key] = v; saveBot(); }
  }
});

renderBot();
```

- [ ] **Step 5: Trigger runBot at startup**

Après `loadMarketCache(); // repeuple…` (~ligne 3309), ajouter :
```js
if (bot.started) { setTimeout(() => runBot().catch(() => {}), 1500); } // laisse le cache marché se charger d'abord
```

- [ ] **Step 6: Add CSS**

Près de `.filter-panel` / `.alerts-list` :
```css
.bot-summary { margin-bottom: 14px; }
.bot-summary .impact-grid dd { font-size: 18px; }
.bot-settings { margin-top: 16px; }
.bot-settings summary { cursor: pointer; color: var(--text-dim); font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
.bot-settings .filter-panel { margin-top: 10px; }
#bot-positions, #bot-history { margin-bottom: 8px; }
```

- [ ] **Step 7: Verify interactively**

Serveur lancé, page ouverte. En console :
```js
(async function(){
  // marketCache fictif noté
  const mk = (price, vol, score) => ({ ind:{price, vol, perf:{y1:0.1}}, score, signal:"Achat", fundScore:{total:score}, hist:{dates:["2026-07-11"],closes:[price]}, updated:new Date().toISOString() });
  marketCache = { AAA: mk(100,20,90), BBB: mk(50,30,72), CCC: mk(10,20,55) };
  document.getElementById("tab-bot").click();
  botStart();
  await new Promise(r=>setTimeout(r,400));
  const posCount = document.querySelectorAll("#bot-positions tbody tr").length;
  const total = document.querySelector("#bot-summary dd").textContent;
  // vente manuelle du 1er
  const firstTicker = bot.positions[0] && bot.positions[0].ticker;
  document.querySelector(".js-bot-sell").click();
  const histCount = document.querySelectorAll("#bot-history tbody tr").length;
  const lastReason = bot.history[0] && bot.history[0].reason;
  return JSON.stringify({ posCount, total, soldTicker:firstTicker, histCount, lastReason, persisted: !!localStorage.getItem("term_bot::Test") });
})();
```
Expected : `posCount` ≥ 2 (AAA, BBB ; pas CCC), `total` non vide, après vente `histCount` = 1 avec `lastReason` = "manuelle", `persisted` true.

Puis **manuellement** : onglet F8 (clavier F8) → résumé, positions avec bouton « Vendre », historique, réglages ; « Réinitialiser » vide tout ; sur mobile (≤640px) les tableaux passent en cartes.

- [ ] **Step 8: Commit + déployer**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(bot): onglet F8 (résumé, positions, historique, réglages, vente manuelle)"
git checkout main && git merge feat/bot-trading && git push origin main && git branch -d feat/bot-trading
```
(Vérifier `py -m unittest discover tests` vert avant push.)

---

## Vérification finale
- [ ] Formules adaptatives correctes ; moteur : entrées (déploie le capital, respecte le seuil), sorties (stop/cible par rejeu, réévaluation), vente manuelle.
- [ ] Onglet F8 : démarrage, évaluation, reset, positions + bouton Vendre, historique avec raisons, réglages persistés ; responsive.
- [ ] Non-régression F1–F7 ; `py -m unittest discover tests` vert.
- [ ] Déployé sur Render.

## Notes
- Ordre : Task 1 → 2 → 3. `renderBot` appelé via `typeof` dans Tasks 1/2 (défini en Task 3).
- Numéros de ligne indicatifs.
- Paper trading strict : aucune action réelle, jamais.
