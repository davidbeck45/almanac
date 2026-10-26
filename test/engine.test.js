import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rank, groupTiers, targetSeasonWeights, calendarSeason, rotationPenalty, restReason, planWindows, comfortRange, dewPointF, targetHeaviness, steadyShares, votedOccasionFit, scoreOf, occasionRaw, occasionPart, seasonFit, SEASONS, votedShares, performanceLevel } from '../src/engine.js';
import { occasionById } from '../src/occasions.js';
import { heaviness } from '../src/accords.js';
import { predictedShares } from '../src/custom.js';
import { summarize, week } from '../src/weather.js';
import { syntheticForecast } from './fixtures.js';

const { fragrances } = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url)));
const names = list => list.map(r => r.fragrance.name);

const AUG = new Date('2026-08-05T12:00:00');
const SEP = new Date('2026-09-28T12:00:00');
const JAN = new Date('2027-01-15T12:00:00');
const hotHumidDay = { feelsF: 92, humidity: 75, category: 'clear', date: AUG, lat: 40 };
const coldNight = { feelsF: 28, humidity: 60, category: 'clear', date: JAN, lat: 40 };
const mildFallNight = { feelsF: 58, humidity: 60, category: 'clear', date: SEP, lat: 40 };

const HEAVY = ['Liquid Brun', 'Amber Empire', 'CH Men Prive', 'Hawas Elixir', 'Rifaaqat', 'Terra'];
const FRESH = ['Shiyaaka Sky', 'Essence de Blanc', 'Jake', 'Atlantis Extrait', 'Aristo'];

test('season weights follow temperature', () => {
  const hot = targetSeasonWeights(95, AUG, 40);
  const cold = targetSeasonWeights(20, JAN, 40);
  assert.ok(hot.summer > 0.8);
  assert.ok(cold.winter > 0.8);
});

test('calendar breaks the spring/fall tie and flips south of the equator', () => {
  const w = targetSeasonWeights(62, SEP, 40);
  assert.ok(w.fall > w.spring);
  assert.equal(calendarSeason(SEP, -33), 'spring');
  // Spring and fall weather overlap, so mid-October and mid-April mirror each other.
  const oct = targetSeasonWeights(60, new Date('2026-10-15T12:00:00'), 40);
  const apr = targetSeasonWeights(60, new Date('2026-04-15T12:00:00'), 40);
  assert.ok(oct.fall > 3 * oct.spring && apr.spring > 3 * apr.fall);
  assert.ok(Math.abs(oct.fall - apr.spring) < 1e-3);
  const sydneyOct = targetSeasonWeights(60, new Date('2026-10-15T12:00:00'), -33);
  assert.ok(sydneyOct.spring > 3 * sydneyOct.fall);
  // A 70°F day is summer weather for most voters, even in October.
  const warmOct = targetSeasonWeights(70, new Date('2026-10-15T12:00:00'), 40);
  assert.equal(Object.entries(warmOct).sort((a, b) => b[1] - a[1])[0][0], 'summer');
});

test('a cold spring night is no more \'spring\' than a cold fall one', () => {
  const apr = targetSeasonWeights(40, new Date('2026-04-15T12:00:00'), 40);
  const oct = targetSeasonWeights(40, new Date('2026-10-15T12:00:00'), 40);
  assert.ok(apr.spring < 1.3 * apr.fall, JSON.stringify(apr));
  assert.ok(Math.abs(apr.winter - oct.winter) < 0.01);
  // A 45°F April night picks much like a 45°F October one: the heavy bottles stay up.
  const night = iso => ({ feelsF: 45, humidity: 60, dewF: 35, category: 'clear', date: new Date(`${iso}T12:00:00`), lat: 40 });
  const [april, october] = ['2026-04-15', '2026-10-15'].map(iso => rank(fragrances, night(iso), 'night'));
  for (const n of ['Amber Empire', 'CH Men Prive']) {
    const r = april.find(x => x.fragrance.name === n);
    assert.ok(r.tier === 'S' || r.tier === 'A', `${n} is ${r.tier}: ${r.reasons.map(x => x.text).join(' | ')}`);
  }
  const shared = names(april.slice(0, 5)).filter(n => names(october.slice(0, 5)).includes(n));
  assert.ok(shared.length >= 3, `${names(april.slice(0, 5))} vs ${names(october.slice(0, 5))}`);
});

