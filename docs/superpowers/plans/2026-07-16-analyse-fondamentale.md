# Analyse fondamentale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une analyse fondamentale (PER, capitalisation, dividende, marges, ROE, dette, croissance) avec un score fondamental /100, un score cumulé technique+fondamental à pondération réglable, et un affichage détaillé dans l'onglet F4, sans retirer l'analyse technique existante.

**Architecture:** Le serveur `server.py` gagne une route `/api/fundamentals` qui récupère un cookie+crumb Yahoo (mis en cache), interroge `quoteSummary` et renvoie un JSON normalisé. Le client (`terminal-tout-en-un.html`) récupère ces données lors de l'analyse, calcule un score fondamental à 4 piliers, un score global pondéré, et enrichit la carte de l'onglet Analyse.

**Tech Stack:** Python 3.11 (bibliothèque standard uniquement, `http.server`, `urllib`, `threading`, `unittest`), HTML/CSS/JS vanilla (fichier unique, sans build), Chart.js déjà présent. Source de données : Yahoo Finance (gratuit, sans clé).

## Global Constraints

- **Zéro dépendance externe** : `requirements.txt` doit rester vide de paquets ; n'utiliser que la bibliothèque standard Python. Tests serveur avec `unittest` (stdlib).
- **Pas de build front** : tout reste dans le fichier unique `terminal-tout-en-un.html` (JS inline). Suivre les conventions existantes (français, `esc()` pour tout contenu injecté, toasts pour les erreurs).
- **Source Yahoo, gratuite, sans clé.** 1 requête fondamentale par ticker analysé, mise en cache comme l'historique.
- **Robustesse « zéro faille »** : une panne fondamentale (ETF sans données, réseau, crumb expiré) ne doit JAMAIS casser l'analyse technique. `fund`/`fundScore` valent `null` et l'UI affiche « indisponible ».
- **Interpréteur Python sur cette machine** : la commande est `py` (Python 3.11.5), pas `python`.
- **Descriptif, pas de conseil** : les textes restent factuels, jamais un conseil en investissement (comme `buildAnalysisText`).
- Encodage des fichiers en UTF-8.

---

### Task 1: Serveur — normalisation des fondamentaux (fonction pure)

Fonction pure qui transforme la réponse brute Yahoo `quoteSummary` en objet plat. Testable hors ligne avec un échantillon, sans réseau.

**Files:**
- Modify: `server.py` (ajouter les constantes + la fonction `_normalize_fundamentals` après le bloc de constantes, avant la classe `Handler`)
- Test: `tests/test_fundamentals.py` (créer)

**Interfaces:**
- Produces:
  - `_pick(d: dict, key: str) -> float | None` — extrait une valeur numérique d'un champ Yahoo qui peut être soit un nombre, soit un objet `{"raw": ..., "fmt": ...}`, soit absent.
  - `_normalize_fundamentals(sym: str, node: dict) -> dict` — `node` est `quoteSummary.result[0]` ; renvoie le dict normalisé décrit dans la spec (clés : `symbol, currency, marketCap, trailingPE, forwardPE, pegRatio, priceToBook, enterpriseToEbitda, priceToSales, trailingEps, forwardEps, profitMargins, operatingMargins, grossMargins, returnOnEquity, returnOnAssets, revenueGrowth, earningsGrowth, debtToEquity, currentRatio, quickRatio, dividendYield, payoutRatio, recommendationKey, targetMeanPrice, longName`). Valeurs absentes → `None`.

- [ ] **Step 1: Write the failing test**

Créer `tests/test_fundamentals.py` :

```python
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server


class TestNormalizeFundamentals(unittest.TestCase):
    def _sample_node(self):
        # Extrait réaliste de quoteSummary.result[0] (objets {raw, fmt} comme Yahoo).
        return {
            "price": {
                "currency": "USD",
                "longName": "Apple Inc.",
                "marketCap": {"raw": 3200000000000, "fmt": "3.2T"},
            },
            "summaryDetail": {
                "trailingPE": {"raw": 28.5, "fmt": "28.50"},
                "forwardPE": {"raw": 25.1, "fmt": "25.10"},
                "dividendYield": {"raw": 0.005, "fmt": "0.50%"},
                "payoutRatio": {"raw": 0.16, "fmt": "16.00%"},
                "priceToSalesTrailing12Months": {"raw": 7.8, "fmt": "7.80"},
            },
            "defaultKeyStatistics": {
                "pegRatio": {"raw": 2.1, "fmt": "2.10"},
                "priceToBook": {"raw": 45.2, "fmt": "45.20"},
                "enterpriseToEbitda": {"raw": 21.0, "fmt": "21.00"},
                "trailingEps": {"raw": 6.4, "fmt": "6.40"},
                "forwardEps": {"raw": 7.1, "fmt": "7.10"},
            },
            "financialData": {
                "profitMargins": {"raw": 0.25, "fmt": "25.00%"},
                "operatingMargins": {"raw": 0.30, "fmt": "30.00%"},
                "grossMargins": {"raw": 0.45, "fmt": "45.00%"},
                "returnOnEquity": {"raw": 1.47, "fmt": "147.00%"},
                "returnOnAssets": {"raw": 0.22, "fmt": "22.00%"},
                "revenueGrowth": {"raw": 0.08, "fmt": "8.00%"},
                "earningsGrowth": {"raw": 0.11, "fmt": "11.00%"},
                "debtToEquity": {"raw": 150.0, "fmt": "150.00"},
                "currentRatio": {"raw": 1.0, "fmt": "1.00"},
                "quickRatio": {"raw": 0.9, "fmt": "0.90"},
                "recommendationKey": "buy",
                "targetMeanPrice": {"raw": 250.0, "fmt": "250.00"},
            },
        }

    def test_extracts_all_fields(self):
        out = server._normalize_fundamentals("AAPL", self._sample_node())
        self.assertEqual(out["symbol"], "AAPL")
        self.assertEqual(out["currency"], "USD")
        self.assertEqual(out["longName"], "Apple Inc.")
        self.assertEqual(out["marketCap"], 3200000000000.0)
        self.assertEqual(out["trailingPE"], 28.5)
        self.assertEqual(out["pegRatio"], 2.1)
        self.assertEqual(out["priceToBook"], 45.2)
        self.assertEqual(out["profitMargins"], 0.25)
        self.assertEqual(out["returnOnEquity"], 1.47)
        self.assertEqual(out["debtToEquity"], 150.0)
        self.assertEqual(out["dividendYield"], 0.005)
        self.assertEqual(out["recommendationKey"], "buy")

    def test_missing_fields_become_none(self):
        node = {"price": {"currency": "EUR"}}  # tout le reste absent
        out = server._normalize_fundamentals("MC.PA", node)
        self.assertEqual(out["symbol"], "MC.PA")
        self.assertEqual(out["currency"], "EUR")
        self.assertIsNone(out["trailingPE"])
        self.assertIsNone(out["profitMargins"])
        self.assertIsNone(out["debtToEquity"])
        self.assertIsNone(out["recommendationKey"])

    def test_pick_handles_raw_and_scalar_and_bad(self):
        self.assertEqual(server._pick({"x": {"raw": 12.5}}, "x"), 12.5)
        self.assertEqual(server._pick({"x": 3}, "x"), 3.0)
        self.assertIsNone(server._pick({"x": {"fmt": "N/A"}}, "x"))  # pas de raw
        self.assertIsNone(server._pick({}, "x"))
        self.assertIsNone(server._pick({"x": None}, "x"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `py -m unittest tests.test_fundamentals -v`
Expected: FAIL avec `AttributeError: module 'server' has no attribute '_normalize_fundamentals'` (ou `_pick`).

- [ ] **Step 3: Write minimal implementation**

Dans `server.py`, ajouter après le bloc de constantes (après la ligne `USER_AGENT = ...`, avant `class Handler`) :

```python
# Endpoint fondamental Yahoo (quoteSummary). Nécessite cookie + crumb (voir Task 2).
FUND_URL = ("https://query1.finance.yahoo.com/v10/finance/quoteSummary/{sym}"
            "?modules=summaryDetail,financialData,defaultKeyStatistics,price&crumb={crumb}")


