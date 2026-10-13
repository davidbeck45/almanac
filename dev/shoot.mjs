#!/usr/bin/env node
// Headless screenshots and page driving for checking the UI. No dependencies:
// it starts the system Chromium with --remote-debugging-port and speaks the
// DevTools protocol over Node's global WebSocket (Node 22+).
//
// Steps run in the order given, once per --size, each size in a fresh
// browser context (empty localStorage and cache):
//   --wait <ms|selector>  sleep, or poll until the selector matches (15 s cap)
//   --click <selector>    real input on the element's center: a tap on phone
//                         sizes, a mouse click otherwise (focus-visible, hover
//                         and user activation behave as for a person)
//   --key <name>          press Tab, Enter, Escape, Space or an Arrow key
//   --type "<text>"       type into the focused field (fires input events)
//   --eval "<js>"         run in the page; top-level await works; a resulting
//                         value is printed. Wrap in { } to reuse const names.
//   --shot <file.png>     screenshot at this point
//   --full-shot <file>    the same, of the whole document
// --out <file.png> is a last --shot. With several sizes, file names get
// -WxH before .png (shots/today.png -> shots/today-390x844.png).
//
// Options:
//   --url <url>          page to open (required)
//   --size WxH           viewport in CSS px, repeatable (default 390x844);
//                        under 600 wide it emulates a phone (touch, no hover)
//   --full-page          make every shot a whole-document one
//   --dark | --light     emulate prefers-color-scheme
//   --reduced-motion     emulate prefers-reduced-motion: reduce
//   --forced-colors      emulate forced-colors: active (Windows high contrast)
//   --scale <n>          device scale factor (default 2)
//   --init "<js>"        run before the page's own scripts on every load,
//                        e.g. to seed localStorage; repeatable
//   --chromium <path>    browser binary (default $CHROMIUM or /usr/bin/chromium)
//
// Console errors, uncaught exceptions and failed requests print to stderr as
// "[size] console.error: ...". The exit code is 1 when any happened or a step
// failed (a --wait timed out, a --click found nothing), so `&& echo clean` works.
//
// Example (serve the repo first: npm run dev):
//   node dev/shoot.mjs --url 'http://127.0.0.1:5173/?loc=40.71,-74.01,New%20York' \
//     --size 390x844 --size 1440x900 --wait .pick --click .pick-name --wait 800 --out shots/detail.png
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const USAGE = 'usage: node dev/shoot.mjs --url <url> [--size WxH]... [--full-page] [--dark|--light] [--reduced-motion] [--forced-colors] [--scale n] [--init js]... '
  + '[--wait ms|selector | --click selector | --key name | --type text | --eval js | --shot file.png | --full-shot file.png]... [--out file.png]';
const WAIT_CAP = 15_000;
const KEYS = { Tab: 9, Enter: 13, Escape: 27, Space: 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
const STEPS = ['--wait', '--click', '--key', '--type', '--eval'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let problems = 0;
const problem = text => { problems++; console.error(text); };

function fail(message) {
  console.error(`shoot: ${message}\n${USAGE}`);
  process.exit(2);
}

function parseArgs(argv) {
  const o = { sizes: [], steps: [], init: [], scale: 2, scheme: null, fullPage: false, reducedMotion: false, forcedColors: false,
    chromium: process.env.CHROMIUM || '/usr/bin/chromium' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (i + 1 < argv.length ? argv[++i] : fail(`${a} needs a value`));
    if (a === '--url') o.url = val();
    else if (a === '--size') {
      const m = /^(\d+)x(\d+)$/.exec(val()) ?? fail('--size wants WxH, e.g. 390x844');
      o.sizes.push([+m[1], +m[2]]);
    } else if (a === '--full-page') o.fullPage = true;
    else if (a === '--dark' || a === '--light') o.scheme = a.slice(2);
    else if (a === '--reduced-motion') o.reducedMotion = true;
    else if (a === '--forced-colors') o.forcedColors = true;
    else if (a === '--scale') o.scale = +val() || fail('--scale wants a number');
    else if (a === '--init') o.init.push(val());
    else if (a === '--chromium') o.chromium = val();
    else if (STEPS.includes(a)) o.steps.push({ [a.slice(2)]: val() });
    else if (a === '--shot' || a === '--full-shot') o.steps.push({ shot: val(), full: a === '--full-shot' });
    else if (a === '--out') o.out = val();
    else if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
    else fail(`unknown argument ${a}`);
  }
  if (!o.url) fail('--url is required');
  if (!o.sizes.length) o.sizes.push([390, 844]);
  if (o.out) o.steps.push({ shot: o.out });
  if (!o.steps.some(s => s.shot)) fail('nothing to capture: give --out or --shot');
  for (const s of o.steps) if (s.key !== undefined && !(s.key in KEYS)) fail(`--key knows ${Object.keys(KEYS).join(', ')}`);
  return o;
}

// Start Chromium on a free port; it prints the browser's WebSocket URL to stderr.
async function launch(bin) {
  const profile = mkdtempSync(join(tmpdir(), 'shoot-'));
  const proc = spawn(bin, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--disable-extensions', '--disable-background-networking', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise(r => proc.once('exit', r));
  const wsUrl = await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error('Chromium did not start in 20 s')), 20_000);
    proc.stderr.on('data', d => {
      log += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(log);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.once('error', reject);
    exited.then(code => reject(new Error(`Chromium exited (${code}): ${log.slice(-500)}`)));
  });
  return {
    wsUrl,
    async close() {
      proc.kill();
      await Promise.race([exited, sleep(3000)]);
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

// A minimal CDP client: send() resolves with the result, on() sees every event.
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error(`can't connect to ${url}`)), { once: true });
  });
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    const p = msg.id && pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else if (msg.method) listeners.forEach(fn => fn(msg));
  });
  return {
    send(method, params = {}, sessionId) {
      const id = ++seq;
      ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
    },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close: () => ws.close(),
  };
}

