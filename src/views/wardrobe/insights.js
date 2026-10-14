// Wardrobe › Insights: what kinds of fragrance the wardrobe still needs, in
// two halves. Situations: the gap finder's report (src/gaps.js, asked of the
// pool client) as a headline, a coverage map of each use against the weather
// by day and night, where it's thin, where it's strong, and the bottles that
// would fill the gaps. Styles: the wardrobe's style mix (worked out here, from
// the owned bottles alone), more of the styles you like, a starter for each
// style you don't own, and doubles (bottles that smell alike). The modules it
// needs beyond the boot graph load when the pane first opens (parts.js).
// Styles: src/css/wardrobe.css.
import { esc, plural, cap, temp, deg } from '../../ui.js';
import { icon, img, messageHTML, sectionHead, segHTML, switchHTML, sheetFrame, rowHTML } from '../../ui/components.js';
import { askPool, warmPool } from '../../app/pool.js';
import {
  state, activeFragrances, findRecord, ownedIn, poolInputs, setPreferValue, setLikedStyles,
} from '../../app/state.js';
import { loadWants, setWant } from '../../wishlist.js';
import {
  libNow, loadLib, likedFor, taggedWears, inputsKey, ownable, repaint, ratingText, valueWord, riskText, fillsHTML, wantButton, nearestText,
} from './parts.js';

// ---------- The pane's own state ----------

const ins = {
  key: null, // the inputs (inputsKey) the report answers or is being asked for
  report: null, // gapReport from the pool, null until the first lands
  error: '', // a sentence, when the report couldn't be worked out
  libError: '',
  busy: false, // a newer report is on its way (the old one stays, dimmed)
  fresh: false, // the first report since the pane opened: its map fills in
  climate: null, // 'local' | 'default' (no place set) | 'failed' (the archive didn't answer)
  cell: null, // the map's cell picked (id); null = the worst gap
  slot: null, // Day or Night on narrow screens; null = the picked cell's
  open: null, // the style mix row showing its bottles
  allStyles: false, // the style mix shows every style
  styles: { key: null, more: {}, starters: {}, error: '' },
};

// Statuses from the gap finder, worst first, as the map's legend reads.
export const STATUS_WORD = { gap: 'Gap', thin: 'Thin', room: 'Room to grow', covered: 'Covered', plenty: 'Plenty', off: 'Never' };
const LEGEND = ['plenty', 'covered', 'room', 'thin', 'gap'];
const SLOT_WORD = { day: 'days', night: 'nights' };
// Under this share of wears a cell rarely comes up (MIN_WEIGHT in src/gaps.js): its vial is faded.
const RARE = 0.004;
// A starter for a style you don't own: well rated, a safe blind buy, fair value.
const STARTER = { minRating: 4, minSafe: 50, minValue: 3.5 };
const MAX_STARTERS = 6;
const MORE_PICKS = 3;
// Style mix rows shown before "Show all" (liked ones always show).
const MIX_ROWS = 8;
// What a style's bottles are called in "More …".
const STYLE_NOUN = {
  skin: 'skin scents', clean: 'clean scents', citrus: 'fresh citrus scents', aromatic: 'barbershop scents', gourmand: 'gourmands',
  amber: 'ambers', oud: 'ouds', leather: 'leathers', incense: 'incense and smoke scents', whiteFloral: 'white florals', floral: 'florals',
  powdery: 'powdery iris scents', chypre: 'chypres', woody: 'woody scents', spicy: 'spicy scents', fruity: 'fruity scents',
};
const nounOf = s => STYLE_NOUN[s.id] ?? `${s.label.toLowerCase()} scents`;
const pct = x => Math.round(x * 100);

// ---------- Templates (pure) ----------

const vial = (status, { rare = false, i = null } = {}) =>
  `<span class="vial${rare ? ' rare' : ''}" data-status="${esc(status)}"${i == null ? '' : ` style="--i:${i}"`} aria-hidden="true"><span class="vial-fill"></span></span>`;

/** The headline: how much of what you wear has a strong pick, and whether anything's thin. */
export function headline(report) {
  const share = report.overview.strongShare;
  const lead = share >= 0.95 ? 'You’re covered for nearly everything you wear.' : `You have a strong pick for ${pct(share)}% of what you wear.`;
  const tail = !report.gaps.length ? 'Nothing’s thin. Here’s where you’re strongest.'
    : report.gaps.some(g => g.status !== 'room') ? 'Here’s where it’s thin.' : 'Here’s where it could go further.';
  return { lead, tail };
}

/**
 * The line under the headline and its controls: the climate it read
 * (`climate` 'local', 'default' or 'failed', or null while it loads), "How
 * you wear" and how many logged wears tune it, "Prefer great value".
 */
export function contextHTML({ place, climate, tagged, preferValue }) {
  const where = esc(place ?? 'your area');
  const line = climate === 'default'
    ? `<span>A typical temperate climate. <button class="link-btn" data-action="location">Set your location</button> to use yours.</span>`
    : climate === 'failed'
      ? `<span>Couldn’t load ${where}’s climate, so this uses a typical temperate one.</span>`
      : `<span>Your climate: <b>${where}</b></span><button class="link-btn" data-action="location" aria-label="Change location">Change</button>`;
  return `<div class="ins-context">
    <p class="ins-climate">${icon.pin}${line}</p>
    <div class="ins-controls">
      <button class="btn secondary compact" data-action="ins-uses">${icon.calendar}<span>How you wear</span></button>
      <span class="ins-switch"><span aria-hidden="true">Prefer great value</span>${preferValue == null ? '<span class="sk sk-switch" aria-hidden="true"></span>'
    : switchHTML({ on: preferValue, label: 'Prefer great value', action: 'ins-value', id: 'value' })}</span>
    </div>
    ${tagged ? `<p class="muted small ins-tuned">Tuned by the ${plural(tagged, 'wear')} you logged for an occasion.</p>` : ''}
  </div>`;
}

