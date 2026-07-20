# Fondamentaux avancés (PEG, FCF Yield, BNA, dette nette, consensus, VE/EBITDA) — Design

**Date :** 2026-07-20
**Statut :** Validé par Arthur

## Objectif

Ajouter sept indicateurs fondamentaux à l'app, **affichés** dans l'analyse, le comparateur et le
scan marché, et **intégrés au score fondamental** (donc aux décisions d'achat du bot).

## Décisions validées

- Les indicateurs **pèsent** dans le score fondamental (pas seulement affichés).
- L'avis des analystes et le potentiel vs objectif de cours entrent dans le **pilier Valorisation**
  (choix d'Arthur, en connaissance du caractère circulaire de la donnée).
- Affichage dans **F4 Analyse**, **F9 Comparateur** et **F5 Scan marché**.
- Scan marché : chargement **à la demande** des 20 premiers titres du tableau trié/filtré
  (le scan lui-même reste rapide ; +2,3 s par titre sinon, soit +36 s sur 127 titres).

## Contrainte connue : la tendance de la dette est impossible

Yahoo renvoie `balanceSheetHistory` avec **seulement `endDate`** — tous les montants sont vides,
vérifié sur AAPL et MC.PA. La demande initiale « endettement net en baisse = bon signe » n'est donc
pas réalisable. On expose la **dette nette actuelle** rapportée à l'EBITDA, qui est la lecture
standard. `incomeStatementHistory` fonctionne (4 exercices de résultat net) et sert à la régularité
du BNA.

---

## A. Backend — `server.py`

### A.1 Modules Yahoo

`FUND_URL` passe de 4 à 5 modules — **même requête, coût de quota inchangé** :
```
summaryDetail,financialData,defaultKeyStatistics,price,incomeStatementHistory
```

### A.2 Champs ajoutés à `_normalize_fundamentals`

Depuis `financialData` : `freeCashflow`, `totalDebt`, `totalCash`, `ebitda`,
`recommendationMean`, `numberOfAnalystOpinions`.
Depuis `defaultKeyStatistics` : `sharesOutstanding`.

Nouveau champ dérivé `netIncomeHistory` : liste `[{ year, netIncome }]` du plus ancien au plus
récent, construite depuis `incomeStatementHistory` (4 exercices), vide si le module manque.

Tous les champs absents restent `None` — le front dégrade proprement (comportement existant).

---

## B. Front — indicateurs dérivés (fonctions pures)

| Champ | Calcul | Cas limites |
|---|---|---|
| `fcfYield` | `freeCashflow / marketCap` (fraction) | capi ≤ 0 ou FCF absent → `null` |
| `netDebt` | `totalDebt − totalCash` | l'un des deux absent → `null` |
| `netDebtToEbitda` | `netDebt / ebitda` | EBITDA ≤ 0 → `null` ; dette nette < 0 → valeur négative conservée |
| `targetUpsidePct` | `(targetMeanPrice / cours − 1) × 100` | cours ≤ 0 ou objectif absent → `null` |
| `epsTrendRatio` | part de hausses d'une année sur l'autre dans `netIncomeHistory` | moins de 2 exercices → `null` |

`epsTrendRatio` : sur 4 exercices il y a 3 comparaisons ; 3 hausses → `1`, 0 hausse → `0`.

---

## C. Barèmes (seuils d'Arthur)

Tous via le `piecewise` existant, sous-score 0..1.

| Indicateur | Barème | Justification |
|---|---|---|
| PEG | `[[1,1],[2,0.5],[3,0]]` | **inchangé** — correspond déjà à « < 1 bien » |
| FCF Yield | `[[0.02,0],[0.045,0.5],[0.07,1]]` | « > 7 % bien, < 2 % pas bien » |
| VE/EBITDA | `[[8,1],[12,0.5],[18,0]]` | **resserré** depuis `[[8,1],[15,0.5],[25,0]]` — « < 8 bien, 9–12 moyen, au-dessus moins bien » |
| Dette nette / EBITDA | `< 0 → 1` sinon `[[0,1],[2,0.6],[4,0]]` | « négative très positif » |
| Régularité BNA | `epsTrendRatio` utilisé directement (déjà 0..1) | « augmentation régulière bon signe » |
| Avis analystes | `recommendationMean` : `[[1,1],[3,0.5],[5,0]]` | 1 = achat fort, 5 = vente |
| Potentiel vs objectif | `≤ 0 → 0` sinon `[[0,0.3],[15,0.7],[30,1]]` | +30 % = note max |

**Fiabilité du consensus** : si `numberOfAnalystOpinions < 3`, l'avis et l'objectif sont ignorés
(sous-score `null`) — un consensus de deux analystes n'est pas un consensus.

---

## D. Intégration aux piliers

Poids des piliers **inchangés** (`valuation .35, profitability .30, growth .20, health .15`).

- **`scoreValuation`** : ajout de `fcfYield`, `targetUpside`, `analystRating` aux 5 sous-scores
  existants → 8 sous-scores moyennés. Les 2 sous-scores d'opinion représentent 2/8 du pilier,
  soit ~8,75 % du score total : présents sans dominer.
- **`scoreGrowth`** : ajout de `epsTrendRatio` → 3 sous-scores.
- **`scoreHealth`** : ajout de `netDebtToEbitda` → 3 sous-scores + bonus dividende inchangé.

`avgDefined` ignore déjà les sous-scores `null` : un titre sans consensus garde un pilier
Valorisation calculé sur ses seules données comptables. Aucune régression sur les titres pauvres
en données.

---

## E. Affichage

### E.1 F4 Analyse — bloc fondamental

Tableau des sept indicateurs sous le détail existant : libellé, valeur formatée, pastille
verte / orange / rouge selon le sous-score (`≥ 0.66` vert, `≥ 0.33` orange, sinon rouge), et
rappel du seuil en clair. Les valeurs absentes affichent « — » sans pastille.

`buildFundamentalText()` est enrichi : mention du FCF Yield et du VE/EBITDA dans la phrase
valorisation, de la régularité du BNA dans la phrase croissance, de la dette nette dans la phrase
santé, et une phrase consensus quand il est disponible.

### E.2 F9 Comparateur

Sept lignes supplémentaires, meilleur titre par ligne mis en évidence via la classe `.best`
existante. Le sens du « meilleur » suit le sous-score, pas la valeur brute (un PEG bas gagne, un
FCF Yield haut gagne).

### E.3 F5 Scan marché

- Bouton **« Charger les fondamentaux (20 premiers) »** sous les filtres, qui enrichit les 20
  premières lignes du tableau **tel qu'il est trié et filtré**, via `analyzeTicker(..., { skipFund: false })`.
- Progression affichée (`n/20`), bouton désactivé pendant le chargement, best-effort en cas d'échec.
- Colonnes ajoutées, triables comme les colonnes existantes : PEG, FCF Yield, VE/EBITDA,
  dette nette/EBITDA, potentiel vs objectif. Valeur « — » quand les fondamentaux ne sont pas chargés.
- Le bot profite automatiquement des fondamentaux mis en cache (le `fundScore` est recalculé).

---

## F. Tests

Fonction **`fundSelfTest()`** appelable en console, sur le modèle de `botSelfTest()` (même
`botTest`/`botAssert*` réutilisés) :

- Calculs dérivés : `fcfYield`, `netDebt`, `netDebtToEbitda`, `targetUpsidePct`, `epsTrendRatio`
  (croissance parfaite, décroissance, alternance, série trop courte).
- Barèmes : chaque seuil d'Arthur vérifié aux bornes (FCF 7 % → 1, 2 % → 0 ; VE/EBITDA 8 → 1,
  12 → 0,5 ; dette nette négative → 1).
- Consensus ignoré sous 3 analystes.
- Piliers : un titre sans consensus garde un pilier Valorisation calculé ; un titre sans aucune
  donnée renvoie `null` (pas de division par zéro).
- Non-régression : un `fund` v1 (sans les nouveaux champs) produit toujours un score.

Vérification manuelle : F4 sur un titre réel, F9 sur trois titres, F5 chargement des 20 premiers,
responsive mobile, `py -m unittest discover tests` vert.

---

## G. Cas limites

| Cas | Comportement |
|---|---|
| `incomeStatementHistory` absent | `netIncomeHistory` vide → régularité BNA `null` |
| EBITDA ≤ 0 (entreprise en perte) | `netDebtToEbitda` `null`, sous-score ignoré |
| Capitalisation absente | `fcfYield` `null` |
| Moins de 3 analystes | Avis et objectif ignorés du score, mais **affichés** avec la mention du nombre d'analystes |
| Fondamentaux non chargés (scan) | Colonnes « — », tri place ces lignes en fin |
| Titre sans aucun fondamental | `fundScore` `null`, comportement actuel préservé |

---

## Non-objectifs (YAGNI)

- Pas de tendance de la dette nette (donnée indisponible chez Yahoo — voir plus haut).
- Pas d'historique de BNA par action (le nombre d'actions passé n'est pas fourni ; on utilise le
  résultat net comme mesure de régularité).
- Pas de chargement automatique des fondamentaux sur les 127 titres du scan.
- Pas de nouveau pilier « Consensus » (choix validé : intégration à la Valorisation).
