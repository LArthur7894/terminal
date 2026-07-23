#!/usr/bin/env python3
# ============================================================================
# TERMINAL — Serveur local
# ----------------------------------------------------------------------------
# Rôle double :
#   1. Servir les fichiers statiques de l'app (index.html, app.js, style.css)
#   2. Exposer /api/history?symbol=XXX : relais vers l'API gratuite de
#      Yahoo Finance (endpoint v8/finance/chart, celui qui alimente leur site).
#      → Pas de clé API, pas de quota journalier de 25 requêtes.
#      Le relais est nécessaire car le navigateur ne peut pas appeler Yahoo
#      directement (blocage CORS) et Yahoo exige un en-tête User-Agent.
#
# Lancement local :  python3 server.py    puis ouvrir http://localhost:8750
# Hébergement cloud (Render, Railway...) : ces plateformes fournissent PORT via
# une variable d'environnement, ce qui bascule automatiquement l'écoute sur
# 0.0.0.0 (accessible depuis l'extérieur) au lieu de 127.0.0.1 (local uniquement).
# ============================================================================

import json
import os
import threading
import time
import urllib.request
import urllib.error
import urllib.parse
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone

PORT = int(os.environ.get("PORT", 8750))
HOST = "0.0.0.0" if "PORT" in os.environ else "127.0.0.1"
APP_DIR = os.path.dirname(os.path.abspath(__file__))
HISTORY_KEEP = 420  # jours de bourse renvoyés (aligné sur app.js)

# Ancienne URL de l'app, du temps où tout tenait dans un seul fichier. Les marque-pages
# et les PWA déjà installées la visent encore : on les renvoie vers la racine plutôt que
# de leur servir un 404.
ANCIENNE_PAGE = "/terminal-tout-en-un.html"

# range=2y suffit largement pour SMA 200 + range 52 semaines
YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=2y&interval=1d"
# Recherche par nom d'entreprise → liste de tickers correspondants
SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search?q={q}&quotesCount=8&newsCount=0&listsCount=0"
# Actualités récentes liées à un ticker (même endpoint de recherche, avec newsCount>0)
NEWS_URL = "https://query1.finance.yahoo.com/v1/finance/search?q={sym}&quotesCount=0&newsCount=6"
# Listes prédéfinies Yahoo ("screeners") : chacune couvre son propre balayage du marché
# entier côté Yahoo (bien plus large que ce qu'on pourrait interroger titre par titre).
SCREENER_URL = "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&count={count}&scrIds={scr}"
SCREENER_ALLOWED = {
    "day_gainers", "day_losers", "most_actives", "undervalued_large_caps",
    "growth_technology_stocks", "aggressive_small_caps", "small_cap_gainers",
    "undervalued_growth_stocks", "most_shorted_stocks", "conservative_foreign_funds",
}
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"

# Endpoint fondamental Yahoo (quoteSummary). Nécessite cookie + crumb (voir _get_yahoo_crumb).
# incomeStatementHistory sert à juger la régularité du résultat net (BNA). Ajouter un module
# à cette URL ne coûte pas de requête supplémentaire : c'est le même appel quoteSummary.
# balanceSheetHistory est volontairement absent : Yahoo n'y renvoie plus que des dates.
FUND_URL = ("https://query1.finance.yahoo.com/v10/finance/quoteSummary/{sym}"
            "?modules=summaryDetail,financialData,defaultKeyStatistics,price,incomeStatementHistory,assetProfile"
            "&crumb={crumb}")

# Cookie + crumb Yahoo, partagés entre requêtes (ThreadingHTTPServer → protégés par un verrou).
# quoteSummary refuse les appels sans ce couple depuis 2023. On les régénère à la demande
# (premier appel, ou après une réponse 401/403 « Invalid Crumb »).
_YAHOO_AUTH = {"cookie": None, "crumb": None}
_YAHOO_AUTH_LOCK = threading.Lock()

# Quand Yahoo limite durablement l'IP (429 depuis un hébergeur), inutile de refaire trois
# tentatives espacées à chaque requête : on mémorise l'échec quelques minutes et on répond
# tout de suite, plutôt que de faire patienter l'utilisateur 5 s pour la même erreur.
_AUTH_FAIL = {"until": 0.0, "reason": ""}
_AUTH_FAIL_TTL = 300  # secondes


