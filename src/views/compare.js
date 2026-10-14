// The compare page (#/compare/<id>,<id>[,<id>]): two or three bottles side
// by side, with which to wear tonight on top, then how each fits now and for
// the saved occasion, how they relate (dupe, voted alike, alike by notes),
// and their accords, seasons, performance, value, styles and blind-buy risk.
// The bottles stand in columns at every width, under a strip of their photos
// that sticks to the top once their cards scroll away; on phones the accords
// and seasons stack, a small photo naming each. "Compare with…" (the
// cmp-pick sheet) picks the bottles, from a bottle page's Compare or from
// here. Not in the nav, like Settings. Styles: src/css/bottle.css (.cmp-*).
import { rank, SEASONS, performanceRating } from '../engine.js';
import { occasionById } from '../occasions.js';
import { similarity } from '../similar.js';
import { signalsOf } from '../candidates.js';
import { topStyles, wearsClose } from '../scent-styles.js';
import { loadSkin, applySkin } from '../skin.js';
import { loadAbout } from '../fragrantica.js';
import { isCustomId, fromShareToken } from '../custom.js';
import { normalize } from '../collections.js';
import { esc, matchPct, plural, displayReasons } from '../ui.js';
import { icon, img, accordColor, messageHTML, sheetFrame } from '../ui/components.js';
import { compareIds, routeHash } from '../app/router.js';
import { askPool } from '../app/pool.js';
import {
  state, findRecord, inSource, activeFragrances, library, keepBottles, nowSlot, findBottles, poolInputs,
} from '../app/state.js';
import { familyOf } from './bottle-dupes.js';
import { riskLine } from './bottle-crowd.js';
import { linkId } from './bottle.js';

export const MAX_COMPARE = 3;
const ACCORDS_SHOWN = 5;
const SEASON_LABELS = { winter: 'Winter', spring: 'Spring', summer: 'Summer', fall: 'Fall' };
// Likeness by accords and notes (src/similar.js), in words.
const ALIKE = [[0.85, 'Nearly the same scent'], [0.6, 'Close'], [0.35, 'Some common ground'], [-Infinity, 'Quite different']];
// Two picks this close for tonight are a toss-up.
const TOSS_UP = 0.03;
// Suggestions a lone bottle's empty column offers.
const SUGGEST = 3;

const num = n => Number(n).toLocaleString('en-US');
const pct = x => `${Math.round(x * 100)}%`;
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const hrefFor = ids => routeHash({ dest: 'compare', arg: ids.join(',') });
const onCompare = () => state.base?.dest === 'compare';

// ---------- The model ----------

// Ids the library answered for without them, or that couldn't load (offline).
const missing = new Set();
const failed = new Set();
const loading = new Set();
const askedAbout = new Set();
const askedSignals = new Set();
// Smells-like families the page asked the pool for (a lone bottle's suggestions).
const families = new Map();

const aboutFor = f => f.about ?? state.about.get(f.id);

/**
 * How two bottles relate, the strongest evidence first: one copies the
 * other, voters say they smell alike (the about data's votes or the pool's
 * links), else how alike their accords and notes are. -> { text, sim, kind:
 * 'dupe' | 'voted' | 'alike' | null }
 */
export function relation(a, b, aboutA = null, aboutB = null) {
  const sim = a.accords && b.accords ? similarity(a, b) : null;
  // x's page votes that it smells like y, more for than against.
  const vote = (x, y, about) => {
    const v = about?.smellsLike?.find(s => String(s.id) === y.id);
    return v && v.up > v.down ? { x, y, v } : null;
  };
  const voted = vote(a, b, aboutA) ?? vote(b, a, aboutB);
  if (String(a.original?.id) === b.id) return { text: `${a.name} is inspired by ${b.name}.`, sim, kind: 'dupe' };
  if (String(b.original?.id) === a.id) return { text: `${b.name} is inspired by ${a.name}.`, sim, kind: 'dupe' };
  if (voted) return { text: `${num(voted.v.up)} voters say ${voted.x.name} smells like ${voted.y.name}.`, sim, kind: 'voted' };
  if (signalsOf(a).family.includes(b.id) || signalsOf(b).family.includes(a.id)) return { text: `Voters call ${a.name} and ${b.name} the same scent.`, sim, kind: 'voted' };
  if (signalsOf(a).like.includes(b.id) || signalsOf(b).like.includes(a.id)) return { text: `Voters say ${a.name} and ${b.name} smell alike.`, sim, kind: 'voted' };
  if (sim == null) return { text: '', sim, kind: null };
  return { text: `${a.name} and ${b.name}: ${ALIKE.find(([from]) => sim >= from)[1].toLowerCase()} by their accords and notes.`, sim, kind: 'alike' };
}

/**
 * A window's ranked entries for the bottles, best first. Bottles in the list
 * ranked for it (Now's, `ctxKey`) read their entry from there, the % Now
 * shows; the rest rank alone with your stars (src/skin.js), as a bottle
 * page does, so a 1★ bottle scores here as it does everywhere.
 */
