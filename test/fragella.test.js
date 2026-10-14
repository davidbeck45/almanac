import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fromFragella, cleanName } from '../src/fragella.js';
import worker from '../worker/index.js';

// Synthetic records in Fragella's documented shape (real responses stay out of
// the repo per Fragella's terms).
function raw(id, name, brand, { accords, seasons, gender = 'men', popularity = 'High' }) {
  return {
    _id: id,
    Name: name,
    Brand: brand,
    Year: '2020',
    rating: '4.20',
    Gender: gender,
    Popularity: popularity,
    Longevity: 'Long Lasting',
    Sillage: 'Moderate',
    'Image URL Transparent': `https://cdn.example/${id}.webp`,
    'Main Accords': Object.keys(accords),
    'Main Accords Percentage': accords,
    'Season Ranking': Object.entries(seasons).map(([n, score]) => ({ name: n, score })),
    'Occasion Ranking': [{ name: 'casual', score: 1 }],
    Notes: { Top: [{ name: 'Bergamot' }], Middle: [{ name: 'Lavender' }], Base: [{ name: 'Vanilla' }] },
  };
}
const GOURMAND = raw('Test-Brand-Warm-One', 'Test Brand Warm One', 'Test Brand', {
  accords: { vanilla: 'Dominant', amber: 'Prominent', 'warm spicy': 'Moderate' },
  seasons: { winter: 2.4, fall: 1.8, spring: 0, summer: 0 },
});
const FRESH = raw('Test-Brand-Cool-One', 'Cool One for men', 'Test Brand', {
  accords: { citrus: 'Dominant', aquatic: 'Prominent', green: 'Subtle' },
  seasons: { summer: 3, spring: 2, fall: 0, winter: 0 },
});

test('adapter maps Fragella fields to the engine shape', () => {
  const r = fromFragella(GOURMAND);
  assert.equal(r.id, 'fg:Test-Brand-Warm-One');
  assert.equal(r.name, 'Warm One');
  assert.deepEqual(Object.keys(r.accords), ['vanilla', 'amber', 'warm spicy']);
  assert.equal(r.accords.vanilla, 100);
  assert.ok(Math.abs(Object.values(r.season).reduce((a, b) => a + b) - 1) < 0.01);
  assert.ok(r.season.summer > 0, 'zero season scores are smoothed, not zero');
  assert.ok(r.season.winter > r.season.summer);
  assert.deepEqual(r.notes, { top: ['Bergamot'], mid: ['Lavender'], base: ['Vanilla'] });
  assert.equal(r.longevity, 'Long Lasting');
});

test('heavy scents lean night, fresh ones lean day', () => {
  assert.ok(fromFragella(GOURMAND).dayNight.night > 0.55);
  assert.ok(fromFragella(FRESH).dayNight.night < 0.45);
});

test('cleanName strips brand prefixes and gender suffixes', () => {
  assert.equal(cleanName('Dior Sauvage', 'Christian Dior'), 'Sauvage');
  assert.equal(cleanName('French Avenue Liquid Brun', 'French Avenue'), 'Liquid Brun');
  assert.equal(cleanName('Cool One for men', 'Test Brand'), 'Cool One');
  assert.equal(cleanName('Terra', 'Rayhaan'), 'Terra');
});

// ---------- Worker ----------

let store, upstreamCalls, upstreamStatus;
const kv = {
  get: async (k, type) => (store.has(k) ? (type === 'json' ? JSON.parse(store.get(k)) : store.get(k)) : null),
  put: async (k, v) => { store.set(k, v); },
};
const env = { CACHE: kv, FRAGELLA_KEY: 'test', FRAGELLA_BASE: 'https://up.test/api/v1', ALLOWED_ORIGINS: 'https://app.test', DAILY_LOOKUPS_PER_IP: '3', DAILY_LOOKUPS: '4' };
const get = (path, headers = {}) => worker.fetch(new Request(`https://api.test${path}`, { headers: { 'CF-Connecting-IP': '1.2.3.4', ...headers } }), env);

beforeEach(() => {
  store = new Map();
  upstreamCalls = [];
  upstreamStatus = 200;
  globalThis.fetch = async url => {
    upstreamCalls.push(String(url));
    if (upstreamStatus !== 200) return new Response('{}', { status: upstreamStatus });
    const u = new URL(url);
    if (u.pathname.endsWith('/fragrances')) return Response.json([GOURMAND, FRESH]);
    const slug = decodeURIComponent(u.pathname.split('/').pop());
    return slug === FRESH._id ? Response.json(FRESH) : new Response('{}', { status: 404 });
  };
});

test('lookup by id serves cached bottles and fetches only the missing ones, a few a call', async () => {
  const first = await (await get('/fragrances?ids=fg:Test-Brand-Cool-One,31861')).json();
  assert.deepEqual([first.records.map(r => r.id), first.missing], [['fg:Test-Brand-Cool-One'], []]);
  const again = await (await get('/fragrances?ids=fg:Test-Brand-Cool-One')).json();
  assert.deepEqual(again.records.map(r => r.id), ['fg:Test-Brand-Cool-One']);
  assert.equal(upstreamCalls.length, 1, 'a found bottle is free after');
  // A crafted link with ten made-up ids asks upstream for three, and the misses are remembered.
  const nope = Array.from({ length: 10 }, (_, i) => `fg:nope${i}`).join(',');
  const body = await (await get(`/fragrances?ids=${nope}`, { 'CF-Connecting-IP': '5.6.7.8' })).json();
  assert.equal(body.missing.length, 10);
  assert.equal(upstreamCalls.length, 4);
  await get(`/fragrances?ids=fg:nope0,fg:nope1,fg:nope2`, { 'CF-Connecting-IP': '9.9.9.9' });
  assert.equal(upstreamCalls.length, 4, 'a miss isn’t asked again');
});

test('upstream lookups are capped per IP and for everyone, per day', async () => {
  const ask = (n, ip) => get(`/fragrances?ids=fg:x${n}`, { 'CF-Connecting-IP': ip });
  for (let n = 0; n < 3; n++) await ask(n, '1.1.1.1');
  assert.equal(upstreamCalls.length, 3);
  assert.deepEqual((await (await ask(3, '1.1.1.1')).json()).missing, ['fg:x3'], 'past its share, an IP gets the rest as missing');
  assert.equal(upstreamCalls.length, 3);
  await ask(4, '2.2.2.2');
  assert.equal(upstreamCalls.length, 4);
  await ask(5, '3.3.3.3');
  assert.equal(upstreamCalls.length, 4, 'and everyone together stop at the day’s budget');
});

test('an exhausted Fragella quota leaves the rest missing, without an error', async () => {
  upstreamStatus = 429;
  const res = await get('/fragrances?ids=fg:Test-Brand-Cool-One');
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).missing, ['fg:Test-Brand-Cool-One']);
});

test('search is gone: nothing in the app asks for it', async () => {
  assert.equal((await get('/search?q=sauvage')).status, 404);
  assert.equal(upstreamCalls.length, 0);
});

test('CORS allows only configured origins', async () => {
  assert.equal((await get('/', { Origin: 'https://app.test' })).headers.get('Access-Control-Allow-Origin'), 'https://app.test');
  assert.equal((await get('/', { Origin: 'https://evil.test' })).headers.get('Access-Control-Allow-Origin'), null);
});
