// Loads the parts database and store catalog, and checks for newer data.

const PARTS_URL = 'data/parts.json';
const META_URL = 'data/meta.json';
const CATALOG_URL = 'data/catalog.json';

async function getJSON(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export function buildDB(doc, meta = null) {
  const parts = Array.isArray(doc.parts) ? doc.parts : [];
  // Null-prototype maps so ids like "__proto__" can't resolve to built-ins.
  const byId = Object.create(null), byCat = Object.create(null);
  for (const p of parts) {
    if (!p || typeof p.id !== 'string') continue;
    byId[p.id] = p;
    (byCat[p.category] ||= []).push(p);
  }
  return { parts, byId, byCat, meta, version: doc.version, generated: doc.generated };
}

export async function loadDB(fresh = false) {
  const init = fresh ? { cache: 'reload' } : undefined;
  const [doc, meta] = await Promise.all([
    getJSON(PARTS_URL, init),
    getJSON(META_URL, init).catch(() => null),
  ]);
  return buildDB(doc, meta);
}

let catalog = null;
let catalogLoad = null;

export const currentCatalog = () => catalog;

// Shared by every view; a failed load can be retried by calling again.
export function loadCatalog(fresh = false) {
  if (catalog && !fresh) return Promise.resolve(catalog);
  if (catalogLoad && !fresh) return catalogLoad;
  catalogLoad = getJSON(CATALOG_URL, fresh ? { cache: 'reload' } : undefined).then((doc) => {
    const stores = doc.stores || {};
    catalog = {
      generated: doc.generated,
      items: (doc.items || []).map((r) => {
        const [s, t, h, p, c, a, v, y, k, i] = r;
        const base = stores[s]?.base || '';
        return {
          store: s, title: t, url: String(h).startsWith('http') ? h : `${base}/products/${h}`, price: p,
          compare_at: c || null, available: !!a, vendor: v || '', type: y || '', cat: k || '',
          image: i ? (String(i).startsWith('http') ? i : `https://cdn.shopify.com/s/files/${i}`) : null,
          hay: `${t} ${v} ${y}`.toLowerCase(),
        };
      }),
    };
    return catalog;
  }).finally(() => { catalogLoad = null; });
  return catalogLoad;
}

export const catalogLoading = () => !!catalogLoad;

// Network only (the service worker doesn't answer no-store requests from its
// cache), so an offline check fails instead of reporting "up to date".
export async function checkForUpdates(currentVersion) {
  const meta = await getJSON(`${META_URL}?t=${Date.now()}`, { cache: 'no-store' });
  return { meta, newer: meta.version !== currentVersion };
}
