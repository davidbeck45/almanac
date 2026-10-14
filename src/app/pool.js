// The pool client: how the app asks the suggestion pool its questions (the
// gap finder, buy checks, Discover's lists, dupes, records; src/pool-tasks.js
// lists them and their answers) without holding up the page. They go to one
// module Worker (src/pool-worker.js), started on the first ask and shared
// app-wide; where module Workers don't run, the same server runs on the main
// thread instead (imported then, so it costs nothing until then).
//
// askPool(type, payload, { channel }) -> a promise of the answer, with the
// worker's timings as `ms`. Spread src/app/state.js poolInputs() into the
// payload, so every screen asks about the same wardrobe, climate and
// settings. It rejects with an Error whose message can be shown as it is. A
// newer question on the same channel replaces the older one, which resolves
// { stale: true } (drop it) and, if it hasn't started, never runs: name a
// channel per list on screen ('disc-notes') so typing never shows an older
// answer over a newer one. No channel, nothing replaces it.
// Timeouts count from when the worker starts a question: one running longer
// than TIMEOUT is stuck, so it fails, the worker is replaced and the
// questions behind it go to the new one. While the pool downloads the clock
// stops (a slow line isn't a stuck question; a stalled one fails by itself),
// and a worker that isn't up within TIMEOUT counts as one that can't start.
// poolStatus() is 'idle' (nothing asked yet), 'loading' (the pool is on its
// way), 'ready' or 'error'.
// warmPool() starts loading early, for a page about to need it.
// onPoolRecords(fn) hears every dataset record an answer names (the wardrobe
// sent with it, and its switched-off bottles, aside): src/app/state.js keeps
// them, so findRecord(id) and the bottle page open any bottle in an answer
// at once.
// No DOM, no Worker until the first ask: tests make their own client
// (poolClient) with a fake worker.

// Long enough for a slow phone to work out a cold gap report many times over.
export const TIMEOUT = 60_000;
const SORRY = 'Something went wrong working that out. Try again.';
const TOO_LONG = 'Working that out took too long. Try again.';
const UNREACHABLE = 'Can’t reach the fragrance library. Check your connection.';
// The questions that don't load the pool (src/pool-tasks.js QUICK).
const QUICK = new Set(['liked', 'records']);
const WARM = Symbol('warm');

const startWorker = () => (typeof Worker === 'function'
  ? new Worker(new URL('../pool-worker.js', import.meta.url), { type: 'module' })
  : null);

/**
 * The main thread's stand-in for the Worker, shaped like one (postMessage,
 * terminate, onmessage, onerror): the same server (poolServer) with a cache
 * of its own, from `load()` (default: importing src/pool-tasks.js). It posts
 * { type: 'ready' } once loaded and answers with copies, as a Worker would,
 * so nothing on screen shares the pool's objects; once terminated it goes
 * quiet. When the import fails it errs, like a Worker that can't start.
 */
