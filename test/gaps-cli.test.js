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

  assert.equal(check.status, 0, check.stderr);
  assert.equal(JSON.parse(check.stdout).verdict, 'Redundant');
  assert.match(byNumber.stdout, /^Shalimar Millésime Tonka by Guerlain \(2022\).*\nCovered\n/);
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

test('--check reads a number a bottle is named as its name, and id: as an id', async () => {
  const [named, id, four] = await Promise.all([cli('--check', '1881'), cli('--check', 'id:1881'), cli('--check', '212', '--json')]);
  assert.match(named.stdout, /^1881 by Cerruti/);
  assert.match(named.stderr, /Reading "1881" as a name .*give id:1881/);
  assert.match(id.stdout, /^DKNY To Go Women by Donna Karan/);
  assert.equal(id.stderr, '');
  assert.deepEqual([JSON.parse(four.stdout).name, JSON.parse(four.stdout).brand], ['212', 'Carolina Herrera']);
});
