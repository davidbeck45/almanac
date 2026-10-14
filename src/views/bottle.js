// The bottle page (#/bottle/<id>[?ctx=<key>]): a sheet on phones, a drawer on
// tablets and an inspector beside the page from 1100px (src/css/shell.css
// places it, src/css/bottle.css draws it). It's built from SECTIONS, an
// ordered registry: a new section registers itself from its own module with
// addSection() and the shell imports that module (.sweep/notes/shell-map.md).
// The sections in their own modules are src/views/bottle-*.js; the ones that
// ask the suggestion pool keep their answers with pooled(), and draw again
// on their own when an answer lands (redrawSection).
import { rank, comfortRange, SEASONS } from '../engine.js';
import { layerPicks } from '../layering.js';
import { setHidden } from '../hidden.js';
import { loadWants, saveWants, hasWant, setWant } from '../wishlist.js';
import { loadSkin, applySkin } from '../skin.js';
import { isCustomId, shareToken } from '../custom.js';
import { styleById } from '../scent-styles.js';
import { esc, deg, temp, matchPct, relativeDay } from '../ui.js';
import { icon, img, bar, reasonsList, accordColor, wearButton, magDot, messageHTML, shelfHTML } from '../ui/components.js';
import { askPool } from '../app/pool.js';
import {
  state, findRecord, inSource, isActive, activeFragrances, sourceRecords, viewingDemo, nowSlot, canWear, wornId,
  wearInfo, todayISO, poolInputs,
} from '../app/state.js';

// ---------- The registry ----------

/**
 * Sections in page order: { id, order, render(model) -> HTML or '' }, and
 * optionally the handlers its markup names, as a view module exports them:
 * actions, forms, fields, changes, sheets. The shell merges those with the
 * views' (names are global: prefix them, e.g. 'bp-skin-rate'). `after(model,
 * app)` runs once the page is on screen (each render), for a section that
 * loads something and draws again when it's in. `shopOrder`: its place on
 * the page of a bottle you don't own, when that differs (what it smells
 * like comes before how to spray it).
 */
export const SECTIONS = [];

export function addSection(section) {
  if (SECTIONS.some(s => s.id === section.id)) throw new Error(`Two bottle-page sections called "${section.id}"`);
  SECTIONS.push(section);
  SECTIONS.sort((a, b) => a.order - b.order);
}

/** The sections in the order a bottle's page shows them: owned, or shopping for it. */
export function sectionsFor(model) {
  const mine = model.owned || model.inMine;
  const at = s => (mine ? s.order : s.shopOrder ?? s.order);
  return [...SECTIONS].sort((a, b) => at(a) - at(b));
}

/** The sections' `after` hooks, for the shell to call once the page is drawn. */
export function afterBottle(model, app) {
  for (const s of SECTIONS) s.after?.(model, app);
}

// Whether the page on screen is still this bottle's (after an await). `id`:
// the route's argument (a hand-entered bottle's is its share token).
export const showing = id => state.route?.dest === 'bottle' && state.route.arg === id;

// What a pool answer depends on besides the bottle: the wardrobe (switched
// on and off), the place's climate, "How you wear" and "Prefer great value".
const inputsKey = i => JSON.stringify([i.owned.map(f => f.id), i.exclude.map(f => f.id), i.summary, i.shares, i.preferValue]);
// A payload's part of the key: a record counts by its id (its notes may
// arrive later; the answer doesn't change with them).
const payloadKey = own => JSON.stringify(own, (k, v) => (k === 'record' && v && typeof v === 'object' ? String(v.id) : v));

/**
 * A section's answers from the pool (src/app/pool.js), one per bottle, asked
 * from its `after` hook: `ask(model, app)` asks `type` with poolInputs() and
 * `payload(model)` (null: nothing to ask) on `channel`, once per bottle and
 * inputs, and draws again when the answer lands: the section alone
 * (`section`, its id: redrawSection), else the page. `prepare(model,
 * inputs)` adds to the payload what needs an await (the liked styles).
 * `get(id)` -> undefined before it's asked, else { status: 'loading' |
 * 'ready' | 'error', result, error }; a changed wardrobe asks again and keeps
 * the old result on screen meanwhile. `forget(id)` asks again on the next
 * render (Try again). `ask` in the options stands in for askPool (tests).
 */
