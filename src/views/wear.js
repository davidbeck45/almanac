// Wear: what to wear now (the hero and the next window), the week ahead, for
// an occasion (now, or on another date or in another place), or on a trip.
// Templates are pure (test/ui.test.js and test/wear.test.js render them);
// the panes read src/app/state.js. The Trip pane lives in wear/trip.js, the
// Occasion pane's "When and where?" in wear/when.js, and the place and date
// pickers both use in wear/pickers.js. Styles: src/css/wear.css.
import { renderScene, stagePoint, skyLight } from '../scene.js';
import { calendarSeason, PLAN_MARGIN } from '../engine.js';
import { OCCASIONS, occasionById } from '../occasions.js';
import { sprayGuide } from '../spray.js';
import { planTies, tieLine, contrast } from '../contrast.js';
import { setSkin, loadAsked, markAsked, wasAsked } from '../skin.js';
import { theme } from '../theme.js';
import { toggleWear, wornIn, journalStats, shiftISO } from '../history.js';
import { routeHash } from '../app/router.js';
import { esc, temp, deg, plural, shortDate, weekdayShort, windowRange, feelWords, displayReasons, moveText, listLabel } from '../ui.js';
import {
  icon, img, slotIcon, wxIcon, wxIconFor, messageHTML, skeletonHTML, reasonsList, chips, matchBadge, shelfHTML,
  wearButton, segHTML, starsHTML, sharedBannerHTML, accordColor, sectionHead,
} from '../ui/components.js';
import {
  state, savePrefs, activeFragrances, sourceRecords, rankedFragrances, nowSlot, todaySlots, computeToday, computeWeek,
  rankContext, canWear, wornId, nowHour, findRecord,
} from '../app/state.js';
import * as trip from './wear/trip.js';
import * as when from './wear/when.js';
import * as pickers from './wear/pickers.js';

// ---------- The sky ----------

// The sky before the forecast arrives (or when it can't): the phase from the
// device clock, so a loading screen at night isn't a sunny day.
export function sceneNow(wx, { error = false, date = new Date() } = {}) {
  const now = wx?.now;
  if (now) return { phase: now.phase, category: now.category, sunProgress: now.sunProgress };
  const h = date.getHours() + date.getMinutes() / 60;
  const phase = h < 5.5 || h >= 20.5 ? 'night' : h < 7.5 ? 'dawn' : h < 18.5 ? 'day' : 'dusk';
  return { phase, category: error ? 'cloudy' : 'partly', sunProgress: Math.min(1, Math.max(0, (h - 6.5) / 13)) };
}

// Where the hero's bottle stands: right of the temperature, on the middle
// hill (src/scene.js stagePoint), a little nearer the middle on wide heroes.
const stageX = aspect => (aspect < 1.6 ? 0.73 : 0.64);

// The compact band's line (temperature, condition, the rest) runs from its
// left edge: about what share of the band's width, so the scene keeps its
// trees and cabin off that ground (src/scene.js `clear`). Px per character
// as measured in the band's fonts, over the 148px it stands on phones
// (wear.css), the shorter height, so the share errs wide.
const BAND_H = 148;
function bandClear(aspect, [temp, cond, ...rest]) {
  const px = 20 + 14.5 * temp.length + 12 + 8.2 * cond.length + rest.filter(Boolean).reduce((sum, t) => sum + 8 + 6.3 * t.length, 0);
  return Math.min(1, px / (aspect * BAND_H));
}
// The full hero's words stand in its left part (at most half its width,
// wear.css): with no bottle on the hill the scene keeps that ground open,
// as it does with one (src/scene.js FOOT_W).
const FOOT_CLEAR = 0.45;
// About what one line of the hero's label holds on a phone (16px Fraunces
// italic in 168px): a longer name takes two lines there (wear.css `.long`).
const LONG_NAME = 18;
// About what two lines of it hold beside the bottle from 720px wide (20px in
// 165px): a longer name steps down a size there (wear.css `.longer`).
const LONGER_NAME = 26;

/**
 * The hero: the weather scene with the place, the temperature and, on Now,
 * the pick standing on the hill, rim-lit by the sun or moon (tap it for its
 * page). `compact` is the shorter band the other Wear panes get.
 * pick: { entry, win, worn } | null; slots: Now's windows for the Day/Night toggle.
 */
