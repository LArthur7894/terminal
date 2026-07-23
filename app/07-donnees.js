"use strict";

/* ============================================================================
   Accès aux données : taux de change, historiques et fondamentaux via le
   relais /api/ de server.py, analyse d'un ticker, autocomplétion.
   ============================================================================ */

/* ============================= TAUX DE CHANGE (FX) =============================
 * Les agrégats du portefeuille (total, allocation, courbe) sont convertis vers
 * une devise de référence. Les taux viennent de la paire Yahoo {FROM}{TO}=X
 * (ex. USDEUR=X = nombre de TO pour 1 FROM), via le relais /api/history.
 * Cache mémoire + localStorage, rafraîchi au-delà de 12 h.
 * ============================================================================ */

const FX_MAX_AGE_MS = 12 * 3600 * 1000;
const FX_CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "JPY", "AUD"];

function getBaseCurrency() {
  const c = lsGet(LS.baseCurrency, "EUR");
  return FX_CURRENCIES.includes(c) ? c : "EUR";
}

// Devise native d'une position = devise du cours en cache, sinon inconnue (null).
function positionCurrency(pos) {
  const entry = cache[pos.ticker];
  return (entry && entry.hist && entry.hist.currency) ? entry.hist.currency : null;
}

// Lecture SYNCHRONE du cache (aucun réseau). Renvoie le taux ou null si absent.
function fxRateCached(from, to) {
  if (from === to) return 1;
  const hit = fxRates[`${from}->${to}`];
  return hit && isFinite(hit.rate) && hit.rate > 0 ? hit.rate : null;
}

