"""Shared helpers for fetching FPV store data.

Stdlib only, so it runs with a plain Python 3.9+ install locally and in
GitHub Actions. Every request identifies itself, waits between calls, and
only touches paths the stores' robots.txt allows (product JSON / product
pages, never /search or /cart).
"""

import html
import json
import re
import sys
import time
import urllib.error
import urllib.request

USER_AGENT = (
    "Mozilla/5.0 (compatible; fpv-build-planner/1.0; "
    "+https://github.com/) price-refresh"
)

# Shopify stores expose /products.json (public, CORS-enabled).
SHOPIFY_STORES = {
    "rdq": {"name": "RaceDayQuads", "base": "https://www.racedayquads.com"},
    "newbee": {"name": "NewBeeDrone", "base": "https://www.newbeedrone.com"},
    "five33": {"name": "FlyFive33", "base": "https://www.flyfive33.com"},
}

# GetFPV runs Magento; prices come from the JSON-LD block on each product page.
GETFPV = {"name": "GetFPV", "base": "https://www.getfpv.com"}

STORE_NAMES = {k: v["name"] for k, v in SHOPIFY_STORES.items()}
STORE_NAMES["getfpv"] = GETFPV["name"]

RETRY_STATUSES = (429, 500, 502, 503, 504)
_last_request = {}


def utf8_stdout():
    """Avoid UnicodeEncodeError on Windows consoles / redirected output."""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass


def http_get_full(url, delay=0.8, timeout=45, retries=3, retry_statuses=RETRY_STATUSES):
    """GET with a per-host politeness delay and retry/backoff.

    Returns (status, body, final_url). 404/410 and non-retryable statuses
    (e.g. a 403 bot challenge) come back immediately instead of raising.
    """
    host = url.split("/")[2]
    last_err = None
    for attempt in range(max(1, retries)):
        wait = _last_request.get(host, 0) + delay - time.time()
        if wait > 0:
            time.sleep(wait)
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                _last_request[host] = time.time()
                return resp.status, resp.read(), resp.geturl()
        except urllib.error.HTTPError as e:
            _last_request[host] = time.time()
            if e.code not in retry_statuses:
                return e.code, b"", url
            last_err = e
            time.sleep((10 if e.code == 429 else 2) * (attempt + 1))
        except Exception as e:  # network hiccup / timeout
            _last_request[host] = time.time()
            last_err = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET failed for {url}: {last_err}")


def http_get(url, delay=0.8, timeout=45, retries=3):
    status, body, _ = http_get_full(url, delay=delay, timeout=timeout, retries=retries)
    return status, body


def strip_html(text, limit=None):
    if not text:
        return ""
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text)
    text = re.sub(r"(?i)<br\s*/?>|</p>|</li>|</tr>|</h\d>", "\n", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text).strip()
    return text[:limit] if limit else text


def fetch_shopify_catalog(store_id, log=print, max_pages=100):
    """Return (products, complete) for a Shopify store via /products.json."""
    base = SHOPIFY_STORES[store_id]["base"]
    products, page, complete = [], 1, False
    while page <= max_pages:
        status, body = http_get(f"{base}/products.json?limit=250&page={page}")
        if status != 200:
            raise RuntimeError(f"{store_id}: products.json page {page} -> {status}")
        batch = json.loads(body).get("products", [])
        if not batch:
            complete = True
            break
        products.extend(batch)
        log(f"  {store_id}: page {page} (+{len(batch)}, total {len(products)})")
        page += 1
    return products, complete


def shopify_product_url(store_id, handle):
    return f"{SHOPIFY_STORES[store_id]['base']}/products/{handle}"


def shopify_handle_from_url(url):
    m = re.search(r"/products/([^/?#]+)", url or "")
    return m.group(1) if m else None


def _num(x):
    try:
        return float(x) if x not in (None, "") else None
    except (TypeError, ValueError):
        return None


def shopify_variants(product):
    out = []
    for v in product.get("variants", []):
        price = _num(v.get("price")) or 0.0
        compare = _num(v.get("compare_at_price"))
        out.append({
            "title": v.get("title") or "",
            "price": price,
            "compare_at": compare,
            "available": bool(v.get("available", True)),
            "grams": v.get("grams") or 0,
            "sku": v.get("sku") or "",
        })
    return out


def shopify_js_variants(product_js):
    """Variants from a /products/<handle>.js response (prices in cents)."""
    out = []
    for v in product_js.get("variants", []):
        out.append({
            "title": v.get("title") or "",
            "price": (v.get("price") or 0) / 100,
            "compare_at": (v.get("compare_at_price") or 0) / 100 or None,
            "available": bool(v.get("available")),
        })
    return out