export function heroHTML({ loc, wx, loading, error, updating, slow = false }, { aspect, compact = false, pick = null, slots = [], slotOn = null }) {
  const now = wx?.now;
  const sky = sceneNow(wx, { error: Boolean(error) });
  const stage = pick && !compact ? stagePoint(aspect, stageX(aspect)) : null;
  // The words over the scene: the temperature, the condition, a line under it
  // (each reading kept to its number, should the line wrap).
  const [big, cond, sub, status] = now
    ? [`${temp(now.tempF)}°`, now.label, `Feels\u00a0${deg(now.feelsF)} · H\u00a0${deg(now.hiF)} L\u00a0${deg(now.loF)}`, updating ? 'Updating…' : wx.stale ? 'Offline' : '']
    : error ? ['', 'Weather unavailable', loc?.name ?? '', '']
      : loading ? ['', slow ? 'Still checking the sky…' : 'Checking the sky…', slow ? 'The forecast is slow to answer.' : '', '']
        : ['', 'Where are you?', 'Set a location to get picks.', ''];
  const scene = renderScene({
    ...sky,
    season: calendarSeason(new Date(), loc?.lat ?? 1),
    cold: now ? now.feelsF < 50 : false,
    aspect,
    label: now ? `${now.label}, ${deg(now.tempF)}` : 'Weather scene',
    theme: theme(),
    stage: stage?.scene ?? null,
    clear: compact ? bandClear(aspect, [big, cond, sub, status]) : stage ? 0 : FOOT_CLEAR,
  });
  const locBtn = `<button class="loc-btn glass" data-action="location" aria-label="Change location: ${esc(loc?.name ?? 'not set')}">${icon.pin}<span>${esc(loc?.name ?? 'Set location')}</span></button>`;
  const toggle = !compact && slots.length > 1
    ? segHTML(slots.map(p => ({ value: p.win.slot, label: p.win.slot === 'day' ? 'Day' : 'Night', icon: slotIcon(p.win.slot), on: p.win.slot === slotOn })), { action: 'slot', label: 'Time of day', cls: 'glass' })
    : '';
  const body = `<div class="hero-wx">
      ${now ? `<div class="hero-temp">${temp(now.tempF)}<span class="deg">°</span></div>` : ''}
      <div class="hero-meta">
        <div class="hero-cond">${esc(cond)}</div>
        <div class="hero-sub">${sub ? esc(sub) : '&nbsp;'}</div>
        ${status ? `<span class="hero-status${updating ? ' updating' : ''}">${esc(status)}</span>` : ''}
      </div>
    </div>`;
  let bottle = '';
  if (stage) {
    const f = pick.entry.fragrance;
    const light = skyLight({ ...sky, aspect, theme: theme(), stage: stage.scene });
    // The rim catches the light on the side it comes from.
    const side = light.x >= stage.x ? 1 : -1;
    bottle = `<button class="hero-pick${f.name.length > LONG_NAME ? ' long' : ''}${f.name.length > LONGER_NAME ? ' longer' : ''}" data-action="open" data-ctx="${esc(pick.win.slot)}" data-id="${esc(f.id)}"
      style="--x:${(stage.x * 100).toFixed(2)}%;--y:${(stage.y * 100).toFixed(2)}%;--rim:${light.color};--rim-side:${side};--rim-k:${light.strength}">
      <span class="hero-bottle">${img(f, { lazy: false })}</span>
      <span class="hero-label"><small>${pick.worn ? `${icon.check}Wearing` : `${slotIcon(pick.win.slot)}${esc(pick.win.label)}`}</small><b>${esc(f.name)}</b><span>${esc(f.brand)}</span></span>
    </button>`;
  }
  return `
    <div class="hero-scene">${scene}</div>
    <div class="hero-shade"></div>
    <div class="hero-top">${locBtn}${toggle}</div>
    ${bottle}
    <div class="hero-foot">${body}</div>`;
}

// ---------- Cards ----------

// A window's head: its name (or `title`), then the hours set apart from the
// weather; typical weather (a date past the forecast) says so.
export function slotHeadHTML(win, hour, { id, thumb = false, title = null } = {}) {
  const scene = thumb ? `<div class="slot-thumb">${renderScene({
    phase: win.slot === 'day' ? 'day' : 'night',
    category: win.category,
    sunProgress: 0.42,
    season: calendarSeason(win.date, win.lat),
    cold: win.feelsF < 50,
    aspect: 78 / 54,
    label: `${win.label}: ${win.condition}`,
    theme: theme(),
  })}</div>` : '';
  const weather = [win.condition, `feels ${deg(win.feelsF)}`, ...feelWords(win)].join(', ');
  return `<header class="slot-head">
    ${scene}
    <div class="slot-title">
      <h2${id ? ` id="${id}"` : ''}>${slotIcon(win.slot)}<span>${esc(title ?? win.label)}</span></h2>
      <p class="slot-line"><span class="slot-time">${esc(windowRange(win, hour))}</span><span class="slot-wx">${wxIconFor(win)}<span>${esc(weather)}</span></span>${win.typical ? '<span class="slot-typical">Typical weather</span>' : ''}</p>
    </div>
  </header>`;
}

// A bottle the rotation nudge put first (src/engine.js NUDGE_AFTER) says so
// in its own line, not among the reasons it fits: "Not worn in 34 days".
export function nudgeOf(entry) {
  if (!entry?.nudged) return null;
  return entry.parts.unworn ? 'Not worn yet' : `Not worn in ${entry.parts.idle} days`;
}
const nudgeHTML = text => (text ? `<p class="nudge">${icon.clock}<span>${esc(text)}</span></p>` : '');
// The reasons a card shows, less the nudge's (it has its own line).
function reasonsOf(entry, n) {
  const nudge = nudgeOf(entry);
  return displayReasons(nudge ? { ...entry, reasons: entry.reasons.filter(r => r.text !== nudge) } : entry, n);
}

// "2 sprays · chest", from src/spray.js's guide, for the pick card.
const SPOT_WORDS = { 'collar or scarf': 'collar', 'back of the neck': 'nape' };
export function sprayLine({ sprays: [lo, hi], where, unit = 'spray' }) {
  const count = lo === hi ? plural(lo, unit) : `${lo}–${hi} ${unit}s`;
  return `${count} · ${where.map(w => SPOT_WORDS[w] ?? w).join(', ')}`;
}