// The cell the map opens on: the costliest of the worst gap's cells.
function defaultCell(report) {
  const g = report.gaps[0];
  if (!g) return report.coverage.find(c => c.status !== 'off')?.cell ?? null;
  return worstOf(report, g.cells)?.cell ?? g.cells[0];
}
// Of some cells, the one in the worst state (a gap before room to grow), the costliest of those.
const SERIOUS = ['gap', 'thin', 'room', 'covered', 'plenty', 'off'];
const worstOf = (report, ids) => report.coverage.filter(c => ids.includes(c.cell))
  .sort((a, b) => SERIOUS.indexOf(a.status) - SERIOUS.indexOf(b.status) || b.severity - a.severity)[0] ?? null;
const placeWords = c => `${c.band} ${SLOT_WORD[c.slot]}`;

/** Feels-like bands as the map's columns: { id, label, range } in today's units. */
export const bandColumns = bands => bands.map(b => ({
  id: b.id,
  label: cap(b.id),
  range: b.lo === -Infinity ? `<${deg(b.hi)}` : b.hi === Infinity ? `${deg(b.lo)}+` : `${temp(b.lo)}–${deg(b.hi)}`,
}));

/**
 * The coverage map: uses down the side, the weather across, by day and by
 * night (one at a time on narrow screens: `slot`). Each cell is a vial as
 * full as the situation is covered, and opens its detail (`cell`).
 */
export function coverageHTML(report, { uses, bands, cell, slot, fresh = false }) {
  const byCell = new Map(report.coverage.map(c => [c.cell, c]));
  let picked = byCell.get(cell) ?? byCell.get(defaultCell(report));
  const show = slot ?? picked?.slot ?? 'night';
  // The picked cell is the map's one tab stop, so it's always one on show.
  if (picked && picked.slot !== show) picked = worstOf(report, report.coverage.filter(c => c.slot === show && c.status !== 'off').map(c => c.cell)) ?? picked;
  const slots = ['day', 'night'];
  let i = 0;
  // The first column of nights stands a little apart from the days.
  const edge = (s, b) => (s === 'night' && b === bands[0] ? ' class="edge"' : '');
  const td = (u, s, b) => {
    const c = byCell.get(`${u.id}:${s}:${b.id}`);
    if (!c) return `<td data-slot="${s}"${edge(s, b)}><span class="cov-na" aria-hidden="true"></span><span class="visually-hidden">Doesn’t come up</span></td>`;
    const best = c.top[0];
    const label = `${u.label}, ${b.id} ${SLOT_WORD[s]}: ${STATUS_WORD[c.status]}. ${best ? `Your best: ${best.name}, ${pct(best.score)}% match.` : 'Nothing you own fits.'}`;
    return `<td data-slot="${s}"${edge(s, b)}><button class="cov-cell" data-action="ins-cell" data-value="${esc(c.cell)}" aria-pressed="${c === picked}" tabindex="${c === picked ? 0 : -1}" aria-label="${esc(label)}">${vial(c.status, { rare: c.weight < RARE, i: i++ })}</button></td>`;
  };
  const rows = uses.map(u => {
    const has = slots.filter(s => bands.some(b => byCell.has(`${u.id}:${s}:${b.id}`)));
    const off = report.coverage.some(c => c.use === u.id && c.status === 'off');
    const only = has.length === 1 ? ` class="only-${has[0]}"` : '';
    return `<tr${only}><th scope="row">${esc(u.label)}${off ? '<small>Never</small>' : ''}</th>${slots.map(s => bands.map(b => td(u, s, b)).join('')).join('')}</tr>`;
  }).join('');
  const heads = slots.map(s => bands.map(b => `<th scope="col" data-slot="${s}"${edge(s, b)}><span>${esc(b.label)}</span><small>${esc(b.range)}</small></th>`).join('')).join('');
  const groups = slots.map(s => `<th colspan="${bands.length}" data-slot="${s}"${edge(s, bands[0])}>${s === 'day' ? icon.sun : icon.moon}<span>${s === 'day' ? 'Day' : 'Night'}</span></th>`).join('');
  return `<div class="cov${fresh ? ' fill-in' : ''}" data-show="${show}">
    ${segHTML(slots.map(s => ({ value: s, label: s === 'day' ? 'Day' : 'Night', icon: s === 'day' ? icon.sun : icon.moon, on: s === show })), { action: 'ins-slot', label: 'Show the map for', cls: 'cov-toggle' })}
    <div class="cov-scroll">
      <table class="cov-table">
        <caption class="visually-hidden">How well your bottles cover each occasion in each kind of weather, by day and by night. Feels-like temperatures. Arrow keys move between cells.</caption>
        <colgroup><col class="cov-use"></colgroup>
        <thead><tr class="cov-slots"><td></td>${groups}</tr><tr class="cov-bands"><td></td>${heads}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <ul class="cov-legend" aria-label="Key">
      ${LEGEND.map(s => `<li>${vial(s)}<span>${STATUS_WORD[s]}</span></li>`).join('')}
    </ul>
    <p class="muted small cov-note">Fuller is better covered. Faded ones rarely come up where you live. Tap one to see your best bottles there.</p>
    ${picked ? cellDetailHTML(picked, report) : ''}
  </div>`;
}