# Sources de cookie, essayées dans l'ordre. fc.yahoo.com suffit depuis une IP résidentielle
# mais reste souvent muet depuis un centre de données (cas de Render) : on retombe alors sur
# les pages publiques, qui posent un cookie de consentement exploitable.
_COOKIE_SOURCES = (
    "https://fc.yahoo.com",
    "https://finance.yahoo.com/",
    "https://query1.finance.yahoo.com/v1/test/getcrumb",
)
# Le crumb peut être servi par l'un ou l'autre hôte ; ils ne sont pas bloqués de la même façon.
_CRUMB_HOSTS = ("https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com")

# En-têtes de navigateur complets : une requête trop nue est refusée depuis un centre de données.
_BROWSER_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
}


# ---------------------------------------------------------------------------
# Cache mémoire des historiques
# ---------------------------------------------------------------------------
# Un scan de marché demande l'historique de plusieurs centaines de titres, 8 en parallèle,
# et chacun partait en aller-retour complet vers Yahoo — c'est le principal déclencheur des
# HTTP 429. Les clôtures quotidiennes ne bougeant qu'une fois par jour, quelques minutes de
# mémoire suffisent à absorber les rescans et les allers-retours entre onglets.
# Volontairement en mémoire seule : au redémarrage on repart d'un cache vide, sans état à gérer.
_HISTORY_CACHE = {}                  # {symbole: (expiration_ts, charge_utile)}
_HISTORY_CACHE_LOCK = threading.Lock()
_HISTORY_TTL = 900                   # 15 min
_HISTORY_CACHE_MAX = 1000            # ~40 Ko par entrée → plafond de l'ordre de 40 Mo


def _history_cache_get(sym):
    """Charge utile encore valide pour ce symbole, sinon None."""
    with _HISTORY_CACHE_LOCK:
        found = _HISTORY_CACHE.get(sym)
        if not found:
            return None
        expire, payload = found
        if time.time() >= expire:
            _HISTORY_CACHE.pop(sym, None)
            return None
        return payload


