# Alertes & Export/Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un onglet F7 « Alertes » (4 types, moteur à hystérésis) et un export/import des données du profil (fusion à l'import).

**Architecture:** Moteur d'alertes pur appelé depuis `renderAll` ; onglet F7 avec formulaire + liste + journal ; export via Blob/`<a download>` ; import fusion via `FileReader`. Tout dans le fichier unique, persisté par profil.

**Tech Stack:** HTML/CSS/JS vanilla, fichier unique `terminal-tout-en-un.html`. Aucune modif serveur.

## Global Constraints

- **Pas de build front** ; français ; `esc()` pour tout contenu injecté ; toasts pour erreurs.
- **Anti-spam** : une alerte ne re-déclenche pas tant que sa condition reste vraie (hystérésis via `triggeredAt`).
- **Robustesse** : alerte sur ticker sans données en cache = ignorée ; import non conforme = aucune modif.
- **Déploiement** : après la **Feature Alertes** (Tasks A1+A2) → merge `main` + push (Render). Après **Export/Import** (Tasks B1+B2) → merge + push.
- **Tests headless** : serveur `PYTHONIOENCODING=utf-8` ; `localStorage` pré-rempli (`term_profiles=["Test"]`, `term_current_profile="Test"`) ; ouvrir `http://localhost:8750/terminal-tout-en-un.html` ; naviguer avec le bon `tabId`.
- Encodage UTF-8.

---

### Task A1: Moteur d'alertes + état

