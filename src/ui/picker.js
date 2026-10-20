// Part picker sheet: candidates for one slot, colour-coded against the build.

import { SLOT_BY_KEY } from '../build.js';
import { rateCandidate, fmtIn } from '../compat.js';
import { VIDEO_LABELS, RC_LABELS, CLASS_BY_ID } from '../classes.js';
import { bestOffer } from '../pricing.js';
import { esc, dot, money, grams, mins, specLine, specRows, partTitle, storeName, safeUrl, STATUS_TEXT } from './dom.js';
import { offerList } from './offers.js';

let ps = null; // { slot, q, all, facets, hideBad, sort, open }
let cache = { key: '', ratings: new Map() };

const bucketA = (a) => (a == null ? '?' : a <= 25 ? '≤25A' : a <= 45 ? '30–45A' : a <= 60 ? '50–60A' : '65A+');
const FACETS = {
  frame: [['Style', (p) => p.specs.style]],
  motor: [['Stator', (p) => p.specs.stator], ['Cells', (p) => `${p.specs.cells_min}–${p.specs.cells_max}S`]],
  prop: [['Size', (p) => fmtIn(p.specs.diameter_in)], ['Blades', (p) => `${p.specs.blades}-blade`]],
  fc: [['MCU', (p) => p.specs.mcu], ['Mount', (p) => p.specs.mount]],
  esc: [['Current', (p) => bucketA(p.specs.cont_a)], ['Mount', (p) => (p.specs.type === 'single' ? 'single' : p.specs.mount)]],
  aio: [['Cells', (p) => `${p.specs.cells_min}–${p.specs.cells_max}S`], ['MCU', (p) => p.specs.mcu]],
  stack: [['MCU', (p) => p.specs.fc?.mcu], ['Mount', (p) => p.specs.fc?.mount]],
  battery: [['Cells', (p) => `${p.specs.cells}S`], ['Chemistry', (p) => p.specs.chemistry]],
  vtx: [['System', (p) => VIDEO_LABELS[p.specs.system]]],
  camera: [['System', (p) => VIDEO_LABELS[p.specs.system]]],
  receiver: [['Protocol', (p) => RC_LABELS[p.specs.protocol] || p.specs.protocol]],
  radio: [['Type', (p) => p.specs.kind]],
  goggles: [['Brand', (p) => p.brand]],
  gps: [['Compass', (p) => (p.specs.compass ? 'with compass' : 'no compass')]],
  payload: [['Brand', (p) => p.brand]],
};
const SORTS = [['fit', 'Best fit'], ['price', 'Price'], ['weight', 'Weight'], ['name', 'Name']];
const RANK = { ok: 0, warn: 1, bad: 2 };

// Everything behind the dialog is made inert while it's open.
const BACKGROUND = ['.appbar', '#tabs', '#view'];
const setInert = (on) => BACKGROUND.forEach((sel) => document.querySelector(sel)?.toggleAttribute('inert', on));

export function open(app, slot) {
  ps = { slot, q: '', all: false, facets: {}, hideBad: false, sort: 'fit', open: null, shell: false };
  document.body.classList.add('sheet-open');
  setInert(true);
  refresh(app, { keepScroll: false });
  requestAnimationFrame(() => document.getElementById('picker-q')?.focus());
}

export function close() {
  if (!ps) return;
  const slot = ps.slot;
  ps = null;
  document.body.classList.remove('sheet-open');
  setInert(false);
  const sheet = document.getElementById('sheet');
  sheet.hidden = true;
  sheet.innerHTML = '';
  // After any re-render triggered by the choice, return focus to the slot.
  requestAnimationFrame(() => document.querySelector(`[data-act="pick"][data-slot="${slot}"]`)?.focus());
}

function ratingsFor(app, cands) {
  const key = JSON.stringify([app.db.version, app.state.build, app.state.options, ps.slot]);
  if (cache.key !== key) cache = { key, ratings: new Map() };
  for (const p of cands) {
    if (!cache.ratings.has(p.id)) cache.ratings.set(p.id, rateCandidate(ps.slot, p, app.state.build, app.db, app.state.options));
  }
  return cache.ratings;
}

