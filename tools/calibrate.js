// Fits the physics MODEL constants to published thrust tests.
//  - Full-throttle rows: thrust and current at that throttle.
//  - Part-throttle rows: current needed for the measured thrust (closed form),
//    because ESC throttle % isn't duty cycle and the hover point is what sets
//    flight time.
// Each motor-size group is weighted equally so 5" data doesn't dominate.
// Paste the printed constants into MODEL in src/physics.js.

import { MODEL, motorParams, propCoeffs, motorPoint, currentAtThrust } from '../src/physics.js';

const RHO = 1.204; // bench tests: ~20 °C, sea level
const KEYS = ['ct0', 'ctPd', 'ctBlade', 'ctSize', 'cp0', 'cpPd', 'cpBlade', 'cpSize', 'km0', 'kmExp', 'kmExpBig', 'i0k', 'kvEff', 'rmScale'];
const LOG = new Set(['ct0', 'cp0', 'km0', 'i0k', 'kvEff', 'rmScale']); // positive params fitted in log space
const BOUNDS = { kvEff: [0.8, 1.1], rmScale: [0.5, 2.5], ctSize: [-1, 1], cpSize: [-1.5, 1.5], kmExp: [0.3, 1.6], kmExpBig: [0.3, 1.6] };
const out = document.getElementById('out');
const log = (s) => { out.textContent += `${s}\n`; };

const toVec = (m) => KEYS.map((k) => (LOG.has(k) ? Math.log(m[k]) : m[k]));
function toModel(v) {
  const m = { ...MODEL };
  KEYS.forEach((k, i) => { m[k] = LOG.has(k) ? Math.exp(v[i]) : v[i]; });
  return m;
}

const group = (r) => {
  const d = r.stator_d_mm || parseFloat(String(r.stator).slice(0, 2));
  return d <= 8 ? '08xx whoop' : d <= 14 ? '10–14xx micro' : d <= 20 ? '15–20xx 3–4"' : d <= 24 ? '22–24xx 5"' : d <= 30 ? '25–30xx 6–7"' : '31xx+ large';
};

function prepare(raw) {
  const rows = raw.filter((r) => r.kv > 0 && r.voltage > 0 && r.thrust_g > 0 && r.current_a > 0 && r.diameter_in > 0 && r.pitch_in > 0
    && (r.throttle_pct ?? 100) >= 30
    && !(r.flags || []).some((f) => /low-confidence|outside the 1\.5-12/i.test(f)));
  const counts = {};
  for (const r of rows) { r.group = group(r); r.full = (r.throttle_pct ?? 100) >= 95; counts[r.group] = (counts[r.group] || 0) + 1; }
  for (const r of rows) r.w = 1 / counts[r.group];
  return rows;
}

const motorOf = (r) => ({ specs: { stator: r.stator, stator_d_mm: r.stator_d_mm, stator_h_mm: r.stator_h_mm, kv: r.kv, rm_mohm: r.rm_mohm, io_a: r.io_a } });
const propOf = (r) => ({ specs: { diameter_in: r.diameter_in, pitch_in: r.pitch_in, blades: r.blades || 2 } });

function predict(r, m) {
  const mp = motorParams(motorOf(r), m), pc = propCoeffs(propOf(r), m);
  if (r.full) {
    const p = motorPoint(mp, pc, RHO, (r.throttle_pct ?? 100) / 100, r.voltage, m);
    return { thrust: p.thrust, current: p.iBatt };
  }
  const c = currentAtThrust(mp, pc, RHO, r.thrust_g, r.voltage, m);
  return { currentAtThrust: c ? c.iBatt : null };
}

const huber = (e, d = 0.25) => d * d * (Math.sqrt(1 + (e / d) ** 2) - 1);

function loss(rows, m) {
  let sf = 0, wf = 0, sp = 0, wp = 0;
  for (const r of rows) {
    const p = predict(r, m);
    if (r.full) {
      const eT = p.thrust > 0 ? Math.log(p.thrust / r.thrust_g) : 3;
      const eI = p.current > 0 ? Math.log(p.current / r.current_a) : 3;
      sf += r.w * (huber(eT) + 0.7 * huber(eI)); wf += r.w;
    } else {
      const e = p.currentAtThrust > 0 ? Math.log(p.currentAtThrust / r.current_a) : 1.5;
      sp += r.w * huber(e); wp += r.w;
    }
  }
  let pen = 0;
  for (const [k, [lo, hi]] of Object.entries(BOUNDS)) {
    if (m[k] < lo) pen += 10 * (lo - m[k]) ** 2;
    if (m[k] > hi) pen += 10 * (m[k] - hi) ** 2;
  }
  return sf / (wf || 1) + sp / (wp || 1) + pen;
}

