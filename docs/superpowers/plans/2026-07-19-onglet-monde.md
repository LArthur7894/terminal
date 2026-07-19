# Onglet MONDE (macro & actualité) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un 10e onglet « F10 · MONDE » : panorama macro en direct (indices, taux, devises, matières, crypto, secteurs), fil d'actus monde, et notes d'impact macro→actions écrites d'avance.

**Architecture:** 100 % frontend dans `terminal-tout-en-un.html`, en réutilisant `/api/history` (cours → variation du jour depuis les 2 dernières clôtures) et `/api/news` (actus fusionnées). Récupération concurrente via le pool existant `runPool`, cache mémoire, pas d'auto-refresh. Aucun changement de `server.py`.

**Tech Stack:** JS vanilla inline (pas de build), endpoints Python existants inchangés.

## Global Constraints

- **Zéro changement `server.py`, zéro nouvelle dépendance, zéro clé API.**
- Front : fichier unique `terminal-tout-en-un.html`, JS inline — copier les patterns existants (`runPool`, `loadNews`/`newsCache`, `fnum`/`fpct`/`pctClass`/`esc`, variables CSS `--bg-raised`/`--text`/`--text-dim`/`--border`/`--blue`).
- Onglet : `F10 · MONDE`, `data-tab="monde"`, panneau `#panel-monde`, en 10e position. Rendu par `renderMonde()`, données chargées **à l'ouverture de l'onglet** (jamais au démarrage), + bouton « Rafraîchir ». Pas d'auto-refresh.
- Variation du jour = `(closes[0] - closes[1]) / closes[1] × 100`, affichée en % uniforme, couleur via `pctClass`.
- Dégradation : symbole en échec → `{last:null, changePct:null}` → cellule « — », n'interrompt pas la grille.
- Symboles Yahoo exacts (tous ≤ 15 car., sûrs après `.upper()`) : indices `^GSPC ^IXIC ^DJI ^FCHI ^GDAXI ^FTSE ^N225` ; taux/vol `^TNX ^VIX` ; devises `EURUSD=X USDJPY=X DX-Y.NYB` ; matières `CL=F GC=F` ; crypto `BTC-USD` ; secteurs `XLK XLE XLF XLV XLY XLP XLI XLU XLB XLRE XLC`.

## Verification approach (lire avant de commencer)

Pas de harnais JS dans le projet. Pour chaque tâche : (a) `node --check` sur le `<script>` extrait ; (b) harnais Node jetable pour les fonctions pures (non committé) ; (c) inspection structurelle. La vérification navigateur de bout en bout (ouvrir F10 avec le serveur lancé, vérifier grille/tri/actus/notes) est faite **par le contrôleur** après intégration. Lancer le serveur : `PYTHONIOENCODING=utf-8 "C:\Users\amagu\AppData\Local\Programs\Python\Python311\python.exe" server.py` ; ouvrir `http://localhost:8750/terminal-tout-en-un.html` ; profil headless : `localStorage['term_profiles']='["Test"]'` (JSON) + `localStorage['term_current_profile']='Test'` (chaîne brute) avant chargement.

---

### Task 1: Onglet MONDE — coquille + panorama de marché

Crée l'onglet, les données d'instruments, la couche de fetch, et le rendu de la grille groupée + rotation sectorielle. Les actus et les notes d'impact sont des **stubs** remplis aux tâches 2 et 3.

**Files:**
- Modify: `terminal-tout-en-un.html` — barre d'onglets (`<nav class="tabs">`, après le bouton `tab-compare`), panneaux (après `#panel-compare`, avant `</main>`), CSS (nouvelle section), JS (nouveau bloc avant le handler `document.querySelectorAll(".tab").forEach`), + une ligne dans ce handler.

**Interfaces:**
- Consumes : `runPool`, `fnum`, `fpct`, `pctClass`, `esc`.
- Produces :
  - `mondeChangePct(closes) -> number|null`
  - `fetchMondeQuote(sym) -> Promise<{last:number|null, changePct:number|null}>`
  - `loadMondeData() -> Promise<void>` (remplit `mondeCache`, `mondeUpdated`)
  - `renderMonde() -> void`
  - stubs `renderMondeNews() -> string` (renvoie `""`) et `mondeImpactHtml(key) -> string` (renvoie `""`)
  - état : `mondeCache`, `mondeUpdated`, `mondeLoading`

- [ ] **Step 1: Ajouter le bouton d'onglet F10**

Dans `<nav class="tabs">`, juste après le bouton `id="tab-compare"`, ajouter :

```html
      <button class="tab" role="tab" aria-selected="false" aria-controls="panel-monde" id="tab-monde" data-tab="monde">F10 · MONDE</button>
```

- [ ] **Step 2: Ajouter le panneau**

Juste après la fermeture `</section>` du panneau `#panel-compare` et avant `</main>`, ajouter :