function candidates(app) {
  const slot = SLOT_BY_KEY[ps.slot];
  const cls = app.state.build.classId;
  let list = app.db.byCat[slot.cat] || [];
  const classOnly = !ps.all && !slot.ground;
  if (classOnly) list = list.filter((p) => !p.classes?.length || p.classes.includes(cls));
  if (ps.q) {
    const toks = ps.q.toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter((p) => {
      const hay = `${p.brand} ${p.name} ${specLine(p)}`.toLowerCase();
      return toks.every((t) => hay.includes(t));
    });
  }
  return list;
}

function facetBlock(cat, list) {
  return (FACETS[cat] || []).map(([name, fn]) => {
    const counts = new Map();
    for (const p of list) { const v = fn(p); if (v) counts.set(v, (counts.get(v) || 0) + 1); }
    const sel = ps.facets[name];
    // Keep an active filter visible (with 0) so it can always be cleared.
    if (sel && !counts.has(sel)) counts.set(sel, 0);
    if (counts.size < 2 && !sel) return '';
    const vals = [...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }));
    return `<div class="facet"><span>${esc(name)}</span>${vals.map(([v, n]) =>
      `<button class="chip small ${sel === v ? 'on' : ''}" data-act="pk-facet" data-name="${esc(name)}" data-val="${esc(v)}">${esc(v)} <em>${n}</em></button>`).join('')}</div>`;
  }).join('');
}

function details(app, p) {
  const tests = p.specs?.thrust_tests || [];
  return `<div class="cand-detail">
    <table class="specs">${specRows(p).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
      ${p.weight_g != null ? `<tr><th>weight</th><td>${grams(p.weight_g)}${(p.est || []).includes('weight_g') ? ' (estimated)' : ''}</td></tr>` : ''}
      ${p.classes?.length ? `<tr><th>classes</th><td>${p.classes.map((c) => CLASS_BY_ID[c]?.short || c).join(', ')}</td></tr>` : ''}
    </table>
    ${p.notes ? `<p class="small">${esc(p.notes)}</p>` : ''}
    ${tests.length ? `<details><summary>Manufacturer thrust tests (${tests.length})</summary><table class="mini"><tr><th>Prop</th><th>V</th><th>Thr.</th><th>Thrust</th><th>Current</th></tr>
      ${tests.map((t) => `<tr><td>${esc(t.prop || `${t.diameter_in}x${t.pitch_in}x${t.blades}`)}</td><td>${t.voltage}</td><td>${t.throttle_pct ?? 100}%</td><td>${Math.round(t.thrust_g)} g</td><td>${t.current_a ?? '—'} A</td></tr>`).join('')}</table></details>` : ''}
    <h4>Where to buy</h4>${offerList(p)}
    ${p.sources?.length ? `<p class="small muted">Specs: ${p.sources.slice(0, 3).map((u, i) => `<a href="${safeUrl(u)}" target="_blank" rel="noopener">source ${i + 1}</a>`).join(' · ')}</p>` : ''}
  </div>`;
}

