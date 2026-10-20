// Resolves a build (slot -> part id) into parts, weights and performance.

import { analyzePower } from './physics.js';
import { CLASS_BY_ID, STYLE_TW, vtxDrawW } from './classes.js';

export const SLOTS = [
  { key: 'frame', cat: 'frame', label: 'Frame', required: true },
  { key: 'motor', cat: 'motor', label: 'Motors', required: true },
  { key: 'prop', cat: 'prop', label: 'Props', required: true },
  { key: 'aio', cat: 'aio', label: 'AIO board (FC + ESC)', elec: 'aio' },
  { key: 'stack', cat: 'stack', label: 'Stack (FC + ESC)', elec: 'stack' },
  { key: 'fc', cat: 'fc', label: 'Flight controller', elec: 'separate' },
  { key: 'esc', cat: 'esc', label: 'ESC', elec: 'separate' },
  { key: 'battery', cat: 'battery', label: 'Battery', required: true },
  { key: 'vtx', cat: 'vtx', label: 'Video transmitter / digital kit' },
  { key: 'camera', cat: 'camera', label: 'FPV camera' },
  { key: 'receiver', cat: 'receiver', label: 'Receiver' },
  { key: 'gps', cat: 'gps', label: 'GPS' },
  { key: 'payload', cat: 'payload', label: 'Payload / action cam' },
  { key: 'radio', cat: 'radio', label: 'Radio / RF module', ground: true },
  { key: 'goggles', cat: 'goggles', label: 'Goggles', ground: true },
];

export const SLOT_BY_KEY = Object.fromEntries(SLOTS.map((s) => [s.key, s]));

export const DEFAULT_OPTIONS = {
  style: null, // null = class default
  payloadG: 0,
  miscG: null, // null = class default
  altitude: 0,
  tempC: 15,
  batteries: 1,
  seriesPacks: 1, // e.g. 2 × 6S wired in series for a 12S X-Class build
  spareProps: 1,
  includeGround: false,
};

export function newBuild(classId = 'p5') {
  return {
    classId, elec: 'stack',
    frame: null, motor: null, prop: null, aio: null, stack: null, fc: null, esc: null,
    battery: null, vtx: null, camera: null, receiver: null, gps: null, payload: null,
    radio: null, goggles: null,
  };
}

// Which slots are part of this build given the electronics mode and video kit.
export function activeSlots(build, db) {
  const vtx = db.byId[build.vtx];
  return SLOTS.filter((s) => {
    if (s.elec && s.elec !== build.elec) return false;
    if (s.key === 'camera' && vtx?.specs?.includes_camera) return false;
    return true;
  });
}

export function motorCount(build, db) {
  return db.byId[build.frame]?.specs?.motor_count || 4;
}

export function slotQty(slotKey, part, build, db, options = DEFAULT_OPTIONS) {
  const n = motorCount(build, db);
  if (slotKey === 'motor' || slotKey === 'prop') return n;
  if (slotKey === 'battery') return Math.max(1, options.seriesPacks || 1);
  if (slotKey === 'esc' && part?.specs?.type === 'single') return n;
  if (slotKey === 'esc') return Math.ceil(n / 4); // 4-in-1s: two for an X8
  return 1;
}

// Unified flight-controller / ESC views regardless of AIO, stack or separate.
export function electronics(build, db) {
  if (build.elec === 'aio') {
    const a = db.byId[build.aio];
    if (!a) return { fc: null, esc: null };
    const s = a.specs;
    return {
      fc: { ...s, name: a.name, brand: a.brand, source: 'aio' },
      esc: {
        type: '4in1', cont_a: s.esc_cont_a, burst_a: s.esc_burst_a, cells_min: s.cells_min,
        cells_max: s.cells_max, mount: s.mount, power_connector: s.power_connector,
        firmware: s.esc_firmware, name: a.name, brand: a.brand, source: 'aio',
      },
    };
  }
  if (build.elec === 'stack') {
    const st = db.byId[build.stack];
    if (!st) return { fc: null, esc: null };
    return {
      fc: { ...st.specs.fc, brand: st.brand, name: st.name, source: 'stack' },
      esc: { ...st.specs.esc, brand: st.brand, name: st.name, source: 'stack' },
    };
  }
  const fc = db.byId[build.fc], esc = db.byId[build.esc];
  return {
    fc: fc ? { ...fc.specs, brand: fc.brand, name: fc.name, source: 'fc' } : null,
    esc: esc ? { ...esc.specs, brand: esc.brand, name: esc.name, source: 'esc' } : null,
  };
}

