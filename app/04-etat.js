"use strict";

/* ============================================================================
   État global du profil (watchlist, cache, positions, filtres, alertes),
   migration des entrées de cache anciennes et persistance IndexedDB.
   Chargé après 02/03 : la migration recalcule indicateurs et scores.
   ============================================================================ */

/* ============================= ÉTAT GLOBAL ============================= */

let watchlist  = lsGet(LS.watchlist, []);   // ["AAPL", "MC.PA", ...]
let cache      = lsGet(LS.cache, {});       // { TICKER: {updated, hist, ind} }
let positions  = lsGet(LS.positions, []);   // [{id, ticker, qty, pru}]
let tickerNames = lsGet(LS.tickerNames, {}); // { TICKER: "Nom de l'entreprise" }
let fxRates = lsGet(LS.fx, {});             // { "USD->EUR": {rate, updated} }
if (!fxRates || typeof fxRates !== "object") fxRates = {};

// Pondération du score global : part du technique (0..1), le reste va au fondamental.
// Réglable via le curseur de l'onglet Analyse, persistée par profil.
let weightTech = clamp01(Number(lsGet(LS.weightTech, 0.5)));

// Filtres numériques par tableau (wl = watchlist, mk = marché). Valeur absente = critère inactif.
// Persistés par profil. Le tri (sortState) est volontairement en mémoire de session seulement.
let filters = lsGet(LS.filters, { wl: {}, mk: {} });
if (!filters || typeof filters !== "object") filters = { wl: {}, mk: {} };
if (!filters.wl) filters.wl = {};
if (!filters.mk) filters.mk = {};
let sortState = { wl: { col: null, dir: 1 }, mk: { col: null, dir: 1 } };

function saveFilters() { lsSet(LS.filters, filters); }

// Migration : les entrées mises en cache avant l'ajout du MACD / de la volatilité /
// des performances multi-horizons n'ont pas ces champs sur `ind`. On les recalcule
// depuis l'historique déjà stocké (aucun nouvel appel réseau) pour éviter un plantage
// au rendu (ex. onglet Marché/Analyse lisant ind.perf sur une entrée obsolète).
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
  cache[ticker].fundScore = computeFundScore(cache[ticker].fund, (cache[ticker].ind || {}).price);
}
lsSet(LS.cache, cache);

let editingPositionId = null;               // id de la position en cours d'édition
let allocationChart = null;                 // instance Chart.js
let lastBuysimResult = null;                // dernier résultat simulé (simulateur d'achat), pour "Appliquer"
let lastAllocationPlan = null;               // dernière répartition proposée (onglet Allocation), pour "Appliquer"

// Cache du scan marché : EN MÉMOIRE UNIQUEMENT, jamais persisté dans localStorage.
// Stocker l'historique complet (420 jours) de plusieurs milliers de valeurs dépasserait
// vite le quota du navigateur (~5-10 Mo) — seule la watchlist (choix explicite de
// l'utilisateur) mérite d'être conservée entre deux visites. Un ticker scanné et
// ajouté à la watchlist est "promu" vers le cache persistant (voir addTickerToWatchlist).
let marketCache = {};

