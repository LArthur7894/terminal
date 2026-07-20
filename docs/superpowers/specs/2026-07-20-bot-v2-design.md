# Bot de trading v2 — auto-réglage par titre, sessions de marché, apprentissage — Design

**Date :** 2026-07-20
**Statut :** Validé (design)
**Remplace/étend :** `2026-07-18-bot-trading-design.md`

## Cadre (non négociable)

**Simulateur 100 % virtuel.** Aucun ordre réel, aucun courtier, aucun argent réel. Ce n'est pas un
conseil en investissement. Le disclaimer permanent de l'app reste affiché.

## Objectif

Pousser le bot F8 nettement plus loin :

1. **Plus de réglages manuels de stratégie** : chaque titre reçoit ses réglages, calculés à partir de
   ses propres caractéristiques (volatilité, tendance, position dans le range, score, marché).
2. **Le bot travaille sur le marché ouvert à l'heure où il tourne** (Europe le matin, US l'après-midi
   et le soir), en boucle intraday, pour travailler le plus possible.
3. **Il apprend de ses propres trades**, par famille de titres.
4. **Gestion du risque de niveau professionnel** : taille par le risque, stop suiveur, sortie
   partielle, plafonds d'exposition, frais et slippage simulés.
5. **Il explique ce qu'il fait** (journal) et **se mesure** (statistiques).

## Limite structurelle assumée

Pas de serveur 24/7 : le bot ne tourne que quand l'app est ouverte. La boucle intraday travaille tant
que l'onglet est ouvert ; à chaque réouverture, le **rattrapage sur clôtures quotidiennes** (mécanisme
v1, conservé) rejoue les jours manqués et déclenche stops/cibles au jour exact du franchissement.

---

## A. Marchés et sessions

### A.1 Détection du marché

```js
// Suffixe Yahoo → place de cotation. Sans suffixe → US.
function botMarketOf(symbol) → "EU" | "US" | "ASIA"
```

- **EU** : `.PA .AS .BR .LS .MC .MI .DE .F .SW .L .VI .HE .ST .OL .CO .IR`
- **ASIA** : `.T .KS .KQ .HK .SS .SZ .AX .NS .BO .SI .TW`
- **US** (défaut, y compris `BRK-B`) : tout le reste.

### A.2 Sessions ouvertes

```js
function botOpenMarkets(now = new Date()) → Set<"EU"|"US"|"ASIA">
```

