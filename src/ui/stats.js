// Performance tab: design numbers, weight breakdown, throttle curve and
// "what if" tables showing how other props / batteries / motors change things.

import { rateCandidate, fmtIn } from '../compat.js';
import { STYLE_LOAD, analyzePower } from '../physics.js';
import { TW_MIN } from '../classes.js';
import { esc, dot, grams, ratio, pct, mins, amps, partTitle, specLine } from './dom.js';

const STYLES = [['hover', 'Hover'], ['cinematic', 'Cinematic'], ['cruise', 'Cruise / long range'], ['freestyle', 'Freestyle'], ['race', 'Race']];
const PALETTE = ['#4ade80', '#60a5fa', '#f472b6', '#facc15', '#a78bfa', '#fb923c', '#2dd4bf', '#f87171', '#94a3b8', '#e879f9', '#38bdf8', '#a3e635'];

const r1 = (x) => Math.round(x * 10) / 10;
let compareTab = 'prop';

function tile(label, value, sub, status) {
  return `<div class="tile ${status ? `s-${status}` : ''}"><span class="tl">${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
}

function weightBreakdown(s) {
  const rows = s.lines.filter((l) => !l.ground && l.totalG > 0).map((l) => ({
    label: l.label, name: `${l.part.brand} ${l.part.name}`, qty: l.qty, each: l.unitG, total: l.totalG, est: l.est,
  }));
  rows.push({ label: 'Wiring, hardware, straps, antennas', name: 'estimate for class', qty: 1, each: s.miscG, total: s.miscG, est: true });
  if (s.payloadG > 0 && !s.lines.some((l) => l.slot === 'payload')) rows.push({ label: 'Extra payload', name: 'custom', qty: 1, each: s.payloadG, total: s.payloadG });
  else if (s.payloadG > (s.lines.find((l) => l.slot === 'payload')?.totalG || 0)) {
    const extra = s.payloadG - (s.lines.find((l) => l.slot === 'payload')?.totalG || 0);
    rows.push({ label: 'Extra payload', name: 'custom', qty: 1, each: extra, total: extra });
  }
  rows.sort((a, b) => b.total - a.total);
  const total = rows.reduce((a, r) => a + r.total, 0) || 1;
  return `
  <div class="wbar" role="img" aria-label="Weight breakdown">${rows.map((r, i) =>
    `<span style="width:${(r.total / total) * 100}%;background:${PALETTE[i % PALETTE.length]}" title="${esc(r.label)}: ${grams(r.total)}"></span>`).join('')}</div>
  <div class="scroll-x"><table class="tbl">
    <thead><tr><th></th><th>Component</th><th class="num">Qty</th><th class="num">Each</th><th class="num">Total</th><th class="num">Share</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr>
      <td><span class="sw" style="background:${PALETTE[i % PALETTE.length]}"></span></td>
      <td><strong>${esc(r.label)}</strong><br><span class="muted small">${esc(r.name)}${r.est ? ' · estimated' : ''}</span></td>
      <td class="num">${r.qty}</td><td class="num">${grams(r.each)}</td><td class="num">${grams(r.total)}</td><td class="num">${Math.round((r.total / total) * 100)}%</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr><td></td><td>All-up weight</td><td></td><td></td><td class="num">${grams(s.auwG)}</td><td></td></tr></tfoot>
  </table></div>`;
}

function curveChart(s) {
  const c = s.perf.curve;
  if (!c?.length) return '';
  const W = 640, H = 260, L = 54, R = 54, T = 16, B = 34;
  const maxT = Math.max(...c.map((p) => p.thrust), s.auwG) * 1.05;
  const maxI = Math.max(...c.map((p) => p.current)) * 1.05 || 1;
  const x = (t) => L + t * (W - L - R);
  const yT = (v) => H - B - (v / maxT) * (H - T - B);
  const yI = (v) => H - B - (v / maxI) * (H - T - B);
  const path = (fy, key) => c.map((p, i) => `${i ? 'L' : 'M'}${x(p.throttle).toFixed(1)},${fy(p[key]).toFixed(1)}`).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const hoverT = s.perf.hover?.throttle;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Thrust and current versus throttle">
    ${ticks.map((t) => `<line class="grid" x1="${x(0)}" x2="${x(1)}" y1="${T + (1 - t) * (H - T - B)}" y2="${T + (1 - t) * (H - T - B)}"/>
      <text class="ax" x="${L - 6}" y="${T + (1 - t) * (H - T - B) + 4}" text-anchor="end">${grams(maxT * t)}</text>
      <text class="ax" x="${W - R + 6}" y="${T + (1 - t) * (H - T - B) + 4}">${Math.round(maxI * t)}A</text>
      <text class="ax" x="${x(t)}" y="${H - B + 18}" text-anchor="middle">${t * 100}%</text>`).join('')}
    <line class="auw" x1="${x(0)}" x2="${x(1)}" y1="${yT(s.auwG)}" y2="${yT(s.auwG)}"/>
    <text class="ax auw-t" x="${x(0) + 4}" y="${yT(s.auwG) - 5}">hover (AUW ${grams(s.auwG)})</text>
    ${hoverT ? `<line class="hov" x1="${x(hoverT)}" x2="${x(hoverT)}" y1="${T}" y2="${H - B}"/>` : ''}
    <path class="l-thrust" d="${path(yT, 'thrust')}"/>
    <path class="l-current" d="${path(yI, 'current')}"/>
    <text class="ax" x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">throttle</text>
  </svg>
  <p class="legend small"><span class="key k-thrust"></span>Total thrust <span class="key k-current"></span>Battery current${hoverT ? ' <span class="key k-hov"></span>Hover point' : ''}</p>`;
}