```html
    <!-- ======================= ONGLET 10 : MONDE ======================= -->
    <section class="panel" id="panel-monde" role="tabpanel" aria-labelledby="tab-monde" hidden>
      <div class="panel-head">
        <h1>Monde <span class="muted">/ macro & actualité — repères pour l'entretien</span></h1>
      </div>
      <div id="monde-body"></div>
    </section>
```

- [ ] **Step 3: Ajouter le CSS**

Dans une nouvelle section CSS (juste avant `/* ===== DISCLAIMER ===== */`, chercher ce commentaire), ajouter :

```css
/* ============================= ONGLET MONDE ============================= */
.monde-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.monde-group { margin: 0 0 18px; }
.monde-group-title { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: var(--amber); margin: 0 0 6px; border-top: 1px solid var(--border); padding-top: 10px; }
.monde-why { font-size: 12px; color: var(--text-dim); margin: 0 0 8px; }
.monde-impact-live { font-size: 12px; color: var(--text); margin: 0 0 8px; font-weight: 600; }
.monde-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; }
.monde-cell { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; background: var(--bg-raised); border: 1px solid var(--border); border-radius: 6px; }
.monde-name { font-size: 11px; color: var(--text-dim); }
.monde-val { font-size: 15px; font-family: var(--mono); color: var(--text); }
.monde-chg { font-size: 12px; font-family: var(--mono); }
```

- [ ] **Step 4: Écrire la fonction pure `mondeChangePct` (avec harnais Node)**

Repérer le handler d'onglets `document.querySelectorAll(".tab").forEach(btn => {`. Juste **avant** ce handler, insérer le bloc MONDE. Commencer par les données + la fonction pure :

```js
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

let mondeCache = {};        // { SYMBOL: {last, changePct} }, mémoire uniquement
let mondeUpdated = null;    // Date du dernier chargement réussi
let mondeLoading = false;

// Variation du jour en % depuis [clôture la plus récente, précédente, ...]. null si non calculable.
function mondeChangePct(closes) {
  if (!Array.isArray(closes) || closes.length < 2) return null;
  const c0 = Number(closes[0]), c1 = Number(closes[1]);
  if (!isFinite(c0) || !isFinite(c1) || c1 === 0) return null;
  return (c0 - c1) / c1 * 100;
}
```

Harnais Node jetable (copier `mondeChangePct` dans un `.js` de scratch, exécuter, coller la sortie au rapport, supprimer le fichier — ne pas committer) :

```js
const t = [[[110,100],10],[[90,100],-10],[[100],null],[[100,0],null],[["x",1],null],[[],null]];
for (const [in_, exp] of t) console.log(mondeChangePct(in_) === exp ? "PASS" : `FAIL ${JSON.stringify(in_)} -> ${mondeChangePct(in_)} (attendu ${exp})`);
```
Attendu : 6× PASS.

- [ ] **Step 5: Ajouter fetch + chargement + rendu (à la suite du même bloc)**

Juste après `mondeChangePct`, ajouter :

```js
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
  mondeUpdated = new Date();
  mondeLoading = false;
  renderMonde();
}

// Stubs remplis aux tâches 2 et 3.
function renderMondeNews() { return ""; }
function mondeImpactHtml(key) { return ""; }

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
```

- [ ] **Step 6: Câbler l'ouverture de l'onglet**

Dans le handler `document.querySelectorAll(".tab").forEach`, à la suite des lignes `if (btn.dataset.tab === "compare") renderCompare();`, ajouter :

```js
    if (btn.dataset.tab === "monde") { renderMonde(); if (!mondeUpdated && !mondeLoading) loadMondeData(); }
```

- [ ] **Step 7: Vérifier (syntaxe + structure)**

1. `node --check` sur le `<script>` extrait → exit 0.
2. Inspection : bouton `tab-monde` présent dans `.tabs` ; `#panel-monde` + `#monde-body` présents ; `MONDE_ALL_SYMBOLS` contient 26 symboles (15 groupes + 11 secteurs) ; `renderMonde`/`fetchMondeQuote`/`loadMondeData` définis ; stubs `renderMondeNews`/`mondeImpactHtml` présents ; la ligne `dataset.tab === "monde"` est dans le handler.

