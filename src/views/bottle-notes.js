// The bottle page's Notes (order 700; 370 when shopping): the pyramid by
// layer, each note a button that opens what it is and what it smells like
// under the pyramid (src/notes.js, the glossary, loaded when a note is first
// opened: it's all text), where it sits in this bottle and how much voters
// smell it, the other bottles of yours that have it, and a way into
// Discover's notes search. One note open at a time; tapping it again closes it.
import { esc } from '../ui.js';
import { icon } from '../ui/components.js';
import { routeHash } from '../app/router.js';
import { addSection, redrawSection } from './bottle.js';
import { state, rankedFragrances } from '../app/state.js';

const LAYERS = [['top', 'Top'], ['mid', 'Heart'], ['base', 'Base'], ['all', 'Notes']];
// What a layer means for a note in it.
const TIER_LINE = {
  top: 'A top note here: what you smell in the first minutes.',
  mid: 'A heart note here: the scent’s character once it settles.',
  base: 'A base note here: what stays on skin for hours.',
};
// The owned bottles named before "and N more".
const ALSO_NAMED = 3;
// Voters' share of the top note's votes: from here "one of the notes voters
// smell most", and at or under FAINT (with a few notes voted on) "few pick it out".
const STRONG = 0.6, FAINT = 0.25, VOTED_MIN = 4;