/** How often a cell comes up, in words. */
export function oftenText(weight) {
  if (weight < RARE) return 'Rarely comes up for you.';
  if (weight >= 0.05) return `About ${pct(weight)}% of what you wear.`;
  return `About 1 in ${Math.round(1 / weight)} of your wears.`;
}

/** One cell, opened: what covers it now and the suggestions that would beat it. */
export function cellDetailHTML(c, report, resolve = findRecord) {
  const beat = report.picks
    .map(p => ({ p, f: p.fills.find(f => f.cell === c.cell) }))
    .filter(x => x.f && x.f.to > (c.top[0]?.score ?? 0))
    .sort((a, b) => b.f.to - a.f.to);
  const best = c.top.length
    ? `<ol class="cov-best">${c.top.map(t => {
      const f = resolve(t.id) ?? { id: t.id, name: t.name };
      return `<li><button class="cov-bottle" data-action="open" data-ctx="" data-id="${esc(t.id)}">${img(f)}<span>${esc(t.name)}</span><b>${pct(t.score)}%</b></button></li>`;
    }).join('')}</ol>`
    : '<p class="muted small">Nothing you own fits here.</p>';
  const better = beat.length
    ? `<p class="cov-sub">Would beat them</p><ol class="cov-best">${beat.map(({ p, f }) => `<li><button class="cov-bottle" data-action="open" data-ctx="" data-id="${esc(p.id)}">${img(p.record ?? p)}<span>${esc(p.name)}</span><b>${pct(f.to)}%</b></button></li>`).join('')}</ol>`
    : ['gap', 'thin', 'room'].includes(c.status) ? '<p class="muted small cov-none">None of the suggestions below lifts this one by enough.</p>' : '';
  return `<div class="cov-detail" id="ins-detail">
    <div class="cov-detail-head">
      ${vial(c.status, { rare: c.weight < RARE })}
      <h3 id="ins-detail-title" tabindex="-1">${esc(c.title)}</h3>
      <span class="status-word" data-status="${esc(c.status)}">${STATUS_WORD[c.status]}</span>
    </div>
    <p class="muted small">${esc(oftenText(c.weight))}</p>
    <p class="cov-sub">Your best here</p>
    ${best}
    ${better}
  </div>`;
}

// A thin spot's line: who covers it now, and how far the best go.
function thinLine(c) {
  const best = c?.top[0];
  if (!best) return 'Nothing you own fits here.';
  if (c.status === 'thin') return `Only ${best.name} is a strong pick here, at ${pct(best.score)}% match.`;
  return `Your best is ${best.name} at ${pct(best.score)}% match; the best bottles reach ${pct(c.target)}%.`;
}

/** Where it's thin (gaps, thin spots, room to grow), each with the suggestions that fill it. */
export function thinHTML(report) {
  if (!report.gaps.length) return '<p class="muted ins-empty-line">Nothing’s thin. Every situation you dress for has a strong pick.</p>';
  return `<ul class="thin-list">${report.gaps.map(g => {
    const worst = worstOf(report, g.cells);
    const fillers = report.picks.filter(p => p.fills.some(f => f.matters && g.cells.includes(f.cell)));
    const word = STATUS_WORD[g.status];
    return `<li class="thin-row">
      ${vial(g.status)}
      <div class="thin-text">
        <h3><button class="thin-title" data-action="ins-cell" data-value="${esc(worst?.cell ?? g.cells[0])}">${esc(g.title)}</button></h3>
        <p><span class="status-word" data-status="${esc(g.status)}">${word}</span> ${esc(thinLine(worst))}</p>
        ${fillers.length ? `<p class="thin-fix">Filled by ${fillers.map(p => `<button class="link-btn" data-action="open" data-ctx="" data-id="${esc(p.id)}">${esc(p.name)}</button>`).join(', ')}</p>` : ''}
      </div>
    </li>`;
  }).join('')}</ul>`;
}

/** Where it's strong: "Plenty for Date Night on cold nights", "Amber Empire and 5 more". */
export function strongHTML(report) {
  if (!report.strengths.length) return '';
  const byCell = new Map(report.coverage.map(c => [c.cell, c]));
  return `<h3 class="ins-subhead">Where you’re strong</h3>
    <ul class="strong-list">${report.strengths.map(s => {
    const lead = byCell.get(s.cells[0])?.top[0]?.name;
    const more = Math.max(0, s.strong - 1);
    return `<li class="strong-row">${vial('plenty')}<div><b>Plenty for ${esc(s.title)}</b><span>${lead ? `${esc(lead)}${more ? ` and ${more} more` : ''}` : plural(s.strong, 'strong pick')}</span></div></li>`;
  }).join('')}</ul>`;
}

/**
 * A suggestion: photo, name, brand, rating, value and risk, the situations
 * it fills against your best there, its cheaper twin, and Want / I own it.
 * owned: where it already is (a label) or null.
 */
