// Discover's templates: the search field and its two lists (bottles named,
// bottles with these notes), the style chips and the seed bottles, the
// result cards, the filters (a side panel, or a sheet on phones), and the
// "Fill a gap" teaser. Pure functions of their arguments (test/discover-
// screens.test.js renders them in Node); src/views/discover.js feeds them.
// Styles: src/css/discover.css, the cards' src/css/components.css (.bcard).
import { esc, plural } from '../../ui.js';
import {
  icon, img, messageHTML, segHTML, switchHTML, rowHTML, sectionHead, bottleCardHTML, bottleCardSkeletonHTML, accordColor,
} from '../../ui/components.js';
import { STYLES } from '../../scent-styles.js';
import { SEASONS, LONGEVITY, PROJECTION, filterCount, NO_FILTERS } from './query.js';

// Cards a list asks for at a time, and at most.
export const PAGE = 12;
export const MAX_PICKS = 48;
// Where a list takes in the "Fill a gap" teaser, and how many style chips
// show before "More styles" on a wide column (phones scroll through them all).
const INSERT_AT = 4;
const CHIPS_SHOWN = 10;

// The accord whose color stands for each style on its chips.
const STYLE_HUES = {
  skin: 'musky', clean: 'soapy', intimate: 'lactonic', citrus: 'citrus', aquatic: 'aquatic', green: 'green', aromatic: 'lavender',
  gourmand: 'caramel', vanilla: 'vanilla', amber: 'amber', oud: 'oud', leather: 'leather', tobacco: 'tobacco', incense: 'smoky',
  whiteFloral: 'white floral', rose: 'rose', floral: 'floral', powdery: 'powdery', woody: 'woody', spicy: 'warm spicy',
  fruity: 'fruity', chypre: 'mossy', boozy: 'rum',
};
const STYLE_BY_ID = new Map(STYLES.map(s => [s.id, s]));
export const styleColor = id => accordColor(STYLE_HUES[id] ?? 'powdery');
export const styleLabel = id => STYLE_BY_ID.get(id)?.label ?? id;

