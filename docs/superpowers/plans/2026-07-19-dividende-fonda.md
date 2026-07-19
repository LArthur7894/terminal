# Section dividende dédiée (analyse fonda) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au dividende une section dédiée dans l'analyse fondamentale (rendement, taux de distribution, montant annuel, soutenabilité), sans changer le score.

**Architecture:** Ajout d'un champ `dividendRate` côté relais `server.py` (Python, testé), puis un bloc d'affichage « 💸 Dividende » dans le rendu fondamental front (`terminal-tout-en-un.html`), alimenté par des données déjà normalisées + le nouveau champ. Le calcul du score fondamental (`scoreHealth`) reste inchangé.

**Tech Stack:** Python stdlib (`server.py` + `unittest`), JS vanilla inline dans `terminal-tout-en-un.html` (pas de build), Chart.js déjà présent.

## Global Constraints

- Le **score fondamental ne change pas** : ne PAS toucher `scoreHealth`, les poids de piliers, ni le curseur tech/fonda. Le libellé du pilier reste « Santé + dividende ».
- Front : fichier unique `terminal-tout-en-un.html`, JS inline, pas de build — copier les patterns existants (`fnum`, `ffrac`, `esc`, `impact-grid`, variables CSS `--bg-raised`/`--text`/`--text-dim`).
- Formatage : rendement et distribution via `ffrac` (fraction → %) ; montant annuel via `fnum(...) + " " + devise`.
- Seuils de soutenabilité (payout `p`, fraction) : `p<0` → tendu (bénéfices négatifs) ; `0≤p<0.40` → largement couvert, marge de croissance ; `0.40≤p<0.60` → confortable ; `0.60≤p<0.80` → à surveiller ; `p≥0.80` → tendu, potentiellement non soutenable ; `p` absent → pas de ligne soutenabilité.
- Cas « pas de dividende » (rendement nul/absent ET montant nul/absent) → section affichée avec la seule ligne « Ne verse pas de dividende ».
- Le rendement ne doit plus apparaître dans la grille de métriques générique (déplacé dans la section).

## Verification approach (lire avant de commencer)

- **Serveur (Task 1)** : vrais tests `unittest`. Sur cette machine, `python`/`py` sont cassés → utiliser le chemin complet. Lancer un test précis :
  `PYTHONIOENCODING=utf-8 "C:\Users\amagu\AppData\Local\Programs\Python\Python311\python.exe" -m unittest tests.test_fundamentals.TestNormalizeFundamentals.test_NOM -v`
- **Front (Task 2)** : pas de harnais JS. Vérifier via (a) `node --check` sur le `<script>` extrait, (b) un petit harnais Node pour la fonction pure `dividendSustainability`, (c) inspection structurelle. La vérification navigateur de bout en bout (analyser un vrai titre à dividende) est faite par le contrôleur après intégration.

---

### Task 1: Serveur — champ `dividendRate`

Ajoute le montant annuel du dividende par action à la normalisation fondamentale.

**Files:**
- Modify: `server.py` (fonction `_normalize_fundamentals`)
- Test: `tests/test_fundamentals.py`

**Interfaces:**
- Consumes : `_pick(d, key)` existant.
- Produces : clé `dividendRate` (float ou `None`) dans le dict renvoyé par `_normalize_fundamentals`.

- [ ] **Step 1: Écrire les tests (échec attendu)**

Dans `tests/test_fundamentals.py`, ajouter ces deux méthodes à la classe `TestNormalizeFundamentals` :

```python
    def test_dividend_rate_extracted(self):
        node = self._sample_node()
        node["summaryDetail"]["dividendRate"] = {"raw": 0.96, "fmt": "0.96"}
        out = server._normalize_fundamentals("AAPL", node)
        self.assertEqual(out["dividendRate"], 0.96)

    def test_dividend_rate_fallback_and_absent(self):
        # repli sur trailingAnnualDividendRate quand dividendRate absent
        node = self._sample_node()
        node["summaryDetail"]["trailingAnnualDividendRate"] = {"raw": 0.9, "fmt": "0.90"}
        out = server._normalize_fundamentals("AAPL", node)
        self.assertEqual(out["dividendRate"], 0.9)
        # absent des deux → None
        out2 = server._normalize_fundamentals("MC.PA", {"price": {"currency": "EUR"}})
        self.assertIsNone(out2["dividendRate"])
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run :
```
PYTHONIOENCODING=utf-8 "C:\Users\amagu\AppData\Local\Programs\Python\Python311\python.exe" -m unittest tests.test_fundamentals.TestNormalizeFundamentals.test_dividend_rate_extracted tests.test_fundamentals.TestNormalizeFundamentals.test_dividend_rate_fallback_and_absent -v
```
Attendu : FAIL (`KeyError: 'dividendRate'` — la clé n'existe pas encore).

- [ ] **Step 3: Implémenter le champ**

Dans `server.py`, fonction `_normalize_fundamentals`, ajouter cette ligne dans le dict retourné, juste après la ligne `"payoutRatio": _pick(summary, "payoutRatio"),` :

```python
        "dividendRate": _pick(summary, "dividendRate") or _pick(summary, "trailingAnnualDividendRate"),
