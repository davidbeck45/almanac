// The gap finder and buy check in the terminal (scripts/recommend.mjs --gaps,
// --check). Each run is a process of its own, so they run side by side, and
// this file apart from gaps.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEMO_LIKED } from '../src/discover.js';

const script = fileURLToPath(new URL('../scripts/recommend.mjs', import.meta.url));
const cli = (...args) => new Promise(resolve => {
  execFile(process.execPath, [script, ...args], { encoding: 'utf8' }, (err, stdout, stderr) => resolve({ status: err ? err.code ?? 1 : 0, stdout, stderr }));
});

test('--gaps and --check answer in the terminal', async () => {
  const [gaps, text, check, byNumber, you, vanilla, unknownStyle, gym, daily, both, nothing] = await Promise.all([
    cli('--gaps', '--top', '3', '--json'),
    cli('--gaps', '--uses', 'office=never,formal=often', '--no-value'),
    cli('--check', 'Althair', '--json'),
    cli('--check', '76063'),
    cli('--check', 'Glossier You', '--json'),
    cli('--check', 'Glossier You', '--style', 'vanilla', '--json'),
    cli('--check', 'Glossier You', '--style', 'xqzw'),
    cli('--gaps', '--uses', 'gym=often'),
    cli('--gaps', '--uses', 'daily=never'),
    cli('--gaps', '--value', '--no-value'),
    cli('--check', 'xqzw'),
  ]);
  assert.equal(gaps.status, 0, gaps.stderr);
  const out = JSON.parse(gaps.stdout);
  assert.ok(out.picks.length >= 2 && out.picks.length <= 3);
  assert.ok(out.gaps.length && out.strengths.length && !('record' in out.picks[0]));
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /How you wear: Daily \d+%.*Office 0%/);
  assert.doesNotMatch(text.stdout.split('To fill them')[0], /Office on/);
  assert.match(text.stdout, /prefer great value: off/);
  assert.match(text.stdout, /\nFrom Le Decanteur's Fragrantica dataset \(CC BY-NC-SA 4\.0\)\.\n$/, 'the dataset credited');

  assert.equal(check.status, 0, check.stderr);
  assert.equal(JSON.parse(check.stdout).verdict, 'Redundant');
  assert.match(byNumber.stdout, /^Shalimar Millésime Tonka by Guerlain \(2022\).*\nCovered\n  It would barely beat your .+ for Date Night on mild nights, and nowhere by more\.\n/);
  assert.match(byNumber.stdout, /CC BY-NC-SA 4\.0/);
  assert.equal(byNumber.stderr, '', 'a number no bottle is named is an id, said nothing about');
  // His styles by default, others when named.
  assert.deepEqual([JSON.parse(you.stdout).verdict, JSON.parse(you.stdout).liked], ['Good', DEMO_LIKED]);
  assert.equal(JSON.parse(vanilla.stdout).verdict, 'Covered');
  assert.match(unknownStyle.stderr, /--style: name styles from/);

  assert.match(gym.stderr, /--uses: Unknown use "gym"/);
  assert.match(daily.stderr, /--uses: Daily picks always count/);
  assert.match(both.stderr, /not both/);
  assert.match(nothing.stderr, /No bottle matches "xqzw"/);
});

test('--check names the bottle voters link it to, its value, and why a medium risk is Risky', async () => {
  const [limited, khan, zenith] = await Promise.all([cli('--check', 'Liquid Brun Limited'), cli('--check', 'Muscs Koublai Khan'), cli('--check', 'Zenith', '--json')]);
  // Voters call it a twin of Liquid Brun, though Terra is nearer by notes.
  assert.match(limited.stdout, /\nLinked: your Liquid Brun \(0\.\d\d alike\)\. Voters call it a twin of your Liquid Brun\.\n/);
  assert.match(khan.stdout, /^Muscs Koublai Khan by Serge Lutens \(1998\) · [\d.]+★ from [\d,]+ votes · value \d\.\d\nRisky\n/);
  assert.match(khan.stdout, /\nRisk: medium, with a warning that counts double \(Reviewers say/);
  const out = JSON.parse(zenith.stdout);
  assert.ok(out.value >= 3.8 && out.overlap.name, JSON.stringify(out.overlap));
});

test('--check reads a number a bottle is named as its name, and id: as an id', async () => {
  const [named, id, four, jadore, zero] = await Promise.all([cli('--check', '1881'), cli('--check', 'id:1881'), cli('--check', '212'), cli('--check', '210'), cli('--check', '0')]);
  assert.match(jadore.stdout, /^J'adore by Dior/, 'a number only an obscure bottle is named is an id');
  assert.equal(jadore.stderr, '');
  assert.match(named.stdout, /^1881 by Cerruti/);
  assert.match(named.stderr, /Reading "1881" as a name \(1881 by Cerruti \(1995\)\); give id:1881 for DKNY To Go Women by Donna Karan \(2007\), the bottle with that id\./);
  assert.match(id.stdout, /^DKNY To Go Women by Donna Karan/);
  assert.equal(id.stderr, '');
  // No bottle has the id 212, so no id: to give; a lone digit isn't one in a decimal ("9.0 Zara").
  assert.match(four.stdout, /^212 by Carolina Herrera/);
  assert.equal(four.stderr.trim(), 'Reading "212" as a name (212 by Carolina Herrera (1997)).');
  assert.doesNotMatch(zero.stdout + zero.stderr, /9\.0 Zara/);
});

test('--check gives each fill the percentages --gaps and the app give it', async () => {
  // Zenith's warm date nights over Supremacy, at 0.7646 before the plain data rounds it: 77% everywhere, not 76% in --check.
  const [check, gaps, json] = await Promise.all([cli('--check', 'Zenith'), cli('--gaps'), cli('--check', 'Zenith', '--json')]);
  const fills = text => text.split('\n').map(l => l.trim()).filter(l => /^[A-Z][\w ]+ on \w+ (days|nights): \d+%/.test(l));
  const zenith = gaps.stdout.split(/\n {2}\d\. /).find(p => p.startsWith('Zenith by Riiffs'));
  assert.ok(zenith, gaps.stdout);
  const [theirs, ours] = [fills(zenith), fills(check.stdout)];
  assert.ok(theirs.length >= 2, zenith);
  for (const line of theirs) assert.ok(ours.includes(line), `${line} | --check: ${ours.join(' | ')}`);
  const pct = x => `${Math.round(x * 100)}%`;
  for (const f of JSON.parse(json.stdout).fills) assert.ok(ours.some(l => l.startsWith(`${f.title}: ${pct(f.to)}`) && (!f.beats || l.endsWith(`at ${pct(f.from)}`))), f.title);
});
