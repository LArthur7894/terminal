"use strict";

/* ============================================================================
   Socle : profils, constantes, accès localStorage, formatage, toasts.
   Chargé en premier — tout le reste en dépend.
   ============================================================================ */

/* ============================= PROFILS (identification simple, sans mot de passe) =============================
   Chaque profil (un simple prénom) a ses propres données : watchlist, positions,
   cache d'analyses, etc. Techniquement, toutes les clés localStorage de l'app sont
   automatiquement préfixées par le profil actif via lsGet/lsSet (plus bas) — un seul
   point de branchement, aucune autre fonction de l'app n'a besoin d'en avoir conscience.
   Doit s'exécuter EN TOUT PREMIER, avant toute lecture de données (watchlist, cache...). */

const PROFILES_KEY = "term_profiles";           // liste des prénoms connus (non namespacé)
const CURRENT_PROFILE_KEY = "term_current_profile"; // profil actif (non namespacé)

function loadProfileList() {
  try { return JSON.parse(localStorage.getItem(PROFILES_KEY)) || []; } catch { return []; }
}
function saveProfileList(list) {
  try { localStorage.setItem(PROFILES_KEY, JSON.stringify(list)); } catch { /* stockage plein, tant pis */ }
}

// Choisit (ou crée) le profil actif. Bloquant volontairement (window.prompt) : l'app
// ne doit lire aucune donnée tant qu'on ne sait pas de quel profil il s'agit.
function pickProfile() {
  // Mode auto-tests : jamais de fenêtre bloquante. `window.prompt` suspend TOUT le script
  // tant qu'on n'a pas répondu — dans un navigateur automatisé (ou si prompt est désactivé),
  // la page reste figée et rien ne s'initialise. On travaille alors sur un profil dédié,
  // ce qui a l'avantage de ne toucher à aucune donnée réelle.
  // Note : on relit location.search ici plutôt que d'utiliser SELFTEST_MODE, déclaré bien
  // plus bas — une const y serait dans sa zone morte temporelle à ce stade du chargement.
  if (new URLSearchParams(location.search).has("selftest")) return "__selftest__";

  const profiles = loadProfileList();
  const remembered = localStorage.getItem(CURRENT_PROFILE_KEY);
  if (remembered && profiles.includes(remembered)) return remembered;

  const hint = profiles.length ? `Profils existants : ${profiles.join(", ")}.\n\n` : "";
  const input = window.prompt(`${hint}Quel est votre prénom ? (nouveau ou existant)`, profiles[0] || "");
  const name = (input || "Invité").trim().slice(0, 24) || "Invité";
  if (!profiles.includes(name)) {
    profiles.push(name);
    saveProfileList(profiles);
  }
  localStorage.setItem(CURRENT_PROFILE_KEY, name);
  return name;
}

let currentProfile = pickProfile();

// Change de profil actif et recharge la page : le plus simple et le plus fiable pour
// que toutes les variables déjà initialisées (watchlist, cache, positions...) repartent
// proprement du bon jeu de données, sans dupliquer la logique d'initialisation.
function switchProfile() {
  const profiles = loadProfileList();
  const hint = profiles.length ? `Profils existants : ${profiles.join(", ")}.\n\n` : "";
  const input = window.prompt(`${hint}Changer de profil — quel prénom ?`, currentProfile);
  if (!input) return;
  const name = input.trim().slice(0, 24);
  if (!name) return;
  if (!profiles.includes(name)) {
    profiles.push(name);
    saveProfileList(profiles);
  }
  localStorage.setItem(CURRENT_PROFILE_KEY, name);
  location.reload();
}

/* ============================= CONSTANTES ============================= */

const HISTORY_KEEP = 420;      // Jours de bourse conservés en cache (> 252 + 200 marge)
const FETCH_TIMEOUT_MS = 20000;

// Clés localStorage (préfixées pour éviter les collisions)
const LS = {
  watchlist:    "term_watchlist",
  cache:        "term_cache",
  positions:    "term_positions",
  autopickLast: "term_autopick_last",
  marketScanLast: "term_market_scan_last",
  tickerNames: "term_ticker_names",
  weightTech: "term_weight_tech", // part du score technique dans le score global (0..1)
  filters: "term_filters", // critères de filtre par tableau {wl:{...}, mk:{...}}, par profil
  alerts: "term_alerts", // règles d'alerte par profil
  bot: "term_bot", // portefeuille du bot paper-trading, par profil
  perfJournal: "term_perf_journal", // historique valeur portefeuille {date,value}, par profil
  fx: "term_fx", // taux de change en cache { "FROM->TO": {rate, updated} }, par profil
  baseCurrency: "term_base_currency", // devise de référence du portefeuille (défaut EUR)
};

/* ============================= HELPERS localStorage ============================= */

// Toutes les clés sont automatiquement scopées au profil actif (voir section PROFILS
// tout en haut du script) : aucun autre appelant n'a besoin de s'en soucier.
function profileScopedKey(key) {
  return `${key}::${currentProfile}`;
}

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(profileScopedKey(key));
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(profileScopedKey(key), JSON.stringify(value));
  } catch (e) {
    toast("Impossible d'écrire dans localStorage (stockage plein ?).", "error");
  }
}

/* ============================= FORMATAGE ============================= */

const fmtNum = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fnum(v) { return v === null || v === undefined || !isFinite(v) ? "—" : fmtNum.format(v); }
function fpct(v) { return v === null || v === undefined || !isFinite(v) ? "—" : (v > 0 ? "+" : "") + fmtNum.format(v) + " %"; }
function pctClass(v) { return v > 0 ? "up" : v < 0 ? "down" : ""; }

function fdate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
    + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Le cache est considéré "ancien" au-delà de 24 h.
function isStale(entry) {
  return entry && (Date.now() - new Date(entry.updated).getTime()) > 24 * 3600 * 1000;
}

function esc(s) {
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

/* ============================= TOASTS ============================= */

function toast(message, kind = "info") {
  const zone = document.getElementById("toast-zone");
  const el = document.createElement("div");
  el.className = "toast" + (kind !== "info" ? ` toast-${kind}` : "");
  el.textContent = message;
  zone.appendChild(el);
  setTimeout(() => el.remove(), 7000);
}
