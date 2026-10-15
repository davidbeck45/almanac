// Loaded with `node --import` by test/recommend.test.js: Open-Meteo answers
// from the synthetic forecast (starting yesterday, so "now" falls inside it),
// its archive with the same synthetic weather for the dates asked, and the
// city search finds one place. Anything else, or everything with
// MOCK_OFFLINE set, fails like no network; MOCK_FORECAST_STATUS=429 turns
// the forecast API down with that status, as when the day's quota is spent
// (MOCK_ARCHIVE_STATUS the archive; MOCK_REASON is the reason the answer
// gives, as Open-Meteo's do). MOCK_UTC_OFFSET (hours) puts the place in
// another time zone: its forecast starts on the place's own date.
import { syntheticForecast } from './fixtures.js';

const offset = Number(process.env.MOCK_UTC_OFFSET ?? -4) * 3600;
const yesterday = new Date(Date.now() + offset * 1000 - 86_400_000).toISOString().slice(0, 10);
globalThis.fetch = async url => {
  const u = String(url);
  if (process.env.MOCK_OFFLINE) throw new TypeError('fetch failed');
  const json = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const refuse = status => {
    const body = { error: true, ...(process.env.MOCK_REASON && { reason: process.env.MOCK_REASON }) };
    return { ok: false, status: Number(status), json: async () => body, text: async () => JSON.stringify(body) };
  };
  if (u.startsWith('https://api.open-meteo.com/v1/forecast') && process.env.MOCK_FORECAST_STATUS) return refuse(process.env.MOCK_FORECAST_STATUS);
  if (u.startsWith('https://archive-api.open-meteo.com/v1/archive') && process.env.MOCK_ARCHIVE_STATUS) return refuse(process.env.MOCK_ARCHIVE_STATUS);
  if (u.startsWith('https://api.open-meteo.com/v1/forecast')) return json({ ...syntheticForecast(8, { start: yesterday }), utc_offset_seconds: offset });
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
