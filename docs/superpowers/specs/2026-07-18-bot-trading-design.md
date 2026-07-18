# Bot de trading (paper trading) — Design

**Date :** 2026-07-18
**Statut :** Validé (design)

## Cadre (non négociable)

**Simulateur 100 % virtuel.** Le bot n'exécute **aucun ordre réel**, ne se connecte à aucun
courtier, ne manipule pas d'argent réel. C'est un outil pour **tester si la stratégie de sélection
est gagnante**. Ce n'est pas un conseil en investissement (le disclaimer permanent le rappelle).

## Objectif

Un onglet **F8 « 🤖 Bot »** qui simule une stratégie : acheter les meilleurs titres du scan marché,
avec **stop-loss et prise de bénéfice adaptatifs au potentiel du titre**, réévaluation continue, et
un suivi de performance du portefeuille virtuel.

## Contrainte « pas de serveur 24/7 »

Le bot **rattrape le temps à chaque ouverture** de l'app : pour chaque position, il **rejoue les
clôtures quotidiennes** (déjà en cache) depuis l'achat et déclenche stop/cible au jour exact du
franchissement. Aucun déclenchement raté, même si l'app n'est ouverte qu'une fois par semaine.

## Décisions validées

- Univers d'achat : **scan marché** (`marketCache`), meilleurs **scores globaux**.
- **Nouvel onglet F8**.
- **Stop-loss adaptatif** (volatilité), **cible adaptative** (potentiel/score), **taille pondérée
  par le score**.
- Réévaluation : sortie si le score retombe sous un seuil (ou signal « Vente »).

---

## Architecture

### 1. État (persisté par profil : `LS.bot = "term_bot"`)

```js
bot = {
  started: false,          // le bot a-t-il été démarré ?
  startDate: null,         // ISO
  cash: 10000,             // liquidités virtuelles disponibles
  positions: [             // positions ouvertes
    // { ticker, entryDate, entryPrice, qty, stopPct, targetPct, entryScore }
  ],
  history: [               // trades fermés
    // { ticker, entryDate, entryPrice, exitDate, exitPrice, qty, pnl, pnlPct, reason }
  ],
  config: {
    capital: 10000,        // capital initial (au démarrage / reset)
    ticketPct: 0.10,       // taille de base d'une position = 10 % du capital (pondérée par le score)
    qualityMin: 60,        // score global mini pour acheter
    exitScore: 40,         // score global sous lequel on sort (réévaluation)
    stopVolFactor: 0.4,    // stop = facteur × volatilité annualisée
    stopMin: 5, stopMax: 20,
    rrMin: 1.5, rrMax: 3,  // ratio gain/risque (score qualityMin → 100)
  },
};
```
`saveBot()` : `lsSet(LS.bot, bot)`. Migration douce si champs manquants (valeurs par défaut).

### 2. Formules adaptatives (fonctions pures)

```js
function botStopPct(ind, cfg) {                     // stop-loss adapté à la volatilité
  const vol = (ind && ind.vol != null && isFinite(ind.vol)) ? ind.vol : 30;
  return clamp(cfg.stopVolFactor * vol, cfg.stopMin, cfg.stopMax);
}
function botRR(score, cfg) {                          // ratio gain/risque adapté au score
  const t = (score - cfg.qualityMin) / (100 - cfg.qualityMin); // 0 à 1
  return clamp(cfg.rrMin + t * (cfg.rrMax - cfg.rrMin), cfg.rrMin, cfg.rrMax);
}
function botTargetPct(ind, score, cfg) { return botStopPct(ind, cfg) * botRR(score, cfg); }

// Montant investi pondéré par le score, borné pour la diversification, plafonné au cash dispo.
// Pas de nombre max de positions : le bot déploie tout le capital tant qu'il trouve des candidats.
function botPositionAmount(score, cfg, cash) {
  const base = cfg.capital * cfg.ticketPct;                       // ex. 10 % du capital
  const weighted = clamp(base * (score / 70), 0.6 * base, 1.6 * base);
  return Math.min(weighted, cash);                                // la dernière position prend le cash restant
}
```
(`clamp` existe déjà — sinon `clamp(x,a,b)=Math.max(a,Math.min(b,x))`.)

