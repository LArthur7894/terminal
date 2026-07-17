# Alertes & Export/Import — Design

**Date :** 2026-07-17
**Statut :** Validé (design), en attente relecture spec
**Auteur :** Arthur + Claude

## Contexte

Le terminal (`terminal-tout-en-un.html`) suit des tickers (watchlist), calcule des scores
technique/fondamental/global, et persiste tout par profil dans localStorage. Il manque :
1. un système d'**alertes** (être prévenu quand un titre franchit un seuil) ;
2. un **export/import** des données (sauvegarde / transfert entre appareils).

Contrainte connue : pas de serveur 24/7 → une alerte est **évaluée quand l'app est ouverte /
rafraîchie** (à chaque analyse), pas en temps réel.

## Objectif

- Ajouter un onglet **F7 « 🔔 Alertes »** : créer/gérer des règles d'alerte et voir les
  déclenchements.
- Ajouter **Export / Import** des données du profil (fusion à l'import).

## Décisions validées

- 4 types d'alerte : **prix**, **score global**, **RSI**, **variation du jour**.
- Alertes gérées dans un **nouvel onglet F7**.
- Import en mode **fusion** (union des collections).
- Déclenchement à l'ouverture et à chaque analyse ; anti-spam par hystérésis.

## Non-objectifs (YAGNI)

- Pas de notifications système/push (navigateur fermé) — hors de portée sans serveur.
- Pas d'alerte sur des tickers hors watchlist (une alerte évalue les données en cache).
- Import : pas de résolution fine des conflits de préférences (voir « Fusion »).

---

## Partie A — Alertes (onglet F7)

### A.1 État & modèle

Clé localStorage (profil-scopée) : `LS.alerts = "term_alerts"`. `let alerts = lsGet(LS.alerts, [])`.

Une alerte :
```js
{
  id,               // number (Date.now()+compteur)
  ticker,           // "AAPL"
  type,             // "price" | "global" | "rsi" | "change"
  direction,        // price/global: "above"|"below" ; rsi: "oversold"|"overbought" ; change: "move"
  value,            // number (prix, score, seuil RSI, ou % de variation)
  enabled,          // bool
  triggeredAt,      // ISO string quand la condition est vraie ; null sinon (hystérésis)
}
```
`saveAlerts()` : `lsSet(LS.alerts, alerts)`.

### A.2 Moteur d'évaluation — `checkAlerts()`

Parcourt les alertes `enabled` ; pour chaque, lit `entry = cache[ticker]` (si absent → ignorée) :

| type | valeur courante | condition vraie si |
|------|-----------------|--------------------|
| price | `entry.ind.price` | above : `price >= value` ; below : `price <= value` |
| global | `computeGlobalScore(entry)` | above : `>= value` ; below : `<= value` |
| rsi | `entry.ind.rsi` | oversold : `rsi <= value` ; overbought : `rsi >= value` |
| change | `entry.ind.changePct` | move : `Math.abs(changePct) >= value` |

Logique (hystérésis) :
- condition vraie **et** `triggeredAt == null` → **déclenchement** : `triggeredAt = now`, toast
  `🔔 <ticker> — <libellé condition>`, ajout à un journal de session `alertLog`.
- condition fausse **et** `triggeredAt != null` → **réarmement** : `triggeredAt = null`.
- Si au moins une alerte a changé d'état → `saveAlerts()`.

Une valeur manquante (`price`/`rsi`/`changePct` null) = condition non évaluable → considérée fausse
(réarme sans déclencher).

**Appel :** à la fin de `renderAll()` (couvre le chargement initial, chaque analyse de watchlist,
la fin d'un scan). L'hystérésis empêche tout spam à chaque re-render. Aucun appel pendant la boucle
de scan (elle utilise `skipRender`).

### A.3 UI — onglet F7

- **Barre d'onglets** : ajouter `<button class="tab" ... data-tab="alerts">F7 · ALERTES</button>`
  après F6.
- **Raccourci clavier** : ajouter `F7: "alerts"` à la map.
- **Bascule d'onglet** : ajouter `if (btn.dataset.tab === "alerts") renderAlerts();`.
- **Panneau** `#panel-alerts` avec :
  - **Formulaire d'ajout** : `<select>` ticker (watchlist) + `<select>` type + `<select>`
    direction (options adaptées au type via JS) + `<input number>` valeur + bouton « Ajouter ».
    Valeurs par défaut sensées (RSI survente → 30, surachat → 70 ; variation → 5).
  - **Liste des alertes** (`renderAlerts`) : une ligne par règle = libellé lisible
    (« AAPL — Prix ≥ 250 »), badge d'état (Active / 🔔 Déclenchée + heure), interrupteur
    activer/désactiver, bouton supprimer.
  - **Journal des déclenchements** (session) : les X derniers, du plus récent au plus ancien.
- `renderAlerts()` est appelé au chargement, sur bascule vers F7, et après tout ajout/suppression/
  toggle.

### A.4 Libellés (helper `alertLabel(a)`)

Construit une chaîne lisible selon type/direction/valeur, ex. :
- price/above → « Prix ≥ 250 » ; price/below → « Prix ≤ 200 »
- global/above → « Score global ≥ 70 » ; below → « ≤ 30 »
- rsi/oversold → « RSI ≤ 30 (survente) » ; overbought → « RSI ≥ 70 (surachat) »
- change/move → « Variation du jour ≥ 5 % »

---

## Partie B — Export / Import

### B.1 UI

Dans le header (`.header-top`, à côté de `btn-settings`) : deux boutons + un input fichier caché :
```html
<button class="btn btn-ghost" id="btn-export" title="Exporter mes données">⬇ Export</button>
<button class="btn btn-ghost" id="btn-import" title="Importer des données">⬆ Import</button>
<input type="file" id="import-file" accept="application/json" hidden>
```

### B.2 Export — `exportData()`

Construit un objet, le sérialise, déclenche un téléchargement via un `Blob` + `<a download>` :
```js
{
  app: "terminal-boursier",
  version: 1,
  exportedAt: new Date().toISOString(),
  profile: currentProfile,
  data: {
    watchlist, positions, tickerNames, filters, weightTech, alerts
  }
}
```
Le **cache de prix n'est pas inclus** (volumineux, re-téléchargeable). Nom du fichier :
`terminal-<profil>-<AAAA-MM-JJ>.json`.

### B.3 Import — `importData(file)` (fusion)

Lit le fichier (`FileReader`), `JSON.parse`, valide `parsed.app === "terminal-boursier"` et
`parsed.data`. Sinon → toast d'erreur, aucune modification.

Après une **confirmation** (`window.confirm`), **fusionne** :
- `watchlist` ← union (ajoute les tickers absents).
- `positions` ← pour chaque position importée `{ticker, qty, pru}`, `applyPurchase(ticker, pru,
  qty*pru)` (fusion par ticker en PRU moyen pondéré, comme un achat) ; ignore si `pru <= 0`.
- `tickerNames` ← `{ ...importés, ...actuels }` (l'actuel prime, l'import comble les manques).
- `alerts` ← union en dédupliquant les règles identiques (même `ticker+type+direction+value`) ;
  ré-attribue des `id` frais.
- **`weightTech` et `filters` : inchangés** (préférences d'affichage du profil courant ; la fusion
  ne les écrase pas).

Puis persiste (`lsSet` de chaque collection modifiée + `saveAlerts`) et `renderAll()` +
`renderAlerts()`. Toast de succès résumant ce qui a été fusionné (ex. « +3 tickers, +2 positions,
+1 alerte »).

---

## Découpage en unités

- **Alertes — moteur** : `LS.alerts`, `alerts`, `alertLog`, `saveAlerts`, `checkAlerts`,
  `alertLabel`, `newAlertId`. Appel de `checkAlerts()` dans `renderAll`.
- **Alertes — UI** : onglet/panneau F7, `renderAlerts`, formulaire + écouteurs, raccourci F7.
- **Export** : bouton + `exportData`.
- **Import** : bouton + input + `importData` (fusion).

## Gestion des erreurs / cas limites

| Cas | Comportement |
|-----|--------------|
| Alerte sur ticker sans données en cache | Ignorée (pas d'évaluation), pas d'erreur |
| Valeur manquante (RSI/prix null) | Condition fausse, réarme sans déclencher |
| Re-render répété, condition toujours vraie | Pas de re-déclenchement (hystérésis) |
| Import d'un fichier non conforme | Toast d'erreur, aucune donnée touchée |
| Import position PRU ≤ 0 | Position ignorée |
| Import annulé (confirm) | Aucune modification |
| Watchlist vide au formulaire d'alerte | Message « ajoutez d'abord un ticker à la watchlist » |

## Tests / vérification

- **Alerte prix** : créer « AAPL Prix ≤ (cours actuel + 10) » → à l'analyse, se déclenche (toast +
  état 🔔). Modifier le seuil au-dessus → réarmement (plus déclenchée).
- **Hystérésis** : re-render plusieurs fois → un seul toast tant que la condition reste vraie.
- **Types** : vérifier global, RSI (survente/surachat), variation du jour.
- **Persistance** : recharger → alertes conservées, état recalculé.
- **Export** : cliquer Export → fichier JSON téléchargé contenant watchlist/positions/alertes.
- **Import fusion** : sur un profil vide, importer le fichier → watchlist/positions/alertes
  ajoutées ; ré-importer → pas de doublon d'alerte, positions fusionnées (PRU pondéré).
- `py -m unittest discover tests` inchangé (aucune modif serveur).
