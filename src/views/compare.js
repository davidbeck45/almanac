// The compare page (#/compare/<id>,<id>[,<id>]): two or three bottles side
// by side, with which to wear tonight on top, then how each fits now and for
// the saved occasion, how they relate (dupe, voted alike, alike by notes),
// and their accords, seasons, performance, value, styles and blind-buy risk.
// Columns from 640px of page; under that each row stacks the bottles, a
// small photo naming each. "Compare with…" (the cmp-pick sheet) picks the
// bottles, from a bottle page's Compare or from here. Not in the nav, like
// Settings. Styles: src/css/bottle.css (.cmp-*).
import { rank, SEASONS, performanceRating } from '../engine.js';
import { occasionById } from '../occasions.js';
import { similarity } from '../similar.js';
import { signalsOf, riskOf } from '../candidates.js';
import { topStyles, wearsClose } from '../scent-styles.js';
import { loadAbout } from '../fragrantica.js';
import { isCustomId, fromShareToken } from '../custom.js';
import { normalize } from '../collections.js';
import { esc, matchPct, plural, displayReasons } from '../ui.js';
import { icon, img, accordColor, messageHTML, sheetFrame } from '../ui/components.js';
import { compareIds, routeHash } from '../app/router.js';
import { askPool } from '../app/pool.js';
import {
  state, findRecord, inSource, activeFragrances, library, keepBottles, nowSlot, findBottles,
} from '../app/state.js';
import { familyOf } from './bottle-dupes.js';

export const MAX_COMPARE = 3;
const ACCORDS_SHOWN = 5;
const SEASON_LABELS = { winter: 'Winter', spring: 'Spring', summer: 'Summer', fall: 'Fall' };
const RISK_WORDS = { low: 'Safe bet', medium: 'Some risk', high: 'Risky' };
// Likeness by accords and notes (src/similar.js), in words.
const ALIKE = [[0.85, 'Nearly the same scent'], [0.6, 'Close'], [0.35, 'Some common ground'], [-Infinity, 'Quite different']];
// Two picks this close for tonight are a toss-up.
const TOSS_UP = 0.03;

const num = n => Number(n).toLocaleString('en-US');
const pct = x => `${Math.round(x * 100)}%`;
const hrefFor = ids => routeHash({ dest: 'compare', arg: ids.join(',') });
const onCompare = () => state.base?.dest === 'compare';

// ---------- The model ----------

// Ids the library answered for without them, or that couldn't load (offline).
const missing = new Set();
const failed = new Set();
const loading = new Set();
const askedAbout = new Set();
const askedSignals = new Set();

const aboutFor = f => f.about ?? state.about.get(f.id);

/**
 * How two bottles relate, the strongest evidence first: one copies the
 * other, voters say they smell alike (the about data's votes or the pool's
 * links), else how alike their accords and notes are. -> { text, sim }
 */
export function relation(a, b, aboutA = null, aboutB = null) {
  const sim = a.accords && b.accords ? similarity(a, b) : null;
  const vote = (x, y, about) => about?.smellsLike?.find(v => String(v.id) === y.id && v.up > v.down) && { x, y, v: about.smellsLike.find(v => String(v.id) === y.id) };
  const voted = vote(a, b, aboutA) || vote(b, a, aboutB);
  let text;
  if (String(a.original?.id) === b.id) text = `${a.name} is inspired by ${b.name}.`;
  else if (String(b.original?.id) === a.id) text = `${b.name} is inspired by ${a.name}.`;
  else if (voted) text = `${num(voted.v.up)} voters say ${voted.x.name} smells like ${voted.y.name}.`;
  else if (signalsOf(a).family.includes(b.id) || signalsOf(b).family.includes(a.id)) text = `Voters call ${a.name} and ${b.name} the same scent.`;
  else if (signalsOf(a).like.includes(b.id) || signalsOf(b).like.includes(a.id)) text = `Voters say ${a.name} and ${b.name} smell alike.`;
  else text = sim == null ? '' : `${a.name} and ${b.name}: ${ALIKE.find(([from]) => sim >= from)[1].toLowerCase()} by their accords and notes.`;
  return { text, sim };
}

/**
 * Everything the page shows, from the route and state: { ids, bottles:
 * [{ id, f, status: 'ready' | 'loading' | 'missing' | 'failed', owned }],
 * now and occ: { win, occasion?, entries: Map id -> ranked entry } (null
 * without a forecast), tonight: { win, ranked } (or null), pairs: [{ a, b,
 * text, sim }], about(f) }.
 */
