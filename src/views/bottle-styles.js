// The bottle page's styles (order 350): the scent styles it reads as (Skin
// scent, Clean, Barbershop…, src/scent-styles.js) and whether it wears close,
// each with what the style is and a way into Discover for more of it. A style
// you like (likedTaste: liked on Insights, David's on his wardrobe) says so;
// one only guessed from what your bottles lean toward is "You reach for it".
// No heart: the heart means Want.
import { topStyles, wearsClose, styleById, STYLE_STRONG } from '../scent-styles.js';
import { esc } from '../ui.js';
import { icon } from '../ui/components.js';
import { routeHash } from '../app/router.js';
import { addSection, likedTaste, likedNow, likedStatedNow, redrawSection } from './bottle.js';
import { state } from '../app/state.js';

// "You like it" for a style you said you like; "You reach for it" for one your bottles lean toward.
const likedMark = (liked, stated) => (!liked ? ''
  : stated ? `<span class="style-liked">${icon.check}You like it</span>`
  : `<span class="style-liked leaning">${icon.wardrobe}You reach for it</span>`);

const styleRow = ({ id, label, strong, blurb, liked, stated }) => `<li><a class="style-row${liked && stated ? ' liked' : ''}" href="${esc(routeHash({ dest: 'discover', query: { styles: id } }))}" data-focus="style-${esc(id)}">
    <span class="style-name"><b>${esc(label)}</b>${strong ? '<span class="style-tag">Strong</span>' : ''}${likedMark(liked, stated)}</span>
    <span class="style-blurb">${esc(blurb)}</span>
    <span class="style-more">More like this ${icon.chevron}</span>
  </a></li>`;

/**
 * The section for a bottle's model: '' when no style is clear enough to
 * name. `liked`: the style ids you like; `stated`: you said so (else they're
 * your bottles' leanings).
 */
export function stylesHTML(m, liked = likedNow() ?? [], { stated = likedStatedNow() } = {}) {
  if (!Object.keys(m.f.accords ?? {}).length) return '';
  const rows = topStyles(m.f).map(s => ({ ...s, strong: s.score >= STYLE_STRONG, blurb: styleById(s.id).blurb }));
  if (wearsClose(m.f)) rows.push({ id: 'intimate', label: styleById('intimate').label, strong: false, blurb: styleById('intimate').blurb });
  if (!rows.length) return '';
  return `<section class="bp-section" aria-labelledby="styles-title">
    <h3 id="styles-title">Its style</h3>
    <ul class="style-list">${rows.map(r => styleRow({ ...r, liked: liked.includes(r.id), stated })).join('')}</ul>
  </section>`;
}

// The liked styles drawn last, so the marks come in once they're known.
let drawn = null;
addSection({
  id: 'styles',
  order: 350,
  render: m => {
    drawn = JSON.stringify([likedNow(), likedStatedNow()]);
    return stylesHTML(m);
  },
  after: (m, app) => {
    likedTaste().then(({ ids, stated }) => {
      if (JSON.stringify([ids, stated]) !== drawn && state.route?.dest === 'bottle') redrawSection('styles', app);
    }, () => {});
  },
});
