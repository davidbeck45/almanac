// The bottle page's styles (order 350): the scent styles it reads as (Skin
// scent, Clean, Barbershop…, src/scent-styles.js) and whether it wears close,
// each with what the style is and a way into Discover for more of it.
import { topStyles, wearsClose, styleById, STYLE_STRONG } from '../scent-styles.js';
import { esc } from '../ui.js';
import { icon } from '../ui/components.js';
import { routeHash } from '../app/router.js';
import { addSection } from './bottle.js';

const styleRow = ({ id, label, strong, blurb }) => `<li><a class="style-row" href="${esc(routeHash({ dest: 'discover', query: { styles: id } }))}">
    <span class="style-name"><b>${esc(label)}</b>${strong ? '<span class="style-tag">Strong</span>' : ''}</span>
    <span class="style-blurb">${esc(blurb)}</span>
    <span class="style-more">More like this ${icon.chevron}</span>
  </a></li>`;

/** The section for a bottle's model: '' when no style is clear enough to name. */
export function stylesHTML(m) {
  if (!Object.keys(m.f.accords ?? {}).length) return '';
  const rows = topStyles(m.f).map(s => ({ ...s, strong: s.score >= STYLE_STRONG, blurb: styleById(s.id).blurb }));
  if (wearsClose(m.f)) rows.push({ id: 'intimate', label: 'Wears close', strong: false, blurb: styleById('intimate').blurb.replace(/^Wears close: /, '').replace(/^./, c => c.toUpperCase()) });
  if (!rows.length) return '';
  return `<section class="bp-section" aria-labelledby="styles-title">
    <h3 id="styles-title">Its style</h3>
    <ul class="style-list">${rows.map(styleRow).join('')}</ul>
  </section>`;
}

addSection({ id: 'styles', order: 350, render: stylesHTML });
