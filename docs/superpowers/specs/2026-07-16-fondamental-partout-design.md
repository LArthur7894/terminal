# Fondamental sur tout le terminal — Design

**Date :** 2026-07-16
**Statut :** Validé (design), en attente relecture spec
**Auteur :** Arthur + Claude
**Prérequis :** [analyse-fondamentale](2026-07-16-analyse-fondamentale-design.md) (déjà livrée sur `main`)

## Contexte

L'analyse fondamentale existe déjà dans l'onglet Analyse (F4) : score fondamental /100 à
4 piliers (`computeFundScore`), score global pondéré (`computeGlobalScore` + `weightTech`),
et un curseur de pondération. Voir la spec/plan précédents.

Aujourd'hui le fondamental n'est visible **que dans F4**. Le Dashboard (F1) et l'onglet
Marché (F5) restent purement techniques.

**Effet de bord à corriger :** l'intégration précédente a fait que `analyzeTicker` récupère
**toujours** les fondamentaux. Le scan de marché (`runMarketScan`) appelle `analyzeTicker` sur
des centaines à ~1000+ titres → autant de requêtes fondamentales en plus, ce qui alourdit le
scan et risque un blocage Yahoo (surtout sur Render).

## Objectif

Étendre le fondamental au Dashboard (F1) et au Marché (F5), en respectant partout la
pondération choisie par l'utilisateur, **sans** faire exploser le nombre de requêtes Yahoo.

## Décisions validées

1. **Scan allégé** : le scan de marché redevient purement technique (pas de fondamental
   automatique). Récupération fondamentale à la demande.
2. **Marché (F5)** : colonnes Fonda + Global (« — » tant que non enrichi) + bouton
   « Enrichir le top » qui récupère le fondamental des **30 titres affichés** et reclasse par
   score global.
3. **Dashboard (F1)** : watchlist gagne les colonnes Score fondamental + Score global (en plus
   du technique) ; les « top picks » automatiques sont classés par score global.
4. **Curseur synchronisé** sur F1, F5 et F4, tous liés à la même valeur `weightTech`.

## Non-objectifs (YAGNI)

- Onglet Allocation (F6) : inchangé pour cette itération.
- Le bandeau/tape (ticker défilant) : reste tel quel (prix/variation), pas de score fonda.
- Pas d'enrichissement fondamental automatique de tout l'univers de marché.

---

## Architecture

### 1. `analyzeTicker` — option `skipFund`

Signature actuelle : `analyzeTicker(ticker, button, opts = {})` avec `opts = { silent, skipRender, store }`.

Ajouter `skipFund` (défaut `false`) :

```js
const { silent = false, skipRender = false, store = cache, skipFund = false } = opts;
...
let fund = null;
if (!skipFund) {
  try { fund = await fetchFundamentals(ticker); } catch (e) { fund = null; }
}
const fundScore = computeFundScore(fund);
```

- **Watchlist / analyse individuelle** : `skipFund` absent → fondamental récupéré (comportement
  actuel conservé).
- **Scan de marché** : `runMarketScan` passe `skipFund: true` → scan purement technique, léger.
  Résultat : `fund = null`, `fundScore = null` sur les entrées de `marketCache` non enrichies.

### 2. État partagé + curseur synchronisé

Aujourd'hui : un `<input id="weight-slider">` unique dans F4, câblé par `initWeightSlider()`.
Comme le curseur apparaît désormais dans 3 panneaux, les `id` uniques ne conviennent plus.

- Le markup du curseur passe en **classes** : conteneur `.weight-control`, input
  `.js-weight-slider`, libellé `.js-weight-label`. Un même bloc est inséré dans F1, F5, F4.
- Nouvelle fonction centrale :

```js
function setWeightTech(v) {
  weightTech = clamp01(v);
  lsSet(LS.weightTech, weightTech);
  paintWeightControls();      // met à jour tous les curseurs + libellés
  renderWatchlist();          // F1 : scores globaux de la watchlist
  renderAutopick();           // F1 : top picks reclassés
  renderMarketTable();        // F5 : scores globaux du classement
  renderAnalysis();           // F4 : cartes
}

function paintWeightControls() {
  const tech = Math.round(weightTech * 100);
  document.querySelectorAll(".js-weight-slider").forEach(s => { s.value = tech; });
  document.querySelectorAll(".js-weight-label").forEach(l => {
    l.textContent = `${tech} % technique / ${100 - tech} % fondamental`;
  });
}
```

