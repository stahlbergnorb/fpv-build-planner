"""Merge researched part slices into data/parts.json.

    python scripts/merge_parts.py [--src .scratch/verified] [--fallback .scratch/research]

Each slice is a JSON array of parts (see data/SCHEMA.md). Duplicate ids or
duplicate brand+name pairs are merged (offers combined). Reference files
(compat_facts.json, thrust_tests.json) are copied to data/reference/.
Nothing is written unless the merged set validates with 0 errors. Run
scripts/update_data.py afterwards to fill in prices.
"""

import argparse
import datetime as dt
import glob
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fpvdata  # noqa: E402
import validate_parts  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAT_ORDER = ["frame", "motor", "prop", "aio", "stack", "fc", "esc", "battery", "vtx", "camera",
             "receiver", "gps", "payload", "radio", "goggles"]
REFERENCE = ("compat_facts.json", "thrust_tests.json")


def load_slices(src, fallback):
    files = {}
    for d in (fallback, src):  # verified wins over research
        if d and os.path.isdir(d):
            for path in glob.glob(os.path.join(d, "*.json")):
                files[os.path.basename(path)] = path
    return files


def merge_offers(a, b):
    seen = {(o["store"], o["url"], o.get("variant")) for o in a.get("offers", [])}
    for o in b.get("offers", []):
        k = (o["store"], o["url"], o.get("variant"))
        if k not in seen:
            a.setdefault("offers", []).append(o)
            seen.add(k)


def fixups(p):
    """Small normalisations the compatibility engine relies on."""
    s = p.get("specs") or {}
    if p["category"] == "frame" and (s.get("motor_count") or 4) == 8:
        text = f"{p.get('name', '')} {p.get('notes', '')}".lower()
        if "coax" in text or "x8" in text:
            s["coaxial"] = True


def write_json(path, obj):
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, path)


def main():
    fpvdata.utf8_stdout()
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(ROOT, ".scratch", "verified"))
    ap.add_argument("--fallback", default=os.path.join(ROOT, ".scratch", "research"))
    args = ap.parse_args()

    files = load_slices(args.src, args.fallback)
    by_id, by_name, order, refs = {}, {}, [], {}
    for name, path in sorted(files.items()):
        if name in REFERENCE:
            refs[name] = path
            continue
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        parts = data.get("parts", []) if isinstance(data, dict) else data
        print(f"{name}: {len(parts)} parts ({'verified' if os.path.dirname(path) == os.path.normpath(args.src) else 'unverified'})")
        for p in parts:
            p.pop("_file", None)
            key = (p.get("category"), str(p.get("brand", "")).lower().strip(), str(p.get("name", "")).lower().strip())
            existing = by_id.get(p["id"]) or by_name.get(key)
            if existing:
                merge_offers(existing, p)
                continue
            fixups(p)
            by_id[p["id"]] = p
            by_name[key] = p
            order.append(p)

    if not order:
        sys.exit("no parts found in the slice folders; nothing written")

    rank = {c: i for i, c in enumerate(CAT_ORDER)}
    order.sort(key=lambda p: (rank.get(p["category"], 99), p.get("brand", "").lower(), p.get("name", "").lower()))
    rep = validate_parts.validate(order, check_urls=os.path.isdir(validate_parts.INDEX))
    print(f"validation: {rep.errors} errors, {rep.warnings} warnings")
    if rep.errors:
        sys.exit("validation failed; data/parts.json left unchanged")

    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    version = dt.datetime.now(dt.timezone.utc).strftime("%Y.%m.%d-%H%M")
    write_json(os.path.join(ROOT, "data", "parts.json"), {"version": version, "generated": now, "parts": order})

    meta_path = os.path.join(ROOT, "data", "meta.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
    meta.update({"version": version, "generated": now, "parts": len(order),
                 "offers": sum(len(p.get("offers", [])) for p in order)})
    write_json(meta_path, meta)

    os.makedirs(os.path.join(ROOT, "data", "reference"), exist_ok=True)
    for name, path in refs.items():
        shutil.copy(path, os.path.join(ROOT, "data", "reference", name))
        print(f"reference: {name}")

    counts = {}
    for p in order:
        counts[p["category"]] = counts.get(p["category"], 0) + 1
    print(f"wrote data/parts.json: {len(order)} parts {counts}")
    print("next: python scripts/update_data.py  (fills prices, rebuilds the catalog)")


if __name__ == "__main__":
    main()