export function pickCardHTML(p, { wanted = false, owned = null } = {}) {
  const f = p.record ?? p;
  const fills = p.fills.filter(x => x.matters);
  const risk = riskText(p.risk);
  const facts = [ratingText(p.rating, p.ratingVotes), valueWord(p.quality?.value), risk.word].filter(Boolean);
  const twin = p.twin && !p.twin.owned
    ? `<p class="ins-twin">Cheaper twin: <button class="link-btn" data-action="open" data-ctx="" data-id="${esc(p.twin.id)}">${esc(p.twin.name)}</button>${p.twin.brand ? ` by ${esc(p.twin.brand)}` : ''}${valueWord(p.twin.value) ? `, ${esc(valueWord(p.twin.value).toLowerCase())}` : ''}.</p>`
    : '';
  const own = owned
    ? `<span class="owned-tag">${icon.check}${esc(owned)}</span>`
    : `<button class="btn tertiary compact" data-action="ins-own" data-id="${esc(p.id)}">${icon.check}<span>I own it<span class="visually-hidden">: ${esc(p.name)}</span></span></button>`;
  // The photo opens it too, for a pointer (as on the Wishlist).
  return `<li class="ins-pick">
    <button class="ins-pick-photo" data-action="open" data-id="${esc(p.id)}" tabindex="-1" aria-hidden="true">${img(f)}</button>
    <div class="ins-pick-body">
      <h3 class="ins-pick-name"><button class="pick-name-btn" data-action="open" data-ctx="" data-id="${esc(p.id)}">${esc(p.name)}</button></h3>
      <p class="ins-pick-brand">${esc([p.brand, p.year].filter(Boolean).join(', '))}</p>
      <p class="ins-facts">${facts.map((t, i) => (i ? `<span>${esc(t)}</span>` : `<b>${esc(t)}</b>`)).join(' · ')}</p>
      ${risk.reason ? `<p class="muted small">${esc(risk.reason)}</p>` : ''}
      ${fillsHTML(fills.length ? fills : p.fills)}
      ${p.nearest ? `<p class="muted small ins-near">${esc(nearestText(p.nearest))}.</p>` : ''}
      ${twin}
      <div class="action-row">${wantButton(p, wanted)}${own}</div>
    </div>
  </li>`;
}

export function picksHTML(report, { wants = new Set(), ownedLabel = () => null } = {}) {
  const note = report.preferValue
    ? '<p class="muted small">Only bottles voters call great value. Turn off Prefer great value to see the rest.</p>'
    : '';
  if (!report.picks.length) {
    return `<p class="muted">${report.gaps.length ? 'Nothing in the library fills these by enough.' : 'Nothing to fill.'}</p>${note}`;
  }
  return `<ul class="ins-picks">${report.picks.map(p => pickCardHTML(p, { wanted: wants.has(p.id), owned: ownedLabel(p.id) })).join('')}</ul>${note}`;
}

/**
 * The style mix: how many bottles lean toward each style, liked ones
 * hearted. rows: [{ id, label, count, liked, bottles (records), close (a wear style) }].
 */
export function styleMixHTML(rows, { open = null, stated = true, all = false } = {}) {
  if (!rows.length) return '<p class="muted">None of your bottles leans clearly toward one style yet.</p>';
  const max = Math.max(...rows.map(r => r.count));
  // The top MIX_ROWS and every liked one, until asked for all.
  const shown = all || rows.length <= MIX_ROWS + 2 ? rows : rows.filter((r, i) => i < MIX_ROWS || r.liked);
  const hidden = rows.length - shown.length;
  return `<p class="muted small mix-key">${stated ? 'Hearted: the styles you like.' : 'Hearted: what most of your bottles lean toward. Heart the styles you like.'} Tap a style to see its bottles.</p>
    <ul class="mix" id="ins-mix-list">${shown.map(r => {
    const expanded = open === r.id;
    return `<li class="mix-row${r.liked ? ' liked' : ''}">
      <button class="mix-main" data-action="ins-mix" data-value="${esc(r.id)}" aria-expanded="${expanded}">
        <span class="mix-label">${esc(r.label)}${r.close ? '<small>wears close</small>' : ''}</span>
        <span class="mix-track" aria-hidden="true"><span class="mix-bar" style="width:${((r.count / max) * 100).toFixed(1)}%"></span></span>
        <span class="mix-n">${r.count}<span class="visually-hidden"> ${r.count === 1 ? 'bottle' : 'bottles'}</span></span>
      </button>
      <button class="icon-btn ghosted mix-like" data-action="ins-like" data-value="${esc(r.id)}" aria-pressed="${r.liked}" aria-label="I like ${esc(r.label)}">${icon.heart}</button>
      ${expanded ? `<ul class="mix-bottles">${r.bottles.map(f => `<li><button data-action="open" data-ctx="" data-id="${esc(f.id)}">${img(f)}<span>${esc(f.name)}</span></button></li>`).join('')}</ul>` : ''}
    </li>`;
  }).join('')}</ul>
    ${hidden ? `<button class="btn tertiary compact mix-all" data-action="ins-mix-all" aria-controls="ins-mix-list">${icon.chevron}<span>Show all ${rows.length} styles</span></button>`
    : all && rows.length > MIX_ROWS + 2 ? `<button class="btn tertiary compact mix-all less" data-action="ins-mix-all" aria-controls="ins-mix-list">${icon.chevron}<span>Show fewer</span></button>` : ''}`;
}

const pickMeta = p => [p.record.brand, ratingText(p.rating)?.split(' · ')[0], valueWord(p.value)].filter(Boolean).map(esc).join(' · ');

/** "More skin scents": per group of liked styles, its top picks (undefined while loading, null when it failed). */
export function moreHTML(groups, { wants = new Set() } = {}) {
  if (!groups.length) return '<p class="muted">Heart a style above and the best bottles in it show here.</p>';
  return `<div class="ins-more-groups">${groups.map(g => {
    const list = g.picks === undefined ? skeletonRows(MORE_PICKS)
      : !g.picks?.length ? '<p class="muted small">Nothing new to suggest here: you have the best of it.</p>'
        : `<ul class="rows more-rows">${g.picks.map(p => rowHTML(p.record, { meta: pickMeta(p), open: { ctx: '' }, trailing: wantButton(p.record, wants.has(p.id), { iconOnly: true }) })).join('')}</ul>`;
    return `<section class="ins-more" aria-label="${esc(g.title)}">
      <h3 class="ins-more-head">${esc(g.title)}</h3>
      ${list}
    </section>`;
  }).join('')}</div>`;
}

