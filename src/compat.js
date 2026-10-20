// Compatibility engine. Each check returns { status, title, detail, slots }
// where status is 'ok' (green), 'warn' (yellow: works with caveats),
// 'bad' (red: won't work / unsafe) or 'info' (advice, doesn't affect status).

import { activeSlots, electronics, summarize, motorCount, effectiveBattery, DEFAULT_OPTIONS } from './build.js';
import { CLASS_BY_ID, CLASSES, TW_MIN, VIDEO_LABELS, RC_LABELS, vtxDrawW } from './classes.js';
import { batteryParams } from './physics.js';

const RANK = { info: 0, ok: 1, warn: 2, bad: 3 };
export const worst = (list) => list.reduce((w, s) => (RANK[s] > RANK[w] ? s : w), 'ok');

export function fmtIn(d) {
  if (d == null) return '?';
  return d < 2 ? `${Math.round(d * 25.4)}mm` : `${+d.toFixed(2)}"`;
}
const r0 = (x) => Math.round(x);
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const EPS = 1e-6; // published voltage limits are compared with float products
const DJI_SYSTEMS = new Set(['dji-o4', 'dji-o4-pro', 'dji-o3', 'dji-v1']);

// Recommended prop range by stator diameter when the motor doesn't list one.
function guessPropRange(statorD) {
  const t = [[8, 1.2, 1.6], [10, 1.5, 2.1], [11.5, 1.9, 2.6], [13, 2.5, 3.1], [14.5, 3, 4], [16, 3, 3.6],
    [20, 3.5, 4.5], [23.5, 5, 5.5], [26, 5.5, 6.5], [29, 6.5, 8], [33, 8, 10], [50, 10, 15]];
  for (const [d, lo, hi] of t) if (statorD <= d) return [lo, hi];
  return [10, 15];
}

function boardSize(m) { return parseFloat(String(m).split('x')[0]); }

// System of an AIO's built-in VTX: "hdzero 200mW" -> hdzero, "analog 400mW" -> analog.
export function builtinVtxSys(aio) {
  const v = aio?.specs?.vtx_builtin;
  if (!v) return null;
  const t = String(v).toLowerCase();
  return Object.keys(VIDEO_LABELS).find((k) => t.startsWith(k)) || 'analog';
}

const elecSlot = (b) => (b.elec === 'aio' ? 'aio' : b.elec === 'stack' ? 'stack' : 'esc');
const fcSlot = (b) => (b.elec === 'aio' ? 'aio' : b.elec === 'stack' ? 'stack' : 'fc');
const AIR_SLOTS = ['frame', 'motor', 'prop', 'battery', 'vtx', 'camera', 'payload', 'aio', 'stack', 'fc', 'esc', 'receiver', 'gps'];

// How a radio protocol relates to a receiver protocol.
function linkStatus(radio, proto) {
  const rp = radio.specs.protocols || [];
  const label = RC_LABELS[proto] || proto;
  if (rp.includes(proto)) return ['ok', 'Radio link matches', `${radio.name} speaks ${label}.`];
  if (proto === 'elrs-dual' && (rp.includes('elrs-2.4') || rp.includes('elrs-900'))) return ['ok', 'Radio link matches', 'Gemini Xrossband receivers also bind to a single-band ELRS transmitter on the matching band.'];
  if (['elrs-2.4', 'elrs-900'].includes(proto) && rp.includes('elrs-dual')) return ['ok', 'Radio link matches', `A Gemini Xrossband transmitter can run ${label}.`];
  if (proto === 'frsky-accst' && rp.includes('frsky-access')) return ['warn', 'FrSky firmware swap', 'ACCESS radios can bind ACCST D16 receivers after flashing ACCST firmware to the RF module.'];
  // A handset with a module bay can take another protocol; a TX module can't.
  if (radio.specs.kind !== 'module' && radio.specs.module_bay && radio.specs.module_bay !== 'none' && proto !== 'dji-rc') return ['warn', 'External module needed', `${radio.name} needs an external ${label} module in its ${radio.specs.module_bay} bay.`];
  return ['bad', 'Radio link mismatch', `${radio.name} (${rp.map((x) => RC_LABELS[x] || x).join(', ') || 'unknown protocol'}) can't bind a ${label} receiver.`];
}

