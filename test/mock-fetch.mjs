// Loaded with `node --import` by test/recommend.test.js: Open-Meteo answers
// from the synthetic forecast (starting yesterday, so "now" falls inside it),
// its archive with the same synthetic weather for the dates asked, and the
// city search finds one place. Anything else, or everything with
// MOCK_OFFLINE set, fails like no network.
import { syntheticForecast } from './fixtures.js';

const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
globalThis.fetch = async url => {
  const u = String(url);
  if (process.env.MOCK_OFFLINE) throw new TypeError('fetch failed');
  const json = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  if (u.startsWith('https://api.open-meteo.com/v1/forecast')) return json(syntheticForecast(8, { start: yesterday }));
  if (u.startsWith('https://archive-api.open-meteo.com/v1/archive')) {
    const q = new URL(u).searchParams;
    const days = Math.round((Date.parse(q.get('end_date')) - Date.parse(q.get('start_date'))) / 86_400_000) + 1;
    return json(syntheticForecast(days, { start: q.get('start_date') }));
  }
  if (u.startsWith('https://geocoding-api.open-meteo.com/')) {
    return json({ results: [{ name: 'Testville', admin1: 'Test State', country: 'US', latitude: 40.7, longitude: -74 }] });
  }
  throw new TypeError('fetch failed');
};