/* ============================= PERSISTANCE INDEXEDDB (cache marché) ============================= */

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("terminal-boursier", 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("kv"); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const r = db.transaction("kv", "readonly").objectStore("kv").get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Sauvegarde best-effort du cache marché (fire-and-forget).
function saveMarketCache() { idbSet("marketCache", marketCache).catch(() => {}); }

// Chargement au démarrage : élague > 7 jours, migre, fusionne, re-render.
async function loadMarketCache() {
  let saved;
  try { saved = await idbGet("marketCache"); } catch { return; }
  if (!saved || typeof saved !== "object") return;
  const now = Date.now(), WEEK = 7 * 24 * 3600 * 1000;
  for (const [sym, entry] of Object.entries(saved)) {
    if (!entry || !entry.updated) continue;
    if (now - new Date(entry.updated).getTime() > WEEK) continue;
    if (marketCache[sym]) continue;
    let e = entry;
    if (e.hist && (!e.ind || !e.ind.perf || !e.ind.bollinger || !e.ind.stochastic)) {
      const ind = computeIndicators(e.hist), score = computeScore(ind);
      e = { ...e, ind, score, signal: signalFromScore(score) };
    }
    if (e.fund === undefined) e.fund = null;
    e.fundScore = computeFundScore(e.fund, (e.ind || {}).price);
    marketCache[sym] = e;
  }
  renderMarketResults();
  renderAll();
}

// Identifiants uniques pour les positions, même en cas de créations multiples
// dans la même milliseconde (ex. application d'une répartition sur plusieurs lignes).
let nextPositionId = Date.now();
function newPositionId() { return nextPositionId++; }

// Applique un achat (nouvelle ligne ou complément) à `positions`, avec PRU recalculé
// en moyenne pondérée si la position existe déjà. N'écrit pas seul dans localStorage :
// l'appelant doit ensuite lsSet(LS.positions, positions) + renderAll().
function applyPurchase(ticker, price, amount) {
  const qtyBought = amount / price;
  const existing = positions.find(p => p.ticker === ticker);
  if (existing) {
    const newQty = existing.qty + qtyBought;
    existing.pru = (existing.qty * existing.pru + amount) / newQty;
    existing.qty = newQty;
  } else {
    positions.push({ id: newPositionId(), ticker, qty: qtyBought, pru: price });
  }
}

/* ============================= ALERTES ============================= */

let alerts = lsGet(LS.alerts, []);          // règles persistées par profil
if (!Array.isArray(alerts)) alerts = [];
let alertLog = [];                          // journal de session : [{ticker, label, at}]
let nextAlertId = Date.now();
function newAlertId() { return nextAlertId++; }
function saveAlerts() { lsSet(LS.alerts, alerts); }

// Libellé lisible d'une règle.
function alertLabel(a) {
  if (a.type === "price")  return `Prix ${a.direction === "above" ? "≥" : "≤"} ${a.value}`;
  if (a.type === "global") return `Score global ${a.direction === "above" ? "≥" : "≤"} ${a.value}`;
  if (a.type === "rsi")    return a.direction === "oversold" ? `RSI ≤ ${a.value} (survente)` : `RSI ≥ ${a.value} (surachat)`;
  if (a.type === "change") return `Variation du jour ≥ ${a.value} %`;
  return "—";
}

// Évalue toutes les alertes actives sur les données en cache. Hystérésis via triggeredAt.
function checkAlerts() {
  let changed = false;
  for (const a of alerts) {
    if (!a.enabled) continue;
    const e = cache[a.ticker];
    if (!e || !e.ind) { if (a.triggeredAt) { a.triggeredAt = null; changed = true; } continue; }
    let cur = null;
    if (a.type === "price")  cur = e.ind.price;
    else if (a.type === "global") cur = (e.score != null ? computeGlobalScore(e) : null);
    else if (a.type === "rsi")    cur = e.ind.rsi;
    else if (a.type === "change") cur = e.ind.changePct;

    let cond = false;
    if (cur != null && isFinite(cur)) {
      if (a.type === "price" || a.type === "global") cond = a.direction === "above" ? cur >= a.value : cur <= a.value;
      else if (a.type === "rsi") cond = a.direction === "oversold" ? cur <= a.value : cur >= a.value;
      else if (a.type === "change") cond = Math.abs(cur) >= a.value;
    }

    if (cond && !a.triggeredAt) {
      a.triggeredAt = new Date().toISOString();
      changed = true;
      const label = `${a.ticker} — ${alertLabel(a)}`;
      alertLog.unshift({ ticker: a.ticker, label: alertLabel(a), at: a.triggeredAt });
      if (alertLog.length > 30) alertLog.pop();
      toast(`🔔 ${label}`, "warn");
    } else if (!cond && a.triggeredAt) {
      a.triggeredAt = null; changed = true;
    }
  }
  if (changed) saveAlerts();
  if (typeof renderAlerts === "function") renderAlerts();
}

MODULES_CHARGES.push("04-etat");   // doit rester la dernière ligne du fichier