const skeletonRows = n => `<ul class="rows sk-rows" aria-hidden="true">${'<li class="row"><span class="sk sk-dot"></span><span class="sk-lines"><span class="sk sk-line w40"></span><span class="sk sk-line w70"></span></span></li>'.repeat(n)}</ul>`;

/** Styles you don't own yet, each with one starter: [{ style: { id, label, blurb }, pick (undefined while loading, null for none) }]. */
export function startersHTML(items, { wants = new Set(), more = 0 } = {}) {
  if (!items.length) return '<p class="muted">You own something in every style. That’s a well-rounded shelf.</p>';
  return `<ul class="starters">${items.map(({ style, pick }) => {
    const body = pick === undefined ? skeletonRows(1)
      : !pick ? '<p class="muted small starter-none">Nothing well rated and safe to buy blind yet.</p>'
        : `<ul class="rows starter-rows">${rowHTML(pick.record, { meta: pickMeta(pick), open: { ctx: '' }, trailing: wantButton(pick.record, wants.has(pick.id), { iconOnly: true }) })}</ul>`;
    return `<li class="starter">
      <div class="starter-head"><h3>${esc(style.label)}</h3><a class="link-btn" href="#/discover?styles=${esc(style.id)}" aria-label="Explore ${esc(style.label.toLowerCase())} in Discover">Explore</a></div>
      <p class="muted small">${esc(style.blurb)}</p>
      ${body}
    </li>`;
  }).join('')}</ul>${more ? `<p class="muted small">And ${plural(more, 'more style')} in Discover.</p>` : ''}`;
}

const listWords = w => (w.length <= 2 ? w.join(' and ') : `${w.slice(0, -1).join(', ')} and ${w.at(-1)}`);


/** Doubles: pairs that smell alike, or the closest pair when there are none. */
export function doublesHTML({ pairs, closest }) {
  if (!pairs.length) {
    return `<p class="muted">No doubles: every bottle smells its own way.${closest ? ` The closest pair, ${esc(closest.a.name)} and ${esc(closest.b.name)}, is ${pct(closest.sim)}% alike${closest.traits.length ? `, sharing ${esc(listWords(closest.traits))}` : ''}.` : ''}</p>`;
  }
  return `<p class="muted small">Pairs that wear much the same. Worth knowing before the next one like them.</p>
    <ul class="doubles">${pairs.map(p => `<li class="double">
      <span class="double-photos">${[p.a, p.b].map(f => `<button data-action="open" data-ctx="" data-id="${esc(f.id)}" aria-label="Open ${esc(f.name)}">${img(f)}</button>`).join('')}</span>
      <span class="double-text"><b>${esc(p.a.name)} and ${esc(p.b.name)}</b><small>${esc(p.reason)} · ${pct(p.sim)}% alike</small></span>
    </li>`).join('')}</ul>`;
}

/** "How you wear": Never / Sometimes / Often per occasion; Daily always counts. */
export function usesSheetHTML({ uses, settings, tagged = 0 }) {
  const levels = [['never', 'Never'], ['sometimes', 'Sometimes'], ['often', 'Often']];
  return sheetFrame('uses-title', `
    <h2 id="uses-title" class="sheet-title">How you wear</h2>
    <p class="muted lede">How often you dress for each occasion. Insights weighs the gaps by it.</p>
    <ul class="uses">
      <li class="use-row"><span>Daily picks</span><span class="muted small">Always counted</span></li>
      ${uses.filter(u => u.id !== 'daily').map(u => `<li class="use-row"><span id="use-${esc(u.id)}">${esc(u.label)}</span>
        ${segHTML(levels.map(([v, label]) => ({ value: `${u.id}:${v}`, label, on: settings[u.id] === v })), { action: 'ins-use', label: `${u.label}: how often` })}</li>`).join('')}
    </ul>
    ${tagged ? `<p class="muted small">Your journal tunes these too: ${plural(tagged, 'wear')} logged for an occasion so far.</p>` : '<p class="muted small">Wears you log from the Occasion tab tune these too.</p>'}
    <div class="sheet-bar"><button class="btn primary" data-action="close-sheet">Done</button></div>`);
}

/** While the library loads: the headline, the map and a card, in outline. */
export function insightsSkeletonHTML() {
  const cells = Array.from({ length: 40 }, () => '<span class="sk sk-vial"></span>').join('');
  return `<div class="insights" aria-busy="true" aria-label="Loading insights">
    <div class="ins-top"><span class="sk sk-line w70 sk-head"></span><span class="sk sk-line w40"></span></div>
    <div class="card sk-cov"><span class="sk sk-line w40"></span><div class="sk-grid">${cells}</div></div>
    <div class="card sk-card"><span class="sk sk-line w40"></span><span class="sk sk-row"></span></div>
  </div>`;
}

/**
 * The whole pane from its model: { report, error, busy, fresh, uses,
 * bands, cell, slot, context, wants (ids), ownedLabel (id -> label | null),
 * styles: { rows, stated, open, groups, starters, moreStarters, doubles } }.
 */
