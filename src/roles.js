// What each bottle in a wardrobe is for: the gap finder's table read the
// other way round, per bottle. The gap finder scores every bottle you'd wear
// in every situation (a use × day or night × a feels-like band, weighted by
// how often it comes up: gapContext in src/gaps.js); this says which
// situations each one leads, where it's within reach of the best, what the
// wardrobe would lose without it, and so what could go. Pure, and read off
// the context's own table (`ownTable`, every bottle as sameFooting has it),
// so it agrees with the coverage map cell for cell.
import { PLAN_MARGIN } from './engine.js';
import { BANDS, MIN_WEIGHT, cellTitle, stub } from './gaps.js';

// A workhorse leads this share of what you wear or more (David's eight lead
// 6–20%; the next lead under 5%).
export const WORKHORSE_SHARE = 0.05;
// A lead of a point or more is a real one: under it the next best is a
// toss-up (TIE_POINTS in src/contrast.js), and the bottle could go unmissed.
export const CLEAR_LEAD = 0.01;
// Past this the next best is "well behind" and the text counts the points.
const WIDE_LEAD = 0.03;
// Situations a line names before "and N more".
const NAMED = 3;

export const ROLES = [
  { id: 'workhorse', label: 'Workhorse', plural: 'Workhorses', blurb: 'The best you own for a large share of what you wear.' },
  { id: 'specialist', label: 'Specialist', plural: 'Specialists', blurb: 'The clear pick for a few situations.' },
  { id: 'backup', label: 'Backup', plural: 'Backups', blurb: 'In the mix, never clearly first. The least called for come first: they’d go unmissed.' },
  { id: 'bench', label: 'On the bench', plural: 'On the bench', blurb: 'In the mix for nothing you wear.' },
];
export const roleById = id => ROLES.find(r => r.id === id);
// The roles listed by how much they lead; the rest, by how little calls for them.
const LEADING = new Set(['workhorse', 'specialist']);

const BAND_ORDER = Object.fromEntries(BANDS.map((b, i) => [b.id, i]));
const list = words => (words.length <= 2 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);
const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
/** A share of wears in words: "14%", "under 1%". */
export const shareText = x => (x > 0 && x < 0.005 ? 'under 1%' : `${Math.round(x * 100)}%`);
const points = gap => { const n = Math.max(1, Math.round(gap * 100)); return `${n} point${n === 1 ? '' : 's'}`; };

// Cells ({ cell, lead?, next?, gap?, leader? }) as situations: neighbouring
// bands of one use and slot merged, as the gap report merges them, most
// worn first. A run's lead is its cells' by weight; `next` and `leader` are
// the heaviest cell's.
function situations(entries) {
  const sorted = [...entries].sort((a, b) => a.cell.use.localeCompare(b.cell.use) || a.cell.slot.localeCompare(b.cell.slot)
    || BAND_ORDER[a.cell.band] - BAND_ORDER[b.cell.band]);
  const runs = [];
  for (const e of sorted) {
    const last = runs.at(-1)?.at(-1);
    if (last && last.cell.use === e.cell.use && last.cell.slot === e.cell.slot && BAND_ORDER[last.cell.band] + 1 === BAND_ORDER[e.cell.band]) runs.at(-1).push(e);
    else runs.push([e]);
  }
  return runs.map(run => {
    const weight = run.reduce((sum, e) => sum + e.cell.weight, 0);
    const main = run.reduce((a, b) => (b.cell.weight > a.cell.weight ? b : a));
    const mean = key => run.reduce((sum, e) => sum + e.cell.weight * (e[key] ?? 0), 0) / (weight || 1);
    return {
      cells: run.map(e => e.cell.id), use: main.cell.use, slot: main.cell.slot, bands: run.map(e => e.cell.band),
      title: cellTitle(main.cell.use, main.cell.slot, run.map(e => e.cell.band)), weight,
      lead: mean('lead'), gap: mean('gap'), next: main.next ?? null, leader: main.leader ?? null,
    };
  }).sort((a, b) => b.weight - a.weight);
}

// The first NAMED situations in words, then "and N more"; `note` adds a few
// words in brackets after one of them (how far ahead the bottle is there).
const named = (runs, note = null) => {
  const shown = runs.slice(0, NAMED).map(r => (note?.run === r ? `${r.title} (${note.text})` : r.title)), more = runs.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : list(shown);
};