test('the calendar eases across month boundaries and fades in the tropics', () => {
  const at = (iso, f = 40, lat = 40) => targetSeasonWeights(f, new Date(`${iso}T12:00:00`), lat);
  for (const [a, b, f] of [['2026-11-30', '2026-12-01', 40], ['2026-02-28', '2026-03-01', 40], ['2026-05-31', '2026-06-01', 72], ['2026-08-31', '2026-09-01', 72]]) {
    for (const s of ['winter', 'spring', 'summer', 'fall']) assert.ok(Math.abs(at(a, f)[s] - at(b, f)[s]) < 0.03, `${a} vs ${b}: ${s}`);
  }
  // Quito (just south of the equator) and Bogotá (just north) read the same weather the same way.
  for (const iso of ['2026-06-15', '2026-12-15']) {
    const [n, s] = [at(iso, 58, 0.2), at(iso, 58, -0.2)];
    for (const k of ['winter', 'spring', 'summer', 'fall']) assert.ok(Math.abs(n[k] - s[k]) < 1e-9, `${iso} ${k}`);
    assert.ok(Math.abs(n.spring - n.fall) < 1e-9, 'no spring or fall at the equator');
  }
});

test('mugginess follows the dew point, not relative humidity', () => {
  assert.ok(Math.abs(dewPointF(86, 50) - 65) < 1, `${dewPointF(86, 50)}`);
  assert.ok(Math.abs(dewPointF(70, 100) - 70) < 0.1);
  // 88°F at 55% is oppressive (dew ~70°F); 72°F at 85% is sticky, not oppressive (~67°F).
  assert.ok(targetHeaviness({ feelsF: 88, dewF: 71 }) < targetHeaviness({ feelsF: 88, dewF: 50 }) - 0.2);
  assert.equal(targetHeaviness({ feelsF: 100, dewF: 40 }), targetHeaviness({ feelsF: 100, dewF: 55 }), 'dry heat adds nothing');
  const top = c => rank(fragrances, { ...hotHumidDay, feelsF: 86, ...c }, 'day').slice(0, 5);
  const avgH = list => list.reduce((sum, r) => sum + heaviness(r.fragrance.accords), 0) / list.length;
  assert.ok(avgH(top({ dewF: 72 })) <= avgH(top({ dewF: 48 })), 'muggy days pick fresher');
  const amberReasons = c => rank(fragrances, { ...hotHumidDay, feelsF: 86, ...c }, 'day')
    .find(r => r.fragrance.name === 'Amber Empire').reasons.map(r => r.text);
  assert.ok(amberReasons({ dewF: 72 }).includes('Too rich for sticky heat'));
  assert.ok(amberReasons({ dewF: 48 }).includes('Heavy for this heat'));
});

test('a split from a few votes leans toward what the accords predict', () => {
  const amber = fragrances.find(f => f.name === 'Amber Empire');
  const summery = { winter: 0.1, spring: 0.2, summer: 0.6, fall: 0.1 };
  const few = { ...amber, season: summery, seasonVotes: { winter: 1, spring: 2, summer: 6, fall: 1 } };
  const many = { ...few, seasonVotes: { winter: 1000, spring: 2000, summer: 6000, fall: 1000 } };
  assert.ok(steadyShares(few).season.summer < 0.25, 'ten votes barely outweigh heavy amber accords');
  assert.ok(Math.abs(steadyShares(many).season.summer - 0.6) < 0.01, 'ten thousand votes stand');
  const shares = steadyShares(few);
  assert.ok(Math.abs(Object.values(shares.season).reduce((a, b) => a + b) - 1) < 1e-9);
  assert.ok(Math.abs(shares.dayNight.day + shares.dayNight.night - 1) < 1e-9);
  const estimated = { ...amber, seasonVotes: undefined, timeVotes: undefined };
  assert.equal(steadyShares(estimated).season, amber.season, 'unvoted records pass through');
});