L'heure locale de chaque place est obtenue avec `Intl.DateTimeFormat("en-GB", { timeZone, hour12:false,
weekday:"short", hour:"2-digit", minute:"2-digit" }).formatToParts(now)` — **le passage à l'heure d'été
est donc géré par le navigateur**, aucun horaire de Paris n'est codé en dur.

| Marché | Fuseau | Session locale | Jours |
|---|---|---|---|
| EU | `Europe/Paris` | 09:00 → 17:30 | lun–ven |
| US | `America/New_York` | 09:30 → 16:00 | lun–ven |
| ASIA | `Asia/Tokyo` | 09:00 → 15:00 | lun–ven |

`botNextOpen(market, now)` renvoie le délai avant la prochaine ouverture (pour le bandeau UI).

**Jours fériés non gérés** (YAGNI) : en paper trading, un trade au dernier cours connu un jour férié
n'a pas de conséquence réelle. Mentionné comme limite dans l'UI.

### A.3 Effets sur le moteur

- **Achats** : un candidat n'est éligible que si `botOpenMarkets().has(botMarketOf(ticker))`.
  Dans le chevauchement (15h30–17h30 Paris en été), EU **et** US sont éligibles.
- **Sorties** : si le marché du titre est **ouvert**, stop/cible/suiveur sont testés sur le **cours en
  direct** (`ind.price`, rafraîchi). Si **fermé**, on s'en tient au rejeu des clôtures + réévaluation
  du score — pas de vente sur un prix périmé, sauf vente manuelle explicite de l'utilisateur.
- **Aucun marché ouvert** : rattrapage seulement, aucun achat.
- **Éligibilité d'un candidat** : `computeGlobalScore(e) >= cfg.qualityMin + learn[family].qualityAdj`
  — le seuil de qualité est donc relevé sur les familles qui perdent de l'argent (§C.2).

### A.4 Boucle intraday

`bot.config.autoLoop` (défaut `true`) et `bot.config.loopMinutes` (défaut 15).

- Timer relancé après chaque `runBot()`, uniquement si un marché est ouvert **et** que l'onglet est
  visible (`document.visibilityState === "visible"`).
- `visibilitychange` : arrêt du timer quand l'onglet passe en arrière-plan, relance immédiate au retour.
- Un seul `runBot()` à la fois (garde `botRunning`), réentrance impossible.
- Hors séance, le timer est reprogrammé à la prochaine ouverture (plafonné à 30 min pour rester simple).

---

## B. Profil automatique par titre

`botProfile(entry, cfg, learn)` — **fonction pure**, renvoie tous les réglages d'une position. Elle
remplace `botStopPct` / `botRR` / `botTargetPct` / `botPositionAmount` de la v1 (qui disparaissent).

```js
{
  market,        // "EU" | "US" | "ASIA"
  volBucket,     // "faible" (<20) | "moyenne" (20–40) | "forte" (>=40)
  family,        // `${market}:${volBucket}`
  stopPct,       // stop-loss initial, %
  trailPct,      // distance du stop suiveur, %
  rr,            // ratio gain/risque retenu
  targetPct,     // cible de prise partielle, %
  amount,        // montant à investir, €
  horizonDays,   // durée de détention max
  why,           // texte d'explication (journal)
}
```

**Volatilité** : `ind.vol` (annualisée 3 mois, déjà calculée) ; défaut 30 % si absente.

**Stop** : `clamp(cfg.stopVolFactor × learn.stopMult × vol, cfg.stopMin, cfg.stopMax)`
(défauts : facteur 0,40 ; bornes 5–20 %).

**Stop suiveur** : `trailPct = 0,8 × stopPct` — une fois en gain, on protège plus serré qu'à l'entrée.

**Ratio gain/risque** :
```
rr = rrMin + (score − qualityMin)/(100 − qualityMin) × (rrMax − rrMin)
   + 0,3  si price > sma50 > sma200            (tendance haussière confirmée)
   − 0,3  si ind.rangePos > 90                 (déjà au sommet de son range 52 s.)
