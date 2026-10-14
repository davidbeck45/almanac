// The pool client: how the app asks the suggestion pool its questions (the
// gap finder, buy checks, Discover's lists, dupes, records; src/pool-tasks.js
// lists them and their answers) without holding up the page. They go to one
// module Worker (src/pool-worker.js), started on the first ask and shared
// app-wide; where module Workers don't run, the same code runs on the main
// thread instead (imported then, so it costs nothing until then).
//
// askPool(type, payload, { channel, timeout }) -> a promise of the answer,
// with the worker's timings as `ms`. It rejects with an Error whose message
// can be shown as it is. A newer question on the same channel replaces the
// older one, which resolves { stale: true } (drop it) and, if it hasn't
// started, never runs: name a channel per list on screen ('disc-notes') so
// typing never shows an older answer over a newer one. No channel, nothing
// replaces it. Past `timeout` ms (TIMEOUT) the question fails, and so does
// everything waiting with it, on a fresh worker next time.
// poolStatus() is 'idle' (nothing asked yet), 'loading' (the pool is on its
// way), 'ready' or 'error'; onPoolStatus(fn) hears each change (fn(status,
// error)) and returns a function that stops it. warmPool() starts loading
// early, for a page about to need it.
// onPoolRecords(fn) hears every dataset record an answer names (the wardrobe
// sent with it aside): src/app/state.js keeps them, so findRecord(id) and the
// bottle page open any bottle in an answer at once.
// No DOM, no Worker until the first ask: tests make their own client
// (poolClient) with a fake worker.

// Long enough for a slow phone to fetch and read the pool on a poor line.
export const TIMEOUT = 60_000;
const SORRY = 'Something went wrong working that out. Try again.';
const TOO_LONG = 'Working that out took too long. Try again.';
const UNREACHABLE = 'Can’t reach the fragrance library. Check your connection.';
// The questions that don't need the pool loaded.
const POOLLESS = new Set(['liked']);
const WARM = Symbol('warm');

const startWorker = () => (typeof Worker === 'function'
  ? new Worker(new URL('../pool-worker.js', import.meta.url), { type: 'module' })
  : null);

// The main thread's stand-in: handlePool with a cache of its own.
async function startInline(onStatus) {
  const { handlePool, newPoolCache } = await import('../pool-tasks.js');
  const cache = newPoolCache({ onStatus });
  return msg => handlePool(msg, cache);
}

// Every dataset record in an answer (objects with an id, accords and
// source 'fragrantica'), by id, leaving out `skip`.
function recordsIn(value, skip, out = new Map(), depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return out;
  if (Array.isArray(value)) {
    for (const v of value) recordsIn(v, skip, out, depth + 1);
  } else if (value.source === 'fragrantica' && typeof value.id === 'string' && value.accords) {
    if (!skip.has(value.id) && !out.has(value.id)) out.set(value.id, value);
  } else {
    for (const k in value) recordsIn(value[k], skip, out, depth + 1);
  }
  return out;
}

/**
 * A client of its own: `worker()` makes the Worker (null where there's none),
 * `inline(onStatus)` resolves a function that answers a message on the main
 * thread, `timeout` the default in ms.
 */