export function pooled(type, channel, payload, { section = null, prepare = null, ask: askFn = askPool } = {}) {
  const answers = new Map();
  const reading = new Set(); // ids waiting on poolInputs(), so a render meanwhile doesn't ask twice
  async function ask(model, app) {
    const id = model.f.id, base = payload(model);
    if (!base || reading.has(id)) return;
    reading.add(id);
    let inputs, own;
    try {
      inputs = await poolInputs();
      own = prepare ? { ...base, ...(await prepare(model, inputs)) } : base;
    } catch {
      return;
    } finally {
      reading.delete(id);
    }
    const key = `${inputsKey(inputs)}\n${payloadKey(own)}`;
    const old = answers.get(id);
    if (old?.key === key) return;
    answers.set(id, { key, status: 'loading', result: old?.result ?? null, error: '' });
    // Asked again with an answer on screen: it dims (the section draws so).
    if (old?.result && showing(model.arg ?? id) && section) redrawSection(section, app);
    let next;
    try {
      const result = await askFn(type, { ...inputs, ...own }, { channel });
      if (result.stale) {
        // A newer question on the channel (another bottle's) replaced it: ask again next time.
        if (answers.get(id)?.key === key) answers.delete(id);
        return;
      }
      next = { key, status: 'ready', result, error: '' };
    } catch (err) {
      next = { key, status: 'error', result: null, error: err.message };
    }
    if (answers.get(id)?.key !== key) return;
    answers.set(id, next);
    if (!showing(model.arg ?? id)) return;
    // The answer brought the bottle's signals (value, safety: the crowd block
    // reads them), so the record changed: the whole page, reader kept in place.
    if (section && findRecord(id) === model.f) redrawSection(section, app);
    else app.renderBottle();
  }
  return { ask, get: id => answers.get(id), forget: id => answers.delete(id) };
}

/**
 * Draws one section again where it stands (its answer landed), the rest of
 * the page and focus in it untouched. A section above the reader that grows
 * or shrinks doesn't move what they're reading: the next one holds its place.
 * The whole page when the section isn't on it.
 */
export function redrawSection(id, app) {
  const slot = globalThis.document?.querySelector(`#bottle [data-section="${id}"]`);
  const section = SECTIONS.find(s => s.id === id);
  const model = slot && section && state.route?.dest === 'bottle' ? bottleModel(state.route) : null;
  if (!model) return app.renderBottle();
  const panel = slot.closest('.bp-panel');
  const focused = slot.contains(document.activeElement) ? document.activeElement : null;
  const next = slot.getBoundingClientRect().top < panel.getBoundingClientRect().top ? slot.nextElementSibling : null;
  const before = next?.getBoundingClientRect().top;
  slot.innerHTML = section.render(model);
  if (next) panel.scrollTop += next.getBoundingClientRect().top - before;
  // A control that went: its successor, else the section's heading.
  if (focused && !focused.isConnected && !app.refocus(focused, '#bottle')) {
    (slot.querySelector('h3[tabindex]') ?? panel.querySelector('.bp-close'))?.focus({ preventScroll: true });
  }
}

/**
 * Where the reader is in a panel: the first section that starts in view (a
 * section cut off at the top may be the one about to grow), else the one
 * filling it, and its offset from the top. Null at the top of the page.
 */
export function readingAt(panel) {
  if (panel.scrollTop <= 0) return null;
  const top = panel.getBoundingClientRect().top;
  const slots = [...panel.querySelectorAll(':scope > [data-section]')].map(slot => [slot, slot.getBoundingClientRect()]).filter(([, r]) => r.height);
  const [slot, r] = slots.find(([, r]) => r.top >= top - 1) ?? slots.find(([, r]) => r.bottom > top) ?? [];
  return slot ? { id: slot.dataset.section, offset: r.top - top } : null;
}

/** Scrolls a panel drawn again so the section the reader was at sits where it did (readingAt). */
export function keepReading(panel, at) {
  const slot = at && panel.querySelector(`:scope > [data-section="${at.id}"]`);
  if (slot) panel.scrollTop += slot.getBoundingClientRect().top - panel.getBoundingClientRect().top - at.offset;
}

// ---------- The styles someone likes ----------

let liked = { key: null, ids: null, stated: true };

