// Client for the Almanac API (worker/), which resolves the Fragella bottles
// in share links made before search moved to the Fragrantica dataset.
// DEPLOYED is the workers.dev URL printed by `npx wrangler deploy`.
const DEPLOYED = 'https://scentcast-api.davidbeck45.workers.dev';
const LOCAL = ['127.0.0.1', 'localhost'].includes(location.hostname);

export const API_BASE = LOCAL ? 'http://127.0.0.1:8787' : DEPLOYED;

async function call(path) {
  let res;
  try {
    res = await fetch(API_BASE + path);
  } catch {
    throw new Error('Can’t reach the Almanac API. Check your connection.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message || `Lookup failed (${res.status}).`), { code: body.error });
  return body;
}

export const fetchFragrances = ids => (ids.length
  ? call(`/fragrances?ids=${ids.map(encodeURIComponent).join(',')}`)
  : Promise.resolve({ records: [], missing: [] }));
