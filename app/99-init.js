"use strict";

/* ============================================================================
   Auto-tests (?selftest=1) et amorçage de l'application.
   Chargé en dernier : tout le reste doit être défini.
   ============================================================================ */

/* ============================= AUTO-TESTS (?selftest=1) =============================
 * Les trois harnais (bot, fondamentaux, revue) n'étaient appelables qu'à la main depuis
 * la console : en pratique, personne ne les lançait. Ouvrir l'app avec ?selftest=1 les
 * exécute tous et affiche le bilan par-dessus la page — un coup d'œil suffit pour savoir
 * si une modification a cassé quelque chose. Sans le paramètre, rien de tout ceci ne tourne.
 * ============================================================================ */

function runAllSelfTests() {
  const suites = [
    { nom: "bot", res: botSelfTest() },
    { nom: "fondamentaux", res: fundSelfTest() },
    { nom: "revue", res: reviewSelfTest() },
  ];
  const pass = suites.reduce((n, s) => n + s.res.pass, 0);
  const total = suites.reduce((n, s) => n + s.res.total, 0);
  const fail = total - pass;

  const echecs = suites.flatMap(s => s.res.report.filter(r => !r.ok).map(r => `${s.nom} — ${r.name} : ${r.err}`));
  const lignes = suites.map(s =>
    `<li><b>${esc(s.nom)}</b> : ${s.res.pass}/${s.res.total}${s.res.fail ? ` — <span style="color:#ff5c5c">${s.res.fail} en échec</span>` : ""}</li>`).join("");

  const box = document.createElement("div");
  box.setAttribute("role", "status");
  box.style.cssText = "position:fixed;inset:auto 16px 16px auto;z-index:9999;max-width:min(560px,92vw);"
    + "max-height:70vh;overflow:auto;padding:16px 20px;border-radius:8px;font:14px/1.5 'IBM Plex Mono',monospace;"
    + `background:#12151a;color:#e6e6e6;border:2px solid ${fail ? "#ff5c5c" : "#2ecc71"};box-shadow:0 8px 32px rgba(0,0,0,.6)`;
  box.innerHTML = `<div style="font-weight:700;color:${fail ? "#ff5c5c" : "#2ecc71"};margin-bottom:8px">`
    + `${fail ? "✗" : "✓"} AUTO-TESTS ${pass}/${total}</div>`
    + `<ul style="margin:0 0 8px;padding-left:20px">${lignes}</ul>`
    + (echecs.length ? `<pre style="white-space:pre-wrap;color:#ff9c9c;margin:0 0 8px">${esc(echecs.join("\n"))}</pre>` : "")
    + `<div style="opacity:.65;font-size:12px">Détail complet dans la console. Retirez ?selftest=1 pour revenir à l'app.</div>`;
  document.body.appendChild(box);
  return { pass, fail, total };
}

const SELFTEST_MODE = new URLSearchParams(location.search).has("selftest");

/* ============================= INITIALISATION ============================= */

renderAll();
if (SELFTEST_MODE) runAllSelfTests();
ensureFxRates(); // pré-charge les taux dès le démarrage si le portefeuille est multi-devises

// Rattrapage best-effort des noms manquants pour des tickers déjà en watchlist
// (ajoutés avant cette fonctionnalité, ou tapés à la main sans passer par la recherche).
watchlist.filter(t => !tickerNames[t]).forEach(resolveTickerName);

// L'app a besoin du relais /api/ : ouverte en double-clic, elle ne peut rien analyser.
if (location.protocol === "file:") {
  toast("Ouverte en double-clic : lancez « python3 server.py » puis ouvrez http://localhost:8750 pour analyser.", "warn");
}
