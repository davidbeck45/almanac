// The bottle page's pros and cons (order 550): Fragrantica's AI summary of
// its members' reviews, as the dataset has it (the top three pros and two
// cons, each with how many members agreed), credited as theirs.
import { esc } from '../ui.js';
import { addSection, aboutOf } from './bottle.js';

const num = n => Number(n).toLocaleString('en-US');

const item = ({ text, up }, tone) => `<li class="${tone}"><span>${esc(text)}</span>${up ? `<small>${num(up)} agree</small>` : ''}</li>`;

/** The section for a bottle's model: a skeleton while its about data loads, '' when there's no summary. */
export function reviewsHTML(m) {
  const about = aboutOf(m);
  const head = '<h3 id="reviews-title">Pros and cons <span class="h3-aside quiet">Fragrantica members’ summary</span></h3>';
  if (about === undefined && /^\d+$/.test(m.f.id)) {
    return `<section class="bp-section" aria-labelledby="reviews-title" aria-busy="true">${head}<span class="visually-hidden">Loading</span>
      <span class="sk sk-line w70"></span><span class="sk sk-line"></span><span class="sk sk-line w40"></span></section>`;
  }
  const pros = about?.pros ?? [], cons = about?.cons ?? [];
  if (!pros.length && !cons.length) return '';
  return `<section class="bp-section" aria-labelledby="reviews-title">${head}
    <ul class="pros-cons">${pros.map(p => item(p, 'pro')).join('')}${cons.map(c => item(c, 'con')).join('')}</ul>
    <p class="bp-credit">Fragrantica’s summary of its members’ reviews, from Le Decanteur’s dataset.</p>
  </section>`;
}

addSection({ id: 'reviews', order: 550, render: reviewsHTML });