export function insightsHTML(m) {
  const r = m.report;
  const situations = m.error && !r
    ? `<div class="card ins-error">${messageHTML({ glyph: icon.chart, title: 'Couldn’t work out your gaps', body: m.error, action: '<button class="btn primary" data-action="ins-retry">Try again</button>' })}</div>`
    : !r ? `<div class="card sk-cov" aria-busy="true" aria-label="Working out your gaps"><span class="sk sk-line w40"></span><div class="sk-grid">${'<span class="sk sk-vial"></span>'.repeat(40)}</div></div>`
      : `<section class="card ins-cov" aria-labelledby="cov-title">
        ${sectionHead('What you’re covered for', '', { id: 'cov-title' })}
        ${coverageHTML(r, { uses: m.uses, bands: m.bands, cell: m.cell, slot: m.slot, fresh: m.fresh })}
      </section>
      <section class="card ins-thin" aria-labelledby="thin-title">
        ${sectionHead('Where it’s thin', '', { id: 'thin-title' })}
        ${thinHTML(r)}
        ${strongHTML(r)}
      </section>
      <section class="ins-fill" aria-labelledby="fill-title">
        ${sectionHead('Bottles that would fill the gaps', '<p>Each one fills something the one before it doesn’t.</p>', { id: 'fill-title' })}
        ${picksHTML(r, { wants: m.wants, ownedLabel: m.ownedLabel })}
      </section>`;
  const h = r ? headline(r) : null;
  const s = m.styles;
  return `<div class="insights${m.busy ? ' busy' : ''}">
    <section class="ins-top" aria-labelledby="ins-headline">
      ${h ? `<h2 id="ins-headline" class="ins-headline">${esc(h.lead)}</h2><p class="ins-sub">${esc(h.tail)}</p>`
    : `<h2 id="ins-headline" class="ins-headline">${m.error ? 'Your wardrobe, situation by situation' : 'Working out what you’re covered for…'}</h2>`}
      ${contextHTML(m.context)}
    </section>
    ${situations}
    <section class="ins-part" aria-labelledby="styles-title">
      <h2 id="styles-title" class="ins-headline">Your styles</h2>
      <p class="ins-sub">The kinds of scent you own, and where to go next.</p>
    </section>
    <div class="ins-styles" id="ins-styles">${stylesHTML(s, m.wants)}</div>
  </div>`;
}

/** The styles half (re-rendered on its own as its answers land). */
export function stylesHTML(s, wants = new Set()) {
  const all = [...new Set(s.groups.flatMap(g => g.ids))];
  // When the pool couldn't answer, one line says so in place of each list.
  const failed = s.error && `<p class="error ins-failed">${esc(s.error)} <button class="link-btn" data-action="ins-retry">Try again</button></p>`;
  return `<section class="card ins-mix" aria-labelledby="mix-title">
      ${sectionHead('Your style mix', '', { id: 'mix-title' })}
      ${styleMixHTML(s.rows, { open: s.open, stated: s.stated, all: s.all })}
    </section>
    <section class="card ins-more-card" aria-labelledby="more-title">
      ${sectionHead(s.stated ? 'More of what you like' : 'More of what you reach for', '', { id: 'more-title' })}
      ${failed || moreHTML(s.groups, { wants })}
      ${all.length ? `<a class="btn secondary compact more-link" href="#/discover?styles=${esc(all.join(','))}">${icon.discover}<span>See more in Discover</span></a>` : ''}
    </section>
    <section class="card ins-start" aria-labelledby="start-title">
      ${sectionHead('Styles you don’t own yet', '<p>One well-rated, safe, good-value bottle to start each.</p>', { id: 'start-title' })}
      ${failed || startersHTML(s.starters, { wants, more: s.moreStarters })}
    </section>
    <section class="card ins-doubles" aria-labelledby="doubles-title">
      ${sectionHead('Doubles', '', { id: 'doubles-title' })}
      ${doublesHTML(s.doubles)}
    </section>`;
}

// ---------- The model, from state ----------

// Liked styles in groups to ask about: each liked scent style with Intimate
// beside it when that's liked too (skin scents that wear close lead), or
// Intimate alone. [[ids]].
function groupsOf(lib, ids) {
  const kind = id => lib.styles.styleById(id)?.kind;
  const scent = ids.filter(id => kind(id) === 'scent'), wear = ids.filter(id => kind(id) === 'wear');
  return scent.length ? scent.slice(0, 4).map(id => [id, ...wear]) : wear.length ? [wear] : [];
}

const groupTitle = (lib, ids) => {
  const s = lib.styles.styleById(ids[0]);
  const close = ids.some(id => lib.styles.styleById(id).kind === 'wear');
  return s.kind === 'wear' ? 'More that wear close' : `More ${nounOf(s)}${close ? ' that wear close' : ''}`;
};

// Scent styles none of the bottles leans toward.
const unownedOf = (lib, mix) => lib.styles.STYLES.filter(s => s.kind === 'scent' && !mix.counts[s.id]).map(s => s.id);

// The style mix and doubles read only the owned bottles: worked out once per wardrobe.
let owning = { key: null, mix: null, doubles: null };
function ownedWork(lib, owned) {
  const key = JSON.stringify(owned.map(f => f.id));
  if (owning.key !== key) owning = { key, mix: lib.styles.styleMix(owned), doubles: lib.doubles.doubles(owned) };
  return owning;
}