def pick_variant(variants, wanted=None):
    """Same rule as the app (src/pricing.js pickVariant).

    A named variant must match (exact title, else substring, preferring
    in-stock); returns None if it matches nothing. With no name, take the
    only variant or the cheapest in-stock one.
    """
    if not variants:
        return None
    if wanted:
        w = wanted.lower()
        for v in variants:
            if v["title"].lower() == w:
                return v
        sub = [v for v in variants if w in v["title"].lower()]
        if not sub:
            return None
        return next((v for v in sub if v["available"]), sub[0])
    if len(variants) == 1:
        return variants[0]
    avail = [v for v in variants if v["available"]] or variants
    return min(avail, key=lambda v: v["price"])


def _getfpv_variants(page_html):
    """Per-variant price/stock from Magento's configurable-product JSON."""
    i = page_html.find('"optionPrices"')
    if i < 0:
        return None
    start = page_html.rfind('{"attributes"', 0, i)
    if start < 0:
        return None
    try:
        cfg, _ = json.JSONDecoder().raw_decode(page_html[start:])
    except ValueError:
        return None
    labels = {}
    for aid, attr in (cfg.get("attributes") or {}).items():
        for opt in attr.get("options") or []:
            labels[(str(aid), str(opt.get("id")))] = opt.get("label") or ""
    prices = cfg.get("optionPrices") or {}
    salable = cfg.get("salable") or {}
    out = []
    for pid, combo in (cfg.get("index") or {}).items():
        title = " / ".join(labels.get((str(a), str(o)), "") for a, o in combo.items())
        amount = _num(((prices.get(pid) or {}).get("finalPrice") or {}).get("amount"))
        old = _num(((prices.get(pid) or {}).get("oldPrice") or {}).get("amount"))
        available = bool(salable) and all(
            str(pid) in [str(x) for x in ((salable.get(str(a)) or {}).get(str(o)) or [])] for a, o in combo.items()
        )
        out.append({
            "title": title,
            "price": amount if amount and amount > 0 else 0.0,
            "compare_at": old if old and amount and old > amount else None,
            "available": available,
        })
    return out or None


def parse_getfpv_offer(page_html):
    """Name / price / stock (and variants when present) from a GetFPV page."""
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page_html, re.S):
        try:
            data = json.loads(block.strip())
        except ValueError:
            continue
        items = data.get("@graph", [data]) if isinstance(data, dict) else data
        for item in items:
            if not isinstance(item, dict) or item.get("@type") != "Product":
                continue
            offers = item.get("offers") or {}
            if isinstance(offers, list):
                offers = offers[0] if offers else {}
            # Out-of-stock configurable products publish price "0": treat as unknown.
            price = next((p for p in (_num(offers.get("price")), _num(offers.get("lowPrice"))) if p and p > 0), None)
            availability = str(offers.get("availability", ""))
            return {
                "name": html.unescape(item.get("name", "")),
                "price": price,
                "high_price": _num(offers.get("highPrice")),
                "available": "InStock" in availability,
                "sku": item.get("sku"),
                "image": item.get("image"),
                "variants": _getfpv_variants(page_html),
            }
    return None


def _same_page(a, b):
    norm = lambda u: (u or "").split("?")[0].split("#")[0].rstrip("/").lower()
    return norm(a) == norm(b)


def fetch_getfpv_offer(url, retries=1):
    """Returns (outcome, info): ('ok', dict), ('gone', None) or ('error', None).

    'gone' only for a real 404/410 or a redirect to a non-product page; a
    bot challenge, timeout or other failure is an 'error' so callers keep
    the last known data.
    """
    try:
        status, body, final = http_get_full(url, delay=1.5, retries=retries)
    except RuntimeError:
        return "error", None
    if status in (404, 410):
        return "gone", None
    if status != 200:
        return "error", None
    info = parse_getfpv_offer(body.decode("utf-8", "replace"))
    if info:
        return "ok", info
    return ("gone", None) if not _same_page(final, url) else ("error", None)


def fetch_getfpv_product_urls():
    """Product page URLs from GetFPV's public sitemap (root-level *.html)."""
    status, body = http_get(GETFPV["base"] + "/media/sitemap.xml", timeout=120)
    if status != 200:
        raise RuntimeError(f"getfpv sitemap -> {status}")
    xml = body.decode("utf-8", "replace")
    urls = re.findall(r"<loc>(https://www\.getfpv\.com/[^<]+?\.html)</loc>", xml)
    # Category pages live in nested paths; products sit at the root.
    return sorted({u for u in urls if u.count("/") == 3})
