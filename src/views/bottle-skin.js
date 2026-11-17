// The bottle page's "On your skin" (order 260), for a bottle you own: your own
// stars and how it wears on you against the crowd's votes (src/skin.js).
// Stars move it in picks and the nudges tune its spray guide; saving ranks
// everything again and says what changed: the stars and where the bottle
// moved in the list it was opened from ("Rated 4★. Now 3rd for tonight, was
// 1st.", as Now's "Rate it" says it), or what a nudge did to the spray
// guide's count ("Now 1 spray, was 1–2", or that it's unchanged). Under them,
// a note in your own words (where it came from, how it smells to you), which
// only this page reads: written in a field that takes the note's place, kept
// as typed through the page's redraws.
import { setSkin, loadSkin, noteText, MAX_BOTTLE_NOTE } from '../skin.js';
import { esc, moveText, ratedText, listLabel } from '../ui.js';
import { icon, segHTML, starsHTML } from '../ui/components.js';
import { addSection, bottleModel } from './bottle.js';
import { guideFor, sprayCount } from './bottle-spray.js';
import { state, nowSlot, findRecord } from '../app/state.js';

// Where a save moved the bottle, in src/ui.js since Now's "Rate it" says it too.
export { ordinal, moveText, ratedText, listLabel } from '../ui.js';

const LASTS = [[-1, 'Shorter'], [0, 'As expected'], [1, 'Longer']];
const PROJECTS = [[-1, 'Less'], [0, 'As expected'], [1, 'More']];

/**
 * The field a bottle's note is written in, where the note was: a few lines,
 * as long as a stored note can be, with Save and Cancel. Escape cancels
 * (watchNote), and what's typed is kept for the page's next draw.
 */
export function skinNoteFormHTML(id, name, draft = '') {
  return `<form class="skin-note-form" novalidate>
      <label class="name-field">
        <span>Your note<span class="visually-hidden"> on ${esc(name)}</span></span>
        <textarea id="skin-note-field" name="note" rows="3" data-id="${esc(id)}" maxlength="${MAX_BOTTLE_NOTE}" autocomplete="off" enterkeyhint="done" aria-describedby="skin-note-hint">${esc(draft)}</textarea>
      </label>
      <p class="skin-help" id="skin-note-hint">How it smells to you, where you got it, the size, who likes it on you. Up to ${MAX_BOTTLE_NOTE} characters.</p>
      <div class="action-row">
        <button type="submit" class="btn primary compact" data-action="bp-skin-note-save" data-id="${esc(id)}">${icon.check}<span>Save<span class="visually-hidden"> the note on ${esc(name)}</span></span></button>
        <button type="button" class="btn tertiary compact" data-action="bp-skin-note-cancel" data-id="${esc(id)}">Cancel</button>
      </div>
    </form>`;
}

// The note as the section shows it, your own words marked with a pen, and the button that opens its field.
function skinNoteHTML(id, name, note) {
  return `<div class="skin-row stacked">
      <span class="skin-label" id="skin-note-label">Your note</span>
      ${note ? `<p class="skin-note" aria-labelledby="skin-note-label">${icon.pen}<span>${esc(note)}</span></p>` : ''}
      <button class="btn tertiary compact skin-note-btn" data-action="bp-skin-note" data-id="${esc(id)}">${icon.pen}<span>${note ? 'Edit note' : 'Add a note'}<span class="visually-hidden"> ${note ? 'on' : 'to'} ${esc(name)}</span></span></button>
    </div>`;
}

/**
 * The section for a bottle's model; `change`: what the last save for it did
 * (ratedText, sprayText, a note's), or ''; `noting` ({ draft }) draws the
 * note's field in place of the note.
 */
