"""Validate parts JSON against data/SCHEMA.md.

    python -I scripts/validate_parts.py <file.json> [<file2.json> ...] [--no-offers]

Accepts a JSON array of parts or an object with a "parts" array. Checks
required fields, canonical tokens, plausible weights, and that every offer
URL exists in the downloaded store index (.scratch/index) with a matching
variant. Exit code 1 if any errors.
"""

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fpvdata  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, ".scratch", "index")

CATEGORIES = {
    "frame", "motor", "prop", "fc", "esc", "aio", "stack", "battery", "camera",
    "vtx", "receiver", "radio", "goggles", "gps", "payload",
}
CLASSES = ["w65", "w75", "p2", "p25", "p3", "p35", "p4", "p5", "p6", "p7", "p8", "p10", "p13", "p15"]
STORES = {"rdq", "newbee", "five33", "getfpv"}
MOTOR_MOUNTS = {"W1S", "6.6mm", "9x9", "12x12", "16x16", "19x19", "25x25", "30x30"}
BOARD_MOUNTS = {"16x16", "20x20", "25.5x25.5", "30.5x30.5"}
SHAFTS = {"1mm", "1.5mm", "2mm", "T-mount", "M5", "M6", "folding"}
VIDEO = {"analog", "hdzero", "dji-o4", "dji-o4-pro", "dji-o3", "dji-v1", "walksnail", "openipc"}
PROTOCOLS = {
    "elrs-2.4", "elrs-900", "elrs-dual", "crossfire", "tracer", "ghost", "frsky-access",
    "frsky-accst", "frsky-d8", "flysky-afhds2a", "flysky-afhds3", "spektrum-dsmx", "dji-rc",
}
CONNECTORS = {"PH2.0", "BT2.0", "A30", "GNB27", "XT30", "XT60", "XT90", "AS150", "solder"}
CHEMISTRY = {"LiPo", "LiHV", "Li-ion"}
FRAME_STYLES = {"whoop", "cinewhoop", "toothpick", "freestyle", "race", "long-range", "cinelifter", "x-class"}
PROP_STYLES = {"whoop", "freestyle", "race", "cinematic", "long-range", "heavy-lift"}
MCUS = {"F405", "F722", "F745", "F765", "H743", "H750", "H7A3", "AT32F435", "F411", "G473", "G474", "F435"}

# category -> (required spec keys, weight range g or None)
REQUIRED = {
    "frame": (["prop_max_in", "wheelbase_mm", "style", "ducted", "motor_mount", "stack_mount", "camera_mount", "video_support"], (1.5, 1500)),
    "motor": (["stator", "stator_d_mm", "stator_h_mm", "kv", "cells_min", "cells_max", "mount", "shaft", "max_current_a", "prop_range_in"], (1.2, 450)),
    "prop": (["diameter_in", "pitch_in", "blades", "hub", "style"], (0.08, 80)),
    "fc": (["mcu", "mount", "uarts", "bec", "esc_connector", "gyro", "osd", "firmware"], (1.5, 45)),
    "esc": (["type", "cont_a", "burst_a", "cells_min", "cells_max", "mount", "firmware", "fc_connector"], (2, 250)),
    "aio": (["mcu", "mount", "uarts", "cells_min", "cells_max", "esc_cont_a", "esc_burst_a", "rx_builtin", "vtx_builtin", "power_connector"], (1.5, 40)),
    "stack": (["fc", "esc"], (8, 300)),
    "battery": (["cells", "capacity_mah", "c_rating", "chemistry", "connector", "config"], (5, 3000)),
    "camera": (["system", "width_mm", "input_v"], (0.8, 40)),
    "vtx": (["system", "includes_camera", "input_v", "power_mw", "mount", "needs_uart"], (0.8, 90)),
    "receiver": (["protocol", "diversity", "interface", "telemetry"], (0.2, 30)),
    "radio": (["kind", "protocols", "module_bay", "form"], None),
    "goggles": (["systems", "systems_via_module", "form"], None),
    "gps": (["chip", "compass"], (2, 50)),
    "payload": (["kind"], (10, 400)),
}

ID_RX = re.compile(r"^[a-z0-9]+(?:[-.][a-z0-9]+)*$")

_shopify = None
_getfpv = None


def shopify_index():
    global _shopify
    if _shopify is None:
        _shopify = {}
        for store in fpvdata.SHOPIFY_STORES:
            path = os.path.join(INDEX, f"{store}.jsonl")
            if not os.path.exists(path):
                continue
            with open(path, encoding="utf-8") as f:
                for line in f:
                    r = json.loads(line)
                    _shopify[(store, r["url"].rsplit("/", 1)[-1])] = r
    return _shopify


def getfpv_index():
    global _getfpv
    if _getfpv is None:
        path = os.path.join(INDEX, "getfpv_urls.txt")
        _getfpv = set()
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                _getfpv = {u.strip() for u in f if u.strip()}
    return _getfpv