export function inlineWorker(load = () => import('../pool-tasks.js')) {
  let serve = null, dead = false;
  const early = [];
  const w = {
    onmessage: null,
    onerror: null,
    postMessage(msg) {
      if (dead) return;
      if (serve) serve(structuredClone(msg));
      else early.push(structuredClone(msg));
    },
    terminate() { dead = true; },
  };
  const later = fn => setTimeout(() => { if (!dead) fn(); }, 0);
  const deliver = data => {
    const copy = structuredClone(data); // throws here, to the server, when it can't be copied
    later(() => w.onmessage?.({ data: copy }));
  };
  Promise.resolve().then(load).then(({ poolServer }) => {
    if (dead) return;
    serve = poolServer(deliver);
    deliver({ type: 'ready' });
    for (const msg of early.splice(0)) serve(msg);
  }, err => later(() => w.onerror?.({ message: err?.message ?? String(err) })));
  return w;
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
 * `inline()` its main-thread stand-in (inlineWorker), `timeout` TIMEOUT in ms.
 */
export function poolClient({ worker: makeWorker = startWorker, inline: makeInline = inlineWorker, timeout = TIMEOUT } = {}) {
  let worker = null, ready = false, onMain = false, downloading = false, boot = null;
  let next = 0, status = 'idle';
  const pending = new Map(); // id -> { msg, resolve, reject, channel, timer (once started) }
  const channels = new Map(); // channel -> id of its latest question
  const recordFns = new Set();

  // A question's entry, no longer pending.
  function settle(id) {
    const entry = pending.get(id);
    if (!entry) return null;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (entry.channel != null && channels.get(entry.channel) === id) channels.delete(entry.channel);
    return entry;
  }

  // A clock from now; unref'd, so in Node (tests) a question left waiting doesn't keep the process up.
  function clock(fn) {
    const timer = setTimeout(fn, timeout);
    timer.unref?.();
    return timer;
  }

  // The clock on a question the worker has started.
  function arm(id) {
    const entry = pending.get(id);
    clearTimeout(entry.timer);
    entry.timer = clock(() => late(id));
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
      const { owned, exclude } = entry.msg.payload ?? {};
      const skip = new Set([owned, exclude].flatMap(list => (Array.isArray(list) ? list : [])).map(f => String(f?.id ?? f)));
      const found = [...recordsIn(result, skip).values()];
      if (found.length) for (const fn of recordFns) fn(found);
    }
    entry.resolve(result);
  }

  function hear({ data }) {
    if (data?.type === 'ready') {
      ready = true;
      clearTimeout(boot);
    } else if (data?.type === 'status') {
      downloading = data.status === 'loading';
      status = data.status;
    } else if (data?.type === 'start') {
      if (pending.has(data.id)) arm(data.id);
    } else if (data?.id != null) answer(data);
  }

  function stop() {
    worker?.terminate();
    clearTimeout(boot);
    [worker, ready, downloading] = [null, false, false];
  }

  // Every question waiting, sent again (to a fresh worker).
  function resend() {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      send(entry.msg);
    }
  }

  // A Worker that errs before it's ready can't run modules here: the main
  // thread takes over, with the questions waiting. One that errs later (it
  // shouldn't: the server never throws) fails what's waiting, and the next
  // ask starts a fresh one. The main thread's stand-in errs only when its
  // code can't load: what's waiting fails, and the next ask tries again.
  function broke(event) {
    event?.preventDefault?.();
    const [wasReady, wasMain] = [ready, onMain];
    stop();
    if (!wasReady && !wasMain) {
      onMain = true; // no more Workers
      resend();
      return;
    }
    const err = new Error(wasReady ? SORRY : UNREACHABLE);
    for (const id of [...pending.keys()]) settle(id).reject(err);
    status = 'error';
  }

  function workerFor() {
    if (worker) return worker;
    let w = null;
    if (!onMain) {
      try {
        w = makeWorker();
      } catch {
        w = null;
      }
      if (!w) onMain = true;
    }
    w ??= makeInline();
    // Only the current worker is heard: one replaced may still be talking.
    w.onmessage = event => { if (worker === w) hear(event); };
    w.onerror = event => { if (worker === w) broke(event); };
    w.onmessageerror = w.onerror;
    boot = clock(() => { if (worker === w && !ready) broke(); });
    return (worker = w);
  }

  function send(msg) {
    if (!QUICK.has(msg.type) && status !== 'ready') status = 'loading';
    workerFor().postMessage(msg);
  }

  // The older question on a channel: answered stale, and dropped if it hasn't started.
  function replace(id) {
    const entry = settle(id);
    if (!entry) return;
    entry.resolve({ stale: true });
    worker?.postMessage({ type: 'cancel', id });
  }

  // A question running past the timeout. While the pool downloads, the
  // clock starts over; otherwise it's stuck: it fails, and the rest go to a
  // fresh worker.
  function late(id) {
    if (!pending.has(id)) return;
    if (downloading) return arm(id);
    settle(id).reject(new Error(TOO_LONG));
    stop();
    if (status === 'ready') status = 'idle';
    resend();
  }

  function ask(type, payload = {}, { channel = null } = {}) {
    const id = ++next, msg = { id, type, payload };
    return new Promise((resolve, reject) => {
      if (channel != null && channels.has(channel)) replace(channels.get(channel));
      pending.set(id, { msg, resolve, reject, channel, timer: null });
      if (channel != null) channels.set(channel, id);
      send(msg);
    });
  }

  return {
    ask,
    warm() {
      if (status === 'idle' || status === 'error') ask('warm', {}, { channel: WARM }).catch(() => {});
    },
    status: () => status,
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
export const onPoolRecords = client.onRecords;
