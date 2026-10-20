// In-browser tests for the physics model and compatibility engine.
// Open tests/index.html through a local server (python -m http.server).

import { analyzePower, motorParams, propCoeffs, motorPoint, currentAtThrust } from '../src/physics.js';
import { buildDB } from '../src/data.js';
import { newBuild, summarize, DEFAULT_OPTIONS } from '../src/build.js';
import { runChecks, rateCandidate, overallStatus } from '../src/compat.js';
import { purchaseOptions, bestOffer, costTotals } from '../src/pricing.js';
import { sanitizeOptions, sanitizeBuild } from '../src/state.js';

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.message }); }
}
function within(label, x, lo, hi) {
  if (!(x >= lo && x <= hi)) throw new Error(`${label} = ${typeof x === 'number' ? x.toFixed(2) : x}, expected ${lo}–${hi}`);
}
function eq(label, a, b) { if (a !== b) throw new Error(`${label}: got ${a}, expected ${b}`); }

// ---- fixtures ---------------------------------------------------------
const motor = (id, s, extra = {}) => ({ id, category: 'motor', brand: 'T', name: id, classes: extra.classes || ['p5'], weight_g: extra.w || 33, specs: s, offers: [] });
const prop = (id, d, p, b, hub = 'M5', classes = ['p5']) => ({ id, category: 'prop', brand: 'T', name: id, classes, weight_g: 4, specs: { diameter_in: d, pitch_in: p, blades: b, hub, style: 'freestyle' }, offers: [] });
const bat = (id, cells, mah, c, chem = 'LiPo', conn = 'XT60', config = null, w = 200, classes = ['p5']) => ({ id, category: 'battery', brand: 'T', name: id, classes, weight_g: w, specs: { cells, capacity_mah: mah, c_rating: c, chemistry: chem, connector: conn, config: config || `${cells}S1P` }, offers: [] });