```

- [ ] **Step 4: Lancer les tests → succès attendu**

Run (même commande qu'au Step 2). Attendu : `OK` (2 tests passent).

Puis lancer toute la suite pour non-régression :
```
PYTHONIOENCODING=utf-8 "C:\Users\amagu\AppData\Local\Programs\Python\Python311\python.exe" -m unittest discover -s tests -p "test_*.py" -v
```
Attendu : `OK` (tous les tests, dont les 3 existants, passent).

- [ ] **Step 5: Commit**

```bash
git add server.py tests/test_fundamentals.py
git commit -m "feat(fonda): champ dividendRate (montant annuel du dividende) côté relais"
```

---

### Task 2: Frontend — section dividende dédiée

Ajoute le bloc « 💸 Dividende » au rendu fondamental, la fonction de soutenabilité, retire le rendement de la grille générique, et met à jour le texte de synthèse.

**Files:**
- Modify: `terminal-tout-en-un.html` — nouvelle fonction `dividendSustainability` (à placer juste avant `buildFundamentalStatsHtml`), corps de `buildFundamentalStatsHtml`, corps de `buildFundamentalText`, section CSS de l'analyse fondamentale.

**Interfaces:**
- Consumes : `f.dividendYield`, `f.payoutRatio`, `f.dividendRate` (Task 1), `f.currency`, helpers `fnum`/`ffrac`/`esc`.
- Produces : `dividendSustainability(payout) -> string|null`.

- [ ] **Step 1: Ajouter la fonction de soutenabilité (avec harnais de test Node)**

Dans `terminal-tout-en-un.html`, juste avant `function buildFundamentalStatsHtml`, insérer :

```js
// Lecture qualitative de la soutenabilité du dividende à partir du taux de distribution.
// payout = fraction (0.45 = 45 %). Renvoie null si non calculable.
function dividendSustainability(payout) {
  if (payout == null || !isFinite(payout)) return null;
  if (payout < 0) return "tendu (bénéfices négatifs)";
  if (payout < 0.40) return "largement couvert, marge de croissance";
  if (payout < 0.60) return "confortable";
  if (payout < 0.80) return "à surveiller";
  return "tendu, potentiellement non soutenable";
}
```

Vérifier la logique avec un harnais Node jetable (copier la fonction dans un fichier `.js` temporaire de scratch, l'exécuter, coller la sortie dans le rapport, puis supprimer le fichier — ne pas le committer) :

```js
const cases = [[null,null],[NaN,null],[-0.1,"tendu (bénéfices négatifs)"],[0.3,"largement couvert, marge de croissance"],[0.5,"confortable"],[0.7,"à surveiller"],[0.9,"tendu, potentiellement non soutenable"]];
for (const [in_, exp] of cases) console.log(dividendSustainability(in_) === exp ? "PASS" : `FAIL ${in_} -> ${dividendSustainability(in_)} (attendu ${exp})`);
```
Attendu : 7× PASS.

- [ ] **Step 2: Insérer le bloc dividende dans `buildFundamentalStatsHtml`**

Dans `buildFundamentalStatsHtml`, juste avant le `return \`<div class="fund-block">` final, construire le bloc :

```js
  // --- Bloc dividende dédié ---
  const paysDividend = (f.dividendYield != null && isFinite(f.dividendYield) && f.dividendYield > 0)
                    || (f.dividendRate != null && isFinite(f.dividendRate) && f.dividendRate > 0);
  let dividendBlock;
  if (!paysDividend) {
    dividendBlock = `<div class="fund-dividend"><h3 class="fund-dividend-title">💸 Dividende</h3>`
      + `<p class="fund-dividend-none">Ne verse pas de dividende.</p></div>`;
  } else {
    const sust = dividendSustainability(f.payoutRatio);
    const amount = (f.dividendRate != null && isFinite(f.dividendRate))
      ? fnum(f.dividendRate) + (f.currency ? " " + esc(f.currency) : "")
      : "—";
    dividendBlock = `<div class="fund-dividend"><h3 class="fund-dividend-title">💸 Dividende</h3>`
      + `<dl class="impact-grid fund-dividend-grid">`
      + `<div><dt>Rendement</dt><dd>${ffrac(f.dividendYield)}</dd></div>`
      + `<div><dt>Taux de distribution</dt><dd>${ffrac(f.payoutRatio)}</dd></div>`
      + `<div><dt>Montant annuel / action</dt><dd>${amount}</dd></div>`
      + `</dl>`
      + (sust ? `<p class="fund-dividend-sust">Soutenabilité : ${esc(sust)}.</p>` : "")
      + `</div>`;
  }
```

