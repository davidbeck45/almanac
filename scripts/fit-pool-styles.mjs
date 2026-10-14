#!/usr/bin/env node
// Style scores for the suggestion pool, into data/fragrantica/pool-styles.json,
// so Discover ranks 9,644 bottles by style without scoring each one live.
//   node scripts/fit-pool-styles.mjs           (report)
//   node scripts/fit-pool-styles.mjs --write   (write the file)
//
// Each bottle is scored on its full r/ row, as its detail sheet would be: the
// pool keeps only a bottle's 8 strongest notes, which moves the styles shown
// for about 1 bottle in 20. The file is sparse, row for row with pool.json:
// per row the styles scoring MIN or more, as [style index, score × 100, …]
// (anything left out reads as 0), with the STYLES ids in index order, and the
// pool's count and key (a hash of its ids) so loadPoolStyles turns down a
// file made for another pool. Rerun after changing src/scent-styles.js or
// remaking the pool (`decant.py build` or `pool`); test/discover.test.js
// fails until you do.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { fromFragrantica, poolKey } from '../src/fragrantica.js';
import { STYLES, styleScores } from '../src/scent-styles.js';

// Below this a style says nothing about a bottle: the weakest rule that reads
// scores, a bottle's lean, starts at 0.4.
export const MIN = 30;

const dir = new URL('../data/fragrantica/', import.meta.url);
const readJSON = name => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));

/** One bottle's stored scores: [style index, score × 100, …] for the styles from MIN. */
export function packScores(scores) {
  const out = [];
  STYLES.forEach((s, i) => {
    const v = Math.round(100 * scores[s.id]);
    if (v >= MIN) out.push(i, v);
  });
  return out;
}

/** -> { file, bottles, entries }: the pool's style scores from its r/ rows. */
export function fitPoolStyles() {
  const pool = readJSON('pool.json');
  const wanted = new Set(pool.cols.id.map(String));
  const rows = new Map();
  for (const name of readdirSync(new URL('r/', dir)).filter(f => f.endsWith('.json'))) {
    for (const [id, row] of Object.entries(readJSON(`r/${name}`))) if (wanted.has(id)) rows.set(id, row);
  }
  const s = pool.cols.id.map(id => {
    const row = rows.get(String(id));
    if (!row) throw new Error(`pool bottle ${id} is missing from r/`);
    return packScores(styleScores(fromFragrantica(String(id), row)));
  });
  const file = {
    license: pool.license,
    count: pool.count,
    key: poolKey(pool),
    styles: STYLES.map(st => st.id),
    min: MIN,
    s,
  };
  return { file, bottles: s.length, entries: s.reduce((n, row) => n + row.length / 2, 0) };
}

if (import.meta.main) {
  const { values: args } = parseArgs({ options: { write: { type: 'boolean', default: false } } });
  const started = performance.now();
  const { file, bottles, entries } = fitPoolStyles();
  const text = JSON.stringify(file);
  console.log(`${bottles} pool bottles, ${(entries / bottles).toFixed(1)} styles each from ${MIN / 100} (${Math.round(performance.now() - started)} ms)`);
  console.log(`pool-styles.json: ${(text.length / 1024).toFixed(0)} KB raw, ${(gzipSync(text, { level: 9 }).length / 1024).toFixed(0)} KB gzip -9`);
  const counts = STYLES.map((st, i) => [st.label, file.s.filter(row => row.some((x, j) => j % 2 === 0 && x === i && row[j + 1] >= 55)).length]);
  console.log(`Shown (from 0.55): ${counts.map(([label, n]) => `${label} ${n}`).join(', ')}`);
  if (args.write) {
    writeFileSync(new URL('pool-styles.json', dir), `${text}\n`);
    console.log('wrote data/fragrantica/pool-styles.json');
  }
}