const parts = [
  { id: 'frame-5', category: 'frame', brand: 'T', name: '5in', classes: ['p5'], weight_g: 110, specs: { prop_max_in: 5.1, wheelbase_mm: 225, style: 'freestyle', ducted: false, motor_mount: ['16x16'], stack_mount: ['30.5x30.5', '20x20'], camera_mount: [19, 20], video_support: ['analog', 'dji-o3', 'dji-o4', 'walksnail'], motor_count: 4 }, offers: [] },
  { id: 'frame-whoop', category: 'frame', brand: 'T', name: '65mm', classes: ['w65'], weight_g: 4.5, specs: { prop_max_in: 1.22, wheelbase_mm: 65, style: 'whoop', ducted: true, motor_mount: ['W1S'], stack_mount: ['25.5x25.5'], camera_mount: [14], video_support: ['analog'], motor_count: 4 }, offers: [] },
  motor('motor-2207', { stator: '2207', stator_d_mm: 22, stator_h_mm: 7, kv: 1950, cells_min: 4, cells_max: 6, mount: ['16x16'], shaft: 'M5', max_current_a: 45, prop_range_in: [5, 5.1] }),
  motor('motor-2207-lowmount', { stator: '2207', stator_d_mm: 22, stator_h_mm: 7, kv: 1950, cells_min: 4, cells_max: 6, mount: ['12x12'], shaft: 'M5', max_current_a: 45, prop_range_in: [5, 5.1] }),
  motor('motor-0702', { stator: '0702', stator_d_mm: 7, stator_h_mm: 2, kv: 26000, cells_min: 1, cells_max: 1, mount: ['W1S'], shaft: '1mm', max_current_a: 3, prop_range_in: [1.2, 1.2] }, { classes: ['w65'], w: 2 }),
  motor('motor-2806', { stator: '2806.5', stator_d_mm: 28, stator_h_mm: 6.5, kv: 1300, cells_min: 6, cells_max: 6, mount: ['16x16'], shaft: 'M5', max_current_a: 50, prop_range_in: [7, 7] }, { classes: ['p7'], w: 47 }),
  motor('motor-4214', { stator: '4214', stator_d_mm: 42, stator_h_mm: 14, kv: 400, cells_min: 6, cells_max: 12, mount: ['25x25'], shaft: 'M6', max_current_a: 50, prop_range_in: [13, 15] }, { classes: ['p13'], w: 170 }),
  prop('prop-51466', 5.1, 4.66, 3),
  prop('prop-6inch', 6, 3.5, 3),
  prop('prop-tmount', 5.1, 4.66, 3, 'T-mount'),
  prop('prop-31mm', 1.22, 0.85, 3, '1mm', ['w65']),
  prop('prop-7040', 7, 4, 3, 'M5', ['p7']),
  prop('prop-1344', 13, 4.4, 2, 'M6', ['p13']),
  bat('bat-6s1300', 6, 1300, 120, 'LiPo', 'XT60', null, 215),
  bat('bat-8s1300', 8, 1300, 100, 'LiPo', 'XT60', null, 280),
  bat('bat-1s300', 1, 300, 60, 'LiHV', 'BT2.0', null, 8, ['w65']),
  bat('bat-6s2p', 6, 8000, 10, 'Li-ion', 'XT60', '6S2P', 830, ['p7']),
  bat('bat-6s10000', 6, 10000, 25, 'LiPo', 'XT90', null, 1300, ['p13']),
  { id: 'stack-f4-55', category: 'stack', brand: 'SB', name: 'F405 55A', classes: ['p5'], weight_g: 25, specs: {
    fc: { mcu: 'F405', mount: '30.5x30.5', uarts: 2, bec: [{ v: 5, a: 2 }, { v: 9, a: 2 }], esc_connector: '8-pin', gyro: 'ICM42688P', osd: 'analog', firmware: ['betaflight'], weight_g: 9 },
    esc: { type: '4in1', cont_a: 55, burst_a: 70, cells_min: 3, cells_max: 6, mount: '30.5x30.5', firmware: 'BLHeli_S', fc_connector: '8-pin', power_connector: 'XT60', weight_g: 16 } }, offers: [] },
  { id: 'aio-1s', category: 'aio', brand: 'B', name: '1S AIO', classes: ['w65'], weight_g: 2.8, specs: { mcu: 'F411', mount: '25.5x25.5', uarts: 2, cells_min: 1, cells_max: 1, esc_cont_a: 5, esc_burst_a: 6, rx_builtin: 'elrs-2.4', vtx_builtin: 'analog 400mW', power_connector: 'BT2.0', osd: 'analog', bec: [{ v: 5, a: 1 }] }, offers: [] },
  { id: 'vtx-o3', category: 'vtx', brand: 'DJI', name: 'O3', classes: ['p5'], weight_g: 36, specs: { system: 'dji-o3', includes_camera: true, camera_width_mm: 20, input_v: [7.4, 26.4], power_mw: 1200, power_draw_w: 6, mount: '30.5x30.5', needs_uart: true, rx_protocols: ['dji-rc'] }, offers: [] },
  { id: 'rx-elrs', category: 'receiver', brand: 'R', name: 'RP1', classes: ['p5', 'w65'], weight_g: 0.6, specs: { protocol: 'elrs-2.4', diversity: 'none', interface: 'CRSF', telemetry: true }, offers: [] },
  { id: 'rx-900', category: 'receiver', brand: 'R', name: 'BR3', classes: ['p7'], weight_g: 1.5, specs: { protocol: 'elrs-900', diversity: 'none', interface: 'CRSF', telemetry: true }, offers: [] },
  { id: 'gps-m10', category: 'gps', brand: 'H', name: 'M10', classes: ['p5', 'p7'], weight_g: 6, specs: { chip: 'M10', compass: false, needs_uart: true }, offers: [] },
  { id: 'radio-pocket', category: 'radio', brand: 'RM', name: 'Pocket', classes: [], weight_g: 260, specs: { kind: 'radio', protocols: ['elrs-2.4'], module_bay: 'nano', form: 'compact' }, offers: [] },
  { id: 'radio-gamepad', category: 'radio', brand: 'X', name: 'Gamepad', classes: [], weight_g: 200, specs: { kind: 'radio', protocols: ['elrs-2.4'], module_bay: 'none', form: 'gamepad' }, offers: [] },
  { id: 'goggles-dji3', category: 'goggles', brand: 'DJI', name: 'Goggles 3', classes: [], weight_g: 470, specs: { systems: ['dji-o3', 'dji-o4', 'dji-o4-pro'], systems_via_module: [], form: 'compact' }, offers: [] },
  { id: 'goggles-skyzone', category: 'goggles', brand: 'Skyzone', name: '04X', classes: [], weight_g: 300, specs: { systems: ['analog'], systems_via_module: ['hdzero', 'walksnail'], form: 'modular' }, offers: [] },
  { id: 'goggles-ev800', category: 'goggles', brand: 'Eachine', name: 'EV800D', classes: [], weight_g: 400, specs: { systems: ['analog'], systems_via_module: [], form: 'box' }, offers: [] },
  { id: 'goggles-hdz', category: 'goggles', brand: 'HDZero', name: 'Goggle 2', classes: [], weight_g: 290, specs: { systems: ['hdzero', 'analog'], systems_via_module: [], form: 'compact' }, offers: [] },
  { id: 'aio-hdz', category: 'aio', brand: 'HDZero', name: 'AIO5', classes: ['w65'], weight_g: 4, specs: { mcu: 'F411', mount: '25.5x25.5', uarts: 2, cells_min: 1, cells_max: 1, esc_cont_a: 5, esc_burst_a: 6, rx_builtin: 'elrs-2.4', vtx_builtin: 'hdzero 200mW', power_connector: 'BT2.0', osd: 'none', bec: [{ v: 5, a: 1 }] }, offers: [] },
  { id: 'aio-2s-hd', category: 'aio', brand: 'Flywoo', name: 'GOKU HD 1-2S', classes: ['p2'], weight_g: 5, specs: { mcu: 'F405', mount: '25.5x25.5', uarts: 3, cells_min: 1, cells_max: 2, esc_cont_a: 12, esc_burst_a: 15, rx_builtin: 'elrs-2.4', vtx_builtin: null, power_connector: 'XT30', osd: 'none', bec: [{ v: 5, a: 2 }, { v: 9, a: 2 }] }, offers: [] },
  { id: 'aio-nobec', category: 'aio', brand: 'X', name: 'F411 20A', classes: ['p3'], weight_g: 6, specs: { mcu: 'F411', mount: '20x20', uarts: 2, cells_min: 2, cells_max: 4, esc_cont_a: 20, esc_burst_a: 25, rx_builtin: null, vtx_builtin: null, power_connector: 'XT30', osd: 'analog', bec: [] }, offers: [] },
  { id: 'vtx-o4pro', category: 'vtx', brand: 'DJI', name: 'O4 Pro', classes: ['p2', 'p5'], weight_g: 30, specs: { system: 'dji-o4-pro', includes_camera: true, camera_width_mm: 20, input_v: [7.4, 26.4], power_mw: 1200, power_draw_w: 6, mount: '20x20', needs_uart: true, rx_protocols: ['dji-rc'] }, offers: [] },
  { id: 'vtx-analog5v', category: 'vtx', brand: 'HGLRC', name: 'Zeus Nano', classes: ['p3'], weight_g: 2, specs: { system: 'analog', includes_camera: false, input_v: [5, 5], power_mw: 350, mount: '20x20', needs_uart: true }, offers: [] },
  { id: 'vtx-hdz', category: 'vtx', brand: 'HDZero', name: 'Race V3', classes: ['p5'], weight_g: 8, specs: { system: 'hdzero', includes_camera: false, input_v: [7, 25], power_mw: 200, mount: '20x20', needs_uart: true }, offers: [] },
  { id: 'vtx-openipc', category: 'vtx', brand: 'RunCam', name: 'WiFiLink 2', classes: ['p5'], weight_g: 30, specs: { system: 'openipc', includes_camera: true, camera_width_mm: 19, input_v: [7, 26], power_mw: 800, mount: '20x20', needs_uart: true }, offers: [] },
  { id: 'camera-hdz', category: 'camera', brand: 'RunCam', name: 'HDZero Nano V3', classes: ['p5'], weight_g: 2, specs: { system: 'hdzero', width_mm: 14, input_v: [3.3, 3.3] }, offers: [] },
  { id: 'bat-2s', category: 'battery', brand: 'T', name: '2S 450', classes: ['p2'], weight_g: 30, specs: { cells: 2, capacity_mah: 450, c_rating: 80, chemistry: 'LiPo', connector: 'XT30', config: '2S1P' }, offers: [] },
  { id: 'bat-3s', category: 'battery', brand: 'T', name: '3S 650', classes: ['p3'], weight_g: 60, specs: { cells: 3, capacity_mah: 650, c_rating: 80, chemistry: 'LiPo', connector: 'XT30', config: '3S1P' }, offers: [] },
  { id: 'radio-dji', category: 'radio', brand: 'DJI', name: 'FPV RC 3', classes: [], weight_g: 200, specs: { kind: 'radio', protocols: ['dji-rc'], module_bay: 'none', form: 'gamepad' }, offers: [] },
  { id: 'radio-xf', category: 'radio', brand: 'TBS', name: 'Tango 2', classes: [], weight_g: 400, specs: { kind: 'radio', protocols: ['crossfire'], module_bay: 'none', form: 'compact' }, offers: [] },
  { id: 'stack-rx', category: 'stack', brand: 'HDZero', name: 'Halo 70A', classes: ['p5'], weight_g: 25, specs: {
    fc: { mcu: 'H743', mount: '20x20', uarts: 4, bec: [{ v: 5, a: 2 }, { v: 10, a: 2 }], esc_connector: '8-pin', gyro: 'ICM42688P', osd: 'none', firmware: ['betaflight'], rx_builtin: 'elrs-2.4', weight_g: 8 },
    esc: { type: '4in1', cont_a: 70, burst_a: 80, cells_min: 3, cells_max: 8, mount: '20x20', firmware: 'AM32', fc_connector: '8-pin', power_connector: 'XT60', weight_g: 15 } }, offers: [] },
  { id: 'frame-x8', category: 'frame', brand: 'iFlight', name: 'Centurion X8', classes: ['p10'], weight_g: 600, specs: { prop_max_in: 10, wheelbase_mm: 500, style: 'cinelifter', ducted: false, motor_mount: ['16x16', '19x19'], stack_mount: ['30.5x30.5'], camera_mount: [19, 20], video_support: ['dji-o3'], motor_count: 8, coaxial: true }, offers: [] },
  { id: 'frame-85', category: 'frame', brand: 'Flywoo', name: 'FlyLens 85', classes: ['p2'], weight_g: 20, specs: { prop_max_in: 2, wheelbase_mm: 85, style: 'cinewhoop', ducted: true, motor_mount: ['9x9'], stack_mount: ['25.5x25.5'], camera_mount: [20], video_support: ['dji-o4-pro'], motor_count: 4 }, offers: [] },
  { id: 'prop-cw-ccw', category: 'prop', brand: 'HQ', name: '8x4.3x3', classes: ['p8'], weight_g: 7, specs: { diameter_in: 8, pitch_in: 4.3, blades: 3, hub: 'M5', style: 'long-range' }, offers: [
    { store: 'newbee', url: 'https://www.newbeedrone.com/products/hq-8x4-3x3-ccw', pack_qty: 1, price: 3.9, available: true },
    { store: 'rdq', url: 'https://www.racedayquads.com/products/hq-8x4-3x3-set', pack_qty: 4, price: 15.99, available: true },
    { store: 'getfpv', url: 'https://www.getfpv.com/hq-8x4-3x3-cw.html', pack_qty: 1, price: 3.5, available: true },
    { store: 'getfpv', url: 'https://www.getfpv.com/hq-8x4-3x3-ccw.html', pack_qty: 1, price: 3.6, available: false },
  ] },
  { id: 'motor-oos', category: 'motor', brand: 'A', name: '2207', classes: ['p5'], weight_g: 33, specs: { stator: '2207', stator_d_mm: 22, stator_h_mm: 7, kv: 1960, cells_min: 6, cells_max: 6, mount: ['16x16'], shaft: 'M5', max_current_a: 45 }, offers: [
    { store: 'rdq', url: 'https://www.racedayquads.com/products/a', pack_qty: 1, price: 24.99, available: true },
    { store: 'newbee', url: 'https://www.newbeedrone.com/products/a', pack_qty: 1, price: 15.9, available: false },
  ] },
];
const db = buildDB({ version: 't', parts });
const B = (o) => ({ ...newBuild(o.classId || 'p5'), ...o });
const sumOf = (b) => summarize(b, db, DEFAULT_OPTIONS);
const statusOf = (b, id) => runChecks(b, db, DEFAULT_OPTIONS).filter((c) => c.id === id).map((c) => c.status);

