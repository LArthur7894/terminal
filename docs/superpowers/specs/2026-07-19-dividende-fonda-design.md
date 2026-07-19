# Spec — Section dividende dédiée dans l'analyse fondamentale

**Date :** 2026-07-19
**Statut :** validé, prêt pour le plan d'implémentation

## Problème

L'analyse fondamentale traite le dividende de façon minimale et dispersée :
- `dividendYield` (rendement) est affiché noyé dans la grille de métriques et
  compté comme petit bonus dans le pilier « Santé + dividende ».
- `payoutRatio` (taux de distribution) est récupéré par `server.py` mais **jamais
  affiché ni utilisé**.
- Aucun montant annuel du dividende, aucune lecture de soutenabilité.

## Objectif

Donner au dividende une **section dédiée** dans l'analyse fondamentale, purement
additive à l'affichage. Le **calcul du score fondamental ne change pas**.

## Conception détaillée

### 1. Donnée à ajouter côté serveur

Ajouter un champ `dividendRate` (montant annuel du dividende par action, dans la
devise du titre) dans `_normalize_fundamentals` de `server.py` :

- Source : `summaryDetail.dividendRate`, avec repli sur
  `summaryDetail.trailingAnnualDividendRate` si le premier est absent.
- Extraction via l'utilitaire `_pick` existant (gère `{raw}`/scalaire/absent → None).
- Couvert par un test unitaire dans `tests/test_fundamentals.py` (présent et absent).

`dividendYield` et `payoutRatio` sont déjà normalisés — inchangés.

### 2. Section d'affichage (`buildFundamentalStatsHtml`)

Nouveau bloc « 💸 Dividende », placé **juste après les piliers**, avant la grille
de métriques générique. Contenu :

- **Rendement** : `ffrac(f.dividendYield)`.
- **Taux de distribution** : `ffrac(f.payoutRatio)`.
- **Montant annuel / action** : `dividendRate` formaté avec la devise du titre
  (réutiliser le formatage numérique existant + `f.currency`).
- **Lecture de soutenabilité** : texte qualitatif dérivé de `payoutRatio` (`p`) :
  - `p < 0` ou bénéfices négatifs → « tendu (bénéfices négatifs) »
  - `0 ≤ p < 0.40` → « largement couvert, marge de croissance »
  - `0.40 ≤ p < 0.60` → « confortable »
  - `0.60 ≤ p < 0.80` → « à surveiller »
  - `p ≥ 0.80` → « tendu, potentiellement non soutenable »
  - `payoutRatio` absent → soutenabilité non affichée (ou « — »).

**Cas « pas de dividende »** : si `dividendYield` est nul/absent **et**
`dividendRate` nul/absent, la section affiche une seule ligne « Ne verse pas de
dividende ». La section reste visible (montre que le point a été vérifié).

Le « Rendement dividende » est **retiré de la grille de métriques générique**
(`metrics`) pour éviter le doublon ; il vit désormais dans cette section.

### 3. Texte de synthèse (`buildFundamentalText`)

- Ajouter une phrase dédiée : « Dividende : rendement X %, distribution Y %,
  soutenabilité Z. » (omise proprement si aucune donnée dividende).
- Retirer le dividende de la phrase « Santé financière » (qui redevient
  dette + liquidité uniquement).

### 4. Score — inchangé

Le calcul du score fondamental n'est **pas** modifié :
- `scoreHealth` conserve son bonus dividende actuel.
- Le libellé du pilier reste « Santé + dividende » (honnête, puisque le bonus y
  demeure techniquement).
- Aucune modification des poids de piliers ni du curseur tech/fonda.

## Hors périmètre

- Date de détachement (ex-dividend date).
- Historique / croissance du dividende, rendement moyen sur 5 ans.
- Tout changement du score fondamental ou de sa pondération.

## Critères de réussite

1. Un titre versant un dividende (ex. MC.PA, AAPL) affiche la section dédiée avec
   rendement, taux de distribution, montant annuel (avec devise) et soutenabilité.
2. Un titre sans dividende affiche « Ne verse pas de dividende ».
3. Le rendement n'apparaît plus en double (retiré de la grille générique).
4. Le score fondamental d'un titre donné est **identique** avant/après (aucune
   régression de score) — le pilier « Santé + dividende » garde sa valeur.
5. `server.py` renvoie `dividendRate` (présent quand Yahoo le fournit, `null`
   sinon), couvert par un test.
