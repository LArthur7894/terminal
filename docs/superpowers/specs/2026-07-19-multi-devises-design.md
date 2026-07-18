# Spec — Portefeuille multi-devises

**Date :** 2026-07-19
**Statut :** validé, prêt pour le plan d'implémentation

## Problème

Le calcul du portefeuille additionne les valeurs de toutes les positions sans
tenir compte de leur devise. Dans `renderPositions` (`totalValue += value`), une
position en USD (AAPL) et une en EUR (MC.PA) sont sommées comme si elles étaient
dans la même unité → le total, le P&L global, l'allocation et la courbe
d'évolution sont faux dès qu'un portefeuille mélange les devises.

C'est un bug de correctness qui touche le cœur de l'application.

## Objectif

Convertir tous les **agrégats** du portefeuille vers une **devise de référence**
(EUR par défaut, configurable), tout en gardant chaque ligne affichée dans sa
**devise native**.

## Principe

- Chaque ligne du tableau Positions reste dans sa devise native (cours d'AAPL en
  $, cours de MC.PA en €).
- Seuls les agrégats sont convertis vers la devise de référence :
  - valeur totale, coût total, P&L total (`renderPositions`)
  - parts du camembert d'allocation (`renderAllocationChart`)
  - points de la courbe d'évolution (`recordPerfSnapshot`)

## Conception détaillée

### 1. Devise de référence (réglage)

- Nouveau réglage persistant, scopé par profil : `baseCurrency`, défaut `"EUR"`.
- Clé localStorage ajoutée à l'objet `LS` (via `lsGet`/`lsSet` existants).
- UI : un `<select id="base-currency">` dans l'en-tête de l'onglet **F2 ·
  POSITIONS**, avec les options `EUR, USD, GBP, CHF, CAD, JPY, AUD`.
- Au changement : sauvegarde, `ensureFxRates()`, puis `renderAll()`.

### 2. Taux de change

- Fonction `getFxRate(from, to)` :
  - `from === to` → renvoie `1`.
  - sinon récupère la paire Yahoo `{from}{to}=X` (ex. `USDEUR=X`) via le relais
    existant `/api/history?symbol=…`, et garde le dernier cours (`closes[0]`).
- **Cache des taux** : objet `fxRates` en mémoire + persisté en localStorage,
  structuré par clé `"{from}->{to}"` avec `{ rate, updated }`.
- Fraîcheur : un taux est rafraîchi s'il a plus de ~12 h. Le FX bouge peu à
  l'échelle d'un suivi perso ; on évite de multiplier les appels Yahoo.
- Un seul appel réseau par devise distincte présente dans le portefeuille.

### 3. Conversion (le fix)

- Fonction unique `positionValueBase(pos)` :
  `pos.qty × refPrice(pos) × rate(deviseDe(pos) → baseCurrency)`.
- `deviseDe(pos)` = `cache[pos.ticker]?.hist?.currency`, sinon devise de base
  (avec indicateur, voir §5).
- Cette fonction remplace le `qty × refPrice` brut aux **3 endroits** :
  - `renderPositions` — total valeur/coût/P&L, affichés avec le symbole/code de
    la devise de référence.
  - `renderAllocationChart` — les parts (données du camembert) utilisent les
    valeurs converties.
  - `recordPerfSnapshot` — la valeur enregistrée est convertie.
- Chaque ligne du tableau gagne un **code devise discret** (ex. `USD`) affiché
  seulement quand la devise diffère de la devise de référence.

### 4. Rendu asynchrone

`renderPositions` doit rester **synchrone** (appelé depuis `renderAll`, lui-même
synchrone). Les taux sont donc pré-chargés :

- `ensureFxRates()` (async) : calcule l'ensemble des devises distinctes du
  portefeuille, récupère les taux manquants ou périmés vers la devise de base,
  remplit le cache `fxRates`, puis déclenche un re-render.
- Appelée quand les positions changent, quand la devise de référence change, et
  à l'ouverture de l'onglet Positions.
- Si un taux manque encore au moment du rendu : la ligne s'affiche, mais le total
  montre un état « … » + badge « taux en cours » ; le re-render déclenché par
  `ensureFxRates()` complète l'affichage dès que le taux arrive.

### 5. Dégradation gracieuse

- Position sans devise connue (jamais analysée) → supposée en devise de base,
  avec un indicateur discret sur la ligne.
- Taux Yahoo indisponible pour une devise → le total est marqué comme partiel /
  incertain avec un avertissement clair. **Jamais** de chiffre faux affiché
  silencieusement.

## Hors périmètre

- **Bot F8** (paper trading) : conserve son hypothèse mono-devise (solde cash
  théorique).
- **Allocation F6** (montant neuf à répartir) : saisi dans la devise de
  référence, pas de conversion.
- Les **points passés** de la courbe d'évolution restent dans leurs anciennes
  unités (mélangées) ; seuls les nouveaux points sont en devise de référence.
  Discontinuité mineure et acceptée.

## Critères de réussite

1. Un portefeuille EUR + USD affiche un total cohérent en devise de référence
   (vérifiable à la main : `valeur_usd × taux_usd_eur + valeur_eur`).
2. Changer la devise de référence recalcule tous les agrégats.
3. Chaque ligne reste dans sa devise native, avec le code devise visible quand il
   diffère de la référence.
4. Le camembert d'allocation reflète les poids réels (convertis).
5. Aucun chiffre faux affiché en cas de taux indisponible : état dégradé explicite.
6. Aucune régression pour un portefeuille mono-devise (EUR pur).
