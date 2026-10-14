// Procedural SVG landscape for a moment: sky by time of day, weather on top,
// hills with season-colored trees and a small cabin. The scene is drawn at the
// container's aspect ratio so nothing important gets cropped. Animations are
// CSS (see .scene rules in styles.css) and switch off under reduced motion.

const H = 220;
const BASE_W = 400; // layout below is authored at 400 wide, then stretched
let uid = 0;

// Every color the scene draws, per theme: 'default' is Scentcast's own look,
// 'gruvbox' the same landscape in morhetz's gruvbox (src/theme.js).
const PALETTES = {
  default: {
    sky: {
      dawn: ['#2c3e74', '#d9837f', '#ffd3a1'],
      day: ['#3a8ad3', '#79bdee', '#cde8fb'],
      dusk: ['#1d2257', '#a8497a', '#f39a62'],
      night: ['#060a1c', '#101838', '#1f2c57'],
    },
    hills: {
      dawn: ['#6d5b80', '#4a3f63', '#2b253f'],
      day: ['#86b870', '#5c9552', '#3c6e3a'],
      dusk: ['#5b3f67', '#3d2b4d', '#211830'],
      night: ['#1b2340', '#131a30', '#0a0e1d'],
    },
    foliage: {
      spring: ['#8fcf72', '#f4a9c6', '#b8e08f'],
      summer: ['#2f8a3e', '#3f9d4a', '#27713a'],
      fall: ['#e07a2c', '#c24a2c', '#e8b03c'],
      winter: ['#dfe7ef', '#c9d4df', '#eef3f8'],
    },
    // Where overcast weather pulls the sky (day by condition, night) and the hills.
    grayDay: { cloudy: '#9aa1ab', fog: '#b6bcc4', drizzle: '#8b929c', rain: '#7c838e', snow: '#b9c1cb', storm: '#50555f' },
    grayOther: '#8c96a4',
    grayNight: '#161a24',
    hillGray: '#56606c',
    snowHill: { day: '#eef2f7', night: '#8b97b0' },
    shade: { day: '#000000', dusk: '#140c24', night: '#05070f' },
    star: '#ffffff', moon: '#f5f0dc',
    sun: { day: '#fff6cf', warm: '#ffc07a' },
    sunGlow: { day: '#fff3b0', warm: '#ffb070', warmEdge: '#ff8a50' },
    windowGlow: '#ffcf73',
    cloud: { night: '#3a4258', storm: '#4f5663', wet: '#98a1ae', heavy: '#d3d9e1', day: '#ffffff', warm: '#f7c9b8' },
    rain: { day: '#dbe7f5', night: '#9fb2d6' },
    snow: '#ffffff',
    fog: { day: '#eef1f4', night: '#5a6275' },
    bolt: '#fff4b8', flash: '#ffffff',
    trunk: '#3b2a20', pine: { winter: '#2e5a45', other: '#24533a' }, treeSnow: '#f4f7fb',
    wall: '#8a5a3c', roof: '#5a2f2a', windowDark: '#2a3340', smoke: '#e9edf2',
  },
  gruvbox: {
    sky: {
      dawn: ['#3c3836', '#b16286', '#fabd2f'],
      day: ['#458588', '#83a598', '#bdae93'],
      dusk: ['#282828', '#8f3f71', '#d65d0e'],
      night: ['#1d2021', '#222526', '#2b2a29'],
    },
    hills: {
      dawn: ['#7c6f64', '#665c54', '#504945'],
      day: ['#98971a', '#79740e', '#427b58'],
      dusk: ['#665c54', '#504945', '#3c3836'],
      night: ['#45403d', '#3c3836', '#32302f'],
    },
    foliage: {
      spring: ['#b8bb26', '#d3869b', '#8ec07c'],
      summer: ['#79740e', '#98971a', '#427b58'],
      fall: ['#d65d0e', '#cc241d', '#d79921'],
      winter: ['#ebdbb2', '#d5c4a1', '#fbf1c7'],
    },
    grayDay: { cloudy: '#a89984', fog: '#bdae93', drizzle: '#928374', rain: '#7c6f64', snow: '#d5c4a1', storm: '#504945' },
    grayOther: '#928374',
    grayNight: '#1d2021',
    hillGray: '#665c54',
    snowHill: { day: '#ebdbb2', night: '#7c6f64' },
    shade: { day: '#1d2021', dusk: '#282828', night: '#1d2021' },
    star: '#fbf1c7', moon: '#fbf1c7',
    sun: { day: '#fbf1c7', warm: '#fe8019' },
    sunGlow: { day: '#fabd2f', warm: '#fe8019', warmEdge: '#d65d0e' },
    windowGlow: '#fabd2f',
    cloud: { night: '#504945', storm: '#665c54', wet: '#a89984', heavy: '#d5c4a1', day: '#fbf1c7', warm: '#ebdbb2' },
    rain: { day: '#d5c4a1', night: '#83a598' },
    snow: '#fbf1c7',
    fog: { day: '#ebdbb2', night: '#665c54' },
    bolt: '#fabd2f', flash: '#fbf1c7',
    trunk: '#3c3836', pine: { winter: '#689d6a', other: '#427b58' }, treeSnow: '#fbf1c7',
    wall: '#af3a03', roof: '#9d0006', windowDark: '#3c3836', smoke: '#d5c4a1',
  },
};
const palette = theme => PALETTES[theme] ?? PALETTES.default;