export function compareModel(route) {
  const ids = compareIds(route.arg);
  const bottles = ids.map(id => {
    const f = findRecord(id);
    const status = f ? 'ready' : missing.has(id) ? 'missing' : failed.has(id) ? 'failed' : 'loading';
    return { id, f, status, owned: Boolean(f) && inSource(id) };
  });
  const ready = bottles.filter(b => b.f).map(b => b.f);
  const ranked = (win, occasion = null) => (win && ready.length ? rank(ready, win, win.slot, { occasion, history: state.history, todayISO: win.dateISO }) : null);
  const entries = list => list && new Map(list.map(e => [e.fragrance.id, e]));
  const nowWin = nowSlot()?.win ?? null;
  const occasion = occasionById(state.occasion) ?? occasionById('casual');
  const occWin = state.wx ? state.wx[occasion.slot] ?? state.wx.day ?? state.wx.night : null;
  const nightWin = state.today?.night?.win ?? state.wx?.night ?? null;
  const pairs = [];
  for (let i = 0; i < ready.length; i++) {
    for (let j = i + 1; j < ready.length; j++) pairs.push({ a: ready[i], b: ready[j], ...relation(ready[i], ready[j], aboutFor(ready[i]), aboutFor(ready[j])) });
  }
  return {
    ids,
    bottles,
    now: nowWin && { win: nowWin, entries: entries(ranked(nowWin)) },
    occ: occWin && { win: occWin, occasion, entries: entries(ranked(occWin, occasion)) },
    tonight: nightWin && ready.length ? { win: nightWin, ranked: ranked(nightWin) } : null,
    pairs,
    about: aboutFor,
  };
}

// ---------- Cells ----------

// A filled bar for a 0..1 share.
const meter = (x, cls = '') => `<span class="cmp-meter${cls ? ` ${cls}` : ''}" aria-hidden="true"><span style="width:${(Math.max(0, Math.min(1, x)) * 100).toFixed(1)}%"></span></span>`;

function matchCell(entry) {
  if (!entry) return '<span class="muted">—</span>';
  const why = displayReasons(entry, 1)[0]?.text ?? '';
  return `<span class="cmp-num">${matchPct(entry)}%</span>${meter(entry.score)}<span class="cmp-why">${esc(why.charAt(0).toUpperCase() + why.slice(1))}</span>`;
}

function accordsCell(f) {
  const top = Object.entries(f.accords ?? {}).slice(0, ACCORDS_SHOWN);
  if (!top.length) return '<span class="muted">—</span>';
  return `<ul class="cmp-accords">${top.map(([a, w]) => `<li><span class="cmp-accord-name">${esc(a)}</span><span class="cmp-meter" aria-hidden="true"><span style="width:${w}%;--c:${accordColor(a)}"></span></span></li>`).join('')}</ul>`;
}

function seasonsCell(f) {
  const peak = Math.max(...SEASONS.map(s => f.season?.[s] ?? 0)) || 1;
  const cols = SEASONS.map(s => `<li><span class="cmp-col-track"><span class="cmp-col" style="height:${(((f.season?.[s] ?? 0) / peak) * 100).toFixed(1)}%"></span></span><span>${SEASON_LABELS[s]}</span></li>`).join('');
  const spoken = SEASONS.map(s => `${SEASON_LABELS[s]} ${pct(f.season?.[s] ?? 0)}`).join(', ');
  // Whole percents that add up to 100.
  const night = Math.round((f.dayNight?.night ?? 0.5) * 100);
  return `<ul class="cmp-seasons" role="img" aria-label="${esc(spoken)}">${cols}</ul>
    <p class="cmp-daynight"><span>Day ${100 - night}%</span><span class="cmp-split" aria-hidden="true"><span style="width:${100 - night}%"></span></span><span>Night ${night}%</span></p>`;
}

function performanceCell(f, key) {
  const p = performanceRating(f);
  if (p?.[key] == null) return '<span class="muted">No votes</span>';
  return `<span class="cmp-num">${p[key].toFixed(1)}<small> of 10</small></span>${meter(p[key] / 10)}`;
}

