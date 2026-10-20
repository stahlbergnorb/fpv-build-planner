// Build tab: class picker, slot cards, compatibility checks and quick stats.

import { CLASSES, CLASS_BY_ID } from '../classes.js';
import { activeSlots, newBuild, slotQty } from '../build.js';
import { worst } from '../compat.js';
import { bestOffer, unitsFor, costLines, costTotals } from '../pricing.js';
import { esc, badge, dot, money, grams, ratio, pct, mins, specLine, partTitle, storeName } from './dom.js';

const ELEC_MODES = [['stack', 'Stack'], ['aio', 'AIO board'], ['separate', 'FC + ESC']];

function slotStatus(app, key) {
  const rel = app.checks.filter((c) => c.slots.includes(key) && c.status !== 'info');
  return rel.length ? worst(rel.map((c) => c.status)) : null;
}

function slotCard(app, slot) {
  const { build } = app.state;
  const part = app.db.byId[build[slot.key]];
  const status = part ? slotStatus(app, slot.key) || 'ok' : null;
  const qty = part ? slotQty(slot.key, part, build, app.db, app.state.options) : null;
  const best = part ? bestOffer(part, unitsFor({ slot: slot.key, qty }, app.state.options)) : null;
  const count = (app.db.byCat[slot.cat] || []).length;
  return `
  <div class="slot ${status ? `s-${status}` : 'empty'}">
    <button class="slot-main" data-act="pick" data-slot="${slot.key}" ${count ? '' : 'disabled'}>
      <span class="slot-label">${esc(slot.label)}${qty > 1 ? ` <em>×${qty}${slot.key === 'battery' ? ' in series' : ''}</em>` : ''}${slot.ground ? ' <em class="muted">ground gear</em>' : ''}</span>
      ${part ? `
        <span class="slot-part">${partTitle(part)}</span>
        <span class="slot-spec">${esc(specLine(part))}</span>
        <span class="slot-meta">${part.weight_g != null && !slot.ground ? `${grams(part.weight_g)}${qty > 1 ? ' each' : ''}` : ''}${best ? ` · ${money(best.cost)} at ${esc(storeName(best.offer.store))}` : ''}</span>
      ` : `<span class="slot-empty">${count ? `Choose ${esc(slot.label.toLowerCase())}…` : 'No parts in database yet'}</span>`}
    </button>
    ${part ? `${dot(status)}<button class="icon-btn" data-act="clear" data-slot="${slot.key}" aria-label="Remove ${esc(slot.label)}">×</button>` : ''}
  </div>`;
}

function checksPanel(app) {
  const order = { bad: 0, warn: 1, info: 2, ok: 3 };
  const list = app.checks.filter((c) => !c.quiet).sort((a, b) => order[a.status] - order[b.status]);
  if (!list.length) return '<p class="muted">Pick parts to see compatibility checks.</p>';
  return `<ul class="checks">${list.map((c) => `
    <li class="check s-${c.status}">${dot(c.status)}<div><strong>${esc(c.title)}</strong><span>${esc(c.detail)}</span></div></li>`).join('')}
  </ul>`;
}

function quickStats(app) {
  const s = app.summary, perf = s.perf;
  const lines = costLines(s, app.state.options);
  const totals = costTotals(lines);
  const twStatus = perf ? (perf.tw >= s.twTarget ? 'ok' : perf.tw >= 1.6 ? 'warn' : 'bad') : null;
  const tile = (label, value, sub = '', st = '') => `<div class="qs ${st ? `s-${st}` : ''}"><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
  return `<div class="quick">
    ${tile('All-up weight', s.lines.length ? grams(s.auwG) : '—', s.lines.length ? `dry ${grams(s.dryG)}` : '')}
    ${tile('Thrust : weight', perf ? ratio(perf.tw) : '—', perf ? `target ~${s.twTarget}:1` : '', twStatus)}
    ${tile('Hover throttle', perf?.hover ? pct(perf.hover.throttle) : '—')}
    ${tile('Flight time', perf?.flight?.[s.style] != null ? mins(perf.flight[s.style]) : '—', perf ? esc(s.style) : '')}
    ${tile('Parts cost', totals.best ? money(totals.best) : '—', totals.missing ? `${totals.missing} unpriced` : 'best prices')}
  </div>`;
}

export function render(app) {
  const { build } = app.state;
  const cls = CLASS_BY_ID[build.classId];
  const slots = activeSlots(build, app.db);
  const elecIdx = slots.findIndex((s) => s.elec);
  const cards = slots.map((s, i) => (i === elecIdx ? `
    <div class="seg" role="group" aria-label="Flight electronics">${ELEC_MODES.map(([k, l]) =>
      `<button class="${build.elec === k ? 'on' : ''}" data-act="elec" data-mode="${k}">${l}</button>`).join('')}</div>` : '') + slotCard(app, s)).join('');
  return `
  <section class="builder">
    <div class="col-main">
      <div class="classbar" role="group" aria-label="Build class">
        ${CLASSES.map((c) => `<button class="chip ${c.id === build.classId ? 'on' : ''}" data-act="class" data-class="${c.id}" title="${esc(c.label)}">${esc(c.short)}</button>`).join('')}
      </div>
      <div class="class-head">
        <div><h2>${esc(cls.label)}</h2><p class="muted">${esc(cls.props)} props · typically ${cls.cells[0]}${cls.cells[1] !== cls.cells[0] ? `–${cls.cells[1]}` : ''}S</p></div>
        <button class="btn ghost small" data-act="reset">Reset build</button>
      </div>
      <div class="slots">${cards}</div>
    </div>
    <aside class="col-side">
      <div class="card">${quickStats(app)}</div>
      <div class="card">
        <h3>Compatibility</h3>
        <p class="legend">${badge('ok', 'works')} ${badge('warn', 'caveats')} ${badge('bad', 'no way')}</p>
        ${checksPanel(app)}
      </div>
    </aside>
  </section>`;
}

export const actions = {
  pick(el, ev, app) { app.openPicker(el.dataset.slot); },
  clear(el, ev, app) { app.update((s) => { s.build[el.dataset.slot] = null; }); },
  class(el, ev, app) {
    app.update((s) => { s.build.classId = el.dataset.class; });
  },
  elec(el, ev, app) { app.update((s) => { s.build.elec = el.dataset.mode; }); },
  reset(el, ev, app) {
    if (!confirm('Clear every part from this build?')) return;
    app.update((s) => { s.build = newBuild(s.build.classId); });
  },
};
export const inputs = {};
