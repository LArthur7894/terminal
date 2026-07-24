"use strict";

/* ============================================================================
   Indicateurs techniques calculés localement (RSI, SMA, MACD, Bollinger…)
   et score technique. Fonctions pures, aucun appel réseau.
   ============================================================================ */

/* ============================= INDICATEURS (calcul local) ============================= */

/**
 * Calcule tous les indicateurs à partir de l'historique de clôtures
 * (closes[0] = jour le plus récent). Zéro appel réseau.
 */
function computeIndicators(hist) {
  const c = hist.closes;
  const price = c[0];
  const prevClose = c[1];
  const changePct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;

  // --- RSI 14 jours, méthode de Wilder (lissage exponentiel 1/14) ---
  // On travaille en ordre chronologique (ancien → récent).
  let rsi = null;
  const chrono = [...c].reverse();
  if (chrono.length >= 15) {
    let gains = 0, losses = 0;
    // Moyennes simples sur les 14 premières variations
    for (let i = 1; i <= 14; i++) {
      const d = chrono[i] - chrono[i - 1];
      if (d > 0) gains += d; else losses -= d;
    }
    let avgGain = gains / 14;
    let avgLoss = losses / 14;
    // Lissage de Wilder sur le reste de l'historique
    for (let i = 15; i < chrono.length; i++) {
      const d = chrono[i] - chrono[i - 1];
      avgGain = (avgGain * 13 + Math.max(d, 0)) / 14;
      avgLoss = (avgLoss * 13 + Math.max(-d, 0)) / 14;
    }
    rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  // --- Moyennes mobiles simples ---
  const sma = n => c.length >= n ? c.slice(0, n).reduce((a, b) => a + b, 0) / n : null;
  const sma50 = sma(50);
  const sma200 = sma(200);

  // --- Range 52 semaines (~252 jours de bourse) ---
  const yearSlice = c.slice(0, Math.min(252, c.length));
  const high52 = Math.max(...yearSlice);
  const low52  = Math.min(...yearSlice);
  // Position du cours dans le range : 0 = au plus bas, 1 = au plus haut
  const rangePos = high52 > low52 ? (price - low52) / (high52 - low52) : 0.5;

  // --- MACD 12/26/9 (lissage exponentiel sur l'historique chronologique) ---
  let macd = null;
  if (chrono.length >= 35) {
    const ema12 = ema(chrono, 12);
    const ema26 = ema(chrono, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = ema(macdLine, 9);
    const line = macdLine[macdLine.length - 1];
    const sig  = signalLine[signalLine.length - 1];
    macd = { line, signal: sig, hist: line - sig, bullish: line > sig };
  }

  // --- Volatilité annualisée sur ~3 mois (écart-type des rendements log) ---
  let vol = null;
  const volWindow = chrono.slice(-63);
  if (volWindow.length >= 21) {
    const rets = [];
    for (let i = 1; i < volWindow.length; i++) rets.push(Math.log(volWindow[i] / volWindow[i - 1]));
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
    vol = Math.sqrt(variance) * Math.sqrt(252) * 100;
  }

  // --- Performance sur plusieurs horizons (en jours de bourse) ---
  const perfSince = n => c.length > n ? ((c[0] - c[n]) / c[n]) * 100 : null;
  const perf = { w1: perfSince(5), m1: perfSince(21), m3: perfSince(63), m6: perfSince(126), y1: perfSince(252) };

  // --- Bandes de Bollinger (20 jours, ±2 écarts-types) ---
  let bollinger = null;
  if (c.length >= 20) {
    const window20 = c.slice(0, 20);
    const sma20 = window20.reduce((a, b) => a + b, 0) / 20;
    const variance20 = window20.reduce((a, b) => a + (b - sma20) ** 2, 0) / 20;
    const stdev20 = Math.sqrt(variance20);
    const upper = sma20 + 2 * stdev20;
    const lower = sma20 - 2 * stdev20;
    const percentB = upper > lower ? (price - lower) / (upper - lower) : 0.5;
    bollinger = { sma20, upper, lower, percentB };
  }

  // --- Oscillateur stochastique 14 jours — approximation à partir des seules clôtures
  // (pas de plus haut/bas intrajournalier disponible avec une source EOD gratuite). ---
  let stochastic = null;
  if (c.length >= 14) {
    const kFor = offset => {
      const w = c.slice(offset, offset + 14);
      const h = Math.max(...w), l = Math.min(...w);
      return h > l ? ((c[offset] - l) / (h - l)) * 100 : 50;
    };
    const kValues = [];
    for (let i = 0; i < 3 && c.length >= 14 + i; i++) kValues.push(kFor(i));
    stochastic = { k: kValues[0], d: kValues.reduce((a, b) => a + b, 0) / kValues.length };
  }

  return { price, changePct, rsi, sma50, sma200, high52, low52, rangePos, macd, vol, perf, bollinger, stochastic };
}

// Moyenne mobile exponentielle (série chronologique ancien → récent).
function ema(values, period) {
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

// Rampe linéaire bornée 0..1 : v ≤ lo → 0, v ≥ hi → 1, interpolé entre. null si v absent.
// Local à ce module (pas de dépendance à piecewise de 03, chargé après).
function _ramp(v, lo, hi) {
  if (v == null || !isFinite(v)) return null;
  if (v <= lo) return 0;
  if (v >= hi) return 1;
  return (v - lo) / (hi - lo);
}

/**
 * Score de RETOUR À LA MOYENNE 0–100 : récompense la faiblesse. C'est le score PAR DÉFAUT.
 *   - RSI (0–40)  : survente (≤30) = 40, surachat (≥70) = 0.
 *   - Golden cross (0–30) : SMA50 > SMA200 = 30.
 *   - Range 52 sem. (0–30) : proche du plus BAS = 30.
 * Validé comme le plus ROBUSTE au backtest walk-forward (positif dans les deux régimes
 * testés 2021-23 et 2024-26) ; le momentum, lui, perd de l'argent en marché baissier.
 */
function scoreMeanReversion(ind) {
  let score = 0;

  if (ind.rsi !== null) {
    if (ind.rsi <= 30) score += 40;
    else if (ind.rsi >= 70) score += 0;
    else score += 40 * (70 - ind.rsi) / 40;
  } else {
    score += 20;
  }

  if (ind.sma50 !== null && ind.sma200 !== null) {
    score += ind.sma50 > ind.sma200 ? 30 : 0;
  } else {
    score += 15;
  }

  score += 30 * (1 - ind.rangePos);

  return Math.round(Math.min(100, Math.max(0, score)));
}

/**
 * Score de MOMENTUM 0–100 : récompense la FORCE (l'inverse du contrarian). Fondé sur
 * l'anomalie de momentum, la mieux documentée sur cet horizon. NON activé par défaut :
 * le backtest walk-forward l'a montré fort en marché haussier (2024-26 : +26 % vs +7 %)
 * mais perdant en marché baissier (2021-23 : −14 % vs +37 %). Disponible dans le
 * laboratoire de backtest pour comparaison, pas dans le signal de trading en direct.
 *   - Structure de tendance (0–35) : cours au-dessus des moyennes, golden cross.
 *   - Momentum moyen terme (0–35) : rendements 3 et 6 mois positifs et soutenus.
 *   - Position dans le range 52 sem. (0–30) : proche des plus HAUTS = force, avec un léger
 *     repli au-delà de 0,97 pour ne pas courir après une parabole.
 * Neutre (moitié des points) quand une donnée manque.
 */
function scoreMomentum(ind) {
  let score = 0;

  // 1) Structure de tendance
  if (ind.sma200 != null && ind.price > 0) {
    if (ind.price > ind.sma200) score += 15;
    if (ind.sma50 != null && ind.sma50 > ind.sma200) score += 12;
    if (ind.sma50 != null && ind.price > ind.sma50) score += 8;
  } else {
    score += 17.5;
  }

  // 2) Momentum moyen terme (rendements 3 et 6 mois, en %)
  const p = ind.perf || {};
  const parts = [];
  const r3 = _ramp(p.m3, 0, 20); if (r3 != null) parts.push(r3);
  const r6 = _ramp(p.m6, 0, 35); if (r6 != null) parts.push(r6);
  score += (parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0.5) * 35;

  // 3) Position dans le range 52 semaines
  if (ind.rangePos != null) {
    const rp = ind.rangePos > 0.97 ? Math.max(0, 0.97 - (ind.rangePos - 0.97)) : ind.rangePos;
    score += 30 * Math.max(0, Math.min(1, rp));
  } else {
    score += 15;
  }

  return Math.round(Math.min(100, Math.max(0, score)));
}

// Score technique par défaut de l'app. On a évalué un virage vers le momentum (2026-07) via
// une comparaison walk-forward au backtest : le momentum gagne en marché haussier mais perd
// en marché baissier, tandis que le retour à la moyenne reste positif dans les deux régimes.
// On garde donc ce dernier par défaut. Le momentum reste testable dans le laboratoire.
function computeScore(ind) {
  return scoreMeanReversion(ind);
}

function signalFromScore(score) {
  if (score >= 65) return "Achat";
  if (score <= 35) return "Vente";
  return "Neutre";
}

MODULES_CHARGES.push("02-indicateurs");   // doit rester la dernière ligne du fichier
