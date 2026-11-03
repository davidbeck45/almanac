// What main.js starts before the rest of the app has loaded: the place
// (pinned by ?loc=, else the saved one) and, unless the saved forecast is
// fresh, its forecast, already on its way while the app's modules download
// and run. Small on purpose: it imports weather.js, wmo.js and location.js
// and nothing else, so the request goes out first thing.
import { getForecast, cachedForecast } from '../weather.js';
import { loadLocation } from '../location.js';

// ?loc=lat,lon,Name pins a location, e.g. for a home-screen shortcut per city.
export function locationFromURL(params) {
  const raw = params.get('loc');
  if (!raw) return null;
  const [lat, lon, ...name] = raw.split(',');
  if (!Number.isFinite(+lat) || !Number.isFinite(+lon)) return null;
  return { name: name.join(',').trim() || 'Pinned location', lat: +lat, lon: +lon };
}

/** The forecast asked for now, as boot's `early`: { loc, forecast } (a promise), or null when the saved one will do. */
export function startForecast(search = globalThis.location?.search ?? '') {
  const loc = locationFromURL(new URLSearchParams(search)) ?? loadLocation();
  if (!loc || cachedForecast(loc)?.fresh) return null;
  const forecast = getForecast(loc);
  forecast.catch(() => {}); // the shell's refreshWeather hears it
  return { loc, forecast };
}