/**
 * The scent styles someone likes, as Insights, Discover and the Wishlist
 * read them (likedFor in src/views/wardrobe/parts.js): { ids, stated }. The
 * ones liked on Insights (state.likedStyles; [] once every one is unliked)
 * or David's DEMO_LIKED on his wardrobe are stated; else they're the ones
 * most of the bottles lean toward, a guess (`stated` false: the page says
 * "a style you reach for", not "you like"). src/discover.js loads on demand.
 */
export async function likedTaste(owned = activeFragrances()) {
  const key = JSON.stringify([state.likedStyles ?? null, viewingDemo(), owned.map(f => f.id)]);
  if (liked.key === key) return liked;
  const { DEMO_LIKED, likedStyles } = await import('../discover.js');
  const stated = (state.likedStyles ?? (viewingDemo() ? DEMO_LIKED : null))?.filter(id => styleById(id));
  const none = state.likedStyles?.length === 0;
  liked = { key, ids: none ? [] : stated?.length ? stated : likedStyles(owned).map(s => s.id), stated: none || Boolean(stated?.length) };
  return liked;
}

/** likedTaste()'s style ids. */
export const likedStyleIds = async (owned = activeFragrances()) => (await likedTaste(owned)).ids;

/** likedTaste() as last worked out (ids null before), for templates. */
export const likedNow = () => liked.ids;
export const likedStatedNow = () => liked.stated;

// ---------- Links ----------

// The id a link names a bottle by: a hand-entered bottle in no list travels
// whole (its share token), so its page opens after a reload too.
const inLists = id => [...sourceRecords(), ...state.mine.records].some(f => f.id === id);
export const linkId = f => (isCustomId(f.id) && !String(f.id).includes('~') && !inLists(f.id) && f.accords ? shareToken(f) : f.id);

/**
 * What every section gets:
 * { f: the record, entry: its ranked entry for the window (null without a
 *   forecast), solo: ranked on its own (not in the list on screen), ctx and
 *   ctxLabel: the list it was opened from, occasion: that list's (or null),
 *   owned: in the collection being ranked, active: and switched on, inMine,
 *   worn, canWear, wears, todayISO, win, alts, partners, comfort, about:
 *   loadAbout()'s data (undefined while it loads, null when the dataset has
 *   none; the wardrobe's and catalog's records carry theirs as f.about),
 *   wanted: on the want list, skin: your own rating and nudges (src/skin.js)
 *   or null, aboutFailed: its about data couldn't load (offline), arg: the
 *   route's argument }. A bottle ranked on its own counts your stars.
 */
export function bottleModel(route) {
  const id = route.arg;
  const fallback = nowSlot()?.win.slot ?? null;
  const key = state.contexts[route.query.ctx] ? route.query.ctx : fallback;
  const ctx = state.contexts[key] ?? null;
  let entry = ctx?.entries.get(id) ?? null;
  const f = entry?.fragrance ?? findRecord(id);
  if (!f) return null;
  const solo = !entry;
  const win = ctx?.win ?? null;
  if (!entry && win) entry = rank(applySkin([f], loadSkin()), win, win.slot, { occasion: ctx.occasion, history: state.history, todayISO: win.dateISO })[0];
  const owned = inSource(f.id);
  const active = isActive(f.id);
  const others = activeFragrances().filter(o => o.id !== f.id);
  return {
    f,
    entry,
    solo,
    win,
    ctx: key,
    // "Formal · tonight", but "Formal · Friday night": only the relative words go lower case.
    ctxLabel: win ? (ctx.occasion ? `${ctx.occasion.label} · ${inSentence(win.label)}` : win.label) : '',
    occasion: ctx?.occasion ?? null,
    owned,
    inMine: state.mine.records.some(r => r.id === f.id),
    active,
    worn: win ? wornId(win) : null,
    canWear: Boolean(win) && active && canWear(win),
    wears: wearInfo(f.id),
    todayISO: todayISO(),
    alts: ctx && !solo ? ctx.ranked.filter(r => r.fragrance.id !== id).slice(0, 4) : [],
    partners: others.length ? layerPicks(f, others, 3, win ?? undefined) : null,
    comfort: comfortRange(f),
    about: state.about.get(id),
    wanted: hasWant(loadWants(), f.id),
    skin: loadSkin()[f.id] ?? null,
    aboutFailed: state.aboutFailed.has(id),
    arg: id,
  };
}

