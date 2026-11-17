// The bottle page's "Your wears" (order 280), for a bottle you own or have
// in Mine: your own history with it, from the wear journal (src/history.js),
// so the page answers "when do I actually reach for this?". The count over
// the last twelve calendar months with a bar a month, by day and by night,
// what it was logged for, the feels-like you've worn it in (from the wears
// stamped with their window's weather) and how often it was the pick its
// list showed. Nothing for a bottle never worn, and one wear is a sentence.
// It's also where a compliment is noted: "Got a compliment" adds one to its
// latest wear (src/history.js addPraise), and the lines count them. The same
// `praise` action serves Now's card and Worn's log sheet.
import { occasionById } from '../occasions.js';
import { MAX_PRAISE } from '../history.js';
import { esc, temp, deg, plural, shortDate, relativeDay, wearPhrase, praiseSaid } from '../ui.js';
import { icon } from '../ui/components.js';
import { addSection } from './bottle.js';
import { state, notePraise } from '../app/state.js';
import { wornToday } from './wear/trip.js';

/** Stamped wears it takes before the feels-like range, or the pick's share, says anything. */
export const ENOUGH_WEARS = 3;

/**
 * One bottle's wears, read from the journal up to `todayISO`: null when it
 * has none, else
 *   id: the bottle's,
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
 *     the wears that recorded a pick, null without one,
 *   praise: { count, wears }: the compliments those wears got and how many
 *     of them got one, null without any,
 *   last: { date, slot, praise }: its newest wear (a day's night after its
 *     day), which a new compliment goes to.
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
  const praised = year.filter(h => h.praise > 0);
  const newest = all.reduce((a, h) => (!a || h.date > a.date || (h.date === a.date && h.slot === 'night') ? h : a), null);
  return {
    id: key,
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
    praise: praised.length ? { count: praised.reduce((n, h) => n + h.praise, 0), wears: praised.length } : null,
    last: { date: newest.date, slot: newest.slot, praise: newest.praise ?? 0 },
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
  const praise = w.praise ? `${plural(w.praise.count, 'compliment')} over ${plural(w.count, 'wear')}.` : '';
  return [slots, uses, feltLine(w.felt), pick, praise].filter(Boolean);
}

/**
 * Where a compliment is noted, under the lines: Got a compliment adds one to
 * the bottle's latest wear and Take one off undoes it, with a line saying
 * which wear and how many it has.
 */
export function praiseHTML(id, last, todayISO) {
  const wear = wearPhrase(last.date, last.slot, todayISO);
  const data = `data-action="praise" data-id="${esc(id)}" data-date="${esc(last.date)}" data-slot="${esc(last.slot)}"`;
  return `<div class="bw-praise">
      <button class="btn secondary compact" ${data} data-by="1"${last.praise >= MAX_PRAISE ? ' disabled' : ''}>${icon.praise}<span>Got a compliment</span></button>
      ${last.praise ? `<button class="btn tertiary compact" ${data} data-by="-1">Take one off</button>` : ''}
      <p class="bw-praise-when">${esc(last.praise ? `${plural(last.praise, 'compliment')} on your wear ${wear}.` : `Counts for your wear ${wear}.`)}</p>
    </div>`;
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
  // The strip's twelve calendar months, named by their first ("since Dec
  // 2025"): on the 1st they span eleven months and a day, so "in 12 months"
  // left out a wear 351 days old and said "not worn in the last 12 months".
  const start = w.months[0].month;
  const from = `${shortDate(`${start}-01`).split(' ')[0]}${start.slice(0, 4) < today.slice(0, 4) ? ` ${start.slice(0, 4)}` : ''}`;
  const head = body => `<section class="bp-section" id="bp-wears" aria-labelledby="bp-wears-title">
    <h3 id="bp-wears-title" tabindex="-1">Your wears${w.count > 1 ? ` <span class="h3-aside">${w.count} since ${esc(from)}</span>` : ''}</h3>
    ${body}
  </section>`;
  // Its wears are all older than the strip's twelve months.
  if (!w.count) return head(`<p class="bw-line">Not worn since ${esc(dated(w.latest, today))}.</p>`);
  if (w.count === 1) {
    // One wear is a sentence: "Worn once, on Oct 12 at night, for a date."
    // "tonight" and "last night", "today" and "yesterday": a relative day says its own half.
    const day = relativeDay(w.latest, today), night = Boolean(w.night);
    const when = day === 'today' ? (night ? 'tonight' : 'today') : day === 'yesterday' ? (night ? 'last night' : 'yesterday')
      : `${day === shortDate(w.latest) ? `on ${dated(w.latest, today)}` : day} ${night ? 'at night' : 'by day'}`;
    const use = w.uses[0] ? `, ${usePhrase(w.uses[0])}` : '';
    const praise = w.praise ? ` It got ${w.praise.count === 1 ? 'a compliment' : `${w.praise.count} compliments`}.` : '';
    return head(`<p class="bw-line">${esc(`Worn once${w.since ? '' : ` since ${from}`}, ${when}${use}.${praise}`)}</p>
    ${praiseHTML(w.id, w.last, today)}`);
  }
  return head(`${monthsHTML(w, today)}
    <ul class="bw-lines" role="list">${wearLines(w, today).map(line => `<li class="bw-line">${esc(line)}</li>`).join('')}</ul>
    ${praiseHTML(w.id, w.last, today)}`);
}

// By the journal's today, as Worn counts: a wear logged on a trip a day
// ahead of home is dated tomorrow here, and by home's date the section left
// it out until midnight.
addSection({
  id: 'wears',
  order: 280,
  render: m => { const today = wornToday(); return yourWearsHTML({ ...m, todayISO: today }, bottleWears(state.history, m.f.id, today)); },
  actions: {
    // Got a compliment, or Take one off (data-by), on this page and on Now's
    // card (Worn's log sheet has its own, with its own status line). The wear
    // is named by its window and bottle, so one another tab changed since
    // isn't credited with another's.
    praise(el, app) {
      const { id, date, slot } = el.dataset;
      const by = Number(el.dataset.by) < 0 ? -1 : 1;
      const said = praiseSaid(notePraise(id, date, slot, by), by, wearPhrase(date, slot, wornToday()), MAX_PRAISE);
      app.keepingFocus(el, el.closest('#bottle') ? '#bottle' : '#app', app.render);
      app.announce(said);
    },
  },
});
