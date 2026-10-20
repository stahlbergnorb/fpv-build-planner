// Store offer list (price per store, stock, links) used across views.

import { offersFor, purchaseOptions, offerDir, offerKey } from '../pricing.js';
import { esc, money, safeUrl, storeName } from './dom.js';

function ago(iso) {
  if (!iso) return '';
  const d = (Date.now() - Date.parse(iso)) / 86400000;
  if (!Number.isFinite(d)) return '';
  if (d < 1 / 24) return 'just now';
  if (d < 1) return `${Math.round(d * 24)}h ago`;
  return `${Math.round(d)}d ago`;
}

export function offerList(part, units = 1) {
  const all = offersFor(part);
  if (!all.length) return '<p class="muted small">No store listing found — check the manufacturer.</p>';
  const options = purchaseOptions(part, units);
  const best = options.find((x) => x.available) || options[0];
  // Compare by key: live-refreshed offers are new objects on every call.
  const used = new Set(options.flatMap((x) => x.offers).map(offerKey));
  const unused = all.filter((o) => !used.has(offerKey(o)));
  const unpriced = unused.filter((o) => !(o.price > 0));
  // One-direction props whose store doesn't list the other direction.
  const unpaired = part.category === 'prop' ? unused.filter((o) => o.price > 0 && offerDir(o)) : [];
  const row = (opt) => {
    const o = opt.offer;
    const links = opt.pair
      ? opt.offers.map((x) => `<a href="${safeUrl(x.url)}" target="_blank" rel="noopener">${esc(storeName(x.store))} ${esc((offerDir(x) || '').toUpperCase())}</a>`).join(' + ')
      : `<a href="${safeUrl(o.url)}" target="_blank" rel="noopener">${esc(storeName(o.store))}</a>`;
    const breakdown = opt.pair ? '' : opt.packs > 1 ? `<small> (${opt.packs} × ${money(o.price)})</small>` : '';
    return `<li class="${opt === best ? 'best' : ''} ${opt.available ? '' : 'oos'}">
      <span class="store">${links}</span>
      <span class="price">${money(opt.cost)}${breakdown}${!opt.pair && o.compare_at > o.price ? `<s>${money(o.compare_at * opt.packs)}</s>` : ''}</span>
      <span class="stock">${opt.available ? 'in stock' : 'out of stock'}${!opt.pair && o.pack_qty > 1 ? ` · ${o.pack_qty}/pack` : ''}${opt.pair ? ' · CW + CCW sold separately' : ''}</span>
      <span class="when ${o.live ? 'live' : ''}" title="${esc(o.checked || '')}">${o.live ? 'live ' : ''}${ago(o.checked)}</span>
    </li>`;
  };
  const plain = (o, note) => `<li class="oos">
      <span class="store"><a href="${safeUrl(o.url)}" target="_blank" rel="noopener">${esc(storeName(o.store))}</a></span>
      <span class="price">${o.price > 0 ? money(o.price) : '—'}</span>
      <span class="stock">${esc(note)}</span><span class="when"></span>
    </li>`;
  return `<ul class="offers">${options.map(row).join('')}
    ${unpaired.map((o) => plain(o, `${offerDir(o).toUpperCase()} only — other direction not listed`)).join('')}
    ${unpriced.map((o) => plain(o, 'price updates monthly')).join('')}</ul>`;
}