function compareRows(app, slotKey, cands) {
  const s = app.summary, sel = app.state.build[slotKey];
  const rows = cands.map((p) => ({ p, r: rateCandidate(slotKey, p, app.state.build, app.db, app.state.options) }))
    .filter((x) => x.r.sum.perf)
    .sort((a, b) => b.r.sum.perf.tw - a.r.sum.perf.tw)
    .slice(0, 30);
  if (!rows.length) return '<p class="muted">No alternatives to compare yet.</p>';
  return `<div class="scroll-x"><table class="tbl cmp">
    <thead><tr><th></th><th>Part</th><th class="num">T/W</th><th class="num">Hover</th><th class="num">${esc(s.style)} time</th><th class="num">Peak A/motor</th><th class="num">AUW</th><th class="num">Hover g/W</th><th></th></tr></thead>
    <tbody>${rows.map(({ p, r }) => {
      const pf = r.sum.perf;
      return `<tr class="${p.id === sel ? 'selected' : ''}">
        <td>${dot(r.status)}</td>
        <td><strong>${partTitle(p)}</strong><br><span class="muted small">${esc(specLine(p))}</span></td>
        <td class="num">${ratio(pf.tw)}</td>
        <td class="num">${pf.hover ? pct(pf.hover.throttle) : '—'}</td>
        <td class="num">${mins(pf.flight?.[s.style])}</td>
        <td class="num">${amps(pf.maxMotorCurrent)}</td>
        <td class="num">${grams(r.sum.auwG)}</td>
        <td class="num">${pf.hover ? r1(pf.hover.efficiency) : '—'}</td>
        <td>${p.id === sel ? '<em class="muted">current</em>' : `<button class="btn small" data-act="cmp-use" data-slot="${slotKey}" data-id="${esc(p.id)}">Use</button>`}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

function compareBlock(app) {
  const { build } = app.state, db = app.db;
  const frame = db.byId[build.frame], motor = db.byId[build.motor];
  const inClass = (p) => !p.classes?.length || p.classes.includes(build.classId);
  let cands = [];
  if (compareTab === 'prop') {
    cands = (db.byCat.prop || []).filter((p) => {
      const d = p.specs.diameter_in;
      if (frame) return d <= frame.specs.prop_max_in + 0.06 && d >= frame.specs.prop_max_in - (frame.specs.ducted ? 0.15 : 1.1);
      return inClass(p);
    }).filter((p) => !motor || !motor.specs.shaft || !p.specs.hub || p.specs.hub === motor.specs.shaft || p.specs.hub === 'folding');
  } else if (compareTab === 'battery') {
    cands = (db.byCat.battery || []).filter(inClass);
  } else {
    cands = (db.byCat.motor || []).filter(inClass)
      .filter((m) => !frame || !(frame.specs.motor_mount || []).length || (m.specs.mount || []).some((x) => frame.specs.motor_mount.includes(x)));
  }
  const tabs = [['prop', 'Props'], ['battery', 'Batteries'], ['motor', 'Motors']];
  return `<div class="seg">${tabs.map(([k, l]) => `<button class="${compareTab === k ? 'on' : ''}" data-act="cmp-tab" data-k="${k}">${l}</button>`).join('')}</div>
    <p class="small muted">Everything else stays as selected. Sorted by thrust-to-weight; colours are compatibility with the rest of the build.</p>
    ${compareRows(app, compareTab, cands)}`;
}

function settings(app) {
  const o = app.state.options, s = app.summary;
  return `<div class="settings">
    <label>Flying style<select data-in="opt-style">${STYLES.map(([k, l]) => `<option value="${k}" ${s.style === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Packs in series<select data-in="opt-series">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${(o.seriesPacks || 1) === n ? 'selected' : ''}>${n === 1 ? '1 (normal)' : `${n} packs (e.g. ${n} × 6S = ${6 * n}S)`}</option>`).join('')}</select></label>
    <label>Extra payload (g)<input type="number" min="0" step="5" value="${esc(o.payloadG || '')}" placeholder="0" data-in="opt-payload"></label>
    <label>Wiring & hardware (g)<input type="number" min="0" step="1" value="${esc(o.miscG ?? '')}" placeholder="${esc(s.cls?.misc ?? 10)} (class default)" data-in="opt-misc"></label>
    <label>Altitude (m)<input type="number" min="0" step="100" value="${esc(o.altitude || '')}" placeholder="0" data-in="opt-alt"></label>
    <label>Air temp (°C)<input type="number" step="1" value="${esc(o.tempC ?? 15)}" data-in="opt-temp"></label>
  </div>`;
}

export function render(app) {
  const s = app.summary, perf = s.perf;
  if (!perf) {
    return `<section class="card empty"><h2>Performance</h2><p>Pick a frame, motors, props and a battery on the Build tab to see all-up weight, thrust-to-weight, hover throttle, flight time and payload capacity.</p>
      <button class="btn" data-act="tab" data-tab="build">Go to Build</button>
      ${s.lines.length ? `<h3>Weight so far</h3>${weightBreakdown(s)}` : ''}</section>`;
  }
  const twSt = perf.tw >= s.twTarget ? 'ok' : perf.tw >= TW_MIN ? 'warn' : 'bad';
  const hoverSt = !perf.hover ? 'bad' : perf.hover.throttle <= 0.5 ? 'ok' : perf.hover.throttle <= 0.7 ? 'warn' : 'bad';
  const payloadMax = perf.payloadAt(2), payloadAgile = perf.payloadAt(Math.max(2, s.twTarget));
  // How long it would actually fly carrying the max payload.
  const b = app.state.build, db = app.db;
  const loaded = payloadMax > 0
    ? analyzePower(db.byId[b.motor], db.byId[b.prop], s.battery, { ...s.powerOpts, auwG: s.auwG + payloadMax, lite: true })
    : null;
  const m = perf.measured;
  const flightRows = Object.keys(STYLE_LOAD).map((k) => `<tr class="${k === s.style ? 'selected' : ''}"><td>${esc(STYLES.find(([x]) => x === k)?.[1] || k)}</td><td class="num">${mins(perf.flight[k])}</td></tr>`).join('');
  return `
  <section class="perf">
    <div class="card">
      <h2>Design numbers</h2>
      <p class="small muted">Estimates from a motor/prop/battery model fitted to published manufacturer thrust tests${m && !m.ignored ? ', scaled to the manufacturer\'s own tests for this exact motor and prop' : ''}. Real results vary with tune, temperature and battery health.</p>
      <div class="tiles">
        ${tile('All-up weight', grams(s.auwG), `dry ${grams(s.dryG)} · battery ${grams(s.lines.find((l) => l.slot === 'battery')?.totalG || 0)}`)}
        ${tile('Max thrust', grams(perf.maxThrust), `${grams(perf.maxThrustPerMotor)} per motor`)}
        ${tile('Thrust : weight', ratio(perf.tw), `target ~${s.twTarget}:1 for this build`, twSt)}
        ${tile('Hover throttle', perf.hover ? pct(perf.hover.throttle) : "can't hover", perf.hover ? `${amps(perf.hover.current)} · ${Math.round(perf.hover.power)} W` : '', hoverSt)}
        ${tile(`Flight time (${esc(s.style)})`, mins(perf.flight[s.style]), `${Math.round(perf.battery.usable * 100)}% of ${perf.battery.capacityAh * 1000}mAh usable`)}
        ${tile('Payload capacity', grams(payloadMax), `max at 2:1 T/W${loaded?.flight?.hover ? ` (≈${mins(loaded.flight.hover)} hover)` : ''} · ${grams(payloadAgile)} keeping ${Math.max(2, s.twTarget)}:1`)}
        ${tile('Peak current', amps(perf.maxCurrent), `${amps(perf.maxMotorCurrent)} per motor · sag ${r1(perf.sagV)} V`)}
        ${tile('Peak power', `${Math.round(perf.maxPower)} W`, `${Math.round(perf.maxPower / (s.auwG / 1000))} W/kg`)}
        ${tile('Hover efficiency', perf.hover ? `${r1(perf.hover.efficiency)} g/W` : '—', `disk loading ${perf.diskLoading.toFixed(2)} g/cm²`)}
        ${tile('Max RPM', `${Math.round(perf.maxRpm).toLocaleString()}`, `tip speed Mach ${perf.tipMach.toFixed(2)}`, perf.tipMach > 0.8 ? 'warn' : '')}
        ${tile('Battery', `${r1(perf.battery.energyWh)} Wh`, `${perf.battery.cells}S · ${r1(perf.battery.vFull)} V loaded`)}
      </div>
      ${m && !m.ignored && !m.partOnly ? `<p class="small">Manufacturer test: ${esc(m.test.prop || `${m.test.diameter_in}x${m.test.pitch_in}x${m.test.blades}`)} @ ${esc(m.test.voltage)} V measured ${Math.round(m.test.thrust_g)} g${m.test.current_a ? ` / ${esc(m.test.current_a)} A` : ''} per motor at full throttle (model scaled ×${m.t.toFixed(2)} thrust, ×${m.i.toFixed(2)} current there).</p>` : ''}
      ${m && Math.abs((m.pi ?? 1) - 1) > 0.005 ? `<p class="small">Hover current scaled ×${m.pi.toFixed(2)} to match the manufacturer's part-throttle tests for this motor and prop.</p>` : ''}
      ${m?.ignored ? '<p class="small muted">A manufacturer test exists for this motor and prop, but it disagrees too much with the model to apply safely, so the model is used alone.</p>' : ''}
      ${perf.sagLimited ? '<p class="small t-bad">At full throttle this pack collapses below half voltage; peak numbers are what it would try to draw, not what you\'ll get.</p>' : ''}
    </div>
    <div class="grid2">
      <div class="card"><h3>Settings</h3>${settings(app)}
        <h3>Flight time by style</h3><table class="tbl"><tbody>${flightRows}</tbody></table>
      </div>
      <div class="card"><h3>Thrust & current vs throttle</h3>${curveChart(s)}</div>
    </div>
    <div class="card"><h3>Weight breakdown</h3>${weightBreakdown(s)}</div>
    <div class="card"><h3>What if…</h3>${compareBlock(app)}</div>
  </section>`;
}

const num = (v) => (v === '' || v == null ? null : Number(v));

export const actions = {
  'cmp-tab'(el, ev, app) { compareTab = el.dataset.k; app.render(); },
  'cmp-use'(el, ev, app) { app.update((s) => { s.build[el.dataset.slot] = el.dataset.id; }); },
};

export const inputs = {
  'opt-style'(el, ev, app) { app.update((s) => { s.options.style = el.value; }); },
  'opt-series'(el, ev, app) { app.update((s) => { s.options.seriesPacks = Math.min(4, Math.max(1, parseInt(el.value, 10) || 1)); }); },
  'opt-payload'(el, ev, app) { if (ev.type === 'change') app.update((s) => { s.options.payloadG = num(el.value) || 0; }); },
  'opt-misc'(el, ev, app) { if (ev.type === 'change') app.update((s) => { s.options.miscG = num(el.value); }); },
  'opt-alt'(el, ev, app) { if (ev.type === 'change') app.update((s) => { s.options.altitude = num(el.value) || 0; }); },
  'opt-temp'(el, ev, app) { if (ev.type === 'change') app.update((s) => { s.options.tempC = num(el.value) ?? 15; }); },
};