def match_variants(variants, wanted):
    w = wanted.lower()
    exact = [v for v in variants if v["title"].lower() == w]
    if exact:
        return exact
    return [v for v in variants if w in v["title"].lower()]


def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


class Report:
    def __init__(self):
        self.errors = 0
        self.warnings = 0

    def err(self, pid, msg):
        self.errors += 1
        print(f"  ERROR [{pid}] {msg}")

    def warn(self, pid, msg):
        self.warnings += 1
        print(f"  warn  [{pid}] {msg}")


def check_tokens(rep, pid, label, values, allowed):
    if values is None:
        return
    vals = values if isinstance(values, list) else [values]
    for v in vals:
        if v not in allowed:
            rep.err(pid, f"{label}: '{v}' is not a canonical token ({', '.join(sorted(allowed))})")


def check_specs(rep, p):
    pid, cat, s = p.get("id"), p.get("category"), p.get("specs") or {}
    req, wrange = REQUIRED[cat]
    for k in req:
        if k not in s:
            rep.err(pid, f"specs.{k} missing")
    if wrange and is_num(p.get("weight_g")):
        lo, hi = wrange
        if not lo <= p["weight_g"] <= hi:
            rep.warn(pid, f"weight_g {p['weight_g']} outside plausible {lo}-{hi} for {cat}")
    if cat == "frame":
        check_tokens(rep, pid, "motor_mount", s.get("motor_mount"), MOTOR_MOUNTS)
        check_tokens(rep, pid, "stack_mount", s.get("stack_mount"), BOARD_MOUNTS)
        check_tokens(rep, pid, "video_support", s.get("video_support"), VIDEO)
        check_tokens(rep, pid, "style", s.get("style"), FRAME_STYLES)
        if not all(is_num(x) for x in s.get("camera_mount") or []):
            rep.err(pid, "camera_mount must be numbers (mm)")
    elif cat == "motor":
        check_tokens(rep, pid, "mount", s.get("mount"), MOTOR_MOUNTS)
        check_tokens(rep, pid, "shaft", s.get("shaft"), SHAFTS)
        for k in ("kv", "cells_min", "cells_max", "max_current_a"):
            if k in s and not is_num(s[k]):
                rep.err(pid, f"specs.{k} must be a number")
        st = str(s.get("stator", ""))
        if is_num(s.get("stator_d_mm")) and st[:2].isdigit() and abs(int(st[:2]) - s["stator_d_mm"]) > 1.5:
            rep.warn(pid, f"stator '{st}' vs stator_d_mm {s['stator_d_mm']} mismatch?")
        for t in s.get("thrust_tests") or []:
            for k in ("diameter_in", "pitch_in", "blades", "voltage", "thrust_g"):
                if not is_num(t.get(k)):
                    rep.err(pid, f"thrust_tests entry missing numeric {k}: {t}")
    elif cat == "prop":
        check_tokens(rep, pid, "hub", s.get("hub"), SHAFTS)
        check_tokens(rep, pid, "style", s.get("style"), PROP_STYLES)
    if cat in ("fc", "aio") and not s.get("bec"):
        rep.warn(pid, "bec is empty: list at least the 5V rail (amps may be null)")
    if cat == "stack" and not (s.get("fc") or {}).get("bec"):
        rep.warn(pid, "specs.fc.bec is empty: list at least the 5V rail")
    if cat in ("fc", "aio"):
        check_tokens(rep, pid, "mount", s.get("mount"), BOARD_MOUNTS)
        if s.get("mcu") and s["mcu"] not in MCUS:
            rep.warn(pid, f"mcu '{s['mcu']}' not in known list")
        if cat == "aio":
            if s.get("rx_builtin") is not None:
                check_tokens(rep, pid, "rx_builtin", s.get("rx_builtin"), PROTOCOLS)
            check_tokens(rep, pid, "power_connector", s.get("power_connector"), CONNECTORS)
    elif cat == "esc":
        if s.get("mount") not in BOARD_MOUNTS | {"single"}:
            rep.err(pid, f"esc mount '{s.get('mount')}' invalid")
        if s.get("power_connector"):
            check_tokens(rep, pid, "power_connector", s.get("power_connector"), CONNECTORS)
    elif cat == "stack":
        for sub, keys in (("fc", REQUIRED["fc"][0]), ("esc", REQUIRED["esc"][0])):
            obj = s.get(sub) or {}
            for k in keys + ["weight_g"]:
                if k not in obj:
                    rep.err(pid, f"specs.{sub}.{k} missing")
    elif cat == "battery":
        check_tokens(rep, pid, "chemistry", s.get("chemistry"), CHEMISTRY)
        check_tokens(rep, pid, "connector", s.get("connector"), CONNECTORS)
        if is_num(s.get("cells")) and isinstance(s.get("config"), str) and not s["config"].startswith(f"{s['cells']}S"):
            rep.warn(pid, f"config {s['config']} vs cells {s['cells']}")
    elif cat in ("camera", "vtx"):
        check_tokens(rep, pid, "system", s.get("system"), VIDEO)
        iv = s.get("input_v")
        if not (isinstance(iv, list) and len(iv) == 2 and all(is_num(x) for x in iv)):
            rep.err(pid, "input_v must be [min, max] numbers")
        if cat == "vtx":
            if s.get("includes_camera") and not is_num(s.get("camera_width_mm")):
                rep.warn(pid, "includes_camera but camera_width_mm missing")
            check_tokens(rep, pid, "rx_protocols", s.get("rx_protocols") or [], PROTOCOLS)
    elif cat == "receiver":
        check_tokens(rep, pid, "protocol", s.get("protocol"), PROTOCOLS)
    elif cat == "radio":
        check_tokens(rep, pid, "protocols", s.get("protocols"), PROTOCOLS)
    elif cat == "goggles":
        check_tokens(rep, pid, "systems", s.get("systems"), VIDEO)
        check_tokens(rep, pid, "systems_via_module", s.get("systems_via_module"), VIDEO)