### 3. Moteur — `runBot()` (async, best-effort)

Déclenché : à l'ouverture (après `loadMarketCache`) et via le bouton « Évaluer maintenant ».

**a) Rafraîchir les positions détenues** : pour chaque position, si `cache[ticker]`/`marketCache[ticker]`
absent ou périmé (> 24 h), `await analyzeTicker(ticker, null, {silent:true, skipRender:true})`
(≤ 5 requêtes). Objectif : disposer de `hist` (clôtures) et du score à jour.

**b) Sorties (rejeu des clôtures)** : pour chaque position, soit `e = cache[ticker] || marketCache[ticker]` :
- Récupérer les clôtures **après** `entryDate` (via `e.hist.dates`/`e.hist.closes`, du plus ancien au
  plus récent). Pour chaque jour, dans l'ordre chronologique :
  - si `close <= entryPrice*(1 - stopPct/100)` → sortie ce jour-là, prix = ce close, raison
    **« stop-loss »**.
  - sinon si `close >= entryPrice*(1 + targetPct/100)` → sortie, raison **« prise de bénéfice »**.
  - on prend le **premier** franchissement chronologique.
- Si aucun seuil de prix franchi : **réévaluation au cours actuel** — si
  `computeGlobalScore(e) <= config.exitScore` **ou** `e.signal === "Vente"` → sortie au cours
  actuel (`e.ind.price`), raison **« réévaluation »**.
- Sur sortie : `cash += qty*exitPrice` ; ajouter à `history` (avec `pnl`, `pnlPct`, `reason`,
  `exitDate`) ; retirer de `positions`.

**c) Entrées** (le bot investit tout le capital, sans limite de nombre de positions) : tant que
`cash >= 0.2 × (capital × ticketPct)` et qu'il reste des candidats :
- Candidats = entrées de `marketCache` (dernier scan) **avec** `ind.price`, non déjà détenues, dont
  `computeGlobalScore >= qualityMin` ; triées par score global décroissant.
- Prendre le meilleur candidat : `score`, `ind` ; `stopPct = botStopPct(ind,cfg)`,
  `targetPct = botTargetPct(ind,score,cfg)`, `amount = botPositionAmount(score,cfg,cash)`.
  Si `amount < 1` → stop. `qty = amount / ind.price`.
- Ouvrir : `cash -= amount` ; `positions.push({ ticker, entryDate: today, entryPrice: ind.price,
  qty, stopPct, targetPct, entryScore: score })`. Retirer ce ticker des candidats et recommencer.
- S'il n'y a pas assez de candidats de qualité, le cash restant n'est pas forcé (pas d'achat de
  mauvais titres) — il servira quand de nouveaux candidats apparaîtront (nouveau scan) ou après une
  vente.

**Vente manuelle** — `botSellManual(ticker)` : ferme la position au **cours actuel**
(`e.ind.price`), `cash += qty*prix`, ajout à `history` avec raison **« manuelle »**, `saveBot()` +
`renderBot()`. Le cash ainsi libéré est réinvesti au prochain `runBot()` (ou via « Évaluer
maintenant »).

**d)** `saveBot()` + `renderBot()`.

