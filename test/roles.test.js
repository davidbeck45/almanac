import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { PLAN_MARGIN } from '../src/engine.js';
import { loadPool, fromPool } from '../src/fragrantica.js';
import { gapContext, gapReport } from '../src/gaps.js';
import { applySkin } from '../src/skin.js';
import { sharesFrom, parseUses } from '../src/uses.js';
import { ROLES, WORKHORSE_SHARE, SPECIALIST_SHARE, WIDE_LEAD, bottleRoles, rolesJSON, roleLine, shareText } from '../src/roles.js';
import { handlePool, newPoolCache } from '../src/pool-tasks.js';
import { rolesHTML } from '../src/views/wardrobe/insights.js';

const dir = new URL('../data/fragrantica/', import.meta.url);
const load = async path => {
  const file = new URL(path, dir);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};
const pool = await loadPool(load);
const records = Array.from({ length: pool.count }, (_, i) => fromPool(pool, i));
const byId = new Map(records.map(r => [r.id, r]));
const wardrobe = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances.map(f => ({ ...f, id: String(f.id) }));
const owned = name => wardrobe.find(f => f.name === name);
const contextOf = (list, opts = {}) => gapContext({ owned: list, records, byId, ...opts });
const ctx = contextOf(wardrobe);
const roles = bottleRoles(ctx);
const roleOf = (r, name) => r.bottles.find(b => b.bottle.name === name)?.role;
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('every bottle you’d wear gets exactly one role, and the leads add up to what you wear', () => {
  assert.equal(roles.bottles.length, ctx.worn.length);
  assert.equal(new Set(roles.bottles.map(b => b.bottle.id)).size, wardrobe.length);
  const ids = ROLES.map(r => r.id);
  for (const b of roles.bottles) assert.ok(ids.includes(b.role), `${b.bottle.name}: ${b.role}`);
  const up = ctx.cc.cells.reduce((sum, c) => sum + c.weight, 0);
  assert.ok(close(roles.total, up) && close(up, 1));
  assert.ok(close(roles.bottles.reduce((sum, b) => sum + b.leadShare, 0), roles.total), 'every cell has one leader');
  for (const b of roles.bottles) {
    assert.ok(b.mixShare >= b.leadShare - 1e-9 && b.mixShare <= roles.total + 1e-9);
    assert.ok(close(b.leads.reduce((sum, s) => sum + s.weight, 0), b.leadShare), `${b.bottle.name}'s situations are its leads`);
    assert.ok(b.loss >= 0 && b.loss <= b.leadShare);
  }
  assert.deepEqual(roles.out, []);
});

test('it reads the coverage map’s own table: a cell’s leader is the report’s best there', () => {
  const report = gapReport(ctx, { k: 1 });
  const leaderOf = new Map();
  for (const b of roles.bottles) for (const s of b.leads) for (const id of s.cells) leaderOf.set(id, b.bottle.id);
  const up = report.coverage.filter(c => c.weight > 0);
  assert.equal(leaderOf.size, ctx.cc.cells.filter(c => c.weight > 0).length);
  for (const c of up) assert.equal(leaderOf.get(c.cell), c.top[0].id, c.title);
  // In the mix means within PLAN_MARGIN of that best, and never a cell it leads.
  const m = ctx.cc.cells.length;
  for (const b of roles.bottles) {
    const i = ctx.worn.indexOf(b.bottle);
    for (const s of b.mix) {
      for (const id of s.cells) {
        const j = ctx.cc.cells.findIndex(c => c.id === id);
        const best = Math.max(...ctx.worn.map((_, k) => ctx.ownTable[k * m + j]));
        assert.ok(best - ctx.ownTable[i * m + j] <= PLAN_MARGIN + 1e-6 && leaderOf.get(id) !== b.bottle.id, `${b.bottle.name} in ${id}`);
      }
    }
  }
});

