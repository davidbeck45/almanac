// The bottle page's styles (order 350): the scent styles it reads as (Skin
// scent, Clean, Barbershop…, src/scent-styles.js) and whether it wears close,
// each with what the style is and a way into Discover for more of it. A style
// you like (likedStyleIds: hearted on Insights, or what your bottles lean
// toward) wears a heart.
import { topStyles, wearsClose, styleById, STYLE_STRONG } from '../scent-styles.js';
import { esc } from '../ui.js';
import { icon } from '../ui/components.js';
import { routeHash } from '../app/router.js';
import { addSection, likedStyleIds, likedNow, redrawSection } from './bottle.js';
import { state } from '../app/state.js';

const styleRow = ({ id, label, strong, blurb, liked }) => `<li><a class="style-row${liked ? ' liked' : ''}" href="${esc(routeHash({ dest: 'discover', query: { styles: id } }))}" data-focus="style-${esc(id)}">
    <span class="style-name"><b>${esc(label)}</b>${strong ? '<span class="style-tag">Strong</span>' : ''}${liked ? `<span class="style-liked">${icon.heartFill}You like it</span>` : ''}</span>
    <span class="style-blurb">${esc(blurb)}</span>
    <span class="style-more">More like this ${icon.chevron}</span>
  </a></li>`;

/** The section for a bottle's model: '' when no style is clear enough to name. `liked`: the style ids you like. */
export function stylesHTML(m, liked = likedNow() ?? []) {
  if (!Object.keys(m.f.accords ?? {}).length) return '';
  const rows = topStyles(m.f).map(s => ({ ...s, strong: s.score >= STYLE_STRONG, blurb: styleById(s.id).blurb }));
  if (wearsClose(m.f)) rows.push({ id: 'intimate', label: 'Wears close', strong: false, blurb: styleById('intimate').blurb.replace(/^Wears close: /, '').replace(/^./, c => c.toUpperCase()) });
  if (!rows.length) return '';
  return `<section class="bp-section" aria-labelledby="styles-title">
    <h3 id="styles-title">Its style</h3>
    <ul class="style-list">${rows.map(r => styleRow({ ...r, liked: liked.includes(r.id) })).join('')}</ul>
  </section>`;
}

// The liked styles drawn last, so the hearts come in once they're known.
let drawn = null;
addSection({
  id: 'styles',
  order: 350,
  render: m => {
    drawn = JSON.stringify(likedNow());
    return stylesHTML(m);
  },
  after: (m, app) => {
    likedStyleIds().then(ids => {
      if (JSON.stringify(ids) !== drawn && state.route?.dest === 'bottle') redrawSection('styles', app);
    }, () => {});
  },
});
