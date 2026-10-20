"""Refresh prices and the store catalog. Run monthly (GitHub Actions) or by hand.

    python scripts/update_data.py                 # full refresh
    python scripts/update_data.py --skip-getfpv   # Shopify stores only (fast)
    python scripts/update_data.py --from-cache    # dev: reuse .scratch/index/*.raw.json

Writes data/parts.json (offer prices/stock), data/catalog.json (every listing
from the Shopify stores, for the Search tab) and data/meta.json (version info
the app uses to detect updates). Shopify results are saved before the slower
GetFPV pass, so a blocked or slow GetFPV never costs the whole refresh.
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fpvdata  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
CACHE = os.path.join(ROOT, ".scratch", "index")

GETFPV_BUDGET_S = 30 * 60
GETFPV_MAX_CONSECUTIVE_ERRORS = 6

SKIP_TYPES = re.compile(r"swag|shirt|gift card|replacement service|apparel|\bhats?\b|hoodie|sticker|clothing|merchandise|home decor|puzzle", re.I)

# (category, regex on the store's product type) — first match wins.
CATEGORY_RULES = [
    ("kit", r"bnf|rtf|pnp|ready to fly|^quad$|drone kit|wing pnp|consumer drone|enterprise|^builds?$"),
    ("goggles", r"video receiver|\bvrx\b|^goggles?$"),
    ("vtx", r"video transmitter"),
    ("accessory", r"\bacc\b|accessor|hardware|replacement part|frame part|\bstraps?\b|standoff|screw|\bnuts?\b|cable|\bled\b|\bcases?\b|\bbags?\b|gate|3d print"),
    ("stack", r"^stack$"),
    ("aio", r"\baio\b"),
    ("frame", r"^(drone )?frames?$|frames? \(|^frame$|tiny trainer|lightswitch|open racer|midmount|spec7|footy"),
    ("motor", r"^(drone )?motors?$|\d\" motor"),
    ("prop", r"prop"),
    ("fc", r"(^|\b)(fc|flight controller)s?$|analog fc|autopilot"),
    ("esc", r"(^|\b)escs?$|analog esc"),
    ("battery", r"batter(y|ies)$"),
    ("vtx", r"^vtx$|video system|digital"),
    ("camera", r"^camera$|fpv camera"),
    ("receiver", r"rc rx|elrs rx|\brx$|receiver"),
    ("radio", r"rc tx$|remote controller|external module|^radio|transmitter"),
    ("gps", r"gps"),
    ("payload", r"action camera"),
    ("antenna", r"antenna"),
    ("charger", r"charger|power management|power supply"),
    ("tool", r"tool|solder|screwdriver"),
]
# Used when the store type is blank or unhelpful; matched on the core title.
TITLE_FALLBACK = [
    ("accessory", r"\b(standoffs?|screws?|spacers?|grommets?|brackets?|adapters?|cables?|straps?|savers?)\b"),
    ("stack", r"\bstack\b"),
    ("aio", r"\baio\b"),
    ("frame", r"\bframe( kit)?\b"),
    ("motor", r"\b\d{4}(\.\d)?\b.*\d{3,5}\s*kv\b"),
    ("prop", r"\bprop(eller)?s?\b"),
    ("battery", r"\d\s*s(\d\s*p)?\b.*\d\s*mah\b|\d\s*mah\b.*\d\s*s(\d\s*p)?\b|\blipo\b"),
    ("receiver", r"expresslrs|\belrs\b.*\b(rx|receiver)\b|\b(rx|receiver)\b.*\belrs\b"),
    ("goggles", r"\bvrx\b|goggle receiver|(5\.8|1\.[23]\s*g|video|goggle|screen).*receiver module|goggles?\b"),
    ("vtx", r"\bvtx\b|air unit"),
    ("esc", r"\besc\b"),
    ("receiver", r"\breceiver\b|\brx\b"),
    ("camera", r"\bcamera\b"),
    ("antenna", r"antenna"),
    ("charger", r"charger"),
]


def core_title(title):
    """Title without parentheticals, 'w/ ...' extras and lens specs."""
    t = re.sub(r"\([^)]*\)", " ", title.lower())
    t = re.sub(r"\bw/.*$", " ", t)
    t = re.sub(r"\bwith\b.*$", " ", t)
    return re.sub(r"\d+(\.\d+)?\s*mm\s+lens", " ", t)


def categorize(ptype, title):
    t = (ptype or "").strip().lower()
    ti = (title or "").lower()
    core = core_title(title or "")
    # Mixed store categories: decide from the title.
    if "fc+esc" in t.replace(" ", ""):
        if "stack" in ti or "combo" in ti:
            return "stack"
        if "aio" in ti:
            return "aio"
        if re.search(r"\besc\b", ti) and not re.search(r"flight controller|\bfc\b", ti):
            return "esc"
        if re.search(r"flight controller|\bfc\b|\b[fh]7\d\d\b|\bf4\d\d\b|kakute", ti):
            return "fc"
        return "accessory"
    if re.search(r"vtx camera|camera vtx|^vtx$", t):
        if re.search(r"cable|filter|antenna|mount|lens|protector|cooling|bracket", core):
            return "accessory"
        if "camera" in core and not re.search(r"kit|air unit|vtx|system|link", ti):
            return "camera"
        return "vtx"
    for cat, type_rx in CATEGORY_RULES:
        if t and re.search(type_rx, t):
            return cat
    for cat, rx in TITLE_FALLBACK:
        if re.search(rx, core):
            return cat
    return "other"


def write_json(path, obj, compact=False):
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=1)
            f.write("\n")
    os.replace(tmp, path)


def load_catalogs(from_cache):
    out, complete = {}, {}
    for store_id in fpvdata.SHOPIFY_STORES:
        cached = os.path.join(CACHE, f"{store_id}.raw.json")
        if from_cache and os.path.exists(cached):
            with open(cached, encoding="utf-8") as f:
                out[store_id] = json.load(f)
            complete[store_id] = True
            print(f"{store_id}: {len(out[store_id])} products (cache)")
            continue
        try:
            out[store_id], complete[store_id] = fpvdata.fetch_shopify_catalog(store_id)
            print(f"{store_id}: {len(out[store_id])} products{'' if complete[store_id] else ' (INCOMPLETE: page cap hit)'}")
        except (RuntimeError, ValueError) as e:
            print(f"{store_id}: catalog fetch FAILED ({e}); its offers keep last month's data")
            out[store_id], complete[store_id] = [], False
    return out, complete


def short_image(src):
    if not src:
        return None
    src = src.split("?")[0]
    prefix = "https://cdn.shopify.com/s/files/"
    return src[len(prefix):] if src.startswith(prefix) else src


def build_catalog(catalogs, now, trusted):
    """Fresh rows for stores with a whole listing; last month's rows otherwise."""
    old_rows = {}
    old_path = os.path.join(DATA, "catalog.json")
    if os.path.exists(old_path):
        try:
            with open(old_path, encoding="utf-8") as f:
                for row in json.load(f).get("items", []):
                    old_rows.setdefault(row[0], []).append(row)
        except (ValueError, OSError):
            pass
    items = []
    for store_id, products in catalogs.items():
        if not trusted.get(store_id) and old_rows.get(store_id):
            items.extend(old_rows[store_id])
            print(f"  catalog: kept last month's {len(old_rows[store_id])} {store_id} listings")
            continue
        for p in products:
            title = (p.get("title") or "").strip()
            ptype = p.get("product_type") or ""
            if not title or SKIP_TYPES.search(ptype) or SKIP_TYPES.search(title):
                continue
            variants = fpvdata.shopify_variants(p)
            priced = [v for v in variants if v["price"] > 0]
            if not priced:
                continue
            avail = [v for v in priced if v["available"]]
            v = min(avail or priced, key=lambda x: x["price"])
            img = (p.get("images") or [{}])[0].get("src") if p.get("images") else None
            items.append([
                store_id, title, p["handle"], round(v["price"], 2),
                round(v["compare_at"], 2) if v["compare_at"] and v["compare_at"] > v["price"] else 0,
                1 if avail else 0, p.get("vendor") or "", ptype, categorize(ptype, title), short_image(img),
            ])
    return {
        "generated": now,
        "stores": {k: {"name": v["name"], "base": v["base"]} for k, v in fpvdata.SHOPIFY_STORES.items()},
        "fields": ["store", "title", "handle", "price", "compare_at", "available", "vendor", "type", "category", "image"],
        "items": items,
    }


