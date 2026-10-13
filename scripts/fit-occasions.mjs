#!/usr/bin/env node
// Fit the fixed occasion scale (OCCASION_SCALE in src/occasions.js): for each
// occasion, the 2nd and 98th percentile of the engine's raw occasion fit
// (occasionRaw) over the dataset's well-voted bottles, 500+ rating votes, read
// from data/fragrantica/r/. rank() puts every collection on this one scale,
// so a small or one-note wardrobe's best Formal bottle isn't 100% Formal by
// definition, and scores compare across collections (and with the gap finder).
//   node scripts/fit-occasions.mjs           (report)
//   node scripts/fit-occasions.mjs --write   (update src/occasions.js)
// Rerun after changing an occasion's profile or performance wish, or the
// dataset; test/occasions.test.js fails until you do.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fromFragrantica } from '../src/fragrantica.js';
import { occasionRaw } from '../src/engine.js';
import { OCCASIONS } from '../src/occasions.js';

const MIN_VOTES = 500;
const QUANTILES = [0.02, 0.98];

const quantile = (sorted, q) => {
  const at = q * (sorted.length - 1), i = Math.floor(at);
  return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (at - i);
};
const round3 = x => Math.round(x * 1000) / 1000;

/** -> { scale: { id: [lo, hi] }, raws: { id: sorted raw fits }, bottles } */
export function fitOccasionScale(occasions = OCCASIONS) {
  const dir = new URL('../data/fragrantica/r/', import.meta.url);
  const raws = Object.fromEntries(occasions.map(o => [o.id, []]));
  let bottles = 0;
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    for (const [id, row] of Object.entries(JSON.parse(readFileSync(new URL(file, dir), 'utf8')))) {
      if ((row.r?.[1] ?? 0) < MIN_VOTES) continue;
      const frag = fromFragrantica(id, row);
      bottles++;
      for (const o of occasions) raws[o.id].push(occasionRaw(frag, o));
    }
  }
  for (const list of Object.values(raws)) list.sort((a, b) => a - b);
  const scale = Object.fromEntries(occasions.map(o => [o.id, QUANTILES.map(q => round3(quantile(raws[o.id], q)))]));
  return { scale, raws, bottles };
}

if (import.meta.main) {
  const { values: args } = parseArgs({ options: { write: { type: 'boolean', default: false } } });
  const { scale, raws, bottles } = fitOccasionScale();
  const line = `export const OCCASION_SCALE = { ${OCCASIONS.map(o => `${o.id}: [${scale[o.id].join(', ')}]`).join(', ')} };`;
  console.log(`${bottles} bottles with ${MIN_VOTES}+ rating votes`);
  for (const o of OCCASIONS) {
    const [lo, hi] = scale[o.id];
    console.log(`${o.label.padEnd(11)} 2nd ${lo.toFixed(3).padStart(6)}  median ${quantile(raws[o.id], 0.5).toFixed(3).padStart(6)}  98th ${hi.toFixed(3).padStart(6)}`);
  }
  console.log(`\nsrc/occasions.js:\n  ${line}`);
  if (args.write) {
    const path = new URL('../src/occasions.js', import.meta.url);
    const text = readFileSync(path, 'utf8');
    if (!/^export const OCCASION_SCALE = .*$/m.test(text)) throw new Error('no OCCASION_SCALE line in src/occasions.js');
    writeFileSync(path, text.replace(/^export const OCCASION_SCALE = .*$/m, line));
    console.log('\nwrote src/occasions.js');
  }
}
