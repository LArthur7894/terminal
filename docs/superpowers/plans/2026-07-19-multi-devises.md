# Portefeuille multi-devises — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir les agrégats du portefeuille (valeur/coût/P&L totaux, allocation, courbe d'évolution) vers une devise de référence configurable, en gardant chaque ligne dans sa devise native.

**Architecture:** Ajout d'une couche de taux de change (cache mémoire + localStorage, alimentée par la paire Yahoo `{FROM}{TO}=X` via le relais `/api/history` existant). Un accesseur synchrone lit ce cache pendant le rendu ; une fonction async `ensureFxRates()` pré-charge les taux manquants puis déclenche un re-render. Trois points de calcul (`renderPositions`, `renderAllocationChart`, `recordPerfSnapshot`) passent des valeurs brutes aux valeurs converties.

**Tech Stack:** JS vanilla inline dans `terminal-tout-en-un.html` (pas de build), Chart.js déjà présent, relais Python `server.py`. Aucune nouvelle dépendance.

## Global Constraints

- Fichier front unique `terminal-tout-en-un.html` (JS inline, pas de build) — copier les patterns existants (`lsGet`/`lsSet`, `LS.*`, `fnum`/`fpct`, `esc`).
- Devise de référence par défaut : `"EUR"`. Options du sélecteur : `EUR, USD, GBP, CHF, CAD, JPY, AUD`.
- Fraîcheur des taux FX : rafraîchir si plus vieux que **12 h**.
- **Jamais de chiffre faux silencieux** : si un taux manque, l'agrégat concerné affiche un état dégradé explicite (`—` + indication), pas une somme partielle présentée comme totale.
- Hors périmètre, ne pas modifier : Bot F8, Allocation F6, points passés de la courbe d'évolution.
- `getFxRate` doit taper le relais Yahoo `/api/history` **directement** (pas via `fetchDailySeries`), pour ne jamais passer par Alpha Vantage ni consommer son quota.

## Verification approach (lire avant de commencer)

Pas de harnais de test JS dans ce projet : la logique vit en JS inline. La vérification se fait en **pilotant l'app** (pattern établi, voir mémoire `project-setup`). Rappels :