test('flat votes read as none: the prediction decides, and reasons don’t call it voted', () => {
  // A Louis Vuitton page's pattern: one count on every season and both slots.
  const amber = fragrances.find(f => f.name === 'Amber Empire');
  const flat = { ...amber, seasonVotes: { winter: 765, spring: 765, summer: 765, fall: 765 }, timeVotes: { day: 765, night: 765 },
    season: { winter: 0.25, spring: 0.25, summer: 0.25, fall: 0.25 }, dayNight: { day: 0.5, night: 0.5 }, ratingVotes: 1481, original: undefined };
  assert.deepEqual(votedShares(flat), { season: false, time: false });
  const est = predictedShares(flat.accords, flat.like);
  for (const s of SEASONS) assert.ok(Math.abs(steadyShares(flat).season[s] - est.season[s]) < 1e-9, s);
  assert.ok(Math.abs(steadyShares(flat).dayNight.night - est.night) < 1e-9);
  const reasons = rank([flat], coldNight, 'night')[0].reasons.map(r => r.text);
  assert.ok(reasons.includes('A winter scent') && !reasons.some(t => t.startsWith('Voted') || t === 'Versatile across seasons'), reasons.join(' | '));
  // Even day and night votes stand while the seasons say something: half the raters ticking both is a bottle worn either way.
  const even = { ...amber, timeVotes: { day: 2400, night: 2400 }, dayNight: { day: 0.5, night: 0.5 } };
  assert.deepEqual(votedShares(even), { season: true, time: true });
  assert.ok(Math.abs(steadyShares(even).dayNight.night - 0.5) < 0.02);
});

test('a split from a few votes leans toward what voters say it smells like', () => {
  const amber = fragrances.find(f => f.name === 'Amber Empire');
  const few = { ...amber, seasonVotes: { winter: 3, spring: 2, summer: 2, fall: 3 }, timeVotes: { day: 5, night: 5 }, original: undefined };
  const beachy = { season: { winter: 0.05, spring: 0.25, summer: 0.6, fall: 0.1 }, night: 0.1 };
  const plain = steadyShares({ ...few, like: undefined }), liked = steadyShares({ ...few, like: beachy });
  assert.ok(liked.season.summer > plain.season.summer + 0.1, `${liked.season.summer} vs ${plain.season.summer}`);
  assert.ok(liked.dayNight.night < plain.dayNight.night - 0.1);
});

test("a dupe with few votes leans toward its original's", () => {
  const atlantis = fragrances.find(f => f.name === 'Atlantis Extrait');
  assert.equal(atlantis.original.name, 'Wavechild');
  const fallish = { winter: 0.2, spring: 0.2, summer: 0.2, fall: 0.4 };
  const few = { ...atlantis, season: fallish, seasonVotes: { winter: 4, spring: 4, summer: 4, fall: 8 }, dayNight: { day: 0.3, night: 0.7 }, timeVotes: { day: 3, night: 7 } };
  const alone = { ...few, original: undefined, like: undefined };
  assert.ok(steadyShares(few).season.summer > steadyShares(alone).season.summer + 0.1, 'Wavechild is a summer scent');
  assert.ok(steadyShares(few).dayNight.day > 0.7, 'and a day one');
  // Well-voted dupes keep their own split.
  const own = steadyShares(atlantis).season.summer;
  assert.ok(Math.abs(own - atlantis.season.summer) < 0.03, `${own} vs ${atlantis.season.summer}`);
});

