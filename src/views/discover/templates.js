// Discover's templates: the search field and its two lists (bottles named,
// bottles with these notes), the style chips and the seed bottles, the
// result cards, the filters (a side panel, or a sheet on phones), and the
// "Fill a gap" teaser. Pure functions of their arguments (test/discover-
// screens.test.js renders them in Node); src/views/discover.js feeds them.
// Styles: src/css/discover.css, the cards' src/css/components.css (.bcard).
import { esc, plural, valueWord, riskWord, ratingMark } from '../../ui.js';
import {
  icon, img, messageHTML, segHTML, switchHTML, rowHTML, sectionHead, bottleCardHTML, bottleCardSkeletonHTML, accordColor,
} from '../../ui/components.js';
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
export const styleColor = id => accordColor(STYLE_HUES[id] ?? 'powdery');

const listed = items => (items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
// The first few, then how many more: "A, B, C and 3 more".
const listedSome = (items, n = 3) => (items.length > n ? `${items.slice(0, n).join(', ')} and ${items.length - n} more` : listed(items));
// "skin scent, clean or intimate"
const either = items => (items.length < 3 ? items.join(' or ') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`);
// A bottle's meta: brand, year, and what kind of product it is when it isn't a perfume.
const metaOf = r => [r.brand, r.year, formatOf(r)].filter(Boolean).map(esc).join(' · ');
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
// A bottle named inside a sentence opens its page.
const named = (r, text = r.name) => `<button class="link-btn" data-action="open" data-ctx="" data-id="${esc(r.id)}">${esc(text)}</button>`;

// ---------- Cards ----------

// What kind of product a bottle is when it isn't a perfume spray: the pool's
// mist flag (scripts/decant.py) or its name ("Twilight Body Spray", "Amber
// Fragrance Oil"). A plain "Mist" or "Spray" in a name is a perfume's
// (Cashmere Mist, Iris Silver Mist), so the name has to say what kind.
const FORMATS = [
  [/\bhair (?:mist|perfume|spray)\b/i, 'Hair mist'],
  [/\b(?:body|fragrance|perfumed?|scented|skin) spray\b|\ball[- ]over spray\b/i, 'Body spray'],
  [/\b(?:body|fragrance|perfumed?|scented|skin) splash\b/i, 'Body splash'],
  [/\b(?:body|fine fragrance|fragrance|perfumed?|scented|skin) mist\b|\bbrume (?:pour le )?corps\b/i, 'Body mist'],
  [/\bbody oil\b/i, 'Body oil'],
  [/\b(?:perfume|fragrance|parfum|attar|concentrated) oil\b|\b(?:oil|attar)$/i, 'Perfume oil'],
];
export function formatOf(r) {
  const name = String(r?.name ?? '');
  const named = FORMATS.find(([re]) => re.test(name))?.[1];
  if (named) return named;
  return r?.extras?.flags?.includes('mist') ? 'Body mist' : null;
}

/** Value for money in words (src/ui.js, as every screen says it): { text, tone } or null for a fair price. */
export function valueMark(value) {
  const text = valueWord(value);
  if (!text || text === 'Fair price') return null;
  return { text, tone: text === 'Great value' ? 'good' : '' };
}

/** A blind buy's risk as a mark (medium and high only), the weightiest reason spoken after it. */
export function riskMark(risk) {
  if (!risk || (risk.level !== 'medium' && risk.level !== 'high')) return null;
  const text = riskWord(risk.level);
  // (Two sentences: a reason can hold a colon of its own.)
  const reason = risk.reasons?.[0];
  return { text, tone: 'warn', spoken: reason ? `${text}. ${reason}` : text };
}

function marksOf(pick) {
  const r = pick.record;
  const rating = pick.rating ?? r.rating;
  const votes = pick.votes ?? r.ratingVotes;
  return [
    rating ? { text: ratingMark(rating), spoken: `Rated ${rating.toFixed(2)} of 5${votes ? ` by ${votes.toLocaleString('en-US')} voters` : ''}` } : null,
    valueMark(pick.value ?? r.extras?.value),
    riskMark(pick.risk),
  ].filter(Boolean);
}

/**
 * Why a pick is here, as sentences (HTML, bottles named in them open their
 * pages), most telling first, at most `max`: what it shares with the seed
 * bottles, the nearest owned bottle and what they share, what voters say it
 * copies, a cheaper twin, twins folded into it, its link to the wardrobe,
 * and whether fans of the seeds like it. The seeds are "these bottles", not
 * "your picks": picks are what the app recommends.
 */
export function whyLines(pick, { max = 4 } = {}) {
  const lines = [];
  // (What a notes search matched shows as its tags.)
  if (pick.shares?.length) lines.push(`Shares ${esc(listed(pick.shares))} with these bottles.`);
  const near = pick.nearest;
  if (near) {
    const who = near.record ? named(near.record, near.name) : esc(near.name);
    // The owned bottle is a dupe of the bottle this one is near.
    const through = near.through ? ` (${/^[aeiou]/i.test(near.through) ? 'an' : 'a'} ${esc(near.through)} dupe)` : '';
    const traits = near.traits?.length ? `, sharing ${esc(listed(near.traits))}` : '';
    lines.push(`Nearest you own: ${who}${through}${traits}.`);
  }
  const copy = pick.clonesOf;
  if (copy) lines.push(`Most voters say it smells like ${copy.record ? named(copy.record, copy.name) : esc(copy.name)}${copy.brand ? ` by ${esc(copy.brand)}` : ''}.`);
  if (pick.twin?.record) lines.push(`Cheaper twin: ${named(pick.twin.record)}${pick.twin.record.brand ? ` by ${esc(pick.twin.record.brand)}` : ''}.`);
  const alike = (pick.alike ?? []).filter(r => r.id !== copy?.id);
  if (alike.length) lines.push(`Twins: ${listedSome(alike.map(r => named(r)))}.`);
  if (pick.family) lines.push(`${esc(cap(pick.family))}.`);
  if (pick.alsoLiked) lines.push('Fans of these bottles like it too.');
  return lines.slice(0, max);
}

/** Whether voters link a pick to other bottles: what it copies, twins, smells-like votes, cheaper alternatives. */
export const hasDupes = pick => Boolean(pick.clonesOf || pick.twin || pick.alike?.length
  || pick.record?.extras?.like?.length || pick.record?.extras?.alt?.length || pick.record?.extras?.clones?.length);

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
  const said = new Set(matched.map(name => name.toLowerCase()));
  const tags = [
    ...matched.map(name => ({ text: cap(name), kind: 'match', on: true })),
    ...(pick.styles ?? []).filter(s => !said.has(s.label.toLowerCase()))
      .map(s => ({ text: s.label, color: styleColor(s.id), on: selected.includes(s.id) })),
    // Named as its chip is (the tag's mark says it wears close).
    ...(pick.close ? [{ text: 'Intimate', kind: 'close', on: selected.includes('intimate') }] : []),
  ];
  const own = owned
    ? `<span class="owned-tag">${icon.check}${esc(owned)}</span>`
    : `<button class="btn secondary compact" data-action="disc-own" data-id="${esc(r.id)}">${icon.plus}<span>I own it</span><span class="visually-hidden">: ${esc(r.name)}</span></button>`;
  // Its page's smells-like section (the original, cheaper twins, voted
  // siblings), when voters link it to anything.
  const dupes = hasDupes(pick)
    ? `<button class="btn tertiary compact" data-action="disc-dupes" data-id="${esc(r.id)}" aria-label="What smells like ${esc(r.name)}">${icon.similar}<span>Smells like</span></button>`
    : '';
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
    ${more ? `<div class="disc-more"><button class="btn secondary" data-action="disc-more" data-value="${esc(name)}"${loading ? ' aria-disabled="true"' : ''}>Show more</button></div>` : ''}`;
}

// ---------- Above a list ----------

/** A list's title (focusable: Try again and the value line land there). */
// (data-focus: a repaint finds its successor, so focus on it survives an answer landing.)
export const listTitleHTML = text => `<h2 class="disc-title" tabindex="-1" data-focus="disc-title">${esc(text)}</h2>`;

/** By style's title: "More skin scent, clean or intimate bottles", or "Clean and intimate, all at once". */
export function stylesTitle(labels, mode = 'any') {
  const words = labels.map(l => l.toLowerCase());
  if (!words.length) return 'More of a style';
  if (mode === 'all' && words.length > 1) return cap(`${listed(words)}, all at once`);
  return `More ${either(words)} bottles`;
}

/** "Prefer great value" is on: a line over the list that says so, and the way to every bottle. */
export const valueFloorHTML = () => `<p class="disc-floor">${icon.check}<span>Great value only</span><button class="link-btn" data-action="disc-value" data-value="off">Show all<span class="visually-hidden"> bottles, not only great value</span></button></p>`;

// ---------- By style ----------

// A style's tip: what it is (`style`, from src/scent-styles.js STYLES), and which owned bottles are it.
export function styleTip(style, owned = []) {
  const blurb = style?.blurb ?? '';
  const mine = owned.length === 1 ? ` You own ${owned[0]}.`
    : owned.length ? ` You own ${owned.length}: ${listedSome(owned)}.`
    : ' You don’t own one yet.';
  return blurb + mine;
}

/**
 * The style chips, liked ones first (`order`), with how several combine
 * (any or all) and a line on what's asked. `styles`: src/scent-styles.js
 * STYLES (labels, blurbs). `owned`: style id -> names of owned bottles of
 * it, for the tips (long-press or hover; screen readers hear them as the
 * chip's description).
 */
export function stylePickerHTML({ styles, order, selected, mode, owned = {}, all = false }) {
  const byId = new Map(styles.map(s => [s.id, s]));
  const styleLabel = id => byId.get(id)?.label ?? id;
  const chips = order.map((id, i) => {
    const on = selected.includes(id);
    const extra = !on && i >= CHIPS_SHOWN ? ' extra' : '';
    return `<button type="button" class="style-chip${on ? ' on' : ''}${extra}" data-action="disc-style" data-value="${esc(id)}" aria-pressed="${on}" aria-describedby="disc-tip-${esc(id)}" style="--c:${styleColor(id)}">${icon.check}<span>${esc(styleLabel(id))}</span></button>`;
  }).join('');
  const hidden = order.filter((id, i) => !selected.includes(id) && i >= CHIPS_SHOWN).length;
  const toggle = hidden
    ? `<button type="button" class="btn tertiary compact styles-more" data-action="disc-styles-all" aria-expanded="${all}">${all ? 'Fewer styles' : `${hidden} more styles`}</button>`
    : '';
  const tips = order.map(id => `<span id="disc-tip-${esc(id)}">${esc(styleTip(byId.get(id), owned[id]))}</span>`).join('');
  // One style: what it is. None: how to read one (the message under the
  // chips says to pick one, stylesEmptyHTML). Several: the toggle says how they combine.
  const line = !selected.length
    ? '<span class="hint-touch">Press and hold a style</span><span class="hint-pointer">Point at a style</span> to see what it is.'
    : selected.length === 1 ? esc(byId.get(selected[0])?.blurb ?? '') : '';
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

/** No style chosen (an empty wardrobe starts this way): how to start, where the cards go. */
export const stylesEmptyHTML = () => messageHTML({
  glyph: icon.sparkle,
  title: 'Pick a style to start',
  body: 'Choose one or more above to see the best bottles in them.',
});

// ---------- By bottle ----------

/**
 * What "more like" starts from, as the list's title and a line under the
 * seeds: `from` ('given', 'worn' or 'rated', the answer's), `chosen`
 * (picked by hand: the line offers the way back to the defaults),
 * `loading` (the defaults are on their way), `none` (nothing to start from).
 */
export function likeHead({ from, chosen = false, loading = false, none = false }) {
  if (loading) return { title: 'More like your favorites', line: 'Loading your favorites…' };
  if (chosen) return { title: 'More like the bottles you chose', line: '<button class="link-btn" data-action="disc-seeds-reset">Back to your favorites</button>' };
  if (none || !from) return { title: 'More like bottles you love', line: '' };
  return from === 'worn'
    ? { title: 'More like your most worn', line: 'Your most worn of the last 60 days.' }
    : { title: 'More like your best rated', line: '' };
}

/**
 * The bottles "more like" starts from: `seeds` records (null entries load;
 * `{ id, missing: true }` the library couldn't find, removable), `max`, and
 * the line under them (likeHead's). `addable`: offer Add (not when the
 * message below already asks for bottles).
 */
export function seedsHTML({ seeds, max, line = '', addable = true }) {
  const chips = seeds.map(r => {
    if (!r) return '<li class="seed sk-seed" aria-hidden="true"><span class="sk"></span></li>';
    if (r.missing) {
      return `<li class="seed missing">
        <span class="seed-open">${icon.bottle}<span>Not found</span></span>
        <button class="icon-btn seed-x" data-action="disc-seed-remove" data-id="${esc(r.id)}" aria-label="Remove a bottle the library couldn’t find">${icon.close}</button>
      </li>`;
    }
    return `<li class="seed">
        <button class="seed-open" data-action="open" data-ctx="" data-id="${esc(r.id)}">${img(r)}<span>${esc(r.name)}</span></button>
        <button class="icon-btn seed-x" data-action="disc-seed-remove" data-id="${esc(r.id)}" aria-label="Stop using ${esc(r.name)}">${icon.close}</button>
      </li>`;
  }).join('');
  const add = addable && seeds.length < max
    ? `<li><button class="btn secondary compact seed-add" data-action="disc-seeds-open">${icon.plus}<span>${seeds.length ? 'Add' : 'Pick bottles'}</span></button></li>`
    : '';
  if (!chips && !add && !line) return '';
  return `<div class="disc-seeds">
      ${chips || add ? `<ul class="seeds" aria-label="Bottles to match">${chips}${add}</ul>` : ''}
      ${line ? `<p class="disc-line">${line}</p>` : ''}
    </div>`;
}

// ---------- Filters ----------

// An option's label, after the check it shows once chosen (as the style chips do).
const optLabel = text => `${icon.check}<span>${esc(text)}</span>`;

// A row of options, one chosen (a radio group: arrow keys move through it).
function radios(labelId, label, action, options, value) {
  const at = options.findIndex(o => o.value === value);
  const chosen = at < 0 ? 0 : at;
  return `<div class="filter-group">
      <p class="filter-label" id="${labelId}">${label}</p>
      <div class="opts" role="radiogroup" aria-labelledby="${labelId}">${options.map((o, i) => `<button type="button" role="radio" class="opt" aria-checked="${i === chosen}" tabindex="${i === chosen ? 0 : -1}" data-action="${action}" data-value="${esc(o.value ?? '')}">${optLabel(o.label)}</button>`).join('')}</div>
    </div>`;
}

const switchRow = (title, note, sw) => `<div class="filter-switch"><span><b>${title}</b>${note ? `<small>${note}</small>` : ''}</span>${sw}</div>`;

// What "Prefer great value" does. `byDefault`: it's unset, and the gap
// finder's default for this wardrobe is on, so Insights and the "Fill a
// gap" teaser use it while Discover's lists don't (src/views/discover.js valueOn).
const valueNote = byDefault => `Only bottles voters call great value for money.${byDefault ? ' Insights and Fill a gap use it by default; here it’s off until you turn it on.' : ''}`;

/**
 * The filters, for the side panel and the sheet alike (`prefix` keeps their
 * ids apart). `preferValue`: what the last answer used (the toggle shows
 * that); `valueDefault`: the setting is unset and the gap finder's default
 * is on (the switch's note says why it reads off here).
 */
export function filtersHTML(filters, { preferValue = false, valueDefault = false, prefix = 'df' } = {}) {
  const f = { ...NO_FILTERS, ...filters };
  const seasons = SEASONS.map(s => {
    const on = f.seasons.includes(s);
    return `<button type="button" class="opt" aria-pressed="${on}" data-action="disc-season" data-value="${s}">${optLabel(cap(s))}</button>`;
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
        ${switchRow('Prefer great value', valueNote(!preferValue && valueDefault), switchHTML({ on: Boolean(preferValue), label: 'Prefer great value', action: 'disc-value', id: 'value' }))}
        ${switchRow('Safe blind buys', 'Safer than most popular bottles.', switchHTML({ on: f.safe, label: 'Safe blind buys only', action: 'disc-switch', id: 'safe' }))}
        ${switchRow('Hide discontinued', '', switchHTML({ on: !f.discontinued, label: 'Hide discontinued', action: 'disc-switch', id: 'discontinued' }))}
        ${switchRow('Include body mists', 'Body and hair mists, sprays and splashes.', switchHTML({ on: f.mists, label: 'Include body mists', action: 'disc-switch', id: 'mists' }))}
      </div>
    </div>`;
}

/** The phone and tablet way to the filters, with how many are on (`value`: Prefer great value). */
export function filterButtonHTML(filters, { value = false } = {}) {
  const n = filterCount(filters, { value });
  return `<button class="btn secondary compact filter-btn" data-action="disc-filters-open" aria-label="Filters${n ? `, ${n} on` : ''}">${icon.filter}<span>Filters</span>${n ? `<b class="count" aria-hidden="true">${n}</b>` : ''}</button>`;
}

/**
 * The filters sheet's status: how many bottles the list on screen holds, of
 * `k` asked for. A full page is the best of more: it says what's shown, not
 * a count it isn't.
 */
export function fitLine(n, k) {
  if (!n) return 'Nothing fits';
  return n < k ? `${plural(n, 'bottle')} ${n === 1 ? 'fits' : 'fit'}` : `Showing the top ${n}`;
}

// (data-part: what a change redraws; data-live: the status line, which keeps its node so it's heard.)
export function filterSheetHTML(filters, { preferValue, valueDefault = false, status }) {
  const n = filterCount(filters, { value: Boolean(preferValue) });
  return `<h2 class="sheet-title" id="disc-filters-title">Filters</h2>
    <p class="lede muted">For the bottles by style, by bottle and by notes.</p>
    <div data-part="filters">${filtersHTML(filters, { preferValue, valueDefault, prefix: 'dfx' })}</div>
    <div class="sheet-bar spread">
      <button class="btn tertiary" data-part="filters-reset" data-action="disc-filters-reset"${n ? '' : ' disabled'}>Reset</button>
      <span class="muted" role="status" data-live="filter-status">${esc(status)}</span>
      <button class="btn primary" data-action="close-sheet">Done</button>
    </div>`;
}

// ---------- Fill a gap ----------

// What a gap pick fills, in a line: its first fill as Insights names it,
// and how many more ("Fills Date Night on mild nights and 2 more").
export const fillsLine = pick => {
  const fills = pick.fills ?? [];
  if (!fills.length) return '';
  return `Fills ${fills[0].title}${fills.length > 1 ? ` and ${fills.length - 1} more` : ''}`;
};

/**
 * The gap finder's top picks (the pool's `report`, k 3), leading to
 * Wardrobe › Insights for the rest. `slot` as picksHTML's. Nothing when it
 * failed: the list it sits in says what went wrong, once.
 */
export function teaserHTML(slot, { wantedOf = () => false } = {}) {
  if (slot.status === 'error' && !slot.result) return '';
  const head = sectionHead('Fill a gap', `<a class="btn tertiary compact" href="#/wardrobe/insights" data-focus="disc-gap-all">See all<span class="visually-hidden"> in Insights</span>${icon.chevron}</a>`, { id: 'disc-gap-title' });
  let body;
  if (!slot.result) {
    body = `<div class="teaser-sk" aria-hidden="true">${'<span class="sk"></span>'.repeat(3)}</div>`;
  } else {
    const r = slot.result;
    const picks = (r.picks ?? []).slice(0, 3);
    const lede = picks.length ? 'Bottles for what your wardrobe covers least.' : esc(r.overview?.text ?? 'Your wardrobe covers what you wear.');
    const rows = picks.map(p => rowHTML(p.record, {
      meta: [p.record.brand, fillsLine(p)].filter(Boolean).map(esc).join(' · '),
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
 * Bottles by name: rows that open their pages, with Want and I own it.
 * `owned`: id -> where it already is; `wantedOf(id)`: on the wishlist.
 */
export function namesHTML({ results }, owned, { wantedOf = () => false } = {}) {
  if (!results?.length) return '';
  return `<ul class="rows results">${results.map((r, i) => {
    const where = owned.get(r.id);
    // I own it, then whose (names repeat: Creed's Aventus and Nish's), heard
    // after the words shown, so voice control's "click I own it" finds it.
    const whose = [r.name, r.brand].filter(Boolean).map(esc).join(' by ');
    const trailing = `${wantButton(r, wantedOf(r.id))}${where
      ? `<span class="owned-tag">${icon.check}<span>${esc(where)}</span></span>`
      : `<button class="btn secondary compact own-btn" data-action="own-result" data-value="${i}">${icon.plus}<span>I own it</span><span class="visually-hidden">: ${whose}</span></button>`}`;
    return rowHTML(r, { meta: metaOf(r), trailing, open: { ctx: '' }, cls: 'wrap' });
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
  return listTitleHTML(text);
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

/** The search couldn't reach the library, and nothing on this device matched. */
export const searchErrorHTML = error => messageHTML({
  glyph: icon.cloud,
  title: 'Couldn’t search',
  body: error || 'Something went wrong. Try again.',
  action: `<button class="btn primary" data-action="disc-retry" data-value="notes">${icon.refresh}<span>Try again</span></button>`,
});

/** Nothing by name or note: what to try instead. */
export const noMatchHTML = query => messageHTML({
  glyph: icon.search,
  title: 'Nothing by that name or note',
  body: `No bottle, note or accord matches “${query}”. Check the spelling, or try a brand, a note like vanilla, or an accord like woody.`,
});