// ---- physics -----------------------------------------------------------
test('5" 2207 1950KV on 6S: per-motor thrust and current plausible', () => {
  const p = analyzePower(db.byId['motor-2207'], db.byId['prop-51466'], db.byId['bat-6s1300'], { motors: 4, auwG: 650, auxW: 6 });
  within('thrust/motor g', p.maxThrustPerMotor, 1100, 2100);
  within('current/motor A', p.maxMotorCurrent, 25, 65);
  within('T/W', p.tw, 6, 13);
  within('hover throttle', p.hover.throttle, 0.15, 0.42);
  within('hover min', p.flight.hover, 5, 22);
  within('freestyle min', p.flight.freestyle, 2, 7);
});

test('65mm 1S whoop: thrust and flight time plausible', () => {
  const p = analyzePower(db.byId['motor-0702'], db.byId['prop-31mm'], db.byId['bat-1s300'], { motors: 4, auwG: 22, auxW: 1.5 });
  within('thrust/motor g', p.maxThrustPerMotor, 12, 40);
  within('T/W', p.tw, 2, 7);
  within('cruise min', p.flight.cruise, 1.5, 7);
});

test('7" Li-ion long range: long cruise time', () => {
  const p = analyzePower(db.byId['motor-2806'], db.byId['prop-7040'], db.byId['bat-6s2p'], { motors: 4, auwG: 1250, auxW: 7 });
  within('thrust/motor g', p.maxThrustPerMotor, 1100, 2600);
  within('cruise min', p.flight.cruise, 12, 45);
});

