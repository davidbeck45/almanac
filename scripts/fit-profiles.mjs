#!/usr/bin/env node
// Fit src/profiles.js on the well-voted bottles in data/fragrantica/.
//   node scripts/fit-profiles.mjs           (report)
//   node scripts/fit-profiles.mjs --write   (update src/profiles.js)
//
// Each accord gets a profile: the season and night shares it pulls a bottle
// toward ([winter, spring, summer, fall, night]); a bottle's estimate is its
// accords' profiles weighted by strength (src/custom.js). Ridge regression
// pulls an accord seen on few bottles toward the average bottle.
//
// It also measures, on a fifth of the bottles held out of the fit, how many
// votes the estimate is worth (PRIOR_VOTES, what src/engine.js leans a
// bottle's few votes toward): a split from k votes strays by about
// p(1 - p) / (k + 1), so k = mean p(1 - p) / mean squared error - 1. Once
// with the accords alone, once averaged with the bottle's "smells like"
// neighbours' votes (`like`). Rerun after `python3 scripts/decant.py build`.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fromFragrantica } from '../src/fragrantica.js';
import { barStrength } from '../src/accords.js';
import { ACCORD_PROFILES, PROFILE_MEAN, PRIOR_VOTES } from '../src/profiles.js';
import { predictedShares } from '../src/custom.js';

const LAMBDA = 1;
const MIN_SEASON_VOTES = 300;
const MIN_TIME_VOTES = 100;
const SEASONS = ['winter', 'spring', 'summer', 'fall'];
const sum = xs => xs.reduce((a, b) => a + b, 0);

