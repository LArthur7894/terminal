# Revue de portefeuille — Design

**Date :** 2026-07-21
**Statut :** Validé par Arthur

## Objectif

Enrichir l'onglet **F2 Positions** d'une **revue d'aide à la décision** sur le portefeuille réel :
un verdict par ligne (garder / alléger / vendre) avec ses raisons, les stop-loss à poser, une
alternative dans le même secteur, un bilan global (santé, concentration, priorités), et des
suggestions d'achats issues du scan marché.

## Cadre (non négociable)

Outil d'**aide à la décision**, pas un conseil financier. Chaque verdict est le **résultat
mécanique de règles transparentes** que l'utilisateur peut lire, jamais une recommandation
autoritaire. Un **avertissement permanent** est affiché : « Analyse descriptive fondée sur des
règles, pas un conseil en investissement. Les décisions et tout engagement réel relèvent de vous ;
pour un conseil personnalisé, consultez un professionnel agréé. » L'utilisateur reste maître.

## Décisions validées

- Placement : dans **F2 Positions** (bloc « Revue » repliable en haut + infos par ligne).
- Verdict : **multi-facteurs** (score global, cassure de stop, dynamique, haut de range, P&L).
- Stop-loss : **les deux** (initial sous le cours + suiveur sous le plus haut), chiffrés vs PRU.
- Alternative sectorielle : vivier **watchlist + scan marché enrichi**, avec bouton pour élargir.
- Bilan global : **répartition secteur + alertes concentration**, **score de santé + synthèse**,
  **priorités d'action**, et **suggestions d'ajout** depuis le scan marché.

## Contrainte de données

Le **secteur** vient du module Yahoo `assetProfile` (secteur + industrie), ajouté à la requête
fondamentale existante — **coût de quota inchangé**. Il n'est donc connu que pour les titres
**analysés avec fondamentaux** (positions analysées, watchlist enrichie, scan enrichi). Les titres
sans secteur sont rangés « Secteur inconnu » et exclus du matching sectoriel, sans erreur.

Les positions réelles n'ont **pas de date d'entrée** (`{id, ticker, qty, pru}`) : le « plus haut »
du stop suiveur est le plus haut **des clôtures en cache disponibles**, pas depuis l'achat.

---

## A. Backend — `server.py`

### A.1 Module

`FUND_URL` ajoute `assetProfile` :
```
summaryDetail,financialData,defaultKeyStatistics,price,incomeStatementHistory,assetProfile
```

### A.2 Champs

`_normalize_fundamentals` ajoute, depuis `assetProfile` :
- `sector` (str ou None)
- `industry` (str ou None)

Chaînes uniquement (`x if isinstance(x, str) else None`), cohérent avec `longName`.

---

## B. Front — moteur de revue (fonctions pures)

Toutes dans une nouvelle section « REVUE DE PORTEFEUILLE », testées par `reviewSelfTest()`.

### B.1 Contexte d'une ligne

`reviewGlobal(entry)` = `entry.fundScore ? computeGlobalScore(entry) : entry.score` (déjà existant
via `computeGlobalScore`, qui retombe sur le technique sans fondamentaux).

### B.2 Stops

Réutilise la distance de stop du bot (volatilité). Extraction d'un helper partagé pour éviter la
duplication avec `botProfile` :
```js
function reviewStopPct(vol) { return clamp(0.40 * (isFinite(vol) ? vol : 30), 5, 20); }
```
- `stopInitialLevel(price, vol) = price * (1 - reviewStopPct(vol)/100)`
- `stopTrailLevel(highest, vol) = highest * (1 - 0.8 * reviewStopPct(vol)/100)`
- `highest` = max des clôtures en cache (`entry.hist.closes`), défaut `price`.
- Effet vs PRU : `(level/pru - 1) * 100` → « sécurise +X % » si > 0, « limite la perte à −X % » sinon.

### B.3 Verdict — `reviewVerdict(pos, entry)`

Renvoie `{ verdict, conviction, reasons: [] }` où `verdict ∈ "vendre" | "alleger" | "garder"`,
`conviction ∈ "faible" | "moyenne" | "forte"`.