/** A bottle's about data: the build's (wardrobe, catalog) or loadAbout's; undefined while that loads. */
export const aboutOf = m => m.f.about ?? m.about;

// The whole page. `modal`: a dialog over the page (phones and tablets).
// model: undefined while its record loads, null for a bottle no source has,
// false when it couldn't load (offline).
export function bottlePageHTML(model, { modal = true } = {}) {
  const frame = inner => `
    ${modal ? '<div class="bp-backdrop" data-action="close-bottle"></div>' : ''}
    <article class="bp-panel"${modal ? ' role="dialog" aria-modal="true"' : ''} aria-labelledby="bottle-title">
      <div class="sheet-grip" aria-hidden="true"></div>
      <button class="icon-btn bp-close" data-action="close-bottle" aria-label="Close">${icon.close}</button>
      ${inner}
    </article>`;
  // The page's h2 is the tab's title too (the shell reads it).
  const notice = (title, message) => frame(`<h2 id="bottle-title" class="visually-hidden">${title}</h2><div class="bp-notice">${messageHTML(message)}</div>`);
  if (model === undefined) {
    return frame(`<h2 id="bottle-title" class="visually-hidden">Loading</h2><div class="bp-loading" aria-busy="true"><span class="sk bp-sk-photo"></span><span class="sk bp-sk-line"></span><span class="sk bp-sk-line short"></span></div>`);
  }
  if (model === null) {
    return notice('Bottle not found', { glyph: icon.bottle, title: 'Bottle not found', body: 'This link names a bottle the library doesn’t have.' });
  }
  if (model === false) {
    return notice('Couldn’t load', { glyph: icon.cloud, title: 'Couldn’t load this bottle', body: 'The fragrance library needs a connection. It tries again when you’re back online.',
      action: `<button class="btn primary" data-action="bottle-retry">${icon.refresh}<span>Try again</span></button>` });
  }
  // Each section in a slot of its own, so an answer that lands draws only it.
  return frame(sectionsFor(model).map(s => `<div class="bp-slot" data-section="${s.id}">${s.render(model)}</div>`).join(''));
}

// ---------- Sections ----------

const SEASON_COLORS = { winter: '#8fc7f0', spring: '#9be39a', summer: '#f6a08f', fall: '#f2b264', day: '#f5c451', night: '#8ea3d9' };
const GENDER = { men: 'for men', women: 'for women', 'women and men': 'unisex' };
const FACTORS = [
  ['occasion', 'Occasion', '#e7b6ff'],
  ['season', 'Season', '#9be39a'],
  ['weather', 'Weather', '#8fc7f0'],
  ['time', 'Time of day', '#f5c451'],
  ['quality', 'Rating', '#f2b264'],
];
// Names longer than this step down a size, so they don't run to four lines.
const LONG_NAME = 28;
// Accord bars are Fragrantica's widths (30–100), read out as words.
const strength = width => (width >= 85 ? 'dominant' : width >= 65 ? 'strong' : width >= 45 ? 'moderate' : 'light');