export function poolClient({ worker: makeWorker = startWorker, inline: makeInline = startInline, timeout: defaultTimeout = TIMEOUT } = {}) {
  let worker = null, ready = false, runner = null, line = Promise.resolve();
  let next = 0, status = 'idle', error = null;
  const pending = new Map(); // id -> { msg, resolve, reject, timer, channel }
  const channels = new Map(); // channel -> id of its latest question
  const statusFns = new Set(), recordFns = new Set();

  function setStatus(to, err = null) {
    if (to === status && err === error) return;
    [status, error] = [to, err];
    for (const fn of statusFns) fn(status, error);
  }

  // A question's entry, no longer pending.
  function settle(id) {
    const entry = pending.get(id);
    if (!entry) return null;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (entry.channel != null && channels.get(entry.channel) === id) channels.delete(entry.channel);
    return entry;
  }

  function answer(data) {
    const entry = settle(data.id);
    if (!entry) return; // replaced, or timed out
    if (data.error != null) {
      const err = new Error(data.error);
      if (data.detail) err.detail = data.detail;
      entry.reject(err);
      return;
    }
    const result = data.result;
    if (data.ms) result.ms = data.ms;
    if (recordFns.size) {
      const owned = entry.msg.payload?.owned;
      const skip = new Set((Array.isArray(owned) ? owned : []).map(f => String(f.id)));
      const found = [...recordsIn(result, skip).values()];
      if (found.length) for (const fn of recordFns) fn(found);
    }
    entry.resolve(result);
  }

  function hear({ data }) {
    if (data?.type === 'ready') ready = true;
    else if (data?.type === 'status') setStatus(data.status, data.error ?? null);
    else if (data?.id != null) answer(data);
  }

  // Every question waiting fails with `err`; the pool's status says so.
  function abandon(err) {
    for (const id of [...pending.keys()]) settle(id).reject(err);
    setStatus('error', err.message);
  }

  function stop() {
    worker?.terminate();
    [worker, ready] = [null, false];
  }

  // A Worker that errs before it's ready can't run modules here: the main
  // thread takes over, with the questions waiting. One that errs later (it
  // shouldn't: handlePool never throws) fails what's waiting, and the next
  // ask starts a fresh one.
  function broke(event) {
    event?.preventDefault?.();
    if (ready) {
      stop();
      abandon(new Error(SORRY));
      return;
    }
    stop();
    runner ??= true; // no more Workers
    for (const entry of pending.values()) runInline(entry.msg);
  }

  function workerFor() {
    if (worker || runner) return worker;
    try {
      worker = makeWorker();
    } catch {
      worker = null;
    }
    if (!worker) {
      runner = true;
      return null;
    }
    worker.onmessage = hear;
    worker.onerror = broke;
    worker.onmessageerror = broke;
    return worker;
  }

  // On the main thread, one question at a time like the worker; one replaced
  // or timed out before its turn doesn't run.
  function runInline(msg) {
    line = line.then(() => runOne(msg)).catch(() => {});
  }

  async function runOne(msg) {
    if (!pending.has(msg.id)) return;
    let run;
    try {
      if (runner === true) runner = makeInline((to, err = null) => setStatus(to, err));
      run = await runner;
    } catch {
      runner = true; // try the import again next time
      setStatus('error', UNREACHABLE);
      answer({ id: msg.id, error: UNREACHABLE });
      return;
    }
    let data;
    try {
      // A copy, as a Worker's answer would be: nothing on screen shares the pool's objects.
      data = structuredClone(await run(msg));
    } catch {
      data = { id: msg.id, error: SORRY };
    }
    answer(data);
  }

  function send(msg) {
    const w = workerFor();
    if (w) w.postMessage(msg);
    else runInline(msg);
  }

  // The older question on a channel: answered stale, and dropped if it hasn't started.
  function replace(id) {
    const entry = settle(id);
    if (!entry) return;
    entry.resolve({ stale: true });
    worker?.postMessage({ type: 'cancel', id });
  }

  // A question this late is stuck behind (or in) one that won't finish: start over.
  function late(id) {
    if (!pending.has(id)) return;
    stop();
    abandon(new Error(TOO_LONG));
  }

  function ask(type, payload = {}, { channel = null, timeout = defaultTimeout } = {}) {
    const id = ++next, msg = { id, type, payload };
    return new Promise((resolve, reject) => {
      if (channel != null && channels.has(channel)) replace(channels.get(channel));
      const timer = setTimeout(() => late(id), timeout);
      timer.unref?.(); // in Node (tests), a question left waiting doesn't keep the process up
      pending.set(id, { msg, resolve, reject, channel, timer });
      if (channel != null) channels.set(channel, id);
      if (!POOLLESS.has(type) && status !== 'ready') setStatus('loading');
      send(msg);
    });
  }

  return {
    ask,
    warm() {
      if (status === 'idle' || status === 'error') ask('warm', {}, { channel: WARM }).catch(() => {});
    },
    status: () => status,
    onStatus(fn) {
      statusFns.add(fn);
      return () => statusFns.delete(fn);
    },
    onRecords(fn) {
      recordFns.add(fn);
      return () => recordFns.delete(fn);
    },
  };
}

// The app's one client.
const client = poolClient();
export const askPool = client.ask;
export const warmPool = client.warm;
export const poolStatus = client.status;
export const onPoolStatus = client.onStatus;
export const onPoolRecords = client.onRecords;