test('13" 4214 400KV on 6S lifts heavy payload', () => {
  const p = analyzePower(db.byId['motor-4214'], db.byId['prop-1344'], db.byId['bat-6s10000'], { motors: 4, auwG: 3500, auxW: 8 });
  within('thrust/motor g', p.maxThrustPerMotor, 1500, 5000);
  within('payload at 2:1 g', p.payloadAt(2), 0, 7000);
});

test('Higher pitch prop draws more current', () => {
  const lo = analyzePower(db.byId['motor-2207'], { specs: { diameter_in: 5.1, pitch_in: 3, blades: 3 } }, db.byId['bat-6s1300'], { motors: 4, auwG: 650 });
  const hi = analyzePower(db.byId['motor-2207'], { specs: { diameter_in: 5.1, pitch_in: 5, blades: 3 } }, db.byId['bat-6s1300'], { motors: 4, auwG: 650 });
  if (!(hi.maxMotorCurrent > lo.maxMotorCurrent)) throw new Error('pitch should raise current');
});

test('Bigger battery: heavier but longer hover', () => {
  const small = analyzePower(db.byId['motor-2806'], db.byId['prop-7040'], db.byId['bat-6s1300'], { motors: 4, auwG: 650 });
  const big = analyzePower(db.byId['motor-2806'], db.byId['prop-7040'], db.byId['bat-6s2p'], { motors: 4, auwG: 1265 });
  if (!(big.flight.hover > small.flight.hover)) throw new Error('more capacity should hover longer');
});

