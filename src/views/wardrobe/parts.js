// What Insights and the Wishlist share: the modules they load when first
// opened, which styles someone likes, what their pool questions depend on,
// and the small templates both draw (buy-check verdicts, a bottle's rating,
// value and risk, a fill with its before and after, the Want button).
// Styles: src/css/wardrobe.css.
import { esc, plural, ratingMark, valueWord as valueWords, riskWord } from '../../ui.js';
import { icon } from '../../ui/components.js';
import { occasionCounts } from '../../history.js';
import { state, activeFragrances, hiddenIn, viewingDemo, findRecord, library } from '../../app/state.js';

// ---------- Modules loaded on demand ----------
// The gap finder's labels, "How you wear", the scent styles and doubles stay
// out of the boot graph (src/app/state.js poolInputs loads the first two the
// same way); the pane shows a skeleton until they're in.

let lib = null, loading = null, failed = null;
let importLib = () => Promise.all([
  import('../../gaps.js'), import('../../uses.js'), import('../../scent-styles.js'), import('../../discover.js'), import('../../doubles.js'),
]).then(([gaps, uses, styles, discover, doubles]) => ({ gaps, uses, styles, discover, doubles }));

/** The modules, once loaded (null before). */
export const libNow = () => lib;

/**
 * Whether they failed to load (offline before the service worker had them):
 * the browser keeps a failed module import failed for the page's life, so
 * only a reload tries again, and the panes ask once, not on every render.
 */
export const libFailed = () => Boolean(failed);

/** Loads them once. After a failure it rejects at once, without importing again. */
export function loadLib() {
  if (failed) return Promise.reject(failed);
  loading ??= importLib().then(l => (lib = l), err => {
    failed = err;
    loading = null;
    throw err;
  });
  return loading;
}

/** For tests: load the modules with `fn`, starting over. */
export function useLibLoader(fn) {
  importLib = fn;
  lib = loading = failed = null;
}

// ---------- Painting ----------

/**
 * Re-renders the page when an answer lands, focus kept: on the successor of
 * the control that had it (data attributes, as the shell does), else on the
 * element with its id (a heading).
 */
export function repaint(app) {
  const el = document.activeElement;
  if (!el?.closest?.('#main')) return app.renderPage();
  const id = el.id;
  app.keepingFocus(el, '#app', app.renderPage);
  if (id && !el.isConnected && !document.activeElement?.closest?.('#main')) document.getElementById(id)?.focus({ preventScroll: true });
}

// ---------- Inputs ----------

/** Whether the ranked list is still on its way (David's wardrobe at boot, a shared link): ask nothing yet. */
export const listLoading = () => (viewingDemo() && !state.demo) || Boolean(state.shared?.loading);

/**
 * The styles someone likes: { ids, stated } — the ones they picked
 * (state.likedStyles; none when they unpicked them all), David's DEMO_LIKED
 * on his wardrobe, else (stated false) the ones most of their bottles lean
 * toward.
 */
export function likedFor(l = lib, owned = activeFragrances()) {
  const known = new Set(l.styles.STYLES.map(s => s.id));
  if (state.likedStyles?.length === 0) return { ids: [], stated: true };
  const stated = (state.likedStyles ?? (viewingDemo() ? l.discover.DEMO_LIKED : null))?.filter(id => known.has(id));
  if (stated?.length) return { ids: stated, stated: true };
  return { ids: l.discover.likedStyles(owned).map(s => s.id), stated: false };
}

/**
 * Logged wears that tune "How you wear" (occasionCounts, uses not set to
 * Never; untagged ones don't count), as poolInputs blends them in.
 */
export function taggedWears(l = lib) {
  const counts = occasionCounts(state.history), settings = l.uses.loadUses();
  return l.gaps.USES.reduce((n, u) => n + (settings[u.id] !== 'never' ? counts[u.id] ?? 0 : 0), 0);
}

/**
 * Everything a pool question's answer depends on besides the question
 * (poolInputs' fields, before the climate loads): when it changes, ask again.
 * Records count by id and your own ratings and skin nudges.
 */
export function inputsKey(l = lib) {
  const hidden = [...hiddenIn(viewingDemo())].sort();
  return JSON.stringify([
    activeFragrances().map(f => (f.personal ? `${f.id}:${JSON.stringify(f.personal)}` : f.id)),
    hidden, l.uses.loadUses(), occasionCounts(state.history), state.preferValue,
    state.loc ? [state.loc.lat, state.loc.lon] : null,
  ]);
}

/**
 * A bottle's record to own: its full r/ record (every note) for a dataset
 * bottle, else what's kept. Null when nothing has it; rejects offline.
 */
export async function ownable(id, kept = null) {
  if (kept && kept.source !== 'fragrantica') return kept;
  if (/^\d+$/.test(String(id))) {
    const found = (await library.records([String(id)])).get(String(id));
    if (found) return found;
  }
  return kept ?? findRecord(id);
}

/** Where a bottle you own already is, as a tag's words ("In David’s"), or null. */
export const OWNED_WORD = { demo: 'In David’s', mine: 'In Mine', shared: 'In this list' };

// ---------- Templates ----------