def check_offers(rep, p, check_urls):
    pid = p.get("id")
    offers = p.get("offers")
    if not isinstance(offers, list):
        rep.err(pid, "offers must be a list")
        return
    if not offers:
        rep.warn(pid, "no offers (part will show without a buy link)")
    for o in offers:
        store, url = o.get("store"), o.get("url", "")
        if store not in STORES:
            rep.err(pid, f"offer store '{store}' invalid")
            continue
        if o.get("dir") is not None:
            check_tokens(rep, pid, "offer.dir", o.get("dir"), {"cw", "ccw"})
        if p.get("category") in ("motor", "prop") and not is_num(o.get("pack_qty")):
            rep.warn(pid, f"{store}: pack_qty missing (motors/props need it for cost math)")
        if not check_urls:
            continue
        if store == "getfpv":
            if url not in getfpv_index():
                rep.err(pid, f"getfpv url not in sitemap: {url}")
            continue
        base = fpvdata.SHOPIFY_STORES[store]["base"]
        if not url.startswith(base + "/products/"):
            rep.err(pid, f"{store} url must look like {base}/products/<handle>: {url}")
            continue
        row = shopify_index().get((store, fpvdata.shopify_handle_from_url(url)))
        if not row:
            rep.err(pid, f"{store} product not found in catalog: {url}")
            continue
        variants = row["variants"]
        if o.get("variant"):
            m = match_variants(variants, o["variant"])
            if not m:
                rep.err(pid, f"{store} variant '{o['variant']}' matches none of {[v['title'] for v in variants]}")
            elif len({v['price'] for v in m}) > 1:
                rep.warn(pid, f"{store} variant '{o['variant']}' matches {len(m)} variants with different prices: {[v['title'] for v in m]}")
        elif len({v["price"] for v in variants}) > 1:
            rep.warn(pid, f"{store} listing has variants with different prices; set offer.variant from {[v['title'] for v in variants][:12]}")


def validate(parts, check_urls=True, seen=None):
    rep = Report()
    seen = seen if seen is not None else {}
    for p in parts:
        pid = p.get("id", "<no id>")
        for k in ("id", "category", "brand", "name", "classes", "weight_g", "specs", "offers"):
            if k not in p:
                rep.err(pid, f"missing field {k}")
        if p.get("category") not in CATEGORIES:
            rep.err(pid, f"category '{p.get('category')}' invalid")
            continue
        if not ID_RX.match(str(p.get("id", ""))):
            rep.err(pid, "id must be lowercase kebab-case")
        elif not str(p["id"]).startswith(p["category"] + "-"):
            rep.err(pid, f"id must start with '{p['category']}-'")
        if pid in seen:
            rep.err(pid, f"duplicate id (also in {seen[pid]})")
        seen[pid] = p.get("_file", "this file")
        for c in p.get("classes") or []:
            if c not in CLASSES:
                rep.err(pid, f"class '{c}' invalid")
        if not p.get("classes") and p.get("category") not in ("radio", "goggles"):
            rep.err(pid, "classes empty")
        if not is_num(p.get("weight_g")) and p.get("category") not in ("radio", "goggles"):
            rep.err(pid, "weight_g must be a number")
        check_specs(rep, p)
        check_offers(rep, p, check_urls)
    return rep


def load_parts(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    parts = data.get("parts", []) if isinstance(data, dict) else data
    for p in parts:
        p.setdefault("_file", os.path.basename(path))
    return parts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--no-offers", action="store_true", help="skip offer URL checks")
    args = ap.parse_args()
    total_e = total_w = total_p = 0
    seen = {}
    for path in args.files:
        parts = load_parts(path)
        print(f"{path}: {len(parts)} parts")
        rep = validate(parts, check_urls=not args.no_offers, seen=seen)
        total_e += rep.errors
        total_w += rep.warnings
        total_p += len(parts)
    print(f"\n{total_p} parts, {total_e} errors, {total_w} warnings")
    sys.exit(1 if total_e else 0)


if __name__ == "__main__":
    main()
