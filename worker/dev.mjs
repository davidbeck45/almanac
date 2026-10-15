// Run the Worker locally on Node: http://127.0.0.1:8787 (PORT=… for another)
//   node worker/dev.mjs          real Fragella (spends quota), key from worker/.dev.vars;
//                                a lookup budget of 50 a day for the IP, the deployed 4 for everyone
//   MOCK=1 node worker/dev.mjs   answers from saved responses in .cache/fragella (no quota, 50 a day)
// DAILY_LOOKUPS_PER_IP and DAILY_LOOKUPS set the budgets. KV is in memory and resets on restart.
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import worker from './index.js';

const root = new URL('..', import.meta.url);
const vars = Object.fromEntries(
  (existsSync(new URL('worker/.dev.vars', root)) ? readFileSync(new URL('worker/.dev.vars', root), 'utf8') : '')
    .split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const store = new Map();
const kv = {
  async get(key, type) {
    const hit = store.get(key);
    if (!hit || (hit.expires && hit.expires < Date.now())) return null;
    return type === 'json' ? JSON.parse(hit.value) : hit.value;
  },
  async put(key, value, opts = {}) {
    store.set(key, { value, expires: opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null });
  },
};

if (process.env.MOCK) {
  const dir = new URL('.cache/fragella/', root);
  const saved = {};
  for (const f of existsSync(dir) ? readdirSync(dir) : []) for (const x of JSON.parse(readFileSync(new URL(f, dir)))) saved[x._id] = x;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname !== 'mock.fragella') return realFetch(input, init);
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const byId = url.pathname.match(/\/fragrances\/(.+)$/);
    if (byId) return saved[decodeURIComponent(byId[1])] ? reply(saved[decodeURIComponent(byId[1])]) : reply({ error: 'Not found' }, 404);
    const words = (url.searchParams.get('search') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const hits = Object.values(saved).filter(x => words.every(w => `${x.Name} ${x.Brand}`.toLowerCase().includes(w)));
    return hits.length ? reply(hits.slice(0, +url.searchParams.get('limit') || 5)) : reply({ error: 'Not found' }, 404);
  };
  console.log(`mock upstream: ${Object.keys(saved).length} saved fragrances`);
}

const env = {
  ...vars,
  CACHE: kv,
  ALLOWED_ORIGINS: 'http://127.0.0.1:5173,http://localhost:5173',
  DAILY_LOOKUPS_PER_IP: process.env.DAILY_LOOKUPS_PER_IP ?? '50',
  // Everyone's budget guards the real quota (unset, the deployed default);
  // mocked, there's none to guard.
  ...(process.env.DAILY_LOOKUPS || process.env.MOCK ? { DAILY_LOOKUPS: process.env.DAILY_LOOKUPS || '50' } : {}),
  ...(process.env.MOCK ? { FRAGELLA_BASE: 'http://mock.fragella/api/v1' } : {}),
};
const port = Number(process.env.PORT) || 8787;

createServer(async (req, res) => {
  const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers });
  const response = await worker.fetch(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
}).listen(port, '127.0.0.1', () => console.log(`scentcast-api on http://127.0.0.1:${port}`));