test('Motor/prop coefficients are finite', () => {
  const m = motorParams(db.byId['motor-2207']);
  const c = propCoeffs(db.byId['prop-51466']);
  for (const [k, v] of Object.entries({ ...m, ...c })) if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`${k} not finite`);
});

// ---- compatibility -----------------------------------------------------
const good = B({ frame: 'frame-5', motor: 'motor-2207', prop: 'prop-51466', battery: 'bat-6s1300', elec: 'stack', stack: 'stack-f4-55', vtx: 'vtx-o3', receiver: 'rx-elrs', radio: 'radio-pocket', goggles: 'goggles-dji3' });

test('Known-good 5" build has no red checks', () => {
  const checks = runChecks(good, db, DEFAULT_OPTIONS);
  const bad = checks.filter((c) => c.status === 'bad');
  if (bad.length) throw new Error(bad.map((c) => c.title).join(', '));
  if (overallStatus(checks) === 'bad') throw new Error('overall red');
});

test('Motor bolt pattern mismatch is red', () => eq('motorMount', statusOf({ ...good, motor: 'motor-2207-lowmount' }, 'motorMount')[0], 'bad'));
test('Prop bigger than frame is red', () => eq('propFit', statusOf({ ...good, prop: 'prop-6inch' }, 'propFit')[0], 'bad'));
test('T-mount prop on M5 shaft is red', () => eq('propHub', statusOf({ ...good, prop: 'prop-tmount' }, 'propHub')[0], 'bad'));
test('8S on a 6S motor is red', () => eq('motorVoltage', statusOf({ ...good, battery: 'bat-8s1300' }, 'motorVoltage')[0], 'bad'));
test('8S on a 6S ESC is red', () => eq('escVoltage', statusOf({ ...good, battery: 'bat-8s1300' }, 'escVoltage')[0], 'bad'));
test('DJI O3 on 1S is red (voltage too low)', () => eq('vtxPower', statusOf({ ...good, battery: 'bat-1s300' }, 'vtxPower')[0], 'bad'));
test('Analog-only goggles with O3 is red', () => eq('videoGoggles', statusOf({ ...good, goggles: 'goggles-skyzone' }, 'videoGoggles')[0], 'bad'));
test('ELRS 900 RX with 2.4 radio that has a module bay is yellow', () => eq('rcLink', statusOf({ ...good, receiver: 'rx-900' }, 'rcLink')[0], 'warn'));
test('ELRS 900 RX with bay-less radio is red', () => eq('rcLink', statusOf({ ...good, receiver: 'rx-900', radio: 'radio-gamepad' }, 'rcLink')[0], 'bad'));
test('UART budget: RX + O3 + GPS on a 2-UART FC is red', () => eq('uartBudget', statusOf({ ...good, gps: 'gps-m10' }, 'uartBudget')[0], 'bad'));
test('Class mismatch is yellow, not red', () => {
  const st = runChecks({ ...good, classId: 'p7' }, db, DEFAULT_OPTIONS).filter((c) => c.id === 'classFit').map((c) => c.status);
  if (!st.includes('warn') || st.includes('bad')) throw new Error(st.join(','));
});
test('Whoop build with 2207 motor is red on mount', () => {
  const w = B({ classId: 'w65', frame: 'frame-whoop', motor: 'motor-2207', prop: 'prop-31mm', battery: 'bat-1s300', elec: 'aio', aio: 'aio-1s' });
  eq('motorMount', statusOf(w, 'motorMount')[0], 'bad');
});
test('Good 1S whoop has no red', () => {
  const w = B({ classId: 'w65', frame: 'frame-whoop', motor: 'motor-0702', prop: 'prop-31mm', battery: 'bat-1s300', elec: 'aio', aio: 'aio-1s' });
  const bad = runChecks(w, db, DEFAULT_OPTIONS).filter((c) => c.status === 'bad');
  if (bad.length) throw new Error(bad.map((c) => `${c.title}: ${c.detail}`).join(' | '));
});
test('rateCandidate colours a heavy battery on a whoop', () => {
  const w = B({ classId: 'w65', frame: 'frame-whoop', motor: 'motor-0702', prop: 'prop-31mm', elec: 'aio', aio: 'aio-1s' });
  const r = rateCandidate('battery', db.byId['bat-6s1300'], w, db, DEFAULT_OPTIONS);
  eq('status', r.status, 'bad');
});
test('AUW sums parts + misc', () => {
  const s = sumOf(good);
  const expect = 110 + 33 * 4 + 4 * 4 + 25 + 215 + 36 + 0.6 + s.miscG;
  within('auw', s.auwG, expect - 0.01, expect + 0.01);
});