- [ ] **Step 8: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(monde): onglet F10 — panorama macro en direct (indices, taux, devises, matières, crypto, secteurs)"
```

---

### Task 2: Fil d'actus monde

Remplit le stub `renderMondeNews` avec un fil d'actus agrégé (fusion `/api/news` sur symboles phares), et ajoute le chargement des actus à `loadMondeData`.

**Files:**
- Modify: `terminal-tout-en-un.html` — bloc MONDE (ajouter `parseFrDate`, `mondeNews`, `loadMondeNews`, remplacer le stub `renderMondeNews`) + une ligne dans `loadMondeData`.

**Interfaces:**
- Consumes : `loadNews`, `newsCache` (existants), `runPool`, `esc`, `mondeCache`.
- Produces : `parseFrDate(s) -> number`, `loadMondeNews() -> Promise<void>`, état `mondeNews`.

- [ ] **Step 1: Ajouter l'état + `parseFrDate` + `loadMondeNews`**

Dans le bloc MONDE, juste après la déclaration `let mondeLoading = false;`, ajouter :

```js
let mondeNews = null;      // [{title, link, publisher, date}] fusionnés, ou null si pas encore chargé
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
```

Harnais Node jetable pour `parseFrDate` (copier la fonction, exécuter, coller la sortie, supprimer) :

```js
console.log(parseFrDate("15/07/2026") > parseFrDate("14/07/2026") ? "PASS ordre" : "FAIL ordre");
console.log(parseFrDate("") === 0 && parseFrDate("bad") === 0 ? "PASS invalides" : "FAIL invalides");
```
Attendu : 2× PASS.

- [ ] **Step 2: Charger les actus dans `loadMondeData`**

Dans `loadMondeData`, juste après la ligne `await runPool(MONDE_ALL_SYMBOLS, ...)` et avant `mondeUpdated = new Date();`, ajouter :

```js
  await loadMondeNews();
```

- [ ] **Step 3: Remplacer le stub `renderMondeNews`**

Remplacer entièrement la ligne stub :

```js
function renderMondeNews() { return ""; }
```

par :

```js
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
```

- [ ] **Step 4: Vérifier**

1. `node --check` → exit 0.
2. Inspection : `loadMondeNews` défini ; `await loadMondeNews();` présent dans `loadMondeData` entre le `runPool` marché et `mondeUpdated = new Date()` ; `renderMondeNews` n'est plus un stub et réutilise la classe `.news-list`.

- [ ] **Step 5: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(monde): fil d'actus monde (fusion /api/news, dédup, tri par date)"
```

---

### Task 3: Notes d'impact macro→actions

Remplit le stub `mondeImpactHtml` avec les notes pédagogiques statiques + la mise en avant du sens du mouvement du jour.

**Files:**
- Modify: `terminal-tout-en-un.html` — bloc MONDE (ajouter `MONDE_IMPACT`, remplacer le stub `mondeImpactHtml`).

**Interfaces:**
- Consumes : `mondeCache`, `esc`.
- Produces : `mondeImpactHtml(key) -> string` (implémentation réelle).

- [ ] **Step 1: Ajouter le contenu `MONDE_IMPACT`**

Dans le bloc MONDE, juste après la déclaration de `MONDE_ALL_SYMBOLS`, ajouter :

```js
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
```

- [ ] **Step 2: Remplacer le stub `mondeImpactHtml`**

Remplacer entièrement la ligne stub :

```js
function mondeImpactHtml(key) { return ""; }
```

par :

```js
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
```

- [ ] **Step 3: Vérifier**

1. `node --check` → exit 0.
2. Inspection : `MONDE_IMPACT` défini avec les 6 clés (`indices, taux, devises, matieres, crypto, sectors`) ; `mondeImpactHtml` n'est plus un stub et lit `mondeCache[imp.headline].changePct`.

- [ ] **Step 4: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(monde): notes d'impact macro→actions (statiques + mise en avant du mouvement du jour)"
```

---

## Self-Review (rempli)

**Spec coverage :**
- §1 Nouvel onglet (F10, panel, renderMonde, chargement à l'ouverture) → Task 1 Steps 1/2/6.
- §2 Panorama de marché (groupes + symboles + variation du jour + tri secteurs) → Task 1 Steps 4/5.
- §3 Fil d'actus (fusion /api/news, dédup titre, tri date, ~12) → Task 2.
- §4 Notes d'impact (statiques, mise en avant du sens du jour, seuils) → Task 3.
- §5 Technique (runPool concurrent, cache mémoire, pas d'auto-refresh, bouton Rafraîchir, horodatage, dégradation « — ») → Task 1 Steps 5/5 (loadMondeData, mondeCell, statut).
- Critères 1–6 → Task 1 (grille + tri + dégradation + pas de fetch avant ouverture) ; Task 2 (actus) ; Task 3 (notes) ; contrainte « zéro serveur » respectée (aucune tâche ne touche `server.py`).

**Placeholder scan :** les « stubs » de Task 1 sont intentionnels et explicitement remplacés (Task 2 Step 3, Task 3 Step 2) — pas des placeholders orphelins. Aucun TODO/TBD ; code complet partout.

**Type consistency :** `mondeCache[sym]` = `{last, changePct}` produit par `fetchMondeQuote`, lu par `mondeCell` et `mondeImpactHtml` de façon cohérente. `renderMondeNews`/`mondeImpactHtml` : signature identique entre stub (T1) et implémentation (T2/T3). `mondeChangePct`/`parseFrDate` : fonctions pures `-> number|null` / `-> number`. `MONDE_ALL_SYMBOLS` = 15 (groupes) + 11 (secteurs) = 26 symboles.