rr = clamp(rr × learn.rrMult, 1,2, 4)
```
(défauts `rrMin` 1,5 / `rrMax` 3.) `targetPct = stopPct × rr`.

**Taille par le risque** (changement majeur vs v1) :
```
amountRisque = capital × riskPerTradePct / (stopPct / 100)     // risque € constant par trade
amount = clamp(amountRisque × (score / 75), 0,5×, 1,5×)         // modulé par la conviction
amount = min(amount, maxPositionPct × valeurPortefeuille, marge marché restante, cash)
```
Défauts : `riskPerTradePct` 1 %, `maxPositionPct` 15 %, `maxMarketPct` 60 %.
En v1 la taille ignorait le stop : une action volatile risquait 3× plus qu'une action calme.
Désormais chaque position risque le même montant.

**Horizon** : 60 j (vol faible), 45 j (moyenne), 30 j (forte). Dépassé → sortie « horizon ».

Les réglages de stratégie (stop, cible, taille) **ne sont plus modifiables à la main** : c'est
l'objectif de cette version. Seuls restent réglables : capital, risque par trade, plafonds, frais,
boucle, apprentissage on/off (voir §G).

---

## C. Apprentissage par famille

### C.1 Familles

`family = ${market}:${volBucket}` → 9 familles au maximum. Chaque position enregistre sa `family` à
l'entrée, et l'historique la conserve.

### C.2 Calcul

`botComputeLearning(history, cfg)` — **fonction pure**, appelée à chaque `runBot()`. Les statistiques
sont **recalculées depuis `bot.history`**, jamais accumulées de façon incrémentale : pas de dérive
silencieuse, et un reset de l'historique remet l'apprentissage à neutre automatiquement.

Une famille reste **neutre** (`stopMult=1, rrMult=1, qualityAdj=0`) tant qu'elle a moins de
`learnMinTrades` (10) trades fermés.

| Constat sur la famille | Correction |
|---|---|
| Part de sorties « stop-loss » > 45 % | `stopMult` augmenté (sorti sur du bruit) |
| Part de sorties « stop-loss » < 15 % | `stopMult` réduit (stop inutilement large) |
| Taux de réussite > 60 % **et** gain moyen < perte moyenne | `rrMult` augmenté (gagnants coupés trop tôt) |
| Taux de réussite < 40 % **et** gain moyen > 2 × perte moyenne | `rrMult` réduit (cible inatteignable) |
| P&L moyen < 0 sur ≥ 15 trades | `qualityAdj` +5 (jusqu'à +15) : achète moins dans cette famille |
| P&L moyen > 0 sur ≥ 15 trades | `qualityAdj` revient vers 0 par pas de 5 |

**Lissage et bornes** : chaque recalcul déplace le multiplicateur de **10 % au plus** vers la valeur
visée, et les multiplicateurs sont bornés à **[0,70 ; 1,30]**. `qualityAdj ∈ [0 ; +15]`. Impossible de
partir en vrille sur une série chanceuse.

État stocké (pour l'affichage et la reprise du lissage) :
```js
bot.learn = { "US:forte": { stopMult, rrMult, qualityAdj, n, winRate, stopRate, avgWin, avgLoss, updatedAt } }
```

`cfg.learnEnabled` (défaut `true`) : à `false`, tout est neutre mais les stats restent affichées.

---

## D. Gestion du risque

### D.1 Stop suiveur

Chaque position suit `highest` (plus haut cours **de clôture ou en direct** observé depuis l'entrée,
mis à jour à chaque évaluation et lors du rejeu des clôtures).

- Tant que le gain latent < 1 × risque : stop fixe à `entryPrice × (1 − stopPct/100)`.
- Au-delà : `stopLevel = max(stopLevel, highest × (1 − trailPct/100))` — **monotone croissant**, il
  ne redescend jamais. Sortie raison **« stop suiveur »**.

### D.2 Sortie partielle

À l'atteinte de `targetPct`, **50 %** de la quantité est vendue (raison **« prise partielle »**), le
reste continue sous stop suiveur avec `scaledOut = true`. Une position ne peut prendre son partiel
qu'une fois. La sortie du reliquat s'historise normalement.

### D.3 Plafonds d'exposition

- `maxPositionPct` : 15 % de la valeur du portefeuille par position.
- `maxMarketPct` : 60 % par marché (EU / US / ASIA) — force la diversification géographique.
- Pas de plafond sectoriel : **l'app ne dispose d'aucune donnée sectorielle par titre** (le scan
  marché saute volontairement les fondamentaux pour tenir le quota Yahoo). L'ajouter coûterait une
  requête par titre. Le plafond par marché couvre l'essentiel du besoin.

### D.4 Frais et slippage

`cfg.feePct` (0,10 %) et `cfg.slipPct` (0,05 %), appliqués **à l'entrée et à la sortie** :
- entrée : `prix payé = price × (1 + slip/100)`, puis `cash -= amount × (1 + fee/100)` ;
- sortie : `prix reçu = price × (1 − slip/100)`, puis `cash += produit × (1 − fee/100)`.

Les trades déjà présents dans `bot.history` ne sont **pas réécrits** (leurs chiffres restent ceux du
moment). Le journal signale que les frais ont été introduits à telle date.

### D.5 Horizon

Position détenue depuis plus de `horizonDays` jours calendaires → sortie au cours courant, raison
**« horizon »**. Élimine les positions dormantes qui immobilisent du capital.

---

## E. Journal de décisions

`bot.log` : tableau de `{ ts, kind, ticker, msg }`, **150 entrées max** (les plus récentes en tête),
persisté avec le reste de l'état. `kind ∈ achat | vente | partiel | ignoré | info`.

Exemples de messages attendus :

- `ACHAT ASML.AS — score 78, volatilité 34 % (famille EU/moyenne). Stop 13,6 % (facteur 0,40 × 1,10 appris), cible 34,0 % (RR 2,5 dont +0,3 tendance). Mise 640 € = 1 % de risque du capital.`
- `PARTIEL NVDA — cible +28,4 % atteinte, 50 % vendus à 214,30 $, stop suiveur à 168,20 $.`
- `VENTE MC.PA — stop suiveur touché à 612,40 €, +6,2 % net de frais.`
- `IGNORÉ 7203.T — marché ASIA fermé.`
- `IGNORÉ SAP.DE — plafond marché EU atteint (60 %).`

Les refus (`ignoré`) ne sont journalisés qu'une fois par cause et par évaluation, pour ne pas noyer le
journal à chaque boucle de 15 min.

---

## F. Statistiques

`bot.equity` : `[{ date, value }]`, **un point par jour** (le dernier de la journée écrase le
précédent), 400 points max.

Indicateurs calculés par `botStats()` (fonction pure sur `history` + `equity`) :

- valeur, performance totale %, **drawdown maximum** %,
- taux de réussite, **profit factor** (somme des gains / somme des pertes), gain moyen, perte moyenne,
  espérance par trade,
- répartition **par marché**, **par famille**, **par raison de sortie**.

Rendu : courbe de capital en SVG léger (même approche que les graphiques existants de l'app) +
tableaux compacts (cartes sur mobile).

---

## G. UI — onglet F8 refondu

Sections repliables, style et responsive identiques au reste de l'app.

1. **Bandeau de session (en direct)** : `🇪🇺 Europe ouverte · 🇺🇸 US ouvre dans 1 h 12` (ou
   « ouvert »), état de la boucle auto + interrupteur, et heure de la prochaine évaluation.
2. **Résumé** : valeur totale, performance, cash, **exposition par marché** (barres).
3. **Positions ouvertes** : ticker, famille, entrée, cours, +/− %, **stop effectif** (initial ou
   suiveur, signalé), cible, **partiel pris**, **jours restants** avant horizon, bouton Vendre.
4. **Statistiques** (nouveau) — §F.
5. **Familles apprises** (nouveau) : par famille, n trades, taux de réussite, part de stops, et les
   correctifs actifs **avec leur justification en clair**.
6. **Journal** (nouveau) — §E.
7. **Historique des trades** : + colonnes famille et raison (stop-loss / stop suiveur / prise
   partielle / réévaluation / horizon / manuelle). La raison « prise de bénéfice » de la v1 n'est plus
   produite — la cible déclenche désormais une prise partielle (§D.2) — mais reste affichable pour les
   trades antérieurs.
8. **Réglages** — réduits à ce qui a du sens de piloter :
   capital · risque par trade % · plafond par position % · plafond par marché % · frais % · slippage %
   · seuil de qualité de base · seuil de sortie · boucle auto (on/off + minutes) · **apprentissage
   (on/off)**. Les stop/cible/taille ne sont plus réglables : ils sont automatiques.

---

## H. État persisté (`LS.bot`) et migration

```js
bot = {
  started, startDate, cash,
  positions: [{ ticker, market, family, entryDate, entryPrice, qty, stopPct, trailPct, targetPct,
                stopLevel, highest, horizonDays, scaledOut, entryScore }],
  history:   [{ ticker, family, entryDate, entryPrice, exitDate, exitPrice, qty, pnl, pnlPct, reason }],
  log:       [{ ts, kind, ticker, msg }],
  equity:    [{ date, value }],
  learn:     { [family]: { stopMult, rrMult, qualityAdj, n, ... } },
  config:    { capital, qualityMin, exitScore, stopVolFactor, stopMin, stopMax, rrMin, rrMax,
               riskPerTradePct, maxPositionPct, maxMarketPct, feePct, slipPct,
               autoLoop, loopMinutes, learnEnabled, learnMinTrades },
}
```

**Migration douce depuis la v1** (obligatoire — des bots tournent déjà) : champs manquants remplis par
défaut ; `log`, `equity`, `learn` créés vides ; pour chaque position existante, `market`/`family`
déduits du ticker, `stopLevel` = stop initial, `highest` = `entryPrice`, `scaledOut = false`,
`horizonDays` par défaut de la famille. `ticketPct` (v1) est ignoré, remplacé par le dimensionnement
par le risque. Aucune perte de position ni d'historique.

---

## I. Gestion des erreurs / cas limites

| Cas | Comportement |
|---|---|
| Aucun marché ouvert | Rattrapage seul, aucun achat, journal « hors séance » |
| `marketCache` vide | Aucun candidat, aucune erreur |
| `ind.vol` absente | 30 % par défaut |
| `ind.sma50/sma200/rangePos` absents | Bonus/malus de RR non appliqués (RR de base) |
| Prix ou `entryPrice` ≤ 0 / non fini | Position ignorée à l'évaluation |
| Panne réseau au refresh | Best-effort : on évalue avec les données en cache, jamais de crash |
| Onglet en arrière-plan | Boucle suspendue, reprise au retour |
| `runBot()` déjà en cours | Appel ignoré (garde de réentrance) |
| Famille sous 10 trades | Apprentissage neutre |
| Plafond marché/position atteint | Achat refusé, journalisé une fois |
| Reset | Vide positions, historique, journal, equity **et** apprentissage |

---

## J. Tests / vérification

Le projet n'a pas de harnais JS (seulement `tests/test_fundamentals.py`, côté serveur). On garde la
convention mono-fichier : ajout d'une fonction **`botSelfTest()`** appelable depuis la console, qui
assertionne les fonctions pures et affiche un rapport pass/fail :

- `botMarketOf` : suffixes EU / US / ASIA, cas `BRK-B`, ticker inconnu.
- `botOpenMarkets` à des instants figés : matin EU seul, chevauchement EU+US, soirée US seul, nuit,
  week-end, **et une date d'hiver + une date d'été** (vérifie que le DST est bien pris en compte).
- `botProfile` : stop borné 5–20 % ; RR croissant avec le score, +0,3 tendance, −0,3 haut de range ;
  **risque € identique** entre une action à vol 15 % et une à vol 45 % ; plafonds position/marché ;
  horizon par bucket.
- `botComputeLearning` : neutre sous 10 trades ; élargissement du stop quand > 45 % de stops ;
  multiplicateurs bornés [0,70 ; 1,30] ; lissage ≤ 10 % par passe ; `qualityAdj` borné [0 ; 15].
- Stop suiveur : **monotone croissant** sur une série montante puis descendante ; déclenché au bon prix.
- Sortie partielle : moitié de la quantité, `scaledOut` posé, une seule fois.
- Frais/slippage : appliqués aux deux côtés ; un aller-retour à prix constant est **perdant** du
  montant attendu.
- Migration v1 → v2 : un état v1 est rechargé sans perte, positions complétées.

Vérification manuelle : onglet F8 (bandeau de session, boucle, journal, stats, familles, réglages),
responsive mobile, non-régression F1–F7, `py -m unittest discover tests` vert.

---

## K. Découpage d'implémentation

- **Phase 1** — sessions (`botMarketOf`, `botOpenMarkets`, filtrage des achats, sorties en direct),
  boucle intraday, `botProfile` (stop/cible/taille par le risque/horizon), migration d'état.
- **Phase 2** — risque évolué : stop suiveur, sortie partielle, plafonds position/marché, frais et
  slippage, journal de décisions.
- **Phase 3** — apprentissage par famille, statistiques + courbe de capital, refonte de l'UI F8.

Chaque phase se termine par `botSelfTest()` vert et une vérification manuelle.

## Non-objectifs (YAGNI)

- Pas d'ordres réels, pas de courtier (jamais).
- Pas de données intraday historisées (le direct sert au moment présent ; l'historique reste quotidien).
- Pas de calendrier de jours fériés.
- Pas de plafond sectoriel (donnée absente — voir §D.3).
- Pas de backtest multi-paramètres ni d'optimisation hors ligne.
- Pas d'exécution quand l'app est fermée.
