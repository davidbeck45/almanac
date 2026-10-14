// WMO weather interpretation codes, as returned by Open-Meteo, and the dew
// point. Tiny on purpose: the forecast loads before the rest of the app
// (src/app/early.js), and weather.js needs nothing heavier.
const CODES = {
  0: ['Clear', 'clear'],
  1: ['Mostly clear', 'clear'],
  2: ['Partly cloudy', 'partly'],
  3: ['Overcast', 'cloudy'],
  45: ['Fog', 'fog'],
  48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'drizzle'],
  53: ['Drizzle', 'drizzle'],
  55: ['Heavy drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'drizzle'],
  57: ['Freezing drizzle', 'drizzle'],
  61: ['Light rain', 'rain'],
  63: ['Rain', 'rain'],
  65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'],
  67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'],
  73: ['Snow', 'snow'],
  75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'],
  80: ['Rain showers', 'rain'],
  81: ['Rain showers', 'rain'],
  82: ['Violent showers', 'rain'],
  85: ['Snow showers', 'snow'],
  86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorm', 'storm'],
  96: ['Thunderstorm, hail', 'storm'],
  99: ['Thunderstorm, hail', 'storm'],
};

// Most severe last; used to pick a window's headline condition.
export const SEVERITY = ['clear', 'partly', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'storm'];

export function describe(code) {
  const [label, category] = CODES[code] ?? ['Unknown', 'cloudy'];
  return { code, label, category };
}

export const isWet = category => category === 'drizzle' || category === 'rain' || category === 'storm';

// Dew point (°F) from temperature (°F) and relative humidity (%), Magnus formula.
export function dewPointF(tempF, humidity) {
  const c = ((tempF - 32) * 5) / 9;
  const g = Math.log(Math.min(100, Math.max(1, humidity)) / 100) + (17.62 * c) / (243.12 + c);
  return ((243.12 * g) / (17.62 - g)) * 9 / 5 + 32;
}