def apply_variant(o, v, now):
    o.pop("gone", None)
    o.pop("variant_missing", None)
    o["price"] = round(v["price"], 2)
    o["compare_at"] = round(v["compare_at"], 2) if v.get("compare_at") and v["compare_at"] > v["price"] else None
    o["available"] = bool(v["available"])
    o["checked"] = now


def refresh_shopify(parts, catalogs, trusted, now, stats, log_missing):
    index = {}
    for store_id, products in catalogs.items():
        for p in products:
            index[(store_id, p["handle"])] = fpvdata.shopify_variants(p)
    for part in parts:
        for o in part.get("offers", []):
            store = o.get("store")
            if store not in fpvdata.SHOPIFY_STORES or not trusted.get(store):
                continue
            handle = fpvdata.shopify_handle_from_url(o.get("url"))
            variants = index.get((store, handle))
            if variants is None:
                # Handle may have changed (Shopify redirects old URLs): ask the store.
                base = fpvdata.SHOPIFY_STORES[store]["base"]
                try:
                    status, body, final = fpvdata.http_get_full(f"{base}/products/{handle}.js", retries=2)
                except RuntimeError:
                    stats["errors"] += 1
                    continue
                if status in (404, 410):
                    o["available"] = False
                    o["gone"] = True
                    stats["gone"] += 1
                    continue
                if status != 200:
                    stats["errors"] += 1
                    continue
                final_path = final.split("?")[0]
                if "/products/" not in final_path:  # redirected to a collection/home page
                    o["available"] = False
                    o["gone"] = True
                    stats["gone"] += 1
                    continue
                try:
                    js = json.loads(body)
                    assert isinstance(js, dict) and "variants" in js
                except (ValueError, AssertionError):
                    stats["errors"] += 1  # HTML/maintenance page: keep last data
                    continue
                new_handle = fpvdata.shopify_handle_from_url(re.sub(r"\.js$", "", final_path)) or handle
                o["url"] = fpvdata.shopify_product_url(store, new_handle)
                variants = fpvdata.shopify_js_variants(js)
                stats["redirected"] += 1
            v = fpvdata.pick_variant(variants, o.get("variant"))
            if v is None:
                o["variant_missing"] = True
                stats["variant_missing"] += 1
                log_missing(part["id"], store, o.get("variant"), [x["title"] for x in variants])
                continue
            apply_variant(o, v, now)
            stats["updated"] += 1