function stylesModel(lib, owned) {
  const { mix, doubles } = ownedWork(lib, owned);
  const liked = likedFor(lib, owned);
  const byId = new Map(owned.map(f => [f.id, f]));
  const rows = [
    ...lib.styles.STYLES.filter(s => s.kind === 'scent').map(s => ({ s, ids: mix.ids[s.id] })),
    { s: lib.styles.styleById('intimate'), ids: mix.intimateIds, close: true },
  ].filter(r => r.ids.length).map(({ s, ids, close = false }) => ({
    id: s.id, label: s.label, count: ids.length, liked: liked.ids.includes(s.id), close, bottles: ids.map(id => byId.get(id)).filter(Boolean),
  })).sort((a, b) => b.count - a.count || b.liked - a.liked);
  const st = ins.styles;
  const unowned = unownedOf(lib, mix);
  return {
    rows,
    stated: liked.stated,
    open: ins.open,
    all: ins.allStyles,
    groups: groupsOf(lib, liked.ids).map(ids => ({ ids, title: groupTitle(lib, ids), href: `#/discover?styles=${ids.join(',')}`, picks: st.more[ids[0]] })),
    starters: unowned.slice(0, MAX_STARTERS).map(id => ({ style: lib.styles.styleById(id), pick: st.starters[id] })),
    moreStarters: Math.max(0, unowned.length - MAX_STARTERS),
    error: st.error,
    doubles,
  };
}

const OWNED_WORD = { demo: 'In David’s', mine: 'In Mine', shared: 'In this list' };

function model(lib) {
  const owned = activeFragrances();
  const { gaps } = lib;
  return {
    report: ins.report,
    error: ins.error,
    busy: ins.busy,
    fresh: ins.fresh,
    uses: gaps.USES.map(u => ({ id: u.id, label: gaps.useLabel(u) })),
    bands: bandColumns(gaps.BANDS),
    cell: ins.cell,
    slot: ins.slot,
    context: { place: state.loc?.name ?? null, climate: state.loc ? ins.climate : 'default', tagged: taggedWears(lib), preferValue: state.preferValue ?? ins.report?.preferValue ?? null },
    wants: new Set(loadWants().map(w => w.id)),
    ownedLabel: id => OWNED_WORD[ownedIn(id)] ?? null,
    styles: stylesModel(lib, owned),
  };
}

function insightsPane() {
  if (ins.libError) {
    return messageHTML({ glyph: icon.chart, title: 'Insights didn’t load', body: ins.libError, action: '<button class="btn primary" data-action="ins-retry">Try again</button>' });
  }
  if (!activeFragrances().length) {
    return messageHTML({
      glyph: icon.chart, title: 'Nothing to look at yet',
      body: 'Add the bottles you own, and this shows the weather and occasions they cover, and what would fill the gaps.',
      action: `<a class="btn primary" href="#/wardrobe/owned">${icon.plus}<span>Add your bottles</span></a>`,
    });
  }
  const lib = libNow();
  if (!lib) return insightsSkeletonHTML();
  const html = insightsHTML(model(lib));
  ins.fresh = false;
  return html;
}

// ---------- Asking the pool ----------

const onPane = () => state.base?.dest === 'wardrobe' && state.base.pane === 'insights';

// Re-renders the pane if it's on screen, focus kept where it was.
function paint(app) {
  if (onPane()) repaint(app);
}

// Only the styles half, so the map above doesn't redraw as its answers land.
function paintStyles(app) {
  const box = onPane() && document.getElementById('ins-styles');
  const lib = libNow();
  if (!box || !lib) return;
  const el = document.activeElement;
  app.keepingFocus(box.contains(el) ? el : null, '#ins-styles', () => {
    box.innerHTML = stylesHTML(stylesModel(lib, activeFragrances()), new Set(loadWants().map(w => w.id)));
  });
}

let asked = 0;
async function refresh(app) {
  if (!libNow()) {
    try {
      await loadLib();
    } catch {
      ins.libError = 'Insights needs a connection the first time. Check it and try again.';
    }
    return paint(app);
  }
  if (!activeFragrances().length) return;
  const key = inputsKey();
  if (key === ins.key) return;
  const n = ++asked;
  Object.assign(ins, { key, busy: Boolean(ins.report), error: '' });
  if (ins.report) paint(app);
  refreshStyles(app);
  try {
    const inputs = await poolInputs();
    if (n !== asked) return;
    ins.climate = inputs.summary ? 'local' : 'failed';
    const report = await askPool('report', { ...inputs, k: 5 }, { channel: 'ins-report' });
    if (report.stale || n !== asked) return;
    Object.assign(ins, { fresh: !ins.report, report });
  } catch (err) {
    if (n !== asked) return;
    ins.error = err.message;
  }
  ins.busy = false;
  paint(app);
}

let stylesAsked = 0;
async function refreshStyles(app) {
  const lib = libNow(), owned = activeFragrances();
  const liked = likedFor(lib, owned);
  const key = JSON.stringify([inputsKey(), liked.ids]);
  if (key === ins.styles.key) return;
  const n = ++stylesAsked;
  ins.styles = { key, more: {}, starters: {}, error: '' };
  const groups = groupsOf(lib, liked.ids);
  const unowned = unownedOf(lib, ownedWork(lib, owned).mix).slice(0, MAX_STARTERS);
  let inputs;
  try {
    inputs = await poolInputs();
  } catch {
    return;
  }
  const ask = async (payload, channel) => {
    const r = await askPool('styles', { ...inputs, ...payload }, { channel });
    return r.stale ? undefined : r.picks;
  };
  const failed = err => { if (n === stylesAsked) ins.styles.error = err.message; return null; };
  const more = groups.map(ids => ask({ styles: ids, k: MORE_PICKS }, `ins-more-${ids[0]}`).catch(failed)
    .then(picks => { if (n === stylesAsked && picks !== undefined) ins.styles.more[ids[0]] = picks; }));
  const starters = unowned.map(id => ask({ styles: [id], k: 1, filters: STARTER }, `ins-start-${id}`).catch(failed)
    .then(picks => { if (n === stylesAsked && picks !== undefined) ins.styles.starters[id] = picks?.[0] ?? null; }));
  await Promise.all(more);
  if (n === stylesAsked) paintStyles(app);
  await Promise.all(starters);
  if (n === stylesAsked) paintStyles(app);
}

