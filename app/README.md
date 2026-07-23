# Structure du terminal

L'app était un seul fichier de 6 800 lignes (`terminal-tout-en-un.html`). Elle est
découpée ici en modules ; `index.html` ne contient plus que le balisage et charge
ces fichiers dans l'ordre.

## L'ordre de chargement est un contrat, pas une préférence

Ce sont des scripts classiques, pas des modules ES. Conséquence à connaître avant
de déplacer quoi que ce soit :

- Les `let`/`const` de premier niveau sont **partagés** entre fichiers, dans l'ordre
  de chargement.
- Le **hoisting des fonctions ne traverse pas les fichiers**. Dans le mono-fichier,
  du code de la ligne 1 200 pouvait appeler une fonction définie à la ligne 2 900 ;
  réparti en fichiers, c'est un `ReferenceError` au chargement.

Donc : **tout code exécuté au chargement doit vivre dans un fichier chargé après
celui qui définit les fonctions qu'il appelle.** Les appels différés (gestionnaires
d'événements, `setTimeout`, corps des tests) ne sont pas concernés — ils sont
résolus à l'exécution.

C'est ce qui dicte l'ordre ci-dessous ; en particulier `04-etat.js` vient après
`02` et `03` parce que sa migration du cache recalcule indicateurs et scores.

| Fichier | Contenu |
|---|---|
| `01-base.js` | Profils, constantes, `lsGet`/`lsSet`, formatage, toasts |
| `02-indicateurs.js` | Indicateurs techniques et score technique (fonctions pures) |
| `03-fondamentaux.js` | Barèmes fondamentaux, score fondamental et global |
| `04-etat.js` | État du profil, migration du cache, IndexedDB, alertes |
| `05-bot.js` | Bot de paper-trading v2 |
| `06-revue.js` | Revue de portefeuille |
| `07-donnees.js` | Change, appels `/api/`, analyse d'un ticker, autocomplétion |
| `08-` à `14-ui-*.js` | Rendu et câblage, un fichier par groupe d'onglets |
| `99-init.js` | Auto-tests et amorçage |

Ajouter un fichier : lui donner un numéro cohérent avec ses dépendances, l'insérer
**au bon rang** dans `index.html` *et* dans `SHELL` de `sw.js`, terminer le fichier par
`MODULES_CHARGES.push("<nom>")` et ajouter ce nom à `MODULES_ATTENDUS` (`99-init.js`).

### Le filet de sécurité

Chaque module signe `MODULES_CHARGES` sur sa **dernière ligne**, et `99-init.js` compare
cette liste à `MODULES_ATTENDUS` **avant tout rendu**. Raison d'être : un script classique
qui lève au chargement s'interrompt *sans bruit* — les fichiers suivants se chargent, l'app
paraît vivante, et tout ce qui suivait l'erreur n'existe simplement pas.

C'est arrivé pour de vrai : le bot a cessé de fonctionner après le découpage parce que
`renderBot()` lisait `botNextRunAt` déclaré plus bas dans le même fichier. Le test
`bot.started && botNextRunAt` court-circuitait, donc la panne était **invisible** tant que
le bot n'était pas démarré — verte en test, cassée chez l'utilisateur. Un bandeau rouge
nomme désormais le module fautif.

## Données

Une seule requête réseau par ticker (`/api/history`, relayée par `server.py` vers
Yahoo Finance). Tous les indicateurs — RSI 14 de Wilder, SMA 50/200, MACD, Bollinger,
range 52 semaines, score — sont calculés localement, sans autre appel.

## Tests

Ouvrir l'app avec `?selftest=1` : les trois harnais s'exécutent et le bilan
s'affiche par-dessus la page. Ce mode travaille sur un profil dédié
(`__selftest__`) et ne touche à aucune donnée réelle.

```bash
python -X utf8 -m unittest discover -s tests
```

Le service worker sert les fichiers de l'app en **réseau d'abord** : en ligne, on a
toujours la version déployée, le cache ne sert qu'au hors-ligne. Incrémenter `CACHE`
dans `sw.js` reste utile quand la liste `SHELL` change, pour purger l'ancien cache.
