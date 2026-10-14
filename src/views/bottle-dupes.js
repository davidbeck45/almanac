// The bottle page's "Smells like" (order 450): the bottle's smells-like
// family from the suggestion pool (src/discover.js dupesOf): the original a
// dupe copies, bottles that smell like it for far less, and the ones voters
// link it with. Each opens its own page, or a side-by-side with this one.
import { esc } from '../ui.js';
import { icon, rowHTML } from '../ui/components.js';
import { routeHash } from '../app/router.js';
import { addSection, pooled, aboutOf, linkId } from './bottle.js';
import { state, findRecord } from '../app/state.js';

const MAX = 4;
const num = n => Number(n).toLocaleString('en-US');
// Value for money in words, as the crowd block says it (the number is on compare).
const valueWord = v => (v >= 4 ? 'great value' : v >= 3.4 ? 'good value' : v >= 2.4 ? 'fair price' : 'pricey');
// The pool's answer for a bottle it has nothing on: nothing to show, not an error.
const NOT_IN_LIBRARY = /isn’t in the fragrance library/;

// The record whenever it has accords (a bottle newer than the dataset is in
// neither the pool nor r/); a dataset id alone otherwise.
const payload = m => (Object.keys(m.f.accords ?? {}).length ? { record: m.f } : /^\d+$/.test(m.f.id) ? { id: m.f.id } : null);
const families = pooled('dupes', 'bp-dupes', payload, { section: 'dupes' });

// Its smells-like votes: the pool's, else this bottle's own page's top five.
function votesFor(e, m) {
  if (e.up != null) return e.up;
  const v = aboutOf(m)?.smellsLike?.find(s => String(s.id) === e.id);
  return v ? v.up : null;
}

function entryMeta(e, m) {
  const bits = [];
  if (e.owned) bits.push('You own it');
  const up = votesFor(e, m);
  if (up > 0) bits.push(`${num(up)} vote${up === 1 ? '' : 's'}`);
  else if (e.why === 'notes') bits.push('Alike by its notes');
  else if (e.why === 'votes') bits.push('Voters link them');
  if (e.value != null) bits.push(valueWord(e.value));
  if (bits.length < 2 && e.rating) bits.push(`★ ${e.rating.toFixed(1)}`);
  if (e.risk?.level === 'high') bits.push('risky blind buy');
  return esc(bits.join(' · ').replace(/^./, c => c.toUpperCase()));
}

function entryRow(e, m) {
  const record = e.record ?? findRecord(e.id) ?? e;
  const compare = `<a class="btn tertiary compact row-compare" href="${esc(routeHash({ dest: 'compare', arg: `${linkId(m.f)},${e.id}` }))}" data-focus="cmp-${esc(e.id)}" aria-label="Compare with ${esc(e.name)}" title="Compare side by side">${icon.compare}<span>Compare</span></a>`;
  // The build's summary of an original has no accords: its page loads it by id.
  const opens = record.accords || /^\d+$/.test(e.id);
  return rowHTML(record, { meta: entryMeta(e, m), open: opens ? { ctx: m.ctx } : null, trailing: opens ? compare : '', cls: 'wrap' });
}

const group = (title, rows) => (rows ? `<div class="dupe-group"><p class="bp-sub">${title}</p><ul class="rows">${rows}</ul></div>` : '');

/**
 * The section from the bottle's model and its family: undefined before it's
 * asked, else pooled()'s { status, result, error }. '' when nobody smells
 * like it, or the library has nothing on it.
 */
export function dupesHTML(m, answer) {
  if (!payload(m)) return '';
  const head = '<h3 id="dupes-title" tabindex="-1">Smells like</h3>';
  if (answer?.status === 'error') {
    if (NOT_IN_LIBRARY.test(answer.error)) return '';
    return `<section class="bp-section" id="bp-dupes" aria-labelledby="dupes-title">${head}
      <p class="bp-error">${esc(answer.error)} <button class="link-btn" data-action="bp-dupes-retry" data-id="${esc(m.f.id)}">Try again</button></p></section>`;
  }
  const r = answer?.result;
  if (!r) {
    const row = '<li class="row"><span class="row-main"><span class="sk bp-sk-thumb"></span><span class="sk-lines"><span class="sk sk-line w70"></span><span class="sk sk-line w40"></span></span></span></li>';
    return `<section class="bp-section" id="bp-dupes" aria-labelledby="dupes-title" aria-busy="true">${head}<span class="visually-hidden">Finding bottles that smell like it</span><ul class="rows">${row.repeat(3)}</ul></section>`;
  }
  const rows = list => list.slice(0, MAX).map(e => entryRow(e, m)).join('');
  const body = [
    group(r.original?.built ? 'Inspired by' : 'Voters call it a copy of', r.original ? entryRow(r.original, m) : ''),
    group('Smells like it, for less', rows(r.cheaper)),
    group('Voters say it smells like', rows(r.siblings)),
  ].join('');
  if (!body) return '';
  return `<section class="bp-section${answer.status === 'loading' ? ' bp-refreshing' : ''}" id="bp-dupes" aria-labelledby="dupes-title">${head}${body}
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
      if (state.route?.dest !== 'bottle') return;
      app.renderBottle();
      document.querySelector('#dupes-title')?.focus({ preventScroll: true });
    },
  },
});

/** A bottle's family as last asked (for the compare picker), or null. */
export const familyOf = id => families.get(id)?.result ?? null;