// The map is one tab stop: arrow keys move between its cells (Home and End
// to a row's ends), skipping the ones that don't come up; Enter opens one.
const STEPS = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
function mapKeys(e) {
  const from = e.target.closest?.('.cov-cell');
  if (!from || !(e.key in STEPS || e.key === 'Home' || e.key === 'End')) return;
  const shown = b => (b?.offsetParent ? b : null);
  const grid = [...e.currentTarget.tBodies[0].rows].filter(r => r.offsetParent)
    .map(r => [...r.cells].map(td => shown(td.querySelector('.cov-cell'))));
  const r0 = grid.findIndex(row => row.includes(from)), c0 = grid[r0].indexOf(from);
  let next = null;
  if (e.key === 'Home') next = grid[r0].find(Boolean);
  else if (e.key === 'End') next = grid[r0].findLast(Boolean);
  else {
    const [dr, dc] = STEPS[e.key];
    for (let r = r0 + dr, c = c0 + dc; grid[r]?.[c] !== undefined; r += dr, c += dc) if ((next = grid[r][c])) break;
  }
  e.preventDefault();
  if (!next) return;
  from.tabIndex = -1;
  next.tabIndex = 0;
  next.focus();
}

// ---------- The pane ----------

export const insightsPaneDef = {
  id: 'insights',
  label: 'Insights',
  title: () => 'Insights',
  heading: () => 'Insights',
  render: insightsPane,
  after(app) {
    warmPool();
    refresh(app);
    document.querySelector('.cov-table')?.addEventListener('keydown', mapKeys);
  },
};

// ---------- Actions ----------

export const actions = {
  // A cell of the map (or a thin spot's title): open its detail.
  'ins-cell'(el, app) {
    const id = el.dataset.value;
    const fromList = !el.closest('.cov-table');
    ins.cell = id;
    ins.slot = id.split(':')[1];
    app.keepingFocus(el, '#app', app.renderPage);
    // From a thin spot: up to the map with it picked, focus on its detail.
    if (fromList) {
      const head = document.querySelector('#ins-detail h3');
      document.querySelector('.ins-cov')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      head?.focus({ preventScroll: true });
    }
  },
  // Day or Night: the detail follows to that slot's worst cell.
  'ins-slot'(el, app) {
    const slot = el.dataset.value;
    ins.slot = slot;
    const r = ins.report;
    const cell = r?.coverage.find(c => c.cell === (ins.cell ?? defaultCell(r)));
    if (r && cell?.slot !== slot) ins.cell = worstOf(r, r.coverage.filter(c => c.slot === slot && c.status !== 'off').map(c => c.cell))?.cell ?? null;
    app.keepingFocus(el, '#app', app.renderPage);
  },
  'ins-uses'(el, app) {
    if (!libNow()) return;
    app.openSheet({ kind: 'ins-uses' });
  },
  'ins-use'(el, app) {
    const lib = libNow();
    const [use, level] = el.dataset.value.split(':');
    lib.uses.saveUses({ ...lib.uses.loadUses(), [use]: level });
    app.keepingFocus(el, '#sheet', () => app.renderSheet({ keepScroll: true }));
    app.renderPage();
  },
  // "Prefer great value", flipped from what the report used.
  'ins-value'(el, app) {
    setPreferValue(!(state.preferValue ?? ins.report?.preferValue ?? false));
    app.keepingFocus(el, '#app', app.renderPage);
  },
  'ins-retry'(el, app) {
    Object.assign(ins, { key: null, error: '', libError: '' });
    ins.styles.key = null;
    app.renderPage();
  },
  async 'ins-own'(el, app) {
    const id = el.dataset.id;
    let record;
    try {
      record = await ownable(id, findRecord(id));
    } catch (err) {
      return app.showToast(`<span>${esc(err.message)}</span>`);
    }
    if (!record) return;
    setWant(id, false);
    app.own(record);
    // Its card made way for the new list's report.
    document.getElementById('page-title')?.focus();
  },
  'ins-mix-all'(el, app) {
    ins.allStyles = !ins.allStyles;
    paintStyles(app);
    document.querySelector('#ins-styles [data-action="ins-mix-all"]')?.focus();
  },
  'ins-mix'(el, app) {
    ins.open = ins.open === el.dataset.value ? null : el.dataset.value;
    paintStyles(app);
    document.querySelector(`#ins-styles [data-action="ins-mix"][data-value="${CSS.escape(el.dataset.value)}"]`)?.focus();
  },
  // Heart a style: the liked set as shown (stated or not) with this one in or out.
  'ins-like'(el, app) {
    const lib = libNow();
    const id = el.dataset.value;
    const now = likedFor(lib).ids;
    setLikedStyles(now.includes(id) ? now.filter(x => x !== id) : [...now, id]);
    paintStyles(app);
    refreshStyles(app);
    document.querySelector(`#ins-styles [data-action="ins-like"][data-value="${CSS.escape(id)}"]`)?.focus();
  },
};

export const sheets = {
  'ins-uses': () => {
    const lib = libNow();
    if (!lib) return null;
    return usesSheetHTML({
      uses: lib.gaps.USES.map(u => ({ id: u.id, label: lib.gaps.useLabel(u) })),
      settings: lib.uses.loadUses(),
      tagged: taggedWears(lib),
    });
  },
};
