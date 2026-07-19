# Spec — Onglet « F10 · MONDE » (macro & actualité)

**Date :** 2026-07-19
**Statut :** validé, prêt pour le plan d'implémentation

## Problème / Objectif

L'utilisateur prépare des entretiens en banque d'investissement et veut un onglet
qui rassemble **les grandes informations financières mondiales**, avec une lecture
de **ce qui se passe et de l'impact sur les actions**. L'app n'a **ni IA générative
ni flux éditorial payant** : la partie « explication » vient donc de **notes
pédagogiques écrites d'avance** (relations macro→actions), affichées à côté de
**données de marché en direct** et d'un **fil d'actualités** gratuit (Yahoo).

## Contrainte d'architecture

**Zéro changement serveur, zéro nouvelle dépendance, zéro clé API.** Tout est
frontend, en réutilisant les endpoints existants :
- `/api/history?symbol=X` → cours (les 2 dernières clôtures donnent la variation du jour).
- `/api/news?symbol=X` → actualités récentes (fusion de quelques symboles phares).

Ces endpoints acceptent déjà indices (`^GSPC`), devises (`EURUSD=X`), futures
(`CL=F`), crypto (`BTC-USD`), indice dollar (`DX-Y.NYB`) — tous ≤ 15 caractères,
sûrs après `.upper()`. La couche multi-devises a déjà prouvé le support des
symboles à `=`.

## Conception détaillée

### 1. Nouvel onglet

- 10e onglet dans la barre : `F10 · MONDE`, `data-tab="monde"`, panneau
  `#panel-monde`, câblé comme les autres (bascule + rendu à l'ouverture).
- Rendu par une fonction `renderMonde()`, ajoutée à la logique d'onglets ; premier
  chargement des données déclenché à l'ouverture de l'onglet (pas au démarrage).

### 2. Panorama de marché en direct

Grille groupée. Chaque instrument affiche : libellé lisible, dernier cours, et
**variation du jour en %** (couleur vert/rouge), calculée
`(closes[0] - closes[1]) / closes[1] × 100`.

Groupes et symboles Yahoo :
- **Indices** : S&P 500 `^GSPC`, Nasdaq `^IXIC`, Dow Jones `^DJI`, CAC 40 `^FCHI`,
  DAX `^GDAXI`, FTSE 100 `^FTSE`, Nikkei 225 `^N225`.
- **Taux & volatilité** : US 10 ans `^TNX` (valeur = niveau du rendement), VIX `^VIX`.
- **Devises** : EUR/USD `EURUSD=X`, USD/JPY `USDJPY=X`, indice dollar `DX-Y.NYB`.
- **Matières premières** : pétrole WTI `CL=F`, or `GC=F`.
- **Crypto** : Bitcoin `BTC-USD`.
- **Rotation sectorielle** : 11 ETF secteurs US, **triés du plus fort au plus faible
  du jour** — Technologie `XLK`, Énergie `XLE`, Finance `XLF`, Santé `XLV`, Conso
  discrétionnaire `XLY`, Conso de base `XLP`, Industrie `XLI`, Services publics
  `XLU`, Matériaux `XLB`, Immobilier `XLRE`, Communication `XLC`.

### 3. Fil d'actus monde

- Appel `/api/news` sur un petit ensemble de symboles phares (`^GSPC`, `^IXIC`,
  `^DJI`), résultats **fusionnés, dédupliqués par titre**, triés par date
  décroissante, plafonnés (~12 items).
- Chaque item : titre (lien vers la source), éditeur, date. Réutilise le style
  `.news-list` existant.

### 4. Notes d'impact macro→actions (cœur « entretien »)

Chaque groupe (ou instrument clé) porte une note pédagogique **statique** « Pourquoi
ça compte pour les actions », toujours affichée (valeur de référence / anti-sèche).
Chaque note contient les deux sens (hausse/baisse) ; **le sens correspondant au
mouvement du jour est mis en avant** quand |variation| dépasse un seuil (≈ 1 % pour
actions/indices/matières premières ; seuils propres au VIX et au taux 10 ans).

Exemples de contenu (rédaction fixe, définie au plan) :
- Taux 10 ans ↑ → pression sur croissance/tech (actualisation des flux futurs),
  soutien aux banques (marges d'intérêt).
- Pétrole ↑ → favorable à l'énergie, défavorable au transport aérien / à la conso.
- VIX ↑ → aversion au risque, repli des actions, prime de risque plus élevée.
- Indice dollar ↑ → vent contraire pour les multinationales US et les émergents.

### 5. Technique

- Récupération **concurrente** via le pool existant `runPool` (concurrence modérée,
  ex. 6) sur tous les symboles à l'ouverture / au clic « Rafraîchir ».
- **Cache mémoire** (`mondeCache`), non persisté. **Pas d'auto-refresh** ; bouton
  « Rafraîchir » + horodatage « dernière mise à jour ». Le bouton se désactive
  brièvement après un refresh pour ménager Yahoo.
- **Dégradation** : un symbole en échec affiche « — » et n'interrompt pas la grille ;
  le fil d'actus en échec affiche un message clair.

## Hors périmètre

- Pas d'IA générative ni de flux payant.
- Pas de nouvel endpoint serveur (réutilisation de `/api/history` et `/api/news`).
- Pas d'alertes macro, pas d'auto-refresh, pas d'historique long des indicateurs,
  pas de variation en points de base dédiée (variation en % uniforme).

## Critères de réussite

1. L'onglet `F10 · MONDE` s'ouvre et affiche la grille groupée avec cours + variation
   du jour colorée pour les instruments disponibles.
2. La rotation sectorielle est triée du plus fort au plus faible du jour.
3. Le fil d'actus affiche des titres cliquables récents, dédupliqués.
4. Chaque groupe porte sa note d'impact ; le sens du jour est mis en avant lors d'un
   mouvement marqué.
5. Un symbole indisponible affiche « — » sans casser le reste ; l'onglet ne fait
   aucun appel réseau tant qu'il n'est pas ouvert.
6. Aucun changement de `server.py`, aucune nouvelle dépendance.
