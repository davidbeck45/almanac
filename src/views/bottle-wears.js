// The bottle page's "Your wears" (order 280), for a bottle you own or have
// in Mine: your own history with it, from the wear journal (src/history.js),
// so the page answers "when do I actually reach for this?". The count over
// the last twelve calendar months with a bar a month, by day and by night,
// what it was logged for, the feels-like you've worn it in (from the wears
// stamped with their window's weather) and how often it was the pick its
// list showed. Nothing for a bottle never worn, and one wear is a sentence.
import { occasionById } from '../occasions.js';
import { esc, temp, deg, plural, shortDate, relativeDay } from '../ui.js';
import { addSection } from './bottle.js';
import { state } from '../app/state.js';

/** Stamped wears it takes before the feels-like range, or the pick's share, says anything. */
export const ENOUGH_WEARS = 3;

/**
 * One bottle's wears, read from the journal up to `todayISO`: null when it
 * has none, else
 *   count: wears in the twelve calendar months ending with today's (the
 *     ones `months`, `day`, `night`, `uses`, `felt` and `picked` read),
 *   first, latest: its earliest and newest wear in the whole log; since:
 *     the first when those twelve months hold it (null when it's older),
 *   months: [{ month: 'YYYY-MM', wears }], twelve, oldest first,
 *   day, night: wears in each,
 *   uses: [{ id, label, phrase, wears }], most first, for the wears that
 *     recorded a use ('daily' or an occasion the app has; untagged ones,
 *     logged before uses were recorded or from Worn's calendar, left out),
 *   felt: { lowF, highF, wears } over the wears stamped with their window's
 *     weather (wearStamp's `wx`), null without one,
 *   picked: { wears, of }: how often it was the pick its list showed, over
 *     the wears that recorded a pick, null without one.
 */
export function bottleWears(history, id, todayISO) {
  const key = String(id);
  const all = (history ?? []).filter(h => String(h.id) === key && !h.planned && h.date <= todayISO);
  if (!all.length) return null;
  const months = [];
  let [y, mo] = todayISO.split('-').map(Number);
  for (let i = 0; i < 12; i++) {
    months.unshift({ month: `${y}-${String(mo).padStart(2, '0')}`, wears: 0 });
    if (--mo === 0) { mo = 12; y--; }
  }
  const byMonth = new Map(months.map(m => [m.month, m]));
  const year = all.filter(h => byMonth.has(h.date.slice(0, 7)));
  const uses = new Map();
  let felt = null, picked = null;
  for (const h of year) {
    byMonth.get(h.date.slice(0, 7)).wears++;
    const use = h.occasion === 'daily' ? { label: 'Daily', phrase: 'a daily pick' } : occasionById(h.occasion);
    if (use) uses.set(h.occasion, { id: h.occasion, label: use.label, phrase: use.phrase, wears: (uses.get(h.occasion)?.wears ?? 0) + 1 });
    if (Number.isFinite(h.wx?.f)) {
      felt = felt
        ? { lowF: Math.min(felt.lowF, h.wx.f), highF: Math.max(felt.highF, h.wx.f), wears: felt.wears + 1 }
        : { lowF: h.wx.f, highF: h.wx.f, wears: 1 };
    }
    if (h.pick != null) picked = { wears: (picked?.wears ?? 0) + (String(h.pick) === key ? 1 : 0), of: (picked?.of ?? 0) + 1 };
  }
  const dates = all.map(h => h.date).sort();
  return {
    count: year.length,
    first: dates[0],
    latest: dates.at(-1),
    since: year.length && byMonth.has(dates[0].slice(0, 7)) ? dates[0] : null,
    months,
    day: year.filter(h => h.slot === 'day').length,
    night: year.filter(h => h.slot === 'night').length,
    uses: [...uses.values()].sort((a, b) => b.wears - a.wears || a.label.localeCompare(b.label)),
    felt,
    picked,
  };
}

// "Oct 12", or "Oct 12, 2025" for a date in an earlier year than today's.
const dated = (iso, todayISO) => `${shortDate(iso)}${iso.slice(0, 4) < todayISO.slice(0, 4) ? `, ${iso.slice(0, 4)}` : ''}`;

/** The feels-like he has worn it in, in his units: "You’ve worn it when it felt 43–61°." ('' under ENOUGH_WEARS stamped wears). */
export function feltLine(felt) {
  if (!felt || felt.wears < ENOUGH_WEARS) return '';
  const same = temp(felt.lowF) === temp(felt.highF);
  return `You’ve worn it when it felt ${same ? deg(felt.lowF) : `${temp(felt.lowF)}–${deg(felt.highF)}`}.`;
}