Entrées calculées : `g = reviewGlobal(entry)`, `signal = entry.signal`, `rsi = ind.rsi`,
`rangePos = ind.rangePos`, `m1 = ind.perf?.m1` (perf 1 mois), `pnlPct = (price/pos.pru - 1)*100`.

Note sur la « cassure de stop » : un stop se pose **sous** le cours, il ne peut donc être « cassé »
tant qu'on détient la ligne. Pour une position réelle, le signal équivalent est une **chute déjà
subie** — on l'opérationnalise par la dynamique récente (`m1` fortement négatif), combinée au score.

Règles (évaluées dans l'ordre, première catégorie qui s'applique gagne) :

**Vendre** si l'une est vraie :
- `g <= 35` → raison « score global effondré (${g}/100) »
- `signal === "Vente"` → « signal technique à la vente »
- `g < 50 && m1 < -10` → « score faible et forte baisse récente (${m1} %) »

**Alléger** si l'une est vraie :
- `rangePos != null && rangePos > 90` → « au sommet de son range 52 semaines »
- `rsi != null && rsi > 70` → « suracheté (RSI ${rsi}) »
- `pnlPct > 40 && g < 60` → « forte plus-value (${pnlPct} %) sur un titre qui faiblit — sécuriser »
- `g >= 35 && g < 50` → « signaux mitigés (${g}/100) »

**Garder** sinon → « fondamentaux/technique solides (${g}/100) » si `g >= 60`, sinon « rien
d'alarmant (${g}/100) ».

**Conviction** :
- `forte` si `g <= 25` ou `g >= 75`, ou si ≥ 2 raisons concordent.
- `faible` si `g` entre 45 et 55 (zone grise).
- `moyenne` sinon.

### B.4 Alternative sectorielle — `reviewSectorAlt(entry, universe)`

`universe` = tableau d'entrées connues (`cache` + `marketCache`, dédupliquées par ticker).
- `sector = entry.fund?.sector`; si absent → `null`.
- Candidats : même `sector`, ticker différent, non détenu, `reviewGlobal(c) >= reviewGlobal(entry) + 8`.
- Retour : le meilleur candidat `{ ticker, sector, scoreThem, scoreYou }`, ou `null`.
- N'est **surfacé dans l'UI que si le verdict n'est pas « garder » forte** (ne pas suggérer de
  remplacer une ligne solide).

### B.5 Bilan — `reviewPortfolio(positions, entriesByTicker, valueOf)`

`valueOf(pos)` → valeur en devise de référence (injectée, réutilise `convertToBase`).
Renvoie :
- `total` : somme des valeurs.
- `bySector` : `{ [sector]: value }` (« Secteur inconnu » si non enrichi).
- `alerts` : liste de chaînes — position > 40 % du total ; secteur > 40 % du total.
- `health` : moyenne des `reviewGlobal` **pondérée par la valeur** des lignes ayant un score
  (`null` si aucune).
- `counts` : `{ garder, alleger, vendre }`.
- `priorities` : positions triées par urgence — poids `vendre=2, alleger=1, garder=0`, puis par
  `reviewGlobal` croissant (le plus faible en premier).

### B.6 Suggestions d'ajout — `reviewAdditions(positions, marketEntries, bySector, n = 5)`

- Candidats : `marketEntries` (scan marché) non détenus, `reviewGlobal >= 65`.
- Tri : `reviewGlobal` décroissant, **bonus** aux secteurs peu/pas exposés (`bySector` faible) :
  clé de tri `= reviewGlobal + (sousExposé ? 10 : 0)`, où sousExposé = part du secteur < 10 %.
- Retour : les `n` premiers `{ ticker, sector, score }`.

---

## C. UI — onglet F2

### C.1 Bloc « Revue » repliable (en haut de F2, après le formulaire d'ajout)

`<details class="review-block">` contenant, après clic sur **« Analyser mon portefeuille »** :
1. **Santé** : note /100 + phrase de synthèse (« Portefeuille solide, 1 ligne à surveiller. ») +
   compteurs garder/alléger/vendre.