def refresh_getfpv(parts, now, stats, log_missing):
    started, consecutive = time.time(), 0
    cache = {}
    # Least recently *attempted* first, so offers skipped by a time budget go
    # first next run and offers that keep failing drift to the back.
    queue = sorted(((part, o) for part in parts for o in part.get("offers", []) if o.get("store") == "getfpv"),
                   key=lambda po: po[1].get("tried") or po[1].get("checked") or "")
    for part, o in queue:
        url = o.get("url")
        if url not in cache:
            if time.time() - started > GETFPV_BUDGET_S or consecutive >= GETFPV_MAX_CONSECUTIVE_ERRORS:
                stats["getfpv_aborted"] = True
                reason = "time budget" if consecutive < GETFPV_MAX_CONSECUTIVE_ERRORS else "repeated errors — likely blocked"
                print(f"  getfpv: stopping early ({reason}); remaining offers keep last data")
                return
            cache[url] = fpvdata.fetch_getfpv_offer(url)
            # Only fresh failures count toward "blocked"; known-bad URLs don't.
            if cache[url][0] == "error":
                consecutive = consecutive + (0 if o.get("error_streak") else 1)
            else:
                consecutive = 0
        o["tried"] = now
        outcome, info = cache[url]
        if outcome == "error":
            o["error_streak"] = (o.get("error_streak") or 0) + 1
            stats["getfpv_error"] += 1
            continue
        o.pop("error_streak", None)
        if outcome == "gone":
            o["available"] = False
            o["gone"] = True
            stats["getfpv_gone"] += 1
            continue
        v = None
        if o.get("variant") and info.get("variants"):
            v = fpvdata.pick_variant(info["variants"], o["variant"])
            if v is None:
                o["variant_missing"] = True
                stats["variant_missing"] += 1
                log_missing(part["id"], "getfpv", o["variant"], [x["title"] for x in info["variants"]])
                continue
        if v and v["price"] > 0:
            apply_variant(o, v, now)
        elif info.get("price"):
            apply_variant(o, {"price": info["price"], "compare_at": None, "available": info["available"]}, now)
        else:
            o["available"] = info["available"]  # no price published (e.g. out of stock): keep the last one
        stats["getfpv_ok"] += 1