// "Legacy (fresher) and Aristo suit today just as well": the bottles that
// suit the window as well as its pick (src/contrast.js tiesFor), each name
// opening its page in the window's list.
export function tiesHTML(ties, win, ctx) {
  if (!ties?.length) return '';
  const name = ({ entry }) => `<button class="link-btn" data-action="open" data-ctx="${esc(ctx)}" data-id="${esc(entry.fragrance.id)}">${esc(entry.fragrance.name)}</button>`;
  return `<p class="ties">${icon.compare}<span>${tieLine(ties, win, { name, text: esc })}</span></p>`;
}

// The top pick. On Now the hero shows the bottle, so the card leads with why
// and how much to spray (`spray`: sprayGuide's answer; it opens the bottle
// page's spray section), then the bottles that suit the window as well
// (`ties`, in `win`) and Now's question about the pick, when it asks one
// (`ask`, markup); elsewhere (`full`) it shows the photo and name too.
export function pickHTML(entry, ctx, worn, { canWear = true, full = false, kicker = '', spray = null, ties = [], win = null, ask = '' } = {}) {
  const f = entry.fragrance;
  const wash = `--accord:${accordColor(Object.keys(f.accords)[0])}`;
  const open = (cls, inner, label = '') => `<button class="${cls}" data-action="open" data-ctx="${esc(ctx)}" data-id="${esc(f.id)}"${label ? ` aria-label="${esc(label)}"` : ''}>${inner}</button>`;
  if (!full) {
    const hint = spray ? `<button class="spray-hint" data-action="spray-open" data-ctx="${esc(ctx)}" data-id="${esc(f.id)}" aria-label="${esc(`How to spray ${f.name}: ${sprayLine(spray)}`)}">${icon.spray}<span>${esc(sprayLine(spray))}</span>${icon.chevron}</button>` : '';
    return `<div class="pick" style="${wash}">
      <div class="pick-top">${matchBadge(entry)}${open('btn tertiary compact', `Details${icon.chevron}`, `Details for ${f.name}`)}</div>
      ${nudgeHTML(nudgeOf(entry))}
      ${reasonsList(reasonsOf(entry, 3), 'lead')}
      ${tiesHTML(ties, win, ctx)}
      ${chips(f.accords)}
      ${canWear || hint ? `<div class="pick-actions">${hint}${canWear ? wearButton(entry, ctx, worn) : ''}</div>` : ''}
      ${ask}
    </div>`;
  }
  return `<div class="pick full" style="${wash}">
    ${open('pick-bottle', img(f, { lazy: false }), `Details for ${f.name}`)}
    <div class="pick-info">
      ${kicker ? `<p class="kicker">${worn === f.id ? 'Wearing' : esc(kicker)}</p>` : ''}
      <h3 class="pick-name">${open('pick-name-btn', `<span class="clamp">${esc(f.name)}</span>`)}</h3>
      <p class="brand">${esc(f.brand)}</p>
      ${nudgeHTML(nudgeOf(entry))}
      ${reasonsList(reasonsOf(entry, 2), 'lead')}
      ${chips(f.accords)}
    </div>
    <div class="pick-actions">${canWear ? wearButton(entry, ctx, worn) : ''}${matchBadge(entry)}</div>
  </div>`;
}

// The other window of today, beside the first on a wide column (the hero's
// Day/Night toggle does this on phones): its pick with photo and name, and a
// button that brings its shelf up. A landmark named by its window, with no
// heading of its own: under the card's h2 ("Today") a heading here would
// file tonight's bottle, and the shelf after it, under today.
export function nextWindowHTML({ win, pick }, worn, hour) {
  const f = pick.fragrance;
  const open = (cls, inner, label = '') => `<button class="${cls}" data-action="open" data-ctx="${esc(win.slot)}" data-id="${esc(f.id)}"${label ? ` aria-label="${esc(label)}"` : ''}>${inner}</button>`;
  return `<aside class="next-window" aria-labelledby="next-title" style="--accord:${accordColor(Object.keys(f.accords)[0])}">
    <p class="kicker">${slotIcon(win.slot)}<span id="next-title">${esc(win.label)}</span><span class="next-time">${esc(windowRange(win, hour))}</span></p>
    <div class="next-pick">
      ${open('pick-bottle', img(f), `Details for ${f.name}`)}
      <div class="pick-info">
        <p class="pick-name">${open('pick-name-btn', `<span class="clamp">${esc(f.name)}</span>`)}</p>
        <p class="brand">${worn === f.id ? 'Wearing · ' : ''}${esc(f.brand)}</p>
        ${matchBadge(pick)}
      </div>
    </div>
    ${nudgeHTML(nudgeOf(pick))}
    ${reasonsList(reasonsOf(pick, 2), 'compact')}
    <button class="btn tertiary compact next-more" data-action="slot" data-value="${esc(win.slot)}">${esc(`All picks for ${win.label.toLowerCase()}`)}${icon.chevron}</button>
  </aside>`;
}

// The rest of a window's ranking on the magnitude shelf. With `tags`, a
// bottle within PLAN_MARGIN of the pick says in a word how it differs from
// it (src/contrast.js: "fresher", "white floral", "louder").
function alsoHTML(ranked, pick, ctx, worn, label, { tags = false } = {}) {
  const rest = ranked.filter(r => r !== pick);
  if (!rest.length) return '';
  const tagOf = tags ? r => (Math.abs(pick.score - r.score) <= PLAN_MARGIN ? contrast(pick.fragrance, r.fragrance)[0] ?? null : null) : null;
  return `<div class="also">
    <h3 class="also-title">Also good ${esc(label)}</h3>
    ${shelfHTML(rest, ctx, { wornId: worn, tagOf })}
  </div>`;
}