// The battery as the quad sees it: n identical packs in series multiply the
// cell count (and pack resistance); capacity and C rating stay the same.
export function effectiveBattery(build, db, options = DEFAULT_OPTIONS) {
  const base = db.byId[build.battery];
  const n = Math.max(1, options.seriesPacks || 1);
  if (!base || n === 1) return base || null;
  const s = base.specs;
  const parallel = String(s.config || '').match(/(\d+)P/i)?.[1] || '1';
  return {
    ...base,
    name: `${n} × ${base.name} in series`,
    weight_g: (base.weight_g || 0) * n,
    specs: { ...s, cells: s.cells * n, config: `${s.cells * n}S${parallel}P` },
  };
}

export function styleFor(build, db, options) {
  return options.style || CLASS_BY_ID[build.classId]?.style || 'freestyle';
}

export function twTarget(build, db) {
  const frame = db.byId[build.frame];
  return STYLE_TW[frame?.specs?.style] || CLASS_BY_ID[build.classId]?.tw || 4;
}

// Main entry: everything the Performance, Cost and compatibility views need.
export function summarize(build, db, options = DEFAULT_OPTIONS, lite = false) {
  const cls = CLASS_BY_ID[build.classId];
  const slots = activeSlots(build, db);
  const lines = [];
  for (const slot of slots) {
    const part = db.byId[build[slot.key]];
    if (!part) continue;
    const qty = slotQty(slot.key, part, build, db, options);
    lines.push({
      slot: slot.key, label: slot.label, part, qty, ground: !!slot.ground,
      unitG: part.weight_g || 0, totalG: slot.ground ? 0 : (part.weight_g || 0) * qty,
      est: (part.est || []).includes('weight_g'),
    });
  }

  const miscG = options.miscG ?? cls?.misc ?? 10;
  const airLines = lines.filter((l) => !l.ground);
  const battery = airLines.find((l) => l.slot === 'battery');
  const payloadLine = airLines.find((l) => l.slot === 'payload');
  const dryG = airLines.filter((l) => l.slot !== 'battery' && l.slot !== 'payload')
    .reduce((a, l) => a + l.totalG, 0) + miscG;
  const payloadG = (payloadLine?.totalG || 0) + (options.payloadG || 0);
  const auwG = dryG + (battery?.totalG || 0) + payloadG;

  const motor = db.byId[build.motor], prop = db.byId[build.prop], bat = effectiveBattery(build, db, options);
  const motors = motorCount(build, db);
  const vtx = db.byId[build.vtx];
  const aio = build.elec === 'aio' ? db.byId[build.aio] : null;
  const auxW = 0.7 + (cls && ['w65', 'w75'].includes(cls.id) ? -0.3 : 0)
    + (vtx ? vtxDrawW(vtx) : aio?.specs?.vtx_builtin ? 1.5 : 0)
    + (build.gps && db.byId[build.gps] ? 0.5 : 0);

  // Shared with the Performance tab's extra runs (e.g. payload) so they match.
  const powerOpts = {
    motors, auxW, altitude: options.altitude, tempC: options.tempC,
    coaxial: !!db.byId[build.frame]?.specs?.coaxial,
  };
  let perf = null;
  if (motor && prop && bat && motor.specs?.kv && prop.specs?.diameter_in) {
    perf = analyzePower(motor, prop, bat, { ...powerOpts, auwG, lite });
  }

  return {
    cls, lines, miscG, dryG, payloadG, auwG, motors, auxW, perf, battery: bat, powerOpts,
    style: styleFor(build, db, options),
    twTarget: twTarget(build, db),
    complete: SLOTS.filter((s) => s.required).every((s) => db.byId[build[s.key]]),
  };
}