// "a", "a and b", "a, b and c".
const sentenceList = parts => (parts.length < 3 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** Where a note sits in a bottle and how voters rate it there: { tier, share } (share null without votes). */
export function noteStanding(f, note) {
  const tier = LAYERS.map(([k]) => k).find(k => f.notes?.[k]?.some(n => same(n, note))) ?? null;
  const votes = Object.entries(f.noteVotes ?? {}).filter(([, v]) => v > 0);
  const own = votes.find(([n]) => same(n, note))?.[1];
  const top = Math.max(0, ...votes.map(([, v]) => v));
  return { tier, share: own && top ? own / top : null, voted: votes.length };
}

const standingLines = ({ tier, share, voted }) => [
  TIER_LINE[tier],
  share == null ? null : share >= 1 ? 'Voters smell it most of all in this bottle.'
    : share >= STRONG ? 'One of the notes voters smell most here.'
    : share <= FAINT && voted >= VOTED_MIN ? 'Few voters pick it out here.' : null,
].filter(Boolean);

/** The other bottles of a list that have a note, by the glossary's reading of it (`sameNote`). */
export function alsoIn(f, note, owned, sameNote) {
  return owned.filter(o => o.id !== f.id && Object.values(o.notes ?? {}).some(list => list?.some(n => sameNote(n, note))));
}

const alsoHTML = also => {
  if (!also.length) return '';
  const link = o => `<button type="button" class="link-btn" data-action="open" data-id="${esc(o.id)}">${esc(o.name)}</button>`;
  const named = also.slice(0, ALSO_NAMED).map(link), more = also.length - named.length;
  // sentenceList escapes nothing: its parts are the links' own markup.
  return `<p class="note-also">Also in your ${sentenceList(more > 0 ? [...named, `${more} more`] : named)}.</p>`;
};

/**
 * What an open note says: `lib` is src/notes.js once loaded (undefined while
 * it loads, null when it couldn't), `owned` the list ranked.
 */
export function noteAboutHTML(f, note, { lib, owned = [] } = {}) {
  const close = `<button type="button" class="icon-btn note-close" data-action="note-about" data-id="${esc(f.id)}" data-note="${esc(note)}" aria-label="Close ${esc(note)}">${icon.close}</button>`;
  const frame = (title, kind, body) => `<div class="note-about" id="bp-note-about" role="group" aria-labelledby="bp-note-name"${lib === undefined ? ' aria-busy="true"' : ''}>
    <div class="note-about-head"><h4 id="bp-note-name">${esc(title)}</h4>${kind ? `<span class="note-kind">${esc(kind)}</span>` : ''}${close}</div>
    ${body}
  </div>`;
  if (lib === undefined) return frame(note, '', '<p class="note-line">Looking it up…</p>');
  if (lib === null) return frame(note, '', '<p class="note-line">The note guide didn’t load. Reload the page to try again.</p>');
  const info = lib.noteInfo(note);
  const here = standingLines(noteStanding(f, note));
  const hereHTML = here.length ? `<div><dt>In this bottle</dt><dd>${esc(here.join(' '))}</dd></div>` : '';
  const find = `<a class="link-btn note-find" href="${esc(routeHash({ dest: 'discover', query: { q: String(note).toLowerCase() } }))}">Find bottles with ${esc(String(note).toLowerCase())}</a>`;
  const foot = `${alsoHTML(alsoIn(f, note, owned, lib.sameNote))}${find}`;
  if (!info) return frame(note, '', `<p class="note-line">There’s no description of this one yet.</p>${hereHTML ? `<dl class="note-facts">${hereHTML}</dl>` : ''}${foot}`);
  if (info.general) {
    return frame(note, '', `<dl class="note-facts">
      <div><dt>How it smells</dt><dd>${esc(`It’s ${info.label}. ${info.smell}`)}</dd></div>${hereHTML}
    </dl>${foot}`);
  }
  // "Listed here as Calabrian bergamot" when the bottle names a kind of it.
  const listed = same(info.name, note) ? '' : `<p class="note-line">Listed here as ${esc(note)}.</p>`;
  return frame(info.name, info.kind, `${listed}<dl class="note-facts">
      <div><dt>What it is</dt><dd>${esc(info.what)}</dd></div>
      <div><dt>How it smells</dt><dd>${esc(info.smell)}</dd></div>${hereHTML}
    </dl>${foot}`);
}

/**
 * The section: the pyramid by layer; a bottle listed flat (only `all`) shows
 * its notes under the heading alone, not a "Notes" label under "Notes".
 * `open` is the note whose description shows under it.
 */
export function notesHTML({ f }, { open = null, lib, owned = [] } = {}) {
  const layers = LAYERS.filter(([k]) => f.notes?.[k]?.length);
  if (!layers.length) return '';
  const isOpen = open != null && layers.some(([k]) => f.notes[k].some(n => same(n, open)));
  const chip = n => {
    const on = isOpen && same(n, open);
    return `<button type="button" class="note-chip${on ? ' on' : ''}" data-action="note-about" data-id="${esc(f.id)}" data-note="${esc(n)}" data-focus="note-${esc(n)}" aria-expanded="${on}"${on ? ' aria-controls="bp-note-about"' : ''}>${esc(n)}</button>`;
  };
  const chips = list => `<div class="notes">${list.map(chip).join('')}</div>`;
  const body = layers.length === 1 && layers[0][0] === 'all' ? chips(f.notes.all)
    : `<div class="pyramid">${layers.map(([k, label]) => `<div class="layer"><span class="layer-label">${label}</span>${chips(f.notes[k])}</div>`).join('')}</div>`;
  const about = isOpen ? noteAboutHTML(f, open, { lib, owned }) : '<p class="note-hint">Tap a note to see what it is and how it smells.</p>';
  return `<section class="bp-section" aria-labelledby="bp-notes-title"><h3 id="bp-notes-title">Notes</h3>${body}${about}</section>`;
}

// The note open on a bottle's page ({ id, note }), and the glossary: undefined
// until asked for, then the module, or null when it didn't arrive.
let open = null, lib, loading = null;
const loadLib = () => (loading ??= import('../notes.js').then(m => { lib = m; }, () => { lib = null; }));

addSection({
  id: 'notes',
  order: 700,
  shopOrder: 370,
  render: m => notesHTML(m, { open: open?.id === String(m.f.id) ? open.note : null, lib, owned: rankedFragrances() }),
  actions: {
    // A note's chip, or the panel's Close: opens it, or closes the one open.
    'note-about'(el, app) {
      const { id, note } = el.dataset;
      const closing = open && open.id === id && same(open.note, note);
      open = closing ? null : { id, note };
      const draw = () => {
        if (state.route?.dest !== 'bottle') return;
        redrawSection('notes', app);
        const slot = document.querySelector('#bottle [data-section="notes"]');
        // Close took the focused button with it: back to the note's chip.
        if (closing) [...(slot?.querySelectorAll('.note-chip') ?? [])].find(c => same(c.dataset.note, note))?.focus({ preventScroll: true });
        else slot?.querySelector('#bp-note-about')?.scrollIntoView({ block: 'nearest' });
      };
      draw();
      if (closing) return;
      const say = () => {
        if (!open || open.note !== note || !lib) return;
        const info = lib.noteInfo(note);
        if (info) app.announce(info.general ? `${note}: ${info.label}. ${info.smell}` : `${info.name}: ${info.smell}`);
      };
      if (lib === undefined) loadLib().then(() => { if (open?.id === id && open.note === note) { draw(); say(); } });
      else say();
    },
  },
});
