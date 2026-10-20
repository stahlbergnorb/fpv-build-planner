// Small rendering helpers shared by the views.

import { VIDEO_LABELS, RC_LABELS, STORES } from '../classes.js';
import { fmtIn } from '../compat.js';

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);

// Only allow http(s) links from data files into href attributes.
export const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? esc(u) : '#');

export const money = (x) => (typeof x === 'number' ? `$${x.toFixed(2)}` : '—');
export const grams = (g) => (g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${g < 10 ? g.toFixed(1) : Math.round(g)} g`);
export const pct = (x) => `${Math.round(x * 100)}%`;
export const mins = (m) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${m.toFixed(1)} min`);
export const ratio = (x) => `${x.toFixed(1)}:1`;
export const amps = (a) => `${a < 10 ? a.toFixed(1) : Math.round(a)} A`;

export const STATUS_TEXT = { ok: 'Compatible', warn: 'Caveats', bad: 'Incompatible', info: 'Note' };
const ICON = { ok: '✓', warn: '!', bad: '✕', info: 'i' };

export function badge(status, label) {
  return `<span class="badge s-${status}" title="${esc(STATUS_TEXT[status])}"><span class="ico" aria-hidden="true">${ICON[status]}</span>${label ? esc(label) : ''}</span>`;
}

export function dot(status) {
  return `<span class="dot s-${status}" role="img" aria-label="${esc(STATUS_TEXT[status])}">${ICON[status]}</span>`;
}

export function storeName(id) { return STORES[id]?.name || id; }

export function partTitle(p) { return `${esc(p.brand)} ${esc(p.name)}`; }

export function specLine(p) {
  const s = p.specs || {};
  const j = (...xs) => xs.filter(Boolean).join(' · ');
  switch (p.category) {
    case 'frame': return j(`${fmtIn(s.prop_max_in)} props`, s.wheelbase_mm && `${s.wheelbase_mm}mm`, s.style, s.ducted && 'ducted', (s.stack_mount || []).join('/'));
    case 'motor': return j(s.stator, s.kv && `${s.kv}KV`, s.cells_min && `${s.cells_min}–${s.cells_max}S`, (s.mount || []).join('/'), s.shaft);
    case 'prop': return j(`${fmtIn(s.diameter_in)} × ${s.pitch_in} × ${s.blades}-blade`, s.hub, s.style);
    case 'fc': return j(s.mcu, s.mount, s.uarts != null && `${s.uarts} UARTs`, s.gyro, s.osd === 'analog' && 'OSD');
    case 'esc': return j(s.cont_a && `${s.cont_a}A${s.burst_a ? ` (${s.burst_a}A burst)` : ''}`, `${s.cells_min}–${s.cells_max}S`, s.type === 'single' ? 'single' : s.mount, s.firmware);
    case 'aio': return j(s.mcu, s.esc_cont_a && `${s.esc_cont_a}A`, `${s.cells_min}–${s.cells_max}S`, s.mount, s.rx_builtin ? (RC_LABELS[s.rx_builtin] || s.rx_builtin) : 'no RX', s.vtx_builtin || null);
    case 'stack': return j(s.fc?.mcu, s.esc?.cont_a && `${s.esc.cont_a}A ESC`, s.fc?.mount, s.esc?.firmware);
    case 'battery': return j(`${s.cells}S ${s.capacity_mah}mAh`, s.c_rating && `${s.c_rating}C`, s.chemistry, s.connector, s.config && s.config !== `${s.cells}S1P` && s.config);
    case 'camera': return j(VIDEO_LABELS[s.system], s.width_mm && `${s.width_mm}mm`, s.resolution);
    case 'vtx': return j(VIDEO_LABELS[s.system], s.power_mw && `${s.power_mw}mW`, s.input_v && `${s.input_v[0]}–${s.input_v[1]}V`, s.includes_camera && 'camera included', s.records && `records ${s.records}`);
    case 'receiver': return j(RC_LABELS[s.protocol] || s.protocol, s.diversity && s.diversity !== 'none' && `${s.diversity} diversity`, s.interface);
    case 'radio': return j(s.kind, (s.protocols || []).map((x) => RC_LABELS[x] || x).join(', '), s.module_bay && s.module_bay !== 'none' && (s.kind === 'module' ? `${s.module_bay} size` : `${s.module_bay} bay`));
    case 'goggles': return j((s.systems || []).map((x) => VIDEO_LABELS[x] || x).join(', '), (s.systems_via_module || []).length && `+ ${(s.systems_via_module).map((x) => VIDEO_LABELS[x] || x).join(', ')} via module`);
    case 'gps': return j(s.chip, s.compass ? 'compass' : 'no compass');
    case 'payload': return j(s.records, s.mount);
    default: return '';
  }
}

// Human-readable spec table rows for the detail view.
export function specRows(p) {
  const rows = [];
  const fmt = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)).join(', ') : typeof v === 'object' && v !== null ? null : String(v));
  for (const [k, v] of Object.entries(p.specs || {})) {
    if (k === 'thrust_tests' || v == null || v === '') continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) {
        const f = fmt(v2);
        if (f != null && k2 !== 'thrust_tests') rows.push([`${k}.${k2}`, f]);
      }
      continue;
    }
    const f = fmt(v);
    if (f != null) rows.push([k.replace(/_/g, ' '), f]);
  }
  return rows;
}

export function toast(msg, ms = 3200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, ms);
}
