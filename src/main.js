// App shell: loads data, routes tabs, delegates events, registers the service worker.

import { state, update, subscribe, importFromHash, validateAgainst } from './state.js';
import { loadDB } from './data.js';
import { summarize } from './build.js';
import { runChecks, overallStatus } from './compat.js';
import { esc, badge, toast } from './ui/dom.js';
import * as builder from './ui/builder.js';
import * as stats from './ui/stats.js';
import * as cost from './ui/cost.js';
import * as search from './ui/search.js';
import * as more from './ui/more.js';
import * as picker from './ui/picker.js';

const VIEWS = { build: builder, perf: stats, cost, search, more };
const TABS = [
  ['build', 'Build', 'M4 7h16M4 12h16M4 17h10'],
  ['perf', 'Performance', 'M4 19V9m6 10V5m6 14v-7m4 7H2'],
  ['cost', 'Cost', 'M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.6 5 3.2 5 1.4 5 3.3-2.2 3-5 3-5-1.1-5-3'],
  ['search', 'Search', 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm9 16-4.3-4.3'],
  ['more', 'More', 'M5 12h.01M12 12h.01M19 12h.01'],
];

export const app = {
  db: null,
  state,
  update,
  summary: null,
  checks: [],
  installPrompt: null,
  swReg: null,
  recompute() {
    app.summary = summarize(state.build, app.db, state.options);
    app.checks = runChecks(state.build, app.db, state.options, app.summary);
  },
  render,
  toast,
  openPicker: (slot) => picker.open(app, slot),
};

const actions = {
  tab(el) { update((s) => { s.tab = el.dataset.tab; }); window.scrollTo(0, 0); },
  ...builder.actions, ...stats.actions, ...cost.actions, ...search.actions, ...more.actions, ...picker.actions,
};
const inputs = {
  ...builder.inputs, ...stats.inputs, ...cost.inputs, ...search.inputs, ...more.inputs, ...picker.inputs,
};

function renderTabs() {
  return TABS.map(([id, label, d]) => `
    <button class="tab ${state.tab === id ? 'active' : ''}" data-act="tab" data-tab="${id}" aria-current="${state.tab === id ? 'page' : 'false'}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg><span>${label}</span>
    </button>`).join('');
}

function render() {
  if (!app.db) return;
  app.recompute();
  const status = overallStatus(app.checks);
  const counts = { warn: 0, bad: 0 };
  for (const c of app.checks) if (counts[c.status] != null) counts[c.status]++;
  document.getElementById('status-pill').innerHTML = app.summary.lines.length
    ? badge(status, status === 'ok' ? 'All compatible' : `${counts.bad ? `${counts.bad} blocker${counts.bad > 1 ? 's' : ''}` : ''}${counts.bad && counts.warn ? ', ' : ''}${counts.warn ? `${counts.warn} caveat${counts.warn > 1 ? 's' : ''}` : ''}`)
    : '';
  document.getElementById('tabs').innerHTML = renderTabs();
  const view = VIEWS[state.tab] || builder;
  const main = document.getElementById('view');
  // Keep focus and caret in a field that survives the re-render.
  const active = document.activeElement;
  const focusId = active?.id && main.contains(active) ? active.id : null;
  const caret = focusId && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  main.innerHTML = view.render(app);
  main.dataset.view = state.tab;
  view.after?.(app);
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus({ preventScroll: true });
      if (caret) try { el.setSelectionRange(...caret); } catch { /* not a text field */ }
    }
  }
  picker.refresh(app);
}

function announceImport(res) {
  if (!res) return;
  if (res.error) toast('That share link is damaged or incomplete');
  else toast(res.backedUp ? 'Loaded shared build — your previous build is in More → Saved builds' : 'Loaded shared build');
}

function delegate() {
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const fn = actions[el.dataset.act];
    if (fn) { ev.preventDefault(); fn(el, ev, app); }
  });
  const onInput = (ev) => {
    const el = ev.target.closest('[data-in]');
    if (!el) return;
    const fn = inputs[el.dataset.in];
    if (fn) fn(el, ev, app);
  };
  // Text fields react as you type; everything else (selects, checkboxes,
  // number fields) on commit so the view isn't re-rendered mid-edit.
  const live = 'input[type=search], input[type=text], textarea';
  document.addEventListener('input', (ev) => { if (ev.target.matches(live)) onInput(ev); });
  // Mobile keyboards compose whole words; handle the committed text.
  document.addEventListener('compositionend', (ev) => { if (ev.target.matches(live)) onInput(ev); });
  document.addEventListener('change', (ev) => { if (!ev.target.matches(live)) onInput(ev); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') picker.close(app); });
}

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  // During local development skip the cache (add ?sw=1 to test offline mode).
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (local && !new URLSearchParams(location.search).has('sw')) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
    return;
  }
  // A first install claims the page too; only reload when a worker replaces
  // an existing one (a real update).
  let lastController = navigator.serviceWorker.controller;
  const hadController = !!lastController;
  const showBar = () => { document.getElementById('update-bar').hidden = false; };
  const track = (worker) => worker?.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) showBar();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    app.swReg = reg;
    if (reg.waiting && hadController) showBar();
    track(reg.installing);
    reg.addEventListener('updatefound', () => track(reg.installing));
  }).catch(() => { /* offline support unavailable */ });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const prev = lastController;
    lastController = navigator.serviceWorker.controller;
    if (reloaded || !prev) return;
    reloaded = true;
    location.reload();
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  app.installPrompt = e;
  if (state.tab === 'more') render();
});

async function boot() {
  delegate();
  registerSW();
  document.getElementById('apply-update').addEventListener('click', () => {
    app.swReg?.waiting?.postMessage('skipWaiting');
  });
  try {
    app.db = await loadDB();
  } catch (e) {
    document.getElementById('view').innerHTML = `<div class="card empty"><h2>Couldn't load the parts database</h2><p>${esc(e.message)}</p><p>If you opened index.html directly from disk, serve the folder instead (e.g. <code>python -m http.server</code>) or use the GitHub Pages site.</p></div>`;
    return;
  }
  validateAgainst(app.db);
  announceImport(importFromHash(app.db));
  subscribe(render);
  window.addEventListener('hashchange', () => {
    const res = importFromHash(app.db);
    if (res) { announceImport(res); render(); }
  });
  render();
}

boot();