// ---------- Asking once ----------
// Stars are the strongest say he has in picks (a 5★ wins the near ties most
// days are), but rating meant opening the bottle's page. So Now asks: its
// stars once he's wearing a bottle that has none, and how it wore the day
// after (nobody knows by the morning whether it lasted). Each once per
// bottle, answered or waved off (src/skin.js loadAsked), one at a time.

/**
 * The one question Now asks, or null: { kind: 'stars', f } for `worn`, the
 * record he's wearing in the window shown, while it has no stars; else
 * { kind: 'skin', f } for the first of `yesterday` (records worn yesterday,
 * the night's first) with neither nudge of his own yet. `asked`: loadAsked().
 */
export function askFor({ worn = null, yesterday = [], asked = {} }) {
  if (worn && !Number.isFinite(worn.personal?.rating) && !wasAsked(asked, worn.id, 'stars')) return { kind: 'stars', f: worn };
  const f = yesterday.find(r => !r.personal?.longevity && !r.personal?.sillage && !wasAsked(asked, r.id, 'skin'));
  return f ? { kind: 'skin', f } : null;
}

// How it wore, in the words of the day after: the bottle page's nudges
// (src/views/bottle-skin.js), none chosen until he answers.
const LASTED = [[-1, 'Faded early'], [0, 'As expected'], [1, 'Lasted longer']];
const PROJECTED = [[-1, 'Less'], [0, 'As expected'], [1, 'More']];
const answerSeg = (items, now, opts) => segHTML(items.map(([value, label]) => ({ value, label, on: value === now })), { ...opts, cls: 'wide' });

// What the last answer did, under the question ("Rated 5★. Now 1st for
// today, was 3rd."); screen readers hear it from app.announce.
const saidHTML = said => (said ? `<p class="ask-said">${esc(said)}</p>` : '');

/**
 * Its stars, in the pick card under Wear this: five of them (the bottle
 * page's), and Not now; once rated (`rating`), the stars stay for this
 * visit with what the rating did (`said`), so arrows can still move it.
 */
export function askStarsHTML(f, { rating = null, said = '' } = {}) {
  return `<div class="ask ask-stars">
    <div class="ask-row">
      <p class="ask-title" id="ask-title">${rating ? 'Your rating' : 'Rate it'}<span class="visually-hidden">: ${esc(f.name)}</span></p>
      <div class="ask-pick">
        ${starsHTML(rating, { action: 'ask-rate', labelledby: 'ask-title', id: f.id })}
        ${said ? '' : `<button class="link-btn ask-skip" data-action="ask-skip" data-kind="stars" data-id="${esc(f.id)}">Not now</button>`}
      </div>
    </div>
    ${saidHTML(said)}
  </div>`;
}

/**
 * How yesterday's bottle wore on him, under today's picks: how long it
 * lasted and how far it projected against the crowd's votes (the bottle
 * page's nudges). Nothing chosen until he answers (`answers`, this visit's);
 * then what was saved (`said`), and Done for Not now.
 */
export function askSkinHTML(f, { answers = {}, said = '' } = {}) {
  const id = f.id;
  const answered = 'longevity' in answers || 'sillage' in answers;
  return `<div class="ask ask-skin" role="group" aria-labelledby="ask-title">
    <div class="ask-head">${img(f)}<p class="ask-title" id="ask-title">How did <b>${esc(f.name)}</b> wear yesterday?</p></div>
    <div class="ask-row stacked"><span class="ask-label">It lasted</span>${answerSeg(LASTED, answers.longevity, { action: 'ask-lasts', label: 'How long it lasted', id })}</div>
    <div class="ask-row stacked"><span class="ask-label">It projected</span>${answerSeg(PROJECTED, answers.sillage, { action: 'ask-projects', label: 'How far it projected', id })}</div>
    ${saidHTML(said)}
    <div class="ask-actions"><button class="btn tertiary compact" data-action="ask-skip" data-kind="skin" data-id="${esc(id)}">${answered ? 'Done' : 'Not now'}</button></div>
  </div>`;
}

// The question answered on this visit to Now (a visit is state.base: the
// next starts afresh), so it stays put while he answers: its kind, bottle,
// the answers so far and what the last one did.
let held = null; // { kind, id, base, answers, said }
const heldNow = () => (held && held.base === state.base ? held : null);

/** Forget the question held on screen (tests; a new visit does it itself). */
export function forgetAsked() {
  held = null;
}

// Now's question as markup: { inPick } for the pick's stars, { below } for
// how yesterday's bottle wore. One at a time; one being answered holds its
// place.
function nowQuestion(pick, worn) {
  const records = rankedFragrances();
  const byId = id => records.find(f => f.id === id) ?? null;
  const wearing = worn && pick.fragrance.id === worn ? pick.fragrance : null;
  const h = heldNow();
  if (h?.kind === 'stars' && wearing?.id === h.id) return { inPick: askStarsHTML(wearing, { rating: wearing.personal?.rating ?? null, said: h.said }), below: '' };
  if (h?.kind === 'skin' && byId(h.id)) return { inPick: '', below: askSkinHTML(byId(h.id), h) };
  const day = shiftISO(state.wx.todayISO, -1);
  const yesterday = [...new Set(['night', 'day'].map(slot => wornIn(state.history, day, slot)?.id).filter(Boolean))].map(byId).filter(Boolean);
  const ask = askFor({ worn: wearing, yesterday, asked: loadAsked() });
  if (ask?.kind === 'stars') return { inPick: askStarsHTML(ask.f), below: '' };
  return { inPick: '', below: ask ? askSkinHTML(ask.f) : '' };
}

