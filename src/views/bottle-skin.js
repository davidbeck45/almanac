// The bottle page's "On your skin" (order 260), for a bottle you own: your own
// stars and how it wears on you against the crowd's votes (src/skin.js).
// Stars move it in picks and the nudges tune its spray guide; saving ranks
// everything again and says what changed: where the bottle moved in the list
// it was opened from ("Now 3rd for tonight, was 1st"), or what it did to the
// spray guide's count ("Now 1 spray, was 1–2", or that it's unchanged).
import { setSkin } from '../skin.js';
import { esc, moveText, listLabel } from '../ui.js';
import { segHTML, starsHTML } from '../ui/components.js';
import { addSection, bottleModel } from './bottle.js';
import { guideFor, sprayCount } from './bottle-spray.js';
import { state, nowSlot, findRecord } from '../app/state.js';

// Where a save moved the bottle, in src/ui.js since Now's "Rate it" says it too.
export { ordinal, moveText, listLabel } from '../ui.js';

const LASTS = [[-1, 'Shorter'], [0, 'As expected'], [1, 'Longer']];
const PROJECTS = [[-1, 'Less'], [0, 'As expected'], [1, 'More']];

/** The section for a bottle's model; `change`: the last save's moveText for it, or ''. */
export function skinHTML(m, change = '') {
  if (!m.owned && !m.inMine) return '';
  const id = esc(m.f.id);
  const rating = m.skin?.rating ?? null;
  const seg = (items, now, action, label) => segHTML(items.map(([value, text]) => ({ value, label: text, on: value === now })), { action, label, cls: 'wide' });
  return `<section class="bp-section" aria-labelledby="skin-title">
    <h3 id="skin-title" tabindex="-1">On your skin</h3>
    <div class="skin-box">
      <div class="skin-row">
        <span class="skin-label" id="skin-stars-label">Your rating</span>
        ${starsHTML(rating, { action: 'bp-skin-rate', labelledby: 'skin-stars-label' })}
        ${rating ? `<button class="link-btn skin-clear" data-action="bp-skin-clear" data-id="${id}">Clear</button>` : ''}
      </div>
      <div class="skin-row stacked"><span class="skin-label">How long it lasts on you</span>${seg(LASTS, m.skin?.longevity ?? 0, 'bp-skin-lasts', 'How long it lasts on you')}</div>
      <div class="skin-row stacked"><span class="skin-label">How far it projects on you</span>${seg(PROJECTS, m.skin?.sillage ?? 0, 'bp-skin-projects', 'How far it projects on you')}</div>
      <p class="skin-change">${esc(change)}</p>
      <p class="skin-help">Your stars move it up or down in picks. How it wears on you tunes the spray guide.</p>
    </div>
  </section>`;
}

// The last save's line, by bottle; it goes when the page shows another bottle.
// Screen readers hear it from app.announce (src/app/sheets.js): the line is
// drawn anew with the page, and a live region that arrives holding its text
// isn't heard.
const changes = new Map();
let shown = null;
function changeFor(id) {
  if (id !== shown) {
    changes.clear();
    shown = id;
  }
  return changes.get(id) ?? '';
}

/**
 * What a nudge did to the spray guide's count: "Now 1 spray, was 1–2." or
 * "Spray guide unchanged: 1–2 sprays." ('' without a guide).
 */
export function sprayText(before, after) {
  if (!after) return '';
  if (before === after) return `Spray guide unchanged: ${after}.`;
  return `Now ${after}, was ${before.replace(/ sprays?$/, '')}.`;
}

// The page's spray count as it stands ("1–2 sprays"), or null without a guide.
function sprayNow() {
  const model = state.route?.dest === 'bottle' ? bottleModel(state.route) : null;
  return model && Object.keys(model.f.accords ?? {}).length ? sprayCount(guideFor(model)) : null;
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
  const was = 'rating' in patch ? null : sprayNow();
  const next = setSkin(id, patch);
  // State keeps the ratings the lists rank with, once the Wear screens wire them in.
  if ('skin' in state) state.skin = next;
  changes.clear();
  app.render();
  // Stars move it in the list; how it wears on you may change the spray guide.
  const ctx = state.contexts[key];
  const said = 'rating' in patch ? moveText(before, placeIn(key, id), listLabel(ctx?.win, ctx?.occasion)) : sprayText(was, sprayNow());
  changes.set(id, said);
  app.keepingFocus(el, '#bottle', app.renderBottle);
  if (!el.isConnected && !document.activeElement?.closest?.('#bottle')) document.querySelector('#skin-title')?.focus({ preventScroll: true });
  app.announce(said);
}

addSection({
  id: 'skin',
  order: 260,
  render: m => skinHTML(m, changeFor(m.f.id)),
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