const dir = new URL('../data/fragrantica/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('meta.json', dir)));
const bottles = readdirSync(new URL('r/', dir)).flatMap(file =>
  Object.entries(JSON.parse(readFileSync(new URL(`r/${file}`, dir)))).map(([id, row]) => fromFragrantica(id, row)))
  .filter(f => f.seasonVotes && sum(Object.values(f.seasonVotes)) >= MIN_SEASON_VOTES
    && f.timeVotes.day + f.timeVotes.night >= MIN_TIME_VOTES);
const target = f => [...SEASONS.map(s => f.season[s]), f.dayNight.night];

function fit(set) {
  const names = [...new Set(set.flatMap(f => Object.keys(f.accords)))].sort();
  const ix = new Map(names.map((n, i) => [n, i])), K = names.length;
  const Y = set.map(target), mean = [0, 1, 2, 3, 4].map(k => sum(Y.map(y => y[k])) / Y.length);
  // Normal equations for profile = mean + d, ridge on d.
  const A = names.map((_, i) => names.map((_, j) => (i === j ? LAMBDA : 0)));
  const B = names.map(() => [0, 0, 0, 0, 0]);
  set.forEach((f, n) => {
    const x = Object.entries(f.accords).map(([a, w]) => [ix.get(a), barStrength(w)]);
    const t = sum(x.map(([, v]) => v)) || 1;
    for (const [i, vi] of x) {
      for (let k = 0; k < 5; k++) B[i][k] += (vi / t) * (Y[n][k] - mean[k]);
      for (const [j, vj] of x) A[i][j] += (vi / t) * (vj / t);
    }
  });
  const M = A.map((row, i) => [...row, ...B[i]]);
  for (let c = 0; c < K; c++) {
    let p = c;
    for (let r = c + 1; r < K; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < K; r++) {
      if (r === c || !M[r][c]) continue;
      const q = M[r][c] / M[c][c];
      for (let k = c; k < K + 5; k++) M[r][k] -= q * M[c][k];
    }
  }
  const profiles = Object.fromEntries(names.map((n, i) => [n, mean.map((m, k) => m + M[i][K + k] / M[i][i])]));
  return { profiles, mean };
}

// Swap a fit into the live estimate, so it's scored exactly as the engine reads it.
function use({ profiles, mean }) {
  for (const k of Object.keys(ACCORD_PROFILES)) delete ACCORD_PROFILES[k];
  Object.assign(ACCORD_PROFILES, profiles);
  PROFILE_MEAN.splice(0, 5, ...mean);
}

function score(set, withLike) {
  let pv = [0, 0], se = [0, 0];
  for (const f of set) {
    const est = predictedShares(f.accords, withLike ? f.like : null);
    const pred = [...SEASONS.map(s => est.season[s]), est.night], act = target(f);
    pred.forEach((p, k) => { const g = k < 4 ? 0 : 1; pv[g] += p * (1 - p); se[g] += (act[k] - p) ** 2; });
  }
  const n = [set.length * 4, set.length];
  return {
    season: { rmse: Math.sqrt(se[0] / n[0]), votes: pv[0] / se[0] - 1 },
    night: { rmse: Math.sqrt(se[1] / n[1]), votes: pv[1] / se[1] - 1 },
  };
}

const heldOut = f => (Number(f.id) * 2654435761 % 2 ** 32) / 2 ** 32 >= 0.8;
const train = bottles.filter(f => !heldOut(f)), test = bottles.filter(heldOut), liked = test.filter(f => f.like);
const show = (label, s) => console.log(`  ${label.padEnd(34)} season error ${s.season.rmse.toFixed(4)} (${s.season.votes.toFixed(0)} votes) · night ${s.night.rmse.toFixed(4)} (${s.night.votes.toFixed(0)} votes)`);

console.log(`${bottles.length} bottles with ${MIN_SEASON_VOTES}+ season votes, ${test.length} held out (${liked.length} with smells-like neighbours)`);
const before = { profiles: { ...ACCORD_PROFILES }, mean: [...PROFILE_MEAN] };
show('src/profiles.js now, accords', score(test, false));
use(fit(train));
const alone = score(test, false), both = score(liked, true);
show('refit, accords', alone);
show('refit, averaged with smells-like', both);

const final = fit(bottles);
const priorVotes = {
  accords: { season: Math.round(alone.season.votes), night: Math.round(alone.night.votes) },
  withLike: { season: Math.round(both.season.votes), night: Math.round(both.night.votes) },
};
console.log(`\nPRIOR_VOTES ${JSON.stringify(priorVotes)} (now ${JSON.stringify(PRIOR_VOTES)})`);

const moved = Object.entries(final.profiles)
  .map(([a, p]) => [a, p, before.profiles[a] ?? before.mean])
  .sort((x, y) => Math.abs(y[1][4] - y[2][4]) + Math.abs(y[1][2] - y[2][2]) - Math.abs(x[1][4] - x[2][4]) - Math.abs(x[1][2] - x[2][2]));
const pct = p => p.map(x => Math.round(x * 100)).join('/');
console.log('\nbiggest changes, winter/spring/summer/fall/night %:');
for (const [a, p, was] of moved.slice(0, 8)) console.log(`  ${a.padEnd(16)} ${pct(was).padEnd(16)} -> ${pct(p)}`);

if (parseArgs({ options: { write: { type: 'boolean', default: false } } }).values.write) {
  const f3 = p => `[${p.map(x => x.toFixed(3)).join(', ')}]`;
  const key = n => (/^[a-z]\w*$/.test(n) ? n : `'${n.replace(/'/g, "\\'")}'`);
  const rows = Object.entries(final.profiles).map(([a, p]) => `  ${key(a)}: ${f3(p)},`).join('\n');
  writeFileSync(new URL('../src/profiles.js', import.meta.url), `// Generated by scripts/fit-profiles.mjs from the ${bottles.length} bottles in
// data/fragrantica/ (dataset version ${meta.version}) with ${MIN_SEASON_VOTES}+ season and ${MIN_TIME_VOTES}+ day/night votes.
//
// The shares each accord pulls a bottle toward: [winter, spring, summer, fall,
// night]. A bottle's estimate is its accords' profiles weighted by strength;
// an accord missing here counts as the average bottle (PROFILE_MEAN).
export const DATASET_VERSION = ${meta.version};
export const PROFILE_MEAN = ${f3(final.mean)};

// How many votes the estimate counts as when a bottle's own votes are few
// (src/engine.js), measured on bottles held out of the fit: from the accords
// alone, and averaged with its "smells like" neighbours' votes.
export const PRIOR_VOTES = ${JSON.stringify(priorVotes).replace(/"/g, '').replace(/([:,])/g, '$1 ').replace(/\{/g, '{ ').replace(/\}/g, ' }')};

export const ACCORD_PROFILES = {
${rows}
};
`);
  console.log('\nwrote src/profiles.js');
}