2. **Répartition par secteur** : barres (réutilise le style `.bot-expo`) + alertes concentration
   en rouge.
3. **Priorités d'action** : liste ordonnée, chaque item = ticker + verdict + 1ʳᵉ raison.
4. **À ajouter** : liste des suggestions + secteur + score, avec un lien « analyser » (ajoute à la
   watchlist / ouvre l'analyse).

Le bouton **« Analyser mon portefeuille »** analyse chaque position non fraîche
(`analyzeTicker(..., { skipFund: false })`), avec progression `n/total`, best-effort, puis rend la
revue. Un bouton **« Élargir la recherche sectorielle »** enrichit à la demande quelques titres du
scan pour peupler les secteurs des positions.

### C.2 Par ligne du tableau

- Nouvelle colonne **Verdict** : pastille colorée (`vendre` rouge, `alleger` ambre, `garder` vert)
  + conviction en petit.
- Nouvelle colonne **Stop** : niveau initial ; le suiveur et l'effet vs PRU sont dans le détail.
- Bouton **« ⓘ »** qui déplie une **ligne de détail** sous la position : les raisons du verdict, les
  deux stops chiffrés avec effet vs PRU, et l'alternative sectorielle le cas échéant.

Tant que « Analyser mon portefeuille » n'a pas tourné, les colonnes affichent « — ».

### C.3 Avertissement

Texte du cadre (voir plus haut) affiché en permanence en bas du bloc Revue, classe `.fund-caveat`.

---

## D. Tests — `reviewSelfTest()`

Même harnais que `botSelfTest`/`fundSelfTest` (réutilise `botTest`/`botAssert*`).

- **Stops** : `reviewStopPct` borné 5–20 ; effet vs PRU positif/négatif ; `highest` pris du cache.
- **Verdict** : score ≤ 35 → vendre ; signal Vente → vendre ; rangePos > 90 → alléger ; forte
  plus-value + score faible → alléger ; score ≥ 60 → garder ; conviction forte aux extrêmes,
  faible en zone grise ; raisons non vides.
- **Alternative sectorielle** : trouve un meilleur titre du même secteur ; ignore autre secteur ;
  ignore si écart < 8 ; `null` si secteur inconnu.
- **Bilan** : `bySector` correct ; alerte si une ligne > 40 % ; santé **pondérée par la valeur**
  (une grosse ligne pèse plus) ; priorités classent vendre avant garder.
- **Suggestions** : exclut les titres détenus ; seuil 65 ; bonus secteur sous-exposé remonte un
  titre.
- **Robustesse** : position sans cache → « — » sans crash ; portefeuille vide → bilan neutre ;
  entrée sans fondamentaux → secteur inconnu, verdict quand même calculé sur le technique.

Vérification manuelle : F2 avec quelques positions réelles, bouton d'analyse, détail par ligne,
responsive mobile, non-régression F1–F9 et bot, `py -m unittest discover tests` vert.

---

## E. Cas limites

| Cas | Comportement |
|---|---|
| Position jamais analysée | Colonnes « — » ; incluse dans le bilan sans score (exclue de la santé) |
| Titre sans fondamentaux (secteur inconnu) | Verdict sur le technique ; pas d'alternative sectorielle ; « Secteur inconnu » dans la répartition |
| Un seul titre d'un secteur, aucun meilleur | Pas d'alternative proposée |
| Devise non convertible | Ligne exclue des agrégats de valeur (comportement F2 existant), signalée |
| Scan marché vide | Section « À ajouter » masquée avec invite à lancer un scan |
| PRU ou cours ≤ 0 | Ligne affichée, effet vs PRU omis (« — ») |

## Non-objectifs (YAGNI)

- Pas d'exécution d'ordres ni de pose automatique de stops (jamais — paper trading uniquement pour
  le bot ; ici, pur affichage).
- Pas de conseil personnalisé au sens réglementaire : règles transparentes uniquement, disclaimer
  permanent.
- Pas de tendance sectorielle historique (donnée non fiable chez Yahoo).
- Pas de date d'entrée rétroactive pour les positions (le suiveur part du plus haut en cache).
