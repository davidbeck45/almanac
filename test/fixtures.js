// Open-Meteo-shaped forecast from 2026-09-28 (or `start`), local time UTC-4:
// 72°F by day, 55°F from 19:00, and 90°F on days where `hot` is true.
export function syntheticForecast(days, { hot = () => false, start = '2026-09-28' } = {}) {
  const from = Date.parse(`${start}T00:00:00Z`);
  const dates = Array.from({ length: days }, (_, i) => new Date(from + i * 86_400_000).toISOString().slice(0, 10));
  const hours = dates.flatMap(day => Array.from({ length: 24 }, (_, h) => `${day}T${String(h).padStart(2, '0')}:00`));
  const temp = t => (hot(t.slice(0, 10)) ? 90 : +t.slice(11, 13) >= 19 ? 55 : 72);
  return {
    latitude: 40,
    utc_offset_seconds: -4 * 3600,
    current: { temperature_2m: 70, apparent_temperature: 71, relative_humidity_2m: 50, weather_code: 0, cloud_cover: 5 },
    hourly: {
      time: hours,
      temperature_2m: hours.map(temp),
      apparent_temperature: hours.map(temp),
      relative_humidity_2m: hours.map(() => 55),
      weather_code: hours.map(() => 1),
      precipitation_probability: hours.map(() => 10),
    },
    daily: {
      time: dates,
      sunrise: dates.map(d => `${d}T06:50`),
      sunset: dates.map(d => `${d}T18:45`),
      temperature_2m_max: dates.map(d => (hot(d) ? 92 : 74)),
      temperature_2m_min: dates.map(() => 54),
    },
    fetchedAt: 0,
  };
}