// ---- review regressions -------------------------------------------------
const whoopHdz = B({ classId: 'w65', frame: 'frame-whoop', motor: 'motor-0702', prop: 'prop-31mm', battery: 'bat-1s300', elec: 'aio', aio: 'aio-hdz' });
test('HDZero AIO with analog-only goggles is red', () => eq('videoGoggles', statusOf({ ...whoopHdz, goggles: 'goggles-ev800' }, 'videoGoggles')[0], 'bad'));
test('HDZero AIO with HDZero goggles is green', () => eq('videoGoggles', statusOf({ ...whoopHdz, goggles: 'goggles-hdz' }, 'videoGoggles')[0], 'ok'));
test('HDZero AIO without a camera asks for an HDZero camera', () => eq('cameraVtxSystem', statusOf(whoopHdz, 'cameraVtxSystem')[0], 'warn'));
test('HDZero camera on HDZero VTX: power is OK', () => eq('cameraPower', statusOf({ ...good, vtx: 'vtx-hdz', camera: 'camera-hdz' }, 'cameraPower')[0], 'ok'));
test('2S HD AIO 9V boost rail powers an O4 Pro', () => {
  const b = B({ classId: 'p2', frame: 'frame-85', battery: 'bat-2s', elec: 'aio', aio: 'aio-2s-hd', vtx: 'vtx-o4pro' });
  const st = statusOf(b, 'vtxPower')[0];
  if (st === 'bad') throw new Error('vtxPower red');
});
test('Empty BEC list still has a 5V rail for a 5V VTX', () => {
  const b = B({ classId: 'p3', battery: 'bat-3s', elec: 'aio', aio: 'aio-nobec', vtx: 'vtx-analog5v' });
  eq('vtxPower', statusOf(b, 'vtxPower')[0], 'ok');
});
test('Stack with built-in ELRS: no "No receiver" warning', () => {
  const b = { ...good, stack: 'stack-rx', receiver: null };
  if (statusOf(b, 'receiverPresent').length) throw new Error('receiverPresent fired');
});
test('Stack with built-in ELRS and a Crossfire radio is a mismatch', () => eq('rcLink', statusOf({ ...good, stack: 'stack-rx', receiver: null, radio: 'radio-xf' }, 'rcLink')[0], 'bad'));
test('DJI RC through O3 with an ELRS AIO is fine', () => {
  const b = B({ classId: 'p2', frame: 'frame-85', battery: 'bat-2s', elec: 'aio', aio: 'aio-2s-hd', vtx: 'vtx-o4pro', radio: 'radio-dji' });
  eq('rcLink', statusOf(b, 'rcLink')[0], 'ok');
  if (rateCandidate('aio', db.byId['aio-2s-hd'], b, db, DEFAULT_OPTIONS).status === 'bad') throw new Error('AIO rated red');
});
test('X8 frame with one stack warns about ESC channels', () => eq('escChannels', statusOf({ ...good, frame: 'frame-x8' }, 'escChannels')[0], 'warn'));
test('X8 coaxial: 8 motors, coax thrust loss applied', () => {
  const s = sumOf({ ...good, frame: 'frame-x8', prop: 'prop-7040', motor: 'motor-2806', battery: 'bat-6s2p' });
  eq('motors', s.motors, 8);
  const flat = analyzePower(db.byId['motor-2806'], db.byId['prop-7040'], db.byId['bat-6s2p'], { motors: 8, auwG: s.auwG });
  within('coax/flat', s.perf.maxThrust / flat.maxThrust, 0.8, 0.9);
});
test('OpenIPC with HDZero goggles is yellow (needs ground station)', () => eq('videoGoggles', statusOf({ ...good, vtx: 'vtx-openipc', goggles: 'goggles-hdz' }, 'videoGoggles')[0], 'warn'));
test('OpenIPC with DJI goggles is red', () => eq('videoGoggles', statusOf({ ...good, vtx: 'vtx-openipc', goggles: 'goggles-dji3' }, 'videoGoggles')[0], 'bad'));
test('Heavy sag gives a self-consistent operating point (V = Voc − I·R)', () => {
  const tiny = { specs: { cells: 6, capacity_mah: 300, c_rating: 20, chemistry: 'LiPo', connector: 'XT30' } };
  const p = analyzePower(db.byId['motor-2207'], db.byId['prop-51466'], tiny, { motors: 4, auwG: 600 });
  within('sag / (I·R)', p.sagV / (p.maxCurrent * p.battery.rPack), 0.98, 1.02);
  if (p.sagV < 5) throw new Error(`expected heavy sag, got ${p.sagV.toFixed(1)} V`);
});
test('A pack that collapses is flagged', () => {
  const tiny = { specs: { cells: 6, capacity_mah: 150, c_rating: 20, chemistry: 'LiPo', connector: 'PH2.0' } };
  const p = analyzePower(db.byId['motor-2806'], db.byId['prop-7040'], tiny, { motors: 4, auwG: 600 });
  if (!p.sagLimited) throw new Error(`expected sagLimited, pack at ${(p.battery.vFull - p.sagV).toFixed(1)} V of ${p.battery.vFull} V`);
});
test('Closed-form current-at-thrust matches the throttle solve', () => {
  const mp = motorParams(db.byId['motor-2207']), pc = propCoeffs(db.byId['prop-51466']);
  const p = motorPoint(mp, pc, 1.2, 0.5, 24);
  const c = currentAtThrust(mp, pc, 1.2, p.thrust, 24);
  within('current ratio', c.iBatt / p.iBatt, 0.98, 1.02);
  within('duty', c.duty, 0.48, 0.52);
});