// Which receiver path the build uses: external RX, the board's built-in RX,
// or the DJI air unit acting as receiver for a DJI FPV Remote Controller.
function rcPath(c) {
  const rx = c.p('receiver'), vtx = c.p('vtx'), radio = c.p('radio');
  const builtin = c.elec.fc?.rx_builtin || null;
  if (rx) return { proto: rx.specs.protocol, slot: 'receiver', dji: false };
  const djiCapable = vtx?.specs?.rx_protocols?.includes('dji-rc') && radio?.specs?.protocols?.includes('dji-rc');
  if (djiCapable && !(builtin && linkStatus(radio, builtin)[0] === 'ok')) return { proto: 'dji-rc', slot: 'vtx', dji: true, unusedBuiltin: builtin };
  if (builtin) return { proto: builtin, slot: fcSlot(c.build), dji: false };
  return { proto: null, slot: 'receiver', dji: false };
}

const CHECKS = [
  function propFit(c) {
    const f = c.p('frame'), p = c.p('prop');
    if (!f || !p) return;
    const max = f.specs.prop_max_in, d = p.specs.diameter_in, slots = ['frame', 'prop'];
    if (d > max + 0.06) return c.bad(slots, 'Props too big for frame', `${fmtIn(d)} props exceed this frame's ${fmtIn(max)} limit — they'll strike the ${f.specs.ducted ? 'ducts' : 'frame or each other'}.`);
    if (f.specs.ducted) {
      if (max - d > 0.12) return c.warn(slots, 'Props small for ducts', `Ducts are sized for ${fmtIn(max)}; ${fmtIn(d)} props leave a big tip gap and lose most of the duct's thrust benefit.`);
      return c.ok(slots, 'Props fit ducts', `${fmtIn(d)} props match the ${fmtIn(max)} ducts.`);
    }
    if (max - d > Math.max(0.6, max * 0.2)) return c.warn(slots, 'Props smaller than frame', `Frame takes up to ${fmtIn(max)}; ${fmtIn(d)} props fit, but you're carrying more frame than needed.`);
    return c.ok(slots, 'Props fit frame', `${fmtIn(d)} props fit (frame max ${fmtIn(max)}).`);
  },

  function motorMount(c) {
    const f = c.p('frame'), m = c.p('motor');
    if (!f || !m) return;
    const fm = f.specs.motor_mount || [], mm = m.specs.mount || [], slots = ['frame', 'motor'];
    if (!fm.length || !mm.length) return c.info(slots, 'Motor mount not listed', 'Check the motor bolt pattern against the frame arms manually.');
    const common = mm.filter((x) => fm.includes(x));
    if (common.length) return c.ok(slots, 'Motor bolt pattern fits', `${common[0]} pattern matches the frame arms.`);
    return c.bad(slots, 'Motor bolt pattern mismatch', `Motor uses ${mm.join(' / ')}; the frame arms take ${fm.join(' / ')}.`);
  },

  function motorPropSize(c) {
    const m = c.p('motor'), p = c.p('prop');
    if (!m || !p) return;
    const [lo, hi] = m.specs.prop_range_in || guessPropRange(m.specs.stator_d_mm || 22);
    const d = p.specs.diameter_in, slots = ['motor', 'prop'], range = `${fmtIn(lo)}–${fmtIn(hi)}`;
    if (d >= lo - 0.12 && d <= hi + 0.12) return c.ok(slots, 'Motor suits prop size', `Motor is designed for ${range} props.`);
    if (d < lo) {
      if (d >= lo * 0.75) return c.warn(slots, 'Prop small for motor', `Motor is designed for ${range}; ${fmtIn(d)} props spin fast but waste the motor's torque.`);
      return c.bad(slots, 'Prop far too small for motor', `Motor is designed for ${range} props, not ${fmtIn(d)}.`);
    }
    if (d <= hi * 1.25) return c.warn(slots, 'Prop large for motor', `Larger than this motor's ${range} range — expect high current and heat (see current checks).`);
    return c.bad(slots, 'Prop far too large for motor', `Motor is designed for ${range}; it can't swing ${fmtIn(d)} props.`);
  },

  function propHub(c) {
    const m = c.p('motor'), p = c.p('prop');
    if (!m || !p) return;
    const shaft = m.specs.shaft, hub = p.specs.hub, slots = ['motor', 'prop'];
    if (!shaft || !hub) return c.info(slots, 'Prop mount not listed', 'Check the prop hub against the motor shaft manually.');
    if (shaft === hub) return c.ok(slots, 'Prop hub matches shaft', `${hub} hub on a ${shaft} motor.`);
    if (hub === 'folding') return c.warn(slots, 'Folding prop adapter needed', 'Folding props mount on an adapter base; make sure one fits this motor (often included with the props).');
    if (shaft === '1mm' && hub === '1.5mm') return c.bad(slots, 'Prop hub too large', '1.5mm prop hub on a 1mm shaft will be loose and throw the prop.');
    if (shaft === '1.5mm' && hub === '1mm') return c.bad(slots, 'Prop hub too small', 'Prop is for 1mm shafts; it won\'t go onto this 1.5mm shaft.');
    if ([shaft, hub].includes('T-mount') && [shaft, hub].includes('M5')) return c.bad(slots, 'T-mount vs M5 mismatch', 'T-mount props bolt to the motor bell; M5 props need a 5mm threaded shaft — they don\'t interchange.');
    if ([shaft, hub].includes('T-mount')) return c.warn(slots, 'Check prop mounting', `Motor is ${shaft}, prop is ${hub} — some motors support both, but verify before buying.`);
    return c.bad(slots, 'Prop hub doesn\'t fit shaft', `Prop hub (${hub}) doesn't match the motor shaft (${shaft}).`);
  },

  function motorVoltage(c) {
    const m = c.p('motor'), b = c.bat;
    if (!m || !b) return;
    const { cells } = b.specs, mn = m.specs.cells_min, mx = m.specs.cells_max, slots = ['motor', 'battery'];
    if (cells > mx) return c.bad(slots, 'Battery over-volts motors', `${cells}S exceeds this motor's ${mx}S rating — it will overheat or burn out.`);
    if (cells < mn) return c.warn(slots, 'Battery under-volts motors', `${cells}S is below this motor's ${mn}S minimum — it'll feel weak.`);
    return c.ok(slots, 'Motor voltage OK', `${cells}S is within the motor's ${mn}–${mx}S range.`);
  },

  function escVoltage(c) {
    const { esc } = c.elec, b = c.bat;
    if (!esc || !b) return;
    const { cells } = b.specs, slots = [elecSlot(c.build), 'battery'];
    if (cells > esc.cells_max) return c.bad(slots, 'Battery over-volts ESC', `${cells}S exceeds the ESC's ${esc.cells_max}S limit — it will fail.`);
    if (cells < esc.cells_min) return c.warn(slots, 'Battery below ESC minimum', `ESC is rated from ${esc.cells_min}S; on ${cells}S it may not arm reliably or its BEC may brown out.`);
    return c.ok(slots, 'ESC voltage OK', `${cells}S is within the ESC's ${esc.cells_min}–${esc.cells_max}S range.`);
  },

  function fcVoltage(c) {
    if (c.build.elec !== 'separate') return;
    const fc = c.p('fc'), b = c.bat;
    const ic = fc?.specs?.input_cells;
    if (!fc || !b || !Array.isArray(ic)) return;
    const { cells } = b.specs, slots = ['fc', 'battery'];
    if (cells > ic[1]) return c.bad(slots, 'Battery over-volts FC', `FC takes ${ic[0]}–${ic[1]}S; ${cells}S will damage its regulator.`);
    if (cells < ic[0]) return c.warn(slots, 'Battery below FC minimum', `FC is rated from ${ic[0]}S; its BECs may not hold voltage on ${cells}S.`);
    return c.ok(slots, 'FC voltage OK', `${cells}S is within the FC's ${ic[0]}–${ic[1]}S input.`);
  },

  function escChannels(c) {
    const n = motorCount(c.build, c.db);
    if (n <= 4 || !c.elec.esc) return;
    const slot = elecSlot(c.build), slots = ['frame', slot];
    if (c.build.elec === 'separate') {
      const e = c.p('esc');
      if (e?.specs?.type === 'single') return c.info(slots, `${n} motors`, `Uses ${n} single ESCs; make sure the FC has ${n} motor outputs.`);
      return c.info(slots, `${n} motors`, `Counts ${Math.ceil(n / 4)} × 4-in-1 ESCs; make sure the FC has ${n} motor outputs.`);
    }
    return c.warn(slots, `Board drives 4 of ${n} motors`, `Frame has ${n} motors but this ${c.build.elec === 'aio' ? 'AIO' : 'stack'} drives 4 — add another 4-in-1 ESC and use an FC with ${n} motor outputs.`);
  },

  function escCurrent(c) {
    const { esc } = c.elec, perf = c.sum.perf;
    if (!esc || !perf || !esc.cont_a) return;
    const I = perf.maxMotorCurrent, cont = esc.cont_a, burst = esc.burst_a || cont * 1.2;
    const slots = [elecSlot(c.build), 'motor', 'prop', 'battery'];
    if (I <= cont * 0.95) return c.ok(slots, 'ESC current headroom', `Est. ${r0(I)}A per motor at full throttle vs ${cont}A continuous.`);
    if (I <= burst) return c.warn(slots, 'ESC near its limit', `Est. ${r0(I)}A per motor exceeds ${cont}A continuous (within ${burst}A burst) — fine for punch-outs, hot on long full-throttle runs.`);
    return c.bad(slots, 'ESC overloaded', `Est. ${r0(I)}A per motor is over the ESC's ${burst}A burst rating — it will likely burn.`);
  },

  function motorCurrent(c) {
    const m = c.p('motor'), perf = c.sum.perf;
    if (!m || !perf || !m.specs.max_current_a) return;
    const I = perf.maxMotorCurrent, max = m.specs.max_current_a, slots = ['motor', 'prop', 'battery'];
    if (I <= max) return c.ok(slots, 'Motor current OK', `Est. ${r0(I)}A at full throttle; motor rated ${max}A.`);
    if (I <= max * 1.2) return c.warn(slots, 'Motor slightly overloaded', `Est. ${r0(I)}A exceeds the motor's ${max}A rating — keep bursts short or drop prop pitch/size.`);
    return c.bad(slots, 'Motor overloaded', `Est. ${r0(I)}A is far over the motor's ${max}A rating — this prop/voltage will cook it.`);
  },

  function boardMount(c) {
    const f = c.p('frame');
    if (!f) return;
    const fm = f.specs.stack_mount || [];
    if (!fm.length) return;
    const boards = [];
    const b = c.build;
    if (b.elec === 'aio' && c.p('aio')) boards.push(['aio', c.p('aio').specs.mount, 'AIO board']);
    if (b.elec === 'stack' && c.p('stack')) {
      const st = c.p('stack').specs;
      boards.push(['stack', st.fc?.mount, 'Stack FC'], ['stack', st.esc?.mount, 'Stack ESC']);
    }
    if (b.elec === 'separate') {
      if (c.p('fc')) boards.push(['fc', c.p('fc').specs.mount, 'Flight controller']);
      if (c.p('esc') && c.p('esc').specs.mount !== 'single') boards.push(['esc', c.p('esc').specs.mount, 'ESC']);
    }
    const out = [];
    for (const [slot, mount, name] of boards) {
      if (!mount) continue;
      const slots = ['frame', slot];
      if (fm.includes(mount)) out.push(c.ok(slots, `${name} mounts`, `${mount} matches the frame's stack holes.`));
      else if (fm.some((x) => boardSize(x) > boardSize(mount))) out.push(c.warn(slots, `${name} needs adapter`, `${mount} board on a frame with ${fm.join(' / ')} holes — needs an adapter plate or printed mount.`));
      else out.push(c.bad(slots, `${name} won't mount`, `${mount} board is larger than the frame's ${fm.join(' / ')} mounting.`));
    }
    return out;
  },

  function fcEscLink(c) {
    if (c.build.elec !== 'separate') return;
    const fc = c.p('fc'), esc = c.p('esc');
    if (!fc || !esc) return;
    const slots = ['fc', 'esc'], out = [];
    const a = fc.specs.esc_connector, e = esc.specs.fc_connector;
    if (a === '8-pin' && e === '8-pin') {
      out.push(fc.brand === esc.brand
        ? c.ok(slots, 'Matched FC/ESC harness', 'Same-brand 8-pin harness — plug and play.')
        : c.warn(slots, 'Check 8-pin pinout', `${fc.brand} and ${esc.brand} both use 8-pin plugs, but pinouts differ between brands — compare them and re-pin the cable if needed.`));
    } else {
      out.push(c.ok(slots, 'FC/ESC wiring', 'Solder the signal/power wires between FC and ESC.'));
    }
    if (esc.specs.mount !== 'single' && fc.specs.mount && esc.specs.mount && fc.specs.mount !== esc.specs.mount) {
      out.push(c.warn(slots, 'FC and ESC sizes differ', `FC is ${fc.specs.mount}, ESC is ${esc.specs.mount} — they can't stack directly.`));
    }
    return out;
  },

  function uartBudget(c) {
    const { fc } = c.elec;
    if (!fc || typeof fc.uarts !== 'number') return;
    const need = [];
    const rx = c.p('receiver'), vtx = c.p('vtx'), gps = c.p('gps');
    const path = c.rc;
    if (rx && rx.specs.interface !== 'PWM') need.push('receiver');
    else if (path.dji) need.push('DJI RC (SBUS)');
    if (vtx && (vtx.specs.system !== 'analog' || vtx.specs.needs_uart)) need.push(vtx.specs.system === 'analog' ? 'VTX control' : 'digital OSD');
    if (gps) need.push('GPS');
    if (!need.length) return;
    const slots = [fcSlot(c.build), 'receiver', 'vtx', 'gps', ...(path.dji ? ['radio'] : [])];
    const list = need.join(', ');
    if (need.length <= fc.uarts) return c.ok(slots, 'Enough UARTs', `Needs ${need.length} (${list}); FC has ${fc.uarts}.`);
    return c.bad(slots, 'Not enough UARTs', `Needs ${need.length} UARTs (${list}) but the FC has ${fc.uarts}.`);
  },

  function vtxPower(c) {
    const vtx = c.p('vtx'), b = c.bat;
    if (!vtx || !b) return;
    const [lo, hi] = vtx.specs.input_v || [];
    if (lo == null) return;
    const cells = b.specs.cells;
    const bp = batteryParams(b), vLow = r2(cells * 3.4), vNom = r2(cells * 3.7), slots = ['vtx', 'battery', fcSlot(c.build)];
    const underMax = bp.vMax <= hi + EPS;
    if (underMax && vLow >= lo - EPS) return c.ok(slots, 'VTX power OK', `Runs straight from ${cells}S (accepts ${lo}–${hi}V).`);
    // Every board has a 5V rail even if no BEC rating was published.
    const board = c.elec.fc;
    const bec = board?.bec?.length ? board.bec : (board ? [{ v: 5, a: null }] : []);
    // BECs step voltage down, so a rail only works when the pack stays above
    // it — unless it's a boost converter (a rail higher than the board's max
    // pack voltage, or the 5V rail of a 1S board).
    const boardMaxCells = board?.cells_max ?? board?.input_cells?.[1] ?? c.elec.esc?.cells_max ?? 99;
    const boosted = (r) => r.boost || r.v > boardMaxCells * 4.35 || (r.v <= 5 && (c.elec.esc?.cells_min ?? board?.cells_min) === 1);
    const rails = bec.filter((r) => r.v >= lo - EPS && r.v <= hi + EPS && (vLow >= r.v + 0.5 || boosted(r)));
    if (rails.length) {
      const r = rails.sort((x, y) => (y.v * (y.a || 0)) - (x.v * (x.a || 0)))[0];
      const needW = vtxDrawW(vtx);
      if (!r.a || r.v * r.a >= needW) return c.ok(slots, 'Power VTX from BEC', `${cells}S is outside its ${lo}–${hi}V direct input, so power it from the FC's ${r.v}V ${boosted(r) ? 'boost ' : ''}BEC.`);
      return c.warn(slots, 'BEC may be too weak', `FC's ${r.v}V/${r.a}A BEC may not supply this VTX (~${r1(needW)}W).`);
    }
    if (underMax && vNom >= lo - EPS) return c.warn(slots, 'VTX may brown out', `${cells}S is inside the VTX's ${lo}–${hi}V range when charged, but sags below ${lo}V near the end of the pack.`);
    if (!board) return c.warn(slots, 'VTX needs a BEC', `${cells}S is outside the VTX's ${lo}–${hi}V input — pick an FC with a suitable BEC.`);
    if (!underMax) return c.bad(slots, 'Battery over-volts VTX', `VTX accepts up to ${hi}V; a charged ${cells}S pack is ${r1(bp.vMax)}V and the FC has no BEC in range.`);
    return c.bad(slots, 'Battery voltage too low for VTX', `VTX needs at least ${lo}V; ${cells}S sags to ~${r1(vLow)}V and the FC has no boost BEC for it.`);
  },

  function cameraPower(c) {
    const cam = c.p('camera'), b = c.bat;
    if (!cam || !b || !c.active.has('camera')) return;
    // HDZero cameras are powered over the VTX's camera cable (a mismatched
    // VTX is reported by cameraVtxSystem).
    if (cam.specs.system === 'hdzero') {
      return c.videoSys === 'hdzero' ? c.ok(['camera'], 'Camera power OK', 'Powered by the HDZero VTX through its camera cable.') : undefined;
    }
    const [lo, hi] = cam.specs.input_v || [];
    if (lo == null) return;
    const slots = ['camera', fcSlot(c.build)];
    const rails = [5, ...((c.elec.fc?.bec || []).map((r) => r.v))];
    const rail = rails.find((v) => v >= lo - EPS && v <= hi + EPS);
    if (rail) return c.ok(slots, 'Camera power OK', `Camera takes ${lo}–${hi}V; power it from the FC's ${rail}V pad.`);
    const bp = batteryParams(b);
    if (bp.vMax <= hi + EPS && r2(b.specs.cells * 3.4) >= lo - EPS) return c.ok(slots, 'Camera power OK', 'Camera can run directly from the battery.');
    return c.warn(slots, 'Camera power', `Camera needs ${lo}–${hi}V — check your FC has a matching output.`);
  },

  function cameraMount(c) {
    const f = c.p('frame'), vtx = c.p('vtx'), cam = c.active.has('camera') ? c.p('camera') : null;
    if (!f) return;
    let w, slot;
    if (vtx?.specs?.includes_camera) { w = vtx.specs.camera_width_mm; slot = 'vtx'; }
    else if (cam) { w = cam.specs.width_mm; slot = 'camera'; }
    const mounts = f.specs.camera_mount || [];
    if (!w || !mounts.length) return;
    const slots = ['frame', slot];
    if (mounts.some((m) => Math.abs(m - w) <= 0.6)) return c.ok(slots, 'Camera fits', `${w}mm camera matches the frame's camera mount.`);
    if (mounts.some((m) => m > w)) return c.warn(slots, 'Camera needs adapter', `${w}mm camera in a ${Math.max(...mounts)}mm mount needs adapter plates (often included).`);
    if (w - Math.max(...mounts) <= 1.2) return c.warn(slots, 'Tight camera fit', `${w}mm camera in a ${Math.max(...mounts)}mm mount — check the frame supports it (some flex to fit).`);
    return c.bad(slots, 'Camera too wide', `${w}mm camera won't fit the frame's ${mounts.join(' / ')}mm mount.`);
  },

  function frameVideo(c) {
    const f = c.p('frame'), vtx = c.p('vtx');
    const vs = f?.specs?.video_support || [];
    if (!f || !vtx || !vs.length) return;
    const sys = vtx.specs.system, slots = ['frame', 'vtx'];
    if (vs.includes(sys)) return c.ok(slots, 'Frame supports video system', `Frame lists ${VIDEO_LABELS[sys]} support.`);
    return c.warn(slots, 'Video mount not listed', `Frame doesn't list ${VIDEO_LABELS[sys]} — you may need a printed mount for the air unit or antenna.`);
  },

  function cameraVtxSystem(c) {
    const vtx = c.p('vtx');
    if (vtx?.specs?.includes_camera) return;
    const sys = c.videoSys;
    if (!sys || !c.p('frame') && !vtx) return;
    const vslot = c.videoSlot;
    const cam = c.active.has('camera') ? c.p('camera') : null;
    if (!cam) {
      if (['analog', 'hdzero'].includes(sys)) return c.warn(['camera', vslot], 'Camera needed', `This ${VIDEO_LABELS[sys]} ${vtx ? 'VTX' : 'AIO'} needs a ${VIDEO_LABELS[sys]} camera.`);
      return;
    }
    if (cam.specs.system === sys) return c.ok(['camera', vslot], 'Camera matches VTX', `${VIDEO_LABELS[sys]} camera + ${VIDEO_LABELS[sys]} ${vtx ? 'VTX' : 'AIO VTX'}.`);
    return c.bad(['camera', vslot], 'Camera/VTX mismatch', `${VIDEO_LABELS[cam.specs.system]} camera won't work with a ${VIDEO_LABELS[sys]} ${vtx ? 'VTX' : 'AIO VTX'}.`);
  },

  function analogOsd(c) {
    const { fc } = c.elec;
    if (!fc || c.videoSys !== 'analog' || fc.osd !== 'none') return;
    return c.warn([c.videoSlot, fcSlot(c.build)], 'No analog OSD', 'This FC has no analog OSD chip — no battery voltage or warnings in your goggles.');
  },

  function videoGoggles(c) {
    const g = c.p('goggles');
    const sys = c.videoSys;
    if (!g || !sys) return;
    const slots = [c.videoSlot, 'goggles'], label = VIDEO_LABELS[sys];
    const native = g.specs.systems || [], mod = g.specs.systems_via_module || [];
    if (native.includes(sys)) return c.ok(slots, 'Goggles receive video', `${g.brand} ${g.name} receive ${label} natively.`);
    if (mod.includes(sys)) return c.warn(slots, 'Goggles need module/firmware', `${g.name} need an add-on module or firmware for ${label}.`);
    if (sys === 'openipc') {
      if (native.length && native.every((s) => DJI_SYSTEMS.has(s))) return c.bad(slots, 'Goggles incompatible', `${g.name} have no HDMI input or module bay for an OpenIPC ground station.`);
      return c.warn(slots, 'OpenIPC ground station needed', `OpenIPC needs a ground receiver (e.g. a WiFiLink/Radxa VRX) feeding ${g.name} through HDMI-in or a module bay.`);
    }
    return c.bad(slots, 'Goggles incompatible', `${g.name} can't receive ${label} video.`);
  },

  function aioExtras(c) {
    if (c.build.elec !== 'aio') return;
    const aio = c.p('aio'), out = [];
    if (!aio) return;
    const bsys = builtinVtxSys(aio);
    if (bsys && c.p('vtx')) out.push(c.warn(['aio', 'vtx'], 'Two VTXs', `This AIO already has a built-in ${VIDEO_LABELS[bsys]} VTX — the extra VTX adds weight; only one will be used.`));
    return out;
  },

  function builtinReceiver(c) {
    const builtin = c.elec.fc?.rx_builtin;
    if (!builtin) return;
    const slots = [fcSlot(c.build), 'receiver'];
    if (c.p('receiver')) return c.info(slots, 'Built-in receiver', `The board has a built-in ${RC_LABELS[builtin] || builtin} receiver — the external receiver is optional.`);
    if (c.rc.dji) return c.info(slots, 'Built-in receiver unused', 'Wire the air unit\'s SBUS to a UART for the DJI controller; the onboard receiver goes unused.');
  },

  function rcLink(c) {
    const radio = c.p('radio');
    const { proto, slot } = c.rc;
    if (!radio || !proto) return;
    const [status, title, detail] = linkStatus(radio, proto);
    return c[status]([slot, 'radio'], title, detail);
  },

  function receiverPresent(c) {
    if (c.rc.proto || !c.p('frame')) return;
    return c.warn(['receiver'], 'No receiver', 'Add a receiver, or use a board with one built in.');
  },

  function batteryConnector(c) {
    const b = c.bat, { esc } = c.elec;
    if (!b || !esc) return;
    const pc = esc.power_connector, bc = b.specs.connector, slots = ['battery', elecSlot(c.build)];
    if (!pc || !bc) return;
    if (pc === 'solder') return c.info(slots, 'Solder battery lead', `Board has bare pads — solder on a ${bc} pigtail.`);
    if (pc === bc) return c.ok(slots, 'Battery plug matches', `${bc} on both.`);
    return c.warn(slots, 'Battery plug differs', `Battery has ${bc}; the board comes with ${pc} — swap the pigtail or use an adapter.`);
  },

  function batteryCurrent(c) {
    const b = c.bat, perf = c.sum.perf;
    if (!b || !perf || !perf.battery.maxContA) return;
    // Full throttle is a short burst, so compare it with the pack's rated
    // current; LiPo C ratings are optimistic, so only flag big overshoots red.
    const rated = perf.battery.maxContA;
    const I = perf.maxCurrent, slots = ['battery', 'motor', 'prop'];
    if (perf.sagLimited) return c.bad(slots, 'Battery collapses at full throttle', `This motor/prop pulls the pack below half voltage at full throttle (est. ${r0(I)}A) — use a bigger or higher-C pack, fewer cells, or a smaller prop.`);
    if (I <= rated) return c.ok(slots, 'Battery can deliver', `Peak est. ${r0(I)}A vs pack rating ${r0(rated)}A (${b.specs.c_rating}C).`);
    if (I <= rated * 1.5) return c.warn(slots, 'Battery near its limit', `Peak est. ${r0(I)}A is over the pack's ${r0(rated)}A rating — expect heavy sag and heat on punch-outs; a higher-C or bigger pack helps.`);
    return c.bad(slots, 'Battery overloaded', `Peak est. ${r0(I)}A is far beyond the pack's ${r0(rated)}A rating — it will sag hard, overheat and age fast.`);
  },

  function thrustToWeight(c) {
    const perf = c.sum.perf;
    if (!perf) return;
    const tw = perf.tw, target = c.sum.twTarget;
    const hover = perf.hover ? ` Hover ≈ ${r0(perf.hover.throttle * 100)}% throttle.` : '';
    if (tw >= target) return c.ok(AIR_SLOTS, 'Thrust-to-weight', `${r1(tw)}:1 — at or above the ~${target}:1 this build style aims for.${hover}`);
    if (tw >= TW_MIN) return c.warn(AIR_SLOTS, 'Low thrust-to-weight', `${r1(tw)}:1 is below the ~${target}:1 typical for this build — flyable, but sluggish in wind and with payload.${hover}`);
    return c.bad(AIR_SLOTS, 'Not enough thrust', `${r1(tw)}:1 — too little thrust for safe control (needs ~${TW_MIN}:1 minimum).`);
  },

  function tipSpeed(c) {
    const perf = c.sum.perf;
    if (!perf || perf.tipMach < 0.8) return;
    return c.warn(['motor', 'prop', 'battery'], 'Prop tips near sonic', `Tips reach about Mach ${perf.tipMach.toFixed(2)} at full throttle — loud and inefficient; consider lower KV or fewer cells.`);
  },

  function classFit(c) {
    const cls = CLASS_BY_ID[c.build.classId];
    if (!cls) return;
    const out = [];
    for (const slot of ['frame', 'motor', 'prop', 'battery', 'vtx', 'aio', 'stack', 'esc']) {
      if (!c.active.has(slot)) continue;
      const p = c.p(slot);
      if (!p || !p.classes?.length) continue;
      if (p.classes.includes(cls.id)) { out.push(c.ok([slot], `${p.name} suits class`, `Used on ${cls.short} builds.`, true)); continue; }
      const labels = CLASSES.filter((x) => p.classes.includes(x.id)).map((x) => x.short).join(', ');
      out.push(c.warn([slot], `${p.name}: different class`, `Usually used on ${labels} builds, not ${cls.short}.`));
    }
    return out;
  },

  function gpsAdvice(c) {
    if (c.p('gps') || !['p7', 'p8', 'p10', 'p13', 'p15'].includes(c.build.classId) || !c.p('frame')) return;
    return c.info(['gps'], 'GPS recommended', 'Long-range builds benefit from GPS Rescue and position/home info.');
  },
];

