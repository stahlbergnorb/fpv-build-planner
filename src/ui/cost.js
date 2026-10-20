// Cost tab: price per part across stores, best-mix and single-store totals,
// and live price refresh from the Shopify stores.

import { costLines, costTotals, refreshLive, liveCount } from '../pricing.js';
import { STORES } from '../classes.js';
import { esc, money, partTitle, storeName, toast } from './dom.js';
import { offerList } from './offers.js';

let refreshing = null; // { done, total, failed }

export function render(app) {
  const o = app.state.options;
  const lines = costLines(app.summary, o);
  if (!lines.length) {
    return `<section class="card empty"><h2>Cost</h2><p>Add parts on the Build tab to price your build across RaceDayQuads, GetFPV, NewBeeDrone and FlyFive33.</p>
      <button class="btn" data-act="tab" data-tab="build">Go to Build</button></section>`;
  }
  const t = costTotals(lines);
  const storeRows = Object.entries(t.stores).filter(([, v]) => v.covered)
    .sort((a, b) => b[1].covered - a[1].covered || a[1].total - b[1].total);
  const generated = app.db.meta?.prices_checked || app.db.generated;
  return `
  <section class="cost">
    <div class="card">
      <div class="cost-head">
        <div>
          <h2>Build cost</h2>
          <p class="big">${money(t.best)} <small>best price per part${t.missing ? ` · ${t.missing} part${t.missing > 1 ? 's' : ''} unpriced` : ''}</small></p>
          <p class="small muted">Store prices checked ${generated ? esc(new Date(generated).toLocaleDateString()) : 'at last data update'}${liveCount() ? ' · some refreshed live' : ''}. Excludes shipping and tax.</p>
        </div>
        <div class="cost-actions">
          <button class="btn" data-act="cost-live" ${refreshing ? 'disabled' : ''}>${refreshing ? `Refreshing ${refreshing.done}/${refreshing.total}…` : 'Refresh live prices'}</button>
          <p class="small muted">Live from RaceDayQuads, NewBeeDrone and FlyFive33. GetFPV prices update monthly.</p>
        </div>
      </div>
      <div class="cost-opts">
        <label>${(o.seriesPacks || 1) > 1 ? `Battery sets (${o.seriesPacks} packs each)` : 'Batteries'}<input type="number" min="1" max="20" value="${esc(o.batteries)}" data-in="cost-bat"></label>
        <label>Prop sets (of ${app.summary.motors})<input type="number" min="1" max="20" value="${esc(o.spareProps)}" data-in="cost-props"></label>
        <label class="tog"><input type="checkbox" data-in="cost-ground" ${o.includeGround ? 'checked' : ''}> Include radio & goggles</label>
      </div>
    </div>

    <div class="card">
      <h3>Per store</h3>
      <table class="tbl">
        <thead><tr><th>Store</th><th class="num">Parts carried</th><th class="num">Subtotal</th></tr></thead>
        <tbody>
          <tr class="selected"><td><strong>Best mix</strong> (cheapest store per part)</td><td class="num">${lines.length - t.missing}/${lines.length}</td><td class="num"><strong>${money(t.best)}</strong></td></tr>
          ${storeRows.map(([id, v]) => `<tr><td><a href="${esc(STORES[id].base)}" target="_blank" rel="noopener">${esc(storeName(id))}</a></td><td class="num">${v.covered}/${v.of}${v.oos ? `<br><small class="t-warn">${v.oos} out of stock</small>` : ''}</td><td class="num">${money(v.total)}${v.covered < v.of ? ' <small class="muted">partial</small>' : ''}</td></tr>`).join('')}
        </tbody>
      </table>
      <p class="small muted">Buying everything from one store can save on shipping even if the parts cost a little more.</p>
    </div>

    <div class="card">
      <h3>Parts</h3>
      <ul class="cost-lines">${lines.map((l) => `
        <li>
          <div class="cl-head">
            <span><span class="muted small">${esc(l.label)}</span><br><strong>${partTitle(l.part)}</strong>${l.units > 1 ? ` <em>× ${l.units}</em>` : ''}</span>
            <span class="num">${l.best ? `<strong>${money(l.best.cost)}</strong><br><span class="small muted">${esc(storeName(l.best.offer.store))}${l.best.inStock ? '' : ' · out of stock'}</span>` : '<span class="muted">no price</span>'}</span>
          </div>
          ${offerList(l.part, l.units)}
        </li>`).join('')}
      </ul>
    </div>
  </section>`;
}

export const actions = {
  async 'cost-live'(el, ev, app) {
    const offers = costLines(app.summary, app.state.options).flatMap((l) => l.offers);
    refreshing = { done: 0, total: offers.length, failed: 0 };
    app.render();
    const res = await refreshLive(offers, (done, total, failed) => {
      refreshing = { done, total, failed };
      const btn = document.querySelector('[data-act="cost-live"]');
      if (btn) btn.textContent = `Refreshing ${done}/${total}…`;
    });
    refreshing = null;
    if (app.state.tab === 'cost') app.render();
    toast(res.failed ? `Updated ${res.done - res.failed} prices, ${res.failed} failed (offline or listing removed)` : `Updated ${res.done} prices live`);
  },
};

export const inputs = {
  'cost-bat'(el, ev, app) { app.update((s) => { s.options.batteries = Math.max(1, parseInt(el.value, 10) || 1); }); },
  'cost-props'(el, ev, app) { app.update((s) => { s.options.spareProps = Math.max(1, parseInt(el.value, 10) || 1); }); },
  'cost-ground'(el, ev, app) { app.update((s) => { s.options.includeGround = el.checked; }); },
};
