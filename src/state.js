// App state with localStorage persistence and share-link encoding.
// Everything that comes from storage, a share link or an imported file is
// sanitized here before it reaches the views.

import { newBuild, DEFAULT_OPTIONS, SLOTS } from './build.js';
import { CLASS_BY_ID } from './classes.js';
import { STYLE_LOAD } from './physics.js';

const KEY = 'fpv.state.v1';
const SAVED_KEY = 'fpv.saved.v1';
const TABS = ['build', 'perf', 'cost', 'search', 'more'];
const ELEC = ['stack', 'aio', 'separate'];
const listeners = new Set();

function readKey(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeKey(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

// [min, max, default]
const NUMERIC = {
  batteries: [1, 20, 1], seriesPacks: [1, 4, 1], spareProps: [1, 20, 1], payloadG: [0, 50000, 0], altitude: [0, 6000, 0], tempC: [-30, 50, 15],
};

export function sanitizeOptions(o) {
  const out = { ...DEFAULT_OPTIONS };
  if (!o || typeof o !== 'object') return out;
  for (const [k, [lo, hi, def]] of Object.entries(NUMERIC)) {
    const n = Number(o[k]);
    out[k] = o[k] !== '' && o[k] != null && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
  }
  const misc = o.miscG === '' || o.miscG == null ? NaN : Number(o.miscG);
  out.miscG = Number.isFinite(misc) && misc >= 0 ? Math.min(misc, 5000) : null;
  out.style = typeof o.style === 'string' && Object.hasOwn(STYLE_LOAD, o.style) ? o.style : null;
  out.includeGround = o.includeGround === true;
  return out;
}

// With a db, part ids must exist and belong to the slot's category.
export function sanitizeBuild(b, db = null) {
  const out = newBuild(b && typeof b.classId === 'string' && Object.hasOwn(CLASS_BY_ID, b.classId) ? b.classId : 'p5');
  if (!b || typeof b !== 'object') return out;
  out.elec = ELEC.includes(b.elec) ? b.elec : 'stack';
  for (const s of SLOTS) {
    const id = b[s.key];
    if (typeof id !== 'string') continue;
    if (db && !(Object.hasOwn(db.byId, id) && db.byId[id].category === s.cat)) continue;
    out[s.key] = id;
  }
  return out;
}

function sanitizeSaved(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((x) => x && typeof x === 'object' && x.build && typeof x.build === 'object')
    .map((x) => ({
      name: String(x.name || 'Untitled build').slice(0, 80),
      t: Number.isFinite(Number(x.t)) ? Number(x.t) : Date.now(),
      build: sanitizeBuild(x.build),
      options: sanitizeOptions(x.options),
    }));
}

function readSaved() {
  return sanitizeSaved(readKey(SAVED_KEY) ?? (legacySaved || []));
}

const stored = readKey(KEY);
// Older versions kept saved builds inside the main state key. Copy them to
// their own key once; until that write succeeds, persist() keeps them too.
let legacySaved = Array.isArray(stored?.saved) ? stored.saved : null;
if (legacySaved && readKey(SAVED_KEY) == null && writeKey(SAVED_KEY, sanitizeSaved(legacySaved))) legacySaved = null;
else if (readKey(SAVED_KEY) != null) legacySaved = null;
export const state = {
  build: sanitizeBuild(stored?.build),
  options: sanitizeOptions(stored?.options),
  saved: readSaved(),
  tab: TABS.includes(stored?.tab) ? stored.tab : 'build',
};

// Once the parts database is loaded, drop ids that no longer exist.
export function validateAgainst(db) {
  state.build = sanitizeBuild(state.build, db);
}

export function persist() {
  const data = { build: state.build, options: state.options, tab: state.tab };
  if (legacySaved) data.saved = legacySaved; // not migrated yet: don't drop them
  return writeKey(KEY, data);
}

function notify() { for (const fn of listeners) fn(state); }

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function update(mutator) {
  mutator(state);
  persist();
  notify();
}

// Saved builds live under their own key and are re-read before every change,
// so two open windows can't overwrite each other's list.
export function changeSaved(fn) {
  const list = readSaved();
  const next = fn(list) || list;
  state.saved = next;
  const ok = writeKey(SAVED_KEY, next);
  if (ok) legacySaved = null;
  notify();
  return ok;
}

export function buildIsSaved(build = state.build) {
  const key = JSON.stringify(sanitizeBuild(build));
  return state.saved.some((s) => JSON.stringify(sanitizeBuild(s.build)) === key);
}

export const buildHasParts = (build = state.build) => SLOTS.some((s) => build[s.key]);

window.addEventListener('storage', (e) => {
  if (e.key !== SAVED_KEY) return;
  state.saved = readSaved();
  notify();
});

// Share links carry just the selected part ids + options in the URL hash.
function b64url(s) {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  return decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
}

export function shareUrl() {
  const b = {};
  for (const k of ['classId', 'elec', ...SLOTS.map((s) => s.key)]) if (state.build[k]) b[k] = state.build[k];
  const payload = b64url(JSON.stringify({ b, o: state.options }));
  return `${location.origin}${location.pathname}#build=${payload}`;
}

// Returns null (no link), { error } or { backedUp }.
export function importFromHash(db) {
  const m = /#build=([\w-]+)/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  let payload;
  try { payload = JSON.parse(unb64url(m[1])); } catch { return { error: true }; }
  if (!payload || typeof payload.b !== 'object') return { error: true };
  const build = sanitizeBuild(payload.b, db);
  const options = sanitizeOptions(payload.o);
  let backedUp = false;
  if (buildHasParts() && !buildIsSaved() && JSON.stringify(build) !== JSON.stringify(state.build)) {
    const prev = { name: `Before shared link (${new Date().toLocaleString()})`, t: Date.now(), build: { ...state.build }, options: { ...state.options } };
    changeSaved((list) => [prev, ...list]);
    backedUp = true;
  }
  state.build = build;
  state.options = options;
  state.tab = 'build';
  persist();
  return { backedUp };
}
