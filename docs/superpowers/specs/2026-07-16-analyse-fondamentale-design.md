# Analyse fondamentale — Design

**Date :** 2026-07-16
**Statut :** Validé (design), en attente relecture spec
**Auteur :** Arthur + Claude

## Contexte

Le terminal boursier ([terminal-tout-en-un.html](../../../terminal-tout-en-un.html)) propose
aujourd'hui une analyse **100 % technique** : RSI, SMA 50/200 (golden/death cross), MACD,
Bollinger, stochastique, volatilité, performances multi-horizons, plus un **score technique /100**
(`computeScore`) et un texte de synthèse en français (`buildAnalysisText`).

Le serveur ([server.py](../../../server.py)) ne récupère que l'historique de prix Yahoo
(`/api/history`), la recherche, les news et les screeners. **Aucune donnée fondamentale.**

## Objectif

Ajouter une **analyse fondamentale** (PER, capitalisation, dividende, marges, ROE, dette,
croissance…) **en plus** de l'analyse technique existante, sans la remplacer, avec :

1. un **score fondamental /100** (4 piliers),
2. un **score cumulé /100** technique + fondamental, avec une **pondération réglable** par
   l'utilisateur,
3. le **détail complet** affiché dans l'onglet F4 (Analyse).

Contrainte forte : **rester sur Yahoo Finance (gratuit, sans clé)** et ne pas augmenter le
nombre de requêtes au-delà de « 1 requête fondamentale par action analysée » (mise en cache
comme l'historique).

## Non-objectifs (YAGNI pour cette v1)

- Pas de scoring **relatif au secteur** (voir « Limite assumée » plus bas). Seuils absolus.
- Pas de données historiques fondamentales (évolution du PER dans le temps).
- Pas de nouvelle source de données payante.
- Pas de screener fondamental dans l'onglet Marché (pourra venir plus tard).

---

## Architecture

### 1. Serveur — route `/api/fundamentals?symbol=XXX`

Nouvelle route dans `server.py`, sur le même modèle que `handle_history`.

**Défi d'authentification :** l'endpoint `quoteSummary` de Yahoo exige depuis 2023 un
**cookie + un « crumb »**. Vérifié pendant le design : sans eux → `{"error":{"code":"Unauthorized",
"description":"Invalid Crumb"}}`. Avec eux → données complètes. Flux validé :

1. `GET https://fc.yahoo.com` avec User-Agent → récupère un cookie de session.
2. `GET https://query1.finance.yahoo.com/v1/test/getcrumb` avec ce cookie → renvoie le crumb
   (chaîne courte, ex. `JmhTpfkOJ3F`).
3. `GET https://query1.finance.yahoo.com/v10/finance/quoteSummary/{sym}?modules=...&crumb={crumb}`
   avec le cookie → JSON complet.

**Mise en cache du cookie + crumb côté serveur** (variables de module, protégées par un
`threading.Lock` car `ThreadingHTTPServer`). Réutilisés tant qu'ils fonctionnent. Si une requête
`quoteSummary` renvoie 401/Unauthorized (crumb expiré), **régénérer une fois** cookie + crumb
puis réessayer. Si le second essai échoue → erreur propre.

**Modules demandés :** `summaryDetail,financialData,defaultKeyStatistics,price`.

**Réponse normalisée** (le serveur aplatit les objets Yahoo `{raw, fmt}` en nombres bruts et ne
renvoie que les champs utiles ; `null` si absent) :

```json
{
  "symbol": "AAPL",
  "currency": "USD",
  "marketCap": 3200000000000,
  "trailingPE": 28.5, "forwardPE": 25.1, "pegRatio": 2.1,
  "priceToBook": 45.2, "enterpriseToEbitda": 21.0, "priceToSales": 7.8,
  "trailingEps": 6.4, "forwardEps": 7.1,
  "profitMargins": 0.25, "operatingMargins": 0.30,
  "returnOnEquity": 1.47, "returnOnAssets": 0.22,
  "grossMargins": 0.45,
  "revenueGrowth": 0.08, "earningsGrowth": 0.11,
  "debtToEquity": 150.0, "currentRatio": 1.0,
  "dividendYield": 0.005, "payoutRatio": 0.16,
  "recommendationKey": "buy", "targetMeanPrice": 250.0
}
```

Gestion d'erreurs identique aux routes existantes (`ratelimit` 429, `http`, `network`,
`format`), + un cas `symbol` si Yahoo ne renvoie pas de résultat pour le ticker.

