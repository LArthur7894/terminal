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

/**
 * Score d'opportunité 0–100 (plus haut = configuration technique
 * potentiellement plus favorable à l'achat) :
 *   - RSI (0–40 pts)  : survente (≤30) = 40 pts, surachat (≥70) = 0, linéaire entre.
 *   - Croisement SMA (0–30 pts) : golden cross (SMA50 > SMA200) = 30, death cross = 0.
 *   - Range 52 sem. (0–30 pts) : proche du plus bas = 30, proche du plus haut = 0.
 * Composante neutre (moitié des points) si les données manquent.
 */
function computeScore(ind) {
  let score = 0;

  if (ind.rsi !== null) {
    if (ind.rsi <= 30) score += 40;
    else if (ind.rsi >= 70) score += 0;
    else score += 40 * (70 - ind.rsi) / 40; // linéaire entre 30 et 70
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

function signalFromScore(score) {
  if (score >= 65) return "Achat";
  if (score <= 35) return "Vente";
  return "Neutre";
}
