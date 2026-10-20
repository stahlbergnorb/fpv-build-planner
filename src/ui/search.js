// Search tab: curated parts (with compatibility + "add to build") and the full
// store catalogs (every listing, cheapest first), plus links to search each store.

import { loadCatalog, currentCatalog, catalogLoading } from '../data.js';
import { STORES, CATEGORY_LABELS } from '../classes.js';
import { bestOffer, effectiveOffer, refreshLive } from '../pricing.js';
import { rateCandidate } from '../compat.js';
import { esc, money, dot, specLine, partTitle, storeName, safeUrl, toast } from './dom.js';
import { offerList } from './offers.js';

const CAT_EXTRA = { antenna: 'Antennas', charger: 'Chargers & power', kit: 'Ready-to-fly / BNF', tool: 'Tools', accessory: 'Accessories', other: 'Other' };
const SLOT_FOR_CAT = { frame: 'frame', motor: 'motor', prop: 'prop', fc: 'fc', esc: 'esc', aio: 'aio', stack: 'stack', battery: 'battery', camera: 'camera', vtx: 'vtx', receiver: 'receiver', radio: 'radio', goggles: 'goggles', gps: 'gps', payload: 'payload' };

const st = { q: '', cat: '', store: '', inStock: true, maxPrice: '', sort: 'relevance', limit: 40, openPart: null, error: null, refreshing: false };

function tokens(q) { return q.toLowerCase().split(/\s+/).filter(Boolean); }

function score(hay, title, toks) {
  let s = 0;
  for (const t of toks) {
    if (!hay.includes(t)) return -1;
    s += title.startsWith(t) ? 3 : title.includes(` ${t}`) ? 2 : 1;
  }
  return s;
}

function partResults(app) {
  const toks = tokens(st.q);
  if (!toks.length) return [];
  const out = [];
  for (const p of app.db.parts) {
    if (st.cat && p.category !== st.cat) continue;
    if (st.store && !(p.offers || []).some((o) => o.store === st.store)) continue;
    const title = `${p.brand} ${p.name}`.toLowerCase();
    const sc = score(`${title} ${specLine(p)} ${p.category}`.toLowerCase(), title, toks);
    if (sc < 0) continue;
    const best = bestOffer(p);
    if (st.inStock && best && !best.inStock) continue;
    if (st.maxPrice && best && best.cost > Number(st.maxPrice)) continue;
    out.push({ p, sc, best });
  }
  const price = (x) => x.best?.cost ?? Infinity;
  out.sort(st.sort === 'price' ? (a, b) => price(a) - price(b) : st.sort === 'price-desc' ? (a, b) => price(b) - price(a) : (a, b) => b.sc - a.sc || price(a) - price(b));
  return out.slice(0, 30);
}

function catalogResults() {
  const catalog = currentCatalog();
  if (!catalog) return { list: [], total: 0 };
  const toks = tokens(st.q);
  if (!toks.length && !st.cat) return { list: [], total: 0 };
  const res = [];
  for (const raw of catalog.items) {
    if (st.cat && raw.cat !== st.cat) continue;
    if (st.store && raw.store !== st.store) continue;
    const it = { ...raw, ...pickLive(raw, catalog.generated) };
    if (st.inStock && !it.available) continue;
    if (st.maxPrice && it.price > Number(st.maxPrice)) continue;
    const sc = toks.length ? score(it.hay, it.title.toLowerCase(), toks) : 1;
    if (sc < 0) continue;
    res.push({ it, sc });
  }
  const sorts = {
    relevance: (a, b) => b.sc - a.sc || a.it.price - b.it.price,
    price: (a, b) => a.it.price - b.it.price,
    'price-desc': (a, b) => b.it.price - a.it.price,
  };
  res.sort(sorts[st.sort]);
  return { list: res.slice(0, st.limit).map((x) => x.it), total: res.length };
}

function pickLive(item, generated) {
  const e = effectiveOffer({ store: item.store, url: item.url, price: item.price, available: item.available, checked: generated });
  return { price: e.price, available: e.available, live: !!e.live };
}

