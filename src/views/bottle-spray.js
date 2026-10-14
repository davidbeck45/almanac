// The bottle page's spray guide (order 250; after what it smells like for a
// bottle you don't own): how many sprays and where, for the window and
// occasion the page is about (src/spray.js sprayGuide, with your own "on my
// skin" nudges), on a small figure. Now's spray line opens the page here
// (#bp-spray).
import { sprayGuide } from '../spray.js';
import { esc, cap } from '../ui.js';
import { addSection, inSentence } from './bottle.js';

// Where each spot sits on the figure (viewBox 0 0 80 100); `back` ones are
// drawn hollow (the back of the neck, fabric).
const SPOTS = {
  neck: [[40, 27]],
  chest: [[40, 44]],
  stomach: [[40, 64]],
  wrists: [[12, 77], [68, 77]],
  'back of the neck': [[40, 23]],
  'collar or scarf': [[32, 33]],
  clothes: [[51, 56]],
};
const HOLLOW = new Set(['back of the neck', 'collar or scarf', 'clothes']);

// A bust with arms, in one soft silhouette, the spots lit on it.
const BODY = 'M35 23v6c-4 2-13 3-18 6-3.5 2-4.5 6-5 11l-3 34h6l3-30 4 2v48h36V52l4-2 3 30h6l-3-34c-.5-5-1.5-9-5-11-5-3-14-4-18-6v-6Z';

export function figureSVG(where) {
  const dots = where.flatMap(spot => (SPOTS[spot] ?? []).map(([x, y]) => (HOLLOW.has(spot)
    ? `<circle class="spot hollow" cx="${x}" cy="${y}" r="3.2"/>`
    : `<circle class="spot-glow" cx="${x}" cy="${y}" r="7"/><circle class="spot" cx="${x}" cy="${y}" r="3.2"/>`))).join('');
  return `<svg class="spray-figure" viewBox="0 0 80 100" aria-hidden="true">
    <ellipse class="fig" cx="40" cy="12.5" rx="8" ry="9.5"/>
    <path class="fig" d="${BODY}"/>
    ${dots}
  </svg>`;
}

/** A guide's spray count in words: "2 sprays", "2–3 sprays". */
export function sprayCount(guide) {
  const [lo, hi] = guide.sprays;
  return lo === hi ? `${lo} spray${lo === 1 ? '' : 's'}` : `${lo}–${hi} sprays`;
}

/** The guide for a bottle's model, with its skin nudges. */
export const guideFor = m => sprayGuide(m.f, m.win, m.occasion, m.skin && { longevity: m.skin.longevity, sillage: m.skin.sillage });

/** The section for a bottle's model: '' when it has no accords to judge by. */
export function sprayHTML(m) {
  if (!Object.keys(m.f.accords ?? {}).length) return '';
  const g = guideFor(m);
  // The guide's text opens with the count ("2–3 sprays, on the neck…"); the rest is where and why.
  const rest = cap(g.text.replace(/^[^,]*,\s*/, ''));
  // "Date Night · tonight", "Date Night · Saturday night".
  const when = m.win ? (m.occasion ? `${m.occasion.label} · ${inSentence(m.win.label)}` : m.win.label) : '';
  return `<section class="bp-section" id="bp-spray" aria-labelledby="spray-title">
    <h3 id="spray-title" tabindex="-1">How much to spray${when ? ` <span class="h3-aside">${esc(when)}</span>` : ''}</h3>
    <div class="spray-guide">
      ${figureSVG(g.where)}
      <div class="spray-text">
        <p class="spray-count">${esc(sprayCount(g))}</p>
        <p class="spray-where">${esc(rest)}</p>
        ${g.note ? `<p class="spray-note">${esc(g.note)}</p>` : ''}
      </div>
    </div>
  </section>`;
}

addSection({ id: 'spray', order: 250, shopOrder: 800, render: sprayHTML });