function candItem(app, p, ratings) {
  const slot = SLOT_BY_KEY[ps.slot];
  const selected = app.state.build[ps.slot];
  const r = ratings.get(p.id);
  const best = bestOffer(p);
  const why = r.checks[0];
  const pf = r.sum?.perf;
  const dW = r.sum.auwG - app.summary.auwG;
  const effect = slot.ground ? '' : [
    `AUW ${grams(r.sum.auwG)}${app.summary.lines.length && Math.abs(dW) >= 0.5 ? ` (${dW > 0 ? '+' : '−'}${grams(Math.abs(dW))})` : ''}`,
    pf && `T/W ${pf.tw.toFixed(1)}:1`,
    pf?.flight?.[r.sum.style] != null && `${mins(pf.flight[r.sum.style])} ${r.sum.style}`,
  ].filter(Boolean).join(' · ');
  return `<li class="cand s-${r.status} ${p.id === selected ? 'selected' : ''}" data-id="${esc(p.id)}">
    <div class="cand-row">
      <button class="cand-main" data-act="pk-choose" data-id="${esc(p.id)}">
        ${dot(r.status)}
        <span class="cand-text">
          <span class="cand-title">${partTitle(p)}${p.id === selected ? ' <em>selected</em>' : ''}</span>
          <span class="cand-spec">${esc(specLine(p))}</span>
          <span class="cand-meta">${p.weight_g != null && !slot.ground ? grams(p.weight_g) : ''}${best ? ` · ${money(best.cost)} at ${esc(storeName(best.offer.store))}${best.inStock ? '' : ' (out of stock)'}` : ' · no price'}</span>
          ${effect ? `<span class="cand-effect">${esc(effect)}</span>` : ''}
          ${why ? `<span class="cand-why t-${why.status}">${esc(STATUS_TEXT[why.status])}: ${esc(why.detail)}${r.checks.length > 1 ? ` (+${r.checks.length - 1} more)` : ''}</span>` : ''}
        </span>
      </button>
      <button class="icon-btn" data-act="pk-info" data-id="${esc(p.id)}" aria-expanded="${ps.open === p.id}" aria-label="Details for ${esc(p.brand)} ${esc(p.name)}">${ps.open === p.id ? '−' : 'i'}</button>
    </div>
    ${ps.open === p.id ? details(app, p) : ''}
  </li>`;
}

// The dialog shell (header, filter box, toggles) is built once per opening so
// the input, focus and scroll position survive refreshes; only the counts,
// facet chips and list are re-rendered.
function buildShell() {
  const slot = SLOT_BY_KEY[ps.slot];
  const sheet = document.getElementById('sheet');
  sheet.hidden = false;
  sheet.innerHTML = `
  <div class="sheet-backdrop" data-act="pk-close"></div>
  <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="Choose ${esc(slot.label)}">
    <header>
      <h2>${esc(slot.label)}</h2>
      <button class="icon-btn" data-act="pk-close" aria-label="Close">×</button>
    </header>
    <div class="sheet-tools">
      <input id="picker-q" type="search" placeholder="Filter ${esc(slot.label.toLowerCase())}…" data-in="pk-q" autocomplete="off" aria-label="Filter parts">
      <div class="row">
        <label class="tog"><input type="checkbox" data-in="pk-all"> All classes</label>
        <label class="tog"><input type="checkbox" data-in="pk-bad"> Hide red</label>
        <select data-in="pk-sort" aria-label="Sort">${SORTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      </div>
      <p class="small muted pk-counts" aria-live="polite"></p>
      <div class="pk-facets"></div>
    </div>
    <ul class="cands"></ul>
  </div>`;
  ps.shell = true;
}

function computeList(app) {
  const slot = SLOT_BY_KEY[ps.slot];
  const base = candidates(app);
  const ratings = ratingsFor(app, base);
  let list = base.filter((p) => Object.entries(ps.facets).every(([name, val]) => {
    const fn = (FACETS[slot.cat] || []).find(([n]) => n === name)?.[1];
    return !fn || fn(p) === val;
  }));
  if (ps.hideBad) list = list.filter((p) => ratings.get(p.id).status !== 'bad');
  const price = (p) => bestOffer(p)?.cost ?? Infinity;
  const sorters = {
    fit: (a, b) => RANK[ratings.get(a.id).status] - RANK[ratings.get(b.id).status] || price(a) - price(b),
    price: (a, b) => price(a) - price(b),
    weight: (a, b) => (a.weight_g ?? 1e9) - (b.weight_g ?? 1e9),
    name: (a, b) => `${a.brand} ${a.name}`.localeCompare(`${b.brand} ${b.name}`),
  };
  return { slot, base, ratings, list: [...list].sort(sorters[ps.sort]) };
}

