// The bottle page's buy check (order 170): for a bottle you don't own, how it
// would fit the wardrobe being ranked (src/gaps.js buyCheck, asked of the
// suggestion pool so it judges like Insights): a verdict, its reasons, what
// it would fill, the closest bottle you own and a cheaper twin to want
// instead.
import { esc, plural } from '../ui.js';
import { icon, rowHTML } from '../ui/components.js';
import { addSection, pooled, showing } from './bottle.js';
import { collectionLabel, findRecord } from '../app/state.js';
import { loadWants, hasWant } from '../wishlist.js';

// Verdicts as tones (any other verdict reads neutral).
const TONES = { 'Strong fit': 'strong', Good: 'good', Covered: 'neutral', Redundant: 'neutral', Risky: 'risky' };
const MAX_FILLS = 4;
// Below this likeness the nearest bottle you own isn't worth naming.
const NEAR_SIM = 0.35;

// A bottle the pool can judge: a dataset id, or a record with accords.
export const checkable = f => /^\d+$/.test(f.id) || Object.keys(f.accords ?? {}).length > 0;
const payload = m => (m.owned || m.inMine || !checkable(m.f) ? null : /^\d+$/.test(m.f.id) ? { id: m.f.id } : { record: m.f });
const checks = pooled('check', 'bp-check', payload);

const pct = x => `${Math.round(x * 100)}%`;
// collectionLabel() as the end of "For …".
const whose = label => (label === 'My collection' ? 'your collection' : label === 'Shared collection' ? 'this shared collection' : label);
const value = v => (v == null ? '' : `value ${v.toFixed(1)} of 5`);

/** A heart toggle for a bottle in a row: Want it, or stop wanting it. */
export const wantToggle = (f, on) =>
  `<button class="icon-btn want-icon${on ? ' on' : ''}" data-action="bp-want" data-id="${esc(f.id)}" aria-pressed="${on}" aria-label="Want ${esc(f.name)}">${on ? icon.heartFill : icon.heart}</button>`;

function overlapRow(o, ctx) {
  const record = o.record ?? findRecord(o.id) ?? o;
  // An owned dupe's original: say whose.
  const meta = o.link ? esc(o.link)
    : o.via ? `The original of your ${esc(o.via.name)} · ${pct(o.sim)} alike`
    : `Closest you own · ${pct(o.sim)} alike`;
  return rowHTML(record, { meta, open: { ctx }, cls: 'wrap' });
}

function twinRow(t, ctx, wants) {
  const record = t.record ?? findRecord(t.id) ?? t;
  const meta = t.owned ? 'You own its twin' : ['Smells like it, for less', value(t.value)].filter(Boolean).join(' · ');
  return rowHTML(record, { meta: esc(meta), open: { ctx }, trailing: t.owned ? '' : wantToggle(record, hasWant(wants, t.id)) });
}

/**
 * The section from the bottle's model and its check: undefined before it's
 * asked, else pooled()'s { status, result, error }. `who`: the list it's
 * judged against ("David’s wardrobe"); `wants`: the want list.
 */
export function buyCheckHTML(m, answer, { who = 'your collection', wants = [] } = {}) {
  if (!payload(m)) return '';
  const head = `<h3 id="bc-title" tabindex="-1">For ${esc(whose(who))}</h3>`;
  const r = answer?.result;
  if (answer?.status === 'error') {
    return `<section class="bp-section" aria-labelledby="bc-title">${head}
      <div class="bc-card"><p class="bc-error">${esc(answer.error)}</p>
      <button class="btn secondary compact" data-action="bp-check-retry" data-id="${esc(m.f.id)}">${icon.refresh}<span>Try again</span></button></div></section>`;
  }
  if (!r) {
    return `<section class="bp-section" aria-labelledby="bc-title" aria-busy="true">${head}
      <div class="bc-card bc-loading"><span class="visually-hidden">Checking it against your bottles</span>
        <span class="sk bc-sk-pill"></span><span class="sk bc-sk-line"></span><span class="sk bc-sk-line short"></span></div></section>`;
  }
  const tone = TONES[r.verdict] ?? 'neutral';
  const reasons = r.reasons.filter(t => t !== r.twin?.text);
  const fills = r.fills.slice(0, MAX_FILLS);
  const more = r.fills.length - fills.length;
  const overlap = r.overlap && (r.overlap.link || r.overlap.sim >= NEAR_SIM) ? overlapRow(r.overlap, m.ctx) : '';
  const twin = r.twin ? twinRow(r.twin, m.ctx, wants) : '';
  return `<section class="bp-section" aria-labelledby="bc-title">${head}
    <div class="bc-card${answer.status === 'loading' ? ' refreshing' : ''}" data-tone="${tone}">
      <p class="verdict" data-tone="${tone}">${esc(r.verdict)}</p>
      <ul class="bc-reasons">${reasons.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      ${fills.length ? `<div class="bc-fills"><p class="bp-sub">It would fill</p><ul class="fill-chips">${fills.map(f => `<li class="fill-chip${f.first ? ' first' : ''}">${esc(f.title)}</li>`).join('')}${more > 0 ? `<li class="fill-more">${plural(more, 'more')}</li>` : ''}</ul></div>` : ''}
      ${overlap || twin ? `<ul class="rows bc-rows">${overlap}${twin}</ul>` : ''}
    </div>
  </section>`;
}

addSection({
  id: 'check',
  order: 170,
  render: m => buyCheckHTML(m, checks.get(m.f.id), { who: collectionLabel(), wants: loadWants() }),
  after: (m, app) => checks.ask(m, app),
  actions: {
    'bp-check-retry'(el, app) {
      checks.forget(el.dataset.id);
      if (!showing(el.dataset.id)) return;
      app.renderBottle();
      document.querySelector('#bc-title')?.focus({ preventScroll: true });
    },
  },
});
