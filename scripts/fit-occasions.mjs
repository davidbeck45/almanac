#!/usr/bin/env node
// Fit the fixed occasion scale (OCCASION_SCALE in src/occasions.js): for each
// occasion, the 2nd and 98th percentile of the engine's raw occasion fit
// (occasionRaw) over the dataset's well-voted bottles, 500+ rating votes, read
// from data/fragrantica/r/. rank() puts every collection on this one scale,
// so a small or one-note wardrobe's best Formal bottle isn't 100% Formal by
// definition, and scores compare across collections (and with the gap finder).
// The scale never spans less than the accords' fit alone (accordFit) does:
// a performance wish moves bottles along it, but most of the dataset's
// bottles fade by Fragrantica's votes (their median longevity sits half a
// level under the wardrobe's middle), so Office's wish to last pulled its
// 98th percentile under most lasting fresh bottles, and the knee pressed
// eight of David's together near a perfect fit. A scale narrower than the
// engine's MILD_SPAN (Casual's) is written as fitted: the engine reads it
// wider and leans the occasion's weights toward daily picks'.
//   node scripts/fit-occasions.mjs           (report)
//   node scripts/fit-occasions.mjs --write   (update src/occasions.js)
// Rerun after changing an occasion's profile or performance wish, or the
// dataset; test/occasions.test.js fails until you do.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fromFragrantica } from '../src/fragrantica.js';
import { occasionRaw, accordFit } from '../src/engine.js';
import { OCCASIONS } from '../src/occasions.js';

const MIN_VOTES = 500;
const QUANTILES = [0.02, 0.98];

const quantile = (sorted, q) => {
  const at = q * (sorted.length - 1), i = Math.floor(at);
  return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (at - i);
};
const round3 = x => Math.round(x * 1000) / 1000;

/** -> { scale: { id: [lo, hi] }, raws: { id: sorted raw fits }, accords: { id: sorted accord fits }, bottles } */
export function fitOccasionScale(occasions = OCCASIONS) {
  const dir = new URL('../data/fragrantica/r/', import.meta.url);
  const raws = Object.fromEntries(occasions.map(o => [o.id, []]));
  const accords = Object.fromEntries(occasions.map(o => [o.id, []]));
  let bottles = 0;
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    for (const [id, row] of Object.entries(JSON.parse(readFileSync(new URL(file, dir), 'utf8')))) {
      if ((row.r?.[1] ?? 0) < MIN_VOTES) continue;
      const frag = fromFragrantica(id, row);
      bottles++;
      for (const o of occasions) {
        raws[o.id].push(occasionRaw(frag, o));
        accords[o.id].push(accordFit(frag, o));
      }
    }
  }
  for (const list of [...Object.values(raws), ...Object.values(accords)]) list.sort((a, b) => a - b);
  const at = (list, q) => round3(quantile(list, q));
  const scale = Object.fromEntries(occasions.map(o => {
    const [lo, hi] = QUANTILES;
    return [o.id, [Math.min(at(raws[o.id], lo), at(accords[o.id], lo)), Math.max(at(raws[o.id], hi), at(accords[o.id], hi))]];
  }));
  return { scale, raws, accords, bottles };
}

if (import.meta.main) {
  const { values: args } = parseArgs({ options: { write: { type: 'boolean', default: false } } });
  const { scale, raws, accords, bottles } = fitOccasionScale();
  const line = `export const OCCASION_SCALE = { ${OCCASIONS.map(o => `${o.id}: [${scale[o.id].join(', ')}]`).join(', ')} };`;
  console.log(`${bottles} bottles with ${MIN_VOTES}+ rating votes (accords alone in brackets)`);
  const q3 = (list, q) => quantile(list, q).toFixed(3).padStart(6);
  for (const o of OCCASIONS) {
    const [lo, hi] = scale[o.id];
    console.log(`${o.label.padEnd(11)} 2nd ${q3(raws[o.id], 0.02)} (${q3(accords[o.id], 0.02)})  median ${q3(raws[o.id], 0.5)}  `
      + `98th ${q3(raws[o.id], 0.98)} (${q3(accords[o.id], 0.98)})  scale ${lo.toFixed(3)} .. ${hi.toFixed(3)}`);
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