test('David’s wardrobe: workhorses lead a large share, and the bottles daily picks pass over aren’t among them', () => {
  const count = id => roles.bottles.filter(b => b.role === id).length;
  assert.ok(count('workhorse') >= 4 && count('workhorse') <= 10, `${count('workhorse')} workhorses`);
  for (const b of roles.bottles) assert.equal(b.role === 'workhorse', b.leadShare >= WORKHORSE_SHARE, b.bottle.name);
  // Never in a daily top 3 over three years of weather (scripts/backtest.mjs).
  for (const name of ['Sandalwood & Musk', 'Zahri Amara', 'Hawas Elixir']) {
    const b = roles.bottles.find(x => x.bottle.name === name);
    assert.ok(['backup', 'bench'].includes(b.role), `${name}: ${b.role}`);
    assert.ok(!b.leads.some(s => s.use === 'daily'), `${name} leads no daily picks`);
  }
  assert.equal(roleOf(roles, 'Détour Noir'), 'workhorse');
  assert.equal(roleOf(roles, 'Cream Velvet'), 'workhorse');
  // The one real pick for formal wear in the cold, and for the outdoors in it.
  assert.equal(roleOf(roles, 'Sticky Fingers'), 'specialist');
  assert.equal(roleOf(roles, 'Vintage Radio'), 'specialist');
  assert.ok(roles.bottles.find(b => b.bottle.name === 'Sticky Fingers').leads.some(s => s.title === 'Formal on cold and cool nights'));
  // A leader with a near equal behind it reads as replaceable.
  const terra = roles.bottles.find(b => b.bottle.name === 'Terra');
  assert.equal(terra.role, 'backup');
  assert.match(terra.text, /^Leads 4% of what you wear: Night Out on cold and cool nights\. Hawas Elixir is right behind/);
  // The bench says where it comes closest and who leads there, as the buy check's Covered does.
  const bench = roles.bottles.filter(b => b.role === 'bench');
  for (const b of bench) {
    assert.equal(b.mixShare, 0);
    assert.match(b.text, /^Your .+ outdoes it even for .+, where it comes closest\.$/);
  }
  // Workhorses first; they and the specialists biggest lead first, the backups least called for first.
  const order = ROLES.map(r => r.id);
  for (let i = 1; i < roles.bottles.length; i++) {
    const [a, b] = [roles.bottles[i - 1], roles.bottles[i]];
    assert.ok(order.indexOf(a.role) <= order.indexOf(b.role));
    if (a.role !== b.role) continue;
    if (a.role === 'backup') assert.ok(a.leadShare < b.leadShare || (a.leadShare === b.leadShare && a.mixShare <= b.mixShare + 1e-9), `${a.bottle.name} before ${b.bottle.name}`);
    else if (a.role !== 'bench') assert.ok(a.leadShare >= b.leadShare - 1e-9);
  }
  const backups = roles.bottles.filter(b => b.role === 'backup');
  assert.equal(backups[0].bottle.name, 'Glorious Oud Royal Blanc', 'the backup least in the mix leads the list of what could go');
  assert.equal(backups.at(-1).bottle.name, 'Terra');
  // A lead that seldom comes up, a point ahead, isn't a specialist's: Sauvage's one is about four nights a year.
  const sauvage = roles.bottles.find(b => b.bottle.name === 'Sauvage');
  assert.equal(sauvage.role, 'backup');
  assert.ok(sauvage.leadShare > 0 && sauvage.leadShare < SPECIALIST_SHARE);
  assert.match(sauvage.text, /^Leads 1% of what you wear: Casual on mild nights\. That comes up rarely, and .+ is 1 point behind\.$/);
  // However rare, a wide lead is: Vintage Radio is the one real pick for the outdoors in the cold.
  const radio = roles.bottles.find(b => b.bottle.name === 'Vintage Radio');
  assert.ok(radio.leadShare < SPECIALIST_SHARE && radio.leads[0].lead >= WIDE_LEAD);
  assert.equal(radio.text, 'Leads 1% of what you wear: Outdoors on cold days (6 points ahead of Cedrus Blanc).');
  // The short forms a card shows beside the name and under it.
  const detour = roles.bottles.find(b => b.bottle.name === 'Détour Noir');
  assert.equal(detour.headline, 'Leads 20%');
  assert.equal(detour.text, `Leads 20% of what you wear: ${detour.detail}`);
  assert.match(backups[0].headline, /^In the mix for \d+%$/);
  assert.equal(bench[0]?.headline ?? 'On the bench', 'On the bench');
});

test('no wording holds a temperature, and every line says something', () => {
  const lists = [roles, bottleRoles(contextOf(wardrobe.slice(0, 5))), bottleRoles(contextOf(wardrobe.slice(5, 7)))];
  for (const r of lists) {
    for (const b of r.bottles) {
      const texts = [b.text, b.headline, b.detail, roleLine(b), ...b.leads.map(s => s.title), ...b.mix.map(s => s.title), b.closest?.title ?? ''];
      for (const text of texts) assert.ok(!/°|\d\s*F\b|undefined|NaN|null/.test(text), text);
      assert.ok(b.text.length > 20 && b.text.endsWith('.'), b.text);
    }
  }
  assert.equal(shareText(0.137), '14%');
  assert.equal(shareText(0.003), 'under 1%');
  assert.equal(shareText(0), '0%');
});

