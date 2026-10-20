# FPV Build Planner

A progressive web app for planning FPV drone builds, from 65mm tiny whoops to 15" X-Class.
Pick parts, see compatibility at a glance, get the design numbers, and compare prices across
FPV stores.

- **Compatibility checks**, colour-coded: green works, yellow works with caveats, red won't work.
  Covers prop/frame fit, motor bolt patterns, prop hub vs shaft, motor/ESC/FC voltage, ESC and
  motor current, stack mounting, FC↔ESC harness, UART budget, VTX power (direct or BEC), camera
  width, video system ↔ goggles, receiver ↔ radio protocol, battery connector, battery current
  and thrust-to-weight.
- **Design numbers**: all-up weight with a per-component breakdown, max thrust, thrust-to-weight,
  hover throttle, flight time by flying style, payload capacity, peak current/power, efficiency,
  disk loading, RPM and prop tip speed. Uses a motor/prop/battery model fitted to 779 published
  manufacturer test points, from 65mm whoop motors to X-Class. Where the database has the
  manufacturer's own test for your exact motor and prop, the numbers are scaled to it. Also
  handles packs wired in series (2 × 6S for 12S X-Class) and coaxial X8 frames.
- **Parts database**: 772 parts across every class, each with specs, weights and links to every
  store that carries it:
  - airframe and power: frames, motors, props, batteries
  - flight electronics: F405/F7/H743 flight controllers, AIOs, ESCs from 20A to 90A, stacks
  - video: analog, HDZero, DJI O3/O4/O4 Pro, Walksnail and OpenIPC
  - control and accessories: receivers, radios, goggles, GPS, action cams
- **What-if tables**: see how every compatible prop, battery or motor changes those numbers.
- **Cost**: best price per part across RaceDayQuads, GetFPV, NewBeeDrone and FlyFive33,
  single-store totals, and one-tap **live price refresh** from the Shopify stores.
- **Search**: the curated parts database plus every listing from the store catalogs, cheapest
  in-stock first, with direct links.
- Save, share (link) and export builds. Installable, and works offline.

## Run locally

No build step: it's plain HTML/CSS/JS modules.

```bash
python scripts/serve.py
```

Then open <http://localhost:8765>. The dev server disables caching, and the service worker is
skipped on localhost unless you add `?sw=1`.

Run the tests at <http://localhost:8765/tests/>. They cover the physics model, every
compatibility rule, pricing and input sanitizing.

## Publish on GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repo, go to **Settings → Pages**, set **Source: Deploy from a branch**, branch
   `main`, folder `/ (root)`, and save.
3. Your app will be live at `https://<user>.github.io/<repo>/`. Open it on your phone, then use
   **Add to Home Screen** (iOS) or the **Install** prompt (Android/desktop Chrome/Edge).

When you change app files, bump `VERSION` in `sw.js` so installed copies pick up the update.
Users see a "new version ready" bar.

## Keeping prices and the catalog fresh

- **Automatic**: `.github/workflows/update-data.yml` runs on the 1st of every month. It
  refreshes every store price, rebuilds the searchable store catalog, and commits
  `data/parts.json`, `data/catalog.json` and `data/meta.json`. GitHub Pages then redeploys,
  and the app's **More → Check for data update** button pulls the new data.
- **On demand**: in GitHub go to **Actions → Update prices and catalog → Run workflow**.
  The app's More tab links straight there.
- **Locally**: `python scripts/update_data.py`, then commit the `data/` changes.
- **Live in the app**: the Cost and Search tabs can pull current prices straight from
  RaceDayQuads, NewBeeDrone and FlyFive33 (their product feeds allow it). GetFPV has no public
  feed, so its prices come from the monthly update.

If a store ever blocks GitHub's servers, run the update locally instead.

## Adding or fixing parts

Parts live in `data/parts.json`; the format is documented in [data/SCHEMA.md](data/SCHEMA.md).
After editing, validate:

```bash
python scripts/validate_parts.py data/parts.json --no-offers
```

To check offer URLs too, first download the store catalogs with
`python scripts/research_index.py` (they go to `.scratch/`, which is git-ignored). Prices are
filled in by `update_data.py`, so new offers only need `store`, `url`, `variant` and `pack_qty`.

## Physics calibration

`tools/calibrate.html` fits the propeller/motor constants in `src/physics.js` to the published
thrust tests in `data/reference/thrust_tests.json` (903 rows, mostly T-Motor and SunnySky
tables). Full-throttle rows are matched on thrust and current; part-throttle rows on the
current needed for the measured thrust, which is what sets hover efficiency and flight time.
Each motor-size group counts equally, and the tool prints a 5-fold cross-validation check.
Open it through the dev server, then paste the printed constants into `MODEL`. The tests page
re-checks the fit against the same data, per size group.

## Project layout

```
index.html, sw.js, manifest.webmanifest   PWA shell
src/            app code (physics, compatibility, pricing, views)
data/           parts database, store catalog, metadata, schema, reference data
scripts/        Python (stdlib only): price/catalog updater, validator, tools
tests/          in-browser tests
tools/          physics calibration
.github/        monthly data update workflow
```

## Data sources and etiquette

Specs come from manufacturer spec sheets, store listings and
[FPVKnowItAll](https://www.fpvknowitall.com)'s buyer's guides. Prices come from the stores'
public product data. The updater identifies itself, waits between requests, and only uses
paths each store's robots.txt allows.

Performance figures are estimates, and compatibility checks cover common problems but not
every edge case. Confirm with the manufacturer before you buy.