function headSection({ f, entry, ctxLabel, solo }) {
  const meta = [f.brand, f.year, GENDER[f.gender]].filter(Boolean).map(esc).join(' · ');
  const ratingLine = f.source === 'custom'
    ? '<span class="by-hand">Entered by hand</span>'
    : !f.rating ? 'Unrated'
    : `★ ${f.rating.toFixed(2)} <span>${esc(f.source === 'fragella' ? 'Fragella rating' : `${f.ratingVotes.toLocaleString()} votes`)}</span>`;
  // Parfumo's 0–10 ratings when we have them, else Fragrantica's votes, else
  // Fragella's words; Lasts and Projects, as compare and On your skin say it.
  const pf = f.parfumo, fv = f.performance;
  const performance = pf
    ? `Lasts ${pf.longevity.toFixed(1)} · Projects ${pf.sillage.toFixed(1)} <span>of 10 on <a href="${esc(pf.url)}" target="_blank" rel="noopener" data-focus="bp-parfumo">Parfumo</a></span>`
    : fv
    ? `Lasts ${fv.longevity.toFixed(1)} of 5 · Projects ${fv.sillage.toFixed(1)} of 4 <span>on Fragrantica</span>`
    : [f.longevity, f.sillage && `${f.sillage} projection`].filter(Boolean).map(esc).join(' · ');
  const o = f.original;
  const inspired = o ? `<p class="inspired">Inspired by ${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener" data-focus="bp-inspired">${esc(o.name)}</a>` : esc(o.name)} · ${esc(o.brand)}</p>` : '';
  const kicker = entry && !solo ? `<p class="kicker">${magDot(entry.tier)}${esc(ctxLabel)}</p>` : '';
  return `<header class="bp-head" style="--accord:${accordColor(Object.keys(f.accords)[0])}">
    <div class="bp-bottle">${img(f, { lazy: false })}</div>
    <div class="bp-title">
      ${kicker}
      <h2 id="bottle-title"${f.name.length > LONG_NAME ? ' class="long"' : ''}>${esc(f.name)}</h2>
      <p class="brand">${meta}</p>
      ${inspired}
      <p class="rating">${ratingLine}</p>
      ${performance ? `<p class="performance">${performance}</p>` : ''}
    </div>
  </header>`;
}

// The feels-like range a bottle suits (engine comfortRange), in the user's units.
function comfortHTML(range) {
  if (!range || (range.lowF === null && range.highF === null)) return '';
  const { lowF, highF } = range;
  const text = lowF === null ? `Best when it feels ${deg(highF)} or colder`
    : highF === null ? `Best when it feels ${deg(lowF)} or warmer`
    : `Best when it feels ${temp(lowF)}–${deg(highF)}`;
  return `<p class="fact">${icon.thermo}<span>${esc(text)}</span></p>`;
}

function wearsHTML(wears, today) {
  if (!wears) return '';
  const text = wears.count
    ? `Worn ${wears.count}× in the last 30 days · last ${relativeDay(wears.last, today)}`
    : wears.last ? `Last worn ${relativeDay(wears.last, today)}` : 'No wears logged yet';
  return `<p class="fact">${icon.clock}<span>${esc(text)}</span></p>`;
}

function summarySection({ entry, comfort, wears, todayISO: today, owned }) {
  return `<div class="bp-summary">
    ${entry ? reasonsList(entry.reasons, 'full') : ''}
    ${comfortHTML(comfort)}
    ${owned ? wearsHTML(wears, today) : ''}
  </div>`;
}

// Want: a toggle (aria-pressed) that fills its heart once the bottle is on the list.
function wantButton(f, wanted) {
  const on = Boolean(wanted);
  return `<button class="btn secondary bp-want${on ? ' on' : ''}" data-action="bp-want" data-id="${esc(f.id)}" aria-pressed="${on}">${on ? icon.heartFill : icon.heart}<span>${on ? 'Wanted' : 'Want'}<span class="visually-hidden">: ${esc(f.name)}</span></span></button>`;
}

function actionsSection({ f, entry, ctx, worn, canWear: wearable, owned, inMine, active, wanted }) {
  // In Mine while another list is ranked: nothing to add.
  const own = inMine
    ? `<span class="owned-tag">${icon.check}In Mine</span>`
    : `<button class="btn primary" data-action="own" data-id="${esc(f.id)}">${icon.plus}<span>I own it</span></button>`;
  // Switched off in Wardrobe: it can come back from here.
  const rotation = active
    ? `<button class="btn tertiary" data-action="hide" data-id="${esc(f.id)}">${icon.hide}Hide from picks</button>`
    : `<button class="btn secondary" data-action="unhide" data-id="${esc(f.id)}">${icon.plus}<span>Back in rotation</span></button>`;
  return `<div class="bp-actions">
    ${owned ? (wearable && entry ? wearButton(entry, ctx, worn) : '') : own}
    ${owned || inMine ? '' : wantButton(f, wanted)}
    <button class="btn secondary" data-action="bp-compare" data-id="${esc(linkId(f))}" data-ctx="${esc(ctx ?? '')}">${icon.compare}<span>Compare</span></button>
    ${f.url ? `<a class="btn secondary" href="${esc(f.url)}" target="_blank" rel="noopener" data-focus="bp-fragrantica">Fragrantica ${icon.external}</a>` : ''}
    ${owned ? rotation : ''}
  </div>`;
}

function whySection({ entry, solo, win }) {
  if (!entry) return '';
  const p = entry.parts;
  // The rating bar is mostly your stars once you've rated it (engine
  // quality()), and says so; with neither stars nor crowd votes (a bottle
  // entered by hand) it would only read a neutral 50, so it stays out.
  const f = entry.fragrance;
  const yours = Number.isFinite(f.personal?.rating);
  const crowd = f.source !== 'custom' && f.rating > 0 && f.ratingVotes > 0;
  const bars = FACTORS.filter(([k]) => p[k] !== null && p[k] !== undefined && (k !== 'quality' || yours || crowd))
    .map(([k, label, color]) => bar(k === 'quality' && yours ? 'Your rating' : label, p[k] * 100, color, `${Math.round(p[k] * 100)}`)).join('');
  const rotation = p.rotation > 0
    ? `<p class="why-note">−${Math.round(p.rotation * 100)} for rotation: ${esc(p.planned ? 'already in the plan nearby' : 'worn recently')}.</p>`
    : '';
  const title = solo ? `How it would do ${win.slot === 'day' ? 'by day' : 'tonight'}` : 'Why it ranks here';
  return `<section class="bp-section"><h3>${title} <span class="h3-aside">${matchPct(entry)}% match</span></h3><div class="bars why">${bars}</div>${rotation}</section>`;
}

// Only the relative words go lower case: "Also good for tonight", "Also good for Saturday night".
const inSentence = label => label.replace(/^(Today|Tonight|Tomorrow)\b/, w => w.toLowerCase());

// The next few from the same list, on the same shelf the list draws.
function altsSection({ alts, ctx, ctxLabel, worn }) {
  if (!alts.length) return '';
  return `<section class="bp-section"><h3>Also good for ${esc(inSentence(ctxLabel))}</h3>${shelfHTML(alts, ctx, { wornId: worn })}</section>`;
}

// Partners from the same collection (src/layering.js), heavier one sprayed first.
function layeringSection({ f, partners, ctx }) {
  if (!partners) return '';
  const rows = partners.map(p => {
    const o = p.fragrance;
    const order = p.first.id === f.id ? `Spray this first, then ${o.name} on top.` : `Spray ${o.name} first, then this on top.`;
    return `<li class="pairing">
        <button class="pairing-head" data-action="open" data-ctx="${esc(ctx ?? '')}" data-id="${esc(o.id)}">
          ${img(o)}<span><b>${esc(o.name)}</b><small>${esc(o.brand)}</small></span>${icon.chevron}
        </button>
        ${reasonsList(p.reasons, 'compact')}
        <p class="pairing-order">${icon.spray}${esc(order)}</p>
      </li>`;
  }).join('');
  return `<section class="bp-section"><h3>Layer it with</h3>${rows
    ? `<ul class="pairings">${rows}</ul>`
    : '<p class="muted small">Nothing else in this collection layers well with it.</p>'}</section>`;
}

function accordsSection({ f }) {
  const bars = Object.entries(f.accords).map(([a, v]) => bar(a, v, accordColor(a), '', `, ${strength(v)}`)).join('');
  return `<section class="bp-section"><h3>Main accords</h3><div class="bars accords">${bars}</div></section>`;
}

function seasonsSection({ f }) {
  // Fragella, hand-entered and never-voted bottles show what their accords predict.
  const estimated = !f.seasonVotes;
  const peak = Math.max(...SEASONS.map(s => f.season[s]));
  const seasonBars = SEASONS.map(s => bar(s, (f.season[s] / peak) * 100, SEASON_COLORS[s], `${Math.round(f.season[s] * 100)}%`)).join('');
  const dnPeak = Math.max(f.dayNight.day, f.dayNight.night);
  const dnBars = ['day', 'night'].map(s => bar(s, (f.dayNight[s] / dnPeak) * 100, SEASON_COLORS[s], `${Math.round(f.dayNight[s] * 100)}%`)).join('');
  return `<section class="bp-section two-col">
    <div><h3>${estimated ? 'Season fit' : 'Seasons voted'}</h3><div class="bars">${seasonBars}</div></div>
    <div><h3>${estimated ? 'Time of day, estimated' : 'Time of day'}</h3><div class="bars">${dnBars}</div></div>
  </section>`;
}

// The pyramid by layer; a bottle listed flat (only `all`) shows its notes
// under the heading alone, not a "Notes" label under "Notes".
function notesSection({ f }) {
  const chips = list => `<div class="notes">${list.map(n => `<span class="note-chip">${esc(n)}</span>`).join('')}</div>`;
  const layers = [['top', 'Top'], ['mid', 'Heart'], ['base', 'Base'], ['all', 'Notes']].filter(([k]) => f.notes?.[k]?.length);
  if (!layers.length) return '';
  const body = layers.length === 1 && layers[0][0] === 'all' ? chips(f.notes.all)
    : `<div class="pyramid">${layers.map(([k, label]) => `<div class="layer"><span class="layer-label">${label}</span>${chips(f.notes[k])}</div>`).join('')}</div>`;
  return `<section class="bp-section"><h3>Notes</h3>${body}</section>`;
}

// Orders leave room between them for wave 4's sections (shell-map.md lists
// them). Shopping for a bottle, what it smells like (accords and notes, its
// styles and look-alikes, what voters say) comes before how to wear it
// (spray, layering): `shopOrder`.
addSection({ id: 'head', order: 0, render: headSection });
addSection({ id: 'summary', order: 100, render: summarySection });
addSection({ id: 'actions', order: 150, render: actionsSection });
addSection({ id: 'why', order: 200, render: whySection });
addSection({ id: 'alts', order: 300, render: altsSection });
addSection({ id: 'layering', order: 400, shopOrder: 850, render: layeringSection });
addSection({ id: 'accords', order: 500, shopOrder: 360, render: accordsSection });
addSection({ id: 'seasons', order: 600, render: seasonsSection });
addSection({ id: 'notes', order: 700, shopOrder: 370, render: notesSection });

// ---------- Actions ----------

// The want list before the last bottle came off it, for Undo.
let wantsBefore = null;

export const actions = {
  // Any bottle, from any list: data-id, and data-ctx for the list it's in.
  open(el, app) {
    app.openBottle(el.dataset.id, el.dataset.ctx || null, el);
  },
  'close-bottle'(el, app) {
    app.closeBottle();
  },
  hide(el, app) {
    const id = el.dataset.id;
    setHidden(state.hiding, id, true, viewingDemo());
    app.closeBottle();
    app.render();
    app.showToast(`<span>${esc(findRecord(id)?.name ?? 'Bottle')} hidden from picks</span><button class="btn primary compact" data-action="unhide" data-id="${esc(id)}">Undo</button>`);
  },
  unhide(el, app) {
    setHidden(state.hiding, el.dataset.id, false, viewingDemo());
    app.render();
    app.hideToast();
  },
  own(el, app) {
    const f = findRecord(el.dataset.id);
    if (!f) return;
    app.own(f);
    // The button made way for Wear this (or the In Mine tag).
    document.querySelector('#bottle .bp-actions .btn')?.focus();
  },
  'bottle-retry'(el, app) {
    app.retryBottle();
  },
  // On the want list or off it (src/wishlist.js), as the Wishlist's own Want
  // does (wish-toggle): the page beside it draws too, and taking a bottle off
  // can be undone. A bottle the dataset can't load again by id keeps its
  // whole record there.
  'bp-want'(el, app) {
    const f = findRecord(el.dataset.id);
    if (!f) return;
    const before = loadWants();
    const on = hasWant(setWant(f), f.id);
    app.keepingFocus(el, '#bottle', app.render);
    if (!on) {
      wantsBefore = before;
      return app.showToast(`<span class="note">${esc(f.name)} removed from your wishlist.</span><button class="btn primary compact" data-action="bp-want-undo">Undo</button>`);
    }
    wantsBefore = null;
    const onList = state.base?.dest === 'wardrobe' && state.base.pane === 'wishlist';
    app.showToast(onList ? `<span>${esc(f.name)} is on your wishlist</span>`
      : `<span class="note">${esc(f.name)} is on your wishlist.</span><a class="btn secondary compact" href="#/wardrobe/wishlist">See it</a>`);
  },
  'bp-want-undo'(el, app) {
    if (!wantsBefore) return;
    saveWants(wantsBefore);
    wantsBefore = null;
    app.render();
    app.hideToast();
  },
  // Compare (bp-compare) opens "Compare with…", whose handler lives with it in src/views/compare.js.
};