test('taking a bottle out of a two-bottle wardrobe changes the other’s role', () => {
  // A synthetic twin: Détour Noir's page with a lower rating, so it sits just under it everywhere.
  const best = owned('Détour Noir'), twin = { ...best, id: 'twin', name: 'Twin', rating: 3.2 };
  const both = bottleRoles(contextOf([best, twin]));
  assert.equal(both.bottles.length, 2);
  assert.deepEqual(both.bottles.map(b => [b.bottle.name, b.role]), [['Détour Noir', 'workhorse'], ['Twin', 'backup']]);
  assert.ok(close(both.bottles[0].leadShare, 1) && both.bottles[1].leadShare === 0 && close(both.bottles[1].mixShare, 1));
  assert.match(both.bottles[1].text, /^In the mix for 100% of what you wear, never first\. Closest for .+, (just|\d+ points?) behind Détour Noir\.$/);
  const alone = bottleRoles(contextOf([twin]));
  assert.equal(alone.bottles.length, 1);
  assert.equal(alone.bottles[0].role, 'workhorse');
  assert.ok(close(alone.bottles[0].leadShare, 1) && close(alone.bottles[0].mixShare, 1));
  assert.match(alone.bottles[0].text, /^Leads 100% of what you wear/);
  // Two bottles that split the year both carry it.
  const split = bottleRoles(contextOf([owned('Amber Empire'), owned('Zahri Amara')]));
  assert.deepEqual(split.bottles.map(b => b.role), ['workhorse', 'workhorse']);
  assert.ok(close(split.bottles.reduce((sum, b) => sum + b.leadShare, 0), 1));
  // An empty wardrobe has nothing to say.
  assert.deepEqual(bottleRoles(contextOf([])), { total: 0, bottles: [], out: [] });
});

test('a use set to Never doesn’t count, and bottles that cover nothing are listed apart', () => {
  const shares = sharesFrom(parseUses('formal=never,outdoors=never'));
  const r = bottleRoles(contextOf(wardrobe, { shares }));
  assert.ok(close(r.total, 1));
  for (const b of r.bottles) {
    for (const s of [...b.leads, ...b.mix]) assert.ok(!['formal', 'outdoors'].includes(s.use), `${b.bottle.name}: ${s.title}`);
    assert.ok(!/Formal|Outdoors/.test(b.text), b.text);
  }
  // Sticky Fingers led formal wear in the cold; with none, it's no specialist for it.
  assert.ok(!r.bottles.find(b => b.bottle.name === 'Sticky Fingers').leads.some(s => s.use === 'formal'));

  const rated = applySkin(wardrobe, { [owned('Cream Velvet').id]: { rating: 2 }, [owned('Terra').id]: { rating: 5 } });
  const off = owned('Jake');
  const listed = bottleRoles(contextOf(rated.filter(f => f.id !== off.id)), { hidden: [off] });
  assert.ok(!listed.bottles.some(b => ['Cream Velvet', 'Jake'].includes(b.bottle.name)));
  assert.equal(listed.bottles.length, wardrobe.length - 2);
  assert.deepEqual(listed.out.map(o => [o.bottle.name, o.why]), [['Cream Velvet', 'rated'], ['Jake', 'off']]);
  assert.equal(listed.out[0].text, 'You rate it 2★, so it covers nothing: picks pass it over.');
  assert.equal(listed.out[1].text, 'Switched off, so it covers nothing.');
  assert.ok(close(listed.bottles.reduce((sum, b) => sum + b.leadShare, 0), 1), 'what Cream Velvet led, others lead');
});

test('rolesJSON is plain data that survives JSON, with a count per role', () => {
  const plain = rolesJSON(roles);
  assert.deepEqual(JSON.parse(JSON.stringify(plain)), plain);
  assert.equal(Object.values(plain.counts).reduce((a, b) => a + b, 0), wardrobe.length);
  assert.deepEqual(Object.keys(plain.counts), ROLES.map(r => r.id));
  assert.deepEqual(plain.roles.map(r => r.id), Object.keys(plain.counts));
  assert.ok(plain.carried > 0.5 && plain.carried < 1, `workhorses lead ${plain.carried}`);
  for (const b of plain.bottles) {
    assert.equal(typeof b.id, 'string');
    assert.ok(b.name && b.label && b.text);
    for (const s of b.leads) assert.ok(s.title && s.weight > 0 && (s.next === null || typeof s.next.name === 'string'));
  }
});