// How far each condition pulls the sky toward its gray, and how many clouds.
const GRAY = { clear: 0, partly: 0.08, cloudy: 0.72, fog: 0.7, drizzle: 0.72, rain: 0.8, snow: 0.6, storm: 0.85 };
const grayTarget = (P, phase, category) => (phase === 'night' ? P.grayNight : P.grayDay[category] ?? P.grayOther);
const CLOUDS = { clear: 0, partly: 3, cloudy: 7, fog: 2, drizzle: 6, rain: 7, snow: 6, storm: 7 };
const OVERCAST = new Set(['cloudy', 'drizzle', 'rain', 'snow', 'storm']);

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a, b, t) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const c = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hill = {
  far: x => 138 + 12 * Math.sin(x / 60 + 1) + 6 * Math.sin(x / 23),
  mid: x => 164 + 9 * Math.sin(x / 48 + 2.2) + 4 * Math.sin(x / 17 + 0.5),
  near: x => 191 + 6 * Math.sin(x / 70 + 0.3) + 3 * Math.sin(x / 29 + 1.7),
};

function hillPath(fn, W) {
  let d = `M0 ${fn(0).toFixed(1)}`;
  for (let x = 8; x < W + 8; x += 8) d += ` L${x} ${fn(x).toFixed(1)}`;
  return `${d} L${W + 8} ${H} L0 ${H} Z`;
}

function cloud(x, y, s, fill, opacity, drift, dur) {
  return `<g class="drift" style="--dx:${drift}px;animation-duration:${dur}s">
    <g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})" fill="${fill}" opacity="${opacity}">
      <ellipse cx="0" cy="10" rx="42" ry="13"/><circle cx="-18" cy="3" r="15"/>
      <circle cx="6" cy="-5" r="21"/><circle cx="28" cy="5" r="13"/>
    </g></g>`;
}

function tree(x, y, s, kind, color, snow, P) {
  const trunk = P.trunk;
  if (kind === 'pine') {
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s})">
      <rect x="-1.5" y="-4" width="3" height="6" fill="${trunk}"/>
      <path d="M0 -30 L11 -10 L5 -10 L13 -2 L-13 -2 L-5 -10 L-11 -10 Z" fill="${color}"/>
      ${snow ? `<path d="M0 -30 L5 -21 L-5 -21 Z M-5 -12 L5 -12 L7 -9 L-7 -9 Z" fill="${P.treeSnow}"/>` : ''}
    </g>`;
  }
  return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s})">
    <rect x="-1.5" y="-10" width="3" height="12" fill="${trunk}"/>
    <circle cx="0" cy="-16" r="10" fill="${color}"/><circle cx="-6" cy="-11" r="6.5" fill="${color}"/>
    <circle cx="6" cy="-11" r="6.5" fill="${color}"/>
  </g>`;
}

// Tree spots as fractions of the width, so wide scenes stay balanced.
const TREE_SPOTS = {
  mid: [[0.295, 0.55, 'pine'], [0.33, 0.62, 'round'], [0.515, 0.5, 'round'], [0.548, 0.58, 'pine'], [0.845, 0.52, 'round']],
  near: [[0.065, 1, 'pine'], [0.12, 0.85, 'round'], [0.175, 1.1, 'round'], [0.88, 0.9, 'round'], [0.94, 1.05, 'pine']],
};

