// The bottle page's buy check (order 170): for a bottle you don't own, how it
// would fit the wardrobe being ranked (src/gaps.js buyCheck, asked of the
// suggestion pool so it judges like Insights and the Wishlist: the same
// inputs, and the styles you like): a verdict, its reasons, what it would
// fill, the closest bottle you own and a cheaper twin to want instead. Each
// thing is said once: a reason the chips or rows below show drops out.
import { styleById } from '../scent-styles.js';
import { esc } from '../ui.js';
import { icon, rowHTML } from '../ui/components.js';
import { addSection, pooled, likedTaste, likedStatedNow } from './bottle.js';
import { state, collectionLabel, findRecord, viewingDemo } from '../app/state.js';
import { loadWants, hasWant } from '../wishlist.js';

// Verdicts as tones (any other verdict reads neutral).
const TONES = { 'Strong fit': 'strong', Good: 'good', Covered: 'neutral', Redundant: 'neutral', Risky: 'risky' };
const MAX_FILLS = 4;
// The closest bottle you own is named from this likeness (compare's "Close"),
// or when voters link them; under it, nothing you own is near enough to say.
const NEAR_SIM = 0.6;
const BAND_ORDER = ['cold', 'cool', 'mild', 'warm', 'hot'];

// A bottle the pool can judge: a dataset id, or a record with accords.
export const checkable = f => /^\d+$/.test(f.id) || Object.keys(f.accords ?? {}).length > 0;
// The record whenever it has accords: a bottle newer than the dataset (a
// catalog line) is in neither the pool nor r/, and the pool still prefers
// its own row for a dataset id.
const payload = m => (m.owned || m.inMine || !checkable(m.f) ? null
  : Object.keys(m.f.accords ?? {}).length ? { record: m.f } : { id: m.f.id });
// The ranked list still on its way (David's wardrobe at boot, a shared
// link): whether it owns the bottle isn't known yet, so it doesn't ask (and
// load the pool) for one it may own.
const listLoading = () => (viewingDemo() && !state.demo) || Boolean(state.shared?.loading);
const checks = pooled('check', 'bp-check', payload, {
  section: 'check',
  // The liked styles, so a skin scent for someone who loves them reads as
  // one; `stated` false when they're only what the bottles lean toward.
  prepare: async (m, inputs) => {
    const { ids, stated } = await likedTaste(inputs.owned);
    return { liked: ids, stated };
  },
});

const pct = x => `${Math.round(x * 100)}%`;
// collectionLabel() as the end of "Would it suit …?".
const whose = label => (label === 'My collection' ? 'your collection' : label === 'Shared collection' ? 'this shared collection' : label);
// Value for money in words, as the crowd block says it.
const valueWord = v => (v == null ? '' : v >= 4 ? 'great value' : v >= 3.4 ? 'good value' : v >= 2.4 ? 'fair price' : 'pricey');

/** A heart toggle for a bottle in a row: Want it, or stop wanting it. */
export const wantToggle = (f, on) =>
  `<button class="icon-btn bp-want-icon${on ? ' on' : ''}" data-action="bp-want" data-id="${esc(f.id)}" aria-pressed="${on}" aria-label="Want ${esc(f.name)}">${on ? icon.heartFill : icon.heart}</button>`;

// "cold", "cold and cool", "cold to mild", "cold, mild and hot".
function bandsText(bands) {
  const at = [...new Set(bands)].sort((a, b) => BAND_ORDER.indexOf(a) - BAND_ORDER.indexOf(b));
  const run = at.every((b, i) => i === 0 || BAND_ORDER.indexOf(b) === BAND_ORDER.indexOf(at[i - 1]) + 1);
  if (at.length > 2 && run) return `${at[0]} to ${at.at(-1)}`;
  return at.length > 1 ? `${at.slice(0, -1).join(', ')} and ${at.at(-1)}` : at[0];
}

/**
 * Fills grouped by use and time of day, in the order given: "Formal on cold
 * nights" and "Formal on cool nights" make one "Formal · cold and cool
 * nights". -> [{ title, first }]
 */
export function fillGroups(fills) {
  const groups = new Map();
  for (const f of fills) {
    const m = /^(.+) on (\w+) (days|nights)$/.exec(f.title);
    const key = m ? `${m[1]}|${m[3]}` : f.title;
    if (!groups.has(key)) groups.set(key, { use: m ? m[1] : f.title, when: m ? m[3] : '', bands: [], first: false });
    const g = groups.get(key);
    if (m) g.bands.push(m[2]);
    g.first ||= Boolean(f.first);
  }
  return [...groups.values()].map(g => ({ title: g.when ? `${g.use} · ${bandsText(g.bands)} ${g.when}` : g.use, first: g.first }));
}

