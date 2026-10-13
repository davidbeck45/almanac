#!/usr/bin/env node
// What test/scent-styles.test.js only passes or fails, spelled out, for tuning
// src/scent-styles.js against the Fragrantica dataset:
//   node scripts/check-styles.mjs                        exemplar and held-out hit rates, with every miss
//   node scripts/check-styles.mjs --save /tmp/before.json   the 12,000 most-voted bottles' scores, lean and shown styles
//   node scripts/check-styles.mjs --against /tmp/before.json   bottles whose lean (what a mix counts) or shown styles changed since --save
//   node scripts/check-styles.mjs --sample 50 [--seed 7]    random bottles with 1,000+ votes to eyeball
//   node scripts/check-styles.mjs --style skin [--n 30]     the best-scoring bottles with 1,000+ votes for one style
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fromFragrantica } from '../src/fragrantica.js';
import { STYLES, STYLE_LEAN, styleById, styleScores, topOf, leanOf, closeOf } from '../src/scent-styles.js';
import { EXEMPLARS, HOLDOUT } from '../test/style-exemplars.js';

const { values: args } = parseArgs({
  options: {
    save: { type: 'string' },
    against: { type: 'string' },
    sample: { type: 'string' },
    seed: { type: 'string', default: '7' },
    style: { type: 'string' },
    n: { type: 'string', default: '30' },
  },
});

const MOST_VOTED = 12000;
const WELL_VOTED = 1000;
const SCENT = STYLES.filter(s => s.kind === 'scent').map(s => s.id);

const dir = new URL('../data/fragrantica/r/', import.meta.url);
const rows = new Map();
for (const file of readdirSync(dir)) {
  for (const [id, row] of Object.entries(JSON.parse(readFileSync(new URL(file, dir), 'utf8')))) rows.set(id, row);
}
const record = id => fromFragrantica(id, rows.get(id));
const byVotes = [...rows.keys()].sort((a, b) => (rows.get(b).r?.[1] ?? 0) - (rows.get(a).r?.[1] ?? 0));
const wellVoted = byVotes.filter(id => (rows.get(id).r?.[1] ?? 0) >= WELL_VOTED);
const ranked = scores => SCENT.toSorted((a, b) => scores[b] - scores[a]);
const top = (scores, n) => ranked(scores).slice(0, n).map(s => `${s} ${scores[s].toFixed(2)}`).join(', ');
const accordText = f => Object.entries(f.accords).map(([a, w]) => `${a} ${Math.round((w - 30) / 0.7)}`).join(', ');
const describe = (f, scores) => `${f.name} (${f.brand}): ${top(scores, 3)}${closeOf(scores) ? ', wears close' : ''}\n    ${accordText(f)}\n    ${Object.values(f.notes).flat().slice(0, 10).join(', ')}`;