### 2. Client — récupération + cache

Dans `terminal-tout-en-un.html`, symétrique de `fetchDailySeries` :

- `fetchFundamentals(ticker)` → appelle `/api/fundamentals`, renvoie l'objet normalisé.
- Intégré à `analyzeTicker` : après le calcul technique, on récupère les fondamentaux et on
  calcule le score fondamental. **Les fondamentaux sont stockés dans la même entrée de cache**
  que le reste :

```js
store[ticker] = {
  updated, hist, ind, score /* technique */, signal,
  fund,        // objet normalisé du serveur (ou null si indispo)
  fundScore,   // { total, pillars: { valuation, profitability, growth, health }, verdict }
};
```

Le cache persistant (watchlist) écrit déjà tout l'objet en localStorage → les fondamentaux
suivent automatiquement. **1 requête fondamentale par analyse**, réutilisée ensuite.

**Robustesse :** si `fetchFundamentals` échoue (indispo, ETF sans fondamentaux…), `fund = null`
et `fundScore = null`. L'analyse technique **continue de fonctionner normalement** ; l'UI affiche
« Fondamentaux indisponibles ». Aucun blocage.

### 3. Score fondamental — `computeFundScore(fund)` → /100

Quatre piliers, chacun noté puis moyenné (les piliers dont **toutes** les métriques manquent
sont exclus et le total est renormalisé sur les piliers disponibles) :

| Pilier | Poids | Métriques (chacune → sous-score 0–1) | Sens |
|--------|-------|--------------------------------------|------|
| **Valorisation** | 35 % | trailingPE, forwardPE, pegRatio, priceToBook, enterpriseToEbitda | bas = bon |
| **Rentabilité** | 30 % | profitMargins, operatingMargins, returnOnEquity, returnOnAssets | haut = bon |
| **Croissance** | 20 % | revenueGrowth, earningsGrowth | haut = bon |
| **Santé + dividende** | 15 % | debtToEquity (bas=bon), currentRatio (≥1.5 bon), dividendYield (bonus) | solidité |

**Barème par métrique (seuils absolus, sous-score borné 0–1) — exemples indicatifs :**

- `trailingPE` : ≤10 → 1.0 ; 10–25 → interpolation linéaire 1.0→0.5 ; 25–50 → 0.5→0 ; >50 ou négatif → 0.
- `pegRatio` : ≤1 → 1.0 ; 1–2 → 1.0→0.5 ; 2–3 → 0.5→0 ; >3 → 0.
- `priceToBook` : ≤1 → 1.0 ; 1–3 → 1.0→0.5 ; 3–6 → 0.5→0 ; >6 → 0.
- `enterpriseToEbitda` : ≤8 → 1.0 ; 8–15 → 1.0→0.5 ; 15–25 → 0.5→0 ; >25 → 0.
- `profitMargins` : ≤0 → 0 ; 0–20 % → 0→0.7 ; ≥20 % → 0.7→1.0 (plafond à 40 %).
- `returnOnEquity` : ≤0 → 0 ; 0–15 % → 0→0.6 ; ≥15 % → 0.6→1.0 (plafond à 30 %).
- `revenueGrowth`/`earningsGrowth` : ≤−10 % → 0 ; −10 %→0 % → 0→0.4 ; 0→25 % → 0.4→1.0 (plafond).
- `debtToEquity` (Yahoo en %, ex. 150 = 1.5×) : ≤50 → 1.0 ; 50–150 → 1.0→0.5 ; 150–300 → 0.5→0 ; >300 → 0.
- `currentRatio` : <1 → 0.2 ; 1–1.5 → 0.2→0.7 ; ≥1.5 → 0.7→1.0 (plafond à 3).
- `dividendYield` : bonus additif léger sur le pilier santé (ex. +0.1 par % de rendement, plafond +0.3).

> Les seuils exacts seront regroupés dans une **table de configuration** en tête de fonction pour
> être ajustables facilement sans toucher à la logique.

**Verdict** (dérivé de `fundScore.total`) : ≥65 « Sous-évalué / solide » ; 35–65 « Correct » ;
≤35 « Cher / fragile ». Vocabulaire descriptif, jamais un conseil.