function makeCtx(build, db, options, sum) {
  const active = new Set(activeSlots(build, db).map((s) => s.key));
  const mk = (status) => (slots, title, detail, quiet = false) => ({ status, slots, title, detail, quiet });
  const c = {
    build, db, options, sum, active,
    elec: electronics(build, db),
    p: (key) => (active.has(key) ? db.byId[build[key]] : null),
    ok: mk('ok'), warn: mk('warn'), bad: mk('bad'), info: mk('info'),
  };
  c.bat = active.has('battery') ? effectiveBattery(build, db, options) : null;
  const vtx = c.p('vtx'), aio = build.elec === 'aio' ? c.p('aio') : null;
  c.videoSys = vtx?.specs?.system || builtinVtxSys(aio);
  c.videoSlot = vtx ? 'vtx' : 'aio';
  c.rc = rcPath(c);
  return c;
}

export function runChecks(build, db, options = DEFAULT_OPTIONS, sum = null) {
  sum = sum || summarize(build, db, options);
  const ctx = makeCtx(build, db, options, sum);
  const out = [];
  for (const check of CHECKS) {
    const r = check(ctx);
    if (!r) continue;
    for (const x of [].concat(r)) if (x) out.push({ ...x, id: check.name });
  }
  return out;
}

export function overallStatus(checks) {
  return worst(checks.filter((c) => c.status !== 'info').map((c) => c.status));
}

// Rate a candidate part for a slot against the rest of the build.
export function rateCandidate(slotKey, part, build, db, options = DEFAULT_OPTIONS) {
  const trial = { ...build, [slotKey]: part.id };
  if (part.category === 'aio') trial.elec = 'aio';
  if (part.category === 'stack') trial.elec = 'stack';
  if (part.category === 'fc' || part.category === 'esc') trial.elec = 'separate';
  const sum = summarize(trial, db, options, true);
  const checks = runChecks(trial, db, options, sum).filter((c) => c.slots.includes(slotKey) && c.status !== 'info');
  const status = checks.length ? worst(checks.map((c) => c.status)) : 'ok';
  return { status, checks: checks.filter((c) => c.status !== 'ok'), sum };
}
