# Parts database schema

`data/parts.json` is a single object: `{ "version": "...", "generated": "ISO date", "parts": [ ... ] }`.
Every part shares the common fields below plus a category-specific `specs` object.
All weights are **grams per unit** (one motor, one prop, one battery pack, one board).

## Common fields

| field | type | notes |
|---|---|---|
| `id` | string | `category-brand-model[-variant]`, lowercase kebab, unique. e.g. `motor-tmotor-velox-v2207-1950` |
| `category` | enum | `frame` `motor` `prop` `fc` `esc` `aio` `stack` `battery` `camera` `vtx` `receiver` `radio` `goggles` `gps` `payload` |
| `brand` | string | Manufacturer, e.g. `T-Motor`, `BetaFPV`, `iFlight` |
| `name` | string | Model name without brand, e.g. `Velox V2207 V2 1950KV` |
| `classes` | string[] | Build classes this part suits (see table below) |
| `weight_g` | number | Per unit. Motors **with wires**. Frames **bare** (no electronics). |
| `specs` | object | Category-specific, see below |
| `offers` | Offer[] | Where to buy (see below) |
| `sources` | string[] | Manufacturer/spec URLs the numbers came from |
| `notes` | string | One short neutral sentence (optional) |
| `est` | string[] | Names of fields that are estimates rather than published specs, e.g. `["weight_g"]` |

### Offer

| field | type | notes |
|---|---|---|
| `store` | enum | `rdq` (RaceDayQuads), `newbee` (NewBeeDrone), `five33` (FlyFive33), `getfpv` (GetFPV) |
| `url` | string | Canonical product URL. Shopify stores: `https://<store>/products/<handle>` |
| `variant` | string | Optional. Text that identifies the right variant on a multi-option listing, e.g. `1950KV`, `5.1x3.5`, `Black` |
| `pack_qty` | number | Units in one purchase: motors usually 1 (or 4 for a 4-pack), props 4 or 8, batteries 1 |
| `price` | number | USD, filled/refreshed by `scripts/update_data.py` |
| `compare_at` | number | Original price if on sale (filled by updater) |
| `available` | bool | In stock (filled by updater) |
| `checked` | string | ISO date of last price check (filled by updater) |
| `dir` | `cw` / `ccw` | Optional, props sold one rotation direction per listing. Inferred from the URL/variant when absent; the app pairs a store's CW and CCW listings into a full set |
| `gone` | bool | Set by the updater when the listing was removed (404); hidden in the app |
| `variant_missing` | bool | Set by the updater when `variant` no longer matches any listing variant; price left unchanged |
| `tried` / `error_streak` | string / number | GetFPV bookkeeping set by the updater: last fetch attempt, and how many runs in a row it failed |

## Build classes

| id | label | props | typical cells |
|---|---|---|---|
| `w65` | 65mm Tiny Whoop | 31mm | 1S |
| `w75` | 75mm Whoop | 40mm | 1S–2S |
| `p2` | 2" Micro / 85mm Whoop | 45mm–2" | 1S–3S |
| `p25` | 2.5" Toothpick / Cinewhoop | 2.5" | 2S–4S |
| `p3` | 3" Freestyle / Cinewhoop | 3" | 3S–6S |
| `p35` | 3.5" Freestyle / Cinewhoop | 3.5" | 4S–6S |
| `p4` | 4" Lightweight Long Range | 4" | 4S–6S |
| `p5` | 5" Freestyle / Race | 5"–5.1" | 4S–6S |
| `p6` | 6" | 6" | 6S |
| `p7` | 7" Long Range | 7" | 6S |
| `p8` | 8" Long Range / Cine | 8" | 6S |
| `p10` | 10" Long Range / Cinelifter | 10" | 6S–8S |
| `p13` | 13" Heavy Lift / X-Class | 13" | 6S–12S |
| `p15` | 15" X-Class | 15" | 8S–12S |

## Canonical tokens

Use exactly these strings so compatibility checks can compare them.

- **Motor mount patterns** (`frame.specs.motor_mount`, `motor.specs.mount`): `W1S` (1S whoop motor mount for 0603–0802 motors), `6.6mm` (3-hole micro pattern used by many 1002–1103 motors), `9x9`, `12x12`, `16x16`, `19x19`, `25x25`, `30x30`. List every pattern a slotted arm accepts.
- **Stack / board mounts**: `16x16`, `20x20`, `25.5x25.5` (also use for 26x26 whoop boards), `30.5x30.5`.
- **Camera widths** (`frame.specs.camera_mount`, `camera.specs.width_mm`, `vtx.specs.camera_width_mm`): millimetres as numbers. Nano = `14`, micro = `19`, DJI O3/Walksnail Pro style = `20`, mini = `22`, full = `28`.
- **Shaft / hub**: `1mm`, `1.5mm`, `2mm`, `T-mount`, `M5`, `M6`, `folding`. A `T-mount` prop needs a `T-mount` motor; `M5` props need an `M5` shaft; whoop press-fit props match `1mm` or `1.5mm` shafts.
- **Video systems**: `analog`, `hdzero`, `dji-o4`, `dji-o4-pro`, `dji-o3`, `dji-v1` (DJI FPV Air Unit / Caddx Vista / RunCam Link), `walksnail`, `openipc`.
- **RC protocols**: `elrs-2.4`, `elrs-900`, `elrs-dual` (Gemini Xrossband 2.4 + 900), `crossfire`, `tracer`, `ghost`, `frsky-access`, `frsky-accst`, `frsky-d8`, `flysky-afhds2a`, `flysky-afhds3`, `spektrum-dsmx`, `dji-rc` (DJI FPV Remote Controller via O3/O4 air unit).
- **Battery / power connectors**: `PH2.0`, `BT2.0`, `A30`, `GNB27`, `XT30`, `XT60`, `XT90`, `AS150`, `solder`.
- **Chemistry**: `LiPo`, `LiHV`, `Li-ion`.