test('seasonFit, written out season by season, scores as the loop it replaced', () => {
  const loop = (frag, weights) => {
    const { season } = steadyShares(frag);
    const peak = Math.max(...SEASONS.map(s => season[s])) || 1;
    const relative = SEASONS.reduce((sum, s) => sum + weights[s] * (season[s] / peak), 0);
    const lift = SEASONS.reduce((sum, s) => sum + weights[s] * season[s], 0) / 0.25;
    return 0.5 * relative + 0.5 * Math.min(1, Math.max(0, lift / 1.6));
  };
  const unvoted = fragrances.map(f => ({ ...f, seasonVotes: undefined, timeVotes: undefined }));
  let worst = 0, checked = 0;
  for (const month of ['01', '04', '07', '10']) {
    for (let feelsF = 0; feelsF <= 105; feelsF += 5) {
      for (const lat of [40, -33, 5]) {
        const weights = targetSeasonWeights(feelsF, new Date(`2026-${month}-15T12:00:00`), lat);
        for (const f of [...fragrances, ...unvoted]) {
          worst = Math.max(worst, Math.abs(seasonFit(f, weights) - loop(f, weights)));
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 10000);
  assert.ok(worst < 1e-12, `largest difference ${worst}`);
});

test('hot humid day: fresh scents on top, heavy ones at the bottom', () => {
  const tiers = groupTiers(rank(fragrances, hotHumidDay, 'day'));
  for (const n of names(tiers.S)) assert.ok(FRESH.includes(n), `${n} should not be S on a hot day`);
  for (const n of HEAVY) assert.ok(names(tiers.C).includes(n), `${n} should be C on a hot day`);
});

test('cold night: heavy scents on top, fresh ones at the bottom', () => {
  const tiers = groupTiers(rank(fragrances, coldNight, 'night'));
  const top = [...names(tiers.S), ...names(tiers.A)];
  for (const n of HEAVY) assert.ok(top.includes(n), `${n} should be S/A on a cold night`);
  for (const n of FRESH) assert.ok(names(tiers.C).includes(n), `${n} should be C on a cold night`);
});

test('comfort range: heavy scents open toward the cold, fresh ones toward the heat', () => {
  const byName = name => comfortRange(fragrances.find(f => f.name === name));
  const amber = byName('Amber Empire');
  assert.equal(amber.lowF, null);
  assert.ok(amber.highF >= 40 && amber.highF <= 58, `Amber Empire tops out at ${amber.highF}°F`);
  assert.equal(amber.bestF, null, 'no single best for an open range');
  const fresh = byName('Essence de Blanc');
  assert.equal(fresh.highF, null);
  assert.ok(fresh.lowF >= 68, `Essence de Blanc starts at ${fresh.lowF}°F`);
  const allRounder = byName('Sauvage');
  assert.ok(allRounder.lowF < 60 && allRounder.highF > 80, JSON.stringify(allRounder));
  assert.ok(allRounder.bestF > allRounder.lowF && allRounder.bestF < allRounder.highF);
  for (const f of fragrances) {
    const { lowF, highF } = comfortRange(f);
    assert.ok(lowF === null || highF === null || lowF < highF, f.name);
  }
});

test('tiers are 3 / 5 / 6 / rest', () => {
  const tiers = groupTiers(rank(fragrances, mildFallNight, 'night'));
  assert.deepEqual([tiers.S.length, tiers.A.length, tiers.B.length, tiers.C.length], [3, 5, 6, fragrances.length - 14]);
});

test('a bad fit isn\'t S just because the collection is small', () => {
  const heavy = fragrances.filter(f => HEAVY.includes(f.name)).slice(0, 4);
  const ranked = rank(heavy, hotHumidDay, 'day');
  assert.ok(ranked.every(r => r.tier !== 'S'), ranked.map(r => `${r.fragrance.name} ${r.tier} ${r.score.toFixed(2)}`).join(', '));
  assert.ok(ranked.every((r, i) => i === 0 || 'SABC'.indexOf(r.tier) >= 'SABC'.indexOf(ranked[i - 1].tier)), 'tiers still run in order');
});

test('a record without a rating ranks with a neutral quality, not NaN', () => {
  const stub = { ...fragrances[0], id: 'stub', rating: undefined, ratingVotes: undefined };
  const ranked = rank([stub, fragrances[1]], mildFallNight, 'night');
  assert.ok(ranked.every(r => Number.isFinite(r.score)));
  assert.equal(ranked.find(r => r.fragrance === stub).parts.quality, 0.5);
});

test('office avoids gourmands, date night prefers them', () => {
  const office = groupTiers(rank(fragrances, { ...mildFallNight, feelsF: 68 }, 'day', { occasion: occasionById('office') }));
  const date = groupTiers(rank(fragrances, mildFallNight, 'night', { occasion: occasionById('date') }));
  for (const n of ['Cream Velvet', 'Liquid Brun']) assert.ok(names(office.C).includes(n), `${n} should be C for office`);
  assert.ok(names(date.S).some(n => ['Amber Empire', 'Cream Velvet', 'Liquid Brun'].includes(n)));
});

test('office wants a quiet bottle and a night out a loud one', () => {
  const base = fragrances.find(f => f.name === 'Vintage Radio');
  const quiet = { ...base, id: 'quiet', parfumo: { ...base.parfumo, sillage: 6.2, votes: 500 } };
  const loud = { ...base, id: 'loud', parfumo: { ...base.parfumo, sillage: 8.6, votes: 500 } };
  const rest = fragrances.filter(f => f !== base);
  const place = (occasion, f) => rank([...rest, quiet, loud], mildFallNight, 'night', { occasion: occasionById(occasion) }).findIndex(r => r.fragrance === f);
  assert.ok(place('office', quiet) < place('office', loud));
  assert.ok(place('nightout', loud) < place('nightout', quiet));
  const reasons = (occasion, f) => rank([...rest, f], mildFallNight, 'night', { occasion: occasionById(occasion) })
    .find(r => r.fragrance === f).reasons.map(r => r.text);
  assert.ok(reasons('office', quiet).includes('Stays close to the skin'));
  assert.ok(reasons('office', loud).includes('Projects a lot for the office'));
  assert.ok(reasons('nightout', loud).includes('Projects across a room'));
  // Without Parfumo ratings a bottle sits in the middle.
  const unrated = { ...base, id: 'unrated', parfumo: undefined };
  assert.ok(!reasons('office', unrated).some(t => /skin|Projects/.test(t)));
});

test('office wants moderate projection that lasts the day, not a whisper that fades', () => {
  const office = occasionById('office');
  const base = fragrances.find(f => f.name === 'Cedrus Blanc');
  // Parfumo's 0–10: 6.2 sillage and 6.6 longevity read -1, 7.04 sillage -0.3, 7.8 longevity the middle.
  const at = (sillage, longevity) => occasionRaw({ ...base, parfumo: { sillage, longevity, votes: 1000 } }, office);
  const moderate = at(7.04, 7.8);
  assert.ok(moderate > at(6.2, 6.6) + 0.1, 'a body mist gone by lunch');
  assert.ok(moderate > at(8.6, 7.8), 'a loud one');
  assert.ok(moderate > at(6.2, 7.8) && at(6.2, 7.8) > at(8.6, 7.8), 'quieter than enough earns nothing more, and still beats loud');
  assert.ok(at(7.04, 8.8) > moderate, 'lasting longer helps');
  // The reason still says what it does.
  const reasons = rank([{ ...base, parfumo: { sillage: 6.2, longevity: 6.6, votes: 1000 } }], mildFallNight, 'day', { occasion: office })[0].reasons.map(r => r.text);
  assert.ok(reasons.includes('Stays close to the skin') && reasons.includes('Fades early'), reasons.join(' | '));
  // In David's wardrobe, nothing a fifth of a level louder than the middle (Sauvage and up) makes the office's
  // top 3, day or night, nor Jake, which fades by lunch.
  const loud = new Set(fragrances.filter(f => performanceLevel(f, 'sillage') >= 0.2).map(f => f.name));
  assert.ok(loud.has('Sauvage') && loud.size >= 5, [...loud].join(', '));
  for (const month of ['01', '04', '07', '10']) {
    for (const feelsF of [25, 45, 65, 85, 95]) {
      for (const slot of ['day', 'night']) {
        const dateISO = `2026-${month}-15`;
        const c = { feelsF, humidity: 60, dewF: Math.min(feelsF - 8, 72), category: 'clear', date: new Date(`${dateISO}T12:00:00`), dateISO, lat: 40 };
        const top = rank(fragrances, c, slot, { occasion: office }).slice(0, 3).map(r => r.fragrance.name);
        assert.ok(!top.some(n => loud.has(n) || n === 'Jake'), `${dateISO} ${slot} ${feelsF}: ${top.join(', ')}`);
      }
    }
  }
});

test('Parfumo occasion votes nudge a bottle toward what voters wear it for', () => {
  const base = fragrances.find(f => f.name === 'Liquid Brun');
  const night = occasionById('nightout'), office = occasionById('office');
  const vote = (occasion, n) => ({ ...base, parfumo: { ...base.parfumo, occasion, occasionVotes: n } });
  const clubbing = vote({ 'Night Out': 0.45, Evening: 0.3, Leisure: 0.15, Daily: 0.1 }, 1000);
  const deskbound = vote({ Business: 0.35, Daily: 0.35, Leisure: 0.2, 'Night Out': 0.1 }, 1000);
  assert.ok(votedOccasionFit(clubbing, night) > 0.1 && votedOccasionFit(deskbound, night) < -0.05);
  assert.ok(votedOccasionFit(deskbound, office) > 0.1);
  assert.ok(Math.abs(votedOccasionFit(vote(clubbing.parfumo.occasion, 3), night)) < 0.03, 'three votes barely count');
  assert.equal(votedOccasionFit(clubbing, occasionById('cozy')), 0, 'no Parfumo category for staying in');
  const [entry] = rank([clubbing], { feelsF: 60, humidity: 50, category: 'clear', date: new Date('2026-10-11T20:00:00'), lat: 40 }, 'night', { occasion: night });
  assert.ok(entry.reasons.some(r => r.text === 'Parfumo voters wear it for nights out'), entry.reasons.map(r => r.text).join(' | '));
});

test('the occasion fit reads on one scale, whatever the collection', () => {
  const office = occasionById('office');
  const part = (list, name) => rank(list, mildFallNight, 'day', { occasion: office }).find(r => r.fragrance.name === name).parts.occasion;
  const pair = fragrances.filter(f => ['Détour Noir', 'Supremacy Collector\'s Edition Pour Homme'].includes(f.name));
  // Two bottles used to read as 0 and 1, and one alone as 0.5.
  assert.equal(part(pair, 'Détour Noir'), part(fragrances, 'Détour Noir'));
  assert.ok(part(pair, 'Détour Noir') > 0 && part(pair, 'Détour Noir') < 1);
  assert.equal(part([pair[0]], pair[0].name), part(fragrances, pair[0].name));
  // Outdoors on a cold day is still about the weather: no summer citrus on top.
  const cold = { ...coldNight, feelsF: 30, dewF: 18 };
  const outdoors = rank(fragrances, cold, 'day', { occasion: occasionById('outdoors') });
  assert.ok(!['Essence de Blanc', 'Shiyaaka Sky', 'Jake'].includes(outdoors[0].fragrance.name), outdoors[0].fragrance.name);
});

test('bottles past the scale\'s top keep their order instead of tying at a perfect fit', () => {
  const office = occasionById('office');
  const xs = Array.from({ length: 81 }, (_, i) => -0.6 + i * 0.025); // raw fits well past both ends
  const parts = xs.map(x => occasionPart(x, office));
  for (let i = 1; i < parts.length; i++) assert.ok(parts[i] > parts[i - 1], `rises at ${xs[i]}`);
  assert.ok(parts[0] > 0 && parts.at(-1) < 1);
  // Parfumo's occasion votes carry several owned bottles past the dataset's
  // 98th percentile; at most one per occasion should read as near-perfect,
  // and only a few as above 0.9 (Office's wish to last, which few of the
  // dataset's fresh bottles do, once pressed eight of David's past it).
  for (const id of ['casual', 'office', 'date', 'nightout', 'formal', 'outdoors', 'cozy']) {
    const occasion = occasionById(id);
    const parts = fragrances.filter(f => String(f.id) !== '4310').map(f => occasionPart(occasionRaw(f, occasion), occasion));
    assert.ok(parts.filter(p => p >= 0.99).length <= 1, `${id}: ${parts.filter(p => p >= 0.99).length} near-perfect`);
    assert.ok(parts.filter(p => p > 0.9).length <= 6, `${id}: ${parts.filter(p => p > 0.9).length} above 0.9`);
    const top = parts.filter(p => p > 0.9);
    assert.equal(new Set(top).size, top.length, `${id}: no ties`);
  }
  // Amber Empire's date fit (accords and votes) beats Terra's; a hard cap tied them.
  const date = occasionById('date');
  const part = name => occasionPart(occasionRaw(fragrances.find(f => f.name === name), date), date);
  assert.ok(part('Amber Empire') > part('Terra'));
});

test('scoreOf is the score rank() orders by', () => {
  for (const occasion of [null, occasionById('date')]) {
    for (const r of rank(fragrances, mildFallNight, 'night', { occasion, history: [{ id: fragrances[0].id, date: '2026-09-27', slot: 'night' }], todayISO: '2026-09-28' })) {
      assert.equal(scoreOf(r.parts, occasion), r.score);
    }
  }
  const date = occasionById('date');
  assert.equal(occasionPart(occasionRaw(fragrances[0], date), date), rank([fragrances[0]], mildFallNight, 'night', { occasion: date })[0].parts.occasion);
});

test('formal favors iris and powder', () => {
  const formal = groupTiers(rank(fragrances, mildFallNight, 'night', { occasion: occasionById('formal') }));
  assert.ok(names(formal.S).includes('Meant To Be Seen'));
});

test('wearing something yesterday pushes it down today', () => {
  const base = rank(fragrances, mildFallNight, 'night');
  const top = base[0].fragrance;
  const history = [{ id: top.id, date: '2026-09-27', slot: 'night' }];
  const after = rank(fragrances, mildFallNight, 'night', { history, todayISO: '2026-09-28' });
  const moved = after.find(r => r.fragrance.id === top.id);
  assert.ok(moved.score < base[0].score);
  assert.ok(moved.reasons.some(r => r.text === 'Worn yesterday'));
});

test('a month of steady weather rotates through the wardrobe', () => {
  // Wear every Today pick for 28 days at 62°F by day and 54°F at night.
  let history = [];
  const worn = new Map();
  for (let i = 0; i < 28; i++) {
    const dateISO = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
    const date = new Date(`${dateISO}T12:00:00`);
    const windows = [
      { ...mildFallNight, feelsF: 62, dewF: 50, date, dateISO, slot: 'day' },
      { ...mildFallNight, feelsF: 54, dewF: 46, date, dateISO, slot: 'night' },
    ];
    for (const { win, pick } of planWindows(fragrances, windows, { history })) {
      history = [{ id: pick.fragrance.id, date: dateISO, slot: win.slot }, ...history];
      worn.set(pick.fragrance.name, (worn.get(pick.fragrance.name) ?? 0) + 1);
    }
  }
  assert.ok(worn.size >= 12, `only ${worn.size} bottles in 56 wears: ${[...worn].join(', ')}`);
  assert.ok(Math.max(...worn.values()) <= 10, 'no bottle takes over');
});

test('a wear lingers in the ranking for ten days, fading', () => {
  const top = rank(fragrances, mildFallNight, 'night')[0].fragrance;
  const after = days => rank(fragrances, mildFallNight, 'night', { history: [{ id: top.id, date: '2026-09-28', slot: 'night' }], todayISO: new Date(Date.UTC(2026, 8, 28 + days)).toISOString().slice(0, 10) })
    .find(r => r.fragrance === top);
  assert.ok(after(5).reasons.some(r => r.text === 'Worn 5 days ago'));
  assert.ok(after(1).parts.rotation > after(5).parts.rotation && after(5).parts.rotation > after(9).parts.rotation);
  assert.equal(after(10).parts.rotation, 0);
});

test('the pick you log for a slot is not penalized in that slot', () => {
  const history = [{ id: 1, date: '2026-09-28', slot: 'day' }];
  assert.equal(rotationPenalty(1, history, '2026-09-28', 'day').penalty, 0);
  assert.equal(rotationPenalty(1, history, '2026-09-28', 'night').penalty, 0.2);
});

test('summarize splits the forecast into day and night windows in local time', () => {
  const hours = [];
  for (const day of ['2026-09-28', '2026-09-29']) {
    for (let h = 0; h < 24; h++) hours.push(`${day}T${String(h).padStart(2, '0')}:00`);
  }
  const forecast = {
    latitude: 40,
    utc_offset_seconds: -4 * 3600,
    current: { temperature_2m: 70, apparent_temperature: 71, relative_humidity_2m: 50, weather_code: 0, cloud_cover: 5 },
    hourly: {
      time: hours,
      temperature_2m: hours.map(t => (+t.slice(11, 13) >= 19 ? 55 : 75)),
      apparent_temperature: hours.map(t => (+t.slice(11, 13) >= 19 ? 54 : 77)),
      relative_humidity_2m: hours.map(() => 50),
      weather_code: hours.map(t => (+t.slice(11, 13) >= 19 ? 61 : 1)),
      precipitation_probability: hours.map(t => (+t.slice(11, 13) >= 19 ? 70 : 5)),
    },
    daily: {
      time: ['2026-09-28', '2026-09-29'],
      sunrise: ['2026-09-28T06:50', '2026-09-29T06:51'],
      sunset: ['2026-09-28T18:45', '2026-09-29T18:43'],
      temperature_2m_max: [76, 74],
      temperature_2m_min: [54, 53],
    },
    fetchedAt: 0,
  };
  // 12:00 local (16:00 UTC)
  const wx = summarize(forecast, Date.parse('2026-09-28T16:00:00Z'));
  assert.equal(wx.todayISO, '2026-09-28');
  assert.equal(wx.day.label, 'Today');
  assert.equal(wx.day.feelsF, 77);
  assert.ok(Math.abs(wx.day.dewF - dewPointF(75, 50)) < 0.01, 'windows carry the dew point');
  assert.equal(wx.night.label, 'Tonight');
  assert.equal(wx.night.category, 'rain');
  assert.equal(wx.now.phase, 'day');

  // 20:00 local: daytime rolls to tomorrow, night is still tonight
  const evening = summarize(forecast, Date.parse('2026-09-29T00:00:00Z'));
  assert.equal(evening.day.label, 'Tomorrow');
  assert.equal(evening.day.dateISO, '2026-09-29');
  assert.equal(evening.night.label, 'Tonight');
  assert.equal(evening.now.phase, 'night');
});

test('week drops windows that have already ended today', () => {
  const forecast = syntheticForecast(7);
  // 20:00 local on the 28th: today's daytime is over, tonight is still ahead
  const days = week(forecast, Date.parse('2026-09-29T00:00:00Z'));
  assert.equal(days.length, 7);
  assert.equal(days[0].name, 'Today');
  assert.equal(days[0].day, null);
  assert.equal(days[0].night.label, 'Tonight');
  assert.equal(days[1].name, 'Tomorrow');
  assert.equal(days[1].night.label, 'Tomorrow night');
  assert.equal(days[2].day.label, 'Wednesday');
  assert.equal(days[6].dateISO, '2026-10-04');

  // Past 23:00 today has nothing left, so the week starts tomorrow.
  assert.equal(week(forecast, Date.parse('2026-09-29T03:30:00Z'))[0].name, 'Tomorrow');
});

test('week windows follow each day\'s weather', () => {
  const forecast = syntheticForecast(7, { hot: d => d === '2026-10-01' });
  const days = week(forecast, Date.parse('2026-09-28T13:00:00Z'));
  const hot = days.find(d => d.dateISO === '2026-10-01');
  assert.equal(hot.day.feelsF, 90);
  assert.equal(hot.hiF, 92);
  const plan = planWindows(fragrances, [hot.day], {});
  assert.ok(FRESH.includes(plan[0].pick.fragrance.name), `${plan[0].pick.fragrance.name} should be fresh on a hot day`);
});

test('a week plan rotates instead of repeating one bottle', () => {
  const windows = [];
  for (let i = 0; i < 7; i++) {
    const dateISO = `2026-10-${String(i + 1).padStart(2, '0')}`;
    const date = new Date(`${dateISO}T12:00:00`);
    windows.push({ ...mildFallNight, feelsF: 66, date, dateISO, slot: 'day' });
    windows.push({ ...mildFallNight, date, dateISO, slot: 'night' });
  }
  const plan = planWindows(fragrances, windows);
  const ids = plan.map(p => p.pick.fragrance.id);
  assert.ok(new Set(ids).size >= 10, `only ${new Set(ids).size} different bottles in 14 slots`);
  for (let i = 0; i < ids.length; i += 2) assert.notEqual(ids[i], ids[i + 1], 'same bottle day and night');
  for (const p of plan) assert.ok(p.pick.tier === 'S' || p.pick.tier === 'A', `${p.pick.fragrance.name} is only ${p.pick.tier}`);
  const night = plan[1].ranked.find(r => r.fragrance.id === ids[0]);
  assert.ok(night.reasons.some(r => r.text === 'Already picked for daytime'), 'planned picks are not reported as worn');
});

test('the only bottle, or one nothing else comes near, keeps its match on a repeat', () => {
  const dateISO = '2026-10-01', date = new Date(`${dateISO}T12:00:00`);
  const windows = [{ ...mildFallNight, feelsF: 66, date, dateISO, slot: 'day' }, { ...mildFallNight, date, dateISO, slot: 'night' }];
  const one = [fragrances.find(f => f.name === 'Sauvage')];
  const [, night] = planWindows(one, windows);
  assert.ok(!night.pick.reasons.some(r => /Already picked|Picked/.test(r.text)), night.pick.reasons.map(r => r.text).join('; '));
  assert.equal(night.pick.score, rank(one, windows[1], 'night', { todayISO: dateISO })[0].score);
  // With others close, the plan still turns to them, and a repeat further down says so.
  const plan = planWindows(fragrances, windows);
  assert.notEqual(plan[0].pick.fragrance.id, plan[1].pick.fragrance.id);
  assert.ok(plan[1].ranked.find(r => r.fragrance.id === plan[0].pick.fragrance.id).reasons.some(r => r.text === 'Already picked for daytime'));
  // A pick for the same date is the other slot's, named so: "that day" meant nothing on Now or Compare.
  assert.equal(restReason({ daysAgo: 0, planned: true }, 'day'), 'Already picked for nighttime');
  assert.equal(restReason({ daysAgo: 2, planned: true }, 'night'), 'Picked 2 days before');
  assert.equal(restReason({ daysAgo: 1, planned: false }, 'night'), 'Worn yesterday');
  assert.equal(restReason({ daysAgo: null, planned: false }, 'night'), null);
});

test('a logged wear stays the pick for its window', () => {
  const dateISO = '2026-09-28';
  const win = { ...mildFallNight, dateISO, slot: 'night' };
  const last = rank(fragrances, win, 'night').at(-1).fragrance;
  const [p] = planWindows(fragrances, [win], { history: [{ id: last.id, date: dateISO, slot: 'night' }] });
  assert.equal(p.pick.fragrance.id, last.id);
});