### 4. Score cumulé + curseur de pondération

- Constante/état : `weightTech` ∈ [0,1] (part du technique), défaut **0.5**. Sauvegardé par
  profil dans localStorage (nouvelle clé, ex. `LS.weightTech`), comme les autres réglages.
- `computeGlobalScore(entry)` = `Math.round(score*weightTech + fundScore.total*(1-weightTech))`.
  Si `fundScore` est `null` → le score global **retombe sur le score technique seul** (et l'UI
  l'indique).
- **Curseur** dans l'onglet Analyse (F4), en tête : `technique 0 % ←→ 100 %`, avec libellé
  dynamique (ex. « 50 % technique / 50 % fondamental »). Modifier le curseur **re-render** les
  scores globaux partout (cartes, bandeau/tape) sans nouvelle requête.

### 5. Affichage — onglet F4 (Analyse)

Pour chaque ticker, **sous** le bloc technique existant (inchangé), ajouter un bloc fondamental :

1. **Grille de métriques** (réutilise le style `.impact-grid` existant) : capitalisation, PER,
   PER prév., PEG, Price/Book, EV/EBITDA, marge nette, marge op., ROE, ROA, croissance CA,
   croissance bénéfices, dette/CP, ratio liquidité, rendement dividende. Valeurs formatées
   (`fnum`, `fpct`, format capitalisation en Md/M) ; `—` si absent.
2. **Détail des 4 piliers** : note /100 de chacun (petites barres ou badges).
3. **Score fondamental /100** + **verdict**.
4. **Score global /100** (avec la pondération courante) mis en avant.
5. **Texte de synthèse fondamental** en français : nouvelle fonction `buildFundamentalText(fund,
   fundScore)`, même style descriptif que `buildAnalysisText`, commentant valorisation,
   rentabilité, croissance, santé, dividende.

Le disclaimer permanent existant couvre déjà le fondamental ; ajouter une mention courte
« seuils absolus, non ajustés par secteur » près du score fondamental.

---

## Découpage en unités (isolation)

- **`server.py`** : `_get_yahoo_crumb()` (cookie+crumb, cache, lock), `handle_fundamentals(qs)`,
  `_normalize_fundamentals(raw)`. Chacune testable isolément.
- **Client — calcul** : `fetchFundamentals`, `computeFundScore`, `computeGlobalScore`. Fonctions
  pures (sauf le fetch) → faciles à raisonner.
- **Client — rendu** : `buildFundamentalStatsHtml`, `buildFundamentalText`, intégration dans le
  rendu de la carte Analyse + le curseur. Séparé du calcul.

## Gestion des erreurs

| Cas | Comportement |
|-----|--------------|
| Crumb expiré (401) | Régénère cookie+crumb une fois, réessaie ; sinon erreur propre |
| Yahoo 429 | Message `ratelimit` (comme l'existant) |
| Ticker sans fondamentaux (ETF, indice) | `fund=null`, technique intacte, UI « indisponible » |
| Métrique manquante | `null` → `—` à l'affichage, exclue du sous-score |
| Réseau/format | Messages `network`/`format` (comme l'existant) |

## Tests / vérification

- **Serveur** : lancer `python server.py`, `curl /api/fundamentals?symbol=AAPL` → JSON normalisé
  non vide ; `symbol=INVALIDXYZ` → erreur propre ; un ETF (ex. SPY) → champs fondamentaux
  majoritairement `null` sans planter.
- **Client** : analyser AAPL, MC.PA (Europe), SPY (ETF) → vérifier grille, piliers, scores,
  texte ; bouger le curseur → score global change partout ; recharger la page → cache watchlist
  conserve les fondamentaux (0 requête).
- Vérifier qu'une **panne fondamentale** ne casse jamais l'analyse technique.

## Limite assumée (à afficher)

Les seuils de valorisation sont **absolus**, pas relatifs au secteur. Une valeur techno à fort
PER sera pénalisée sur la valorisation même si c'est « normal » pour son secteur ; une banque à
PER bas sera avantagée. C'est un choix de simplicité pour la v1, signalé à l'utilisateur.
Amélioration future possible : barèmes par secteur (Yahoo fournit `sector`/`industry`).