## Category specs

### frame
`prop_max_in` (number, whoops in inches: 31mm = 1.22, 40mm = 1.57, 45mm = 1.77), `wheelbase_mm`, `style` (`whoop` `cinewhoop` `toothpick` `freestyle` `race` `long-range` `cinelifter` `x-class`), `ducted` (bool), `motor_mount` (string[]), `stack_mount` (string[]), `camera_mount` (number[]), `video_support` (string[] of video systems the frame explicitly supports), `arm_mm` (number, optional), `motor_count` (default 4), `coaxial` (bool, X8-style stacked motor pairs), `battery_mount` (`top` `bottom` `in-frame`), `max_battery` (optional free text).

### motor
`stator` (e.g. `"2207"`), `stator_d_mm`, `stator_h_mm`, `kv`, `cells_min`, `cells_max`, `mount` (string[]), `screw` (`M2` `M3`), `shaft`, `max_current_a`, `max_power_w`, `rm_mohm` (internal resistance, optional), `io_a` (no-load current, optional), `prop_range_in` ([min, max] recommended prop diameter, inches), `thrust_tests` (array, optional): `{ "prop": "Gemfan 51466", "diameter_in": 5.1, "pitch_in": 4.66, "blades": 3, "voltage": 24, "throttle_pct": 100, "thrust_g": 1520, "current_a": 38.2 }` copied from the manufacturer's test table.

### prop
`diameter_in`, `pitch_in`, `blades`, `hub`, `material` (`PC` `nylon-glass` `carbon` `ABS`), `style` (`whoop` `freestyle` `race` `cinematic` `long-range` `heavy-lift`), `ducted_optimized` (bool).

### fc (standalone flight controller)
`mcu` (`F405` `F722` `F745` `H743` `AT32F435` `F411` `G473`), `mount`, `uarts` (free hardware UARTs), `input_cells` ([min, max] when the FC takes battery voltage directly, else null), `bec` (`[{ "v": 5, "a": 2 }, { "v": 10, "a": 2 }]`; always list the 5V rail, `a` may be null; add `"boost": true` for a rail that steps voltage up, e.g. the 9V rail on a 1–2S board), `esc_connector` (`8-pin` `solder`), `gyro`, `osd` (`analog` `none`), `blackbox` (e.g. `"16MB"` / `"SD"`), `baro` (bool), `firmware` (string[]: `betaflight` `inav` `ardupilot`).

### esc
`type` (`4in1` `single`), `cont_a`, `burst_a`, `cells_min`, `cells_max`, `mount` (`20x20` `30.5x30.5` `single`), `firmware` (`BLHeli_S` `Bluejay` `BLHeli_32` `AM32`), `fc_connector` (`8-pin` `solder`), `current_sensor` (bool), `power_connector`.

### aio (flight controller with built-in ESC)
`mcu`, `mount`, `uarts`, `cells_min`, `cells_max`, `esc_cont_a`, `esc_burst_a`, `esc_firmware`, `rx_builtin` (protocol token or null), `vtx_builtin` (starts with the video system token, e.g. `"analog 400mW"`, `"hdzero 200mW"`, or null), `osd`, `bec`, `gyro`, `power_connector`.

### stack (FC + ESC sold together)
`fc` (object with the fc specs above plus its own `weight_g`), `esc` (object with esc specs plus `weight_g`). Top-level `weight_g` is the combined weight.

### battery
`cells`, `capacity_mah`, `c_rating`, `chemistry`, `connector`, `config` (e.g. `"6S1P"`, `"6S2P"`).

### camera (separate FPV camera: analog / HDZero / OpenIPC)
`system`, `width_mm`, `resolution` (e.g. `"1200TVL"`, `"720p60"`), `input_v` ([min, max]), `fov_deg` (optional).

### vtx (video transmitter, or a digital air unit that includes its camera)
`system`, `includes_camera` (bool), `camera_width_mm` (if included), `input_v` ([min, max] volts), `power_mw` (max output), `power_draw_w` (approx at max output), `mount`, `needs_uart` (bool, MSP/SmartAudio/Tramp), `rx_protocols` (string[], e.g. `["dji-rc"]` for O3/O4), `records` (onboard recording, e.g. `"4K60"`, or null). `weight_g` includes the camera and stock antenna when `includes_camera` is true.

### receiver
`protocol`, `diversity` (`none` `antenna` `true` `gemini`), `interface` (`CRSF` `SBUS` `PWM`), `telemetry` (bool), `input_v` ([min, max]).

### radio (ground side; not counted in all-up weight)
`kind` (`radio` `module`), `protocols` (string[] built in), `module_bay` (`JR` `nano` `none`), `form` (`full` `compact` `gamepad`), `max_power_mw`.

### goggles (ground side)
`systems` (string[] received natively), `systems_via_module` (string[] with an add-on module), `form` (`box` `compact` `modular`).

### gps
`chip` (e.g. `M10`), `compass` (bool), `needs_uart` (true).

### payload (carried camera or other payload)
`kind` (`action-cam`), `records` (e.g. `"5.3K60"`), `mount` (e.g. `"TPU mount"`).
