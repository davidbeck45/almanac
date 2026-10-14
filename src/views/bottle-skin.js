// The bottle page's "On my skin" (order 260), for a bottle you own: your own
// stars and how it wears on you against the crowd's votes (src/skin.js).
// Stars move it in picks and the nudges tune its spray guide; saving ranks
// everything again and says what changed: where the bottle moved in the list
// it was opened from ("Now 3rd for tonight, was 1st"), or the spray guide's
// new count.
import { setSkin } from '../skin.js';
import { esc } from '../ui.js';
import { icon, segHTML } from '../ui/components.js';
import { addSection, bottleModel } from './bottle.js';
import { guideFor, sprayCount } from './bottle-spray.js';
import { state, nowSlot, findRecord } from '../app/state.js';

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
  const stars = STARS.map(n => `<button type="button" class="skin-star${rating && n <= rating ? ' lit' : ''}" role="radio" aria-checked="${n === rating}" tabindex="${n === (rating ?? 1) ? 0 : -1}" data-action="bp-skin-rate" data-value="${n}" aria-label="${n} star${n === 1 ? '' : 's'}">${icon.star}</button>`).join('');
  const seg = (items, now, action, label) => segHTML(items.map(([value, text]) => ({ value, label: text, on: value === now })), { action, label, cls: 'wide' });
  return `<section class="bp-section" aria-labelledby="skin-title">
    <h3 id="skin-title" tabindex="-1">On my skin</h3>
    <div class="skin-box">
      <div class="skin-row">
        <span class="skin-label" id="skin-stars-label">Your rating</span>
        <div class="skin-stars" role="radiogroup" aria-labelledby="skin-stars-label">${stars}</div>
        ${rating ? `<button class="link-btn skin-clear" data-action="bp-skin-clear" data-id="${id}">Clear</button>` : ''}
      </div>
      <div class="skin-row stacked"><span class="skin-label">How long it lasts on me</span>${seg(LASTS, m.skin?.longevity ?? 0, 'bp-skin-lasts', 'How long it lasts on you')}</div>
      <div class="skin-row stacked"><span class="skin-label">How far it projects on me</span>${seg(PROJECTS, m.skin?.sillage ?? 0, 'bp-skin-projects', 'How far it projects on you')}</div>
      <p class="skin-change">${esc(change)}</p>
      <p class="skin-help">Your stars move it up or down in picks. How it wears on you tunes the spray guide.</p>
    </div>
  </section>`;
}

// The last save's line, by bottle; it goes when the page shows another bottle.
const changes = new Map();

// What a save changed, said to screen readers: the line under the stars is
// drawn anew with the page, and a live region that arrives holding its text
// isn't heard, so it's also written into one that outlasts the page's
// renders (#bp-status, at the end of the body: made when the section first
// draws, cleared, then filled on the next frame).
function statusNode() {
  let el = document.getElementById('bp-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bp-status';
    el.className = 'visually-hidden';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  return el;
}
function announce(text) {
  const el = statusNode();
  el.textContent = '';
  if (text) requestAnimationFrame(() => { el.textContent = text; });
}
let shown = null;
function changeFor(id) {
  if (id !== shown) {
    changes.clear();
    shown = id;
  }
  return changes.get(id) ?? '';
}

// The bottle's place (1-based) in the list the page was opened from, as ranked now.
function placeIn(key, id) {
  const i = state.contexts[key]?.ranked.findIndex(r => r.fragrance.id === id) ?? -1;
  return i >= 0 ? i + 1 : null;
}

function save(el, app, patch) {
  const arg = state.route?.dest === 'bottle' ? state.route.arg : null;
  if (!arg) return;
  const id = findRecord(arg)?.id ?? arg;
  const key = state.contexts[state.route.query.ctx] ? state.route.query.ctx : nowSlot()?.win.slot;
  const before = placeIn(key, id);
  const next = setSkin(id, patch);
  // State keeps the ratings the lists rank with, once the Wear screens wire them in.
  if ('skin' in state) state.skin = next;
  changes.clear();
  app.render();
  // Stars move it in the list; how it wears on you changes the spray guide.
  const ctx = state.contexts[key], model = bottleModel(state.route);
  const said = 'rating' in patch ? moveText(before, placeIn(key, id), listLabel(ctx?.win, ctx?.occasion))
    : model && Object.keys(model.f.accords ?? {}).length ? `Spray guide updated: ${sprayCount(guideFor(model))}.` : '';
  changes.set(id, said);
  app.keepingFocus(el, '#bottle', app.renderBottle);
  if (!el.isConnected && !document.activeElement?.closest?.('#bottle')) document.querySelector('#skin-title')?.focus({ preventScroll: true });
  announce(said);
}

addSection({
  id: 'skin',
  order: 260,
  render: m => skinHTML(m, changeFor(m.f.id)),
  after: m => { if (m.owned || m.inMine) statusNode(); },
  actions: {
    // The same star tapped again takes the rating off. Keys (Space, Enter,
    // arrows, Home, End) only ever choose, as on a native radio: Clear clears.
    'bp-skin-rate'(el, app, event) {
      const stars = Number(el.dataset.value);
      const again = el.getAttribute('aria-checked') === 'true';
      if (again && !(event?.detail > 0)) return;
      save(el, app, { rating: again ? null : stars });
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