- Câblage unique délégué (un seul `addEventListener` sur `document`, ou une boucle sur tous les
  `.js-weight-slider`) : sur `input`, appeler `setWeightTech(Number(slider.value) / 100)`.
- `initWeightSlider()` (F4) est remplacé par une init générique qui `paintWeightControls()` au
  chargement et câble tous les curseurs.

### 3. Dashboard (F1) — watchlist

Tableau HTML (`#watchlist-body`, en-tête ~ligne 668) : aujourd'hui 11 colonnes. Insérer
**après** la colonne « Score » (technique) deux en-têtes :

```html
<th class="num">Score</th>          <!-- existant : technique -->
<th class="num">Fonda</th>          <!-- nouveau -->
<th class="num">Global</th>         <!-- nouveau -->
```

→ 13 colonnes. Mettre à jour les `colspan="11"` → `colspan="13"` dans `renderWatchlist`
(lignes vides / filtre sans résultat).

Dans `renderWatchlist`, pour chaque entrée avec cache, ajouter deux cellules après la cellule
score technique :

```js
const fundTotal = entry.fundScore ? entry.fundScore.total : null;
const global = computeGlobalScore(entry);
// ... cellule Fonda :
`<td class="num">${fundTotal === null ? "—" : fundTotal}</td>`
// ... cellule Global (mise en avant, barre comme le score technique) :
`<td class="num"><span class="score-cell"><span class="score-bar"><span class="score-fill" style="width:${global}%"></span></span><span>${global}</span></span></td>`
```

Pour les lignes sans cache (`else`), ajouter deux `<td class="num na">—</td>`.

**Curseur** : insérer un `.weight-control` en tête du panneau Dashboard, au-dessus du tableau
watchlist (ou près du titre de section watchlist).

### 4. Dashboard (F1) — top picks

`computeTopPicks(limit)` trie aujourd'hui par `entry.score` (technique) et filtre
`signal === "Achat"`. Modifier le tri pour classer par **score global** :

```js
function computeTopPicks(limit = Infinity) {
  return watchlist
    .map(t => ({ ticker: t, entry: cache[t] }))
    .filter(x => x.entry && x.entry.signal === "Achat")
    .sort((a, b) => computeGlobalScore(b.entry) - computeGlobalScore(a.entry))
    .slice(0, limit);
}
```

Le filtre « signal Achat » (technique) est conservé : il définit l'éligibilité, le score global
définit l'ordre. `renderAutopick` peut afficher le score global à côté (optionnel, non bloquant).

### 5. Marché (F5) — colonnes + enrichissement à la demande

**Colonnes.** En-tête du tableau marché (~ligne 806) : aujourd'hui 8 colonnes
(Rang, Ticker, Entreprise, Cours, Score, Signal, Perf 1 an, Actions). Insérer après « Score » :

```html
<th class="num">Score</th>          <!-- existant : technique -->
<th class="num">Fonda</th>          <!-- nouveau -->
<th class="num">Global</th>         <!-- nouveau -->
```

→ 10 colonnes. `colspan="8"` → `colspan="10"` dans `renderMarketTable`.

**Tri.** `renderMarketTable` trie aujourd'hui par `entry.score`. Nouveau tri par « score de
classement » = global si fondamental présent, sinon technique :

```js
function rankScore(entry) { return entry.fundScore ? computeGlobalScore(entry) : entry.score; }
// ... .sort((a, b) => rankScore(b.entry) - rankScore(a.entry))
```

Ainsi, après enrichissement, les titres dotés d'un score global remontent selon la pondération
courante ; avant enrichissement, le classement reste technique (comportement actuel).

Cellules Fonda/Global par ligne :
```js
const fs = m.entry.fundScore;
`<td class="num">${fs ? fs.total : "—"}</td>`
`<td class="num">${fs ? computeGlobalScore(m.entry) : "—"}</td>`
```