function entriesFor(win, ready, { occasion = null, ctxKey = null } = {}) {
  const ctx = ctxKey && !occasion ? state.contexts[ctxKey] : null;
  const listed = ctx && ctx.win === win ? ready.map(f => ctx.entries.get(f.id)).filter(Boolean) : [];
  const rest = ready.filter(f => !listed.some(e => e.fragrance.id === f.id));
  const alone = rest.length ? rank(applySkin(rest, loadSkin()), win, win.slot, { occasion, history: state.history, todayISO: win.dateISO }) : [];
  return [...listed, ...alone].sort((a, b) => b.score - a.score);
}

/**
 * Everything the page shows, from the route and state: { ids, bottles:
 * [{ id, f, status: 'ready' | 'loading' | 'missing' | 'failed', owned }],
 * now and occ: { win, occasion?, entries: Map id -> ranked entry } (null
 * without a forecast), tonight: { win, ranked } (or null), waiting: the
 * forecast is on its way, pairs: [{ a, b, text, sim, kind }], family: a lone
 * bottle's smells-like family (or null), back: the bottle page it came from
 * (a route, or null), about(f) }.
 */
export function compareModel(route) {
  const ids = compareIds(route.arg);
  const bottles = ids.map(id => {
    const f = findRecord(id);
    const status = f ? 'ready' : missing.has(id) ? 'missing' : failed.has(id) ? 'failed' : 'loading';
    return { id, f, status, owned: Boolean(f) && inSource(f.id) };
  });
  const ready = bottles.filter(b => b.f).map(b => b.f);
  const entries = list => new Map(list.map(e => [e.fragrance.id, e]));
  const nowWin = nowSlot()?.win ?? null;
  const occasion = occasionById(state.occasion) ?? occasionById('casual');
  const occWin = state.wx ? state.wx[occasion.slot] ?? state.wx.day ?? state.wx.night : null;
  const nightWin = state.today?.night?.win ?? state.wx?.night ?? null;
  const pairs = [];
  for (let i = 0; i < ready.length; i++) {
    for (let j = i + 1; j < ready.length; j++) pairs.push({ a: ready[i], b: ready[j], ...relation(ready[i], ready[j], aboutFor(ready[i]), aboutFor(ready[j])) });
  }
  const has = ready.length > 0;
  return {
    ids,
    bottles,
    now: nowWin && has ? { win: nowWin, entries: entries(entriesFor(nowWin, ready, { ctxKey: nowWin.slot })) } : null,
    occ: occWin && has ? { win: occWin, occasion, entries: entries(entriesFor(occWin, ready, { occasion })) } : null,
    tonight: nightWin && has ? { win: nightWin, ranked: entriesFor(nightWin, ready, { ctxKey: 'night' }) } : null,
    waiting: !state.wx && Boolean(state.loc) && !state.error,
    pairs,
    family: ids.length === 1 ? familyOf(ids[0]) ?? families.get(ids[0]) ?? null : null,
    back: backTo && ids.length ? backTo : null,
    about: aboutFor,
  };
}

// ---------- Cells ----------

// A filled bar for a 0..1 share.
const meter = (x, cls = '') => `<span class="cmp-meter${cls ? ` ${cls}` : ''}" aria-hidden="true"><span style="width:${(Math.max(0, Math.min(1, x)) * 100).toFixed(1)}%"></span></span>`;

function matchCell(entry) {
  if (!entry) return '<span class="muted">—</span>';
  const why = displayReasons(entry, 1)[0]?.text ?? '';
  return `<span class="cmp-num">${matchPct(entry)}%</span>${meter(entry.score)}<span class="cmp-why">${esc(cap(why))}</span>`;
}

function accordsCell(f) {
  const top = Object.entries(f.accords ?? {}).slice(0, ACCORDS_SHOWN);
  if (!top.length) return '<span class="muted">—</span>';
  return `<ul class="cmp-accords">${top.map(([a, w]) => `<li><span class="cmp-accord-name">${esc(a)}</span><span class="cmp-meter" aria-hidden="true"><span style="width:${w}%;--c:${accordColor(a)}"></span></span></li>`).join('')}</ul>`;
}

function seasonsCell(f) {
  const peak = Math.max(...SEASONS.map(s => f.season?.[s] ?? 0)) || 1;
  const cols = SEASONS.map(s => `<li><span class="cmp-col-track"><span class="cmp-col" style="height:${(((f.season?.[s] ?? 0) / peak) * 100).toFixed(1)}%"></span></span><span class="cmp-col-pct">${pct(f.season?.[s] ?? 0)}</span><span>${SEASON_LABELS[s]}</span></li>`).join('');
  // Whole percents that add up to 100.
  const night = Math.round((f.dayNight?.night ?? 0.5) * 100);
  return `<ul class="cmp-seasons" aria-label="Seasons voted">${cols}</ul>
    <p class="cmp-daynight"><span>Day ${100 - night}%</span><span class="cmp-split" aria-hidden="true"><span style="width:${100 - night}%"></span></span><span>Night ${night}%</span></p>`;
}

// Parfumo's 0–10 ratings, or (≈) an estimate on that scale from
// Fragrantica's votes (engine performanceRating) for a bottle Parfumo lacks.
const estimated = f => !f.parfumo && Boolean(f.performance);

