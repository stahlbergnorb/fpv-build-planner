// Prices: best offer per part, build cost, per-store totals, and live refresh
// straight from the Shopify stores (their product .js endpoints allow CORS).
// GetFPV has no CORS-enabled feed, so its prices come from the monthly update.

import { STORES } from './classes.js';

const LIVE_KEY = 'fpv.live.v1';
const LIVE_TTL = 3 * 24 * 3600 * 1000;
let live = readLive();

function readLive() {
  try {
    const raw = JSON.parse(localStorage.getItem(LIVE_KEY) || '{}');
    const now = Date.now();
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => v && now - v.t < LIVE_TTL && Number.isFinite(v.price)));
  } catch { return {}; }
}
function writeLive() {
  try { localStorage.setItem(LIVE_KEY, JSON.stringify(live)); } catch { /* storage full or blocked */ }
}

export const offerKey = (o) => `${o.url}#${o.variant || ''}`;

// Offer with any newer live-refreshed price applied.
export function effectiveOffer(o) {
  const l = live[offerKey(o)];
  if (l && (!o.checked || l.t > Date.parse(o.checked))) {
    return { ...o, price: l.price, compare_at: l.compare_at, available: l.available, checked: new Date(l.t).toISOString(), live: true };
  }
  return o;
}

export function offersFor(part) {
  return (part?.offers || []).filter((o) => !o.gone).map(effectiveOffer)
    .sort((a, b) => (a.price ?? Infinity) / (a.pack_qty || 1) - (b.price ?? Infinity) / (b.pack_qty || 1));
}

export const packsNeeded = (units, packQty) => Math.max(1, Math.ceil(units / (packQty || 1)));

// Props sold one direction at a time ("CW" / "CCW" listings).
export function offerDir(o) {
  if (o.dir != null) {
    const d = String(o.dir).toLowerCase();
    if (d === 'cw' || d === 'ccw') return d;
  }
  const s = `${o.url || ''} ${o.variant || ''}`.toLowerCase();
  const ccw = /(^|[^a-z])ccw([^a-z]|$)/.test(s), cw = /(^|[^a-z])cw([^a-z]|$)/.test(s);
  return ccw && !cw ? 'ccw' : cw && !ccw ? 'cw' : null;
}

const inStockFirst = (list) => [...list].sort((a, b) => (a.available === false) - (b.available === false) || a.price - b.price);

// Every way to buy `units` of a part, cheapest first. Single-direction prop
// listings are paired per store (half CW, half CCW); a store with only one
// direction can't supply a set and is skipped.
export function purchaseOptions(part, units = 1) {
  const priced = offersFor(part).filter((o) => typeof o.price === 'number' && o.price > 0);
  const byStore = new Map();
  for (const o of priced) {
    if (!byStore.has(o.store)) byStore.set(o.store, []);
    byStore.get(o.store).push(o);
  }
  const out = [];
  for (const [store, list] of byStore) {
    const dirs = { cw: [], ccw: [] };
    for (const o of list) {
      const d = part.category === 'prop' ? offerDir(o) : null;
      if (d) { dirs[d].push(o); continue; }
      const packs = packsNeeded(units, o.pack_qty);
      out.push({ store, offers: [o], offer: o, packs, cost: packs * o.price, available: o.available !== false });
    }
    if (dirs.cw.length && dirs.ccw.length) {
      const cw = inStockFirst(dirs.cw)[0], ccw = inStockFirst(dirs.ccw)[0];
      const cwUnits = Math.ceil(units / 2), ccwUnits = Math.max(units - cwUnits, 1);
      const cwPacks = packsNeeded(cwUnits, cw.pack_qty), ccwPacks = packsNeeded(ccwUnits, ccw.pack_qty);
      out.push({
        store, offers: [cw, ccw], offer: cw, pair: true, packs: cwPacks + ccwPacks,
        cost: cwPacks * cw.price + ccwPacks * ccw.price,
        available: cw.available !== false && ccw.available !== false,
      });
    }
  }
  return out.sort((a, b) => a.cost - b.cost);
}