**Bouton d'enrichissement.** Ajouter dans le panneau Marché un bouton
`#btn-market-enrich` : « ★ Enrichir le top (fondamental) ». Handler `enrichMarketTop()` :

```js
async function enrichMarketTop() {
  const btn = document.getElementById("btn-market-enrich");
  const status = document.getElementById("market-status");
  btn.disabled = true;

  // Le top actuellement classé (mêmes règles que renderMarketTable : top 30).
  const ranked = marketCandidates
    .map(m => ({ ...m, entry: cache[m.symbol] || marketCache[m.symbol] }))
    .filter(m => m.entry)
    .sort((a, b) => rankScore(b.entry) - rankScore(a.entry))
    .slice(0, 30);

  let done = 0;
  await runPool(ranked, async ({ symbol, entry }) => {
    if (!entry.fundScore) { // pas déjà enrichi
      let fund = null;
      try { fund = await fetchFundamentals(symbol); } catch (e) { fund = null; }
      entry.fund = fund;
      entry.fundScore = computeFundScore(fund);
      // Si le ticker est aussi dans la watchlist (cache persistant), on persiste.
      if (cache[symbol] === entry) lsSet(LS.cache, cache);
    }
    done++;
    status.textContent = `Enrichissement fondamental… ${done}/${ranked.length}`;
    if (done % 5 === 0 || done === ranked.length) renderMarketTable();
  }, 5);

  btn.disabled = false;
  renderMarketResults();
  toast(`Top ${ranked.length} enrichi avec les données fondamentales.`, "success");
}
```

- Concurrence 5 (plus douce que le scan à 8) pour limiter la pression sur Yahoo.
- Idempotent : un titre déjà enrichi (`entry.fundScore` présent) est sauté.
- Échec individuel → `fund = null`, la ligne reste « — ». Le `runPool` avale déjà les erreurs.

**Curseur** : insérer un `.weight-control` en tête du panneau Marché.

---

## Découpage en unités

- **`analyzeTicker`** : ajout `skipFund` (isolé, n'affecte que la branche fondamentale).
- **Curseur partagé** : `setWeightTech`, `paintWeightControls`, init générique ; markup HTML
  dupliqué (classes) dans 3 panneaux ; retrait de `initWeightSlider`/`id="weight-slider"`.
- **Dashboard** : `renderWatchlist` (colonnes), `computeTopPicks` (tri global).
- **Marché** : `renderMarketTable` (colonnes + `rankScore`), `enrichMarketTop`, bouton HTML,
  `runMarketScan` (passe `skipFund: true`).

## Gestion des erreurs

| Cas | Comportement |
|-----|--------------|
| Titre sans fondamental (scan non enrichi, ETF) | Fonda/Global = « — », score global retombe sur technique |
| Échec d'un fetch pendant l'enrichissement | Ligne reste « — », les autres continuent (runPool avale l'erreur) |
| Aucun scan lancé avant d'enrichir | Le top est vide → bouton ne fait rien de visible (ou message) |
| Curseur bougé sans données | Re-render sans requête ; « — » là où pas de fondamental |

## Tests / vérification

- **Scan allégé** : lancer un scan marché → vérifier (onglet Réseau) qu'aucune requête
  `/api/fundamentals` n'est émise pendant le scan ; le tableau se remplit (technique) comme avant.
- **Enrichissement** : cliquer « Enrichir le top » → ~30 requêtes `/api/fundamentals`, colonnes
  Fonda/Global se remplissent, tableau reclassé par global.
- **Dashboard** : analyser AAPL (F1) → colonnes Fonda/Global remplies dans la watchlist ; top
  picks classés par global.
- **Curseur synchronisé** : bouger le curseur dans F1 → les curseurs de F5 et F4 suivent, et les
  scores globaux se recalculent partout, sans requête réseau.
- **Robustesse** : un ETF (SPY) en watchlist → « — » propre, pas de plantage.
- Tests serveur existants (`py -m unittest discover tests`) inchangés → toujours verts.

## Limite assumée

Inchangée : seuils de valorisation absolus, non sectoriels (déjà signalé dans F4).
