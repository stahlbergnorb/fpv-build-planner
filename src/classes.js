// Build classes, labels for tokens, and per-class defaults.

// misc = wiring, screws, standoffs, straps, capacitor, antennas, TPU (grams);
// tw = typical minimum thrust-to-weight. Both from data/reference/compat_facts.json.
export const CLASSES = [
  { id: 'w65', label: '65mm Tiny Whoop', short: '65mm', props: '31mm', cells: [1, 1], misc: 2, tw: 2.5, style: 'cruise' },
  { id: 'w75', label: '75mm Whoop', short: '75mm', props: '40mm', cells: [1, 2], misc: 3, tw: 2.5, style: 'cruise' },
  { id: 'p2', label: '2" Micro / 85mm Whoop', short: '2"', props: '45–51mm', cells: [1, 3], misc: 5, tw: 3.5, style: 'freestyle' },
  { id: 'p25', label: '2.5" Toothpick / Cinewhoop', short: '2.5"', props: '2.5"', cells: [2, 4], misc: 8, tw: 3, style: 'freestyle' },
  { id: 'p3', label: '3" Freestyle / Cinewhoop', short: '3"', props: '3"', cells: [3, 6], misc: 11, tw: 4, style: 'freestyle' },
  { id: 'p35', label: '3.5" Freestyle / Cinewhoop', short: '3.5"', props: '3.5"', cells: [4, 6], misc: 15, tw: 3, style: 'freestyle' },
  { id: 'p4', label: '4" Lightweight Long Range', short: '4"', props: '4"', cells: [4, 6], misc: 15, tw: 3.5, style: 'cruise' },
  { id: 'p5', label: '5" Freestyle / Race', short: '5"', props: '5–5.1"', cells: [4, 6], misc: 25, tw: 6, style: 'freestyle' },
  { id: 'p6', label: '6" Freestyle / Long Range', short: '6"', props: '6"', cells: [6, 6], misc: 28, tw: 5, style: 'freestyle' },
  { id: 'p7', label: '7" Long Range', short: '7"', props: '7"', cells: [6, 6], misc: 35, tw: 4, style: 'cruise' },
  { id: 'p8', label: '8" Long Range / Cine', short: '8"', props: '8"', cells: [6, 6], misc: 42, tw: 3, style: 'cruise' },
  { id: 'p10', label: '10" Long Range / Cinelifter', short: '10"', props: '9–10"', cells: [6, 8], misc: 55, tw: 3, style: 'cruise' },
  { id: 'p13', label: '13" Heavy Lift / X-Class', short: '13"', props: '13"', cells: [6, 12], misc: 85, tw: 2.5, style: 'cruise' },
  { id: 'p15', label: '15" X-Class', short: '15"', props: '15"', cells: [8, 12], misc: 100, tw: 4, style: 'freestyle' },
];

// Null prototype so lookups like CLASS_BY_ID['constructor'] are undefined.
export const CLASS_BY_ID = Object.assign(Object.create(null), Object.fromEntries(CLASSES.map((c) => [c.id, c])));

// Thrust-to-weight the frame style is designed around (overrides class default).
export const STYLE_TW = {
  whoop: 2.2, cinewhoop: 3, toothpick: 4, freestyle: 5, race: 7,
  'long-range': 3, cinelifter: 2.2, 'x-class': 5,
};
// Below this, a quad has no real control margin.
export const TW_MIN = 1.6;

export const CATEGORY_LABELS = {
  frame: 'Frame', motor: 'Motors', prop: 'Props', fc: 'Flight controller', esc: 'ESC',
  aio: 'AIO board', stack: 'Stack (FC + ESC)', battery: 'Battery', camera: 'Camera',
  vtx: 'Video transmitter', receiver: 'Receiver', radio: 'Radio / module', goggles: 'Goggles',
  gps: 'GPS', payload: 'Payload / action cam',
};

export const VIDEO_LABELS = {
  analog: 'Analog', hdzero: 'HDZero', 'dji-o4': 'DJI O4', 'dji-o4-pro': 'DJI O4 Pro',
  'dji-o3': 'DJI O3', 'dji-v1': 'DJI FPV (Vista/Air Unit)', walksnail: 'Walksnail Avatar', openipc: 'OpenIPC',
};

export const RC_LABELS = {
  'elrs-2.4': 'ExpressLRS 2.4GHz', 'elrs-900': 'ExpressLRS 900MHz', 'elrs-dual': 'ExpressLRS Gemini Xrossband',
  crossfire: 'TBS Crossfire', tracer: 'TBS Tracer', ghost: 'ImmersionRC Ghost', 'frsky-access': 'FrSky ACCESS',
  'frsky-accst': 'FrSky ACCST D16', 'frsky-d8': 'FrSky D8', 'flysky-afhds2a': 'FlySky AFHDS 2A',
  'flysky-afhds3': 'FlySky AFHDS 3', 'spektrum-dsmx': 'Spektrum DSMX', 'dji-rc': 'DJI FPV Remote Controller',
};

export const STORES = {
  rdq: { name: 'RaceDayQuads', base: 'https://www.racedayquads.com', shopify: true, search: 'https://www.racedayquads.com/search?q=' },
  getfpv: { name: 'GetFPV', base: 'https://www.getfpv.com', shopify: false, search: 'https://www.getfpv.com/catalogsearch/result/?q=' },
  newbee: { name: 'NewBeeDrone', base: 'https://www.newbeedrone.com', shopify: true, search: 'https://www.newbeedrone.com/search?q=' },
  five33: { name: 'FlyFive33', base: 'https://www.flyfive33.com', shopify: true, search: 'https://www.flyfive33.com/search?q=' },
};

// Electrical draw of always-on electronics (W) when the VTX doesn't publish one.
export function vtxDrawW(vtx) {
  const s = vtx?.specs;
  if (!s) return 0;
  if (s.power_draw_w) return s.power_draw_w;
  const mw = s.power_mw || 200;
  if (s.system === 'analog') return 1 + mw / 120;
  return s.system === 'hdzero' ? 3 + mw / 250 : 4 + mw / 300;
}
