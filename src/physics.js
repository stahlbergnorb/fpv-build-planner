// Performance model: brushless motor + propeller + battery.
//
// Propeller: static thrust T = Ct·ρ·n²·D⁴ and shaft power P = Cp·ρ·n³·D⁵
// (n in rev/s, D in m). Ct/Cp come from pitch/diameter ratio, blade count and
// size. Motor: DC model with back-EMF (RPM/Kv), winding resistance Rm and
// no-load current I0. The ESC is treated as an ideal buck converter, so at
// throttle τ the motor sees τ·Vbatt and the battery supplies τ·Imotor.
// Battery: open-circuit voltage minus I·Rpack, solved for the self-consistent
// operating point.
//
// MODEL constants are fitted to published manufacturer thrust tables with
// tools/calibrate.html (data/reference/thrust_tests.json). Everything this
// produces is an estimate and the UI labels it as such.

export const G = 9.80665;

// Fitted 2026-10-19 to 779 published test points (164 full-throttle, 615
// part-throttle) from 65mm whoop motors to 15" X-Class. Median error after
// fitting: full-throttle thrust within ~5–15%, hover current within ~2–13%
// per size group; cross-validated loss 0.086 vs 0.083 in-sample.
export const MODEL = {
  // propeller coefficients
  ct0: 0.1416, ctPd: 0.3453, ctBlade: 1.344, ctSize: -0.356,
  cp0: 0.08825, cpPd: 0.7178, cpBlade: 1.842, cpSize: -0.7631,
  // motor constant (N·m/√W) for a 2207-sized stator, scaled by stator volume
  km0: 0.01401, kmExp: 0.8737, kmExpBig: 0.805,
  i0k: 0.04102,
  kvEff: 0.8498, // loaded Kv relative to the rated Kv
  rmScale: 2.036, // multiplier on published winding resistance
  escR: 0.004, // ESC FETs + wiring, ohms
};

const STATOR_REF_VOL = Math.PI * 11 * 11 * 7; // 2207, mm³
const BENCH_RHO = 1.204; // 20 °C sea level, as manufacturer tests are run
const COAX_FACTOR = 0.85; // lower prop of a coaxial pair works in the upper's wash

// Battery chemistry behaviour (per cell).
export const CHEM = {
  LiPo: { vFull: 4.0, vMid: 3.75, usable: 0.8, rK: 6500 },
  LiHV: { vFull: 4.1, vMid: 3.82, usable: 0.8, rK: 6500 },
  'Li-ion': { vFull: 3.95, vMid: 3.55, usable: 0.85, rK: 60000 },
};
// Typical connector + lead resistance, ohms.
const CONNECTOR_R = { 'PH2.0': 0.018, 'BT2.0': 0.008, A30: 0.004, GNB27: 0.006, XT30: 0.0015, XT60: 0.001, XT90: 0.0008, AS150: 0.0005, solder: 0.0005 };

// Average current above hover, as a fraction of (max − hover), per flying style.
export const STYLE_LOAD = { hover: 0, cinematic: 0.02, cruise: 0.035, freestyle: 0.1, race: 0.18 };

export function airDensity(altitudeM = 0, tempC = 15) {
  const p = 101325 * Math.pow(1 - 2.25577e-5 * altitudeM, 5.25588);
  return p / (287.05 * (tempC + 273.15));
}

export function propCoeffs(prop, m = MODEL) {
  const s = prop.specs || prop;
  const D = s.diameter_in, P = s.pitch_in, B = s.blades || 2;
  const pd = Math.min(1.6, Math.max(0.2, P / D));
  return {
    ct: m.ct0 * pd ** m.ctPd * (B / 2) ** m.ctBlade * (D / 5) ** m.ctSize,
    cp: m.cp0 * pd ** m.cpPd * (B / 2) ** m.cpBlade * (D / 5) ** m.cpSize,
    D: D * 0.0254,
  };
}