// "8 as a daily pick", "4 for a date".
const usePhrase = u => `${u.id === 'daily' ? 'as' : 'for'} ${u.phrase}`;

/**
 * The lines under the strip for a reading with two wears or more, each only
 * when it has something to say: by day and by night (since its first wear,
 * when the twelve months hold it), what it was logged for (its three
 * commonest uses), the feels-like it was worn in, and how often it was the
 * pick its list showed.
 */
export function wearLines(w, todayISO) {
  const since = w.since ? ` since ${dated(w.since, todayISO)}` : '';
  const slots = !w.night ? `All ${w.count} by day${since}.` : !w.day ? `All ${w.count} at night${since}.` : `${w.day} by day and ${w.night} at night${since}.`;
  const uses = !w.uses.length ? ''
    : w.uses.length === 1 && w.uses[0].wears === w.count ? `Always ${usePhrase(w.uses[0])}.`
    : `${w.uses.slice(0, 3).map(u => `${u.wears} ${usePhrase(u)}`).join(', ')}.`;
  const p = w.picked;
  const pick = !p || p.of < ENOUGH_WEARS ? ''
    : p.wears === p.of ? `It was the pick on each of the ${p.of} wears that recorded one.`
    : p.wears === 0 ? `You chose it over the pick on each of the ${p.of} wears that recorded one.`
    : `It was the pick on ${p.wears} of the ${p.of} wears that recorded one.`;
  return [slots, uses, feltLine(w.felt), pick].filter(Boolean);
}

// The strip: a bar a month over twelve months, its wears over it, each said
// in full for screen readers and on hover (as Worn's By month says its own).
function monthsHTML(w, todayISO) {
  const most = Math.max(1, ...w.months.map(m => m.wears));
  return `<ul class="bw-months" role="list">${w.months.map(m => {
    const name = shortDate(`${m.month}-01`).split(' ')[0], year = m.month.slice(0, 4);
    const label = `${name}${year < todayISO.slice(0, 4) ? ` ${year}` : ''}: ${m.wears ? plural(m.wears, 'wear') : 'not worn'}`;
    return `<li title="${esc(label)}"><span class="visually-hidden">${esc(label)}</span><b aria-hidden="true">${m.wears || ''}</b><span class="bw-bar" aria-hidden="true"><span style="height:${((m.wears / most) * 100).toFixed(0)}%"></span></span><small aria-hidden="true">${esc(name[0])}<span>${esc(name.slice(1))}</span></small></li>`;
  }).join('')}</ul>`;
}

/**
 * The section for a bottle's model and its reading (bottleWears): '' for a
 * bottle that isn't his, or that he has never worn.
 */
export function yourWearsHTML(m, w) {
  if ((!m.owned && !m.inMine) || !w) return '';
  const today = m.todayISO;
  const head = body => `<section class="bp-section" id="bp-wears" aria-labelledby="bp-wears-title">
    <h3 id="bp-wears-title" tabindex="-1">Your wears${w.count > 1 ? ` <span class="h3-aside">${w.count} in 12 months</span>` : ''}</h3>
    ${body}
  </section>`;
  // Its wears are all older than the strip's twelve months.
  if (!w.count) return head(`<p class="bw-line">Not worn in the last 12 months. Last on ${esc(dated(w.latest, today))}.</p>`);
  if (w.count === 1) {
    // One wear is a sentence: "Worn once, on Oct 12 at night, for a date."
    const day = relativeDay(w.latest, today), on = day === shortDate(w.latest) ? `on ${dated(w.latest, today)}` : day;
    const use = w.uses[0] ? `, ${usePhrase(w.uses[0])}` : '';
    return head(`<p class="bw-line">${esc(`Worn once${w.since ? '' : ' in the last 12 months'}, ${on} ${w.night ? 'at night' : 'by day'}${use}.`)}</p>`);
  }
  return head(`${monthsHTML(w, today)}
    <ul class="bw-lines" role="list">${wearLines(w, today).map(line => `<li class="bw-line">${esc(line)}</li>`).join('')}</ul>`);
}

addSection({ id: 'wears', order: 280, render: m => yourWearsHTML(m, bottleWears(state.history, m.f.id, m.todayISO)) });