test('Two packs in series: double voltage, double battery weight', () => {
  const opts = { ...DEFAULT_OPTIONS, seriesPacks: 2 };
  const s = summarize(good, db, opts);
  const one = sumOf(good);
  within('battery weight delta', s.auwG - one.auwG, 214.9, 215.1);
  eq('effective cells', s.battery.specs.cells, 12);
  eq('motorVoltage', runChecks(good, db, opts).find((c) => c.id === 'motorVoltage').status, 'bad');
  const x = analyzePower(db.byId['motor-4214'], db.byId['prop-1344'], s.battery, { motors: 4, auwG: 3000 });
  const y = analyzePower(db.byId['motor-4214'], db.byId['prop-1344'], db.byId['bat-6s1300'], { motors: 4, auwG: 3000 });
  if (!(x.maxThrust > y.maxThrust * 1.5)) throw new Error('12S should make far more thrust than 6S on a 400KV motor');
});

test('6S pack on a VTX rated to exactly 25.2V runs direct (no float error)', () => {
  const extra = buildDB({ version: 't', parts: [...parts,
    { id: 'vtx-gt', category: 'vtx', brand: 'Walksnail', name: 'GT', classes: ['p5'], weight_g: 30, specs: { system: 'walksnail', includes_camera: true, camera_width_mm: 19, input_v: [11.1, 25.2], power_mw: 2000, mount: '20x20', needs_uart: true } },
    { id: 'vtx-hdz-whoop', category: 'vtx', brand: 'HDZero', name: 'Whoop Lite', classes: ['p3'], weight_g: 4, specs: { system: 'hdzero', includes_camera: false, input_v: [3, 12.6], power_mw: 200, mount: '20x20', needs_uart: true } }] });
  const st = runChecks({ ...good, vtx: 'vtx-gt' }, extra, DEFAULT_OPTIONS).find((c) => c.id === 'vtxPower').status;
  eq('6S GT', st, 'ok');
  const b3 = B({ classId: 'p3', battery: 'bat-3s', elec: 'aio', aio: 'aio-nobec', vtx: 'vtx-hdz-whoop' });
  const s3 = runChecks(b3, extra, DEFAULT_OPTIONS).find((c) => c.id === 'vtxPower').status;
  if (s3 === 'bad') throw new Error('3S on a 12.6V VTX should not be red');
});
test('classId "constructor" / "__proto__" falls back to 5"', () => {
  for (const id of ['constructor', '__proto__', 'toString']) eq(id, sanitizeBuild({ classId: id }).classId, 'p5');
});
test('A TX module can\'t host another module: mismatch is red', () => {
  const extra = buildDB({ version: 't', parts: [...parts,
    { id: 'radio-xf-module', category: 'radio', brand: 'TBS', name: 'Crossfire Micro TX', classes: [], weight_g: 50, specs: { kind: 'module', protocols: ['crossfire'], module_bay: 'JR', form: 'compact' } }] });
  eq('rcLink', runChecks({ ...good, radio: 'radio-xf-module' }, extra, DEFAULT_OPTIONS).find((c) => c.id === 'rcLink').status, 'bad');
});
test('Part-throttle tests scale hover current, not full throttle', () => {
  const mp = motorParams(db.byId['motor-2207']), pc = propCoeffs(db.byId['prop-51466']);
  const modelI = currentAtThrust(mp, pc, 1.204, 500, 24).iBatt;
  const m = { ...db.byId['motor-2207'], specs: { ...db.byId['motor-2207'].specs, thrust_tests: [
    { diameter_in: 5.1, pitch_in: 4.66, blades: 3, voltage: 24, throttle_pct: 50, thrust_g: 500, current_a: modelI * 1.5 },
  ] } };
  const base = analyzePower(db.byId['motor-2207'], db.byId['prop-51466'], db.byId['bat-6s1300'], { motors: 4, auwG: 650 });
  const cal = analyzePower(m, db.byId['prop-51466'], db.byId['bat-6s1300'], { motors: 4, auwG: 650 });
  if (!(cal.measured?.pi > 1.2)) throw new Error(`expected a part-throttle factor > 1.2, got ${cal.measured?.pi}`);
  within('max thrust unchanged', cal.maxThrust / base.maxThrust, 0.999, 1.001);
  if (!(cal.hover.current > base.hover.current * 1.15)) throw new Error('hover current should rise');
});