def _pick(d, key):
    """Extrait une valeur numérique d'un champ Yahoo : nombre brut, objet {raw,...} ou absent."""
    if not isinstance(d, dict):
        return None
    v = d.get(key)
    if isinstance(v, dict):
        v = v.get("raw")
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None  # écarte NaN/inf


def _normalize_fundamentals(sym, node):
    """Aplati quoteSummary.result[0] en un dict plat. Champs absents → None."""
    summary = node.get("summaryDetail") or {}
    stats = node.get("defaultKeyStatistics") or {}
    fin = node.get("financialData") or {}
    price = node.get("price") or {}

    rec = fin.get("recommendationKey")
    long_name = price.get("longName") or price.get("shortName")

    return {
        "symbol": sym,
        "currency": price.get("currency") or summary.get("currency"),
        "longName": long_name if isinstance(long_name, str) else None,
        "marketCap": _pick(price, "marketCap") or _pick(summary, "marketCap"),
        "trailingPE": _pick(summary, "trailingPE"),
        "forwardPE": _pick(summary, "forwardPE") or _pick(stats, "forwardPE"),
        "pegRatio": _pick(stats, "pegRatio"),
        "priceToBook": _pick(stats, "priceToBook"),
        "enterpriseToEbitda": _pick(stats, "enterpriseToEbitda"),
        "priceToSales": _pick(summary, "priceToSalesTrailing12Months"),
        "trailingEps": _pick(stats, "trailingEps"),
        "forwardEps": _pick(stats, "forwardEps"),
        "profitMargins": _pick(fin, "profitMargins") or _pick(stats, "profitMargins"),
        "operatingMargins": _pick(fin, "operatingMargins"),
        "grossMargins": _pick(fin, "grossMargins"),
        "returnOnEquity": _pick(fin, "returnOnEquity"),
        "returnOnAssets": _pick(fin, "returnOnAssets"),
        "revenueGrowth": _pick(fin, "revenueGrowth"),
        "earningsGrowth": _pick(fin, "earningsGrowth"),
        "debtToEquity": _pick(fin, "debtToEquity"),
        "currentRatio": _pick(fin, "currentRatio"),
        "quickRatio": _pick(fin, "quickRatio"),
        "dividendYield": _pick(summary, "dividendYield"),
        "payoutRatio": _pick(summary, "payoutRatio"),
        "recommendationKey": rec if isinstance(rec, str) else None,
        "targetMeanPrice": _pick(fin, "targetMeanPrice"),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `py -m unittest tests.test_fundamentals -v`
Expected: PASS (3 tests OK).

- [ ] **Step 5: Commit**

```bash
git add server.py tests/test_fundamentals.py
git commit -m "feat(server): normalisation des fondamentaux Yahoo (fonction pure + tests)"
```

---

### Task 2: Serveur — cookie/crumb Yahoo + route `/api/fundamentals`

Ajoute la récupération authentifiée (cookie+crumb, en cache, thread-safe) et branche la route dans `do_GET`. Vérifié en réel avec `curl` contre le serveur lancé.

**Files:**
- Modify: `server.py` (imports : ajouter `import threading` ; ajouter le cache d'auth + `_fetch_yahoo_auth` + `_get_yahoo_crumb` près des constantes ; ajouter `handle_fundamentals` dans `Handler` ; brancher la route dans `do_GET`)

**Interfaces:**
- Consumes: `_normalize_fundamentals`, `_pick`, `FUND_URL`, `USER_AGENT`, `send_json` (Task 1 + existant).
- Produces:
  - `_fetch_yahoo_auth() -> tuple[str, str]` — renvoie `(cookie_header, crumb)` ; lève une exception si échec.
  - `_get_yahoo_crumb(force_refresh: bool = False) -> tuple[str, str]` — version mise en cache et thread-safe.
  - Route HTTP GET `/api/fundamentals?symbol=XXX` → JSON normalisé de Task 1, ou `{"error", "message"}`.

- [ ] **Step 1: Add threading import + auth cache + fetch helpers**

Dans `server.py`, à la section imports, ajouter `import threading` (à côté de `import os`).

Puis, juste après la définition de `FUND_URL` (ajoutée en Task 1) et avant `_pick`, ajouter :

```python
# Cookie + crumb Yahoo, partagés entre requêtes (ThreadingHTTPServer → protégés par un verrou).
# quoteSummary refuse les appels sans ce couple depuis 2023. On les régénère à la demande
# (premier appel, ou après une réponse 401/403 « Invalid Crumb »).
_YAHOO_AUTH = {"cookie": None, "crumb": None}
_YAHOO_AUTH_LOCK = threading.Lock()


def _fetch_yahoo_auth():
    """Récupère un cookie de session Yahoo puis un crumb valide pour ce cookie."""
    # 1) Cookie : fc.yahoo.com renvoie souvent une erreur HTTP mais pose quand même le cookie.
    cookie_req = urllib.request.Request("https://fc.yahoo.com", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(cookie_req, timeout=10) as resp:
            set_cookies = resp.headers.get_all("Set-Cookie") or []
    except urllib.error.HTTPError as e:
        set_cookies = e.headers.get_all("Set-Cookie") or []
    cookie_header = "; ".join(c.split(";", 1)[0] for c in set_cookies)
    if not cookie_header:
        raise RuntimeError("cookie Yahoo indisponible")

    # 2) Crumb lié à ce cookie.
    crumb_req = urllib.request.Request(
        "https://query1.finance.yahoo.com/v1/test/getcrumb",
        headers={"User-Agent": USER_AGENT, "Cookie": cookie_header})
    with urllib.request.urlopen(crumb_req, timeout=10) as resp:
        crumb = resp.read().decode("utf-8").strip()
    if not crumb or "<" in crumb or len(crumb) > 40:
        raise RuntimeError("crumb Yahoo invalide")
    return cookie_header, crumb


def _get_yahoo_crumb(force_refresh=False):
    """Renvoie (cookie, crumb), en régénérant si absent ou si force_refresh."""
    with _YAHOO_AUTH_LOCK:
        if force_refresh or not _YAHOO_AUTH["crumb"]:
            _YAHOO_AUTH["cookie"], _YAHOO_AUTH["crumb"] = _fetch_yahoo_auth()
        return _YAHOO_AUTH["cookie"], _YAHOO_AUTH["crumb"]
```

- [ ] **Step 2: Add the route handler + wire into do_GET**

Dans `do_GET`, ajouter une branche (après la ligne `elif parsed.path == "/api/screener":`) :

```python
        elif parsed.path == "/api/fundamentals":
            self.handle_fundamentals(parse_qs(parsed.query))
```

Puis ajouter la méthode dans la classe `Handler` (par ex. juste après `handle_screener`) :

```python
    # --- route /api/fundamentals?symbol=XXX : données fondamentales (quoteSummary) ---
    def handle_fundamentals(self, qs):
        sym = (qs.get("symbol") or [""])[0].strip().upper()
        if not sym or len(sym) > 15:
            return self.send_json({"error": "symbol", "message": "Ticker manquant ou invalide."}, 400)

        data = None
        # 2 tentatives : la 2e force un crumb neuf si le premier a expiré (401/403).
        for attempt in (0, 1):
            try:
                cookie, crumb = _get_yahoo_crumb(force_refresh=(attempt == 1))
            except Exception:
                return self.send_json(
                    {"error": "network", "message": "Impossible d'authentifier auprès de Yahoo Finance."}, 502)

            url = FUND_URL.format(sym=urllib.parse.quote(sym), crumb=urllib.parse.quote(crumb))
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Cookie": cookie})
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                break
            except urllib.error.HTTPError as e:
                if e.code in (401, 403) and attempt == 0:
                    continue  # crumb expiré → on régénère au tour suivant
                if e.code == 404:
                    return self.send_json(
                        {"error": "symbol", "message": f"Ticker « {sym} » inconnu de Yahoo Finance."}, 404)
                if e.code == 429:
                    return self.send_json(
                        {"error": "ratelimit",
                         "message": "Yahoo Finance limite temporairement les requêtes. Réessayez dans une minute."}, 502)
                return self.send_json(
                    {"error": "http", "message": f"Yahoo Finance a répondu HTTP {e.code}."}, 502)
            except Exception:
                return self.send_json(
                    {"error": "network", "message": "Impossible de joindre Yahoo Finance."}, 502)

        try:
            result = (data.get("quoteSummary", {}) or {}).get("result")
            if not result:
                return self.send_json(
                    {"error": "symbol", "message": f"Aucune donnée fondamentale pour {sym}."}, 404)
            return self.send_json(_normalize_fundamentals(sym, result[0]))
        except Exception:
            return self.send_json(
                {"error": "format", "message": f"Réponse fondamentale Yahoo inattendue pour {sym}."}, 502)
```

- [ ] **Step 3: Launch the server and verify a valid ticker**

Run (depuis le dossier du projet) :
```bash
py server.py &
sleep 2
curl -s "http://localhost:8750/api/fundamentals?symbol=AAPL"
```
Expected: un JSON contenant au moins `"symbol":"AAPL"`, un `"marketCap"` numérique non nul, et `"trailingPE"` numérique. Pas de champ `"error"`.

- [ ] **Step 4: Verify graceful handling of an ETF and a bad ticker**

Run :
```bash
curl -s "http://localhost:8750/api/fundamentals?symbol=SPY"
curl -s "http://localhost:8750/api/fundamentals?symbol=ZZZZINVALID"
```
Expected:
- `SPY` : JSON `"symbol":"SPY"` avec la plupart des champs fondamentaux à `null` (un ETF n'a pas de PER/marges), **sans** planter.
- `ZZZZINVALID` : `{"error":"symbol", ...}` (message propre), pas de trace Python.

Arrêter le serveur : `kill %1` (ou fermer le process).

- [ ] **Step 5: Confirm Task 1 tests still pass, then commit**

Run: `py -m unittest tests.test_fundamentals -v`
Expected: PASS.

```bash
git add server.py
git commit -m "feat(server): route /api/fundamentals avec auth cookie+crumb Yahoo"
```

---

### Task 3: Client — récupération + calcul des scores fondamental et global

Ajoute la couche de données côté navigateur : fetch, score fondamental à 4 piliers, score global pondéré, et l'état `weightTech` persistant. Fonctions pures (hors fetch), vérifiées en console navigateur.

**Files:**
- Modify: `terminal-tout-en-un.html` — ajouter la clé `LS.weightTech`, la variable d'état `weightTech`, et les fonctions près de la section calcul (après `signalFromScore`, ~ligne 1381).

**Interfaces:**
- Consumes: `lsGet`, `lsSet`, `FETCH_TIMEOUT_MS`, style de `fetchDailySeriesYahoo` (existant).
- Produces:
  - `async function fetchFundamentals(ticker) -> object` — appelle `/api/fundamentals`, renvoie l'objet normalisé ; lève `{type, message}` en cas d'erreur (comme `fetchDailySeriesYahoo`).
  - `function piecewise(v, points) -> number | null` — interpolation linéaire bornée entre points `[[x,y],...]`.
  - `function computeFundScore(fund) -> object | null` — renvoie `{ total: number(0-100), pillars: {valuation, profitability, growth, health}, verdict: string }` ; `null` si `fund` est falsy ou si aucun pilier n'est calculable.
  - `function fundVerdict(total) -> string`.
  - `function computeGlobalScore(entry) -> number` — combine `entry.score` (technique) et `entry.fundScore.total` selon `weightTech` ; retombe sur le technique seul si `fundScore` absent.
  - `let weightTech` (0..1, défaut 0.5) + `LS.weightTech`.

- [ ] **Step 1: Add the failing browser-console checks (define expected behavior)**

Aucune infra de test JS dans ce projet : la vérification se fait en **console navigateur**. Écrire d'abord, dans un commentaire au-dessus de `computeFundScore` (pour référence), le comportement attendu, puis vérifier à l'étape 4. Comportement cible :

```text
computeFundScore(null)  === null
computeFundScore({})    === null            // aucun champ → aucun pilier
Un titre "cher" (PER 60, marges faibles, dette élevée) → total < 40
Un titre "bon marché & rentable" (PER 8, marge 30%, ROE 25%, dette 20, croissance 20%) → total > 65
computeGlobalScore avec fundScore=null → renvoie exactement entry.score (technique)
```

- [ ] **Step 2: Add LS key, state, and functions**

Dans l'objet `LS` (~ligne 941), ajouter la clé :

```js
  weightTech: "term_weight_tech", // part du score technique dans le score global (0..1)
```

Dans la section ÉTAT GLOBAL (~après `let tickerNames = ...`), ajouter :

```js
// Pondération du score global : part du technique (0..1), le reste va au fondamental.
// Réglable via le curseur de l'onglet Analyse, persistée par profil.
let weightTech = clamp01(Number(lsGet(LS.weightTech, 0.5)));
```

Juste après `function signalFromScore(score) { ... }` (~ligne 1381), ajouter :

```js
/* ============================= SCORE FONDAMENTAL ============================= */

function clamp01(x) { return Math.max(0, Math.min(1, isFinite(x) ? x : 0.5)); }

// Interpolation linéaire bornée entre des points [[x,y],...] triés par x croissant.
// Renvoie y du premier point si v <= x0, y du dernier si v >= xn, sinon interpole.
function piecewise(v, points) {
  if (v === null || v === undefined || !isFinite(v)) return null;
  if (v <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (v <= points[i][0]) {
      const [x0, y0] = points[i - 1], [x1, y1] = points[i];
      return y0 + (y1 - y0) * (v - x0) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

// Moyenne des sous-scores non nuls ; null si aucun disponible.
function avgDefined(vals) {
  const ok = vals.filter(v => v !== null && v !== undefined && isFinite(v));
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
}

// Barèmes (seuils absolus). Chaque métrique → sous-score 0..1.
// Valorisation : plus c'est bas, mieux c'est (PER/PEG/PB négatifs = perte/anomalie → 0).
function scoreValuation(f) {
  const pe = f.trailingPE;
  const peScore = (pe === null) ? null : (pe <= 0 ? 0 : piecewise(pe, [[8, 1], [10, 1], [25, 0.5], [50, 0]]));
  const fpe = f.forwardPE;
  const fpeScore = (fpe === null) ? null : (fpe <= 0 ? 0 : piecewise(fpe, [[8, 1], [10, 1], [25, 0.5], [50, 0]]));
  const peg = f.pegRatio;
  const pegScore = (peg === null) ? null : (peg <= 0 ? 0 : piecewise(peg, [[1, 1], [2, 0.5], [3, 0]]));
  const pb = f.priceToBook;
  const pbScore = (pb === null) ? null : (pb <= 0 ? 0 : piecewise(pb, [[1, 1], [3, 0.5], [6, 0]]));
  const ev = f.enterpriseToEbitda;
  const evScore = (ev === null) ? null : (ev <= 0 ? 0 : piecewise(ev, [[8, 1], [15, 0.5], [25, 0]]));
  return avgDefined([peScore, fpeScore, pegScore, pbScore, evScore]);
}

// Rentabilité : plus c'est haut, mieux c'est (marges/ROE/ROA en fraction : 0.25 = 25 %).
function scoreProfitability(f) {
  const pm = f.profitMargins;
  const pmScore = pm === null ? null : piecewise(pm, [[0, 0], [0.20, 0.7], [0.40, 1]]);
  const om = f.operatingMargins;
  const omScore = om === null ? null : piecewise(om, [[0, 0], [0.20, 0.7], [0.40, 1]]);
  const roe = f.returnOnEquity;
  const roeScore = roe === null ? null : piecewise(roe, [[0, 0], [0.15, 0.6], [0.30, 1]]);
  const roa = f.returnOnAssets;
  const roaScore = roa === null ? null : piecewise(roa, [[0, 0], [0.08, 0.6], [0.15, 1]]);
  return avgDefined([pmScore, omScore, roeScore, roaScore]);
}

// Croissance : plus c'est haut, mieux (fraction : 0.10 = 10 %).
function scoreGrowth(f) {
  const rg = f.revenueGrowth;
  const rgScore = rg === null ? null : piecewise(rg, [[-0.10, 0], [0, 0.4], [0.25, 1]]);
  const eg = f.earningsGrowth;
  const egScore = eg === null ? null : piecewise(eg, [[-0.10, 0], [0, 0.4], [0.25, 1]]);
  return avgDefined([rgScore, egScore]);
}

// Santé financière + dividende. debtToEquity façon Yahoo en % (150 = 1.5x).
function scoreHealth(f) {
  const de = f.debtToEquity;
  const deScore = de === null ? null : (de < 0 ? 0 : piecewise(de, [[50, 1], [150, 0.5], [300, 0]]));
  const cr = f.currentRatio;
  const crScore = cr === null ? null : piecewise(cr, [[1, 0.2], [1.5, 0.7], [3, 1]]);
  let base = avgDefined([deScore, crScore]);
  if (base === null && f.dividendYield !== null) base = 0.5; // dividende seul → neutre
  if (base === null) return null;
  // Bonus dividende : +0.1 par point de % de rendement, plafonné à +0.3.
  const dy = f.dividendYield; // fraction (0.03 = 3 %)
  const bonus = dy === null ? 0 : Math.min(0.3, Math.max(0, dy * 100 * 0.1));
  return Math.min(1, base + bonus);
}

const FUND_PILLAR_WEIGHTS = { valuation: 0.35, profitability: 0.30, growth: 0.20, health: 0.15 };

function fundVerdict(total) {
  if (total >= 65) return "Sous-évalué / solide";
  if (total <= 35) return "Cher / fragile";
  return "Correct";
}

// Score fondamental /100 : moyenne pondérée des piliers disponibles (poids renormalisés).
function computeFundScore(fund) {
  if (!fund) return null;
  const pillars = {
    valuation: scoreValuation(fund),
    profitability: scoreProfitability(fund),
    growth: scoreGrowth(fund),
    health: scoreHealth(fund),
  };
  let wsum = 0, acc = 0;
  for (const k of Object.keys(FUND_PILLAR_WEIGHTS)) {
    if (pillars[k] !== null) { acc += pillars[k] * FUND_PILLAR_WEIGHTS[k]; wsum += FUND_PILLAR_WEIGHTS[k]; }
  }
  if (wsum === 0) return null; // aucun pilier calculable
  const total = Math.round(Math.min(100, Math.max(0, (acc / wsum) * 100)));
  // Piliers exposés en /100 pour l'affichage (null conservé si indisponible).
  const pillars100 = {};
  for (const k of Object.keys(pillars)) pillars100[k] = pillars[k] === null ? null : Math.round(pillars[k] * 100);
  return { total, pillars: pillars100, verdict: fundVerdict(total) };
}

// Score global : mélange technique (entry.score) et fondamental selon weightTech.
// Sans fondamental → technique seul.
function computeGlobalScore(entry) {
  if (!entry.fundScore) return entry.score;
  return Math.round(entry.score * weightTech + entry.fundScore.total * (1 - weightTech));
}

/* ============================= FETCH FONDAMENTAUX ============================= */

async function fetchFundamentals(ticker) {
  if (location.protocol === "file:") {
    throw { type: "noserver", message: "Les fondamentaux nécessitent le serveur local (python server.py)." };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch("/api/fundamentals?symbol=" + encodeURIComponent(ticker), { signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    throw { type: e.name === "AbortError" ? "timeout" : "network",
            message: `Fondamentaux indisponibles pour ${ticker}.` };
  }
  clearTimeout(timer);
  let data;
  try { data = await resp.json(); }
  catch { throw { type: "format", message: `Réponse fondamentale inattendue pour ${ticker}.` }; }
  if (data.error) throw { type: data.error, message: data.message || `Erreur fondamentale pour ${ticker}.` };
  return data;
}
```

> Note : `clamp01` est défini dans ce bloc mais utilisé plus haut par `let weightTech = ...`. En JS, les `function` sont hoistées, donc l'appel au chargement fonctionne même si la déclaration est plus bas dans le même script.

- [ ] **Step 3: Start the app and open it in the browser**

Lancer via l'outil de preview (serveur déjà écrit) : `py server.py`, puis ouvrir `http://localhost:8750`.

- [ ] **Step 4: Verify pure functions in the browser console**

Dans la console navigateur (F12), coller :

```js
console.log("null →", computeFundScore(null));           // attendu : null
console.log("{}   →", computeFundScore({}));              // attendu : null
const cher = { trailingPE: 60, forwardPE: 55, pegRatio: 4, priceToBook: 8, enterpriseToEbitda: 30,
  profitMargins: 0.02, operatingMargins: 0.03, returnOnEquity: 0.02, returnOnAssets: 0.01,
  revenueGrowth: -0.05, earningsGrowth: -0.08, debtToEquity: 400, currentRatio: 0.8, dividendYield: null };
const bon = { trailingPE: 8, forwardPE: 9, pegRatio: 0.9, priceToBook: 1.2, enterpriseToEbitda: 7,
  profitMargins: 0.30, operatingMargins: 0.32, returnOnEquity: 0.25, returnOnAssets: 0.16,
  revenueGrowth: 0.20, earningsGrowth: 0.22, debtToEquity: 20, currentRatio: 2.5, dividendYield: 0.03 };
console.log("cher →", computeFundScore(cher).total, "(attendu < 40)");
console.log("bon  →", computeFundScore(bon).total, "(attendu > 65)");
console.log("global sans fonda →", computeGlobalScore({ score: 72, fundScore: null }), "(attendu 72)");
```
Expected : `null`, `null`, un total < 40 pour `cher`, un total > 65 pour `bon`, et `72` pour le global sans fondamental.

- [ ] **Step 5: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(client): fetch + score fondamental 4 piliers + score global pondéré"
```

---

### Task 4: Client — intégrer les fondamentaux dans `analyzeTicker` (cache)

Récupère les fondamentaux pendant l'analyse et les stocke dans l'entrée de cache, sans jamais casser l'analyse technique.

**Files:**
- Modify: `terminal-tout-en-un.html` — fonction `analyzeTicker` (~ligne 1389) ; bloc de migration de cache (~ligne 964, pour recalculer `fundScore` des entrées existantes).

**Interfaces:**
- Consumes: `fetchFundamentals`, `computeFundScore` (Task 3), `analyzeTicker` (existant).
- Produces: chaque entrée de `cache`/`marketCache` porte désormais `fund` (objet ou `null`) et `fundScore` (objet ou `null`).

- [ ] **Step 1: Fetch fundamentals inside analyzeTicker**

Dans `analyzeTicker`, remplacer le corps du `try` (lignes ~1392-1406) par :

```js
  try {
    const hist = await fetchDailySeries(ticker);
    const ind = computeIndicators(hist);
    const score = computeScore(ind);

    // Fondamentaux : facultatifs. Une panne ici ne doit pas casser l'analyse technique.
    let fund = null;
    try { fund = await fetchFundamentals(ticker); }
    catch (e) { fund = null; /* silencieux : l'UI affichera « indisponible » */ }
    const fundScore = computeFundScore(fund);

    store[ticker] = {
      updated: new Date().toISOString(),
      hist,
      ind,
      score,
      signal: signalFromScore(score),
      fund,
      fundScore,
    };
    if (store === cache) lsSet(LS.cache, cache);
    if (!silent) toast(`${ticker} analysé — score ${score}/100 (${store[ticker].signal}).`, "success");
  } catch (err) {
```

(Le `catch (err) { ... }` et le `finally { ... }` existants restent inchangés.)

- [ ] **Step 2: Backfill fundScore for cached entries on load**

Dans le bloc de migration de cache (~ligne 964), pour que les entrées déjà en cache (analysées avant cette fonctionnalité) obtiennent au moins un `fundScore` recalculé si elles ont déjà `fund`, remplacer la boucle existante par :

```js
for (const ticker of Object.keys(cache)) {
  const entry = cache[ticker];
  if (!entry) continue;
  if (entry.hist && (!entry.ind || !entry.ind.perf || !entry.ind.bollinger || !entry.ind.stochastic)) {
    const ind = computeIndicators(entry.hist);
    const score = computeScore(ind);
    cache[ticker] = { ...entry, ind, score, signal: signalFromScore(score) };
  }
  // Champs fondamentaux absents sur les entrées anciennes : normaliser à null,
  // et recalculer fundScore si des fondamentaux sont déjà stockés.
  if (cache[ticker].fund === undefined) cache[ticker].fund = null;
  cache[ticker].fundScore = computeFundScore(cache[ticker].fund);
}
```

- [ ] **Step 3: Verify in the browser**

Serveur lancé (`py server.py`), ouvrir `http://localhost:8750`. Dans l'app : onglet Dashboard (F1), analyser `AAPL`. Puis en console :

```js
console.log(cache.AAPL.fund);       // attendu : objet avec marketCap, trailingPE...
console.log(cache.AAPL.fundScore);  // attendu : { total, pillars:{...}, verdict }
```
Expected : `fund` non nul et `fundScore.total` un nombre 0-100.

- [ ] **Step 4: Verify technical analysis survives a fundamentals failure**

En console, simuler une panne réseau fondamentale puis ré-analyser :

```js
const _orig = window.fetch;
window.fetch = (u, o) => u.includes("/api/fundamentals") ? Promise.reject(new Error("boom")) : _orig(u, o);
await analyzeTicker("MSFT");
console.log("technique OK ?", !!cache.MSFT && typeof cache.MSFT.score === "number"); // attendu : true
console.log("fund =", cache.MSFT.fund, "fundScore =", cache.MSFT.fundScore);          // attendu : null, null
window.fetch = _orig;
```
Expected : `technique OK ? true`, `fund = null`, `fundScore = null` — l'analyse technique n'a pas planté.

- [ ] **Step 5: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(client): récupération des fondamentaux dans analyzeTicker + backfill cache"
```

---

### Task 5: Client — affichage fondamental dans l'onglet Analyse (F4)

Ajoute la grille de métriques, le détail des piliers, le score fondamental + verdict, et le texte de synthèse fondamental dans chaque carte.

**Files:**
- Modify: `terminal-tout-en-un.html` — ajouter `fmtMarketCap`, `buildFundamentalStatsHtml`, `buildFundamentalText` (près de `buildAnalysisStatsHtml`, ~ligne 2206) ; injecter le bloc dans `renderAnalysis` (~ligne 2361) ; un peu de CSS dans la section ANALYSE (~ligne 439).

**Interfaces:**
- Consumes: `entry.fund`, `entry.fundScore`, `fnum`, `fpct`, `esc`, `computeGlobalScore` (Task 3).
- Produces:
  - `function fmtMarketCap(v, currency) -> string` — capitalisation lisible (ex. « 3 200 Md USD »).
  - `function buildFundamentalStatsHtml(entry) -> string` — HTML du bloc fondamental (grille + piliers + scores) ou message « indisponible ».
  - `function buildFundamentalText(fund, fundScore) -> string[]` — paragraphes descriptifs.

- [ ] **Step 1: Add formatting + HTML builders**

Juste après `buildAnalysisStatsHtml` (~ligne 2226), ajouter :

```js
// Capitalisation lisible : milliers de milliards (Bn/Md), milliards, millions.
function fmtMarketCap(v, currency) {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const cur = currency ? " " + currency : "";
  const abs = Math.abs(v);
  if (abs >= 1e12) return fmtNum.format(v / 1e12) + " Bn" + cur;   // billions (10^12)
  if (abs >= 1e9)  return fmtNum.format(v / 1e9) + " Md" + cur;    // milliards
  if (abs >= 1e6)  return fmtNum.format(v / 1e6) + " M" + cur;     // millions
  return fmtNum.format(v) + cur;
}

// Affiche une fraction (0.253) en pourcentage (25,3 %). null → "—".
function ffrac(v) { return v === null || v === undefined || !isFinite(v) ? "—" : fpct(v * 100); }

// Bloc fondamental complet pour une carte d'analyse.
function buildFundamentalStatsHtml(entry) {
  const f = entry.fund, fs = entry.fundScore;
  if (!f || !fs) {
    return `<div class="fund-block"><p class="fund-unavailable">Données fondamentales indisponibles pour ce titre (ETF, indice, ou source momentanément inaccessible). L'analyse technique reste valable.</p></div>`;
  }
  const metrics = [
    ["Capitalisation", fmtMarketCap(f.marketCap, f.currency), ""],
    ["PER (12 m)", fnum(f.trailingPE), ""],
    ["PER prévisionnel", fnum(f.forwardPE), ""],
    ["PEG", fnum(f.pegRatio), ""],
    ["Price / Book", fnum(f.priceToBook), ""],
    ["EV / EBITDA", fnum(f.enterpriseToEbitda), ""],
    ["Marge nette", ffrac(f.profitMargins), pctClass(f.profitMargins)],
    ["Marge opér.", ffrac(f.operatingMargins), pctClass(f.operatingMargins)],
    ["ROE", ffrac(f.returnOnEquity), pctClass(f.returnOnEquity)],
    ["ROA", ffrac(f.returnOnAssets), pctClass(f.returnOnAssets)],
    ["Croissance CA", ffrac(f.revenueGrowth), pctClass(f.revenueGrowth)],
    ["Croissance bénéf.", ffrac(f.earningsGrowth), pctClass(f.earningsGrowth)],
    ["Dette / capitaux propres", f.debtToEquity === null ? "—" : fnum(f.debtToEquity / 100), ""],
    ["Ratio de liquidité", fnum(f.currentRatio), ""],
    ["Rendement dividende", ffrac(f.dividendYield), ""],
  ];
  const grid = `<dl class="impact-grid fund-metrics">`
    + metrics.map(([k, v, cls]) => `<div><dt>${esc(k)}</dt><dd class="${cls}">${esc(v)}</dd></div>`).join("")
    + `</dl>`;

  const pillarLabels = { valuation: "Valorisation", profitability: "Rentabilité", growth: "Croissance", health: "Santé + dividende" };
  const pillars = Object.keys(pillarLabels).map(k => {
    const val = fs.pillars[k];
    const disp = val === null ? "—" : `${val}/100`;
    const width = val === null ? 0 : val;
    return `<div class="fund-pillar"><span class="fund-pillar-label">${esc(pillarLabels[k])}</span>`
      + `<span class="fund-pillar-bar"><span style="width:${width}%"></span></span>`
      + `<span class="fund-pillar-val">${esc(disp)}</span></div>`;
  }).join("");

  const global = computeGlobalScore(entry);
  return `<div class="fund-block">
    <div class="fund-scores">
      <div class="fund-score-badge"><span class="fund-score-num">${fs.total}</span><span class="fund-score-cap">Score fondamental /100</span><span class="fund-verdict">${esc(fs.verdict)}</span></div>
      <div class="fund-score-badge fund-score-global"><span class="fund-score-num">${global}</span><span class="fund-score-cap">Score global /100</span><span class="fund-verdict">${Math.round(weightTech*100)}% tech / ${Math.round((1-weightTech)*100)}% fonda</span></div>
    </div>
    ${pillars}
    ${grid}
    <p class="fund-caveat">Seuils de valorisation absolus, non ajustés par secteur : à interpréter avec le contexte du secteur. Analyse descriptive, pas un conseil.</p>
  </div>`;
}

// Texte de synthèse fondamental en français, descriptif.
function buildFundamentalText(fund, fundScore) {
  if (!fund || !fundScore) return [];
  const f = fund, parts = [];
  if (f.trailingPE !== null) {
    const q = f.trailingPE <= 0 ? "négatif (bénéfices négatifs)" : f.trailingPE < 15 ? "bas" : f.trailingPE > 30 ? "élevé" : "modéré";
    parts.push(`Valorisation : PER de ${fnum(f.trailingPE)} (${q})${f.forwardPE !== null ? `, PER prévisionnel ${fnum(f.forwardPE)}` : ""}${f.pegRatio !== null ? `, PEG ${fnum(f.pegRatio)}` : ""}. Note de valorisation : ${fundScore.pillars.valuation ?? "—"}/100.`);
  }
  if (f.profitMargins !== null || f.returnOnEquity !== null) {
    parts.push(`Rentabilité : marge nette ${ffrac(f.profitMargins)}, ROE ${ffrac(f.returnOnEquity)}. Note de rentabilité : ${fundScore.pillars.profitability ?? "—"}/100.`);
  }
  if (f.revenueGrowth !== null || f.earningsGrowth !== null) {
    parts.push(`Croissance : chiffre d'affaires ${ffrac(f.revenueGrowth)}, bénéfices ${ffrac(f.earningsGrowth)}. Note de croissance : ${fundScore.pillars.growth ?? "—"}/100.`);
  }
  const healthBits = [];
  if (f.debtToEquity !== null) healthBits.push(`dette/capitaux propres ${fnum(f.debtToEquity / 100)}`);
  if (f.currentRatio !== null) healthBits.push(`ratio de liquidité ${fnum(f.currentRatio)}`);
  if (f.dividendYield !== null) healthBits.push(`rendement du dividende ${ffrac(f.dividendYield)}`);
  if (healthBits.length) parts.push(`Santé financière : ${healthBits.join(", ")}. Note de santé : ${fundScore.pillars.health ?? "—"}/100.`);
  parts.push(`Score fondamental global : ${fundScore.total}/100 → « ${fundScore.verdict} ». Agrégation pondérée des piliers disponibles (valorisation 35 %, rentabilité 30 %, croissance 20 %, santé 15 %).`);
  return parts;
}
```

- [ ] **Step 2: Inject the fundamental block into renderAnalysis**

Dans `renderAnalysis`, remplacer la ligne qui construit `paragraphs` (~ligne 2345) par :

```js
    const techParas = buildAnalysisText(ticker, entry).map(p => `<p>${esc(p)}</p>`).join("");
    const fundParas = buildFundamentalText(entry.fund, entry.fundScore).map(p => `<p>${esc(p)}</p>`).join("");
    const paragraphs = techParas + fundParas;
```

Puis, dans le template `card.innerHTML` (~ligne 2361), insérer le bloc fondamental juste après `${buildAnalysisStatsHtml(entry.ind)}` :

```js
      ${buildAnalysisStatsHtml(entry.ind)}
      <h4 class="fund-heading">Analyse fondamentale</h4>
      ${buildFundamentalStatsHtml(entry)}
```

- [ ] **Step 3: Add CSS for the fundamental block**

Dans la section `/* ===== ANALYSE ===== */` (~ligne 439), ajouter :

```css
.fund-heading { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); margin: 14px 0 8px; border-top: 1px solid var(--border, #222); padding-top: 10px; }
.fund-unavailable { color: var(--text-dim); font-style: italic; }
.fund-scores { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.fund-score-badge { display: flex; flex-direction: column; align-items: flex-start; padding: 8px 12px; border: 1px solid var(--border, #222); border-radius: 6px; }
.fund-score-global { border-color: var(--accent, #4ea1ff); }
.fund-score-num { font-size: 22px; font-weight: 700; }
.fund-score-cap { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); }
.fund-verdict { font-size: 11px; margin-top: 2px; }
.fund-pillar { display: grid; grid-template-columns: 130px 1fr 60px; align-items: center; gap: 8px; margin: 4px 0; font-size: 12px; }
.fund-pillar-bar { background: var(--border, #222); height: 8px; border-radius: 4px; overflow: hidden; }
.fund-pillar-bar > span { display: block; height: 100%; background: var(--accent, #4ea1ff); }
.fund-pillar-val { text-align: right; color: var(--text-dim); }
.fund-metrics { margin-top: 10px; }
.fund-caveat { font-size: 10px; color: var(--text-dim); margin-top: 8px; }
```

> Les variables `--border`/`--accent` ont un repli codé en dur au cas où elles n'existent pas dans le thème ; vérifier à l'étape suivante que le rendu est lisible et, si besoin, remplacer par les variables réelles du fichier.

- [ ] **Step 4: Verify visually in the browser**

Serveur lancé, ouvrir `http://localhost:8750`. Analyser `AAPL` (F1), puis onglet Analyse (F4). Vérifier visuellement :
- un titre « Analyse fondamentale » apparaît sous le bloc technique ;
- deux badges : « Score fondamental /100 » (+ verdict) et « Score global /100 » (+ « X% tech / Y% fonda ») ;
- 4 barres de piliers avec des notes ;
- la grille de métriques (PER, capitalisation en « Bn/Md », marges en %, etc.) ;
- des paragraphes de synthèse fondamentale en français.

Puis vérifier le cas indisponible : analyser `SPY` (ETF) → le bloc doit afficher « Données fondamentales indisponibles… » sans casser la carte.

- [ ] **Step 5: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(client): affichage fondamental (grille, piliers, scores, synthèse) dans F4"
```

---

### Task 6: Client — curseur de pondération du score global

Ajoute le curseur technique/fondamental dans l'onglet Analyse, persistant par profil, qui recalcule les scores globaux affichés sans nouvelle requête.

**Files:**
- Modify: `terminal-tout-en-un.html` — HTML du panneau Analyse (~ligne 759-765) ; écouteur + init près de `renderAnalysis`/`btn-refresh-analysis` (~ligne 2406) ; CSS (section ANALYSE).

**Interfaces:**
- Consumes: `weightTech`, `LS.weightTech`, `lsSet`, `renderAnalysis`, `renderAll` (Tasks 3+5, existant).
- Produces: un `<input type="range" id="weight-slider">` piloté par l'utilisateur ; met à jour `weightTech`, persiste, et re-render.

- [ ] **Step 1: Add the slider markup**

Dans le panneau Analyse, remplacer le bloc `panel-head` (~lignes 760-763) par :

```html
      <div class="panel-head">
        <h1>Synthèse par ticker</h1>
        <button class="btn btn-ghost" id="btn-refresh-analysis">↻ Régénérer depuis le cache</button>
      </div>
      <div class="weight-control">
        <label for="weight-slider">Pondération du score global :
          <strong id="weight-label">50 % technique / 50 % fondamental</strong>
        </label>
        <input type="range" id="weight-slider" min="0" max="100" step="5" value="50">
        <span class="weight-ends"><span>100 % fonda</span><span>100 % tech</span></span>
      </div>
```

- [ ] **Step 2: Add slider CSS**

Dans la section ANALYSE du CSS, ajouter :

```css
.weight-control { margin: 4px 0 14px; padding: 10px 12px; border: 1px solid var(--border, #222); border-radius: 6px; }
.weight-control label { font-size: 12px; color: var(--text-dim); }
.weight-control #weight-label { color: var(--text, #eee); }
.weight-control input[type="range"] { width: 100%; margin-top: 8px; }
.weight-ends { display: flex; justify-content: space-between; font-size: 10px; color: var(--text-dim); }
```

- [ ] **Step 3: Wire the slider (init + input listener)**

Juste après `document.getElementById("btn-refresh-analysis").addEventListener("click", renderAnalysis);` (~ligne 2406), ajouter :

```js
// Curseur de pondération : la valeur du slider = part du TECHNIQUE (0..100).
(function initWeightSlider() {
  const slider = document.getElementById("weight-slider");
  const label = document.getElementById("weight-label");
  if (!slider || !label) return;
  const paint = () => {
    const tech = Math.round(weightTech * 100);
    slider.value = tech;
    label.textContent = `${tech} % technique / ${100 - tech} % fondamental`;
  };
  paint();
  slider.addEventListener("input", () => {
    weightTech = clamp01(Number(slider.value) / 100);
    lsSet(LS.weightTech, weightTech);
    label.textContent = `${Math.round(weightTech * 100)} % technique / ${Math.round((1 - weightTech) * 100)} % fondamental`;
    renderAnalysis(); // recalcule tous les scores globaux affichés, sans requête réseau
  });
})();
```

- [ ] **Step 4: Verify the slider in the browser**

Serveur lancé, `http://localhost:8750`, analyser `AAPL`, onglet Analyse (F4). Vérifier :
- le curseur affiche « 50 % technique / 50 % fondamental » par défaut ;
- en le bougeant à fond côté technique (100), le badge « Score global » égale le score technique ; à fond côté fondamental (0), il égale le score fondamental ; le libellé « X% tech / Y% fonda » du badge suit ;
- recharger la page (F5) → le curseur revient à la valeur choisie (persistée). Vérifier en console : `lsGet(LS.weightTech, 0.5)` renvoie la valeur enregistrée.

- [ ] **Step 5: Commit**

```bash
git add terminal-tout-en-un.html
git commit -m "feat(client): curseur de pondération technique/fondamental du score global"
```

---

## Vérification finale (après les 6 tâches)

- [ ] `py -m unittest discover tests -v` → tous les tests serveur passent.
- [ ] Serveur lancé, dans l'app : analyser `AAPL`, `MC.PA` (Europe), `MSFT` → bloc fondamental complet, scores cohérents.
- [ ] Analyser `SPY` (ETF) → « indisponible », aucune carte cassée, technique intacte.
- [ ] Bouger le curseur → scores globaux mis à jour partout, valeur persistée après rechargement.
- [ ] Couper le réseau fondamental (simulation console de Task 4) → l'analyse technique fonctionne toujours.
- [ ] `git log --oneline` montre un commit par tâche.
- [ ] Merge de `feat/analyse-fondamentale` vers `main` (via la skill finishing-a-development-branch) une fois tout validé.

## Notes d'implémentation

- **Ordre des tâches** : 1→2 (serveur) puis 3→4→5→6 (client). Chaque tâche est autonome et testable.
- **`clamp01` hoisting** : `weightTech` est initialisé au chargement en appelant `clamp01`, définie plus bas — OK car les déclarations `function` sont hoistées. Si tu réorganises en `const clamp01 = ...`, déplace-la au-dessus de l'init de `weightTech`.
- **Variables CSS** : le fichier utilise des variables de thème ; les replis `var(--x, #fallback)` évitent un rendu cassé si un nom diffère. À l'étape visuelle de Task 5, aligner sur les vraies variables du fichier si le rendu détonne.
- **Limite assumée** : seuils absolus non sectoriels (affiché via `.fund-caveat`). Évolution future possible : barèmes par secteur (Yahoo fournit `sector`/`industry` dans `assetProfile`).