// ---------- Week ----------

// A window's pick: the bottle with its time of day as a badge on the photo,
// and marks for a logged wear and for a bottle the rotation nudge brought
// back ("Not worn in 34 days" in a row, "34 days" under the clock in the
// board's narrow columns, which the board's note explains).
function weekPick(p, slot, dayName) {
  if (!p) return `<span class="wk-pick empty"><span class="wk-slot">${slotIcon(slot)}</span><span class="wk-none">Done for today</span></span>`;
  const f = p.pick.fragrance;
  const nudge = nudgeOf(p.pick);
  const short = p.pick.parts?.unworn ? 'Unworn' : plural(p.pick.parts?.idle ?? 0, 'day');
  const spoken = [`${dayName} ${slot === 'day' ? 'daytime' : 'night'}: ${f.name}`, p.worn && 'wearing', nudge].filter(Boolean).join(', ');
  return `<button class="wk-pick${p.worn ? ' worn' : ''}" data-action="open" data-ctx="${esc(p.ctx)}" data-id="${esc(f.id)}" aria-label="${esc(spoken)}"${nudge ? ` title="${esc(nudge)}"` : ''}>
    ${img(f)}
    <span class="wk-slot">${p.worn ? icon.check : slotIcon(slot)}</span>
    <span class="wk-text"><b>${esc(f.name)}</b>${nudge ? `<small class="wk-nudge">${icon.clock}<span class="wk-long">${esc(nudge)}</span><span class="wk-short">${esc(short)}</span></small>` : ''}</span>
  </button>`;
}

// Whether one bottle is planned for two windows in a row (a list of one or
// two can't avoid it, nor can wears already logged).
function repeats(days) {
  const picks = days.flatMap(d => [d.day, d.night]).filter(Boolean).map(p => p.pick.fragrance.id);
  return picks.some((id, i) => i > 0 && id === picks[i - 1]);
}

export function weekHTML(days) {
  const nudged = days.some(d => d.day?.pick.nudged || d.night?.pick.nudged);
  const rows = days.map(d => `
    <li class="wk-day${d.isToday ? ' today' : ''}">
      <div class="wk-date"><b>${esc(d.isToday ? 'Today' : weekdayShort(d.dateISO))}</b><small>${esc(shortDate(d.dateISO))}</small></div>
      <div class="wk-wx">${wxIcon(d.category, d.condition)}<span class="wk-temps"><b>${deg(d.hiF)}</b><small>${deg(d.loF)}</small></span>${d.pop >= 30 ? `<span class="wk-pop">${d.pop}%<span class="visually-hidden"> chance of</span> rain</span>` : '<span class="wk-pop" aria-hidden="true">&nbsp;</span>'}</div>
      <div class="wk-picks">${weekPick(d.day, 'day', d.name)}${weekPick(d.night, 'night', d.name)}</div>
    </li>`).join('');
  const how = repeats(days) ? 'Planned against the forecast.' : 'Planned against the forecast so nothing repeats back to back.';
  return `<section class="card week" aria-labelledby="week-title">
    ${sectionHead(`${icon.calendar}The week ahead`, `<p>${how} Open a bottle to see why.</p>${nudged ? `<p class="wk-legend">${icon.clock}<span>A bottle you haven’t worn in a while gets a turn.</span></p>` : ''}`, { id: 'week-title' })}
    <ol class="wk-list${nudged ? ' nudged' : ''}" style="--days:${days.length}">${rows}</ol>
  </section>`;
}

// ---------- Occasion controls ----------

// A radio group: one tab stop, arrow keys move the choice (the shell's
// roving keys). Compact tiles, a glyph over a name, so the picks below lead
// the page; each blurb is the tile's tooltip, which screen readers give as
// its description (its name is the label alone).
export function occasionPickerHTML(activeId) {
  return `<div class="occasions" role="radiogroup" aria-label="Occasion" data-keep-scroll="occasions" style="--n:${OCCASIONS.length}">
    ${OCCASIONS.map(o => `<button class="occ${o.id === activeId ? ' on' : ''}" role="radio" aria-checked="${o.id === activeId}" tabindex="${o.id === activeId ? 0 : -1}" data-action="occasion" data-value="${o.id}" title="${esc(o.blurb)}">
      <span class="occ-icon">${icon[o.icon] ?? icon.sparkle}</span>
      <span class="occ-label">${esc(o.label)}</span>
    </button>`).join('')}
  </div>`;
}

// ---------- Journal teaser ----------

export function journalTeaserHTML({ strip, stats }, resolve) {
  const cells = strip.map(c => {
    const worn = [c.day, c.night].map(h => h && resolve(h.id)).filter(Boolean);
    return `<span class="jt-cell${c.isToday ? ' today' : ''}"${c.isToday ? ' aria-current="date"' : ''}>
      <small>${esc(c.label)}</small>
      <span class="jt-bottles">${worn.length ? worn.map(f => img(f)).join('') : '<i></i>'}</span>
    </span>`;
  }).join('');
  return `<section class="card journal-teaser" aria-labelledby="jt-title">
    ${sectionHead(`${icon.journal}Wear journal`, `<a class="btn secondary compact" href="#/wardrobe/worn">Open ${icon.chevron}</a><p>${plural(stats.wears, 'wear')} of ${plural(stats.bottles, 'bottle')} in 30 days</p>`, { id: 'jt-title' })}
    <div class="jt-strip">${cells}</div>
  </section>`;
}