function performanceCell(f, key) {
  const p = performanceRating(f);
  if (p?.[key] == null) return '<span class="muted">No votes</span>';
  const guess = estimated(f);
  return `<span class="cmp-num"${guess ? ' title="Estimated from Fragrantica votes"' : ''}>${guess ? '≈ ' : ''}${p[key].toFixed(1)}<small> of 10</small>${guess ? '<span class="visually-hidden">, estimated from Fragrantica votes</span>' : ''}</span>${meter(p[key] / 10)}`;
}

// The value a performance row's lead is judged by: an estimate only
// against other estimates, never against Parfumo's own ratings.
const performanceShown = (bottles, key) => {
  const rated = bottles.some(b => b.f?.parfumo);
  return shownAs(1, f => (rated && estimated(f) ? null : performanceRating(f)?.[key]));
};

const valueOf = (f, about) => signalsOf(f).value ?? about?.value?.avg ?? null;

function valueCell(f, about) {
  const v = valueOf(f, about);
  if (v == null) return '<span class="muted">No votes</span>';
  const word = v >= 4 ? 'Great value' : v >= 3.4 ? 'Good value' : v >= 2.4 ? 'Fair price' : 'Pricey';
  return `<span class="cmp-num">${v.toFixed(1)}<small> of 5</small></span>${meter((v - 1) / 4)}<span class="cmp-why">${word}</span>`;
}

