# Cache persistant du scan marché (IndexedDB) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persister `marketCache` dans IndexedDB pour que le classement marché survive au rechargement.

**Architecture:** Mini-wrapper IndexedDB best-effort ; sauvegarde après scan/enrichissement ; chargement au démarrage avec élagage 7 jours + migration.

**Tech Stack:** HTML/CSS/JS vanilla, fichier unique. Aucune modif serveur.

## Global Constraints

- **Best-effort** : tout accès IndexedDB encadré de `try/catch` ; un échec ne casse jamais l'app.
- **Pas de build** ; français.
- **Tests headless** : serveur `PYTHONIOENCODING=utf-8` ; `localStorage` seedé (`term_profiles=["Test"]`, `term_current_profile="Test"`) ; ouvrir `http://localhost:8750/terminal-tout-en-un.html` ; bon `tabId`.
- Encodage UTF-8.

---

### Task 1: Wrapper IndexedDB + sauvegarde + chargement

**Files:**
- Modify: `terminal-tout-en-un.html` — après la déclaration de `marketCache` (~ligne 1122) : wrapper + `saveMarketCache` + `loadMarketCache`. Appel `saveMarketCache()` dans `runMarketScan` (~ligne 3080) et `enrichMarketTop` (~ligne 3193). Appel `loadMarketCache()` à l'init (~ligne 3198).

**Interfaces:**
- Consumes: `marketCache`, `computeIndicators`, `computeScore`, `signalFromScore`, `computeFundScore`, `renderMarketResults`, `renderAll` (existant).
- Produces: `idbOpen`, `idbGet`, `idbSet`, `saveMarketCache`, `loadMarketCache`.

- [ ] **Step 1: Add the IndexedDB wrapper + save/load functions**

Juste après `let marketCache = {};` (~ligne 1122), ajouter :
```js
/* ============================= PERSISTANCE INDEXEDDB (cache marché) ============================= */

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("terminal-boursier", 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("kv"); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const r = db.transaction("kv", "readonly").objectStore("kv").get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Sauvegarde best-effort du cache marché (fire-and-forget).
function saveMarketCache() { idbSet("marketCache", marketCache).catch(() => {}); }

// Chargement au démarrage : élague > 7 jours, migre, fusionne, re-render.
async function loadMarketCache() {
  let saved;
  try { saved = await idbGet("marketCache"); } catch { return; }
  if (!saved || typeof saved !== "object") return;
  const now = Date.now(), WEEK = 7 * 24 * 3600 * 1000;
  for (const [sym, entry] of Object.entries(saved)) {
    if (!entry || !entry.updated) continue;
    if (now - new Date(entry.updated).getTime() > WEEK) continue;
    if (marketCache[sym]) continue;
    let e = entry;
    if (e.hist && (!e.ind || !e.ind.perf || !e.ind.bollinger || !e.ind.stochastic)) {
      const ind = computeIndicators(e.hist), score = computeScore(ind);
      e = { ...e, ind, score, signal: signalFromScore(score) };
    }
    if (e.fund === undefined) e.fund = null;
    e.fundScore = computeFundScore(e.fund);
    marketCache[sym] = e;
  }
  renderMarketResults();
  renderAll();
}
```

- [ ] **Step 2: Save after a market scan**

Dans `runMarketScan`, après `renderAll();` (juste avant le `toast(...Scan du marché terminé...)`), ajouter :
```js
  renderAll();
  saveMarketCache();
  toast(`Scan du marché terminé (${total} valeurs passées en revue).`, "success");
```

- [ ] **Step 3: Save after enrichment**

Dans `enrichMarketTop`, après `renderMarketResults();` (juste avant le `toast(...enrichi...)`), ajouter :
```js
  renderMarketResults();
  saveMarketCache();
  toast(`Top ${ranked.length} enrichi avec les données fondamentales.`, "success");
```

- [ ] **Step 4: Load at init**

Après la ligne d'init `renderMarketResults(); // affichage initial…` (~ligne 3198), ajouter :
```js
loadMarketCache(); // repeuple le cache marché depuis IndexedDB (best-effort)
```

- [ ] **Step 5: Verify persistence in the browser**

Serveur lancé, page ouverte (profil seedé). En console :
```js
(async function(){
  // mini-scan technique de 3 titres dans marketCache
  marketCandidates = [{symbol:"AAPL",name:"Apple"},{symbol:"MSFT",name:"Microsoft"},{symbol:"KO",name:"Coca-Cola"}];
  for (const c of marketCandidates) await analyzeTicker(c.symbol, null, { silent:true, skipRender:true, store: marketCache, skipFund:true });
  saveMarketCache();
  await new Promise(r=>setTimeout(r,200));
  const saved = await idbGet("marketCache");
  return JSON.stringify({ savedKeys: saved ? Object.keys(saved) : null });
})();
```
Expected : `savedKeys` contient AAPL, MSFT, KO.

Puis recharger la page et vérifier le repeuplement :
```js
(async function(){
  await new Promise(r=>setTimeout(r,400)); // laisser loadMarketCache s'exécuter
  return JSON.stringify({ marketCacheKeys: Object.keys(marketCache) });
})();
```
Expected : `marketCacheKeys` contient AAPL, MSFT, KO **sans avoir relancé de scan**.

- [ ] **Step 6: Verify pruning + robustness**

```js
(async function(){
  const saved = (await idbGet("marketCache")) || {};
  saved.OLDX = { updated: new Date(Date.now() - 8*24*3600*1000).toISOString(), ind:{}, score:10, signal:"Vente", fund:null };
  await idbSet("marketCache", saved);
  // recharge simulée : appeler loadMarketCache après avoir vidé marketCache de OLDX
  delete marketCache.OLDX;
  await loadMarketCache();
  return JSON.stringify({ oldxLoaded: !!marketCache.OLDX });
})();
```
Expected : `oldxLoaded` false (entrée de 8 jours élaguée).

- [ ] **Step 7: Commit + déployer**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(client): cache marché persistant via IndexedDB (survit au rechargement)"
git checkout main && git merge feat/cache-persistant && git push origin main && git branch -d feat/cache-persistant
```
(Vérifier `py -m unittest discover tests` vert avant push.)

---

## Vérification finale

- [ ] `py -m unittest discover tests` vert.
- [ ] Scan → reload → classement marché présent sans re-scan.
- [ ] Entrée > 7 jours élaguée ; IndexedDB indisponible → app fonctionne quand même.
- [ ] Déploiement Render effectué.