function journalTeaser() {
  if (!state.history.length || !state.wx) return '';
  const today = state.wx.todayISO;
  const strip = Array.from({ length: 7 }, (_, i) => {
    const dateISO = shiftISO(today, i - 6);
    const isToday = dateISO === today;
    return {
      dateISO,
      isToday,
      label: shortDate(dateISO).split(' ')[1],
      day: wornIn(state.history, dateISO, 'day'),
      night: wornIn(state.history, dateISO, 'night'),
    };
  });
  return journalTeaserHTML({ strip, stats: journalStats(state.history, today) }, findRecord);
}

// ---------- Panes ----------

const banner = () => (state.shared ? sharedBannerHTML(state.shared, state.mine.records.length, { slim: true, confirm: state.armed === 'shared-save' }) : '');

function emptyState() {
  if (state.shared) {
    // Closing the link ranks the list under it again: name that one.
    const under = state.active === 'mine' ? 'Mine' : 'David’s wardrobe';
    return state.shared.loading
      ? skeletonHTML(1)
      : messageHTML({ glyph: icon.share, title: 'Nothing to show', body: 'None of the bottles in this link could be loaded.',
        action: `<button class="btn primary" data-action="shared-close"><span>Back to ${under}</span></button>` });
  }
  if (!sourceRecords().length) {
    return messageHTML({ glyph: icon.bottle, title: 'Your collection is empty', body: 'Add the bottles you own and picks start right away.',
      action: `<div class="message-actions">
        <a class="btn primary" href="#/discover">${icon.search}<span>Find your bottles</span></a>
        <button class="btn secondary" data-action="import">${icon.paste}Paste a list</button>
        <button class="btn tertiary" data-action="collection" data-value="demo">Use David’s wardrobe</button>
      </div>` });
  }
  return messageHTML({ glyph: icon.hide, title: 'Every bottle is switched off', body: 'Turn some back on to get picks.',
    action: '<a class="btn primary" href="#/wardrobe/owned"><span>Open your wardrobe</span></a>' });
}

// What a pane shows before it can rank: no place, no forecast, no bottles.
function guard() {
  if (!state.loc) {
    return messageHTML({ glyph: icon.pin, title: 'Set your location', body: 'Picks are based on your local forecast.',
      action: `<button class="btn primary" data-action="location">${icon.pin}<span>Choose location</span></button>` });
  }
  if (!state.wx) {
    return state.error
      ? messageHTML({ glyph: icon.cloud, title: 'Couldn’t load the weather', body: state.error,
        action: `<button class="btn primary" data-action="refresh">${icon.refresh}<span>Try again</span></button>` })
      : skeletonHTML(1);
  }
  if (!activeFragrances().length) return banner() + emptyState();
  return null;
}

function nowPane() {
  const blocked = guard();
  if (blocked) return blocked;
  // A forecast without hours for either window (a model gap): nothing to rank yet.
  if (!nowSlot()) return skeletonHTML(1);
  const { win, ranked, pick } = nowSlot();
  const worn = wornId(win);
  const slots = todaySlots();
  const other = slots.find(p => p.win.slot !== win.slot);
  // Ties as the CLI finds them for the same plan: none once he's wearing one.
  const ties = planTies(slots, { history: state.history })[slots.findIndex(p => p.win === win)] ?? [];
  const ask = nowQuestion(pick, worn);
  return `${banner()}
    <section class="card slot" aria-labelledby="slot-title">
      ${slotHeadHTML(win, nowHour(), { id: 'slot-title' })}
      <div class="now-picks">
        ${pickHTML(pick, win.slot, worn, { canWear: canWear(win), spray: sprayGuide(pick.fragrance, win), ties, win, ask: ask.inPick })}
        ${other ? nextWindowHTML(other, wornId(other.win), nowHour()) : ''}
      </div>
      ${ask.below}
      ${alsoHTML(ranked, pick, win.slot, worn, win.slot === 'day' ? 'by day' : 'tonight', { tags: true })}
    </section>
    ${journalTeaser()}`;
}

const occasionOf = route => occasionById(route.arg ?? state.occasion) ?? occasionById('casual');
// "formal wear", "the office", "a night in": the occasion as the engine's reasons name it.
const phraseOf = occasion => occasion.phrase ?? occasion.label.toLowerCase();

// "Formal · Sat night in Chicago": the window's once it's known, before that
// (or when its weather didn't come) the date and time asked for.
function occasionHeading(route, ev = state.wx ? when.eventWindow(state.occasionSlot ?? occasionOf(route).slot) : null) {
  const occasion = occasionOf(route);
  const { dateISO, place } = when.when;
  const today = state.wx?.todayISO;
  if (ev?.status === 'ready') return when.occasionTitle(occasion, ev.win, { today, place });
  if (today && (dateISO || place)) return when.occasionTitle(occasion, { dateISO: dateISO ?? today, slot: state.occasionSlot ?? occasion.slot }, { today, place });
  return `Picks for ${phraseOf(occasion)}${place ? ` in ${place.name}` : ''}`;
}