// A bottle's role from what it leads and where it's within reach.
function roleOf(b) {
  if (b.leadShare >= WORKHORSE_SHARE) return 'workhorse';
  if (b.leadShare > 0 && b.loss / b.leadShare >= CLEAR_LEAD) return 'specialist';
  return b.mixShare > 0 ? 'backup' : 'bench';
}

// A bottle in words, in the app's voice and never with a temperature:
// `headline` ("Leads 20%", "In the mix for 30%", "On the bench"), `detail`
// (its situations, and what stands behind it) and `text`, the two as one or
// two sentences for a line on its own.
function wordsOf(b) {
  const [top] = b.leads, near = b.closest;
  if (b.role === 'bench') {
    const detail = near ? `Your ${near.leader.name} outdoes it even for ${near.title}, where it comes closest.` : 'Nothing you wear calls for it.';
    return { headline: 'On the bench', detail, text: detail };
  }
  if (!top) {
    const behind = near.gap < CLEAR_LEAD ? 'just behind' : `${points(near.gap)} behind`;
    const detail = `Closest for ${near.title}, ${behind} ${near.leader.name}.`;
    return { headline: `In the mix for ${shareText(b.mixShare)}`, detail, text: `In the mix for ${shareText(b.mixShare)} of what you wear, never first. ${detail}` };
  }
  // Where the most would be lost without it says how far ahead it is, beside
  // that situation when it's one of those named; a hair's lead, who steps in.
  const clear = b.leads.reduce((a, r) => (r.weight * r.lead > a.weight * a.lead ? r : a));
  const wide = b.role !== 'backup' && clear.lead >= WIDE_LEAD && clear.next ? clear : null;
  const inline = wide && b.leads.indexOf(wide) < NAMED;
  const tail = b.role === 'backup' ? (top.next ? ` ${top.next.name} is right behind, so little would be lost without it.` : '')
    : wide ? (inline ? '' : ` For ${wide.title} it's ${points(wide.lead)} ahead of ${wide.next.name}.`)
      : clear.lead < CLEAR_LEAD && top.next ? ` ${top.next.name} is right behind.` : '';
  const detail = `${named(b.leads, inline ? { run: wide, text: `${points(wide.lead)} ahead of ${wide.next.name}` } : null)}.${tail}`;
  return { headline: `Leads ${shareText(b.leadShare)}`, detail, text: `Leads ${shareText(b.leadShare)} of what you wear: ${detail}` };
}

/**
 * Every owned bottle's role, from a gap context (gapContext; `hidden`: the
 * bottles the wardrobe switched off, records). A cell counts when it comes
 * up (weight over 0: a use set to Never doesn't).
 * -> { total (the weight of the cells that come up),
 *      bottles: [{ bottle, role ('workhorse' | 'specialist' | 'backup' | 'bench'),
 *        leadShare (the share of what you wear it's the wardrobe's best for),
 *        mixShare (where it's within PLAN_MARGIN of the best, its leads included: where rotation gives it turns),
 *        loss (over the cells it leads, weight × its lead over the next best),
 *        leads, mix (situations: { cells, use, slot, bands, title, weight, lead, gap, next, leader };
 *          mix leaves out the ones it leads),
 *        closest ({ title, gap, leader }: the situation that comes up where it sits nearest the best, null with no cells),
 *        headline, detail, text (wordsOf) }], workhorses first: they and the specialists by how much they
 *        lead, most first; backups and the bench by how little calls for them, least first (what could go),
 *      out: [{ bottle, why: 'rated' | 'off', text }]: bottles that cover nothing }
 */
