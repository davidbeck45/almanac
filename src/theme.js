// Color themes. 'default' is Almanac's own palette; 'gruvbox' is morhetz's
// gruvbox (dark). CSS tokens switch on <html data-theme>; colors that come
// from data (accord chips and bars, season bars) go through paint(), and the
// weather scene has a palette per theme (src/scene.js).
export const THEMES = ['default', 'gruvbox'];

// gruvbox dark: the bg/fg ramp, then the bright, normal and faded accents.
export const GRUVBOX = {
  bg0_h: '#1d2021', bg0: '#282828', bg0_s: '#32302f', bg1: '#3c3836', bg2: '#504945', bg3: '#665c54', bg4: '#7c6f64',
  gray: '#928374', fg4: '#a89984', fg3: '#bdae93', fg2: '#d5c4a1', fg1: '#ebdbb2', fg0: '#fbf1c7',
  red: '#fb4934', green: '#b8bb26', yellow: '#fabd2f', blue: '#83a598', purple: '#d3869b', aqua: '#8ec07c', orange: '#fe8019',
  red2: '#cc241d', green2: '#98971a', yellow2: '#d79921', blue2: '#458588', purple2: '#b16286', aqua2: '#689d6a', orange2: '#d65d0e',
  red3: '#9d0006', green3: '#79740e', yellow3: '#b57614', blue3: '#076678', purple3: '#8f3f71', aqua3: '#427b58', orange3: '#af3a03',
};
// Data colors map onto the accents and the lighter neutrals; the darkest
// backgrounds would vanish against the panels.
const GRUVBOX_INKS = Object.entries(GRUVBOX).filter(([k]) => !/^bg[0-3]/.test(k)).map(([, v]) => v);

let current = 'default';
export const theme = () => current;

export function setTheme(name) {
  current = THEMES.includes(name) ? name : 'default';
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = current;
  return current;
}

const rgb = hex => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// "Redmean" weighted RGB distance: cheap and close to how different two colors look.
function distance(a, b) {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  return (2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2;
}

const nearest = new Map();

/** A data color in the current theme: unchanged by default, the nearest gruvbox color otherwise. */
export function paint(hex) {
  if (current !== 'gruvbox' || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  if (!nearest.has(hex)) nearest.set(hex, GRUVBOX_INKS.reduce((best, c) => (distance(hex, c) < distance(hex, best) ? c : best)));
  return nearest.get(hex);
}

// Accords gruvbox has no near match for: its palette has no dark browns, and
// plain distance lands roasted and resinous notes on olive green.
const GRUVBOX_ACCORDS = {
  chocolate: GRUVBOX.orange3, cacao: GRUVBOX.orange3, coffee: GRUVBOX.orange3,
  tobacco: GRUVBOX.yellow3, oud: GRUVBOX.yellow3,
};

/** An accord's chip color in the current theme. */
export const paintAccord = (name, hex) => (current === 'gruvbox' && GRUVBOX_ACCORDS[name]) || paint(hex);