// Best first, as the wishlist sorts them.
export const VERDICTS = ['Strong fit', 'Good', 'Covered', 'Risky', 'Redundant'];
export const verdictRank = v => (VERDICTS.includes(v) ? VERDICTS.indexOf(v) : VERDICTS.length);
const VERDICT_KIND = { 'Strong fit': 'strong', Good: 'good', Covered: 'covered', Risky: 'risky', Redundant: 'redundant' };
// Each verdict has its own glyph, so it never rests on color: a filled
// check, a check, an equals sign (you're covered), two overlapping rings
// (it doubles one you own), a warning triangle.
const mark = body => `<svg viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
const VERDICT_GLYPH = {
  strong: mark('<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.8 8.3l2.1 2.1 4.3-4.6" class="v-cut" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  good: mark('<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 8.3l2 2 4-4.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  covered: mark('<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.2 6.6h5.6M5.2 9.4h5.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  redundant: mark('<circle cx="6" cy="8" r="4.3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="8" r="4.3" fill="none" stroke="currentColor" stroke-width="1.6"/>'),
  risky: mark('<path d="M8 1.8l6.4 11.4H1.6Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6.2v3.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11.3" r="0.95" fill="currentColor"/>'),
};

// Under this likeness a bottle doesn't double one you own (SAME_SIM in src/gaps.js).
const SAME_SIM = 0.8;

/**
 * The verdict to show for a buy check. A Redundant one that ties to nothing
 * you own (no dupe or smells-like link, under SAME_SIM alike, not owned
 * itself) only says the wardrobe already does what it would: Covered, as
 * the buy check itself calls that once it knows the word.
 */
export function verdictOf(check, sameSim = SAME_SIM) {
  if (check?.verdict !== 'Redundant') return check?.verdict ?? null;
  const o = check.overlap;
  return !o || o.link || o.sim >= sameSim ? 'Redundant' : 'Covered';
}

/** A buy-check verdict as a tag: its glyph and its word. */
export function verdictBadge(verdict) {
  const kind = VERDICT_KIND[verdict] ?? 'covered';
  return `<span class="verdict" data-kind="${kind}">${VERDICT_GLYPH[kind]}${esc(verdict)}</span>`;
}

/** "★ 4.49 · 1,055 votes", or null without a rating (src/ui.js, as every screen says it). */
export const ratingText = (rating, votes) => ratingMark(rating, votes);

/**
 * Voters' value for money (1–5) in words, or null. Great from 3.8, where
 * "Prefer great value" draws its line (src/ui.js, as every screen says it).
 */
export const valueWord = value => valueWords(value);

/** A blind buy's risk in words: { word, reason }; `record` tells a safe bet from a fair one. */
export function riskText(risk, record = null) {
  const word = riskWord(risk?.level, record?.extras?.safe) ?? 'Not much crowd data';
  return { word, reason: risk?.level !== 'low' ? risk?.reasons?.[0] ?? '' : '' };
}

/** A cell's title as a short place: "Formal on cool nights" -> "Formal · cool nights". */
export function placeOf(title) {
  const i = title.lastIndexOf(' on ');
  return i < 0 ? title : `${title.slice(0, i)} · ${title.slice(i + 4)}`;
}

// A fill's before and after on one 60–100% track: a ring where your best
// sits now, a dot where this bottle would.
const LO = 0.6, HI = 1;
const at = x => (100 * Math.max(0, Math.min(1, (x - LO) / (HI - LO)))).toFixed(1);

/**
 * One cell a bottle fills (a gap report pick's or a buy check's fill):
 * "Formal · cool nights", the match it would have there, the bottle it
 * beats and that one's match, and the two as a dumbbell.
 */
export function fillHTML(f) {
  const to = Math.round(f.to * 100), from = Math.round(f.from * 100);
  const who = !f.beats ? null : f.beatsPick ? `${f.beats.name} (suggested above)` : `your ${f.beats.name}`;
  const vs = !who ? 'where you have nothing yet' : f.first ? `over ${who} at ${from}%` : `beside ${who} at ${from}%`;
  const [lo, hi] = [Math.min(f.from, f.to), Math.max(f.from, f.to)];
  return `<li class="fill">
    <span class="fill-place">${esc(placeOf(f.title))}</span>
    <b class="fill-pct">${to}%</b>
    <span class="fill-vs">${esc(vs)}</span>
    <span class="dumbbell" aria-hidden="true"><span class="db-span" style="left:${at(lo)}%;right:${(100 - at(hi)).toFixed(1)}%"></span>${f.beats ? `<span class="db-from" style="left:${at(f.from)}%"></span>` : ''}<span class="db-to" style="left:${at(f.to)}%"></span></span>
  </li>`;
}

/** Fills as a list, those that matter first, `max` shown and the rest counted. */
export function fillsHTML(fills, max = 3) {
  if (!fills?.length) return '';
  const shown = fills.slice(0, max);
  const more = fills.length - shown.length;
  return `<ul class="fills">${shown.map(fillHTML).join('')}</ul>${more ? `<p class="muted small fills-more">And ${plural(more, 'more situation')}.</p>` : ''}`;
}

/**
 * Want / Wanted, for any bottle: data-action wish-toggle (src/views/wardrobe/
 * wishlist.js). `iconOnly`: a heart for rows, its name said to screen readers.
 */
export function wantButton(f, on, { compact = true, iconOnly = false } = {}) {
  if (iconOnly) {
    return `<button class="icon-btn ghosted want-btn" data-action="wish-toggle" data-id="${esc(f.id)}" aria-pressed="${Boolean(on)}" aria-label="Want ${esc(f.name)}">${icon.heart}</button>`;
  }
  return `<button class="btn secondary${compact ? ' compact' : ''} want-btn" data-action="wish-toggle" data-id="${esc(f.id)}" aria-pressed="${Boolean(on)}">${icon.heart}<span>${on ? 'Wanted' : 'Want'}<span class="visually-hidden">: ${esc(f.name)}</span></span></button>`;
}

/** "Closest to your Cream Velvet", or to an owned dupe's original. nearest: a report pick's or a check's overlap. */
export function nearestText(nearest) {
  if (!nearest?.name) return '';
  return nearest.via ? `Closest to ${nearest.name}, the original of your ${nearest.via.name}` : `Closest to your ${nearest.name}`;
}
