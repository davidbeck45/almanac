// Hash routes, so deep links and Back work without a server:
//   #/wear/now | week | occasion[/<id>] | trip
//   #/wardrobe/owned | wishlist | worn | insights
//   #/discover[?q=…]
//   #/bottle/<id>[?ctx=<context key>]
//   #/settings
// parseRoute and routeHash are pure (test/router.test.js). The shell renders;
// go() only changes the URL.

export const HOME = '#/wear/now';

// Old home-screen shortcuts open ?view=today|week|occasion.
const LEGACY_VIEWS = { today: '#/wear/now', week: '#/wear/week', occasion: '#/wear/occasion' };
// The query keys each kind of route keeps.
const QUERY_KEYS = { bottle: ['ctx'], discover: ['q'] };

/**
 * '#/wear/occasion/office' -> { dest: 'wear', pane: 'occasion', arg: 'office', query: {} }.
 * `panes` maps each destination to its panes, default first ([] for a single
 * page). Anything unknown lands on HOME, a missing pane on the destination's first.
 */
export function parseRoute(hash, panes) {
  const raw = String(hash ?? '').replace(/^#\/?/, '');
  const [path, search = ''] = raw.split('?');
  const decode = s => { try { return decodeURIComponent(s); } catch { return s; } };
  const parts = path.split('/').filter(Boolean).map(decode);
  const [dest, first = null, second = null] = parts;
  const params = new URLSearchParams(search);
  const query = Object.fromEntries((QUERY_KEYS[dest] ?? []).filter(k => params.get(k)).map(k => [k, params.get(k)]));
  if (dest === 'bottle' && first) return { dest, pane: null, arg: first, query };
  if (dest === 'settings') return { dest, pane: null, arg: null, query: {} };
  const list = panes[dest];
  if (!list) return parseRoute(HOME, panes);
  if (!list.length) return { dest, pane: null, arg: null, query };
  const pane = list.includes(first) ? first : list[0];
  return { dest, pane, arg: pane === first ? second : null, query };
}

const part = s => encodeURIComponent(s).replace(/%3A/gi, ':');

/** The canonical hash for a route: parseRoute(routeHash(r)) gives r back. */
export function routeHash({ dest, pane = null, arg = null, query = {} }) {
  const path = [dest, pane, arg].filter(x => x !== null && x !== undefined && x !== '').map(part).join('/');
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v)).toString();
  return `#/${path}${qs ? `?${qs}` : ''}`;
}

export const sameRoute = (a, b) => Boolean(a && b) && routeHash(a) === routeHash(b);

/** The hash a legacy ?view= link means, or null. */
export const legacyHash = params => LEGACY_VIEWS[params.get('view')] ?? null;

// Changes the URL's hash without a hashchange (the shell renders itself).
// Replacing keeps the entry's state, which an open sheet uses (src/app/sheets.js).
export function go(hash, { replace = false } = {}) {
  const url = new URL(location.href);
  url.hash = hash;
  if (replace) history.replaceState(history.state, '', url);
  else history.pushState(null, '', url);
}
