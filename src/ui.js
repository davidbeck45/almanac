// Formatting shared by every template (src/ui/components.js, src/views/) and
// the Omarchy widget: escaping, units, dates, match percentages and the order
// reasons read in. Pure; imports cleanly in Node.
import { WINDOWS } from './weather.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Temperatures stay in °F everywhere else; only display converts.
let units = 'F';
export const setUnits = u => { units = u === 'C' ? 'C' : 'F'; };
export const temp = f => Math.round(units === 'C' ? ((f - 32) * 5) / 9 : f);
export const deg = f => `${temp(f)}°`;

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
export const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
// An accord's key as a label: "Fresh spicy", "Champagne" (the data keeps its keys).
export const accordLabel = a => a.charAt(0).toUpperCase() + a.slice(1).toLowerCase();

// ---------- What voters say, in the same words on every screen ----------

/**
 * Voters' value for money (1–5) in words, or null: Great from 3.8, where
 * "Prefer great value" draws its line (PREFER_VALUE in src/candidates.js,
 * test/ui.test.js keeps them together), Good from 3.4, Fair price from 2.4
 * (about the pool's bottom tenth is under it), else Pricey.
 */
export function valueWord(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return value >= 3.8 ? 'Great value' : value >= 3.4 ? 'Good value' : value >= 2.4 ? 'Fair price' : 'Pricey';
}

/**
 * A blind buy's risk in one word, or null with no crowd data: Risky (high),
 * Some risk (medium), and a low risk a Safe bet from the 50th safety
 * percentile (safer than half the pool's popular bottles), else a Fair bet.
 */
export function riskWord(level, safe = null) {
  if (level === 'high') return 'Risky';
  if (level === 'medium') return 'Some risk';
  if (level === 'low') return safe != null && safe >= 50 ? 'Safe bet' : 'Fair bet';
  return null;
}

/** "★ 4.49 · 10,377 votes" ("★ 4.49" without votes), or null without a rating. */
export function ratingMark(rating, votes = 0) {
  if (!(rating > 0)) return null;
  const n = Number(votes) || 0;
  return `★ ${rating.toFixed(2)}${n ? ` · ${n.toLocaleString('en-US')} ${n === 1 ? 'vote' : 'votes'}` : ''}`;
}

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