**Files:**
- Modify: `terminal-tout-en-un.html` — `LS` (~ligne 1004) ; état + fonctions (près de l'état global / après `applyPurchase` ~ligne 1104) ; appel dans `renderAll` (~ligne 3297).

**Interfaces:**
- Consumes: `lsGet`, `lsSet`, `cache`, `computeGlobalScore`, `toast` (existant).
- Produces: `LS.alerts` ; `let alerts`, `let alertLog`, `let nextAlertId` ; `saveAlerts()`, `newAlertId()`, `alertLabel(a)`, `checkAlerts()`.

- [ ] **Step 1: Add LS key + state**

Dans `LS`, après `filters: "term_filters", ...`, ajouter :
```js
  alerts: "term_alerts", // règles d'alerte par profil
```
Après `function applyPurchase(...) { ... }` (~ligne 1104), ajouter :
```js
/* ============================= ALERTES ============================= */

let alerts = lsGet(LS.alerts, []);          // règles persistées par profil
if (!Array.isArray(alerts)) alerts = [];
let alertLog = [];                          // journal de session : [{ticker, label, at}]
let nextAlertId = Date.now();
function newAlertId() { return nextAlertId++; }
function saveAlerts() { lsSet(LS.alerts, alerts); }

// Libellé lisible d'une règle.
function alertLabel(a) {
  if (a.type === "price")  return `Prix ${a.direction === "above" ? "≥" : "≤"} ${a.value}`;
  if (a.type === "global") return `Score global ${a.direction === "above" ? "≥" : "≤"} ${a.value}`;
  if (a.type === "rsi")    return a.direction === "oversold" ? `RSI ≤ ${a.value} (survente)` : `RSI ≥ ${a.value} (surachat)`;
  if (a.type === "change") return `Variation du jour ≥ ${a.value} %`;
  return "—";
}

// Évalue toutes les alertes actives sur les données en cache. Hystérésis via triggeredAt.
function checkAlerts() {
  let changed = false;
  for (const a of alerts) {
    if (!a.enabled) continue;
    const e = cache[a.ticker];
    if (!e || !e.ind) { if (a.triggeredAt) { a.triggeredAt = null; changed = true; } continue; }
    let cur = null;
    if (a.type === "price")  cur = e.ind.price;
    else if (a.type === "global") cur = (e.score != null ? computeGlobalScore(e) : null);
    else if (a.type === "rsi")    cur = e.ind.rsi;
    else if (a.type === "change") cur = e.ind.changePct;

    let cond = false;
    if (cur != null && isFinite(cur)) {
      if (a.type === "price" || a.type === "global") cond = a.direction === "above" ? cur >= a.value : cur <= a.value;
      else if (a.type === "rsi") cond = a.direction === "oversold" ? cur <= a.value : cur >= a.value;
      else if (a.type === "change") cond = Math.abs(cur) >= a.value;
    }

    if (cond && !a.triggeredAt) {
      a.triggeredAt = new Date().toISOString();
      changed = true;
      const label = `${a.ticker} — ${alertLabel(a)}`;
      alertLog.unshift({ ticker: a.ticker, label: alertLabel(a), at: a.triggeredAt });
      if (alertLog.length > 30) alertLog.pop();
      toast(`🔔 ${label}`, "warn");
    } else if (!cond && a.triggeredAt) {
      a.triggeredAt = null; changed = true;
    }
  }
  if (changed) saveAlerts();
  if (typeof renderAlerts === "function") renderAlerts();
}
```

- [ ] **Step 2: Call checkAlerts at the end of renderAll**

Dans `renderAll`, ajouter l'appel en dernière ligne :
```js
function renderAll() {
  renderQuota();
  renderAutopick();
  renderWatchlist();
  renderTape();
  renderPositions();
  renderAnalysis();
  renderMarketResults();
  checkAlerts();
}
```

- [ ] **Step 3: Verify the engine in the console**

Serveur lancé, page ouverte (profil seedé). Analyser AAPL, puis créer une règle par code :
```js
(async function(){
  try { addTickerToWatchlist("AAPL"); } catch(e){}
  await analyzeTicker("AAPL");
  const price = cache.AAPL.ind.price;
  alerts = [{ id: newAlertId(), ticker:"AAPL", type:"price", direction:"below", value: price + 10, enabled:true, triggeredAt:null }];
  alertLog = [];
  checkAlerts(); // price <= price+10 → vrai → déclenche
  const firstTrig = !!alerts[0].triggeredAt, logLen1 = alertLog.length;
  checkAlerts(); // re-appel : condition toujours vraie → pas de re-déclenchement
  const logLen2 = alertLog.length;
  alerts[0].value = price - 10; // seuil sous le cours → condition fausse
  checkAlerts(); // réarmement
  const rearmed = alerts[0].triggeredAt === null;
  return JSON.stringify({ firstTrig, logLen1, logLen2, rearmed });
})();
```
Expected : `firstTrig` true, `logLen1` = 1, `logLen2` = 1 (pas de spam), `rearmed` true.

- [ ] **Step 4: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(client): moteur d'alertes (état, checkAlerts, hystérésis) appelé depuis renderAll"
```

---

### Task A2: Onglet F7 « Alertes » (UI + câblage)

**Files:**
- Modify: `terminal-tout-en-un.html` — barre d'onglets (~ligne 636) ; nouveau panneau après `panel-allocation` (~ligne 899) ; map clavier (~ligne 3260) ; hook de bascule (~ligne 3254) ; `renderAlerts` + câblage formulaire (près des autres rendus) ; CSS.

**Interfaces:**
- Consumes: `alerts`, `alertLog`, `alertLabel`, `checkAlerts`, `saveAlerts`, `newAlertId`, `watchlist`, `esc`, `fdate` (Task A1 + existant).
- Produces: `function renderAlerts()` ; onglet/panneau `#panel-alerts` ; `function updateAlertFormOptions()`.

- [ ] **Step 1: Add the F7 tab button**

Après le bouton F6 (`data-tab="allocation"`), ajouter :
```html
      <button class="tab" role="tab" aria-selected="false" aria-controls="panel-alerts" id="tab-alerts" data-tab="alerts">F7 · ALERTES</button>
```

- [ ] **Step 2: Add the panel**

Juste après `</section>` de `panel-allocation` (~ligne 899), avant `</main>`, insérer :
```html
    <!-- ======================= ONGLET 7 : ALERTES ======================= -->
    <section class="panel" id="panel-alerts" role="tabpanel" aria-labelledby="tab-alerts" hidden>
      <div class="panel-head">
        <h1>Alertes <span class="muted">/ prévenues à l'ouverture et à chaque analyse</span></h1>
      </div>
      <form id="form-alert" class="alert-form">
        <select id="alert-ticker" aria-label="Ticker"></select>
        <select id="alert-type" aria-label="Type d'alerte">
          <option value="price">Prix</option>
          <option value="global">Score global</option>
          <option value="rsi">RSI</option>
          <option value="change">Variation du jour</option>
        </select>
        <select id="alert-direction" aria-label="Condition"></select>
        <input type="number" id="alert-value" step="any" placeholder="Valeur" aria-label="Valeur seuil">
        <button type="submit" class="btn btn-accent">+ Ajouter l'alerte</button>
      </form>
      <p class="hint">Une alerte n'est évaluée que lorsque son titre est en cache (analysé). Pas de notification hors application.</p>
      <div id="alerts-list" class="alerts-list"></div>
      <h2 class="alerts-log-title">Déclenchements récents</h2>
      <div id="alerts-log" class="alerts-log"></div>
    </section>
```

- [ ] **Step 3: Add keyboard shortcut + tab-switch hook**

Dans la map clavier, ajouter `F7` :
```js
  const map = { F1: "dashboard", F2: "positions", F3: "buysim", F4: "analyse", F5: "marche", F6: "allocation", F7: "alerts" };
```
Dans le gestionnaire de clic d'onglet, ajouter le hook de rendu :
```js
    if (btn.dataset.tab === "analyse") renderAnalysis();
    if (btn.dataset.tab === "alerts") renderAlerts();
```

- [ ] **Step 4: Add renderAlerts + form logic + wiring**

Après le gestionnaire d'onglets (ou près des autres rendus, ex. après `renderMarketResults();` d'init), ajouter :
```js
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
```