> Note d'honnêteté (affichée) : les stops/cibles sont évalués sur les **clôtures quotidiennes**
> (pas d'intraday) ; la réévaluation par le score utilise le score **courant** (non historisé).

### 4. UI — onglet F8

- **Barre d'onglets** : bouton `data-tab="bot"` « F8 · BOT » ; map clavier `F8: "bot"` ;
  hook `if (btn.dataset.tab === "bot") renderBot();`.
- **Panneau `#panel-bot`** :
  - **Résumé** : valeur totale (cash + positions au cours courant), performance % vs capital
    initial, cash dispo, nombre de trades fermés, % de trades gagnants.
  - **Bouton « Démarrer le bot »** (si pas démarré) ; sinon **« Évaluer maintenant »** +
    **« Réinitialiser »** (avec confirmation).
  - **Positions ouvertes** (tableau/cartes, responsive comme les autres) : ticker, date d'achat,
    prix d'achat, cours actuel, +/− %, stop (prix), cible (prix), score courant, et un bouton
    **« Vendre »** (vente manuelle immédiate au cours actuel → `botSellManual`).
  - **Historique des trades** : ticker, entrée→sortie (dates/prix), P&L, **raison** (stop / cible /
    réévaluation), avec code couleur gain/perte.
  - **Réglages** (repliables) : capital, taille de ticket (% du capital), seuil qualité, seuil de
    sortie, facteur de stop, min/max stop, ratio min/max — tous réglables, `saveBot()` à chaque
    changement.
- `renderBot()` : recalcule le résumé au cours courant (via `cache`/`marketCache`), rend positions
  + historique + réglages. Appelé au chargement, sur bascule F8, après `runBot()` et après tout
  changement de réglage.

### 5. Déclenchement à l'ouverture

Après l'init (après `loadMarketCache()`), si `bot.started`, lancer `runBot()` (best-effort,
try/catch). Ne bloque pas le chargement (async).

---

## Gestion des erreurs / cas limites

| Cas | Comportement |
|-----|--------------|
| Aucun scan marché (marketCache vide) | Pas de candidat → le bot n'achète rien, pas d'erreur |
| Titre détenu sans `hist` frais | On tente un refresh ; si échec, on saute les sorties-prix (réévaluation score seule) |
| `ind.vol` absent | Volatilité par défaut (30 %) pour le stop |
| `entryPrice` ≤ 0 / données aberrantes | Position ignorée à l'évaluation (garde-fous `isFinite`, `> 0`) |
| Cash insuffisant | Arrêt des achats |
| Bot non démarré | Onglet affiche l'écran de démarrage, aucun trade |
| Reset | Vide positions/historique, remet cash = capital, `started=false` (confirmation requise) |
| Panne réseau au refresh | best-effort : on évalue avec ce qu'on a, jamais de crash |

## Tests / vérification

- **Formules** (console) : `botStopPct` borné 5–20 selon vol ; `botRR` = 1,5 à score 60, 3 à
  score 100 ; `botTargetPct` = RR×stop ; `botPositionAmount` pondéré et borné.
- **Sorties (rejeu)** : position fictive avec un `hist` contenant une clôture sous le stop → sortie
  « stop-loss » au bon jour ; une clôture au-dessus de la cible → « prise de bénéfice » ; sinon
  score bas → « réévaluation ».
- **Entrées** : marketCache fictif de titres notés → le bot achète les meilleurs (≥ seuil), déploie
  le capital sans limite de nombre, taille pondérée par le score, s'arrête quand le cash est épuisé.
- **Vente manuelle** : `botSellManual` ferme la position au cours courant, crédite le cash, historise
  avec raison « manuelle » ; le cash est réinvesti au `runBot()` suivant.
- **UI** : onglet F8 accessible (clavier F8), démarrage, évaluation, reset, positions + historique
  affichés, réglages persistés ; responsive (cartes sur mobile).
- **Non-régression** : onglets F1–F7 inchangés ; `py -m unittest discover tests` vert.

## Non-objectifs (YAGNI)

- Pas d'ordres réels, pas de courtier (jamais).
- Pas d'intraday (stops sur clôtures quotidiennes).
- Pas d'historisation des scores passés (réévaluation au score courant).
- Pas de frais/slippage simulés dans cette version (mentionné comme limite).