function stylesCell(f) {
  const styles = topStyles(f).map(s => s.label);
  if (wearsClose(f)) styles.push('Wears close');
  return styles.length ? `<ul class="cmp-tags">${styles.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '<span class="muted">No clear style</span>';
}

// The crowd block's words (bottle-crowd.js riskLine); a bottle you own isn't a blind buy.
function riskCell(f, about, owned) {
  if (owned) return '<span class="muted">You own it</span>';
  const risk = riskLine(f, about);
  if (!risk) return '<span class="muted">No crowd data</span>';
  return `<span class="cmp-risk" data-level="${risk.level}">${esc(risk.word)}</span>${risk.line ? `<span class="cmp-why">${esc(risk.line)}</span>` : ''}`;
}

const ratingCell = f => (f.rating ? `<span class="cmp-num">★ ${f.rating.toFixed(2)}</span><span class="cmp-why">${f.ratingVotes ? `${num(f.ratingVotes)} votes` : ''}</span>` : '<span class="muted">Unrated</span>');

// ---------- The page ----------

// A bottle's card: it opens its page (by its share token when it's a
// hand-entered bottle in no list, so the page finds it).
function headHTML(b, ids) {
  const name = b.f?.name ?? 'this bottle';
  const remove = ids.length > 1 || !b.f
    ? `<button class="cmp-remove" data-action="cmp-remove" data-id="${esc(b.id)}" aria-label="Remove ${esc(name)}">${icon.close}<span aria-hidden="true">Remove</span></button>` : '';
  if (!b.f) {
    const body = b.status === 'loading' ? '<span class="sk cmp-sk-photo"></span><span class="sk sk-line w70"></span>'
      : b.status === 'failed' ? `<span class="cmp-missing">Couldn’t load this bottle</span><button class="btn secondary compact" data-action="cmp-retry" data-id="${esc(b.id)}">${icon.refresh}<span>Try again</span></button>`
      : '<span class="cmp-missing">Not in the library</span>';
    return `<div class="cmp-head"${b.status === 'loading' ? ' aria-busy="true"' : ''}>${body}${b.status === 'loading' ? '' : remove}</div>`;
  }
  const f = b.f;
  return `<div class="cmp-head">
    <button class="cmp-open" data-action="open" data-ctx="" data-id="${esc(linkId(f))}">
      <span class="cmp-photo">${img(f, { lazy: false })}</span>
      <span class="cmp-name">${esc(f.name)}</span>
      <span class="cmp-brand">${esc([f.brand, f.year].filter(Boolean).join(' · '))}</span>
    </button>
    ${b.owned ? `<span class="cmp-owned">${icon.check}You own it</span>` : ''}
    ${remove}
  </div>`;
}

// One bottle alone: an empty column that asks for another, with a few from its family.
function addColumnHTML(family) {
  const picks = family ? [family.original, ...family.cheaper, ...family.siblings].filter(e => e?.record?.accords || /^\d+$/.test(e?.id ?? '')).slice(0, SUGGEST) : [];
  const list = picks.map(e => {
    const f = e.record ?? e;
    return `<li><button class="cmp-suggest" data-action="cmp-pick" data-id="${esc(e.id)}">${img(f)}<span>${esc(f.name)}</span>${icon.plus}</button></li>`;
  }).join('');
  return `<div class="cmp-head cmp-add">
    <button class="btn primary compact" data-action="cmp-add">${icon.plus}<span>Add a bottle</span></button>
    ${list ? `<p class="cmp-add-sub">Smells like it</p><ul class="cmp-suggests">${list}</ul>` : '<p class="cmp-add-sub">Pick one to see them side by side.</p>'}
  </div>`;
}

// The strip that sticks to the top once the cards scroll away: a photo and name per column.
const stripHTML = bottles => `<span class="cmp-sentinel" aria-hidden="true"></span><div class="cmp-strip" aria-hidden="true"><span class="cmp-corner"></span>${bottles.map(b => `<span class="cmp-strip-item">${b.f ? img(b.f) : ''}<span>${esc(b.f?.name ?? '')}</span></span>`).join('')}</div>`;

/**
 * One row: a label (HTML) and a cell per bottle. `best`: the id that leads
 * it, marked with `tag` ("Best"; `neutral` for one where more isn't better,
 * "Longest", "Loudest"). `stack`: on phones its cells stack, each named.
 */
function cmpRow(label, bottles, cell, { best = null, tag = 'Best', neutral = false, id = '', stack = false } = {}) {
  const cells = bottles.map(b => {
    const lead = best === b.id;
    // A row with a lead keeps the tag's line in every cell, so the numbers line up.
    const mark = best ? `<span class="cmp-lead-tag${lead ? '' : ' none'}">${lead ? tag : ''}</span>` : '';
    return `<div class="cmp-cell${lead ? ` lead${neutral ? ' neutral' : ''}` : ''}">
      <span class="cmp-who">${b.f ? img(b.f) : ''}<span>${esc(b.f?.name ?? '')}</span></span>
      <div class="cmp-val">${mark}${b.f ? cell(b.f, b) : ''}</div>
    </div>`;
  }).join('');
  return `<section class="cmp-row${stack ? ' stack' : ''}"${id ? ` aria-labelledby="${id}"` : ''}><h2 class="cmp-label"${id ? ` id="${id}"` : ''}>${label}</h2><div class="cmp-cells">${cells}</div></section>`;
}

// A row of skeleton cells while the forecast is on its way.
const skeletonRow = (label, bottles) => `<section class="cmp-row" aria-busy="true"><h2 class="cmp-label">${label}</h2><div class="cmp-cells">${bottles.map(() => '<div class="cmp-cell"><span class="cmp-who"></span><div class="cmp-val"><span class="sk sk-line w40"></span><span class="sk cmp-sk-meter"></span></div></div>').join('')}</div></section>`;

/**
 * The id whose value, as shown, leads the row (`shown` rounds it the way the
 * cell prints it), or null: on a tie as shown, nobody leads.
 */
export function leader(bottles, shown) {
  const scored = bottles.filter(b => b.f).map(b => [b.id, shown(b.f)]).filter(([, v]) => v != null && Number.isFinite(v));
  if (scored.length < 2) return null;
  const top = Math.max(...scored.map(([, v]) => v));
  const lead = scored.filter(([, v]) => v === top);
  return lead.length === 1 ? lead[0][0] : null;
}
const shownAs = (digits, value) => f => {
  const v = value(f);
  return v == null ? null : Number(v.toFixed(digits));
};

/**
 * Which to wear tonight. With a bottle you own among them, the pick is
 * yours: the best of them, with its match tonight and the better one's (the
 * rows may show another window's), and how they're linked ("Wear Détour
 * Noir: the best of yours tonight, 87% match. Layton, which it's inspired
 * by, matches 88%."). Without, the one that suits tonight best.
 */
export function verdictHTML(tonight, owned, pairs = []) {
  if (!tonight || tonight.ranked.length < 2) return '';
  const [first, second] = tonight.ranked;
  const mine = owned.size ? tonight.ranked.find(e => owned.has(e.fragrance.id)) : null;
  const name = e => `<i>${esc(e.fragrance.name)}</i>`;
  const good = e => e.reasons.find(r => r.tone === 'good')?.text ?? '';
  let pick = first, title, why;
  if (mine && mine !== first) {
    pick = mine;
    const link = pairs.find(p => [p.a.id, p.b.id].includes(mine.fragrance.id) && [p.a.id, p.b.id].includes(first.fragrance.id));
    const other = esc(first.fragrance.name);
    const who = link?.kind === 'dupe' ? `${other}, ${String(mine.fragrance.original?.id) === first.fragrance.id ? 'which it’s inspired by' : 'which copies it'},` : other;
    const same = matchPct(first) === matchPct(mine) ? ' too' : '';
    title = `Wear ${name(mine)}`;
    why = `The best of yours tonight, ${matchPct(mine)}% match. ${who} matches ${matchPct(first)}%${same}${link?.kind === 'voted' ? ', and voters say they smell alike' : ''}.`;
  } else {
    const close = first.score - second.score < TOSS_UP;
    title = close ? `Close call: ${name(first)} by a nose` : owned.has(first.fragrance.id) ? `Wear ${name(first)}` : `${name(first)} suits tonight best`;
    const reason = good(first);
    why = `${reason ? `${esc(cap(reason))}. ` : ''}${matchPct(first)}% match, against ${esc(second.fragrance.name)}’s ${matchPct(second)}%.`;
  }
  return `<section class="cmp-verdict" aria-labelledby="cmp-verdict-title">
    <span class="cmp-verdict-photo">${img(pick.fragrance, { lazy: false })}</span>
    <div>
      <p class="cmp-kicker">${icon.moon}Pick for ${esc(tonight.win.label.toLowerCase())}</p>
      <h2 id="cmp-verdict-title">${title}</h2>
      <p class="cmp-verdict-why">${why}</p>
    </div>
  </section>`;
}

const verdictSkeleton = '<section class="cmp-verdict" aria-busy="true"><span class="sk cmp-sk-photo"></span><div class="sk-lines"><span class="sk sk-line w40"></span><span class="sk sk-line w70"></span><span class="sk sk-line"></span></div><span class="visually-hidden">Waiting for the forecast</span></section>';

// "Match today", "Match tonight", "Match tomorrow night".
const matchLabel = win => `Match ${/^(Today|Tonight|Tomorrow)/.test(win.label) ? win.label.toLowerCase() : `on ${win.label}`}`;

// "for today and tonight", "for tonight".
function windowsText(m) {
  const now = m.now?.win, night = m.tonight?.win;
  if (!now) return '';
  return now === night || !night ? `, for ${now.label.toLowerCase()}` : `, for ${now.label.toLowerCase()} and ${night.label.toLowerCase()}`;
}

/** The page for compareModel()'s model. */
export function compareHTML(m) {
  const { ids, bottles } = m;
  if (!ids.length) {
    return messageHTML({ glyph: icon.compare, title: 'Compare up to three bottles', body: 'Open any bottle and tap Compare, or start here.',
      action: `<button class="btn primary" data-action="cmp-add">${icon.plus}<span>Pick a bottle</span></button>` });
  }
  const back = m.back ? `<button class="btn tertiary compact cmp-back" data-action="cmp-back">${icon.back}<span>${esc(findRecord(m.back.arg)?.name ?? 'Back')}</span></button>` : '';
  const add = ids.length > 1 && ids.length < MAX_COMPARE ? `<button class="btn secondary compact" data-action="cmp-add">${icon.plus}<span>Add a bottle</span></button>` : '';
  const bar = `<div class="cmp-bar">${back}<p class="muted small">${ids.length === 1 ? 'Add a bottle to see them side by side.' : `${plural(ids.length, 'bottle')} side by side${windowsText(m)}.`}</p>${add}</div>`;
  const alone = ids.length === 1;
  const columns = alone ? [...bottles, { id: '', f: null, status: 'add', owned: false }] : bottles;
  const heads = `<div class="cmp-heads"><span class="cmp-corner" aria-hidden="true"></span>${bottles.map(b => headHTML(b, ids)).join('')}${alone ? addColumnHTML(m.family) : ''}</div>`;
  const ready = bottles.filter(b => b.f);
  if (alone || !ready.length) {
    return `<div class="cmp alone" style="--n:${columns.length}">${bar}${heads}</div>`;
  }
  const pairs = m.pairs.filter(p => p.text);
  const scoreIn = ctx => shownAs(2, f => (ctx.entries.get(f.id) ? matchPct(ctx.entries.get(f.id)) / 100 : null));
  const match = m.waiting && !m.now ? [skeletonRow('Match today', bottles), skeletonRow('For your occasion', bottles)]
    : [
      m.now && cmpRow(esc(matchLabel(m.now.win)), bottles, f => matchCell(m.now.entries.get(f.id)), { best: leader(bottles, scoreIn(m.now)), id: 'cmp-now' }),
      m.occ && cmpRow(esc(`${m.occ.occasion.label} · ${m.occ.win.label.toLowerCase()}`), bottles, f => matchCell(m.occ.entries.get(f.id)), { best: leader(bottles, scoreIn(m.occ)), id: 'cmp-occ' }),
    ];
  const rows = [
    ...match,
    cmpRow('Rating', bottles, ratingCell, { best: leader(bottles, shownAs(2, f => f.rating || null)), id: 'cmp-rating' }),
    cmpRow('Main accords', bottles, accordsCell, { id: 'cmp-accords', stack: true }),
    cmpRow('Seasons', bottles, seasonsCell, { id: 'cmp-seasons', stack: true }),
    cmpRow('Lasts', bottles, f => performanceCell(f, 'longevity'), { best: leader(bottles, performanceShown(bottles, 'longevity')), tag: 'Longest', neutral: true, id: 'cmp-lasts' }),
    cmpRow('Projects', bottles, f => performanceCell(f, 'sillage'), { best: leader(bottles, performanceShown(bottles, 'sillage')), tag: 'Loudest', neutral: true, id: 'cmp-projects' }),
    cmpRow('Value for money', bottles, f => valueCell(f, m.about(f)), { best: leader(bottles, shownAs(1, f => valueOf(f, m.about(f)))), id: 'cmp-value' }),
    cmpRow('Style', bottles, stylesCell, { id: 'cmp-style' }),
    cmpRow('Blind buy', bottles, (f, b) => riskCell(f, m.about(f), b.owned), { id: 'cmp-risk' }),
  ].filter(Boolean).join('');
  // Each line says what backs it: a dupe link, voters, or likeness by accords and notes (with its number).
  const tag = p => (p.kind === 'alike' ? `${pct(p.sim)} alike` : p.kind === 'dupe' ? 'Dupe' : 'Voted');
  const relations = pairs.length ? `<section class="cmp-relations" aria-labelledby="cmp-rel-title"><h2 id="cmp-rel-title" class="cmp-label">How they relate</h2><ul>${pairs.map(p => `<li><span class="cmp-sim">${tag(p)}</span><span>${esc(p.text)}</span></li>`).join('')}</ul></section>` : '';
  const verdict = m.waiting && !m.tonight ? verdictSkeleton : verdictHTML(m.tonight, new Set(bottles.filter(b => b.owned && b.f).map(b => b.f.id)), m.pairs);
  return `<div class="cmp" style="--n:${bottles.length}">
    ${bar}
    ${verdict}
    ${heads}
    ${relations}
    <div class="cmp-table">${stripHTML(bottles)}${rows}</div>
    <p class="bp-credit">Ratings, votes and value from Fragrantica members, via Le Decanteur’s dataset. How long they last and how far they project from Parfumo${ready.some(b => estimated(b.f)) ? ', or estimated (≈) from Fragrantica votes where Parfumo lacks the bottle' : ''}.</p>
  </div>`;
}

// ---------- Loading ----------

// Draws the page again as something it loads lands, focus kept: on the
// control's successor, else the element with its id (the heading), else the
// heading. Never on the body.
function redraw(app) {
  if (!onCompare()) return;
  const focused = document.activeElement;
  const inMain = Boolean(focused?.closest?.('#main'));
  app.renderPage();
  if (!inMain || focused.isConnected || app.refocus(focused, '#main')) return;
  ((focused.id && document.getElementById(focused.id)) || document.querySelector('#page-title'))?.focus({ preventScroll: true });
}

// The route the page last arrived on: arriving anew (a link from a bottle
// page, which closes as the page opens), focus left nowhere on the page goes
// to its heading, as on any other page.
let arrived = null;
function settle(route) {
  if (route === arrived) return;
  arrived = route;
  queueMicrotask(() => {
    const el = document.activeElement;
    const lost = !el || el === document.body || !el.isConnected || !el.closest('#page');
    if (lost && state.from && onCompare() && state.base === route) document.querySelector('#page-title')?.focus({ preventScroll: true });
  });
}

// Brings in what the page needs and isn't here: records (r/, or a hand-entered
// bottle's own link), about data, the pool's signals (value, safety) for
// dataset bottles that came without them, and a lone bottle's smells-like
// family. Renders again as each lands.
function load(app, route) {
  listen(app);
  watchHeads();
  settle(route);
  const ids = compareIds(route.arg);
  const again = () => queueMicrotask(() => redraw(app));
  const absent = ids.filter(id => !findRecord(id) && !missing.has(id) && !failed.has(id) && !loading.has(id));
  const fetch = absent.filter(id => /^\d+$/.test(id));
  for (const id of absent.filter(id => !/^\d+$/.test(id))) {
    // A hand-entered bottle travels in its id (by its token, and by its own id
    // for what its page's buttons name); anything else no library has.
    const f = isCustomId(id) ? fromShareToken(id) : null;
    if (f) {
      state.bottles.set(id, f);
      if (!state.bottles.has(f.id)) state.bottles.set(f.id, f);
    } else missing.add(id);
  }
  if (absent.length > fetch.length) again();
  if (fetch.length) {
    fetch.forEach(id => loading.add(id));
    library.records(fetch).then(found => {
      keepBottles([...found.values()]);
      for (const id of fetch) if (!found.has(id)) missing.add(id);
    }, () => fetch.forEach(id => failed.add(id))).finally(() => {
      fetch.forEach(id => loading.delete(id));
      again();
    });
  }
  // The wardrobe's and catalog's bottles carry theirs.
  for (const id of ids.filter(id => /^\d+$/.test(id) && !askedAbout.has(id) && !state.about.has(id) && !findRecord(id)?.about)) {
    askedAbout.add(id);
    loadAbout(id).then(about => { state.about.set(id, about); again(); }, () => askedAbout.delete(id));
  }
  // Pool rows carry value and safety; once the pool is in, `records` hands
  // them over (src/app/state.js keeps them on the bottles).
  const bare = ids.filter(id => /^\d+$/.test(id) && !askedSignals.has(id) && findRecord(id) && !findRecord(id).extras);
  if (bare.length) {
    bare.forEach(id => askedSignals.add(id));
    askPool('warm').then(() => askPool('records', { ids: bare })).then(again, () => bare.forEach(id => askedSignals.delete(id)));
  }
  // A lone bottle's column suggests from its family.
  if (ids.length === 1) askFamily(app, ids[0]);
}

/**
 * Asks the pool for a bottle's smells-like family (`dupes`), for a lone
 * bottle's column and the first list of "Compare with…", unless its bottle
 * page has it (familyOf) or it was asked. Whichever of them is on screen
 * draws again when it lands.
 */
function askFamily(app, id) {
  const f = findRecord(id);
  if (!f || familyOf(id) || families.has(id) || !Object.keys(f.accords ?? {}).length) return;
  families.set(id, null);
  const landed = () => {
    if (onCompare()) redraw(app);
    if (state.sheet?.kind === 'cmp-pick' && state.sheet.base?.[0] === id) app.keepingFocus(document.activeElement, '#sheet', () => app.updateSheet({}));
  };
  poolInputs().then(inputs => askPool('dupes', { ...inputs, record: f }, { channel: 'cmp-family' }))
    .then(r => { if (!r.stale) families.set(id, r); else families.delete(id); landed(); }, () => families.delete(id));
}

// Back online: bottles that couldn't load try again.
let listening = false;
function listen(app) {
  if (listening) return;
  listening = true;
  addEventListener('online', () => {
    failed.clear();
    redraw(app);
  });
}

// The strip of photos shows once it sticks: when the top of the rows (a
// sentinel there) passes the top of the window, the cards long gone. At
// once on a page drawn again.
let sentinel = null, seen = null;
const stuck = (el, rect = el.getBoundingClientRect()) => el.closest('.cmp')?.classList.toggle('stuck', rect.top < 0);
function watchHeads() {
  const el = document.querySelector('#main .cmp-sentinel');
  if (el) stuck(el);
  if (typeof IntersectionObserver === 'undefined' || el === sentinel) return;
  seen ??= new IntersectionObserver(([e]) => stuck(e.target, e.boundingClientRect));
  if (sentinel) seen.unobserve(sentinel);
  sentinel = el;
  if (el) seen.observe(el);
}

// The bottle page it came from, for Back: kept while bottles are picked and
// removed here (those replace the entry), dropped when it came from elsewhere.
let backTo = null;

export const compare = {
  id: 'compare',
  label: 'Compare',
  icon: 'compare',
  title: r => compareIds(r.arg).map(id => findRecord(id)?.name).filter(Boolean).join(' and ') || 'Compare',
  heading: () => 'Compare',
  render: (app, r) => {
    if (state.from?.dest === 'bottle') backTo = state.from;
    else if (state.from?.dest !== 'compare') backTo = null;
    return compareHTML(compareModel(r));
  },
  after: load,
};

// ---------- Compare with… ----------

const pickRow = f => `<li class="row"><button class="row-main" data-action="cmp-pick" data-id="${esc(f.id)}">${img(f)}<span class="row-text"><b>${esc(f.name)}</b><small>${esc([f.brand, f.year].filter(Boolean).join(' · '))}</small></span></button></li>`;
const FEW = 5;

/**
 * Whether a bottle answers what's typed: every word of it is somewhere in
 * its name and brand, in any order ("dior sauvage", "baccarat 540"), as
 * localMatches reads a search (one-letter words count only when nothing
 * longer was typed).
 */
export function pickerMatches(query, f) {
  const typed = normalize(query).split(' ').filter(Boolean);
  const words = typed.some(w => w.length > 1) ? typed.filter(w => w.length > 1) : typed;
  if (!words.length) return true;
  const hay = normalize(`${f.name} ${f.brand ?? ''}`);
  return words.every(w => hay.includes(w));
}

/**
 * The picker's lists for a sheet { base: [ids], ctx, query, results, busy,
 * error }: [{ title, records }], the bottle's smells-like family first, then
 * the list it was opened from, then your own; filtered by the query, with
 * the library's matches after (as the library found them: it matched them
 * already, by its own rules). Each bottle shows once, in the first list it
 * makes; the family and the list it came from show their first five, so the
 * rest of your bottles stay under "Your bottles".
 */
export function pickerLists(sheet, { family = null, context = [], owned = [] } = {}) {
  const seen = new Set(sheet.base ?? []);
  const q = sheet.query ?? '';
  const typed = normalize(q) !== '';
  // The first n that fit, each marked as listed (the rest stay free for later lists).
  const keep = (list, n = Infinity, match = f => pickerMatches(q, f)) => {
    const out = [];
    for (const f of list) {
      if (out.length >= n) break;
      if (!f?.name || seen.has(String(f.id ?? '')) || !match(f)) continue;
      seen.add(String(f.id));
      out.push(f);
    }
    return out;
  };
  const fam = family ? [family.original, ...family.cheaper, ...family.siblings].filter(Boolean).map(e => e.record ?? e) : [];
  const lists = [
    { title: 'Smells like it', records: keep(fam, FEW) },
    { title: 'From the same list', records: keep(context, FEW) },
    { title: 'Your bottles', records: keep([...owned].sort((a, b) => a.name.localeCompare(b.name))) },
  ];
  if (typed) lists.push({ title: 'From Fragrantica', records: keep(sheet.results ?? [], Infinity, () => true) });
  return lists.filter(l => l.records.length);
}

export function pickerHTML(sheet, lists) {
  const full = (sheet.base ?? []).length >= MAX_COMPARE;
  const body = full ? '<p class="muted">Three is the most side by side. Remove one to add another.</p>'
    : lists.length ? lists.map(l => `<p class="bp-sub">${esc(l.title)}</p><ul class="rows">${l.records.map(pickRow).join('')}</ul>`).join('')
    : `<p class="muted small">${sheet.busy ? 'Searching…' : sheet.query ? `No bottles match “${esc(sheet.query)}”.` : 'Search for a bottle to compare.'}</p>`;
  return sheetFrame('cmp-pick-title', `
    <h2 id="cmp-pick-title" class="sheet-title">${(sheet.base ?? []).length ? 'Compare with…' : 'Compare'}</h2>
    <label class="filter big cmp-search">${icon.search}<input type="search" data-field="cmp-query" value="${esc(sheet.query ?? '')}" placeholder="Search your bottles or Fragrantica" autocomplete="off" aria-label="Find a bottle" enterkeyhint="search"></label>
    ${sheet.error ? `<p class="error">${esc(sheet.error)}</p>` : ''}
    <div class="cmp-pick">${body}</div>`);
}

export const sheets = {
  'cmp-pick': s => pickerHTML(s, pickerLists(s, {
    family: s.base?.length ? familyOf(s.base[0]) ?? families.get(s.base[0]) ?? null : null,
    context: (state.contexts[s.ctx] ?? state.contexts[nowSlot()?.win.slot])?.ranked.map(e => e.fragrance) ?? [],
    owned: activeFragrances(),
  })),
};

// Library matches for what's typed, after a pause; only the picker that asked takes them.
let searchTimer = null;
const SEARCH_AFTER = 250;

function searchLibrary(app, query) {
  clearTimeout(searchTimer);
  if (query.trim().length < 2) return;
  searchTimer = setTimeout(async () => {
    const current = () => state.sheet?.kind === 'cmp-pick' && state.sheet.query === query;
    if (!current()) return;
    app.keepingFocus(document.activeElement, '#sheet', () => app.updateSheet({ busy: true }));
    const { results, error } = await findBottles(query).catch(err => ({ results: [], error: err.message }));
    if (current()) app.keepingFocus(document.activeElement, '#sheet', () => app.updateSheet({ results, error: results.length ? '' : error, busy: false }));
  }, SEARCH_AFTER);
}

export const fields = {
  'cmp-query'(input, app) {
    app.keepingFocus(input, '#sheet', () => app.updateSheet({ query: input.value, results: null, error: '' }));
    searchLibrary(app, input.value);
  },
};

// The ids before the last removal, for Undo.
let removedFrom = null;

export const actions = {
  'cmp-add'(el, app) {
    app.openSheet({ kind: 'cmp-pick', base: compareIds(state.base?.dest === 'compare' ? state.base.arg : ''), ctx: null, query: '', results: null });
  },
  // A bottle page's Compare: the picker, that bottle first, its family (the
  // first list) asked now if its page's section hadn't yet.
  'bp-compare'(el, app) {
    app.openSheet({ kind: 'cmp-pick', base: [el.dataset.id], ctx: el.dataset.ctx || null, query: '', results: null });
    askFamily(app, el.dataset.id);
  },
  // From the picker, or a lone bottle's suggestions on the page. The page
  // drawn (and the bottle page under the picker gone), focus on its heading:
  // the control that asked went with the sheet.
  'cmp-pick'(el, app) {
    const picking = state.sheet?.kind === 'cmp-pick';
    const base = picking ? state.sheet.base ?? [] : compareIds(onCompare() ? state.base.arg : '');
    const ids = [...base, el.dataset.id].slice(0, MAX_COMPARE);
    const replace = onCompare() && state.route?.dest === 'compare';
    const go = () => {
      app.navigate(hrefFor(ids), { replace });
      document.querySelector('#page-title')?.focus({ preventScroll: true });
    };
    if (picking) app.closeSheet({ then: go });
    else go();
  },
  'cmp-remove'(el, app) {
    const before = compareIds(state.base?.arg);
    const ids = before.filter(id => id !== el.dataset.id);
    const name = findRecord(el.dataset.id)?.name ?? 'Bottle';
    removedFrom = before;
    app.navigate(hrefFor(ids), { replace: true });
    focusCard(before.indexOf(el.dataset.id));
    app.showToast(`<span class="note">${esc(name)} removed.</span><button class="btn primary compact" data-action="cmp-undo">Undo</button>`);
  },
  'cmp-undo'(el, app) {
    if (!removedFrom) return;
    const ids = removedFrom;
    const back = ids.findIndex(id => !compareIds(state.base?.arg).includes(id));
    removedFrom = null;
    app.navigate(hrefFor(ids), { replace: true });
    focusCard(back);
    app.hideToast();
  },
  'cmp-retry'(el, app) {
    failed.delete(el.dataset.id);
    app.renderPage();
    document.querySelector('#page-title')?.focus({ preventScroll: true });
  },
  // Back to the bottle page it came from: its history entry, under this one.
  'cmp-back'() {
    history.back();
  },
};

// The page drawn again after a removal (or its Undo): focus the card now in
// column i (the next one along; the last when it was the last), else Add a
// bottle when no card is left, else the page's heading.
function focusCard(i) {
  const cards = [...document.querySelectorAll('#main .cmp-heads > .cmp-head:not(.cmp-add)')];
  const card = cards[Math.max(0, Math.min(i, cards.length - 1))];
  const next = card?.querySelector('.cmp-open, button') ?? document.querySelector('#main [data-action="cmp-add"]') ?? document.querySelector('#page-title');
  next?.focus({ preventScroll: true });
}