export function refresh(app, { keepScroll = true } = {}) {
  if (!ps) return;
  if (!ps.shell) buildShell();
  const sheet = document.getElementById('sheet');
  const { slot, base, ratings, list } = computeList(app);
  const counts = { ok: 0, warn: 0, bad: 0 };
  for (const p of base) counts[ratings.get(p.id).status]++;
  const ul = sheet.querySelector('.cands');
  const scroll = keepScroll ? ul.scrollTop : 0;
  const focused = document.activeElement?.closest?.('.pk-facets [data-act="pk-facet"]');
  const focusKey = focused ? [focused.dataset.name, focused.dataset.val] : null;

  sheet.querySelector('.pk-counts').innerHTML = `${base.length} parts · <span class="t-ok">${counts.ok} compatible</span> · <span class="t-warn">${counts.warn} caveats</span> · <span class="t-bad">${counts.bad} incompatible</span>`;
  sheet.querySelector('.pk-facets').innerHTML = facetBlock(slot.cat, base);
  const hasFacets = Object.keys(ps.facets).length > 0;
  ul.innerHTML = list.length ? list.map((p) => candItem(app, p, ratings)).join('')
    : `<li class="muted pad">No parts match. ${hasFacets ? '<button class="btn small ghost" data-act="pk-clear">Clear filters</button>' : 'Try "All classes".'}</li>`;
  ul.scrollTop = scroll;
  if (focusKey) {
    const chip = [...sheet.querySelectorAll('[data-act="pk-facet"]')].find((b) => b.dataset.name === focusKey[0] && b.dataset.val === focusKey[1]);
    chip?.focus({ preventScroll: true });
  }
}

export const actions = {
  'pk-close'(el, ev, app) { close(app); },
  'pk-clear'(el, ev, app) { ps.facets = {}; refresh(app, { keepScroll: false }); },
  'pk-choose'(el, ev, app) {
    const id = el.dataset.id, part = app.db.byId[id], slot = ps.slot;
    close(app);
    app.update((s) => {
      s.build[slot] = id;
      if (part.category === 'aio') s.build.elec = 'aio';
      if (part.category === 'stack') s.build.elec = 'stack';
      if (part.category === 'fc' || part.category === 'esc') s.build.elec = 'separate';
    });
  },
  // Expand/collapse one candidate in place, keeping scroll and focus.
  'pk-info'(el, ev, app) {
    const id = el.dataset.id;
    const prev = ps.open;
    ps.open = prev === id ? null : id;
    const sheet = document.getElementById('sheet');
    const { ratings } = computeList(app);
    for (const pid of new Set([prev, ps.open].filter(Boolean))) {
      const li = [...sheet.querySelectorAll('.cand')].find((x) => x.dataset.id === pid);
      const part = app.db.byId[pid];
      if (li && part && ratings.has(pid)) li.outerHTML = candItem(app, part, ratings);
    }
    [...sheet.querySelectorAll('[data-act="pk-info"]')].find((b) => b.dataset.id === id)?.focus({ preventScroll: true });
  },
  'pk-facet'(el, ev, app) {
    const { name, val } = el.dataset;
    if (ps.facets[name] === val) delete ps.facets[name];
    else ps.facets[name] = val;
    refresh(app, { keepScroll: false });
  },
};

export const inputs = {
  'pk-q'(el, ev, app) {
    if (ev.isComposing) return; // let IME / predictive text finish the word
    ps.q = el.value;
    refresh(app, { keepScroll: false });
  },
  'pk-all'(el, ev, app) { ps.all = el.checked; refresh(app, { keepScroll: false }); },
  'pk-bad'(el, ev, app) { ps.hideBad = el.checked; refresh(app, { keepScroll: false }); },
  'pk-sort'(el, ev, app) { ps.sort = el.value; refresh(app, { keepScroll: false }); },
};
