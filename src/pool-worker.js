// The suggestion pool off the main thread: a module Worker (src/app/pool.js
// starts it) that answers src/pool-tasks.js's questions one at a time, in
// the order asked. Posts { type: 'ready' } once its modules load (so the
// client knows module Workers run here), { type: 'status', status, error }
// as the pool loads, and each answer as handlePool makes it. { type:
// 'cancel', id } drops a question that hasn't started: the client sends it
// when a newer one on the same channel replaces it.
import { handlePool, newPoolCache } from './pool-tasks.js';

const cache = newPoolCache({ onStatus: (status, error = null) => self.postMessage({ type: 'status', status, error }) });
let queue = [], busy = false;

// A macrotask between questions, so a cancel posted meanwhile lands first.
const breathe = () => new Promise(resolve => setTimeout(resolve, 0));

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    self.postMessage(await handlePool(queue.shift(), cache));
    await breathe();
  }
  busy = false;
}

self.onmessage = ({ data }) => {
  if (data?.type === 'cancel') queue = queue.filter(m => m.id !== data.id);
  else {
    queue.push(data);
    pump();
  }
};
self.postMessage({ type: 'ready' });