// The styles you like that it adds to: "Skin scent and Wears close". Only
// guessed from your bottles (`stated` false), they're styles you reach for.
function likedLine(r, stated) {
  const labels = (r.likedShown ?? []).map(id => (id === 'intimate' ? 'Wears close' : styleById(id)?.label)).filter(Boolean);
  if (!labels.length || r.reasons.some(t => /\byou (like|reach for)\b/.test(t))) return '';
  const list = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}` : labels[0];
  const what = `${labels.length > 1 ? 'Styles' : 'A style'} you ${stated ? 'like' : 'reach for'}`;
  return `<p class="bc-liked${stated ? '' : ' leaning'}">${stated ? icon.check : icon.wardrobe}<span>${what}: ${esc(list)}</span></p>`;
}

function overlapRow(o, ctx) {
  const record = o.record ?? findRecord(o.id) ?? o;
  // The reasons say how voters link them; the row only names it. An owned dupe's original: say whose.
  const meta = o.link ? `Voters link them · ${pct(o.sim)} alike`
    : o.via ? `The original of your ${esc(o.via.name)} · ${pct(o.sim)} alike`
    : `Closest you own · ${pct(o.sim)} alike`;
  return rowHTML(record, { meta, open: { ctx }, cls: 'wrap' });
}

function twinRow(t, ctx, wants) {
  const record = t.record ?? findRecord(t.id) ?? t;
  const meta = t.owned ? 'You own its twin' : ['Smells like it, for less', valueWord(t.value)].filter(Boolean).join(' · ');
  return rowHTML(record, { meta: esc(meta), open: { ctx }, trailing: t.owned ? '' : wantToggle(record, hasWant(wants, t.id)) });
}

// A fill sentence the chips repeat ("It would be your best for …"); one with
// a "though" says more than they do, so it stays.
const fillReason = t => /^(Still, )?it would be (your best|a second strong pick) for /i.test(t) && !/\bthough\b/.test(t);

/**
 * The section from the bottle's model and its check: undefined before it's
 * asked, else pooled()'s { status, result, error }. `who`: the list it's
 * judged against ("David’s wardrobe"); `wants`: the want list; `stated`:
 * the liked styles were said, not guessed from the bottles.
 */
export function buyCheckHTML(m, answer, { who = 'your collection', wants = [], stated = true } = {}) {
  if (!payload(m)) return '';
  const head = `<h3 id="bc-title" tabindex="-1">Would it suit ${esc(whose(who))}?</h3>`;
  const r = answer?.result;
  if (answer?.status === 'error') {
    return `<section class="bp-section" aria-labelledby="bc-title">${head}
      <div class="bc-card"><p class="bc-error">${esc(answer.error)}</p>
      <button class="btn secondary compact" data-action="bp-check-retry" data-id="${esc(m.f.id)}">${icon.refresh}<span>Try again</span></button></div></section>`;
  }
  if (!r) {
    // About the size of a typical answer, so the page doesn't jump when it lands.
    return `<section class="bp-section" aria-labelledby="bc-title" aria-busy="true">${head}
      <div class="bc-card bc-loading"><span class="visually-hidden">Checking it against your bottles</span>
        <span class="sk bc-sk-pill"></span><span class="sk bc-sk-line"></span><span class="sk bc-sk-line"></span><span class="sk bc-sk-line short"></span>
        <span class="bc-sk-row"><span class="sk bc-sk-thumb"></span><span class="sk-lines"><span class="sk sk-line w70"></span><span class="sk sk-line w40"></span></span></span></div></section>`;
  }
  const tone = TONES[r.verdict] ?? 'neutral';
  const groups = fillGroups(r.fills ?? []);
  const fills = groups.slice(0, MAX_FILLS);
  const more = groups.length - fills.length;
  const near = r.overlap && (r.overlap.link || r.overlap.sim >= NEAR_SIM);
  const reasons = r.reasons.filter(t => t !== r.twin?.text && !(fills.length && fillReason(t)) && !(near && !r.overlap.link && /^Closest to /.test(t)));
  const overlap = near ? overlapRow(r.overlap, m.ctx) : '';
  const twin = r.twin ? twinRow(r.twin, m.ctx, wants) : '';
  const chip = g => `<li class="fill-chip${g.first ? ' first' : ''}">${esc(g.title)}</li>`;
  const firsts = fills.filter(g => g.first), seconds = fills.filter(g => !g.first);
  const chipGroup = (title, list, extra = '') => (list.length || extra ? `<div class="bc-fills"><p class="bp-sub">${title}</p><ul class="fill-chips">${list.map(chip).join('')}${extra}</ul></div>` : '');
  const moreChip = more > 0 ? `<li class="fill-more">+${more} more</li>` : '';
  const chips = chipGroup('It would be your best for', firsts, seconds.length ? '' : moreChip)
    + chipGroup(firsts.length ? 'And a strong second for' : 'It would be a strong second for', seconds, seconds.length ? moreChip : '');
  // A good fit's fills are why: they lead. A risky one's reasons do.
  const lead = tone === 'strong' || tone === 'good';
  return `<section class="bp-section" aria-labelledby="bc-title">${head}
    <div class="bc-card${answer.status === 'loading' ? ' bp-refreshing' : ''}" data-tone="${tone}">
      <p class="bc-verdict" data-tone="${tone}">${esc(r.verdict)}</p>
      ${lead ? chips : ''}
      ${reasons.length ? `<ul class="bc-reasons">${reasons.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${likedLine(r, stated)}
      ${lead ? '' : chips}
      ${overlap || twin ? `<ul class="rows bc-rows">${overlap}${twin}</ul>` : ''}
    </div>
  </section>`;
}

addSection({
  id: 'check',
  order: 170,
  render: m => buyCheckHTML(m, checks.get(m.f.id), { who: collectionLabel(), wants: loadWants(), stated: likedStatedNow() }),
  after: (m, app) => { if (!listLoading()) checks.ask(m, app); },
  actions: {
    'bp-check-retry'(el, app) {
      checks.forget(el.dataset.id);
      if (state.route?.dest !== 'bottle') return;
      app.renderBottle();
      document.querySelector('#bc-title')?.focus({ preventScroll: true });
    },
  },
});