const listed = items => (items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const metaOf = r => [r.brand, r.year].filter(Boolean).map(esc).join(' · ');
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
// A bottle named inside a sentence opens its page.
const named = (r, text = r.name) => `<button class="link-btn" data-action="open" data-ctx="" data-id="${esc(r.id)}">${esc(text)}</button>`;

// ---------- Cards ----------

/** Value for money in words: { text, tone } or null in the unremarkable middle. */
export function valueMark(value) {
  if (value == null) return null;
  if (value >= 4) return { text: 'Great value', tone: 'good' };
  if (value >= 3.5) return { text: 'Good value', tone: '' };
  if (value < 2.5) return { text: 'Pricey', tone: '' };
  return null;
}

/** A blind buy's risk as a mark (medium and high only), the weightiest reason spoken. */
export function riskMark(risk) {
  if (!risk || (risk.level !== 'medium' && risk.level !== 'high')) return null;
  const text = risk.level === 'high' ? 'Risky buy' : 'Some risk';
  return { text, tone: 'warn', spoken: `${text}: ${risk.reasons[0] ?? ''}` };
}

function marksOf(pick) {
  const r = pick.record;
  const rating = pick.rating ?? r.rating;
  const votes = pick.votes ?? r.ratingVotes;
  return [
    rating ? { text: `★ ${rating.toFixed(2)}`, spoken: `Rated ${rating.toFixed(2)} of 5${votes ? ` by ${votes.toLocaleString('en-US')} voters` : ''}` } : null,
    valueMark(pick.value ?? r.extras?.value),
    riskMark(pick.risk),
  ].filter(Boolean);
}

/**
 * Why a pick is here, as sentences (HTML, bottles named in them open their
 * pages), most telling first, at most `max`: what it shares with the seeds,
 * the nearest owned bottle and what they share, what
 * voters say it copies, a cheaper twin, twins folded into it, its link to
 * the wardrobe, and whether fans of the seeds like it.
 */
export function whyLines(pick, { max = 4 } = {}) {
  const lines = [];
  // (What a notes search matched shows as its tags.)
  if (pick.shares?.length) lines.push(`Shares ${esc(listed(pick.shares))} with your picks.`);
  const near = pick.nearest;
  if (near) {
    const who = near.record ? named(near.record, near.name) : esc(near.name);
    const through = near.through ? ` (through its original, ${esc(near.through)})` : '';
    const traits = near.traits?.length ? `, sharing ${esc(listed(near.traits))}` : '';
    lines.push(`Nearest you own: ${who}${through}${traits}.`);
  }
  const copy = pick.clonesOf;
  if (copy) {
    const votes = copy.up != null ? ` (${copy.up} to ${copy.down})` : '';
    lines.push(`Voters say it smells like ${copy.record ? named(copy.record, copy.name) : esc(copy.name)}${copy.brand ? ` by ${esc(copy.brand)}` : ''}${votes}.`);
  }
  if (pick.twin?.record) lines.push(`Cheaper twin: ${named(pick.twin.record)}${pick.twin.record.brand ? ` by ${esc(pick.twin.record.brand)}` : ''}.`);
  const alike = (pick.alike ?? []).filter(r => r.id !== copy?.id);
  if (alike.length) lines.push(`Twins: ${listed(alike.slice(0, 3).map(r => named(r)))}${alike.length > 3 ? ` and ${alike.length - 3} more` : ''}.`);
  if (pick.family) lines.push(`${esc(cap(pick.family))}.`);
  if (pick.alsoLiked) lines.push('Fans of your picks like it too.');
  return lines.slice(0, max);
}

const wantButton = (r, wanted) => `<button class="icon-btn want-btn" data-action="disc-want" data-id="${esc(r.id)}" aria-pressed="${wanted}" aria-label="Want ${esc(r.name)}">${icon.heart}</button>`;

/**
 * One pick (src/discover.js, through the pool) as a card. `owned`: the
 * list it's already in ("In Mine"), or null; `wanted`: on the wishlist;
 * `selected`: the style ids asked for (their chips light up); `key` the
 * list it's in.
 */
export function pickCardHTML(pick, { owned = null, wanted = false, selected = [], key = 'c' } = {}) {
  const r = pick.record;
  // A notes search's matches lead, lit: the note or accord as the bottle names it ("orris root").
  const matched = [...new Set((pick.matched ?? []).map(m => m.name).filter(Boolean))];
  const tags = [
    ...matched.map(name => ({ text: cap(name), kind: 'match', on: true })),
    ...(pick.styles ?? []).map(s => ({ text: s.label, color: styleColor(s.id), on: selected.includes(s.id) })),
    ...(pick.close ? [{ text: 'Wears close', kind: 'close', on: selected.includes('intimate') }] : []),
  ];
  const own = owned
    ? `<span class="owned-tag">${icon.check}${esc(owned)}</span>`
    : `<button class="btn secondary compact" data-action="disc-own" data-id="${esc(r.id)}">${icon.plus}<span>I own it</span><span class="visually-hidden">: ${esc(r.name)}</span></button>`;
  const dupes = `<button class="btn tertiary compact" data-action="disc-dupes" data-id="${esc(r.id)}">${icon.similar}<span>Similar &amp; cheaper</span><span class="visually-hidden"> to ${esc(r.name)}</span></button>`;
  return bottleCardHTML(r, {
    ctx: '',
    key,
    meta: metaOf(r),
    marks: marksOf(pick),
    tags,
    lines: whyLines(pick),
    corner: wantButton(r, wanted),
    actions: own + dupes,
  });
}

// ---------- Lists ----------

/**
 * A list of picks: cards, skeletons while it first loads (the old cards,
 * dimmed, while a change loads), a message when it failed or found nothing,
 * and "Show more". `slot` = { status: 'idle' | 'loading' | 'done' | 'error',
 * result: { picks }, error }; `k` how many were asked for; `name` the list
 * ('styles', 'like', 'notes'); `ownedOf(id)` and `wantedOf(id)` mark cards;
 * `empty` the message for no picks; `poolLoading` says the library is on its way.
 */
export function picksHTML(slot, { name, k = PAGE, ownedOf = () => null, wantedOf = () => false, selected = [], empty, poolLoading = false, insert = '' }) {
  const picks = slot.result?.picks ?? [];
  if (slot.status === 'error' && !slot.result) {
    return `${messageHTML({
      glyph: icon.cloud,
      title: 'Couldn’t load these',
      body: slot.error || 'Something went wrong. Try again.',
      action: `<button class="btn primary" data-action="disc-retry" data-value="${esc(name)}">${icon.refresh}<span>Try again</span></button>`,
    })}${insert}`;
  }
  if (!slot.result) {
    return `${poolLoading ? '<p class="disc-count muted">Loading the fragrance library…</p>' : ''}
      <div class="disc-grid" aria-busy="true">${bottleCardSkeletonHTML(4)}</div>`;
  }
  if (!picks.length) return `${empty}${insert}`;
  const loading = slot.status === 'loading';
  const more = picks.length >= k && k < MAX_PICKS;
  const cards = picks.map(p => pickCardHTML(p, { owned: ownedOf(p.id), wanted: wantedOf(p.id), selected, key: name }));
  // A module (the gap teaser) after the first INSERT_AT cards: seen without scrolling far.
  if (insert) cards.splice(Math.min(INSERT_AT, cards.length), 0, insert);
  return `${slot.status === 'error' ? `<p class="disc-count error">${esc(slot.error)}</p>` : ''}
    <div class="disc-grid${loading ? ' updating' : ''}"${loading ? ' aria-busy="true"' : ''}>${cards.join('')}</div>
    ${more ? `<div class="disc-more"><button class="btn secondary" data-action="disc-more" data-value="${esc(name)}"${loading ? ' disabled' : ''}>Show more</button></div>` : ''}`;
}

// ---------- By style ----------

// A style's tip: what it is, and which owned bottles are it.
export function styleTip(id, owned = []) {
  const blurb = STYLE_BY_ID.get(id)?.blurb ?? '';
  const mine = owned.length === 1 ? ` You own ${owned[0]}.`
    : owned.length ? ` You own ${owned.length}: ${listed(owned.slice(0, 3))}${owned.length > 3 ? ` and ${owned.length - 3} more` : ''}.`
    : ' You don’t own one yet.';
  return blurb + mine;
}

/**
 * The style chips, liked ones first (`order`), with how several combine
 * (any or all) and a line on what's asked. `owned`: style id -> names of
 * owned bottles of it, for the tips (long-press or hover; screen readers
 * hear them as the chip's description).
 */
export function stylePickerHTML({ order, selected, mode, owned = {}, all = false }) {
  const chips = order.map((id, i) => {
    const on = selected.includes(id);
    const extra = !on && i >= CHIPS_SHOWN ? ' extra' : '';
    return `<button type="button" class="style-chip${on ? ' on' : ''}${extra}" data-action="disc-style" data-value="${esc(id)}" aria-pressed="${on}" aria-describedby="disc-tip-${esc(id)}" style="--c:${styleColor(id)}">${icon.check}<span>${esc(styleLabel(id))}</span></button>`;
  }).join('');
  const hidden = order.filter((id, i) => !selected.includes(id) && i >= CHIPS_SHOWN).length;
  const toggle = hidden
    ? `<button type="button" class="btn tertiary compact styles-more" data-action="disc-styles-all" aria-expanded="${all}">${all ? 'Fewer styles' : `${hidden} more styles`}</button>`
    : '';
  const tips = order.map(id => `<span id="disc-tip-${esc(id)}">${esc(styleTip(id, owned[id]))}</span>`).join('');
  // One style: what it is. None: how to start. Several: the toggle says how they combine.
  const line = !selected.length ? 'Pick a style to see more of it. Press and hold one to see what it is.'
    : selected.length === 1 ? esc(STYLE_BY_ID.get(selected[0])?.blurb ?? '') : '';
  const combine = selected.length >= 2
    ? segHTML([{ value: 'any', label: 'Any of them', on: mode !== 'all' }, { value: 'all', label: 'All at once', on: mode === 'all' }], { action: 'disc-mode', label: 'Combine styles', cls: 'disc-combine' })
    : '';
  return `<div class="disc-styles${all ? ' all' : ''}">
      <div class="style-chips" role="group" aria-label="Scent styles" data-keep-scroll="disc-styles">${chips}${toggle}</div>
      <div class="disc-tip" role="tooltip" hidden></div>
      <div hidden>${tips}</div>
      ${combine || line ? `<div class="disc-styles-foot">${combine}${line ? `<p class="disc-line">${cap(line)}</p>` : ''}</div>` : ''}
    </div>`;
}

// ---------- By bottle ----------

const SEEDS_FROM = {
  worn: 'Your most worn of the last 60 days.',
  rated: 'Your best-rated bottles.',
};

/**
 * The bottles "more like" starts from: `seeds` records (null entries load),
 * `from` ('given', 'worn' or 'rated'), `chosen` (picked by hand: offer the
 * way back to the defaults).
 */
export function seedsHTML({ seeds, from, chosen, max }) {
  const chips = seeds.map(r => (r
    ? `<li class="seed">
        <button class="seed-open" data-action="open" data-ctx="" data-id="${esc(r.id)}">${img(r)}<span>${esc(r.name)}</span></button>
        <button class="icon-btn seed-x" data-action="disc-seed-remove" data-id="${esc(r.id)}" aria-label="Stop using ${esc(r.name)}">${icon.close}</button>
      </li>`
    : '<li class="seed sk-seed" aria-hidden="true"><span class="sk"></span></li>')).join('');
  const add = seeds.length < max
    ? `<li><button class="btn secondary compact seed-add" data-action="disc-seeds-open">${icon.plus}<span>${seeds.length ? 'Add' : 'Pick bottles'}</span></button></li>`
    : '';
  const line = chosen
    ? `Your picks. <button class="link-btn" data-action="disc-seeds-reset">Back to your favorites</button>`
    : SEEDS_FROM[from] ?? 'Pick bottles you love, and get more like them.';
  return `<div class="disc-seeds">
      <p class="disc-seeds-label">More like</p>
      <ul class="seeds" aria-label="Bottles to match">${chips}${add}</ul>
      <p class="disc-line">${line}</p>
    </div>`;
}

// ---------- Filters ----------

// A row of options, one chosen (a radio group: arrow keys move through it).
function radios(labelId, label, action, options, value) {
  const at = options.findIndex(o => o.value === value);
  const chosen = at < 0 ? 0 : at;
  return `<div class="filter-group">
      <p class="filter-label" id="${labelId}">${label}</p>
      <div class="opts" role="radiogroup" aria-labelledby="${labelId}">${options.map((o, i) => `<button type="button" role="radio" class="opt" aria-checked="${i === chosen}" tabindex="${i === chosen ? 0 : -1}" data-action="${action}" data-value="${esc(o.value ?? '')}">${esc(o.label)}</button>`).join('')}</div>
    </div>`;
}

const switchRow = (title, note, sw) => `<div class="filter-switch"><span><b>${title}</b>${note ? `<small>${note}</small>` : ''}</span>${sw}</div>`;

/**
 * The filters, for the side panel and the sheet alike (`prefix` keeps their
 * ids apart). `preferValue`: what the last answer used (the toggle shows
 * that); `mists`: whether the logic knows body mists (else no switch).
 */
export function filtersHTML(filters, { preferValue = false, mists = true, prefix = 'df' } = {}) {
  const f = { ...NO_FILTERS, ...filters };
  const seasons = SEASONS.map(s => {
    const on = f.seasons.includes(s);
    return `<button type="button" class="opt" aria-pressed="${on}" data-action="disc-season" data-value="${s}">${cap(s)}</button>`;
  }).join('');
  return `<div class="filters">
      <div class="filter-group">
        <p class="filter-label" id="${prefix}-season">Season</p>
        <div class="opts" role="group" aria-labelledby="${prefix}-season">${seasons}</div>
      </div>
      ${radios(`${prefix}-time`, 'Time of day', 'disc-time', [{ value: null, label: 'Any' }, { value: 'day', label: 'Day' }, { value: 'night', label: 'Night' }], f.time)}
      ${radios(`${prefix}-lean`, 'Lean', 'disc-lean', [{ value: null, label: 'Like yours' }, { value: 'feminine', label: 'Feminine' }, { value: 'unisex', label: 'Unisex' }, { value: 'masculine', label: 'Masculine' }], f.lean)}
      ${radios(`${prefix}-longevity`, 'Longevity', 'disc-longevity', LONGEVITY, f.longevity)}
      ${radios(`${prefix}-projection`, 'Projection', 'disc-projection', PROJECTION, f.projection)}
      <div class="filter-switches">
        ${switchRow('Prefer great value', 'Only bottles voters call great value for money.', switchHTML({ on: Boolean(preferValue), label: 'Prefer great value', action: 'disc-value', id: 'value' }))}
        ${switchRow('Safe blind buys', 'Only bottles most voters love.', switchHTML({ on: f.safe, label: 'Safe blind buys only', action: 'disc-switch', id: 'safe' }))}
        ${switchRow('Hide discontinued', '', switchHTML({ on: !f.discontinued, label: 'Hide discontinued', action: 'disc-switch', id: 'discontinued' }))}
        ${mists ? switchRow('Include body mists', 'Body and hair mists, sprays and splashes.', switchHTML({ on: f.mists, label: 'Include body mists', action: 'disc-switch', id: 'mists' })) : ''}
      </div>
    </div>`;
}

/** The phone and tablet way to the filters, with how many are on. */
export function filterButtonHTML(filters, { mists = true } = {}) {
  const n = filterCount(filters, { mists });
  return `<button class="btn secondary compact filter-btn" data-action="disc-filters-open" aria-label="Filters${n ? `, ${n} on` : ''}">${icon.filter}<span>Filters</span>${n ? `<b class="count" aria-hidden="true">${n}</b>` : ''}</button>`;
}

export function filterSheetHTML(filters, { preferValue, mists, status }) {
  const n = filterCount(filters, { mists });
  return `<h2 class="sheet-title" id="disc-filters-title">Filters</h2>
    <p class="lede muted">For the bottles by style, by bottle and by notes.</p>
    ${filtersHTML(filters, { preferValue, mists, prefix: 'dfx' })}
    <div class="sheet-bar spread">
      <button class="btn tertiary" data-action="disc-filters-reset"${n ? '' : ' disabled'}>Reset</button>
      <span class="muted" role="status">${esc(status)}</span>
      <button class="btn primary" data-action="close-sheet">Done</button>
    </div>`;
}

// ---------- Fill a gap ----------

// What a gap pick fills, in a line: its first fill, and how many more.
const fillsLine = pick => {
  const fills = pick.fills ?? [];
  if (!fills.length) return '';
  return `For ${fills[0].title}${fills.length > 1 ? ` and ${fills.length - 1} more` : ''}`;
};

/**
 * The gap finder's top picks (the pool's `report`, k 3), leading to
 * Wardrobe › Insights for the rest. `slot` as picksHTML's. Nothing when it
 * failed: the list it sits in says what went wrong, once.
 */
export function teaserHTML(slot, { wantedOf = () => false } = {}) {
  if (slot.status === 'error' && !slot.result) return '';
  const head = sectionHead('Fill a gap', `<a class="btn tertiary compact" href="#/wardrobe/insights">See all<span class="visually-hidden"> in Insights</span>${icon.chevron}</a>`, { id: 'disc-gap-title' });
  let body;
  if (!slot.result) {
    body = `<div class="teaser-sk" aria-hidden="true">${'<span class="sk"></span>'.repeat(3)}</div>`;
  } else {
    const r = slot.result;
    const gap = r.gaps?.[0];
    const lede = gap ? `Thinnest in your wardrobe: ${esc(gap.title)}.` : esc(r.overview?.text ?? 'Your wardrobe covers what you wear.');
    const rows = (r.picks ?? []).slice(0, 3).map(p => rowHTML(p.record, {
      meta: esc(fillsLine(p)),
      open: { ctx: '' },
      cls: 'wrap',
      trailing: wantButton(p.record, wantedOf(p.id)),
    })).join('');
    body = `<p class="teaser-lede">${lede}</p>${rows ? `<ul class="rows">${rows}</ul>` : ''}`;
  }
  return `<section class="card disc-teaser" aria-labelledby="disc-gap-title">${head}${body}</section>`;
}

// ---------- Search ----------

export function searchFormHTML(value) {
  return `<form class="disc-search" data-form="disc-search" role="search">
      <label class="filter big">${icon.search}<input type="search" name="q" data-field="disc-q" placeholder="Bottle, brand or notes like fig" value="${esc(value)}" autocomplete="off" aria-label="Search by name, brand or notes" enterkeyhint="search"></label>
    </form>`;
}

// The line screen readers hear for a name search: searching, the count, no
// matches, an error. The list itself stays out of it.
export function statusHTML({ query, results, busy, error, offline }) {
  if (busy && !results) return 'Searching…';
  if (error) return `<span class="error">${esc(error)}</span>`;
  if (results === null || results === undefined) return '';
  if (!results.length) return `No bottles named “${esc(query)}”.`;
  return offline
    ? `${plural(results.length, 'match', 'matches')} saved on this device. The full library needs a connection.`
    : plural(results.length, 'match', 'matches');
}

/**
 * Bottles by name: rows that open their pages, with the way to what smells
 * like it for less, and I own it. `owned`: id -> where it already is.
 */
export function namesHTML({ results }, owned) {
  if (!results?.length) return '';
  return `<ul class="rows results">${results.map((r, i) => {
    const where = owned.get(r.id);
    const dupes = `<button class="icon-btn ghost-btn" data-action="disc-dupes" data-id="${esc(r.id)}" aria-label="Similar and cheaper to ${esc(r.name)}" title="Similar &amp; cheaper">${icon.similar}</button>`;
    const trailing = `${dupes}${where
      ? `<span class="owned-tag">${icon.check}${esc(where)}</span>`
      : `<button class="btn secondary compact" data-action="own-result" data-value="${i}" aria-label="I own ${esc(r.name)}">${icon.plus}I own it</button>`}`;
    return rowHTML(r, { meta: metaOf(r), trailing, open: { ctx: '' } });
  }).join('')}</ul>`;
}

/** The two ways a search reads (names and notes), as a toggle when both found something. */
export function modeToggleHTML(mode, { names, notes }) {
  if (!names || !notes) return '';
  return segHTML([
    { value: 'notes', label: 'By notes', on: mode === 'notes' },
    { value: 'names', label: 'By name', on: mode === 'names' },
  ], { action: 'disc-by', label: 'Search', cls: 'disc-modes' });
}

/** What a search's list is, in a line: "With iris and leather", or names matching what was typed. */
export function searchTitleHTML(mode, { query, terms }) {
  const text = mode === 'notes' ? `With ${listed(terms ?? [])}` : `Names matching “${query}”`;
  return `<h2 class="disc-title">${esc(text)}</h2>`;
}

/** What the notes search made of the words: a typo it read, or one it might mean. */
export function notesNoteHTML(notes, query) {
  const out = [];
  for (const c of notes?.corrected ?? []) out.push(`Showing ${esc(c.to)} for “${esc(c.from)}”.`);
  for (const s of notes?.suggested ?? []) {
    const fixed = query.replace(new RegExp(`\\b${s.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), s.to);
    out.push(`Did you mean <button class="link-btn" data-action="disc-suggest" data-value="${esc(fixed)}">${esc(s.to)}</button>?`);
  }
  return out.length ? `<p class="disc-line">${out.join(' ')}</p>` : '';
}

/** Nothing by name or note: what to try instead. */
export const noMatchHTML = query => messageHTML({
  glyph: icon.search,
  title: 'Nothing by that name or note',
  body: `No bottle, note or accord matches “${query}”. Check the spelling, or try a brand, a note like vanilla, or an accord like woody.`,
});
