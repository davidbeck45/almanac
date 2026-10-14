// The bottle page's value and crowd block (order 470): what Fragrantica's
// voters say beyond the rating, from the dataset (Le Decanteur's, CC BY-NC-SA):
// value for money, how many owners keep it, how safe a blind buy it is, how
// talked about it is now, how its ratings spread, who wears it, and who made
// it. Read from the record's signals (`extras`: pool rows, the wardrobe's)
// and its about data (loadAbout, or the build's `about`).
import { riskOf } from '../candidates.js';
import { esc } from '../ui.js';
import { addSection, aboutOf } from './bottle.js';

// Value for money, 1 (overpriced) to 5 (great value), in words: about the
// pool's top eighth is great, under 2.4 pricey (.sweep/notes/data.md 5a).
const VALUE_WORDS = [[4, 'Great value'], [3.4, 'Good value'], [2.4, 'Fair price'], [-Infinity, 'Pricey']];
// Owners kept from KEEP_VOTES have-or-had votes; a keep lift past KEEP_HIGH
// or under KEEP_LOW (the pool's bottom tenth) is worth saying.
const KEEP_VOTES = 30;
const KEEP_HIGH = 0.1;
const KEEP_LOW = -0.085;
const RISK_WORDS = { low: 'Safe bet', medium: 'Some risk', high: 'Risky' };
// The crowd's lean, -1 feminine .. +1 masculine, in words past LEAN_WORD.
const LEAN_WORD = 0.4;
const LEAN_STRONG = 0.7;
const SENTIMENT = [['love', 'Love'], ['like', 'Like'], ['ok', 'OK'], ['dislike', 'Dislike'], ['hate', 'Hate']];

const pct = x => `${Math.round(x * 100)}%`;
const num = n => Number(n).toLocaleString('en-US');
const compact = n => (n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(n));
const wordFor = (table, x) => table.find(([from]) => x >= from)[1];

const tile = (label, value, sub, cls = '') => `<div class="stat${cls ? ` ${cls}` : ''}"><dt>${esc(label)}</dt><dd><b>${value}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</dd></div>`;

function tiles(f, about) {
  const x = f.extras ?? {};
  const out = [];
  const value = x.value ?? about?.value?.avg ?? null;
  if (value != null) {
    const votes = about?.value?.votes;
    out.push(tile('Value for money', `${value.toFixed(1)}<small> of 5</small>`, [wordFor(VALUE_WORDS, value), votes && `${compact(votes)} votes`].filter(Boolean).join(' · ')));
  }
  const o = about?.owners;
  if (o && o.have + o.had >= KEEP_VOTES) {
    const lift = x.keep ?? 0;
    const sub = `of ${compact(o.have + o.had)} owners keep it${lift >= KEEP_HIGH ? ', more than most' : lift <= KEEP_LOW ? ', fewer than most' : ''}`;
    out.push(tile('Kept', pct(o.have / (o.have + o.had)), sub));
  }
  // Signals from about data when the record has none of its own (a bottle outside the pool).
  const risk = riskOf(about && !f.extras && !f.about ? { ...f, about } : f);
  if (risk.level !== 'unknown' && (x.safe != null || risk.reasons.length)) {
    const sub = x.flags?.includes('polarizing') ? 'Divides people' : risk.reasons[0]?.replace(/\.$/, '') ?? `Safer than ${x.safe}% of popular bottles`;
    out.push(tile('Blind buy', esc(RISK_WORDS[risk.level]), sub, `risk-${risk.level}`));
  }
  if (x.now != null) {
    out.push(tile('Talked about', x.now >= 50 ? `Top ${Math.max(1, 100 - x.now)}%` : 'Quietly', x.now >= 50 ? 'of bottles right now' : 'less than most right now'));
  }
  return out;
}

function ratingsHTML(hist) {
  const total = SENTIMENT.reduce((s, [k]) => s + (hist[k] ?? 0), 0);
  if (!total) return '';
  const peak = Math.max(...SENTIMENT.map(([k]) => hist[k] ?? 0));
  const warm = ((hist.love ?? 0) + (hist.like ?? 0)) / total;
  const rows = SENTIMENT.map(([k, label]) => {
    const n = hist[k] ?? 0;
    return `<li><span class="hist-label">${label}</span><span class="hist-track"><span class="hist-fill" style="width:${((n / peak) * 100).toFixed(1)}%"></span></span><span class="hist-value">${pct(n / total)}</span></li>`;
  }).join('');
  return `<div class="crowd-block"><p class="bp-sub">Ratings <span>${pct(warm)} love or like it · ${num(total)} votes</span></p><ul class="hist" aria-label="How voters rate it">${rows}</ul></div>`;
}

function leanHTML(lean, votes) {
  const word = lean <= -LEAN_STRONG ? 'Mostly worn by women' : lean <= -LEAN_WORD ? 'Leans feminine'
    : lean >= LEAN_STRONG ? 'Mostly worn by men' : lean >= LEAN_WORD ? 'Leans masculine' : 'Unisex to the crowd';
  const at = ((Math.max(-1, Math.min(1, lean)) + 1) / 2) * 100;
  return `<div class="crowd-block"><p class="bp-sub">Who wears it <span>${esc(word)}${votes ? ` · ${num(votes)} votes` : ''}</span></p>
    <div class="lean" role="img" aria-label="${esc(`${word}, on a scale from feminine to masculine`)}">
      <span class="lean-track"><span class="lean-mid"></span><span class="lean-dot" style="left:${at.toFixed(1)}%"></span></span>
      <span class="lean-ends" aria-hidden="true"><span>Feminine</span><span>Unisex</span><span>Masculine</span></span>
    </div></div>`;
}

/** The section for a bottle's model: a skeleton while its about data loads, '' with nothing to say. */
export function crowdHTML(m) {
  const { f } = m;
  const about = aboutOf(m);
  const head = '<h3 id="crowd-title">What voters say</h3>';
  if (about === undefined && !f.extras && /^\d+$/.test(f.id)) {
    return `<section class="bp-section" aria-labelledby="crowd-title" aria-busy="true">${head}<span class="visually-hidden">Loading</span>
      <div class="stats sk-stats"><span class="sk"></span><span class="sk"></span><span class="sk"></span><span class="sk"></span></div></section>`;
  }
  const stats = tiles(f, about);
  const hist = about?.sentiment ?? f.sentiment;
  const lean = about?.crowdGender?.lean ?? f.extras?.lean ?? null;
  const made = [
    about?.perfumers?.length && `By ${about.perfumers.join(', ')}`,
    about?.line && `${about.line} line`,
  ].filter(Boolean).map(esc).join(' · ');
  const blocks = [
    stats.length ? `<dl class="stats">${stats.join('')}</dl>` : '',
    hist ? ratingsHTML(hist) : '',
    lean != null ? leanHTML(lean, about?.crowdGender?.votes) : '',
    made ? `<p class="crowd-made">${made}</p>` : '',
  ].filter(Boolean);
  if (!blocks.length) return '';
  return `<section class="bp-section" aria-labelledby="crowd-title">${head}${blocks.join('')}
    <p class="bp-credit">Fragrantica members’ votes, from Le Decanteur’s dataset.</p>
  </section>`;
}

addSection({ id: 'crowd', order: 470, render: crowdHTML });