export function skinHTML(m, change = '', noting = null) {
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
      <p class="skin-help">Your stars move it up or down in picks. How it wears on you tunes the spray guide.</p>
      ${noting ? skinNoteFormHTML(m.f.id, m.f.name, noting.draft) : skinNoteHTML(m.f.id, m.f.name, m.skin?.note ?? '')}
      <p class="skin-change">${esc(change)}</p>
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

// ---------- The note ----------

// The bottle whose note is being written, as typed so far, with the caret:
// { id, draft, caret }. It goes when the page shows another bottle.
let noting = null;
const notingFor = id => {
  if (noting && noting.id !== id) noting = null;
  return noting;
};

/** A note being written and not saved yet: the shell holds an out-of-sight version reload for it. */
export const noteUnsaved = () => Boolean(noting && state.route?.dest === 'bottle' && noteText(noting.draft) !== (loadSkin()[noting.id]?.note ?? ''));

// The note's field, each time the page is drawn: what's typed is kept for the
// next draw with its caret (the page draws whole as its answers land), Escape
// cancels (the field's alone: it doesn't also close the page), and the form
// goes nowhere of its own.
function watchNote(app) {
  const field = document.getElementById('skin-note-field');
  if (!field || !noting) return;
  const keep = () => { if (noting) Object.assign(noting, { draft: field.value, caret: [field.selectionStart, field.selectionEnd] }); };
  field.oninput = field.onkeyup = field.onpointerup = field.onselect = keep;
  if (document.activeElement === field && noting.caret) {
    try { field.setSelectionRange(...noting.caret); } catch {}
  }
  field.form.onsubmit = e => e.preventDefault();
  field.form.onkeydown = e => {
    if (e.key !== 'Escape' || e.isComposing) return;
    e.stopPropagation();
    closeNote(app, field.dataset.id);
  };
}

// The field goes and the note comes back, with focus on its button; `said`
// is what a save did, for the section's line and the live region.
function closeNote(app, id, said = '') {
  noting = null;
  if (said) {
    changes.clear();
    changes.set(id, said);
  }
  app.renderBottle();
  document.querySelector('#bottle .skin-note-btn')?.focus({ preventScroll: true });
  if (said) app.announce(said);
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
  // Stars move it in the list, said as Now's "Rate it" says it; how it wears
  // on you may change the spray guide.
  const ctx = state.contexts[key];
  const said = 'rating' in patch ? ratedText(patch.rating, moveText(before, placeIn(key, id), listLabel(ctx?.win, ctx?.occasion))) : sprayText(was, sprayNow());
  changes.set(id, said);
  app.keepingFocus(el, '#bottle', app.renderBottle);
  if (!el.isConnected && !document.activeElement?.closest?.('#bottle')) document.querySelector('#skin-title')?.focus({ preventScroll: true });
  app.announce(said);
}

addSection({
  id: 'skin',
  order: 260,
  render: m => skinHTML(m, changeFor(m.f.id), notingFor(m.f.id)),
  after: (m, app) => watchNote(app),
  unsaved: () => noteUnsaved(),
  actions: {
    // Add a note, Edit note: the note gives way to its field, the caret after what's there.
    'bp-skin-note'(el, app) {
      const id = el.dataset.id;
      const draft = loadSkin()[id]?.note ?? '';
      noting = { id, draft, caret: [draft.length, draft.length] };
      app.renderBottle();
      const field = document.getElementById('skin-note-field');
      if (!field) return;
      field.focus();
      field.setSelectionRange(draft.length, draft.length);
    },
    // Save: an emptied note is taken off, and the line says what happened.
    'bp-skin-note-save'(el, app, event) {
      event?.preventDefault();
      const id = el.dataset.id;
      const before = loadSkin()[id]?.note ?? '';
      const after = setSkin(id, { note: el.form?.elements.note?.value ?? noting?.draft ?? '' })[id]?.note ?? '';
      closeNote(app, id, after === before ? '' : !after ? 'Note removed.' : before ? 'Note changed.' : 'Note saved.');
    },
    'bp-skin-note-cancel'(el, app) {
      closeNote(app, el.dataset.id);
    },
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
