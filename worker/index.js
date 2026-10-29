// Almanac API: a thin Cloudflare Worker in front of Fragella, which now
// only resolves the fg: ids in share links made before search moved to the
// Fragrantica dataset.
// - Keeps the Fragella key server-side.
// - Caches each bottle it looks up in KV, so a bottle costs one upstream
//   request and is then free for everyone. Entries expire after 30 days to
//   stay within Fragella's terms on storing data. An id Fragella doesn't have
//   is remembered as missing for a week, so a bad link doesn't ask again.
// - Fragella's free plan is 20 requests a month: a call asks upstream for at
//   most MAX_UPSTREAM_PER_CALL ids, an IP for DAILY_LOOKUPS_PER_IP a day and
//   everyone together for DAILY_LOOKUPS a day, so one visitor (or a crafted
//   link) can't spend the month.
//
// GET /fragrances?ids=fg:a,... -> { records: [record], missing: [id] }
import { fromFragella, isFragellaId, fragellaSlug } from '../src/fragella.js';

const DEFAULT_BASE = 'https://api.fragella.com/api/v1';
const RECORD_TTL = 30 * 86400;
const MISS_TTL = 7 * 86400;
const MAX_IDS = 80;
const MAX_UPSTREAM_PER_CALL = 3;
const PER_IP = 3;
const PER_DAY = 4;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const headers = { Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors },
  });
}

// One upstream lookup, if the day's budgets allow: this IP's and everyone's.
async function spendLookup(request, env) {
  const day = new Date().toISOString().slice(0, 10);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  const [mine, all] = [`rl:${day}:${ip}`, `rl:${day}`];
  const [usedMine, usedAll] = (await Promise.all([env.CACHE.get(mine), env.CACHE.get(all)])).map(n => Number(n) || 0);
  if (usedMine >= (Number(env.DAILY_LOOKUPS_PER_IP) || PER_IP) || usedAll >= (Number(env.DAILY_LOOKUPS) || PER_DAY)) {
    throw new ApiError(429, 'rate_limited', 'Daily lookup limit reached. Bottles already found still work; try new ones tomorrow.');
  }
  await Promise.all([
    env.CACHE.put(mine, String(usedMine + 1), { expirationTtl: 2 * 86400 }),
    env.CACHE.put(all, String(usedAll + 1), { expirationTtl: 2 * 86400 }),
  ]);
}

async function upstream(env, path) {
  const res = await fetch(`${env.FRAGELLA_BASE || DEFAULT_BASE}${path}`, { headers: { 'x-api-key': env.FRAGELLA_KEY } });
  if (res.status === 404) return null;
  if (res.status === 429) throw new ApiError(429, 'quota', 'This month’s lookup budget is used up. Bottles already found still work.');
  if (!res.ok) throw new ApiError(502, 'upstream', `Fragrance lookup failed (${res.status}).`);
  return res.json();
}

const readRecords = (env, ids) => Promise.all(ids.map(id => env.CACHE.get(`f:${id}`, 'json')));
const writeRecord = (env, record) => env.CACHE.put(`f:${record.id}`, JSON.stringify(record), { expirationTtl: RECORD_TTL });

async function byIds(url, request, env) {
  const ids = [...new Set(String(url.searchParams.get('ids') ?? '').split(',').map(s => s.trim()).filter(isFragellaId))].slice(0, MAX_IDS);
  const cached = await readRecords(env, ids);
  const found = new Map(cached.filter(Boolean).map(r => [r.id, r]));

  // Ids Fragella turned down lately aren't asked again.
  const unknown = ids.filter(id => !found.has(id));
  const missed = await Promise.all(unknown.map(id => env.CACHE.get(`m:${id}`)));
  // Out of budget (ours or Fragella's), the rest come back missing.
  for (const id of unknown.filter((_, i) => !missed[i]).slice(0, MAX_UPSTREAM_PER_CALL)) {
    let data;
    try {
      await spendLookup(request, env);
      data = await upstream(env, `/fragrances/${encodeURIComponent(fragellaSlug(id))}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) break;
      throw err;
    }
    const raw = Array.isArray(data) ? data[0] : data;
    if (!raw?._id) {
      await env.CACHE.put(`m:${id}`, '1', { expirationTtl: MISS_TTL });
      continue;
    }
    const record = { ...fromFragella(raw), id };
    await writeRecord(env, record);
    found.set(id, record);
  }

  return { records: ids.map(id => found.get(id)).filter(Boolean), missing: ids.filter(id => !found.has(id)) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get('Origin'), env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'method', message: 'GET only.' }, 405, cors);
    try {
      if (url.pathname === '/fragrances') return json(await byIds(url, request, env), 200, cors);
      if (url.pathname === '/') return json({ ok: true, service: 'scentcast-api' }, 200, cors);
      return json({ error: 'not_found', message: 'Unknown route.' }, 404, cors);
    } catch (err) {
      if (err instanceof ApiError) return json({ error: err.code, message: err.message }, err.status, cors);
      return json({ error: 'server', message: 'Something went wrong.' }, 500, cors);
    }
  },
};