function occasionPane(app, route) {
  const blocked = guard();
  const occasion = occasionOf(route);
  if (blocked) return occasionPickerHTML(occasion.id) + blocked;
  const slot = state.occasionSlot ?? occasion.slot;
  const ev = when.eventWindow(slot, app);
  const bar = when.whenBarHTML({ ...when.when, home: state.loc, today: state.wx.todayISO, slot: ev.win?.slot ?? slot, wx: state.wx });
  const head = `${banner()}${occasionPickerHTML(occasion.id)}${bar}`;
  if (ev.status === 'loading') return head + skeletonHTML(1);
  if (ev.status === 'error') {
    const where = when.when.place ? `in ${when.when.place.name}` : 'for that date';
    return head + messageHTML({ glyph: icon.cloud, title: `Couldn’t get the weather ${where}`, body: ev.error,
      action: `<button class="btn primary" data-action="occ-when-retry">${icon.refresh}<span>Try again</span></button>` });
  }
  const { win } = ev;
  // The rotation nudge only for today here: on another date the journal
  // can't say what will have been worn by then, and a wedding wants the best.
  const ranked = rankContext('occ', win, occasion, { nudge: Boolean(ev.here) });
  const worn = wornId(win);
  // A nudged pick isn't the best for it (that one leads Also good).
  const kicker = ranked[0].nudged ? 'Due a wear' : `Best for ${phraseOf(occasion)}`;
  return `${head}
    <section class="card slot" aria-labelledby="occ-title">
      ${slotHeadHTML(win, ev.here ? nowHour() : -1, { id: 'occ-title', thumb: true, title: occasionHeading(route, ev) })}
      ${pickHTML(ranked[0], 'occ', worn, { canWear: canWear(win), full: true, kicker })}
      ${alsoHTML(ranked, ranked[0], 'occ', worn, `for ${phraseOf(occasion)}`)}
    </section>`;
}

// Keeps the chosen occasion in view in the sideways strip on phones, with a
// whole tile before it (a tile cut at the edge read as one of its own:
// "Night" beside "Night Out"), so the ones after it peek out at the far edge
// and the strip reads as one that scrolls. The tiles snap to that edge too
// (wear.css). Only when it's cut off, so a tap doesn't jolt the strip.
function showChosenOccasion() {
  const strip = document.querySelector('.occasions');
  const card = strip?.querySelector('[aria-checked="true"]');
  if (!card || strip.scrollWidth <= strip.clientWidth) return;
  const s = strip.getBoundingClientRect(), c = card.getBoundingClientRect(), pad = 16, fade = 28;
  if (c.left >= s.left + pad && c.right <= s.right - fade) return;
  const lead = card.previousElementSibling ?? card;
  let by = lead.getBoundingClientRect().left - (s.left + pad);
  if (c.right - by > s.right - fade) by = c.left - (s.left + pad);
  strip.scrollLeft += by;
}

function weekPane() {
  return guard() ?? banner() + weekHTML(computeWeek());
}

// Packing for a trip (wear/trip.js): no forecast of your own needed, only bottles.
function tripPane(app) {
  if (!state.demo && !state.shared && state.active === 'demo') return skeletonHTML(1);
  if (!activeFragrances().length) return banner() + emptyState();
  return banner() + trip.renderTrip(app);
}

const place = () => state.loc?.name ?? 'your area';

export const wear = {
  id: 'wear',
  label: 'Wear',
  icon: 'wear',
  panes: [
    { id: 'now', label: 'Now', title: () => 'Now', heading: () => `What to wear in ${place()}`, render: nowPane },
    { id: 'week', label: 'Week', title: () => 'Week', heading: () => `The week ahead in ${place()}`, render: weekPane },
    {
      id: 'occasion',
      label: 'Occasion',
      title: route => occasionOf(route).label,
      heading: route => occasionHeading(route),
      render: occasionPane,
      after: showChosenOccasion,
    },
    { id: 'trip', label: 'Trip', title: () => 'Trip', heading: trip.tripHeading, render: tripPane, after: app => trip.freshenTrip(app) },
  ],
  // The headings are for screen readers and the tab title: the hero says it.
  hiddenHeading: true,
  hero: {
    compact: route => route.pane !== 'now',
    render(route, aspect) {
      const now = route.pane === 'now' && state.wx ? nowSlot() : null;
      const pick = now?.pick ? { entry: now.pick, win: now.win, worn: wornId(now.win) === now.pick.fragrance.id } : null;
      return heroHTML(state, { aspect, compact: route.pane !== 'now', pick, slots: todaySlots(), slotOn: now?.win.slot });
    },
  },
};

// ---------- Actions ----------

// The bottle page's spray section, once the page is in (the bottle page's
// owner draws it at order 250; this looks for #bp-spray, else a section
// headed about spraying). Its heading takes focus, so a keyboard lands there.
function showSpraySection(tries = 0) {
  const panel = document.querySelector('#bottle .bp-panel');
  const section = panel?.querySelector('#bp-spray, [data-section="spray"]')
    ?? [...(panel?.querySelectorAll('.bp-section') ?? [])].find(s => /spray/i.test(s.querySelector('h3')?.textContent ?? ''));
  if (!section) {
    if (tries < 40) requestAnimationFrame(() => showSpraySection(tries + 1));
    return;
  }
  const top = panel.scrollTop + section.getBoundingClientRect().top - panel.getBoundingClientRect().top - 16;
  panel.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const head = section.querySelector('h3') ?? section;
  if (!head.hasAttribute('tabindex')) head.setAttribute('tabindex', '-1');
  head.focus({ preventScroll: true });
}

