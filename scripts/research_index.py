"""Dev tool: dump store catalogs into grep-friendly JSONL for parts research.

    python scripts/research_index.py [--out .scratch/index]

One line per product: store, url, title, type, vendor, variants (title,
price, grams, available) and the description text with HTML stripped.
GetFPV has no catalog JSON, so it gets a plain list of product URLs.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fpvdata  # noqa: E402


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    fpvdata.utf8_stdout()
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, ".scratch", "index"))
    ap.add_argument("--skip-getfpv", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    for store_id in fpvdata.SHOPIFY_STORES:
        products, _complete = fpvdata.fetch_shopify_catalog(store_id)
        with open(os.path.join(args.out, f"{store_id}.raw.json"), "w", encoding="utf-8") as f:
            json.dump(products, f)
        path = os.path.join(args.out, f"{store_id}.jsonl")
        with open(path, "w", encoding="utf-8") as f:
            for p in products:
                row = {
                    "store": store_id,
                    "url": fpvdata.shopify_product_url(store_id, p["handle"]),
                    "title": p.get("title"),
                    "type": p.get("product_type"),
                    "vendor": p.get("vendor"),
                    "tags": p.get("tags") if isinstance(p.get("tags"), list) else p.get("tags"),
                    "variants": [
                        {k: v[k] for k in ("title", "price", "grams", "available")}
                        for v in fpvdata.shopify_variants(p)
                    ],
                    "text": fpvdata.strip_html(p.get("body_html"), 3000),
                }
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"{store_id}: {len(products)} products -> {path}")

    if not args.skip_getfpv:
        urls = fpvdata.fetch_getfpv_product_urls()
        path = os.path.join(args.out, "getfpv_urls.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(urls) + "\n")
        print(f"getfpv: {len(urls)} product urls -> {path}")


if __name__ == "__main__":
    main()
