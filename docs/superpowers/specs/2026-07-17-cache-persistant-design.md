# Cache persistant du scan marché (IndexedDB) — Design

**Date :** 2026-07-17
**Statut :** Validé (design), en attente relecture spec
**Auteur :** Arthur + Claude

## Contexte

`marketCache` (résultats du scan marché) est **en mémoire uniquement** (`let marketCache = {}`),
volontairement non persisté : stocker l'historique 420 jours de milliers de titres dépasserait le
quota de localStorage (~5-10 Mo). Conséquence : à chaque rechargement, le classement marché est
vide tant qu'on n'a pas relancé un scan (plusieurs minutes).

La watchlist (`cache`) reste, elle, dans localStorage (petit volume, choix explicite de
l'utilisateur).

## Objectif

Persister `marketCache` dans **IndexedDB** (capacité bien supérieure à localStorage) pour que le
classement marché **survive au rechargement** : réouvrir l'app affiche directement le dernier scan,
sans re-scanner.

## Décisions validées

- Stockage **IndexedDB**, **global** (données de marché publiques, non scopées par profil).
- Règle des **24 h** conservée (une entrée > 24 h est re-scannée au prochain scan).
- Feature autonome, déployée séparément (puis PWA).

## Non-objectifs (YAGNI)

- Pas de persistance du cache watchlist en IndexedDB (déjà en localStorage, ça marche).
- Pas de synchronisation entre appareils.
- Pas de stockage par ticker granulaire (un seul blob suffit pour cette version).

---

## Architecture

### 1. Mini-wrapper IndexedDB (promesses)

Base `terminal-boursier`, version 1, un object store clé-valeur `kv`.

```js
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
```

Tout usage est **best-effort** : encadré de `try/catch`, un échec IndexedDB (navigation privée,
quota, non supporté) ne casse jamais l'app (on retombe sur le comportement actuel — mémoire seule).

### 2. Sauvegarde

Fonction `saveMarketCache()` (fire-and-forget) :
```js
function saveMarketCache() {
  idbSet("marketCache", marketCache).catch(() => {});
}
```
Appelée **à la fin d'un scan** (`runMarketScan`, après `renderAll()`) et **après un
enrichissement** (`enrichMarketTop`, après `renderMarketResults()`).

### 3. Chargement au démarrage

`loadMarketCache()` async, appelée à l'initialisation (après le premier `renderMarketResults()`).
Elle :
1. lit `idbGet("marketCache")` ;
2. **élague** les entrées de plus de 7 jours (borne la croissance ; au-delà, une entrée est de
   toute façon périmée pour le scan) ;
3. **migre** chaque entrée si besoin (mêmes garde-fous que la migration du cache watchlist :
   recalcul de `ind`/`score`/`signal` si `hist` présent mais indicateurs incomplets ; `fundScore`
   recalculé depuis `fund`) ;
4. fusionne dans `marketCache` (sans écraser une entrée déjà chargée en session) ;
5. re-render : `renderMarketResults()` + `renderAll()`.

```js
async function loadMarketCache() {
  let saved;
  try { saved = await idbGet("marketCache"); } catch { return; }
  if (!saved || typeof saved !== "object") return;
  const now = Date.now(), WEEK = 7 * 24 * 3600 * 1000;
  for (const [sym, entry] of Object.entries(saved)) {
    if (!entry || !entry.updated) continue;
    if (now - new Date(entry.updated).getTime() > WEEK) continue; // élagage
    if (marketCache[sym]) continue; // ne pas écraser une entrée de la session courante
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

### 4. Intégration

- Déclaration : ajouter les fonctions IDB + `saveMarketCache`/`loadMarketCache` près de la
  déclaration de `marketCache` (~ligne 1122) — ou dans une section « PERSISTANCE INDEXEDDB ».
- Appel de `loadMarketCache()` à l'init (après le `renderMarketResults()` initial, ~ligne 3198).
- `saveMarketCache()` à la fin de `runMarketScan` et `enrichMarketTop`.

## Gestion des erreurs / cas limites

| Cas | Comportement |
|-----|--------------|
| IndexedDB indisponible (navigation privée, vieux navigateur) | try/catch → app fonctionne en mémoire seule, comme aujourd'hui |
| Entrée corrompue / sans `updated` | ignorée au chargement |
| Entrée > 7 jours | élaguée (non chargée) |
| Entrée d'un ancien format (ind incomplet) | recalculée depuis `hist` |
| Quota dépassé à l'écriture | `.catch(()=>{})` silencieux, pas de blocage |

## Tests / vérification

- **Persistance** : lancer un mini-scan (quelques tickers via console), vérifier `idbGet("marketCache")`
  non vide ; recharger la page → `marketCache` repeuplé, le tableau Marché s'affiche **sans re-scan**.
- **Élagage** : injecter une entrée avec `updated` vieux de 8 jours → non chargée après reload.
- **Robustesse** : simuler `idbGet` qui rejette → l'app se charge normalement (mémoire seule).
- **Migration** : une entrée sans `fundScore` → `fundScore` recalculé (null si pas de `fund`).
- `py -m unittest discover tests` inchangé (aucune modif serveur).

## Note

Cette version stocke `marketCache` en **un seul blob** (simple, suffisant). Si le volume devenait
problématique (dizaines de Mo), une évolution possible serait un store par ticker ou le retrait de
`hist` du cache marché. Hors périmètre pour l'instant.