// Trees keep this far (a fraction of the width) from the hero's bottle, off
// the hillside under the hero's temperature (its left FOOT_W), so the big
// numbers sit on open ground, and on wide scenes off the middle hill behind
// the bottle's name beside it (LABEL_W). On a band with no bottle, trees and
// the cabin keep off its `clear` share of the width by CLEAR_PAD (about half
// a tree).
const STAGE_CLEAR = 0.07;
const FOOT_W = 0.45;
const LABEL_W = 0.32;
const CLEAR_PAD = 0.03;

function trees(layer, W, season, shade, snowy, P, stage = null, clear = 0) {
  const pal = P.foliage[season].map(c => mix(c, shade.color, shade.t));
  const pine = mix(season === 'winter' ? P.pine.winter : P.pine.other, shade.color, shade.t);
  const label = stage !== null && layer === 'mid' && W / H >= CABIN_ROOM;
  return TREE_SPOTS[layer].map(([fx, s, kind], i) => {
    if (stage !== null && (Math.abs(fx - stage) < STAGE_CLEAR || fx < FOOT_W)) return '';
    if (fx - CLEAR_PAD < clear) return '';
    if (label && fx > stage && fx < stage + LABEL_W) return '';
    const x = fx * W;
    const bare = season === 'winter' && kind === 'round';
    const color = kind === 'pine' || bare ? pine : pal[i % pal.length];
    return tree(x, hill[layer](x) + 2, s, bare ? 'pine' : kind, color, snowy && (kind === 'pine' || bare), P);
  }).join('');
}

function cabin(x, phase, weatherDark, cold, shade, glowId, P) {
  const y = hill.near(x) + 3;
  const lit = phase === 'night' || phase === 'dusk' || weatherDark;
  const wall = mix(P.wall, shade.color, shade.t);
  const roof = mix(P.roof, shade.color, shade.t);
  const glow = lit ? P.windowGlow : mix(P.windowDark, shade.color, shade.t * 0.5);
  const smoke = cold
    ? `<g class="smoke" fill="${P.smoke}">${[0, 1, 2].map(i => `<circle cx="${(x + 9).toFixed(1)}" cy="${(y - 34).toFixed(1)}" r="${2.6 + i}" style="animation-delay:${-i * 1.3}s"/>`).join('')}</g>`
    : '';
  return `${smoke}<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
    ${lit ? `<circle cx="-5" cy="-10" r="18" fill="url(#${glowId})"/>` : ''}
    <rect x="-13" y="-18" width="26" height="18" fill="${wall}"/>
    <path d="M-16 -17 L0 -30 L16 -17 Z" fill="${roof}"/>
    <rect x="6" y="-31" width="4" height="8" fill="${roof}"/>
    <rect x="-8" y="-13" width="6" height="6" rx="1" fill="${glow}"/>
    <rect x="3" y="-12" width="5" height="12" fill="${mix(roof, '#000000', 0.3)}"/>
  </g>`;
}

// With a bottle on stage the cabin moves down the hill, out of its way, and
// only when the scene is wide enough to leave room for it. Under a band's
// text it moves down the hill too, or leaves.
const CABIN_X = 0.715;
const CABIN_STAGED = 0.86;
const CABIN_ROOM = 1.6;
const cabinAt = (stage, clear) => [stage === null ? CABIN_X : null, CABIN_STAGED].find(x => x !== null && x - CLEAR_PAD >= clear) ?? null;

// The hero's bottle and the sky's light keep out of each other's way: the
// moon sits across the sky from the bottle, and a sun that would hang behind
// it (on its cap, like a bulb) waits beside it instead. In scene units: the
// bottle is about 2 × STAGE_HALF wide and STAGE_TALL high on the hill.
const STAGE_HALF = 44;
const STAGE_TALL = 92;
const SUN_R = 17;
const LIGHT_GAP = 10;

