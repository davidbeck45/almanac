// The bottle page's "Smells like" (order 450): the bottle's smells-like
// family from the suggestion pool (src/discover.js dupesOf): the original a
// dupe copies, bottles that smell like it for far less, and the ones voters
// link it with. Each opens its own page, or a side-by-side with this one.
import { esc } from '../ui.js';
import { icon, rowHTML } from '../ui/components.js';
import { routeHash } from '../app/router.js';
import { addSection, pooled, showing } from './bottle.js';
import { findRecord } from '../app/state.js';

const MAX = 4;
const num = n => Number(n).toLocaleString('en-US');

// A dataset bottle, or one with accords to compare by.
const payload = m => (/^\d+$/.test(m.f.id) ? { id: m.f.id } : Object.keys(m.f.accords ?? {}).length ? { record: m.f } : null);
const families = pooled('dupes', 'bp-dupes', payload);

function entryMeta(e) {
  const bits = [];
  if (e.owned) bits.push('You own it');
  if (e.up != null && e.up > 0) bits.push(`${num(e.up)} vote${e.up === 1 ? '' : 's'}`);
  else if (e.why === 'notes') bits.push('Alike by its notes');
  if (e.value != null) bits.push(`value ${e.value.toFixed(1)} of 5`);
  if (!bits.length && e.rating) bits.push(`★ ${e.rating.toFixed(1)}`);
  if (e.risk?.level === 'high') bits.push('risky blind buy');
  return esc(bits.join(' · ').replace(/^./, c => c.toUpperCase()));
}

function entryRow(e, m) {
  const record = e.record ?? findRecord(e.id) ?? e;
  const compare = `<a class="icon-btn row-compare" href="${esc(routeHash({ dest: 'compare', arg: `${m.f.id},${e.id}` }))}" aria-label="Compare with ${esc(e.name)}">${icon.compare}</a>`;
  // The build's summary of an original has no accords: its page loads it by id.
  const opens = record.accords || /^\d+$/.test(e.id);
  return rowHTML(record, { meta: entryMeta(e), open: opens ? { ctx: m.ctx } : null, trailing: opens ? compare : '', cls: 'wrap' });
}

const group = (title, rows) => (rows ? `<div class="dupe-group"><p class="bp-sub">${title}</p><ul class="rows">${rows}</ul></div>` : '');

/**
 * The section from the bottle's model and its family: undefined before it's
 * asked, else pooled()'s { status, result, error }. '' when nobody smells
 * like it.
 */
export function dupesHTML(m, answer) {
  if (!payload(m)) return '';
  const head = '<h3 id="dupes-title" tabindex="-1">Smells like</h3>';
  if (answer?.status === 'error') {
    return `<section class="bp-section" aria-labelledby="dupes-title">${head}
      <p class="bp-error">${esc(answer.error)} <button class="link-btn" data-action="bp-dupes-retry" data-id="${esc(m.f.id)}">Try again</button></p></section>`;
  }
  const r = answer?.result;
  if (!r) {
    const row = '<li class="row"><span class="row-main"><span class="sk bp-sk-thumb"></span><span class="row-text"><span class="sk sk-line w70"></span><span class="sk sk-line"></span></span></span></li>';
    return `<section class="bp-section" aria-labelledby="dupes-title" aria-busy="true">${head}<span class="visually-hidden">Finding bottles that smell like it</span><ul class="rows">${row.repeat(3)}</ul></section>`;
  }
  const rows = list => list.slice(0, MAX).map(e => entryRow(e, m)).join('');
  const body = [
    group(r.original?.built ? 'Inspired by' : 'Voters call it a copy of', r.original ? entryRow(r.original, m) : ''),
    group('Smells like it, for less', rows(r.cheaper)),
    group('Voters say it smells like', rows(r.siblings)),
  ].join('');
  if (!body) return '';
  return `<section class="bp-section${answer.status === 'loading' ? ' refreshing' : ''}" aria-labelledby="dupes-title">${head}${body}
    <p class="bp-credit">From Fragrantica members’ “smells like” votes.</p>
  </section>`;
}

addSection({
  id: 'dupes',
  order: 450,
  render: m => dupesHTML(m, families.get(m.f.id)),
  after: (m, app) => families.ask(m, app),
  actions: {
    'bp-dupes-retry'(el, app) {
      families.forget(el.dataset.id);
      if (!showing(el.dataset.id)) return;
      app.renderBottle();
      document.querySelector('#dupes-title')?.focus({ preventScroll: true });
    },
  },
});

/** A bottle's family as last asked (for the compare picker), or null. */
export const familyOf = id => families.get(id)?.result ?? null;