Puis, dans le template de retour, insérer `${dividendBlock}` entre `${pillars}` et `${grid}` :

```js
    ${pillars}
    ${dividendBlock}
    ${grid}
```

- [ ] **Step 3: Retirer le rendement de la grille générique**

Dans le tableau `metrics` de `buildFundamentalStatsHtml`, supprimer entièrement cette ligne :

```js
    ["Rendement dividende", ffrac(f.dividendYield), ""],
```

- [ ] **Step 4: Mettre à jour le texte de synthèse `buildFundamentalText`**

Dans `buildFundamentalText`, supprimer cette ligne (le dividende quitte la phrase Santé) :

```js
  if (f.dividendYield !== null) healthBits.push(`rendement du dividende ${ffrac(f.dividendYield)}`);
```

Puis, juste après le bloc `if (healthBits.length) parts.push(...)` et avant le `parts.push(\`Score fondamental global ...\`)` final, ajouter la phrase dédiée :

```js
  const paysDiv = (f.dividendYield !== null && f.dividendYield > 0) || (f.dividendRate != null && f.dividendRate > 0);
  if (paysDiv) {
    const sustText = dividendSustainability(f.payoutRatio);
    parts.push(`Dividende : rendement ${ffrac(f.dividendYield)}, distribution ${ffrac(f.payoutRatio)}${sustText ? `, soutenabilité ${sustText}` : ""}.`);
  }
```

- [ ] **Step 5: Ajouter le CSS du bloc dividende**

Dans le bloc CSS `/* ===== ANALYSE ===== */` (chercher le commentaire `--- Bloc analyse fondamentale ---`), ajouter :

```css
.fund-dividend { margin: 10px 0; padding: 10px 12px; background: var(--bg-raised); border-radius: 6px; }
.fund-dividend-title { font-size: 13px; margin: 0 0 8px; color: var(--text); }
.fund-dividend-none { color: var(--text-dim); font-size: 13px; margin: 0; }
.fund-dividend-sust { font-size: 12px; color: var(--text-dim); margin: 6px 0 0; }
```

- [ ] **Step 6: Vérifier (syntaxe + structure)**

1. `node --check` sur le `<script>` extrait → exit 0.
2. Inspection : (a) `["Rendement dividende", ...]` n'existe plus dans `metrics` ; (b) `${dividendBlock}` est bien entre `${pillars}` et `${grid}` ; (c) `dividendSustainability` est défini une seule fois ; (d) le healthBits dividende est retiré et la phrase « Dividende : … » ajoutée dans `buildFundamentalText` ; (e) les 4 règles CSS `.fund-dividend*` sont présentes.
3. `grep` : `dividendYield` n'apparaît plus dans le tableau `metrics`.

- [ ] **Step 7: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(fonda): section dividende dédiée (rendement, distribution, montant, soutenabilité)"
```

---

## Self-Review (rempli)

**Spec coverage :**
- §1 Donnée serveur `dividendRate` (+ repli + test) → Task 1.
- §2 Section d'affichage (bloc après piliers, rendement/distribution/montant, soutenabilité, cas pas-de-dividende, retrait de la grille) → Task 2 Steps 2/3/5.
- §3 Texte de synthèse (phrase dédiée, retrait de Santé) → Task 2 Step 4.
- §4 Score inchangé → garanti par Global Constraints (aucune tâche ne touche `scoreHealth`/poids/curseur).
- Critères 1–5 → Task 1 (critère 5) ; Task 2 + vérif navigateur contrôleur (critères 1–4, dont score identique).

**Placeholder scan :** aucun TODO/TBD ; code complet à chaque étape.

**Type consistency :** `dividendSustainability(payout)` renvoie `string|null`, consommé de façon cohérente (Step 2 : `sust ? ... : ""` ; Step 4 : `sustText ? ... : ""`). `dividendRate` est `float|None` côté serveur → `number|null` côté front, testé `!= null && isFinite`. Helpers `fnum`/`ffrac`/`esc` utilisés conformément à leurs signatures existantes.