test('the pool’s report carries the roles, switched-off bottles apart, as plain data', async () => {
  const cache = newPoolCache({ load });
  const off = owned('Jake');
  const answer = await handlePool({ id: 1, type: 'report', payload: { owned: wardrobe.filter(f => f !== off), exclude: [off], k: 1 } }, cache);
  assert.equal(answer.error, undefined, `${answer.error} ${answer.detail ?? ''}`);
  const { roles: sent, coverage } = answer.result;
  assert.deepEqual(structuredClone(sent), sent);
  assert.equal(sent.bottles.length, wardrobe.length - 1);
  assert.deepEqual(sent.out.map(o => [o.name, o.why]), [['Jake', 'off']]);
  // The same screen's coverage map names the same leaders.
  const leaderOf = new Map(sent.bottles.flatMap(b => b.leads.flatMap(s => s.cells.map(id => [id, b.id]))));
  for (const c of coverage.filter(c => c.weight > 0)) assert.equal(leaderOf.get(c.cell), c.top[0].id, c.title);
});

test('Insights’ card groups the bottles by role, a few to a group, each row opening its page', () => {
  const plain = rolesJSON(roles);
  const html = rolesHTML(plain);
  // Four groups in role order, three rows each where a role holds more than four.
  assert.deepEqual([...html.matchAll(/data-role="(\w+)"/g)].map(m => m[1]), ['workhorse', 'specialist', 'backup', 'bench']);
  const rows = h => (h.match(/class="row wrap role-row/g) ?? []).length;
  assert.equal(rows(html), 3 + 3 + 3 + 1);
  assert.match(html, /<p class="muted small role-sum">8 of your 26 bottles lead 79% of what you wear\./);
  assert.match(html, /data-action="ins-roles-all" data-value="workhorse" aria-controls="ins-roles-workhorse" aria-expanded="false">[^]*?Show 5 more<span class="visually-hidden"> workhorses<\/span>/);
  assert.ok(!/data-value="bench"/.test(html), 'a short group has no toggle');
  // Every row is one button that opens the bottle, with its share as words beside the bar.
  assert.equal((html.match(/<button class="row-main" data-action="open" data-ctx="" data-id="\d+">/g) ?? []).length, rows(html));
  assert.match(html, /<b>Détour Noir<\/b><small><span class="role-share"><span class="role-bar" aria-hidden="true" style="--lead:0\.\d+;--mix:0\.\d+"><\/span><span class="role-lead">Leads 20%<\/span>/);
  // A benched bottle draws no bar: its group's name says it.
  assert.match(html, /<b>Zahri Amara<\/b><small><span class="role-detail">Your Aristo outdoes it even for Casual on mild days, where it comes closest\.<\/span>/);
  // How far ahead a specialist is sits beside the situation it's ahead in.
  assert.match(rolesHTML(plain, { open: new Set(['specialist']) }), /Outdoors on cold days \(6 points ahead of Cedrus Blanc\)\./);
  for (const m of html.matchAll(/--lead:([\d.]+);--mix:([\d.]+)/g)) assert.ok(+m[1] <= +m[2] + 1e-9 && +m[2] <= 1, m[0]);
  // A role shown whole lists every bottle and offers the way back.
  const open = rolesHTML(plain, { open: new Set(['backup']) });
  assert.equal(rows(open), 3 + 3 + 11 + 1);
  assert.match(open, /data-value="backup"[^>]*aria-expanded="true">[^]*?Show fewer/);
  assert.ok(!/°|\d\s*F\b|undefined|NaN/.test(open), 'no temperature, nothing unfilled');
  // Bottles that cover nothing close the card; with no roles there is no card.
  const rated = applySkin(wardrobe, { [owned('Cream Velvet').id]: { rating: 1 } });
  const apart = rolesHTML(rolesJSON(bottleRoles(contextOf(rated.filter(f => f.name !== 'Jake')), { hidden: [owned('Jake')] })));
  assert.match(apart, /data-role="out"[^]*Covering nothing <span class="role-count">2<\/span>[^]*You rate it 1★, so it covers nothing: picks pass it over\.[^]*Switched off, so it covers nothing\./);
  assert.equal(rolesHTML(undefined), '');
  assert.equal(rolesHTML(rolesJSON(bottleRoles(contextOf([])))), '');
});