function partCard(app, { p, best }) {
  const slot = SLOT_FOR_CAT[p.category];
  const rating = slot ? rateCandidate(slot, p, app.state.build, app.db, app.state.options) : null;
  const open = st.openPart === p.id;
  return `<li class="res">
    <div class="res-row">
      ${rating ? dot(rating.status) : ''}
      <div class="res-text">
        <span class="muted small">${esc(CATEGORY_LABELS[p.category] || p.category)}</span>
        <strong>${partTitle(p)}</strong>
        <span class="small">${esc(specLine(p))}</span>
        ${rating?.checks?.[0] ? `<span class="small t-${rating.checks[0].status}">${esc(rating.checks[0].detail)}</span>` : ''}
      </div>
      <div class="res-price">${best ? `<strong>${money(best.cost)}</strong><span class="small muted">${esc(storeName(best.offer.store))}</span>` : '<span class="muted small">no price</span>'}</div>
    </div>
    <div class="res-actions">
      ${slot ? `<button class="btn small" data-act="s-add" data-id="${esc(p.id)}">Add to build</button>` : ''}
      <button class="btn small ghost" data-act="s-open" data-id="${esc(p.id)}">${open ? 'Hide' : 'Compare'} stores (${(p.offers || []).length})</button>
    </div>
    ${open ? offerList(p) : ''}
  </li>`;
}

function catalogRow(it) {
  return `<li class="res cat-row ${it.available ? '' : 'oos'}">
    ${it.image ? `<img src="${safeUrl(`${it.image}${it.image.includes('?') ? '&' : '?'}width=96`)}" alt="" loading="lazy" width="48" height="48">` : '<span class="noimg"></span>'}
    <div class="res-text">
      <a href="${safeUrl(it.url)}" target="_blank" rel="noopener"><strong>${esc(it.title)}</strong></a>
      <span class="small muted">${esc(storeName(it.store))}${it.vendor ? ` · ${esc(it.vendor)}` : ''}${it.available ? '' : ' · out of stock'}</span>
    </div>
    <div class="res-price"><strong>${money(it.price)}</strong>${it.compare_at > it.price ? `<s class="small">${money(it.compare_at)}</s>` : ''}${it.live ? '<span class="small live">live</span>' : ''}</div>
  </li>`;
}