- [ ] **Step 5: Add CSS**

Dans la section CSS (par ex. près de `.filter-panel`), ajouter :
```css
.alert-form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
.alert-form select, .alert-form input[type="number"] { padding: 4px 6px; }
.alerts-list { display: grid; gap: 6px; margin-bottom: 16px; }
.alert-item { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); font-size: 13px; }
.alert-item.triggered { border-color: var(--amber); }
.alert-item .alert-ticker { font-weight: 700; font-family: var(--mono); min-width: 70px; }
.alert-item .alert-cond { flex: 1; }
.alert-item .alert-state { color: var(--text-dim); }
.alerts-log-title { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); }
.alert-log-row { font-size: 12px; padding: 3px 0; }
```

- [ ] **Step 6: Verify interactively**

Serveur lancé, page ouverte, AAPL en watchlist et analysé. En console :
```js
(function(){
  document.getElementById("tab-alerts").click();
  // Choisir type RSI → les options de direction changent
  const typeSel = document.getElementById("alert-type");
  typeSel.value = "rsi"; typeSel.dispatchEvent(new Event("change"));
  const dirOpts = [...document.getElementById("alert-direction").options].map(o => o.value);
  // Ajouter une alerte prix qui se déclenche
  typeSel.value = "price"; typeSel.dispatchEvent(new Event("change"));
  document.getElementById("alert-ticker").value = "AAPL";
  document.getElementById("alert-direction").value = "below";
  document.getElementById("alert-value").value = cache.AAPL.ind.price + 20;
  document.getElementById("form-alert").dispatchEvent(new Event("submit"));
  const items = document.querySelectorAll("#alerts-list .alert-item").length;
  const triggered = document.querySelectorAll("#alerts-list .alert-item.triggered").length;
  return JSON.stringify({ dirOptsRsi: dirOpts, items, triggered, persisted: (localStorage.getItem("term_alerts")||"").includes("AAPL") });
})();
```
Expected : `dirOptsRsi` = `["oversold","overbought"]`, `items` ≥ 1, `triggered` ≥ 1 (l'alerte prix se déclenche), `persisted` true.

Puis **manuellement** : recharger → l'alerte est toujours là (F7) ; le tableau de bord affiche un toast 🔔 à l'ouverture ; supprimer l'alerte via ✕.

- [ ] **Step 7: Commit + déployer la feature Alertes**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(client): onglet F7 Alertes (formulaire, liste, journal, 4 types)"
git checkout main && git merge feat/alertes-export && git push origin main && git checkout feat/alertes-export
```
(Vérifier `py -m unittest discover tests` vert avant le push.)

---

### Task B1: Export des données

**Files:**
- Modify: `terminal-tout-en-un.html` — header (~ligne 618, boutons) ; fonction `exportData` + câblage (près de la modale réglages, ~ligne 3270).

**Interfaces:**
- Consumes: `watchlist`, `positions`, `tickerNames`, `filters`, `weightTech`, `alerts`, `currentProfile` (existant).
- Produces: bouton `#btn-export` ; `function exportData()`.

- [ ] **Step 1: Add the header buttons + hidden file input**

Après le bouton `#btn-settings` (~ligne 618), ajouter :
```html
        <button class="btn btn-ghost" id="btn-export" title="Exporter mes données">⬇ Export</button>
        <button class="btn btn-ghost" id="btn-import" title="Importer des données">⬆ Import</button>
        <input type="file" id="import-file" accept="application/json" hidden>
```

- [ ] **Step 2: Add exportData + wiring**

Près du câblage `btn-settings` (~ligne 3274), ajouter :
```js
function exportData() {
  const payload = {
    app: "terminal-boursier",
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: currentProfile,
    data: { watchlist, positions, tickerNames, filters, weightTech, alerts },
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
```

- [ ] **Step 3: Verify export content**

Serveur lancé, page ouverte, watchlist + une alerte présentes. En console (on intercepte le clic sur `<a>` pour lire le contenu sans télécharger de fichier réel) :
```js
(function(){
  let captured = null;
  const _create = URL.createObjectURL;
  // exportData lit directement les variables ; on reconstruit le payload pour vérifier la forme
  const payload = { app:"terminal-boursier", version:1, exportedAt:new Date().toISOString(), profile: currentProfile, data:{ watchlist, positions, tickerNames, filters, weightTech, alerts } };
  return JSON.stringify({ hasApp: payload.app === "terminal-boursier", keys: Object.keys(payload.data), watchlistLen: payload.data.watchlist.length });
})();
```
Expected : `hasApp` true, `keys` contient `watchlist, positions, tickerNames, filters, weightTech, alerts`. Puis **manuellement** : cliquer « ⬇ Export » → un fichier `terminal-Test-<date>.json` se télécharge ; l'ouvrir pour vérifier le contenu.

- [ ] **Step 4: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(client): export des données du profil en JSON"
```

---

### Task B2: Import fusion

**Files:**
- Modify: `terminal-tout-en-un.html` — `importData` + câblage (près de `exportData`).

**Interfaces:**
- Consumes: `applyPurchase`, `newAlertId`, `alertLabel`, `lsSet`, `LS`, `saveAlerts`, `renderAll`, `renderAlerts`, `toast` (existant + Task A/B).
- Produces: `function importData(file)` ; câblage `#btn-import` / `#import-file`.

- [ ] **Step 1: Add importData + wiring**

Après `exportData` / son câblage, ajouter :
```js
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
```

- [ ] **Step 2: Verify merge logic**

Serveur lancé, page ouverte. Simuler un import via un objet en mémoire (on appelle la logique de fusion en fabriquant un faux fichier) :
```js
(async function(){
  const before = { wl: watchlist.length, pos: positions.length, al: alerts.length };
  const payload = { app:"terminal-boursier", version:1, data:{
    watchlist:["NVDA","AAPL"], // AAPL peut déjà exister → pas de doublon
    positions:[{ ticker:"NVDA", qty:2, pru:100 }],
    tickerNames:{ NVDA:"Nvidia" },
    alerts:[{ ticker:"NVDA", type:"price", direction:"above", value:200, enabled:true }],
  }};
  const blob = new Blob([JSON.stringify(payload)], { type:"application/json" });
  const file = new File([blob], "test.json", { type:"application/json" });
  // confirmer automatiquement
  const _c = window.confirm; window.confirm = () => true;
  importData(file);
  await new Promise(r => setTimeout(r, 300)); // FileReader async
  window.confirm = _c;
  const after = { wl: watchlist.length, pos: positions.length, al: alerts.length,
                  nvdaInWl: watchlist.includes("NVDA"), nvdaName: tickerNames.NVDA };
  // ré-import : pas de doublon d'alerte
  const _c2 = window.confirm; window.confirm = () => true;
  importData(file);
  await new Promise(r => setTimeout(r, 300));
  window.confirm = _c2;
  const alertsAfterReimport = alerts.filter(a => a.ticker === "NVDA" && a.type === "price").length;
  return JSON.stringify({ before, after, alertsAfterReimport });
})();
```
Expected : `after.nvdaInWl` true, `after.nvdaName` = "Nvidia", `after.al` = before.al + 1, `alertsAfterReimport` = 1 (pas de doublon au ré-import). Vérifier aussi qu'un fichier non conforme (`{app:"autre"}`) est rejeté par un toast.

- [ ] **Step 3: Commit + déployer la feature Export/Import**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(client): import fusion des données (watchlist, positions, alertes)"
git checkout main && git merge feat/alertes-export && git push origin main
git branch -d feat/alertes-export
```
(Vérifier `py -m unittest discover tests` vert avant le push.)

---

## Vérification finale (après les 4 tâches)

- [ ] `py -m unittest discover tests` → vert.
- [ ] Alertes : les 4 types se créent, se déclenchent (toast 🔔 + état), se réarment ; pas de spam ; persistées par profil ; onglet F7 fonctionnel (F7 clavier).
- [ ] Export : fichier JSON téléchargé, contenu correct.
- [ ] Import fusion : union watchlist/positions/alertes ; ré-import sans doublon ; fichier non conforme rejeté.
- [ ] Non-régression : onglets F1–F6 inchangés.
- [ ] Déploiements Render effectués après la feature Alertes puis après Export/Import.

## Notes d'implémentation

- **Ordre** : A1 → A2 (déploiement) → B1 → B2 (déploiement).
- `checkAlerts()` appelle `renderAlerts()` si définie (`typeof`) → sûr même avant la Task A2.
- Numéros de ligne indicatifs ; se repérer sur les extraits exacts.
- L'export/import est déclenché par l'utilisateur dans sa propre app (téléchargement de ses données, sélection de son fichier) — aucune donnée n'est envoyée à un tiers.