export function statorVolume(s) {
  let d = s.stator_d_mm, h = s.stator_h_mm;
  if ((!d || !h) && s.stator) {
    const digits = String(s.stator).replace(/[^\d.]/g, '');
    d = d || parseFloat(digits.slice(0, 2));
    h = h || parseFloat(digits.slice(2)) || 5;
  }
  return Math.PI * (d / 2) ** 2 * h;
}

export function motorParams(motor, m = MODEL) {
  const s = motor.specs || motor;
  const kv = s.kv * (m.kvEff ?? 1);
  const vol = statorVolume(s);
  const kt = 60 / (2 * Math.PI * kv);
  let rm = s.rm_mohm ? (s.rm_mohm / 1000) * (m.rmScale ?? 1) : null;
  const estimatedRm = !rm;
  if (!rm) {
    const r = vol / STATOR_REF_VOL;
    const km = m.km0 * r ** (r > 1 ? (m.kmExpBig ?? m.kmExp) : m.kmExp);
    rm = (kt * kt) / (km * km);
  }
  const i0 = s.io_a ?? m.i0k * Math.sqrt((s.kv * vol) / 1e5);
  return { kv, kt, rm, i0, vol, estimatedRm };
}

export function batteryParams(battery) {
  const s = battery.specs || battery;
  const chem = CHEM[s.chemistry] || CHEM.LiPo;
  const parallel = parseInt(String(s.config || '').match(/(\d+)P/i)?.[1] || '1', 10) || 1;
  const cellMah = s.capacity_mah / parallel;
  const rCell = chem.rK / cellMah / 1000;
  const rPack = (s.cells * rCell) / parallel + (CONNECTOR_R[s.connector] ?? 0.002);
  // Rounded so e.g. 6 × 4.2 is exactly 25.2 V (not 25.200000000000003) when
  // compared with a VTX's published limit.
  const r2 = (x) => Math.round(x * 100) / 100;
  return {
    cells: s.cells,
    capacityAh: s.capacity_mah / 1000,
    vFull: r2(s.cells * chem.vFull),
    vMid: r2(s.cells * chem.vMid),
    vMax: r2(s.cells * (s.chemistry === 'LiHV' ? 4.35 : 4.2)),
    usable: chem.usable,
    rPack,
    maxContA: s.c_rating ? (s.capacity_mah / 1000) * s.c_rating : null,
    energyWh: (s.capacity_mah / 1000) * s.cells * (s.chemistry === 'Li-ion' ? 3.6 : 3.7),
  };
}

