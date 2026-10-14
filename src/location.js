const KEY = 'scentcast.location';
const RECENT_KEY = 'scentcast.recentLocations';
const MAX_RECENT = 5;

// A stored place, kept only with coordinates.
const isPlace = loc => Number.isFinite(loc?.lat) && Number.isFinite(loc?.lon);

export function loadLocation() {
  try {
    const loc = JSON.parse(localStorage.getItem(KEY));
    return isPlace(loc) ? loc : null;
  } catch {
    return null;
  }
}

export function saveLocation(loc) {
  try { localStorage.setItem(KEY, JSON.stringify(loc)); } catch {}
  if (!loc.device) saveRecent(loc);
}

const sameSpot = (a, b) => Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;

export function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(list) ? list.filter(isPlace) : [];
  } catch {
    return [];
  }
}

function saveRecent(loc) {
  const next = [loc, ...loadRecent().filter(r => !sameSpot(r, loc))].slice(0, MAX_RECENT);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
}

export function deviceLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser can’t share location.'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ name: 'My location', lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3), device: true }),
      e => reject(new Error(e.code === 1 ? 'Location permission was denied.' : 'Couldn’t get your location.')),
      { timeout: 10_000, maximumAge: 30 * 60 * 1000 },
    );
  });
}

export async function searchCities(query) {
  const params = new URLSearchParams({ name: query, count: 6, language: 'en', format: 'json' });
  let res;
  try {
    res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  } catch {
    throw new Error('Can’t reach city search. Check your connection.');
  }
  if (!res.ok) throw new Error('City search isn’t answering. Try again in a minute.');
  const data = await res.json();
  return (data.results ?? []).map(r => ({
    name: r.name,
    region: [r.admin1, r.country_code].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}