def write_outputs(doc, catalogs, trusted, stats, now, write_catalog):
    version = dt.datetime.now(dt.timezone.utc).strftime("%Y.%m.%d-%H%M")
    doc["version"] = version
    doc["generated"] = now
    write_json(os.path.join(DATA, "parts.json"), doc)
    meta_path = os.path.join(DATA, "meta.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
    if write_catalog:
        catalog = build_catalog(catalogs, now, trusted)
        write_json(os.path.join(DATA, "catalog.json"), catalog, compact=True)
        meta["catalog_listings"] = len(catalog["items"])
        print(f"catalog: {len(catalog['items'])} listings")
    stores = meta.get("stores", {})
    for k, name in fpvdata.STORE_NAMES.items():
        entry = stores.get(k, {"name": name})
        if trusted.get(k):  # a failed or short crawl never lowers the baseline
            entry["products"] = len(catalogs[k])
        stores[k] = entry
    meta.update({
        "version": version,
        "generated": now,
        "prices_checked": now,
        "parts": len(doc["parts"]),
        "offers": sum(len(p.get("offers", [])) for p in doc["parts"]),
        "offer_stats": stats,
        "stores": stores,
    })
    write_json(meta_path, meta)
    print("version", version, stats)


def main():
    fpvdata.utf8_stdout()
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-getfpv", action="store_true")
    ap.add_argument("--from-cache", action="store_true")
    ap.add_argument("--no-catalog", action="store_true")
    args = ap.parse_args()

    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    with open(os.path.join(DATA, "parts.json"), encoding="utf-8") as f:
        doc = json.load(f)
    prev_meta = {}
    if os.path.exists(os.path.join(DATA, "meta.json")):
        with open(os.path.join(DATA, "meta.json"), encoding="utf-8") as f:
            prev_meta = json.load(f)

    catalogs, complete = load_catalogs(args.from_cache)
    # Only trust a store's listing for "gone"/price decisions if it looks whole.
    trusted = {}
    for store, products in catalogs.items():
        prev = (prev_meta.get("stores", {}).get(store) or {}).get("products") or 0
        trusted[store] = bool(products) and complete.get(store, False) and len(products) >= 0.5 * prev
        if products and not trusted[store]:
            print(f"  {store}: listing looks short ({len(products)} vs {prev} last time); leaving its offers unchanged")

    stats = {"updated": 0, "gone": 0, "redirected": 0, "variant_missing": 0, "errors": 0,
             "getfpv_ok": 0, "getfpv_gone": 0, "getfpv_error": 0, "getfpv_aborted": False}
    missing = []
    log_missing = lambda pid, store, want, have: missing.append(f"  {pid} @ {store}: variant {want!r} not in {have[:8]}")

    refresh_shopify(doc["parts"], catalogs, trusted, now, stats, log_missing)
    write_catalog = not args.no_catalog and any(catalogs.values())
    write_outputs(doc, catalogs, trusted, stats, now, write_catalog)  # Shopify results are safe now

    if not args.skip_getfpv:
        refresh_getfpv(doc["parts"], now, stats, log_missing)
        write_outputs(doc, catalogs, trusted, stats, now, False)
    if missing:
        print(f"{len(missing)} offers whose variant no longer matches (left unchanged):")
        print("\n".join(missing[:60]))


if __name__ == "__main__":
    main()