- Lancer le serveur : `PYTHONIOENCODING=utf-8 py server.py` (sur cette machine `python` = stub Store ; le bandeau `┌─` plante en cp1252 sans `PYTHONIOENCODING`).
- Ouvrir **`http://localhost:8750/terminal-tout-en-un.html`** (le serveur ne sert pas d'`index.html`).
- Avant de charger la page, pré-remplir `localStorage` pour éviter le `window.prompt()` de `pickProfile()` :
  ```js
  localStorage.setItem('term_profiles', '["Test"]');
  localStorage.setItem('term_current_profile', '"Test"');
  ```
- Les clés de données sont scopées par profil : suffixe `::Test` (ex. `term_positions::Test`).

Chaque tâche fournit l'état à injecter et la valeur attendue, calculable à la main.

---

### Task 1: Couche de taux de change (FX)

Ajoute l'état `fxRates`, la clé `LS.fx`, l'accesseur synchrone `fxRateCached`, le fetch async `getFxRate`, et `ensureFxRates`. Aucun impact visuel encore — deliverable vérifiable en console.

**Files:**
- Modify: `terminal-tout-en-un.html` — objet `LS` (~1161), bloc état global (~1183), nouvelle section FX à insérer juste avant `/* ===== SOURCE DE DONNÉES ===== */` (~1596).

**Interfaces:**
- Consumes : `positions` (état global), `cache` (`cache[ticker].hist.currency`), `lsGet`/`lsSet`, `FETCH_TIMEOUT_MS`.
- Produces :
  - `getBaseCurrency() -> string` (défaut `"EUR"` ; lit `LS.baseCurrency`, complété en Task 2 côté écriture).
  - `positionCurrency(pos) -> string|null`
  - `fxRateCached(from, to) -> number|null` (sync, lit le cache uniquement)
  - `getFxRate(from, to) -> Promise<number|null>` (async, fetch + cache + persistance)
  - `ensureFxRates() -> Promise<void>` (pré-charge tous les taux nécessaires puis re-render)

- [ ] **Step 1: Ajouter la clé localStorage `fx`**

Dans l'objet `LS` (~1161), après la ligne `perfJournal: ...`, ajouter :

```js
  fx: "term_fx", // taux de change en cache { "FROM->TO": {rate, updated} }, par profil
  baseCurrency: "term_base_currency", // devise de référence du portefeuille (défaut EUR)
```

- [ ] **Step 2: Ajouter l'état global `fxRates`**

Dans le bloc ÉTAT GLOBAL, juste après `let tickerNames = ...` (~1183), ajouter :

```js
let fxRates = lsGet(LS.fx, {});             // { "USD->EUR": {rate, updated} }
if (!fxRates || typeof fxRates !== "object") fxRates = {};
```

- [ ] **Step 3: Écrire la section FX complète**

Juste avant le commentaire `/* ============================= SOURCE DE DONNÉES ============================= */` (~1596), insérer :

```js
/* ============================= TAUX DE CHANGE (FX) =============================
 * Les agrégats du portefeuille (total, allocation, courbe) sont convertis vers
 * une devise de référence. Les taux viennent de la paire Yahoo {FROM}{TO}=X
 * (ex. USDEUR=X = nombre de TO pour 1 FROM), via le relais /api/history — jamais
 * via Alpha Vantage. Cache mémoire + localStorage, rafraîchi au-delà de 12 h.
 * ============================================================================ */

const FX_MAX_AGE_MS = 12 * 3600 * 1000;
const FX_CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "JPY", "AUD"];

function getBaseCurrency() {
  const c = lsGet(LS.baseCurrency, "EUR");
  return FX_CURRENCIES.includes(c) ? c : "EUR";
}

// Devise native d'une position = devise du cours en cache, sinon inconnue (null).
function positionCurrency(pos) {
  const entry = cache[pos.ticker];
  return (entry && entry.hist && entry.hist.currency) ? entry.hist.currency : null;
}

// Lecture SYNCHRONE du cache (aucun réseau). Renvoie le taux ou null si absent.
function fxRateCached(from, to) {
  if (from === to) return 1;
  const hit = fxRates[`${from}->${to}`];
  return hit && isFinite(hit.rate) && hit.rate > 0 ? hit.rate : null;
}

// Récupère (et met en cache) le taux from->to. Renvoie le nombre ou null si échec.
async function getFxRate(from, to) {
  if (from === to) return 1;
  const k = `${from}->${to}`;
  const hit = fxRates[k];
  if (hit && isFinite(hit.rate) && hit.rate > 0
      && Date.now() - new Date(hit.updated).getTime() < FX_MAX_AGE_MS) {
    return hit.rate; // frais → pas de réseau
  }
  if (location.protocol === "file:") return fxRateCached(from, to); // pas de relais dispo

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch("/api/history?symbol=" + encodeURIComponent(`${from}${to}=X`),
                             { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await resp.json();
    const rate = data && Array.isArray(data.closes) ? Number(data.closes[0]) : NaN;
    if (!isFinite(rate) || rate <= 0) return fxRateCached(from, to);
    fxRates[k] = { rate, updated: new Date().toISOString() };
    lsSet(LS.fx, fxRates);
    return rate;
  } catch {
    clearTimeout(timer);
    return fxRateCached(from, to); // échec réseau → on retombe sur l'ancien taux s'il existe
  }
}

// Pré-charge tous les taux nécessaires (devises du portefeuille ≠ base), puis re-render
// pour que renderPositions (synchrone) trouve les taux dans le cache.
async function ensureFxRates() {
  const base = getBaseCurrency();
  const needed = new Set();
  for (const pos of positions) {
    const cur = positionCurrency(pos);
    if (cur && cur !== base) needed.add(cur);
  }
  if (needed.size === 0) return;
  const before = JSON.stringify(fxRates);
  await Promise.all([...needed].map(cur => getFxRate(cur, base)));
  if (JSON.stringify(fxRates) !== before) renderPositions();
}
```

- [ ] **Step 4: Vérifier en console (le relais accepte les paires FX)**

Lancer `PYTHONIOENCODING=utf-8 py server.py`, ouvrir `http://localhost:8750/terminal-tout-en-un.html` (profil pré-rempli). Dans la console :

```js
await getFxRate("USD", "EUR");
```

Attendu : un nombre plausible (≈ 0.8–1.0). Puis vérifier le cache et l'accesseur sync :

```js
JSON.parse(localStorage.getItem('term_fx::Test'));   // { "USD->EUR": {rate, updated} }
fxRateCached("USD", "EUR");                            // même nombre
fxRateCached("EUR", "EUR");                            // 1
fxRateCached("JPY", "EUR");                            // null (jamais chargé)
```

- [ ] **Step 5: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(devises): couche de taux de change (cache + relais Yahoo)"
```

---

### Task 2: Devise de référence — sélecteur & câblage

Ajoute le `<select>` dans l'en-tête Positions, la persistance, et branche `ensureFxRates()` au changement de devise, à l'ouverture de l'onglet, et au chargement initial.

**Files:**
- Modify: `terminal-tout-en-un.html` — en-tête onglet Positions (`<div class="panel-head">` ~808), handler d'onglets (~3738), init `renderAll()` (~4215), + un handler `change` pour le select.

**Interfaces:**
- Consumes : `getBaseCurrency`, `ensureFxRates`, `renderAll`, `lsSet`, `LS.baseCurrency`.
- Produces : élément DOM `#base-currency` (valeur = devise active) ; effet de bord : `LS.baseCurrency` persistée, taux pré-chargés.

- [ ] **Step 1: Ajouter le sélecteur dans l'en-tête Positions**

Dans `#panel-positions > .panel-head` (~808), juste après `<h1>Mes positions</h1>`, insérer :

```html
        <label class="base-cur-label" for="base-currency">Devise de réf.
          <select id="base-currency" class="base-cur-select" aria-label="Devise de référence du portefeuille">
            <option value="EUR">EUR €</option>
            <option value="USD">USD $</option>
            <option value="GBP">GBP £</option>
            <option value="CHF">CHF</option>
            <option value="CAD">CAD $</option>
            <option value="JPY">JPY ¥</option>
            <option value="AUD">AUD $</option>
          </select>
        </label>
```

- [ ] **Step 2: Style minimal du sélecteur**

Dans le bloc CSS `/* ===== POSITIONS ===== */` (~390), ajouter :

```css
.base-cur-label { font-size: 12px; color: var(--text-dim); display: inline-flex; align-items: center; gap: 6px; }
.base-cur-select { font-family: inherit; font-size: 12px; background: var(--bg-raised); color: var(--text); border: 1px solid #2a3340; border-radius: 4px; padding: 4px 6px; }
```

- [ ] **Step 3: Initialiser la valeur du select + handler de changement**

Juste avant la définition de `function renderAll()` (~4202), ajouter :

```js
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
```

- [ ] **Step 4: Pré-charger les taux à l'ouverture de l'onglet et au démarrage**

Dans le handler d'onglets (~3738), remplacer la ligne :

```js
    if (btn.dataset.tab === "positions") renderPositions();
```

par :

```js
    if (btn.dataset.tab === "positions") { renderPositions(); ensureFxRates(); }
```

Puis, après l'appel initial `renderAll();` (~4215), ajouter :

```js
ensureFxRates(); // pré-charge les taux dès le démarrage si le portefeuille est multi-devises
```

- [ ] **Step 5: Vérifier**

Recharger la page. Attendu :
- Le sélecteur « Devise de réf. » apparaît dans l'onglet F2, valeur `EUR`.
- Le changer sur `USD` puis recharger : il reste sur `USD`, et `localStorage.getItem('term_base_currency::Test')` vaut `"USD"`.
- Console : `getBaseCurrency()` renvoie `"USD"`.

- [ ] **Step 6: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(devises): sélecteur de devise de référence + câblage FX"
```

---

### Task 3: Conversion dans `renderPositions`

Convertit les totaux vers la devise de référence, affiche le code devise sur les lignes non-base, et gère les états dégradés (devise inconnue, taux manquant).

**Files:**
- Modify: `terminal-tout-en-un.html` — `renderPositions` (~2611) et helpers ajoutés juste au-dessus.

**Interfaces:**
- Consumes : `positionCurrency`, `fxRateCached`, `getBaseCurrency`, `refPrice`, `fnum`, `fpct`, `pctClass`, `esc`.
- Produces :
  - `convertToBase(amount, fromCur) -> {value: number|null, ok: boolean}`
  - `positionValueBase(pos) -> {value: number|null, ok: boolean}` (utilisée aussi par Task 4)
  - `currencySymbol(code) -> string`

- [ ] **Step 1: Ajouter les helpers de conversion**

Juste avant `function renderPositions()` (~2611), insérer :

```js
const CURRENCY_SYMBOLS = { EUR: "€", USD: "$", GBP: "£", CHF: "CHF", CAD: "C$", JPY: "¥", AUD: "A$" };
function currencySymbol(code) { return CURRENCY_SYMBOLS[code] || code || ""; }

// Convertit un montant depuis fromCur vers la devise de référence.
// ok=false si la devise est inconnue ou le taux indisponible → agrégat marqué dégradé.
function convertToBase(amount, fromCur) {
  const base = getBaseCurrency();
  if (!fromCur) return { value: null, ok: false };      // devise inconnue
  if (fromCur === base) return { value: amount, ok: true };
  const r = fxRateCached(fromCur, base);
  if (r === null) return { value: null, ok: false };    // taux pas encore chargé
  return { value: amount * r, ok: true };
}

// Valeur d'une position exprimée en devise de référence.
function positionValueBase(pos) {
  return convertToBase(pos.qty * refPrice(pos), positionCurrency(pos));
}
```

- [ ] **Step 2: Convertir la boucle et le total dans `renderPositions`**

Remplacer le corps de `renderPositions` depuis `let totalValue = 0, totalCost = 0;` jusqu'à la fin de la ligne de total (avant `renderAllocationChart();`) par :

```js
  let totalValue = 0, totalCost = 0, degraded = false;
  const base = getBaseCurrency();

  if (positions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="na">Aucune position — ajoutez-en une ci-dessus.</td></tr>`;
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
      : (!cur ? `<span class="cur-badge cur-unknown" title="Devise inconnue (jamais analysé) — supposée exclue du total">?</span>` : "");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="card-title"><span class="cell-ticker">${esc(pos.ticker)}</span>${noCache ? `<span class="stale-badge" title="Pas de cours en cache : PRU utilisé">PRU</span>` : ""}${curBadge}</td>
      <td class="num" data-label="Qté">${fmtNum.format(pos.qty)}</td>
      <td class="num" data-label="PRU">${fnum(pos.pru)}</td>
      <td class="num" data-label="Cours">${fnum(price)}</td>
      <td class="num" data-label="Valeur">${fnum(value)}</td>
      <td class="num ${pctClass(pnl)}" data-label="P&L">${fnum(pnl)}</td>
      <td class="num ${pctClass(pnlPct)}" data-label="P&L %">${fpct(pnlPct)}</td>
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
  }

  // Ligne de total — exprimée en devise de référence
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const sym = currencySymbol(base);
  const suffix = degraded ? ` ${sym} ⚠` : ` ${sym}`;
  const elVal = document.getElementById("total-value");
  elVal.textContent = fnum(totalValue) + suffix;
  elVal.title = degraded ? "Certaines positions n'ont pas pu être converties (devise inconnue ou taux indisponible) et sont exclues du total." : "";
  const elPnl = document.getElementById("total-pnl");
  const elPct = document.getElementById("total-pnl-pct");
  elPnl.textContent = fnum(totalPnl) + " " + sym;
  elPct.textContent = fpct(totalPnlPct);
  elPnl.className = "num " + pctClass(totalPnl);
  elPct.className = "num " + pctClass(totalPnl);
```

(Les appels `renderAllocationChart(); recordPerfSnapshot(); renderPerfJournal();` restent inchangés à la fin.)

- [ ] **Step 3: Style des badges devise**

Dans le bloc CSS `/* ===== POSITIONS ===== */` (~390), ajouter :

```css
.cur-badge { display: inline-block; margin-left: 6px; padding: 1px 5px; font-size: 10px; border-radius: 3px; background: var(--bg-raised); color: var(--text-dim); border: 1px solid #2a3340; }
.cur-badge.cur-unknown { color: #ff4d4d; border-color: #5a2a2a; }
```

- [ ] **Step 4: Vérifier avec un portefeuille multi-devises**

Injecter un état contrôlé (console, avant rechargement) — deux positions, l'une USD, l'autre EUR, avec cours en cache et devises forcées :

```js
localStorage.setItem('term_positions::Test', JSON.stringify([
  {id:1, ticker:"AAPL", qty:10, pru:100},
  {id:2, ticker:"MC.PA", qty:5, pru:200}
]));
localStorage.setItem('term_cache::Test', JSON.stringify({
  AAPL:  {updated:new Date().toISOString(), hist:{currency:"USD"}, ind:{price:150}, score:50, fund:null, fundScore:null},
  "MC.PA":{updated:new Date().toISOString(), hist:{currency:"EUR"}, ind:{price:250}, score:50, fund:null, fundScore:null}
}));
localStorage.setItem('term_base_currency::Test', '"EUR"');
```

Recharger, aller sur F2, laisser `ensureFxRates()` charger USD→EUR. Attendu, avec `r = fxRateCached("USD","EUR")` :
- Ligne AAPL : Valeur `1 500,00` + badge `USD`. Ligne MC.PA : Valeur `1 250,00` (pas de badge).
- Total valeur = `1500·r + 1250` en €. Le vérifier :
  ```js
  const r = fxRateCached("USD","EUR");
  (1500*r + 1250).toFixed(2);   // doit correspondre au total affiché (au symbole € près)
  ```
- Basculer le migrateur : ce cache minimal (`ind` sans `perf`) déclenche la migration au chargement ; vérifier qu'aucune erreur console n'apparaît et que le total reste correct.

- [ ] **Step 5: Vérifier l'état dégradé**

En console : `localStorage.removeItem('term_fx::Test');` puis recharger **sans** laisser le réseau répondre (couper la connexion ou observer l'instant initial). Pendant que le taux USD→EUR n'est pas en cache, le total doit afficher `1 250,00 € ⚠` (AAPL exclue), jamais `2 750` (somme brute fausse). Une fois `ensureFxRates()` terminé, le total se complète et le `⚠` disparaît.

- [ ] **Step 6: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(devises): conversion des totaux Positions + badges devise + état dégradé"
```

---

### Task 4: Conversion de l'allocation et de la courbe d'évolution

Applique `positionValueBase` au camembert d'allocation et à l'enregistrement du snapshot de performance.

**Files:**
- Modify: `terminal-tout-en-un.html` — `renderAllocationChart` (~2772), `recordPerfSnapshot` (~2589).

**Interfaces:**
- Consumes : `positionValueBase`, `getBaseCurrency`, `currencySymbol`.
- Produces : aucun nouvel export ; effet : agrégats visuels et journal en devise de référence.

- [ ] **Step 1: Convertir les valeurs du camembert**

Dans `renderAllocationChart` (~2772), remplacer :

```js
  const labels = positions.map(p => p.ticker);
  const values = positions.map(p => p.qty * refPrice(p));
```

par (n'inclure que les positions convertibles, pour des parts cohérentes) :

```js
  const base = getBaseCurrency();
  const conv = positions
    .map(p => ({ ticker: p.ticker, c: positionValueBase(p) }))
    .filter(x => x.c.ok && isFinite(x.c.value) && x.c.value > 0);
  const labels = conv.map(x => x.ticker);
  const values = conv.map(x => x.c.value);
```

Puis, dans le callback de tooltip (~2806), remplacer `${fmtNum.format(ctx.parsed)}` par `${fmtNum.format(ctx.parsed)} ${currencySymbol(base)}` pour afficher la devise de référence.

- [ ] **Step 2: Convertir le snapshot de performance**

Dans `recordPerfSnapshot` (~2589), remplacer :

```js
  const value = positions.reduce((s, p) => s + p.qty * refPrice(p), 0);
  if (!isFinite(value) || value <= 0) return;
```

par (n'enregistrer un point que si TOUTES les positions sont convertibles, pour ne pas polluer la courbe avec un total partiel) :

```js
  let value = 0;
  for (const p of positions) {
    const c = positionValueBase(p);
    if (!c.ok) return;            // au moins une position non convertible → on saute ce jour
    value += c.value;
  }
  if (!isFinite(value) || value <= 0) return;
```

- [ ] **Step 3: Vérifier**

Avec le même état multi-devises que Task 3 (AAPL USD + MC.PA EUR, taux USD→EUR chargé), sur F2 :
- Camembert : deux parts. Part AAPL = `1500·r / (1500·r + 1250)`. Vérifier en console :
  ```js
  const r = fxRateCached("USD","EUR");
  (1500*r / (1500*r + 1250) * 100).toFixed(1);  // % de la part AAPL au survol
  ```
- Journal : le dernier point de `JSON.parse(localStorage.getItem('term_perf_journal::Test'))` doit valoir `1500·r + 1250` (à 0,005 près), et non `2750`.
- Retirer le taux du cache (`localStorage.removeItem('term_fx::Test')`), recharger et bloquer le réseau : aucun nouveau point n'est ajouté au journal tant qu'AAPL n'est pas convertible (pas de point à `1250` seul).

- [ ] **Step 4: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(devises): allocation et courbe d'évolution en devise de référence"
```

---

## Self-Review (rempli)

**Spec coverage :**
- §1 Devise de référence (réglage) → Task 2 (select + persistance + `getBaseCurrency`).
- §2 Taux de change (`getFxRate`, cache, fraîcheur 12 h, 1 appel/devise) → Task 1.
- §3 Conversion (`positionValueBase`, 3 points, badge devise) → Task 3 (positions + badge) & Task 4 (allocation + snapshot).
- §4 Rendu asynchrone (`ensureFxRates` + re-render, état « … »/badge) → Task 1 (`ensureFxRates`), Task 2 (câblage), Task 3 (`⚠` dégradé).
- §5 Dégradation (devise inconnue, taux indisponible, jamais de faux total) → Task 3 Steps 1/2/5, Task 4 Steps 1/2/3.
- Hors périmètre (Bot, Allocation F6, points passés) → non touchés ; le snapshot ne réécrit pas l'historique.
- Critères de réussite 1–6 → couverts par les vérifications Task 3 Step 4/5 et Task 4 Step 3 (dont non-régression mono-devise : un portefeuille EUR pur n'entre jamais dans le chemin de conversion, `convertToBase` renvoie `{value, ok:true}` immédiatement).

**Placeholder scan :** aucun TODO/TBD ; code complet à chaque étape.

**Type consistency :** `convertToBase`/`positionValueBase` renvoient `{value, ok}` — consommé de façon cohérente en Task 3 (déstructuré `.ok`/`.value`) et Task 4. `fxRateCached`/`getFxRate` renvoient `number|null`. `positionCurrency` renvoie `string|null`. `getBaseCurrency` renvoie `string`. Noms identiques entre définition (Task 1/3) et usages (Task 3/4).