function lightAt(phase, sunProgress, W, stage) {
  if (phase === 'night') {
    const fx = stage === null ? 0.8 : stage > 0.5 ? stage - 0.3 : stage + 0.3;
    return { x: W * fx, y: 52 };
  }
  const y = 176 - Math.sin(sunProgress * Math.PI) * 142;
  let x = 30 + sunProgress * (W - 60);
  if (stage !== null) {
    const sx = stage * W;
    const room = STAGE_HALF + SUN_R + LIGHT_GAP;
    if (Math.abs(x - sx) < room && y + SUN_R + LIGHT_GAP > hill.mid(sx) - STAGE_TALL) {
      // On the side it's on, unless that's off the edge.
      const side = x < sx ? -1 : 1;
      const fits = d => sx + d * room > SUN_R && sx + d * room < W - SUN_R;
      x = sx + (fits(side) ? side : -side) * room;
    }
  }
  return { x, y };
}

// Labels can carry place names; keep them inside the attribute.
const attr = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * phase: 'dawn' | 'day' | 'dusk' | 'night'
 * category: wmo category ('clear', 'partly', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'storm')
 * sunProgress: 0 at sunrise .. 1 at sunset
 * season: 'winter' | 'spring' | 'summer' | 'fall'
 * cold: chimney smoke (and snow on the ground in winter)
 * aspect: container width / height
 * stage: where the hero's bottle stands on the middle hill (a fraction of the
 *   width, see stagePoint); the cabin and trees make room for it
 * clear: the share of the width, from the left, that a line of text runs
 *   along the foot of the scene (the Wear panes' compact hero); trees and the
 *   cabin keep off it, so the words sit on open ground
 */
export function renderScene({ phase = 'day', category = 'clear', sunProgress = 0.5, season = 'summer', cold = false, aspect = BASE_W / H, label = '', theme = 'default', stage = null, clear = 0 }) {
  const P = palette(theme);
  const id = `sc${++uid}`;
  const W = Math.round(H * Math.min(4, Math.max(1.2, aspect)));
  const sx = W / BASE_W;
  const rand = rng(7);
  const g = GRAY[category] ?? 0.3;
  const night = phase === 'night';
  const sky = P.sky[phase].map(c => mix(c, grayTarget(P, phase, category), g));
  const wet = category === 'rain' || category === 'drizzle' || category === 'storm';
  const snowy = category === 'snow' || (season === 'winter' && cold);
  const shade = { color: night ? P.shade.night : phase === 'day' ? P.shade.day : P.shade.dusk, t: night ? 0.45 : phase === 'day' ? g * 0.35 : 0.25 };
  let hills = P.hills[phase].map(c => mix(c, P.hillGray, g * 0.5));
  if (snowy) hills = hills.map((c, i) => mix(c, night ? P.snowHill.night : P.snowHill.day, 0.55 - i * 0.12));

  const parts = [];

  // Stars, moon, sun
  if (night && (category === 'clear' || category === 'partly')) {
    const count = Math.round(46 * sx);
    for (let i = 0; i < count; i++) {
      const x = rand() * W, y = rand() * 120, r = 0.5 + rand() * 1.1;
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${P.star}" class="${i % 4 === 0 ? 'twinkle' : ''}" style="animation-delay:${(-rand() * 4).toFixed(2)}s" opacity="${(0.5 + rand() * 0.5).toFixed(2)}"/>`);
    }
  }
  const light = lightAt(phase, sunProgress, W, stage);
  if (night) {
    const { x: mx, y: my } = light;
    const moonDim = category === 'clear' || category === 'partly' ? 1 : 0.3;
    parts.push(`<g opacity="${moonDim}">
      <circle cx="${mx}" cy="${my}" r="30" fill="url(#${id}-moonglow)"/>
      <mask id="${id}-crescent"><rect width="${W}" height="${H}" fill="#fff"/><circle cx="${mx + 9}" cy="${my - 6}" r="15" fill="#000"/></mask>
      <circle cx="${mx}" cy="${my}" r="16" fill="${P.moon}" mask="url(#${id}-crescent)"/>
    </g>`);
  } else {
    const { x: sunX, y: sunY } = light;
    const warm = phase !== 'day';
    const dim = { clear: 1, partly: 0.95, fog: 0.4 }[category] ?? 0.22;
    parts.push(`<g opacity="${dim}">
      <circle cx="${sunX.toFixed(1)}" cy="${sunY.toFixed(1)}" r="${warm ? 46 : 40}" fill="url(#${id}-sunglow)"/>
      <circle cx="${sunX.toFixed(1)}" cy="${sunY.toFixed(1)}" r="${warm ? 17 : 15}" fill="${warm ? P.sun.warm : P.sun.day}"/>
    </g>`);
  }

  // Hills, trees, cabin
  parts.push(`<path d="${hillPath(hill.far, W)}" fill="${hills[0]}"/>`);
  parts.push(`<path d="${hillPath(hill.mid, W)}" fill="${hills[1]}"/>`);
  parts.push(trees('mid', W, season, { color: shade.color, t: Math.min(0.9, shade.t + 0.15) }, snowy, P, stage, clear));
  parts.push(`<path d="${hillPath(hill.near, W)}" fill="${hills[2]}"/>`);
  // On a narrow stage the bottle's name sits where the cabin would.
  const home = cabinAt(stage, clear);
  if ((stage === null || W / H >= CABIN_ROOM) && home !== null) parts.push(cabin(W * home, phase, category === 'storm' || category === 'rain', cold, shade, `${id}-window`, P));
  parts.push(trees('near', W, season, shade, snowy, P, stage, clear));

  // Clouds: spread evenly across the width; heavier weather sits lower and bigger.
  const n = Math.round((CLOUDS[category] ?? 3) * Math.max(1, sx * 0.8));
  const heavy = OVERCAST.has(category);
  const cloudFill = night
    ? mix(P.cloud.night, '#000000', g * 0.3)
    : category === 'storm' ? P.cloud.storm
    : wet ? P.cloud.wet
    : heavy ? P.cloud.heavy
    : phase === 'day' ? P.cloud.day : P.cloud.warm;
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * W + (rand() - 0.5) * (W / n) * 0.6;
    const y = (heavy ? 14 : 26) + ((i * 37) % (heavy ? 42 : 60));
    const s = (heavy ? 1.0 : 0.6) + ((i * 13) % 7) / (heavy ? 12 : 10);
    parts.push(cloud(x, y, s, cloudFill, night ? 0.85 : 0.94, 12 + (i % 3) * 8, 18 + (i % 5) * 5));
  }

  // Precipitation, fog, lightning
  if (wet) {
    const count = Math.round((category === 'drizzle' ? 36 : 70) * sx);
    const len = category === 'drizzle' ? 8 : 14;
    const drops = [];
    for (let i = 0; i < count; i++) {
      const x = rand() * (W + 40) - 20;
      const y = rand() * H;
      drops.push(`<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x - 3).toFixed(1)}" y2="${(y + len).toFixed(1)}" style="animation-delay:${(-rand() * 2).toFixed(2)}s;animation-duration:${(1.3 + rand() * 0.8).toFixed(2)}s"/>`);
    }
    parts.push(`<g class="rain" stroke="${night ? P.rain.night : P.rain.day}" stroke-width="${category === 'drizzle' ? 1 : 1.3}" stroke-linecap="round" opacity="0.7">${drops.join('')}</g>`);
  }
  if (category === 'snow') {
    const flakes = [];
    for (let i = 0; i < Math.round(60 * sx); i++) {
      flakes.push(`<circle cx="${(rand() * W).toFixed(1)}" cy="${(rand() * H).toFixed(1)}" r="${(1 + rand() * 1.8).toFixed(2)}" style="animation-delay:${(-rand() * 12).toFixed(2)}s;animation-duration:${(8 + rand() * 6).toFixed(2)}s"/>`);
    }
    parts.push(`<g class="snow" fill="${P.snow}" opacity="0.9">${flakes.join('')}</g>`);
  }
  if (category === 'fog') {
    for (let i = 0; i < 4; i++) {
      parts.push(`<g class="drift" style="--dx:${20 + i * 6}px;animation-duration:${14 + i * 4}s"><rect x="${-60 + i * 30}" y="${104 + i * 24}" width="${W + 120}" height="26" rx="13" fill="${night ? P.fog.night : P.fog.day}" opacity="0.55" filter="url(#${id}-fog)"/></g>`);
    }
  }
  if (category === 'storm') {
    const bx = W * 0.58;
    parts.push(`<path class="bolt" transform="translate(${bx.toFixed(1)} 0)" d="M0 58 L-12 92 L0 92 L-10 124 L16 84 L3 84 L14 58 Z" fill="${P.bolt}"/>`);
    parts.push(`<rect class="flash" width="${W}" height="${H}" fill="${P.flash}"/>`);
  }

  return `<svg class="scene" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" role="img" aria-label="${attr(label)}">
    <defs>
      <linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${sky[0]}"/><stop offset="0.55" stop-color="${sky[1]}"/><stop offset="1" stop-color="${sky[2]}"/>
      </linearGradient>
      <radialGradient id="${id}-sunglow">
        <stop offset="0" stop-color="${phase === 'day' ? P.sunGlow.day : P.sunGlow.warm}" stop-opacity="0.9"/>
        <stop offset="1" stop-color="${phase === 'day' ? P.sunGlow.day : P.sunGlow.warmEdge}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${id}-window">
        <stop offset="0" stop-color="${P.windowGlow}" stop-opacity="0.35"/><stop offset="1" stop-color="${P.windowGlow}" stop-opacity="0"/>
      </radialGradient>
      <filter id="${id}-fog" x="-10%" y="-100%" width="120%" height="300%"><feGaussianBlur stdDeviation="7"/></filter>
      <radialGradient id="${id}-moonglow">
        <stop offset="0" stop-color="${P.moon}" stop-opacity="0.35"/><stop offset="1" stop-color="${P.moon}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#${id}-sky)"/>
    ${parts.join('')}
  </svg>`;
}