export function bottleRoles(ctx, { hidden = [] } = {}) {
  const { cells } = ctx.cc, m = cells.length, worn = ctx.worn, table = ctx.ownTable;
  const rows = worn.map(bottle => ({ bottle, leadShare: 0, mixShare: 0, loss: 0, led: [], mixed: [], near: null }));
  let total = 0;
  for (let j = 0; j < m; j++) {
    const cell = cells[j], w = cell.weight;
    if (!(w > 0) || !rows.length) continue;
    total += w;
    let s1 = -Infinity, s2 = -Infinity, who = -1, second = -1;
    for (let i = 0; i < rows.length; i++) {
      const x = table[i * m + j];
      if (x > s1) [s2, second, s1, who] = [s1, who, x, i];
      else if (x > s2) [s2, second] = [x, i];
    }
    const lead = second < 0 ? s1 : s1 - s2, leader = worn[who];
    rows.forEach((r, i) => {
      const gap = s1 - table[i * m + j];
      if (i === who) {
        r.leadShare += w;
        r.loss += w * lead;
        r.led.push({ cell, lead, next: second < 0 ? null : worn[second] });
      } else if (gap <= PLAN_MARGIN) r.mixed.push({ cell, gap, leader });
      if (i === who || gap <= PLAN_MARGIN) r.mixShare += w;
      // Where it comes closest: among cells that come up often enough to name, else any.
      const often = w >= MIN_WEIGHT;
      if (i !== who && (!r.near || (often && !r.near.often) || (often === r.near.often && gap < r.near.gap))) r.near = { cell, gap, leader, often };
    });
  }
  const order = ROLES.map(r => r.id);
  const bottles = rows.map(r => {
    const b = {
      bottle: r.bottle, leadShare: r.leadShare, mixShare: r.mixShare, loss: r.loss,
      leads: situations(r.led), mix: situations(r.mixed),
      closest: r.near ? { cell: r.near.cell.id, title: cellTitle(r.near.cell.use, r.near.cell.slot, r.near.cell.band), gap: r.near.gap, leader: r.near.leader } : null,
    };
    b.role = roleOf(b);
    return Object.assign(b, wordsOf(b));
  }).sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || (LEADING.has(a.role)
    ? b.leadShare - a.leadShare || b.mixShare - a.mixShare
    : a.leadShare - b.leadShare || a.mixShare - b.mixShare || (b.closest?.gap ?? 0) - (a.closest?.gap ?? 0))
    || a.bottle.name.localeCompare(b.bottle.name));
  const wornSet = new Set(worn);
  const out = [
    ...ctx.owned.filter(f => !wornSet.has(f)).map(bottle => ({
      bottle, why: 'rated', text: `You rate it ${bottle.personal?.rating ?? 2}★, so it covers nothing: picks pass it over.`,
    })),
    ...hidden.map(bottle => ({ bottle, why: 'off', text: 'Switched off, so it covers nothing.' })),
  ];
  return { total, bottles, out };
}

const situationJSON = s => ({
  cells: s.cells, use: s.use, slot: s.slot, bands: s.bands, title: s.title, weight: round(s.weight, 4),
  lead: round(s.lead), gap: round(s.gap), next: s.next ? stub(s.next) : null, leader: s.leader ? stub(s.leader) : null,
});

/**
 * bottleRoles as plain data (JSON and postMessage safe), bottles as stubs:
 * { total, counts ({ workhorse, specialist, backup, bench }), carried (the
 * share of what you wear the workhorses lead), roles (ROLES, for a screen
 * that doesn't load this module), bottles: [{ id, name, brand, …, role,
 * label, leadShare, mixShare, loss, leads, mix, closest, headline, detail,
 * text }], out: [{ id, name, …, why, text }] }.
 */
export function rolesJSON(roles) {
  return {
    total: round(roles.total, 4),
    counts: Object.fromEntries(ROLES.map(r => [r.id, roles.bottles.filter(b => b.role === r.id).length])),
    carried: round(roles.bottles.reduce((sum, b) => sum + (b.role === 'workhorse' ? b.leadShare : 0), 0), 4),
    roles: ROLES,
    bottles: roles.bottles.map(b => ({
      ...stub(b.bottle), role: b.role, label: roleById(b.role).label,
      leadShare: round(b.leadShare, 4), mixShare: round(b.mixShare, 4), loss: round(b.loss, 5),
      leads: b.leads.map(situationJSON), mix: b.mix.map(situationJSON),
      closest: b.closest && { cell: b.closest.cell, title: b.closest.title, gap: round(b.closest.gap), leader: stub(b.closest.leader) },
      headline: b.headline, detail: b.detail, text: b.text,
    })),
    out: roles.out.map(o => ({ ...stub(o.bottle), why: o.why, text: o.text })),
  };
}

/** One bottle's line for the terminal: "Workhorse · Leads 20% of what you wear: …". */
export const roleLine = b => `${roleById(b.role).label} · ${b.text}`;