// Steady-state RPM where motor torque equals prop torque at terminal voltage vm.
function solveRpm(mp, pc, rho, vm, rTot) {
  if (vm <= 0) return 0;
  const k = (pc.cp * rho * pc.D ** 5) / (2 * Math.PI * 3600);
  const f = (rpm) => mp.kt * ((vm - rpm / mp.kv) / rTot - mp.i0) - k * rpm * rpm;
  if (f(0) <= 0) return 0;
  let lo = 0, hi = mp.kv * vm;
  for (let i = 0; i < 46; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// One motor at throttle τ with supply voltage vb.
export function motorPoint(mp, pc, rho, throttle, vb, m = MODEL) {
  const rTot = mp.rm + m.escR;
  const vm = throttle * vb;
  const rpm = solveRpm(mp, pc, rho, vm, rTot);
  const n = rpm / 60;
  const thrustN = pc.ct * rho * n * n * pc.D ** 4;
  const iMotor = Math.max(0, (vm - rpm / mp.kv) / rTot);
  return { rpm, thrust: (thrustN / G) * 1000, iMotor, iBatt: throttle * iMotor };
}

// Closed form: supply current (and duty) needed for a given thrust at supply
// voltage vb. Returns null if the motor can't reach that thrust.
export function currentAtThrust(mp, pc, rho, thrustG, vb, m = MODEL) {
  const n = Math.sqrt(((thrustG / 1000) * G) / (pc.ct * rho * pc.D ** 4));
  const q = (pc.cp * rho * n * n * pc.D ** 5) / (2 * Math.PI);
  const iMotor = q / mp.kt + mp.i0;
  const vm = (n * 60) / mp.kv + iMotor * (mp.rm + m.escR);
  const duty = vm / vb;
  if (!(duty <= 1)) return null;
  return { iBatt: duty * iMotor, iMotor, duty, rpm: n * 60 };
}

// Whole quad at throttle τ: find the battery voltage where the pack's sag
// matches the current drawn (monotone in voltage, so bisection always works).
export function systemPoint(sys, throttle, vOc) {
  const { mp, pc, rho, motors, rPack, auxW, coax } = sys;
  // Full-throttle test factors near full throttle, part-throttle factors
  // around hover, blended smoothly in between.
  const w = Math.min(1, Math.max(0, (throttle - 0.6) / 0.4));
  const ct = sys.corr.pt + (sys.corr.t - sys.corr.pt) * w;
  const ci = sys.corr.pi + (sys.corr.i - sys.corr.pi) * w;
  const draw = (vb) => {
    const p = motorPoint(mp, pc, rho, throttle, vb);
    return { p, iTotal: motors * p.iBatt * ci + auxW / Math.max(vb, 0.5) };
  };
  let lo = vOc * 0.05, hi = vOc, best = draw(vOc);
  if (vOc - best.iTotal * rPack < vOc - 1e-6) {
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      const d = draw(mid);
      if (vOc - d.iTotal * rPack > mid) lo = mid; else hi = mid;
    }
    best = draw((lo + hi) / 2);
  }
  const vb = Math.min(vOc, vOc - best.iTotal * rPack);
  const thrustPerMotor = best.p.thrust * ct * coax;
  return {
    throttle,
    rpm: best.p.rpm,
    thrustPerMotor,
    thrust: thrustPerMotor * motors,
    iMotor: best.p.iMotor * ci,
    current: best.iTotal,
    vBatt: vb,
    power: best.iTotal * vb,
    sagLimited: vb < vOc * 0.5,
  };
}

// Pick the manufacturer test that matches this prop + voltage, if any, and
// return correction factors (measured / modelled at bench conditions).
// Returns { t, i } for full throttle plus { pi } (current factor around
// hover, from the same prop's part-throttle rows; thrust there is left to the
// model, which is fitted on current-at-thrust).
export function testCorrection(motor, prop, voltage) {
  const tests = motor.specs?.thrust_tests || [];
  const ps = prop.specs;
  const sameProp = tests.filter((t) =>
    Math.abs(t.diameter_in - ps.diameter_in) <= 0.15 &&
    Math.abs(t.pitch_in - ps.pitch_in) <= 0.35 &&
    (t.blades || 2) === (ps.blades || 2) &&
    t.thrust_g > 0 && Math.abs(t.voltage - voltage) / voltage <= 0.2);
  const full = sameProp.filter((t) => (t.throttle_pct ?? 100) >= 90);
  const part = sameProp.filter((t) => (t.throttle_pct ?? 100) >= 30 && (t.throttle_pct ?? 100) < 90 && t.current_a > 0);
  if (!full.length && !part.length) return null;
  const mp = motorParams(motor), pc = propCoeffs(prop);
  const ok = (x) => Number.isFinite(x) && x >= 0.3 && x <= 2.5;

  const partRatios = part.map((t) => {
    const c = currentAtThrust(mp, pc, BENCH_RHO, t.thrust_g, t.voltage);
    return c ? t.current_a / c.iBatt : NaN;
  }).filter(ok).sort((a, b) => a - b);
  const pi = partRatios.length ? partRatios[Math.floor(partRatios.length / 2)] : 1;

  if (!full.length) return { t: 1, i: 1, pi, partOnly: true, test: part[0] };
  const t = full.sort((a, b) => Math.abs(a.voltage - voltage) - Math.abs(b.voltage - voltage))[0];
  const p = motorPoint(mp, pc, BENCH_RHO, (t.throttle_pct ?? 100) / 100, t.voltage);
  if (!p.thrust) return null;
  const ft = t.thrust_g / p.thrust;
  const fi = t.current_a ? t.current_a / p.iMotor : 1;
  // A full-throttle row drawing far more current per gram than the same prop
  // at 70–85% is most likely a data error, as are wildly inconsistent ratios.
  const near = part.filter((r) => r.throttle_pct >= 70 && r.voltage === t.voltage)
    .sort((a, b) => b.throttle_pct - a.throttle_pct)[0];
  const outlier = near && t.current_a && (t.current_a / t.thrust_g) > 1.6 * (near.current_a / near.thrust_g);
  if (outlier || !ok(ft) || !ok(fi)) return { ignored: true, test: t, t: 1, i: 1, pi };
  return { t: ft, i: fi, pi, test: t };
}

// Full analysis for a motor/prop/battery set and an all-up weight.
// opts: { motors, auwG, auxW, altitude, tempC, coaxial, lite }
export function analyzePower(motor, prop, battery, opts) {
  const rho = airDensity(opts.altitude || 0, opts.tempC ?? 15);
  const mp = motorParams(motor);
  const pc = propCoeffs(prop);
  const bp = batteryParams(battery);
  const measured = testCorrection(motor, prop, bp.vFull);
  const sys = {
    mp, pc, rho,
    motors: opts.motors || 4,
    rPack: bp.rPack,
    auxW: opts.auxW || 0,
    corr: {
      t: measured && !measured.ignored ? measured.t : 1,
      i: measured && !measured.ignored ? measured.i : 1,
      pt: 1,
      pi: measured?.pi ?? 1,
    },
    coax: opts.coaxial ? COAX_FACTOR : 1,
  };

  const full = systemPoint(sys, 1, bp.vFull);
  const fullMid = systemPoint(sys, 1, bp.vMid);
  const auw = opts.auwG;

  // Hover throttle by bisection at mid-pack voltage.
  let hover = null;
  if (fullMid.thrust > auw) {
    let lo = 0, hi = 1;
    for (let i = 0; i < (opts.lite ? 14 : 30); i++) {
      const mid = (lo + hi) / 2;
      if (systemPoint(sys, mid, bp.vMid).thrust > auw) hi = mid; else lo = mid;
    }
    hover = systemPoint(sys, hi, bp.vMid);
  }

  const usableAh = bp.capacityAh * bp.usable;
  const flight = {};
  for (const [style, k] of Object.entries(STYLE_LOAD)) {
    if (!hover) { flight[style] = null; continue; }
    const avg = hover.current + k * (fullMid.current - hover.current);
    flight[style] = (usableAh / avg) * 60;
  }

  const curve = [];
  for (let i = 0; i <= 20 && !opts.lite; i++) {
    const p = systemPoint(sys, i / 20, bp.vMid);
    curve.push({ throttle: i / 20, thrust: p.thrust, current: p.current });
  }

  const tipMach = (Math.PI * pc.D * (full.rpm / 60)) / 343;
  const rotors = opts.coaxial ? sys.motors / 2 : sys.motors;
  const diskArea = rotors * Math.PI * (pc.D / 2) ** 2; // m²

  return {
    rho,
    motor: mp,
    battery: bp,
    measured,
    maxThrust: full.thrust,
    maxThrustPerMotor: full.thrustPerMotor,
    maxCurrent: full.current,
    maxMotorCurrent: full.iMotor,
    maxPower: full.power,
    maxRpm: full.rpm,
    sagV: bp.vFull - full.vBatt,
    sagLimited: full.sagLimited,
    tw: full.thrust / auw,
    hover: hover && {
      throttle: hover.throttle,
      current: hover.current,
      power: hover.power,
      perMotor: hover.thrustPerMotor,
      efficiency: auw / Math.max(hover.power, 0.01), // g/W
    },
    flight,
    curve,
    tipMach,
    diskLoading: auw / (diskArea * 1e4), // g/cm²
    payloadAt: (tw) => Math.max(0, full.thrust / tw - auw),
  };
}
