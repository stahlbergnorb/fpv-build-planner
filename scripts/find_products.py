"""Dev tool: search the downloaded store catalogs (.scratch/index).

    python -I scripts/find_products.py search "2207.*1950" [--store rdq] [--type motor] [--in-text] [--limit 40]
    python -I scripts/find_products.py show <product url> [<url> ...]

`search` matches a case-insensitive regex against product titles (and the
description text with --in-text). GetFPV results come from its sitemap slugs
and have no price until you `show` them (which fetches the live page).
"""

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fpvdata  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, ".scratch", "index")
SHOPIFY = list(fpvdata.SHOPIFY_STORES)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

_cache = {}


def rows(store):
    if store not in _cache:
        path = os.path.join(INDEX, f"{store}.jsonl")
        with open(path, encoding="utf-8") as f:
            _cache[store] = [json.loads(line) for line in f if line.strip()]
    return _cache[store]


def getfpv_urls():
    if "getfpv" not in _cache:
        with open(os.path.join(INDEX, "getfpv_urls.txt"), encoding="utf-8") as f:
            _cache["getfpv"] = [u.strip() for u in f if u.strip()]
    return _cache["getfpv"]


def price_span(variants):
    prices = [v["price"] for v in variants if v.get("price")]
    if not prices:
        return "$?"
    lo, hi = min(prices), max(prices)
    return f"${lo:.2f}" if lo == hi else f"${lo:.2f}-{hi:.2f}"


def cmd_search(args):
    rx = re.compile(args.pattern, re.I)
    type_rx = re.compile(args.type, re.I) if args.type else None
    stores = [args.store] if args.store else SHOPIFY + ["getfpv"]
    shown = 0
    for store in stores:
        if store == "getfpv":
            for url in getfpv_urls():
                slug = url.rsplit("/", 1)[-1][:-5].replace("-", " ")
                if rx.search(slug) or rx.search(url):
                    print(f"getfpv | {slug} | (run show for price) | {url}")
                    shown += 1
                    if shown >= args.limit:
                        return
            continue
        for r in rows(store):
            hay = r["title"] or ""
            if args.in_text:
                hay += "\n" + (r.get("text") or "")
            if not rx.search(hay):
                continue
            if type_rx and not type_rx.search(r.get("type") or ""):
                continue
            v = r["variants"]
            avail = sum(1 for x in v if x.get("available"))
            grams = v[0].get("grams") if v else 0
            print(
                f"{store} | {r['title']} | {r.get('type') or '-'} | {price_span(v)} | "
                f"ship {grams}g | in stock {avail}/{len(v)} | {r['url']}"
            )
            shown += 1
            if shown >= args.limit:
                return
    if shown == 0:
        print("no matches")


def find_row(url):
    handle = fpvdata.shopify_handle_from_url(url)
    for store in SHOPIFY:
        if fpvdata.SHOPIFY_STORES[store]["base"].split("//")[1] in url:
            for r in rows(store):
                if r["url"].rsplit("/", 1)[-1] == handle:
                    return r
    return None


def cmd_show(args):
    for url in args.urls:
        print("=" * 80)
        if "getfpv.com" in url:
            status, body = fpvdata.http_get(url, delay=1.5)
            if status != 200:
                print(f"{url}: HTTP {status}")
                continue
            page = body.decode("utf-8", "replace")
            offer = fpvdata.parse_getfpv_offer(page)
            print(json.dumps({"url": url, **(offer or {})}, ensure_ascii=False))
            m = re.search(r'(?is)(<div[^>]+(?:product attribute description|id="description")[^>]*>.*)', page)
            seg = m.group(1)[:60000] if m else page
            text = fpvdata.strip_html(seg)
            i = text.lower().find("spec")
            start = max(0, i - 200) if i >= 0 else 0
            print(text[start:start + 3500])
            continue
        r = find_row(url)
        if not r:
            print(f"{url}: not in local index (wrong handle or not a Shopify store we track)")
            continue
        print(f"{r['store']} | {r['title']} | type={r.get('type')} | vendor={r.get('vendor')}")
        print(r["url"])
        for v in r["variants"]:
            print(f"  variant: {v['title']!r} ${v['price']:.2f} ship {v['grams']}g available={v['available']}")
        print("-" * 40)
        print(r.get("text") or "(no description)")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("search")
    s.add_argument("pattern")
    s.add_argument("--store", choices=SHOPIFY + ["getfpv"])
    s.add_argument("--type", help="regex on the store's product type")
    s.add_argument("--in-text", action="store_true")
    s.add_argument("--limit", type=int, default=40)
    s.set_defaults(fn=cmd_search)
    sh = sub.add_parser("show")
    sh.add_argument("urls", nargs="+")
    sh.set_defaults(fn=cmd_show)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