// What a nudge of his own says once saved: "Saved: it lasts longer and
// sits closer on you."
const LASTS_WORDS = { 1: 'lasts longer', [-1]: 'fades faster' };
const PROJECTS_WORDS = { 1: 'projects more', [-1]: 'sits closer' };
export function skinSaid({ longevity = 0, sillage = 0 }) {
  const words = [LASTS_WORDS[longevity], PROJECTS_WORDS[sillage]].filter(Boolean);
  return words.length ? `Saved: it ${words.join(' and ')} on you.` : 'Saved: it wears as voters say.';
}

function answerSkin(el, app, key) {
  const { id } = el.dataset;
  const value = Number(el.dataset.value);
  setSkin(id, { [key]: value });
  markAsked(id, 'skin');
  const h = heldNow()?.kind === 'skin' && held.id === id ? held : null;
  const answers = { ...h?.answers, [key]: value };
  held = { kind: 'skin', id, base: state.base, answers, said: skinSaid(answers) };
  app.keepingFocus(el, '#app', app.render);
  app.announce?.(held.said);
}

export const actions = {
  ...trip.actions,
  ...when.actions,
  ...pickers.actions,
  // Logs (or clears) a wear for the window of the list it's in, with the use
  // it was for (the Occasion pane's occasion, an event's on a trip, else
  // 'daily'), which the gap finder's "How you wear" counts.
  wear(el, app) {
    const ctx = state.contexts[el.dataset.ctx];
    if (!ctx) return;
    state.history = toggleWear(el.dataset.id, ctx.win.dateISO, ctx.win.slot, state.loc, ctx.occasion?.id ?? 'daily');
    if (wornIn(state.history, ctx.win.dateISO, ctx.win.slot)) navigator.vibrate?.(12);
    app.keepingFocus(el, '#app', app.render);
  },
  // The pick card's spray line: its bottle page, at the spray section. The
  // bottle flies from the hero when it's in view.
  'spray-open'(el, app) {
    app.openBottle(el.dataset.id, el.dataset.ctx, document.querySelector('.hero-pick'));
    setTimeout(() => showSpraySection(), 120);
  },
  // Now's "Rate it": the stars save as the bottle page's do and stay for
  // this visit, saying where the bottle moved in the window's list. The same
  // star tapped again takes the rating off; keys only ever choose.
  'ask-rate'(el, app, event) {
    const id = el.dataset.id;
    const ctx = state.contexts[nowSlot()?.win.slot];
    if (!ctx) return;
    const again = el.getAttribute('aria-checked') === 'true';
    if (again && !(event?.detail > 0)) return;
    const stars = again ? null : Number(el.dataset.value);
    const placeOf = () => { const i = state.contexts[ctx.win.slot]?.ranked.findIndex(r => r.fragrance.id === id) ?? -1; return i >= 0 ? i + 1 : null; };
    const before = placeOf();
    setSkin(id, { rating: stars });
    markAsked(id, 'stars');
    computeToday();
    const moved = moveText(before, placeOf(), listLabel(ctx.win));
    held = { kind: 'stars', id, base: state.base, said: `${stars ? `Rated ${stars}★.` : 'Rating cleared.'} ${moved}`.trim() };
    app.keepingFocus(el, '#app', app.render);
    app.announce?.(held.said);
  },
  // How yesterday's bottle wore: each answer saves at once (asked from the
  // first), and the question stays for the other until Done.
  'ask-lasts'(el, app) {
    answerSkin(el, app, 'longevity');
  },
  'ask-projects'(el, app) {
    answerSkin(el, app, 'sillage');
  },
  // Not now (or Done): never asked again about this bottle. Focus goes on to
  // what follows the question: Wear this after the stars, the shelf after
  // how yesterday's wore.
  'ask-skip'(el, app) {
    const { id, kind } = el.dataset;
    markAsked(id, kind);
    held = null;
    const seen = app.inSight?.(el) ?? false;
    app.render();
    if (!globalThis.document || el.isConnected) return;
    const next = document.querySelector(kind === 'stars' ? '#app .pick .wear-btn' : '#app .also .shelf-item') ?? document.querySelector('#app .pick .wear-btn');
    if (next) app.refocus(next, '#app', { reveal: seen });
  },
  // Now's Day/Night toggle in the hero.
  slot(el, app) {
    state.slot = el.dataset.value;
    app.keepingFocus(el, '#app', app.renderPage);
  },
  occasion(el, app) {
    const id = el.dataset.value;
    state.occasion = id;
    state.occasionSlot = null;
    savePrefs();
    app.keepingFocus(el, '#app', () => app.navigate(routeHash({ dest: 'wear', pane: 'occasion', arg: id }), { replace: true, quiet: true }));
  },
  'occ-slot'(el, app) {
    state.occasionSlot = el.dataset.value;
    app.keepingFocus(el, '#app', app.renderPage);
  },
};

export const forms = { ...trip.forms, ...pickers.forms };
export const fields = { ...pickers.fields };
export const changes = { ...trip.changes, ...when.changes };
export const sheets = { ...pickers.sheets };
