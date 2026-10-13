#!/usr/bin/env node
// Refit accord heaviness from the Fragrantica votes in data/.
//   node scripts/fit-accords.mjs           (report what would change)
//   node scripts/fit-accords.mjs --write   (update src/accords.js)
//
// Each voted bottle says how cold-weather it wears: winter + fall votes minus
// spring + summer. Accord weights start from their hand-set priors and move
// toward what explains those votes (ridge regression, so an accord seen on one
// or two bottles barely moves). Rerun after adding bottles to data/, then
// `npm test`. (Season and night estimates come from src/profiles.js, fitted on
// the whole Fragrantica dataset by scripts/fit-profiles.mjs.)
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ACCORDS } from '../src/accords.js';

// How hard weights are pulled back to their priors. Leave-one-out error is
// lowest around 0.1–0.3 on 85 bottles; the higher end trusts the votes less.
const LAMBDA = 0.3;

const load = stem => JSON.parse(readFileSync(new URL(`../data/${stem}.json`, import.meta.url))).fragrances;
/** Every bottle in data/ with Fragrantica season votes, calibration set and dupes' originals included. */
export const votedBottles = () => [...load('collection'), ...load('catalog'), ...load('calibration'), ...load('originals')].filter(f => f.seasonVotes);
const names = Object.keys(ACCORDS);
const prior = names.map(n => ACCORDS[n].prior);

const sum = xs => xs.reduce((a, b) => a + b, 0);
const dot = (a, b) => sum(a.map((v, i) => v * b[i]));
const shares = f => {
  const row = names.map(n => f.accords[n] ?? 0);
  const total = sum(row);
  return row.map(v => v / total);
};

function linearFit(xs, ys, ws) {
  const W = sum(ws), mx = sum(xs.map((x, i) => ws[i] * x)) / W, my = sum(ys.map((y, i) => ws[i] * y)) / W;
  const sxy = sum(xs.map((x, i) => ws[i] * (x - mx) * (ys[i] - my)));
  const sxx = sum(xs.map((x, i) => ws[i] * (x - mx) ** 2));
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

const round = (x, step) => Math.round(x / step) * step;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Weighted ridge toward the priors, on the priors' own scale.
function fit(rows, targets, weights) {
  const k = names.length;
  const A = names.map((_, i) => names.map((_, j) => (i === j ? LAMBDA : 0)));
  const b = new Array(k).fill(0);
  rows.forEach((r, n) => {
    const res = targets[n] - dot(r, prior);
    for (let i = 0; i < k; i++) {
      if (!r[i]) continue;
      b[i] += weights[n] * r[i] * res;
      for (let j = 0; j < k; j++) A[i][j] += weights[n] * r[i] * r[j];
    }
  });
  const delta = solve(A, b);
  return prior.map((p, i) => clamp(round(p + delta[i], 0.05), -1, 1));
}

function model(bottles) {
  const X = bottles.map(shares);
  const warmth = bottles.map(f => f.season.winter + f.season.fall - f.season.spring - f.season.summer);
  // Bottles with few votes count for less, as in the engine's quality score.
  const conf = bottles.map(f => Math.min(1, Math.log10(Math.max(sum(Object.values(f.seasonVotes)), 1)) / 3));
  // Keep the priors' scale: map warmth onto heaviness with the priors' own fit.
  const scale = linearFit(X.map(r => dot(r, prior)), warmth, conf);
  const targets = warmth.map(w => (w - scale.a) / scale.b);
  return { X, conf, targets, weights: fit(X, targets, conf) };
}

/** { accord: weight } fitted to these bottles' votes. */
export const fitAccordWeights = bottles => {
  const { weights } = model(bottles);
  return Object.fromEntries(names.map((n, i) => [n, weights[i]]));
};

if (import.meta.main) {
  const { values: args } = parseArgs({ options: { write: { type: 'boolean', default: false } } });
  const bottles = votedBottles();
  const { X, conf, targets, weights } = model(bottles);

  // Leave-one-out: how well each set of weights predicts a bottle it never saw.
  let errPrior = 0, errFit = 0;
  for (let i = 0; i < X.length; i++) {
    const keep = (_, j) => j !== i;
    const w = fit(X.filter(keep), targets.filter(keep), conf.filter(keep));
    errPrior += (dot(X[i], prior) - targets[i]) ** 2;
    errFit += (dot(X[i], w) - targets[i]) ** 2;
  }
  const rmse = e => Math.sqrt(e / X.length).toFixed(3);
  console.log(`${bottles.length} voted bottles, λ ${LAMBDA}`);
  console.log(`leave-one-out error: priors ${rmse(errPrior)}, fitted ${rmse(errFit)}`);

  const current = names.map(n => ACCORDS[n].weight);
  const seen = names.map((_, i) => X.filter(r => r[i] > 0).length);
  const changed = names.map((n, i) => ({ n, from: current[i], to: weights[i], prior: prior[i], seen: seen[i] }))
    .filter(c => Math.abs(c.to - c.from) > 1e-9)
    .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
  console.log(changed.length ? '\nweight changes (prior, bottles with it):' : '\nweights unchanged');
  for (const c of changed) {
    console.log(`  ${c.n.padEnd(14)} ${c.from.toFixed(2).padStart(5)} -> ${c.to.toFixed(2).padStart(5)}   (${c.prior.toFixed(1)}, ${c.seen})`);
  }

  if (args.write) {
    const accordsPath = new URL('../src/accords.js', import.meta.url);
    let src = readFileSync(accordsPath, 'utf8');
    names.forEach((n, i) => {
      const key = /^\w+$/.test(n) ? n : `'${n}'`;
      const re = new RegExp(`^(\\s+${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s+\\{ prior:\\s*-?[\\d.]+, weight:)\\s*-?[\\d.]+,`, 'm');
      src = src.replace(re, `$1 ${weights[i].toFixed(2).padStart(5)},`);
    });
    writeFileSync(accordsPath, src);
    console.log('\nwrote src/accords.js');
  }
}