const sizedName = (file, [w, h], many) => (many ? file.replace(/(\.png)?$/i, `-${w}x${h}.png`) : file);

function describe({ method, params: p }) {
  if (method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'assert')) {
    return `console.${p.type}: ${p.args.map(a => a.value ?? a.description ?? a.type).join(' ')}`;
  }
  if (method === 'Runtime.exceptionThrown') {
    const d = p.exceptionDetails;
    return `uncaught: ${d.exception?.description ?? d.text} (${d.url ?? ''}:${d.lineNumber + 1})`;
  }
  if (method === 'Log.entryAdded' && p.entry.level === 'error') return `${p.entry.source}: ${p.entry.text} ${p.entry.url ?? ''}`;
  return null;
}

async function runSize(cdp, o, size) {
  const [w, h] = size;
  const tag = `[${w}x${h}]`;
  const phone = w < 600;
  // A fresh browser context per size: its own localStorage, cookies and cache.
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => cdp.send(method, params, sessionId);
  const waiters = new Map();
  const off = cdp.on(msg => {
    if (msg.sessionId !== sessionId) return;
    waiters.get(msg.method)?.();
    const text = describe(msg);
    if (text) problem(`${tag} ${text}`);
  });
  const nextEvent = method => new Promise(r => waiters.set(method, () => { waiters.delete(method); r(); }));
  const evaluate = async (expression, replMode = false) => {
    const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true, replMode });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };

  await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable'].map(m => s(m)));
  await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: o.scale, mobile: phone });
  if (phone) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const features = [
    o.scheme && { name: 'prefers-color-scheme', value: o.scheme },
    o.reducedMotion && { name: 'prefers-reduced-motion', value: 'reduce' },
    o.forcedColors && { name: 'forced-colors', value: 'active' },
  ].filter(Boolean);
  if (features.length) await s('Emulation.setEmulatedMedia', { features });
  for (const source of o.init) await s('Page.addScriptToEvaluateOnNewDocument', { source });

  const loaded = nextEvent('Page.loadEventFired');
  const nav = await s('Page.navigate', { url: o.url });
  if (nav.errorText) throw new Error(`${o.url}: ${nav.errorText}`);
  await Promise.race([loaded, sleep(WAIT_CAP)]);
  await evaluate('document.fonts.ready.then(() => true)');

  for (const step of o.steps) {
    if (step.wait !== undefined) {
      if (/^\d+$/.test(step.wait)) { await sleep(+step.wait); continue; }
      const deadline = Date.now() + WAIT_CAP;
      while (!(await evaluate(`!!document.querySelector(${JSON.stringify(step.wait)})`))) {
        if (Date.now() > deadline) { problem(`${tag} wait timed out: ${step.wait}`); break; }
        await sleep(100);
      }
    } else if (step.click !== undefined) {
      const at = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(step.click)}); if (!el) return null;
        el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!at) { problem(`${tag} click: nothing matches ${step.click}`); continue; }
      if (phone) {
        for (const type of ['touchStart', 'touchEnd']) await s('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [at] });
      }
      else for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await s('Input.dispatchMouseEvent', { type, ...at, button: 'left', clickCount: 1 });
    } else if (step.key !== undefined) {
      const key = step.key === 'Space' ? ' ' : step.key;
      const text = { Enter: '\r', Space: ' ' }[step.key];
      const common = { key, code: step.key, windowsVirtualKeyCode: KEYS[step.key] };
      await s('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...common, ...(text && { text }) });
      await s('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
    } else if (step.type !== undefined) {
      await s('Input.insertText', { text: step.type });
    } else if (step.eval !== undefined) {
      try {
        // REPL mode (for top-level await) reports a bare {} for some undefined results.
        const value = await evaluate(step.eval, /\bawait\b/.test(step.eval));
        if (value !== undefined) console.log(`${tag} eval -> ${typeof value === 'string' ? value : JSON.stringify(value)}`);
      } catch (err) { problem(`${tag} eval failed: ${err.message.split('\n')[0]}`); }
    } else {
      const params = { format: 'png' };
      if (o.fullPage || step.full) {
        const { cssContentSize: c } = await s('Page.getLayoutMetrics');
        Object.assign(params, { captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.ceil(c.height), scale: 1 } });
      }
      const { data } = await s('Page.captureScreenshot', params);
      const file = sizedName(step.shot, size, o.sizes.length > 1);
      mkdirSync(dirname(file) || '.', { recursive: true });
      writeFileSync(file, Buffer.from(data, 'base64'));
      console.log(file);
    }
  }
  off();
  await cdp.send('Target.closeTarget', { targetId });
  await cdp.send('Target.disposeBrowserContext', { browserContextId });
}

const opts = parseArgs(process.argv.slice(2));
const browser = await launch(opts.chromium).catch(err => fail(err.message));
try {
  const cdp = await connect(browser.wsUrl);
  for (const size of opts.sizes) await runSize(cdp, opts, size);
  cdp.close();
} catch (err) {
  problem(`shoot: ${err.message}`);
} finally {
  await browser.close();
}
process.exit(problems ? 1 : 0);