def _history_cache_put(sym, payload):
    """Mémorise une réponse VALIDE (jamais une erreur) et borne la taille du cache."""
    with _HISTORY_CACHE_LOCK:
        if len(_HISTORY_CACHE) >= _HISTORY_CACHE_MAX:
            now = time.time()
            for k in [k for k, (exp, _) in _HISTORY_CACHE.items() if now >= exp]:
                _HISTORY_CACHE.pop(k, None)
            # Toujours plein malgré la purge : on sacrifie les plus proches de l'expiration.
            if len(_HISTORY_CACHE) >= _HISTORY_CACHE_MAX:
                for k in sorted(_HISTORY_CACHE, key=lambda k: _HISTORY_CACHE[k][0])[:_HISTORY_CACHE_MAX // 4]:
                    _HISTORY_CACHE.pop(k, None)
        _HISTORY_CACHE[sym] = (time.time() + _HISTORY_TTL, payload)


def _collect_cookie():
    """(cookie, source) — premier cookie Yahoo exploitable. ('', '') si aucune source ne répond.

    Un cookie de session (A1/A3, posé par fc.yahoo.com) est le seul qui autorise le crumb ;
    un simple cookie de consentement ne suffit pas. On renvoie la source pour le diagnostic.
    """
    replis = []
    for url in _COOKIE_SOURCES:
        req = urllib.request.Request(url, headers=_BROWSER_HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                set_cookies = resp.headers.get_all("Set-Cookie") or []
        except urllib.error.HTTPError as e:      # ces hôtes posent le cookie même en 4xx
            set_cookies = e.headers.get_all("Set-Cookie") or []
        except Exception:
            continue
        header = "; ".join(c.split(";", 1)[0] for c in set_cookies)
        if not header:
            continue
        # Un cookie de session prime ; sinon on garde le candidat sous le coude.
        if "A1=" in header or "A3=" in header:
            return header, url
        replis.append((header, url))
    return replis[0] if replis else ("", "")


def _fetch_yahoo_auth():
    """Récupère un cookie de session Yahoo puis un crumb valide pour ce cookie.

    Lève une RuntimeError dont le message nomme l'étape en échec : depuis un centre de
    données, Yahoo bloque souvent l'une ou l'autre, et le message générique empêchait
    tout diagnostic à distance.
    """
    cookie_header, source = _collect_cookie()
    if not cookie_header:
        raise RuntimeError("cookie refusé par Yahoo (aucune des sources n'a répondu)")
    session = "session" if ("A1=" in cookie_header or "A3=" in cookie_header) else "consentement seul"

    # L'IP partagée de l'hébergeur est régulièrement limitée par Yahoo (HTTP 429). Le crumb
    # étant ensuite mémorisé pour tout le processus, un seul succès suffit à débloquer
    # l'ensemble des requêtes : quelques reprises espacées valent mieux qu'un abandon.
    dernier = None
    for essai, pause in enumerate((0, 1.5, 4)):
        if pause:
            time.sleep(pause)
        for host in _CRUMB_HOSTS:
            crumb_req = urllib.request.Request(
                host + "/v1/test/getcrumb",
                headers={**_BROWSER_HEADERS, "Accept": "*/*", "Cookie": cookie_header})
            try:
                with urllib.request.urlopen(crumb_req, timeout=10) as resp:
                    crumb = resp.read().decode("utf-8").strip()
            except urllib.error.HTTPError as e:
                dernier = f"HTTP {e.code}"
                continue
            except Exception as e:
                dernier = type(e).__name__
                continue
            if crumb and "<" not in crumb and len(crumb) <= 40:
                return cookie_header, crumb
            dernier = f"réponse inexploitable ({crumb[:20]!r})"
    raise RuntimeError(
        f"crumb refusé ({dernier}, {essai + 1} tentatives) — "
        f"cookie {session} obtenu via {source.split('//')[-1].split('/')[0]}")


def _crumb_keeper():
    """Fil de fond : acquiert puis conserve un crumb Yahoo, et se répare tout seul.

    Depuis une IP d'hébergeur (Render), le crumb est souvent refusé à froid (429). Plutôt
    que de dépendre d'une requête utilisateur qui tomberait par chance sur une fenêtre
    ouverte, on réessaie ici en continu : dès que Yahoo laisse passer, le crumb est mémorisé
    pour tout le processus et l'app fonctionne — comme avant, sans intervention.
    """
    while True:
        besoin = (not _YAHOO_AUTH["crumb"]) or (time.time() < _AUTH_FAIL["until"])
        if besoin:
            try:
                cookie, crumb = _fetch_yahoo_auth()
                with _YAHOO_AUTH_LOCK:
                    _YAHOO_AUTH["cookie"], _YAHOO_AUTH["crumb"] = cookie, crumb
                    _AUTH_FAIL["until"] = 0.0
            except Exception:
                pass  # on réessaiera au prochain tour
        time.sleep(120)


def _keep_warm():
    """Auto-ping pour empêcher Render de s'endormir (plan gratuit : arrêt après ~15 min
    sans requête entrante). Un appel à sa propre URL publique compte comme trafic entrant :
    le processus — donc le fil du crumb ci-dessus — reste actif en permanence, et les
    fondamentaux redeviennent fiables même quand personne n'utilise l'app.

    Ne fait rien en local : `RENDER_EXTERNAL_URL` n'est posé que par Render.
    """
    base = os.environ.get("RENDER_EXTERNAL_URL")
    if not base:
        return
    url = base.rstrip("/") + "/api/ping"
    while True:
        time.sleep(600)  # 10 min, sous le seuil d'inactivité de ~15 min
        try:
            urllib.request.urlopen(
                urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=15).read()
        except Exception:
            pass


def _get_yahoo_crumb(force_refresh=False):
    """Renvoie (cookie, crumb), en régénérant si absent ou si force_refresh."""
    with _YAHOO_AUTH_LOCK:
        if force_refresh or not _YAHOO_AUTH["crumb"]:
            if time.time() < _AUTH_FAIL["until"]:
                raise RuntimeError(_AUTH_FAIL["reason"])   # échec récent : on ne réessaie pas tout de suite
            try:
                _YAHOO_AUTH["cookie"], _YAHOO_AUTH["crumb"] = _fetch_yahoo_auth()
            except Exception as e:
                _AUTH_FAIL["until"] = time.time() + _AUTH_FAIL_TTL
                _AUTH_FAIL["reason"] = str(e)
                raise
            _AUTH_FAIL["until"] = 0.0                       # succès : on repart de zéro
        return _YAHOO_AUTH["cookie"], _YAHOO_AUTH["crumb"]


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
    profile = node.get("assetProfile") or {}

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
        "dividendRate": _pick(summary, "dividendRate") or _pick(summary, "trailingAnnualDividendRate"),
        "recommendationKey": rec if isinstance(rec, str) else None,
        "recommendationMean": _pick(fin, "recommendationMean"),
        "numberOfAnalystOpinions": _pick(fin, "numberOfAnalystOpinions"),
        "targetMeanPrice": _pick(fin, "targetMeanPrice"),
        # Flux de trésorerie et dette : servent au FCF Yield et à la dette nette.
        "freeCashflow": _pick(fin, "freeCashflow"),
        "totalDebt": _pick(fin, "totalDebt"),
        "totalCash": _pick(fin, "totalCash"),
        "ebitda": _pick(fin, "ebitda"),
        "sharesOutstanding": _pick(stats, "sharesOutstanding"),
        # Secteur / industrie (assetProfile) — pour la revue de portefeuille (comparaison sectorielle).
        "sector": profile.get("sector") if isinstance(profile.get("sector"), str) else None,
        "industry": profile.get("industry") if isinstance(profile.get("industry"), str) else None,
        # Résultat net par exercice, du plus ancien au plus récent (régularité du BNA).
        "netIncomeHistory": _net_income_history(node),
    }


def _net_income_history(node):
    """[{year, netIncome}] du plus ancien au plus récent. Liste vide si le module manque."""
    statements = (node.get("incomeStatementHistory") or {}).get("incomeStatementHistory") or []
    out = []
    for st in statements:
        if not isinstance(st, dict):
            continue
        net = _pick(st, "netIncome")
        end = st.get("endDate")
        year = None
        if isinstance(end, dict):
            fmt = end.get("fmt")
            if isinstance(fmt, str) and len(fmt) >= 4 and fmt[:4].isdigit():
                year = int(fmt[:4])
        if net is None or year is None:
            continue
        out.append({"year": year, "netIncome": net})
    out.sort(key=lambda x: x["year"])
    return out


class Handler(SimpleHTTPRequestHandler):
    """Fichiers statiques + routes /api/history, /api/search, /api/news, /api/screener."""

    # Type MIME correct pour le manifeste PWA (sinon servi en octet-stream, refusé par le navigateur).
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
    }

    def do_GET(self):
        parsed = urlparse(self.path)

        # « / » sert index.html (comportement natif de SimpleHTTPRequestHandler). L'ancienne
        # URL mono-fichier y est redirigée, en conservant la requête (?selftest=1).
        if parsed.path == ANCIENNE_PAGE:
            self.send_response(301)
            self.send_header("Location", "/" + (f"?{parsed.query}" if parsed.query else ""))
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        # Rien de ce qui commence par un point n'est public : .git/ contient tout
        # l'historique du dépôt, .claude/ et .superpowers/ des notes de travail.
        if any(seg.startswith(".") for seg in parsed.path.split("/") if seg):
            return self.send_error(404, "Not Found")

        if parsed.path == "/api/history":
            self.handle_history(parse_qs(parsed.query))
        elif parsed.path == "/api/search":
            self.handle_search(parse_qs(parsed.query))
        elif parsed.path == "/api/news":
            self.handle_news(parse_qs(parsed.query))
        elif parsed.path == "/api/screener":
            self.handle_screener(parse_qs(parsed.query))
        elif parsed.path == "/api/fundamentals":
            self.handle_fundamentals(parse_qs(parsed.query))
        elif parsed.path == "/api/ping":
            # Réveil : cible de l'auto-ping anti-endormissement. Indique aussi si le
            # crumb Yahoo est prêt, pratique pour vérifier l'état depuis l'extérieur.
            self.send_json({"ok": True, "crumb": bool(_YAHOO_AUTH["crumb"])})
        else:
            super().do_GET()

    # --- utilitaire : réponse JSON ---
    def send_json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    # --- route /api/history?symbol=XXX ---
    def handle_history(self, qs):
        sym = (qs.get("symbol") or [""])[0].strip().upper()
        if not sym or len(sym) > 15:
            return self.send_json(
                {"error": "symbol", "message": "Ticker manquant ou invalide."}, 400)

        cached = _history_cache_get(sym)
        if cached is not None:
            return self.send_json(cached)

        url = YAHOO_URL.format(sym=urllib.parse.quote(sym))
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return self.send_json(
                    {"error": "symbol",
                     "message": f"Ticker « {sym} » inconnu de Yahoo Finance. "
                                f"Pour l'Europe : MC.PA, TTE.PA (Paris), SAP.DE "
                                f"(Francfort), SHEL.L (Londres), ASML.AS (Amsterdam)."},
                    404)
            if e.code == 429:
                return self.send_json(
                    {"error": "ratelimit",
                     "message": "Yahoo Finance limite temporairement les requêtes. "
                                "Attendez une minute puis réessayez."}, 502)
            return self.send_json(
                {"error": "http",
                 "message": f"Yahoo Finance a répondu HTTP {e.code}."}, 502)
        except Exception:
            return self.send_json(
                {"error": "network",
                 "message": "Impossible de joindre Yahoo Finance. "
                            "Vérifiez votre connexion Internet."}, 502)

        # --- Normalisation : {dates:[...], closes:[...]} du plus récent au plus ancien
        try:
            result = data["chart"]["result"][0]
            timestamps = result["timestamp"]
            closes = result["indicators"]["quote"][0]["close"]

            # On garde une seule clôture par date (la dernière), on écarte les nulls
            by_date = {}
            for ts, close in zip(timestamps, closes):
                if close is None:
                    continue
                day = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
                by_date[day] = float(close)

            pairs = sorted(by_date.items(), reverse=True)[:HISTORY_KEEP]
            if len(pairs) < 2:
                raise ValueError("historique trop court")

            currency = (result.get("meta") or {}).get("currency")
            payload = {
                "dates":   [p[0] for p in pairs],
                "closes":  [p[1] for p in pairs],
                "currency": currency,
            }
            _history_cache_put(sym, payload)   # seules les réponses valides sont mémorisées
            return self.send_json(payload)
        except Exception:
            return self.send_json(
                {"error": "format",
                 "message": f"Réponse Yahoo inattendue pour {sym}."}, 502)

    # --- route /api/search?q=nom d'entreprise ---
    def handle_search(self, qs):
        q = (qs.get("q") or [""])[0].strip()
        if not q or len(q) > 60:
            return self.send_json({"error": "query", "message": "Recherche manquante ou trop longue."}, 400)

        url = SEARCH_URL.format(q=urllib.parse.quote(q))
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                return self.send_json(
                    {"error": "ratelimit",
                     "message": "Yahoo Finance limite temporairement les requêtes de recherche."}, 502)
            return self.send_json(
                {"error": "http", "message": f"Yahoo Finance a répondu HTTP {e.code}."}, 502)
        except Exception:
            return self.send_json(
                {"error": "network",
                 "message": "Impossible de joindre Yahoo Finance."}, 502)

        try:
            quotes = data.get("quotes") or []
            results = [
                {
                    "symbol": item["symbol"],
                    "name": item.get("shortname") or item.get("longname") or item["symbol"],
                    "exchange": item.get("exchange", ""),
                    "type": item.get("quoteType", ""),
                }
                for item in quotes
                if item.get("symbol") and item.get("quoteType") in ("EQUITY", "ETF")
            ]
            return self.send_json({"results": results})
        except Exception:
            return self.send_json(
                {"error": "format", "message": "Réponse de recherche Yahoo inattendue."}, 502)

    # --- route /api/news?symbol=XXX : actualités récentes pour un ticker ---
    def handle_news(self, qs):
        sym = (qs.get("symbol") or [""])[0].strip().upper()
        if not sym or len(sym) > 15:
            return self.send_json({"error": "symbol", "message": "Ticker manquant ou invalide."}, 400)

        url = NEWS_URL.format(sym=urllib.parse.quote(sym))
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                return self.send_json(
                    {"error": "ratelimit", "message": "Yahoo Finance limite temporairement les requêtes."}, 502)
            return self.send_json({"error": "http", "message": f"Yahoo Finance a répondu HTTP {e.code}."}, 502)
        except Exception:
            return self.send_json({"error": "network", "message": "Impossible de joindre Yahoo Finance."}, 502)

        try:
            items = data.get("news") or []
            news = []
            for n in items:
                if not n.get("title") or not n.get("link"):
                    continue
                ts = n.get("providerPublishTime")
                date = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%d/%m/%Y") if ts else None
                news.append({
                    "title": n["title"],
                    "link": n["link"],
                    "publisher": n.get("publisher", ""),
                    "date": date,
                })
            return self.send_json({"news": news})
        except Exception:
            return self.send_json({"error": "format", "message": "Réponse actualités Yahoo inattendue."}, 502)

    # --- route /api/screener?scrId=XXX&count=N : listes prédéfinies Yahoo ---
    def handle_screener(self, qs):
        scr = (qs.get("scrId") or [""])[0].strip()
        if scr not in SCREENER_ALLOWED:
            return self.send_json(
                {"error": "scrId", "message": "Catégorie de screener invalide ou non autorisée."}, 400)
        try:
            count = max(1, min(250, int((qs.get("count") or ["100"])[0])))
        except ValueError:
            count = 100

        url = SCREENER_URL.format(count=count, scr=urllib.parse.quote(scr))
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                return self.send_json(
                    {"error": "ratelimit", "message": "Yahoo Finance limite temporairement les requêtes."}, 502)
            return self.send_json({"error": "http", "message": f"Yahoo Finance a répondu HTTP {e.code}."}, 502)
        except Exception:
            return self.send_json({"error": "network", "message": "Impossible de joindre Yahoo Finance."}, 502)

        try:
            result = (data.get("finance", {}).get("result") or [{}])[0]
            quotes = result.get("quotes") or []
            results = [
                {"symbol": q["symbol"], "name": q.get("shortName") or q.get("longName") or q["symbol"]}
                for q in quotes if q.get("symbol")
            ]
            return self.send_json({"results": results})
        except Exception:
            return self.send_json({"error": "format", "message": "Réponse de screener Yahoo inattendue."}, 502)

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
            except Exception as e:
                # La cause exacte est indispensable : depuis un hébergeur, Yahoo bloque
                # tantôt le cookie tantôt le crumb, et un message générique rend le
                # diagnostic à distance impossible.
                return self.send_json(
                    {"error": "network",
                     "message": f"Impossible d'authentifier auprès de Yahoo Finance ({e})."}, 502)

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

    def list_directory(self, path):
        """Aucun listing de dossier, nulle part (/docs/, /tests/...). 404 à la place."""
        self.send_error(404, "Not Found")
        return None

    # Journal minimal (une ligne par requête API seulement)
    def log_message(self, fmt, *args):
        # `args[0]` n'est pas toujours la ligne de requête : log_error() appelle ce même
        # journal avec un code HTTP entier en premier argument. Le test d'appartenance
        # levait alors un TypeError qui tuait le fil de la requête — toute réponse 404
        # (fichier absent, chemin refusé) fermait la connexion sans rien renvoyer.
        first = str(args[0]) if args else ""
        if "/api/" in first:
            print(self.address_string(), "-", first)


if __name__ == "__main__":
    print(f"┌─ TERMINAL boursier ─────────────────────────────┐")
    print(f"│  Ouvrez :  http://{'localhost' if HOST == '127.0.0.1' else HOST}:{PORT}")
    print(f"│  Source de données : Yahoo Finance (gratuit)    │")
    print(f"│  Arrêt : Ctrl+C                                 │")
    print(f"└─────────────────────────────────────────────────┘")
    # Fils de fond : garder le crumb Yahoo vivant, et garder le serveur éveillé sur Render.
    threading.Thread(target=_crumb_keeper, daemon=True).start()
    threading.Thread(target=_keep_warm, daemon=True).start()
    handler = partial(Handler, directory=APP_DIR)
    ThreadingHTTPServer((HOST, PORT), handler).serve_forever()