function filters(app) {
  const cats = { ...CATEGORY_LABELS, ...CAT_EXTRA };
  return `<div class="search-filters">
    <select data-in="s-cat" aria-label="Category"><option value="">All categories</option>${Object.entries(cats).map(([k, l]) => `<option value="${k}" ${st.cat === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    <select data-in="s-store" aria-label="Store"><option value="">All stores</option>${Object.entries(STORES).map(([k, s]) => `<option value="${k}" ${st.store === k ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <select data-in="s-sort" aria-label="Sort"><option value="relevance" ${st.sort === 'relevance' ? 'selected' : ''}>Best match</option><option value="price" ${st.sort === 'price' ? 'selected' : ''}>Price: low to high</option><option value="price-desc" ${st.sort === 'price-desc' ? 'selected' : ''}>Price: high to low</option></select>
    <input type="number" min="0" placeholder="Max $" value="${esc(st.maxPrice)}" data-in="s-max" aria-label="Maximum price">
    <label class="tog"><input type="checkbox" data-in="s-stock" ${st.inStock ? 'checked' : ''}> In stock</label>
  </div>`;
}

function ensureCatalog(app) {
  if (currentCatalog() || catalogLoading()) return;
  st.error = null;
  loadCatalog().catch((e) => { st.error = e.message; })
    .finally(() => { if (app.state.tab === 'search') renderResults(app); });
}

export function render(app) {
  ensureCatalog(app); // retried every time the tab opens
  return `<section class="search">
    <div class="card">
      <h2>Find parts & best prices</h2>
      <input id="search-q" class="big-input" type="search" placeholder="Search e.g. 2207 1950kv, ELRS receiver, 6S 1300, O4 Pro…" value="${esc(st.q)}" data-in="s-q" autocomplete="off">
      ${filters(app)}
    </div>
    <div id="search-results">${results(app)}</div>
  </section>`;
}

function results(app) {
  const catalog = currentCatalog();
  const loading = !catalog && catalogLoading();
  const toks = tokens(st.q);
  if (!toks.length && !st.cat) {
    return `<div class="card"><p class="muted">Type to search ${app.db.parts.length} curated parts${catalog ? ` and ${catalog.items.length.toLocaleString()} store listings` : ''}. Results show the cheapest in-stock listings first.</p></div>`;
  }
  const parts = partResults(app);
  const cat = catalogResults();
  const deep = st.q ? `<p class="small">Search directly: ${Object.entries(STORES).map(([k, s]) => `<a href="${safeUrl(s.search + encodeURIComponent(st.q))}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join(' · ')}</p>` : '';
  return `
    ${parts.length ? `<div class="card"><h3>In the planner database <span class="muted small">(${parts.length})</span></h3><ul class="results">${parts.map((x) => partCard(app, x)).join('')}</ul></div>` : ''}
    <div class="card">
      <div class="cost-head"><h3>Store listings <span class="muted small">${catalog ? `(${cat.total.toLocaleString()} matches)` : ''}</span></h3>
        ${cat.list.length ? `<button class="btn small" data-act="s-live" ${st.refreshing ? 'disabled' : ''}>${st.refreshing ? 'Refreshing…' : 'Refresh these prices live'}</button>` : ''}</div>
      ${loading ? '<p class="muted">Loading store catalog…</p>' : !catalog && st.error ? `<p class="t-bad">Couldn't load the store catalog (${esc(st.error)}). <button class="btn small ghost" data-act="s-retry">Retry</button></p>` : ''}
      ${catalog ? `<p class="small muted">Catalog from ${esc(new Date(catalog.generated).toLocaleDateString())}.</p>` : ''}
      <ul class="results">${cat.list.map(catalogRow).join('')}</ul>
      ${cat.total > cat.list.length ? `<button class="btn ghost" data-act="s-more">Show more</button>` : ''}
      ${deep}
    </div>`;
}

function renderResults(app) {
  const el = document.getElementById('search-results');
  if (el) el.innerHTML = results(app);
}

export const actions = {
  's-add'(el, ev, app) {
    const p = app.db.byId[el.dataset.id];
    const slot = SLOT_FOR_CAT[p.category];
    app.update((s) => {
      s.build[slot] = p.id;
      if (p.category === 'aio') s.build.elec = 'aio';
      if (p.category === 'stack') s.build.elec = 'stack';
      if (p.category === 'fc' || p.category === 'esc') s.build.elec = 'separate';
    });
    toast(`Added ${p.brand} ${p.name} to your build`);
  },
  's-open'(el, ev, app) { st.openPart = st.openPart === el.dataset.id ? null : el.dataset.id; renderResults(app); },
  's-more'(el, ev, app) { st.limit += 40; renderResults(app); },
  's-retry'(el, ev, app) { ensureCatalog(app); renderResults(app); },
  async 's-live'(el, ev, app) {
    const { list } = catalogResults();
    st.refreshing = true;
    renderResults(app);
    const res = await refreshLive(list.map((it) => ({ store: it.store, url: it.url })));
    st.refreshing = false;
    renderResults(app);
    toast(res.failed ? `Updated ${res.done - res.failed}, ${res.failed} failed` : `Updated ${res.done} prices live`);
  },
};

export const inputs = {
  's-q'(el, ev, app) { st.q = el.value; st.limit = 40; renderResults(app); },
  's-cat'(el, ev, app) { st.cat = el.value; st.limit = 40; renderResults(app); },
  's-store'(el, ev, app) { st.store = el.value; renderResults(app); },
  's-sort'(el, ev, app) { st.sort = el.value; renderResults(app); },
  's-max'(el, ev, app) { st.maxPrice = el.value; renderResults(app); },
  's-stock'(el, ev, app) { st.inStock = el.checked; renderResults(app); },
};