const bestOf = (options) => options.find((x) => x.available) || options[0] || null;

// Cheapest way to buy `units` of a part; prefers in-stock offers.
export function bestOffer(part, units = 1) {
  const best = bestOf(purchaseOptions(part, units));
  return best ? { ...best, inStock: best.available } : null;
}

// Units to buy for a summary line (props include spare sets, batteries a count).
export function unitsFor(line, options) {
  if (line.slot === 'prop') return line.qty * Math.max(1, options.spareProps || 1);
  if (line.slot === 'battery') return Math.max(1, options.batteries || 1) * line.qty; // sets × packs in series
  return line.qty;
}

export function costLines(sum, options) {
  return sum.lines
    .filter((l) => options.includeGround || !l.ground)
    .map((l) => {
      const units = unitsFor(l, options);
      const choices = purchaseOptions(l.part, units);
      const best = bestOf(choices);
      return { ...l, units, choices, best: best && { ...best, inStock: best.available }, offers: offersFor(l.part) };
    });
}

export function costTotals(lines) {
  let best = 0, missing = 0;
  for (const l of lines) { if (l.best) best += l.best.cost; else missing++; }
  const stores = {};
  for (const id of Object.keys(STORES)) {
    let total = 0, covered = 0, oos = 0;
    for (const l of lines) {
      const pick = bestOf(l.choices.filter((x) => x.store === id));
      if (!pick) continue;
      total += pick.cost;
      covered++;
      if (!pick.available) oos++;
    }
    stores[id] = { total, covered, oos, of: lines.length };
  }
  return { best, missing, stores };
}

function handleFromUrl(url) {
  const m = /\/products\/([^/?#]+)/.exec(url || '');
  return m ? m[1] : null;
}

// Same rule as scripts/fpvdata.py pick_variant: a named variant must match
// (exact title, else substring, preferring in-stock); with no name, take the
// only variant or the cheapest in-stock one.
export function pickVariant(variants, wanted) {
  if (!variants?.length) return null;
  if (wanted) {
    const w = wanted.toLowerCase();
    const exact = variants.find((v) => (v.title || '').toLowerCase() === w);
    if (exact) return exact;
    const sub = variants.filter((v) => (v.title || '').toLowerCase().includes(w));
    return sub.find((v) => v.available) || sub[0] || null;
  }
  if (variants.length === 1) return variants[0];
  const avail = variants.filter((v) => v.available);
  return [...(avail.length ? avail : variants)].sort((a, b) => a.price - b.price)[0];
}

export async function fetchLiveOffer(o, signal) {
  const store = STORES[o.store];
  const handle = handleFromUrl(o.url);
  if (!store?.shopify || !handle) return null;
  const res = await fetch(`${store.base}/products/${handle}.js`, { mode: 'cors', cache: 'no-store', signal });
  if (!res.ok) throw new Error(`${store.name}: HTTP ${res.status}`);
  const j = await res.json();
  const v = pickVariant(j.variants, o.variant);
  if (!v || !Number.isFinite(v.price)) return null;
  const rec = {
    price: v.price / 100,
    compare_at: v.compare_at_price ? v.compare_at_price / 100 : null,
    available: !!v.available,
    t: Date.now(),
  };
  live[offerKey(o)] = rec;
  return rec;
}

// Refresh every Shopify offer in `offers` (deduped), a few at a time.
export async function refreshLive(offers, onProgress = () => {}, signal) {
  const todo = [];
  const seen = new Set();
  for (const o of offers) {
    if (!STORES[o.store]?.shopify) continue;
    const k = offerKey(o);
    if (seen.has(k)) continue;
    seen.add(k);
    todo.push(o);
  }
  let done = 0, failed = 0;
  const worker = async () => {
    while (todo.length) {
      const o = todo.shift();
      try { if (!(await fetchLiveOffer(o, signal))) failed++; } catch (e) { if (e.name === 'AbortError') return; failed++; }
      done++;
      onProgress(done, done + todo.length, failed);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  writeLive();
  return { done, failed };
}

export function liveCount() { return Object.keys(live).length; }
export function clearLive() { live = {}; writeLive(); }