// ---- pricing ----------------------------------------------------------------
test('CW-only and CCW-only listings are paired, never used alone', () => {
  const opts = purchaseOptions(db.byId['prop-cw-ccw'], 4);
  if (opts.some((o) => o.store === 'newbee')) throw new Error('NewBee CCW-only offer used as a full set');
  const g = opts.find((o) => o.store === 'getfpv');
  if (!g?.pair) throw new Error('GetFPV CW+CCW not paired');
  within('pair cost', g.cost, 2 * 3.5 + 2 * 3.6 - 0.001, 2 * 3.5 + 2 * 3.6 + 0.001);
  eq('pair availability', g.available, false);
  eq('best store', bestOffer(db.byId['prop-cw-ccw'], 4).store, 'rdq');
});
test('Per-store totals prefer in-stock and flag out-of-stock', () => {
  const p = db.byId['motor-oos'];
  const choices = purchaseOptions(p, 4);
  const t = costTotals([{ part: p, units: 4, choices, best: bestOffer(p, 4), offers: p.offers }]);
  within('best mix', t.best, 99.95, 99.97);
  eq('newbee oos', t.stores.newbee.oos, 1);
});

// ---- state sanitizing ---------------------------------------------------------
test('Share-link options are sanitized (no markup survives)', () => {
  const o = sanitizeOptions({ batteries: '1"><img src=x onerror=alert(1)>', miscG: '<b>', style: 'x', tempC: 'NaN', includeGround: 'yes' });
  eq('batteries', o.batteries, 1); eq('miscG', o.miscG, null); eq('style', o.style, null); eq('tempC', o.tempC, 15); eq('includeGround', o.includeGround, false);
});
test('Unknown class / ids / __proto__ are dropped', () => {
  const b = sanitizeBuild({ classId: 'p12', elec: 'weird', frame: '__proto__', motor: 'motor-2207', prop: 'frame-5' }, db);
  eq('classId', b.classId, 'p5'); eq('elec', b.elec, 'stack'); eq('frame', b.frame, null); eq('motor', b.motor, 'motor-2207'); eq('prop', b.prop, null);
});

// ---- model vs real manufacturer data -------------------------------------
async function realDataCheck() {
  let rows;
  try { rows = await (await fetch('../data/reference/thrust_tests.json')).json(); } catch { return; }
  const groups = {};
  for (const r of rows) {
    if (!(r.kv > 0 && r.voltage > 0 && r.thrust_g > 0 && r.diameter_in > 0 && r.pitch_in > 0 && r.current_a > 0)) continue;
    if ((r.throttle_pct ?? 100) < 95) continue;
    const mp = motorParams({ specs: r }), pc = propCoeffs({ specs: { diameter_in: r.diameter_in, pitch_in: r.pitch_in, blades: r.blades || 2 } });
    const p = motorPoint(mp, pc, 1.204, (r.throttle_pct ?? 100) / 100, r.voltage);
    const d = r.stator_d_mm;
    const g = d <= 8 ? 'whoop' : d <= 14 ? 'micro' : d <= 20 ? '3-4in' : d <= 24 ? '5in' : d <= 30 ? '6-7in' : 'large';
    (groups[g] ||= []).push(r.thrust_g / p.thrust);
  }
  for (const [g, ratios] of Object.entries(groups)) {
    test(`Full-throttle thrust vs manufacturer data, ${g} (median within ±20%)`, () => {
      const s = [...ratios].sort((a, b) => a - b), med = s[Math.floor(s.length / 2)];
      within(`median measured/model (n=${s.length})`, med, 0.8, 1.2);
    });
  }
}
await realDataCheck();

// ---- report ------------------------------------------------------------
const out = document.getElementById('out');
const failed = results.filter((r) => !r.ok);
out.innerHTML = `<h1>${failed.length ? `${failed.length} failing` : 'All passing'} (${results.length} tests)</h1>
<ul>${results.map((r) => `<li class="${r.ok ? 'pass' : 'fail'}">${r.ok ? 'PASS' : 'FAIL'} — ${r.name}${r.ok ? '' : `<br><code>${r.msg}</code>`}</li>`).join('')}</ul>`;
window.__results = results;