// Colors for tinting the page around the hero.
export function sceneTint(phase, category, theme = 'default') {
  const P = palette(theme);
  const g = GRAY[category] ?? 0.3;
  return P.sky[phase].map(c => mix(c, grayTarget(P, phase, category), g));
}

// Where the middle hill's ridge is at `fx` (a fraction of a box's width), as
// fractions of a box of this aspect: the hero stands its bottle there. The
// scene fills the box like the SVG does (preserveAspectRatio slice, from the
// bottom).
export function stagePoint(aspect, fx) {
  const W = Math.round(H * Math.min(4, Math.max(1.2, aspect)));
  const scale = Math.max(aspect / W, 1 / H);
  const offsetX = (aspect - W * scale) / 2;
  const xs = (fx * aspect - offsetX) / scale;
  return { x: fx, y: 1 - H * scale + hill.mid(xs) * scale, scene: xs / W };
}

const hsl = hex => {
  const [r, g, b] = hexToRgb(hex).map(c => c / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
};
const fromHsl = (h, s, l) => {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return `#${[0, 8, 4].map(n => f(n).toString(16).padStart(2, '0')).join('')}`;
};

// gruvbox's own accents for its skies (a lightened gruvbox sky lands on its
// neutrals): purple at dawn and dusk, blue by day and at night. All clear
// 4.5:1 on its panels.
const GRUVBOX_SKY = { dawn: '#d3869b', day: '#83a598', dusk: '#d3869b', night: '#83a598' };

// The sky's ambient color, light enough to draw with on the page's dark
// surfaces (about 7:1 on --surface-1): the middle of the sky's gradient at a
// fixed lightness, its saturation kept (a gray sky gives a quiet accent).
// Dawn reads rose, day slate-blue, dusk violet, night indigo.
export function skyAccent(phase, category, theme = 'default') {
  if (theme === 'gruvbox') return GRUVBOX_SKY[phase] ?? GRUVBOX_SKY.night;
  const [h, s] = hsl(sceneTint(phase, category, theme)[1]);
  return fromHsl(h, Math.min(0.62, Math.max(0.14, s * 0.9)), 0.76);
}

// Where the scene's light is (fractions of its width and height) and its
// color: the moon at night, the sun by day, weaker under cloud. The hero
// rim-lights its bottle from there.
// `stage` as renderScene's.
export function skyLight({ phase = 'day', category = 'clear', sunProgress = 0.5, aspect = BASE_W / H, theme = 'default', stage = null }) {
  const P = palette(theme);
  const W = Math.round(H * Math.min(4, Math.max(1.2, aspect)));
  const { x, y } = lightAt(phase, sunProgress, W, stage);
  if (phase === 'night') {
    return { x: x / W, y: y / H, color: P.moon, strength: category === 'clear' || category === 'partly' ? 1 : 0.35 };
  }
  return {
    x: x / W,
    y: y / H,
    color: phase === 'day' ? P.sun.day : P.sun.warm,
    strength: { clear: 1, partly: 0.9, fog: 0.45 }[category] ?? 0.3,
  };
}
