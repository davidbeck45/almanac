// The bottle page's "On my skin" (order 260), for a bottle you own: your own
// stars and how it wears on you against the crowd's votes (src/skin.js).
// Stars move it in picks and the nudges tune its spray guide; saving ranks
// everything again and says where the bottle moved in the list it was
// opened from ("Now 3rd for tonight, was 1st").
import { setSkin } from '../skin.js';
import { esc } from '../ui.js';
import { icon, segHTML } from '../ui/components.js';
import { addSection, showing } from './bottle.js';
import { state, nowSlot } from '../app/state.js';

const STARS = [1, 2, 3, 4, 5];
const LASTS = [[-1, 'Shorter'], [0, 'As expected'], [1, 'Longer']];
const PROJECTS = [[-1, 'Less'], [0, 'As expected'], [1, 'More']];

export const ordinal = n => {
  const tens = n % 100, ones = n % 10;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
};

/**
 * Where a bottle moved in a list: "Now 3rd for tonight, was 1st." (places
 * 1-based, null when it isn't in the list). `label` names the list.
 */
export function moveText(before, after, label) {
  if (!after) return '';
  if (!before || before === after) return `Still ${ordinal(after)} ${label}.`;
  return `Now ${ordinal(after)} ${label}, was ${ordinal(before)}.`;
}

// "for tonight", "for date night tonight", "for Friday night".
export function listLabel(win, occasion) {
  if (!win) return '';
  const when = /^(Today|Tonight|Tomorrow)\b/.test(win.label) ? win.label.toLowerCase() : `on ${win.label}`;
  return occasion ? `for ${occasion.label.toLowerCase()} ${when}` : `for ${when.replace(/^on /, '')}`;
}

/** The section for a bottle's model; `change`: the last save's moveText for it, or ''. */
export function skinHTML(m, change = '') {
  if (!m.owned && !m.inMine) return '';
  const id = esc(m.f.id);
  const rating = m.skin?.rating ?? null;
  const stars = STARS.map(n => `<button type="button" class="star${rating && n <= rating ? ' lit' : ''}" role="radio" aria-checked="${n === rating}" tabindex="${n === (rating ?? 1) ? 0 : -1}" data-action="bp-skin-rate" data-value="${n}" aria-label="${n} star${n === 1 ? '' : 's'}">${icon.star}</button>`).join('');
  const seg = (items, now, action, label) => segHTML(items.map(([value, text]) => ({ value, label: text, on: value === now })), { action, label, cls: 'wide' });
  return `<section class="bp-section" aria-labelledby="skin-title">
    <h3 id="skin-title" tabindex="-1">On my skin</h3>
    <div class="skin">
      <div class="skin-row">
        <span class="skin-label" id="skin-stars-label">Your rating</span>
        <div class="stars" role="radiogroup" aria-labelledby="skin-stars-label">${stars}</div>
        ${rating ? `<button class="link-btn skin-clear" data-action="bp-skin-clear" data-id="${id}">Clear</button>` : ''}
      </div>
      <div class="skin-row stacked"><span class="skin-label">How long it lasts on me</span>${seg(LASTS, m.skin?.longevity ?? 0, 'bp-skin-lasts', 'How long it lasts on you')}</div>
      <div class="skin-row stacked"><span class="skin-label">How far it projects on me</span>${seg(PROJECTS, m.skin?.sillage ?? 0, 'bp-skin-projects', 'How far it projects on you')}</div>
      <p class="skin-change" role="status">${esc(change)}</p>
      <p class="skin-help">Your stars move it up or down in picks. How it wears on you tunes the spray guide.</p>
    </div>
  </section>`;
}

// The last save's line, by bottle; it goes when the page shows another bottle.
const changes = new Map();

// The bottle's place (1-based) in the list the page was opened from, as ranked now.
function placeIn(key, id) {
  const i = state.contexts[key]?.ranked.findIndex(r => r.fragrance.id === id) ?? -1;
  return i >= 0 ? i + 1 : null;
}

function save(el, app, patch) {
  const id = state.route?.arg;
  if (!id || !showing(id)) return;
  const key = state.contexts[state.route.query.ctx] ? state.route.query.ctx : nowSlot()?.win.slot;
  const before = placeIn(key, id);
  const next = setSkin(id, patch);
  // State keeps the ratings the lists rank with, once the Wear screens wire them in.
  if ('skin' in state) state.skin = next;
  changes.clear();
  app.render();
  const ctx = state.contexts[key];
  changes.set(id, moveText(before, placeIn(key, id), listLabel(ctx?.win, ctx?.occasion)));
  app.keepingFocus(el, '#bottle', app.renderBottle);
  if (!el.isConnected && !document.activeElement?.closest?.('#bottle')) document.querySelector('#skin-title')?.focus({ preventScroll: true });
}

addSection({
  id: 'skin',
  order: 260,
  render: m => skinHTML(m, changes.get(m.f.id) ?? ''),
  actions: {
    // The same star again takes the rating off.
    'bp-skin-rate'(el, app) {
      const stars = Number(el.dataset.value);
      save(el, app, { rating: el.getAttribute('aria-checked') === 'true' ? null : stars });
    },
    'bp-skin-clear'(el, app) {
      save(el, app, { rating: null });
    },
    'bp-skin-lasts'(el, app) {
      save(el, app, { longevity: el.dataset.value });
    },
    'bp-skin-projects'(el, app) {
      save(el, app, { sillage: el.dataset.value });
    },
  },
});
