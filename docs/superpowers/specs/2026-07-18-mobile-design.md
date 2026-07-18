# Adaptation mobile — Design

**Date :** 2026-07-18
**Statut :** Validé (design)

## Objectif

Rendre le terminal **agréable à utiliser sur téléphone**, sans rien changer à la version PC.
Aujourd'hui : responsive quasi inexistant, tableaux larges qui débordent.

## Décision validée

Format **cartes** pour les tableaux sur mobile (comme les meilleures applis boursières) :
chaque ligne devient une carte lisible verticalement, plus de scroll horizontal.

## Approche : 100 % CSS + attributs

- **Zéro changement de comportement / de rendu sur desktop** : tout est encapsulé dans un
  `@media (max-width: 640px)`.
- Les rendus JS gagnent seulement des **attributs** (`data-label`, classes `card-title`,
  `mobile-hide`) qui sont **inertes sur desktop** et servent uniquement au CSS mobile.

## Architecture

### 1. Attributs ajoutés dans les rendus (inertes sur desktop)

- **`data-label="Libellé"`** sur chaque `<td>` de donnée → le CSS mobile l'affiche en étiquette
  (`td[data-label]::before { content: attr(data-label) }`).
- **`card-title`** sur la cellule ticker → titre de la carte (gros, gras) sur mobile.
- **`mobile-hide`** sur les colonnes secondaires de la watchlist (masquées sur mobile pour des
  cartes compactes) : SMA 50, SMA 200, RSI 14, Range 52 sem., MàJ.

Tables concernées : `renderWatchlist` (F1), `renderMarketTable` (F5), `renderPositions` (F2).

Colonnes **gardées** sur mobile :
- Watchlist : Ticker (titre), Cours, Var. %, Score, Fonda, Global, Signal, Actions.
- Marché : Rang, Ticker (titre), Entreprise, Cours, Score, Fonda, Global, Signal, Perf 1 an, Actions.
- Positions : toutes (Ticker titre, Qté, PRU, Cours, Valeur, P&L, P&L %, Actions).

### 2. CSS mobile — `@media (max-width: 640px)`

- **Cartes** : `.data-table thead { display:none }` ; `.data-table, tbody, tr, td { display:block }` ;
  `.table-wrap { border:none; background:transparent; overflow:visible }` ;
  chaque `tr` = carte (fond `--bg-panel`, bordure `--border`, radius, marge, padding) ;
  chaque `td` = ligne flex `space-between` avec l'étiquette à gauche (`::before`) et la valeur à droite.
- **Titre de carte** : `.data-table td.card-title` (gros, gras, séparateur en dessous, pas d'étiquette).
- **Colonnes masquées** : `.data-table td.mobile-hide { display:none }`.
- **Actions** : `.data-table td.actions-col` en pleine largeur, boutons alignés à gauche, cibles
  tactiles plus grandes.
- **État vide** (`td[colspan]`) : centré, lisible.

### 3. Confort tactile / lisibilité (mobile)

- **Onglets** : déjà `overflow-x:auto` ; ajouter le défilement tactile fluide et masquer la barre
  de scroll ; padding un peu plus grand pour le tap.
- **Formulaires** (ajout ticker, alertes, filtres, réglages) : champs/boutons en **pleine largeur**,
  empilés, hauteur de tap ≥ 40 px.
- **Curseur de pondération** : pleine largeur (déjà le cas).
- **Base** : `main` padding réduit latéralement, `font-size` de base légèrement agrandie,
  en-tête compact (déjà empilé < 600px).
- **Graphiques** : `canvas` déjà responsive (Chart.js) ; s'assurer que les conteneurs ne forcent
  pas une largeur fixe.

## Gestion des erreurs / cas limites

| Cas | Comportement |
|-----|--------------|
| Desktop (> 640px) | Aucun changement, tableaux classiques |
| Cellule sans `data-label` (ticker, actions) | Pas d'étiquette `::before` (sélecteur `td[data-label]`) |
| Ligne d'état vide (colspan) | Affichée centrée comme un message |
| Très petit écran (< 360px) | Cartes restent lisibles (flex + wrap si besoin) |

## Vérification

- **Capture en taille téléphone** (375×812) : Dashboard (cartes watchlist), Marché, Positions,
  Analyse — vérifier lisibilité, pas de débordement horizontal, onglets défilables.
- Vérifier via CSS calculé qu'en mode mobile `tr` est en `display:block` (carte) et qu'en desktop
  le tableau reste `table`.
- **Non-régression desktop** : à ≥ 1000px, watchlist/marché/positions inchangés.
- `py -m unittest discover tests` inchangé (aucune modif serveur).

## Non-objectifs

- Pas de refonte de la navigation (on garde les onglets).
- Pas d'app native ; c'est du responsive web (complémentaire à la PWA déjà faite).