// Récupère (et met en cache) le taux from->to. Renvoie le nombre ou null si échec.
async function getFxRate(from, to) {
  if (from === to) return 1;
  const k = `${from}->${to}`;
  const hit = fxRates[k];
  if (hit && isFinite(hit.rate) && hit.rate > 0
      && Date.now() - new Date(hit.updated).getTime() < FX_MAX_AGE_MS) {
    return hit.rate; // frais → pas de réseau
  }
  if (location.protocol === "file:") return fxRateCached(from, to); // pas de relais dispo

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch("/api/history?symbol=" + encodeURIComponent(`${from}${to}=X`),
                             { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await resp.json();
    const rate = data && Array.isArray(data.closes) ? Number(data.closes[0]) : NaN;
    if (!isFinite(rate) || rate <= 0) return fxRateCached(from, to);
    fxRates[k] = { rate, updated: new Date().toISOString() };
    lsSet(LS.fx, fxRates);
    return rate;
  } catch {
    clearTimeout(timer);
    return fxRateCached(from, to); // échec réseau → on retombe sur l'ancien taux s'il existe
  }
}

// Pré-charge tous les taux nécessaires (devises du portefeuille ≠ base), puis re-render
// pour que renderPositions (synchrone) trouve les taux dans le cache.
async function ensureFxRates() {
  const base = getBaseCurrency();
  const needed = new Set();
  for (const pos of positions) {
    const cur = positionCurrency(pos);
    if (cur && cur !== base) needed.add(cur);
  }
  if (needed.size === 0) return;
  const before = JSON.stringify(fxRates);
  await Promise.all([...needed].map(cur => getFxRate(cur, base)));
  if (JSON.stringify(fxRates) !== before) renderPositions();
}

/**
 * Récupère l'historique quotidien d'un ticker — la seule requête de cours de l'app.
 * Source unique : Yahoo Finance, via le relais /api/history exposé par server.py
 * (gratuit, sans clé, sans quota). Nécessite donc que l'app soit lancée avec
 * « python3 server.py » et non en double-clic file:// : sinon le relais n'existe pas.
 * Renvoie { dates, closes, currency } du plus récent au plus ancien.
 * Lève une erreur typée { type, message }.
 */
async function fetchDailySeries(ticker) {
  if (location.protocol === "file:") {
    throw {
      type: "noserver",
      message: "L'app doit être servie par le serveur local : lancez « python3 server.py » puis ouvrez http://localhost:8750.",
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch("/api/history?symbol=" + encodeURIComponent(ticker), { signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") {
      throw { type: "timeout", message: `Délai dépassé (${FETCH_TIMEOUT_MS / 1000}s) pour ${ticker}. Réessayez.` };
    }
    throw { type: "network", message: "Le serveur local ne répond pas. Vérifiez que « python3 server.py » tourne toujours." };
  }
  clearTimeout(timer);

  let data;
  try {
    data = await resp.json();
  } catch {
    throw { type: "noserver", message: "Réponse inattendue : l'app ne semble pas servie par server.py. Lancez « python3 server.py » et ouvrez http://localhost:8750." };
  }

  // server.py renvoie {error, message} en cas de problème (ticker inconnu, réseau…)
  if (data.error) {
    throw { type: data.error, message: data.message || `Erreur ${data.error} pour ${ticker}.` };
  }
  if (!Array.isArray(data.closes) || data.closes.length < 2) {
    throw { type: "format", message: `Historique invalide pour ${ticker}.` };
  }
  return { dates: data.dates, closes: data.closes, currency: data.currency || null };
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

/* ============================= ANALYSE D'UN TICKER ============================= */

/**
 * Chaîne complète pour un ticker : requête API → indicateurs → score →
 * mise en cache. Toute erreur est affichée en toast, jamais de crash silencieux.
 */
async function analyzeTicker(ticker, button, opts = {}) {
  const { silent = false, skipRender = false, store = cache, skipFund = false } = opts;
  if (button) { button.disabled = true; button.textContent = "…"; }
  try {
    const hist = await fetchDailySeries(ticker);
    const ind = computeIndicators(hist);
    const score = computeScore(ind);

    // Fondamentaux : facultatifs, et sautés en masse (scan marché) via skipFund.
    // Une panne ici ne doit jamais casser l'analyse technique.
    let fund = null;
    if (!skipFund) {
      try { fund = await fetchFundamentals(ticker); }
      catch (e) { fund = null; /* silencieux : l'UI affichera « indisponible » */ }
    }
    const fundScore = computeFundScore(fund, ind ? ind.price : null);

    store[ticker] = {
      updated: new Date().toISOString(),
      hist,                 // historique tronqué → cache réutilisable hors ligne
      ind,
      score,
      signal: signalFromScore(score),
      fund,
      fundScore,
    };
    // Seul le cache persistant (watchlist) est écrit en localStorage — le cache du
    // scan marché (store === marketCache) reste volontairement en mémoire.
    if (store === cache) lsSet(LS.cache, cache);
    if (!silent) toast(`${ticker} analysé — score ${score}/100 (${store[ticker].signal}).`, "success");
  } catch (err) {
    if (!silent) toast(err.message || `Erreur inconnue sur ${ticker}.`, err.type === "ratelimit" ? "warn" : "error");
  } finally {
    if (!skipRender) renderAll();
  }
}

/* ============================= AUTOCOMPLETE RECHERCHE D'ENTREPRISE ============================= */

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_MIN_CHARS = 2;

/**
 * Branche une recherche par nom d'entreprise sur un champ texte : à la frappe,
 * affiche des suggestions (ticker + nom + place boursière) via /api/search
 * (relais Yahoo Finance dans server.py). Nécessite l'app servie par
 * « python3 server.py » (pas file://) ; sinon la saisie manuelle du ticker
 * reste utilisable normalement, sans suggestions.
 */
function attachTickerAutocomplete(input, dropdown, onPick) {
  let debounceTimer = null;
  let abortCtrl = null;
  let items = [];
  let highlighted = -1;

  function close() {
    dropdown.classList.add("hidden");
    dropdown.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    items = [];
    highlighted = -1;
  }

  function highlight(index) {
    const opts = dropdown.querySelectorAll(".suggestion-item");
    opts.forEach(o => o.classList.remove("highlighted"));
    if (index >= 0 && index < opts.length) {
      opts[index].classList.add("highlighted");
      opts[index].scrollIntoView({ block: "nearest" });
      input.setAttribute("aria-activedescendant", opts[index].id);
    } else {
      input.removeAttribute("aria-activedescendant");
    }
    highlighted = index;
  }

  function pick(item) {
    close();
    onPick(item);
  }

  function render(list, state) {
    items = state === "ok" ? list : [];
    highlighted = -1;
    dropdown.innerHTML = "";

    if (state === "loading") {
      dropdown.innerHTML = `<li class="suggestion-loading">Recherche…</li>`;
    } else if (state === "empty") {
      dropdown.innerHTML = `<li class="suggestion-empty">Aucun résultat.</li>`;
    } else {
      list.forEach((item, i) => {
        const li = document.createElement("li");
        li.className = "suggestion-item";
        li.id = `${dropdown.id}-opt-${i}`;
        li.setAttribute("role", "option");
        li.innerHTML = `
          <span class="s-symbol">${esc(item.symbol)}</span>
          <span class="s-name">${esc(item.name)}</span>
          <span class="s-exchange">${esc(item.exchange)}</span>`;
        // mousedown (pas click) pour agir avant le blur du champ
        li.addEventListener("mousedown", e => { e.preventDefault(); pick(item); });
        dropdown.appendChild(li);
      });
    }

    dropdown.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
  }

  input.addEventListener("input", () => {
    const q = input.value.trim();
    clearTimeout(debounceTimer);
    if (abortCtrl) abortCtrl.abort();

    if (location.protocol === "file:" || q.length < SEARCH_MIN_CHARS) {
      close();
      return;
    }

    render([], "loading");

    debounceTimer = setTimeout(async () => {
      abortCtrl = new AbortController();
      try {
        const resp = await fetch("/api/search?q=" + encodeURIComponent(q), { signal: abortCtrl.signal });
        const data = await resp.json();
        if (data.error || !Array.isArray(data.results)) { close(); return; }
        render(data.results, data.results.length ? "ok" : "empty");
      } catch (e) {
        if (e.name !== "AbortError") close();
      }
    }, SEARCH_DEBOUNCE_MS);
  });

  input.addEventListener("keydown", e => {
    if (dropdown.classList.contains("hidden") || items.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); highlight(Math.min(highlighted + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight(Math.max(highlighted - 1, 0)); }
    else if (e.key === "Enter") { if (highlighted >= 0) { e.preventDefault(); pick(items[highlighted]); } }
    else if (e.key === "Escape") { close(); }
  });

  // Léger délai pour laisser le mousedown de la suggestion s'exécuter avant le blur.
  // On annule aussi la recherche en cours : sans ça, une réponse arrivant après le
  // blur pourrait rouvrir le menu alors que le champ a déjà perdu le focus.
  input.addEventListener("blur", () => {
    clearTimeout(debounceTimer);
    if (abortCtrl) abortCtrl.abort();
    setTimeout(close, 150);
  });
}

attachTickerAutocomplete(
  document.getElementById("input-ticker"),
  document.getElementById("ticker-suggestions"),
  item => {
    if (addTickerToWatchlist(item.symbol, item.name)) {
      document.getElementById("input-ticker").value = "";
    }
  }
);

attachTickerAutocomplete(
  document.getElementById("pos-ticker"),
  document.getElementById("pos-ticker-suggestions"),
  item => {
    document.getElementById("pos-ticker").value = item.symbol;
    rememberTickerName(item.symbol, item.name);
    document.getElementById("pos-qty").focus();
  }
);