// A seeded shuffle, so a sample can be drawn again.
function sample(ids, n, seed) {
  let x = seed;
  const rand = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pool = [...ids];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

if (args.save || args.against) {
  // Per bottle: its scores, its lean (styleMix counts it) and its shown styles
  // (topOf, the chips), each saved as ids so a later threshold change shows.
  const now = Object.fromEntries(byVotes.slice(0, MOST_VOTED).map(id => {
    const scores = styleScores(record(id));
    return [id, { scores, lean: leanOf(scores).map(s => s.id), shown: topOf(scores).map(s => s.id), close: closeOf(scores) }];
  }));
  if (args.save) {
    writeFileSync(args.save, JSON.stringify(now));
    console.log(`Saved the styles of ${Object.keys(now).length} bottles to ${args.save}`);
  } else {
    const before = JSON.parse(readFileSync(args.against, 'utf8'));
    const ids = Object.keys(now).filter(id => before[id]);
    const gained = {}, lost = {};
    const tally = (counts, list) => list.forEach(s => (counts[s] = (counts[s] ?? 0) + 1));
    const lines = [];
    let leanMoved = 0, shownMoved = 0, bare = 0, bareBefore = 0;
    for (const id of ids) {
      const b = before[id], n = now[id];
      const plus = n.shown.filter(s => !b.shown.includes(s)), minus = b.shown.filter(s => !n.shown.includes(s));
      const leanChanged = b.lean.join() !== n.lean.join();
      if (!n.shown.length) bare++;
      if (!b.shown.length) bareBefore++;
      if (!leanChanged && !plus.length && !minus.length && b.close === n.close) continue;
      if (leanChanged) leanMoved++;
      if (plus.length || minus.length) shownMoved++;
      tally(gained, plus);
      tally(lost, minus);
      const was = s => `${s} ${n.scores[s].toFixed(2)} (was ${b.scores[s].toFixed(2)})`;
      const f = record(id);
      const parts = [
        leanChanged && `lean ${b.lean.join(', ') || '-'} -> ${n.lean.join(', ') || '-'}`,
        plus.length && `shown +${plus.map(was).join(', +')}`,
        minus.length && `shown -${minus.map(was).join(', -')}${n.shown.length ? '' : ', none left'}`,
        b.close !== n.close && (n.close ? 'now wears close' : 'no longer wears close'),
      ].filter(Boolean);
      lines.push(`  ${f.name} (${f.brand}) ${f.ratingVotes} votes: ${parts.join('; ')}`);
    }
    const counts = c => Object.entries(c).sort((a, b) => b[1] - a[1]).map(([s, k]) => `${styleById(s).label} ${k}`).join(', ') || 'none';
    console.log(`Of ${ids.length} bottles, ${leanMoved} changed their lean (top 2 from ${STYLE_LEAN}, what a mix counts) and ${shownMoved} their shown styles (topOf).`);
    console.log(`Shown styles gained: ${counts(gained)}`);
    console.log(`Shown styles lost: ${counts(lost)}`);
    console.log(`Bottles showing no style: ${bare} (was ${bareBefore})`);
    if (lines.length) console.log(lines.join('\n'));
  }
} else if (args.sample) {
  sample(wellVoted, Number(args.sample), Number(args.seed)).forEach((id, i) => {
    const f = record(id);
    console.log(`${i + 1}. ${describe(f, styleScores(f))}`);
  });
} else if (args.style) {
  const style = args.style;
  if (!STYLES.some(s => s.id === style)) {
    console.error(`Unknown style "${style}": ${STYLES.map(s => s.id).join(', ')}`);
    process.exit(1);
  }
  const scored = wellVoted.map(id => ({ f: record(id) })).map(o => ({ ...o, scores: styleScores(o.f) }))
    .sort((a, b) => b.scores[style] - a.scores[style]);
  scored.slice(0, Number(args.n)).forEach(({ f, scores }, i) => console.log(`${i + 1}. ${style} ${scores[style].toFixed(2)} · ${describe(f, scores)}`));
} else {
  for (const [title, set] of [['Exemplars (tuned on)', EXEMPLARS], ['Held out', HOLDOUT]]) {
    let hits = 0, total = 0;
    const misses = [];
    for (const [style, ids] of Object.entries(set)) {
      for (const id of ids.map(String)) {
        const f = record(id);
        const scores = styleScores(f);
        const rank = ranked(scores).indexOf(style);
        const hit = style === 'intimate' ? closeOf(scores) : rank < 2;
        total++;
        if (hit) hits++;
        else misses.push(`  ${style}: ${f.name} (${f.brand}) has ${style} ${scores[style].toFixed(2)}${rank >= 0 ? ` at #${rank + 1}` : ''}; top ${top(scores, 3)}`);
      }
    }
    console.log(`${title}: ${hits}/${total} (${Math.round(100 * hits / total)}%) show their style (top 2, or wears close)`);
    if (misses.length) console.log(misses.join('\n'));
  }
}
