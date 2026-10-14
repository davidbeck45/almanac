// Formatting shared by every template (src/ui/components.js, src/views/) and
// the Omarchy widget: escaping, units, dates, match percentages and the order
// reasons read in. Pure; imports cleanly in Node.
import { WINDOWS } from './weather.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Temperatures stay in °F everywhere else; only display converts.
let units = 'F';
export const setUnits = u => { units = u === 'C' ? 'C' : 'F'; };
export const unitsNow = () => units;
export const temp = f => Math.round(units === 'C' ? ((f - 32) * 5) / 9 : f);
export const deg = f => `${temp(f)}°`;

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
export const cap = t => t.charAt(0).toUpperCase() + t.slice(1);

const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const WEEKDAY_SHORT = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
const utcDate = iso => new Date(`${iso}T12:00:00Z`);
export const shortDate = iso => MONTH_DAY.format(utcDate(iso));
export const weekdayShort = iso => WEEKDAY_SHORT.format(utcDate(iso));

export function relativeDay(iso, todayISO) {
  const days = Math.round((Date.parse(todayISO) - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return shortDate(iso);
}

export const matchPct = entry => Math.max(1, Math.min(99, Math.round(entry.score * 100)));

// Good reasons first for a bottle that ranks well, the catch first for one
// that doesn't.
export function displayReasons(entry, n) {
  const good = entry.reasons.filter(r => r.tone === 'good');
  const bad = entry.reasons.filter(r => r.tone === 'bad');
  const ordered = entry.tier === 'S' || entry.tier === 'A' ? [...good, ...bad] : [...bad, ...good];
  return ordered.slice(0, n);
}

// "10a–5p", or "Now–5p" once today's window is under way.
export function windowRange(win, nowHour) {
  const [start, end] = WINDOWS[win.slot];
  const fmt = h => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);
  const today = win.label === 'Today' || win.label === 'Tonight';
  return `${today && nowHour > start ? 'Now' : fmt(start)}–${fmt(end)}`;
}

// Words for how a window feels beyond its temperature.
export function feelWords(win) {
  const words = [];
  if (win.feelsF >= 65 && win.dewF >= 65) words.push('muggy');
  else if (win.feelsF >= 65 && win.dewF >= 60) words.push('humid');
  else if (win.humidity < 35) words.push('dry');
  if (win.pop >= 30) words.push(`${win.pop}% rain`);
  return words;
}
