// The bottle page's value and crowd block (order 470): what Fragrantica's
// voters say beyond the rating, from the dataset (Le Decanteur's, CC BY-NC-SA):
// value for money, how many owners keep it, how safe a blind buy it is, how
// talked about it is now, how its ratings spread, how it reads (feminine to
// masculine), and who made it. Read from the record's signals (`extras`: pool
// rows, the wardrobe's) and its about data (loadAbout, or the build's `about`).
import { riskOf, signalsOf } from '../candidates.js';
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
// A low-risk bottle is a safe bet from this safety percentile (safer than
// half the pool's popular bottles); under it, a fair bet.
const SAFE_BET = 50;
// The crowd's lean, -1 feminine .. +1 masculine, in words past LEAN_WORD.
const LEAN_WORD = 0.4;
const LEAN_STRONG = 0.7;
const SENTIMENT = [['love', 'Love'], ['like', 'Like'], ['ok', 'OK'], ['dislike', 'Dislike'], ['hate', 'Hate']];

const pct = x => `${Math.round(x * 100)}%`;
const num = n => Number(n).toLocaleString('en-US');
const compact = n => (n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(n));
const wordFor = (table, x) => table.find(([from]) => x >= from)[1];
const lower = t => t.charAt(0).toLowerCase() + t.slice(1);
const unstop = t => t.replace(/\.$/, '');

/**
 * How safe a blind buy it is, in words that never contradict each other:
 * { level, word, line } or null with nothing to go on. Medium and high lead
 * with their weightiest reason; a low risk leads with its safety percentile
 * ("Safe bet" from SAFE_BET, else "Fair bet"), any caveat after it ("though
 * reviewers say it was reformulated"). The crowd block and compare both say it.
 */
export function riskLine(f, about = null) {
  const record = about && !f.extras && !f.about ? { ...f, about } : f;
  const risk = riskOf(record);
  if (risk.level === 'unknown') return null;
  const s = signalsOf(record);
  if (risk.level !== 'low') {
    return { level: risk.level, word: risk.level === 'high' ? 'Risky' : 'Some risk', line: s.flags.includes('polarizing') ? 'It divides people' : unstop(risk.reasons[0] ?? '') };
  }
  if (s.safe == null && !risk.reasons.length) return null;
  const caveat = risk.reasons[0] ? unstop(risk.reasons[0]) : '';
  const word = s.safe != null && s.safe >= SAFE_BET ? 'Safe bet' : 'Fair bet';
  const odds = s.safe == null ? '' : s.safe >= SAFE_BET ? `Safer than ${s.safe}% of popular bottles` : 'Less safe than most popular bottles';
  const line = odds ? `${odds}${caveat ? `, though ${lower(caveat)}` : ''}` : caveat;
  return { level: 'low', word, line };
}

const tile = (label, value, sub, cls = '') => `<div class="crowd-stat${cls ? ` ${cls}` : ''}"><dt>${esc(label)}</dt><dd><b>${value}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</dd></div>`;

function tiles(f, about, owned) {
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
    const sub = `of ${compact(o.have + o.had)} owners${lift >= KEEP_HIGH ? ', more than most' : lift <= KEEP_LOW ? ', fewer than most' : ''}`;
    out.push(tile('Kept', pct(o.have / (o.have + o.had)), sub));
  }
  // A blind buy is for a bottle you don't have yet.
  const risk = owned ? null : riskLine(f, about);
  if (risk) out.push(tile('Blind buy', esc(risk.word), risk.line, `risk-${risk.level}`));
  if (x.now != null) {
    out.push(x.now >= 50 ? tile('Talked about', `Top ${Math.max(1, 100 - x.now)}%`, 'of bottles right now') : tile('Talked about', 'Not much', 'right now'));
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
    return `<li><span class="crowd-hist-label">${label}</span><span class="crowd-hist-track"><span class="crowd-hist-fill" style="width:${((n / peak) * 100).toFixed(1)}%"></span></span><span class="crowd-hist-value">${pct(n / total)}</span></li>`;
  }).join('');
  return `<div class="crowd-block"><p class="bp-sub">Ratings <span>${pct(warm)} love or like it · ${num(total)} votes</span></p><ul class="crowd-hist" aria-label="How voters rate it">${rows}</ul></div>`;
}

// Fragrantica's gender votes say how a scent reads to voters, not who wears it.
function leanHTML(lean, votes) {
  const word = lean <= -LEAN_STRONG ? 'Voters call it feminine' : lean <= -LEAN_WORD ? 'Leans feminine'
    : lean >= LEAN_STRONG ? 'Voters call it masculine' : lean >= LEAN_WORD ? 'Leans masculine' : 'Voters call it unisex';
  const at = ((Math.max(-1, Math.min(1, lean)) + 1) / 2) * 100;
  return `<div class="crowd-block"><p class="bp-sub">How it reads <span>${esc(word)}${votes ? ` · ${num(votes)} votes` : ''}</span></p>
    <div class="crowd-lean" role="img" aria-label="${esc(`${word}, on a scale from feminine to masculine`)}">
      <span class="crowd-lean-track"><span class="crowd-lean-mid"></span><span class="crowd-lean-dot" style="left:${at.toFixed(1)}%"></span></span>
      <span class="crowd-lean-ends" aria-hidden="true"><span>Feminine</span><span>Unisex</span><span>Masculine</span></span>
    </div></div>`;
}

/** What a section says when a bottle's about data couldn't load: a sentence and Try again (the shell's retryBottle). */
export const aboutErrorHTML = () => `<p class="bp-error">Can’t reach the fragrance library. <button class="link-btn" data-action="bottle-retry">Try again</button></p>`;

/** The section for a bottle's model: a skeleton while its about data loads, '' with nothing to say. */
export function crowdHTML(m) {
  const { f } = m;
  const about = aboutOf(m);
  const head = '<h3 id="crowd-title">What voters say</h3>';
  if (about === undefined && !f.extras && /^\d+$/.test(f.id)) {
    if (m.aboutFailed) return `<section class="bp-section" aria-labelledby="crowd-title">${head}${aboutErrorHTML()}</section>`;
    return `<section class="bp-section" aria-labelledby="crowd-title" aria-busy="true">${head}<span class="visually-hidden">Loading</span>
      <div class="crowd-stats crowd-sk"><span class="sk"></span><span class="sk"></span><span class="sk"></span><span class="sk"></span></div></section>`;
  }
  const stats = tiles(f, about, m.owned || m.inMine);
  const hist = about?.sentiment ?? f.sentiment;
  const lean = about?.crowdGender?.lean ?? f.extras?.lean ?? null;
  const made = [
    about?.perfumers?.length && `By ${about.perfumers.join(', ')}`,
    // "Supremacy line", "Sweet Pleasure Collection": a line's name may say what it is.
    about?.line && (/\b(line|collection|series|range)\b/i.test(about.line) ? `Part of ${about.line}` : `${about.line} line`),
  ].filter(Boolean).map(esc).join(' · ');
  const blocks = [
    stats.length ? `<dl class="crowd-stats">${stats.join('')}</dl>` : '',
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