function valueCell(f, about) {
  const v = signalsOf(f).value ?? about?.value?.avg ?? null;
  if (v == null) return '<span class="muted">No votes</span>';
  const word = v >= 4 ? 'Great value' : v >= 3.4 ? 'Good value' : v > 2.4 ? 'Fair price' : 'Pricey';
  return `<span class="cmp-num">${v.toFixed(1)}<small> of 5</small></span>${meter((v - 1) / 4)}<span class="cmp-why">${word}</span>`;
}

function stylesCell(f) {
  const styles = topStyles(f).map(s => s.label);
  if (wearsClose(f)) styles.push('Wears close');
  return styles.length ? `<ul class="cmp-tags">${styles.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '<span class="muted">No clear style</span>';
}

function riskCell(f, about) {
  const risk = riskOf(about && !f.extras && !f.about ? { ...f, about } : f);
  if (risk.level === 'unknown') return '<span class="muted">No crowd data</span>';
  const safe = signalsOf(f).safe;
  const why = risk.reasons[0] ?? (safe != null ? `Safer than ${safe}% of popular bottles.` : '');
  return `<span class="cmp-risk" data-level="${risk.level}">${RISK_WORDS[risk.level]}</span><span class="cmp-why">${esc(why)}</span>`;
}

const ratingCell = f => (f.rating ? `<span class="cmp-num">★ ${f.rating.toFixed(2)}</span><span class="cmp-why">${f.ratingVotes ? `${num(f.ratingVotes)} votes` : ''}</span>` : '<span class="muted">Unrated</span>');

// ---------- The page ----------

function headHTML(b, ids) {
  const remove = `<button class="icon-btn cmp-remove" data-action="cmp-remove" data-id="${esc(b.id)}" aria-label="Remove ${esc(b.f?.name ?? 'this bottle')}">${icon.close}</button>`;
  if (!b.f) {
    const text = b.status === 'loading' ? '<span class="sk cmp-sk-photo"></span><span class="sk sk-line w70"></span>'
      : `<span class="cmp-missing">${b.status === 'failed' ? 'Couldn’t load this bottle' : 'Not in the library'}</span>`;
    return `<div class="cmp-head"${b.status === 'loading' ? ' aria-busy="true"' : ''}>${text}${ids.length > 1 ? remove : ''}</div>`;
  }
  const f = b.f;
  return `<div class="cmp-head">
    <button class="cmp-open" data-action="open" data-ctx="" data-id="${esc(f.id)}">
      <span class="cmp-photo">${img(f, { lazy: false })}</span>
      <span class="cmp-name">${esc(f.name)}</span>
      <span class="cmp-brand">${esc([f.brand, f.year].filter(Boolean).join(' · '))}</span>
    </button>
    ${b.owned ? `<span class="cmp-owned">${icon.check}You own it</span>` : ''}
    ${remove}
  </div>`;
}

// One row: a label (HTML) and a cell per bottle. `best`: the ids that lead it.
function cmpRow(label, bottles, cell, { best = new Set(), id = '' } = {}) {
  const cells = bottles.map(b => `<div class="cmp-cell${best.has(b.id) ? ' best' : ''}">
      <span class="cmp-who">${b.f ? img(b.f) : ''}<span>${esc(b.f?.name ?? '')}</span></span>
      <div class="cmp-val">${b.f ? cell(b.f) : ''}</div>
    </div>`).join('');
  return `<section class="cmp-row"${id ? ` aria-labelledby="${id}"` : ''}><h2 class="cmp-label"${id ? ` id="${id}"` : ''}>${label}</h2><div class="cmp-cells">${cells}</div></section>`;
}

// The ids with the highest value, when it leads by something.
function leaders(bottles, value) {
  const scored = bottles.filter(b => b.f).map(b => [b.id, value(b.f)]).filter(([, v]) => v != null);
  if (scored.length < 2) return new Set();
  const top = Math.max(...scored.map(([, v]) => v));
  const lead = scored.filter(([, v]) => v === top);
  return lead.length === scored.length ? new Set() : new Set(lead.map(([id]) => id));
}

// Which suits tonight best, and by how much: "Wear …" when it's yours.
function verdictHTML(tonight, owned) {
  if (!tonight || tonight.ranked.length < 2) return '';
  const [first, second] = tonight.ranked;
  const close = first.score - second.score < TOSS_UP;
  const f = first.fragrance;
  const name = `<i>${esc(f.name)}</i>`;
  const reason = first.reasons.find(r => r.tone === 'good')?.text ?? '';
  return `<section class="cmp-verdict" aria-labelledby="cmp-verdict-title">
    <span class="cmp-verdict-photo">${img(f, { lazy: false })}</span>
    <div>
      <p class="cmp-kicker">${icon.moon}${esc(tonight.win.label)}</p>
      <h2 id="cmp-verdict-title">${close ? `Close call: ${name} by a nose` : owned.has(f.id) ? `Wear ${name}` : `${name} suits it best`}</h2>
      <p class="cmp-verdict-why">${reason ? `${esc(reason.charAt(0).toUpperCase() + reason.slice(1))}. ` : ''}${matchPct(first)}% match, against ${esc(second.fragrance.name)}’s ${matchPct(second)}%.</p>
    </div>
  </section>`;
}

// "Match today", "Match tonight", "Match tomorrow night".
const matchLabel = win => `Match ${/^(Today|Tonight|Tomorrow)/.test(win.label) ? win.label.toLowerCase() : `on ${win.label}`}`;

// One bottle alone asks for another more loudly.
const addButton = ids => (ids.length < MAX_COMPARE
  ? `<button class="btn ${ids.length === 1 ? 'primary' : 'secondary'} compact" data-action="cmp-add">${icon.plus}<span>Add a bottle</span></button>` : '');

/** The page for compareModel()'s model. */
export function compareHTML(m) {
  const { ids, bottles } = m;
  if (!ids.length) {
    return messageHTML({ glyph: icon.compare, title: 'Compare up to three bottles', body: 'Open any bottle and tap Compare, or start here.',
      action: `<button class="btn primary" data-action="cmp-add">${icon.plus}<span>Pick a bottle</span></button>` });
  }
  const ready = bottles.filter(b => b.f);
  const pairs = m.pairs.filter(p => p.text);
  const score = ctx => f => ctx.entries.get(f.id)?.score;
  const rows = ready.length ? [
    m.now && cmpRow(esc(matchLabel(m.now.win)), bottles, f => matchCell(m.now.entries.get(f.id)), { best: leaders(bottles, score(m.now)), id: 'cmp-now' }),
    m.occ && cmpRow(esc(`${m.occ.occasion.label} · ${m.occ.win.label.toLowerCase()}`), bottles, f => matchCell(m.occ.entries.get(f.id)), { best: leaders(bottles, score(m.occ)), id: 'cmp-occ' }),
    cmpRow('Rating', bottles, ratingCell, { best: leaders(bottles, f => f.rating || null), id: 'cmp-rating' }),
    cmpRow('Main accords', bottles, accordsCell, { id: 'cmp-accords' }),
    cmpRow('Seasons', bottles, seasonsCell, { id: 'cmp-seasons' }),
    cmpRow('Lasts', bottles, f => performanceCell(f, 'longevity'), { best: leaders(bottles, f => performanceRating(f)?.longevity), id: 'cmp-lasts' }),
    cmpRow('Projects', bottles, f => performanceCell(f, 'sillage'), { best: leaders(bottles, f => performanceRating(f)?.sillage), id: 'cmp-projects' }),
    cmpRow('Value for money', bottles, f => valueCell(f, m.about(f)), { best: leaders(bottles, f => signalsOf(f).value ?? m.about(f)?.value?.avg), id: 'cmp-value' }),
    cmpRow('Style', bottles, stylesCell, { id: 'cmp-style' }),
    cmpRow('Blind buy', bottles, f => riskCell(f, m.about(f)), { id: 'cmp-risk' }),
  ].filter(Boolean).join('') : '';
  const relations = pairs.length ? `<section class="cmp-relations" aria-labelledby="cmp-rel-title"><h2 id="cmp-rel-title" class="cmp-label">How they relate</h2><ul>${pairs.map(p => `<li>${p.sim != null ? `<span class="cmp-sim" title="Alike by accords and notes">${pct(p.sim)}</span>` : ''}<span>${esc(p.text)}</span></li>`).join('')}</ul></section>` : '';
  return `<div class="cmp" style="--n:${bottles.length}">
    <div class="cmp-bar"><p class="muted small">${ids.length === 1 ? 'Add a bottle to see them side by side.' : `${plural(ids.length, 'bottle')} side by side${m.now ? `, for ${esc(m.now.win.label.toLowerCase())}` : ''}.`}</p>${addButton(ids)}</div>
    ${verdictHTML(m.tonight, new Set(bottles.filter(b => b.owned).map(b => b.id)))}
    <div class="cmp-heads"><span class="cmp-corner" aria-hidden="true"></span>${bottles.map(b => headHTML(b, ids)).join('')}</div>
    ${relations}
    ${rows ? `<div class="cmp-table">${rows}</div>` : ''}
    <p class="bp-credit">Ratings, votes and value from Fragrantica members, via Le Decanteur’s dataset; performance from Parfumo where it has the bottle.</p>
  </div>`;
}

// ---------- Loading ----------

// Brings in what the page needs and isn't here: records (r/, or a hand-entered
// bottle's own link), about data, and the pool's signals (value, safety) for
// dataset bottles that came without them. Renders again as each lands.
function load(app, route) {
  const ids = compareIds(route.arg);
  const again = () => queueMicrotask(() => { if (onCompare()) app.renderPage(); });
  const absent = ids.filter(id => !findRecord(id) && !missing.has(id) && !failed.has(id) && !loading.has(id));
  const fetch = absent.filter(id => /^\d+$/.test(id));
  for (const id of absent.filter(id => !/^\d+$/.test(id))) {
    // A hand-entered bottle travels in its id; anything else no library has.
    const f = isCustomId(id) ? fromShareToken(id) : null;
    if (f) state.bottles.set(id, f);
    else missing.add(id);
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
  for (const id of ids.filter(id => /^\d+$/.test(id) && !askedAbout.has(id) && !state.about.has(id))) {
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
}

export const compare = {
  id: 'compare',
  label: 'Compare',
  icon: 'compare',
  title: r => compareIds(r.arg).map(id => findRecord(id)?.name).filter(Boolean).join(' and ') || 'Compare',
  heading: () => 'Compare',
  render: (app, r) => compareHTML(compareModel(r)),
  after: load,
};

// ---------- Compare with… ----------

const pickRow = f => `<li class="row"><button class="row-main" data-action="cmp-pick" data-id="${esc(f.id)}">${img(f)}<span class="row-text"><b>${esc(f.name)}</b><small>${esc([f.brand, f.year].filter(Boolean).join(' · '))}</small></span></button></li>`;

/**
 * The picker's lists for a sheet { base: [ids], ctx, query, results, busy,
 * error }: [{ title, records }], the bottle's smells-like family first, then
 * the list it was opened from, then your own; filtered by the query, with
 * the library's matches after.
 */
export function pickerLists(sheet, { family = null, context = [], owned = [] } = {}) {
  const seen = new Set(sheet.base ?? []);
  const q = normalize(sheet.query ?? '');
  // Each bottle once, in the first list that has it, if it matches what's typed.
  const keep = list => list.filter(f => {
    const id = String(f?.id ?? '');
    if (!f?.name || seen.has(id) || (q && !normalize(`${f.name} ${f.brand ?? ''}`).includes(q))) return false;
    seen.add(id);
    return true;
  });
  const fam = family ? [family.original, ...family.cheaper, ...family.siblings].filter(Boolean).map(e => e.record ?? e) : [];
  const lists = [
    { title: 'Smells like it', records: keep(fam).slice(0, 5) },
    { title: 'Also good right now', records: keep(context).slice(0, 5) },
    { title: 'Your bottles', records: keep([...owned].sort((a, b) => a.name.localeCompare(b.name))) },
  ];
  if (q) lists.push({ title: 'From Fragrantica', records: keep(sheet.results ?? []) });
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
    family: s.base?.length ? familyOf(s.base[0]) : null,
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

export const actions = {
  'cmp-add'(el, app) {
    app.openSheet({ kind: 'cmp-pick', base: compareIds(state.base?.dest === 'compare' ? state.base.arg : ''), ctx: null, query: '', results: null });
  },
  'cmp-pick'(el, app) {
    const ids = [...(state.sheet?.base ?? []), el.dataset.id].slice(0, MAX_COMPARE);
    const replace = onCompare() && state.route?.dest === 'compare';
    app.closeSheet({ then: () => app.navigate(hrefFor(ids), { replace }) });
  },
  'cmp-remove'(el, app) {
    const ids = compareIds(state.base?.arg).filter(id => id !== el.dataset.id);
    app.navigate(hrefFor(ids), { replace: true });
  },
};