function nelderMead(f, x0, step, iters) {
  const n = x0.length;
  let pts = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[j] : v)))].map((x) => ({ x, f: f(x) }));
  for (let k = 0; k < iters; k++) {
    pts.sort((a, b) => a.f - b.f);
    const best = pts[0], worst = pts[n];
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i].x[j] / n;
    const along = (t) => c.map((v, j) => v + t * (worst.x[j] - v));
    const xr = along(-1), fr = f(xr);
    if (fr < best.f) {
      const xe = along(-2), fe = f(xe);
      pts[n] = fe < fr ? { x: xe, f: fe } : { x: xr, f: fr };
    } else if (fr < pts[n - 1].f) {
      pts[n] = { x: xr, f: fr };
    } else {
      const xc = along(0.5), fc = f(xc);
      if (fc < worst.f) pts[n] = { x: xc, f: fc };
      else pts = pts.map((p, i) => {
        if (i === 0) return p;
        const x = p.x.map((v, j) => best.x[j] + 0.5 * (v - best.x[j]));
        return { x, f: f(x) };
      });
    }
  }
  pts.sort((a, b) => a.f - b.f);
  return pts[0];
}

const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const meanAbs = (a) => (a.length ? a.reduce((x, y) => x + Math.abs(y - 1), 0) / a.length : NaN);

function report(rows, m, label) {
  const g = {};
  for (const r of rows) {
    const p = predict(r, m);
    const x = (g[r.group] ||= { t: [], i: [], h: [] });
    if (r.full) { if (p.thrust > 0) x.t.push(r.thrust_g / p.thrust); if (p.current > 0) x.i.push(r.current_a / p.current); }
    else if (p.currentAtThrust > 0) x.h.push(r.current_a / p.currentAtThrust);
  }
  log(`\n${label}  (median measured/model · mean abs error)`);
  log('  group              full thrust        full current       current @ thrust (part throttle)');
  const f = (a) => (a.length ? `${median(a).toFixed(2)} · ${(100 * meanAbs(a)).toFixed(0)}%`.padEnd(18) : '—'.padEnd(18));
  for (const k of Object.keys(g).sort()) log(`  ${k.padEnd(18)} ${f(g[k].t)} ${f(g[k].i)} ${f(g[k].h)}  (n=${g[k].t.length}/${g[k].h.length})`);
}

async function main() {
  const src = new URLSearchParams(location.search).get('src') || '../data/reference/thrust_tests.json';
  const raw = await (await fetch(src)).json();
  const rows = prepare(raw);
  log(`${rows.length} usable rows (of ${raw.length}) from ${src}: ${rows.filter((r) => r.full).length} full-throttle, ${rows.filter((r) => !r.full).length} part-throttle`);
  report(rows, MODEL, 'Current constants');
  const f = (v) => loss(rows, toModel(v));
  let best = { x: toVec(MODEL), f: f(toVec(MODEL)) };
  log(`start loss ${best.f.toFixed(5)}`);
  const step = KEYS.map((k) => (LOG.has(k) ? 0.25 : 0.2));
  for (let round = 0; round < 8; round++) {
    const r = nelderMead(f, best.x, step.map((s) => s * (round % 2 ? 0.5 : 1)), 1800);
    if (r.f < best.f - 1e-7) best = r;
    log(`round ${round + 1}: loss ${best.f.toFixed(5)}`);
    await new Promise((res) => setTimeout(res));
  }
  const fitted = toModel(best.x);
  report(rows, fitted, 'Fitted constants');

  // 5-fold cross-validation on combos to check the fit generalises.
  const combos = [...new Set(rows.map((r) => `${r.motor}|${r.prop}|${r.voltage}`))];
  const fold = (r) => combos.indexOf(`${r.motor}|${r.prop}|${r.voltage}`) % 5;
  let cv = 0;
  for (let k = 0; k < 5; k++) {
    const train = rows.filter((r) => fold(r) !== k), test = rows.filter((r) => fold(r) === k);
    const fit = nelderMead((v) => loss(train, toModel(v)), best.x, step.map((s) => s * 0.5), 900);
    cv += loss(test, toModel(fit.x)) / 5;
    await new Promise((res) => setTimeout(res));
  }
  log(`\ncross-validated loss ${cv.toFixed(5)} vs in-sample ${best.f.toFixed(5)}`);

  const rounded = Object.fromEntries(KEYS.map((k) => [k, +fitted[k].toPrecision(4)]));
  log(`\nPaste into MODEL in src/physics.js:\n${JSON.stringify(rounded, null, 2)}`);
  window.__fitted = rounded;
  window.__done = true;
}

main().catch((e) => { log(`error: ${e.message}`); window.__done = true; });
