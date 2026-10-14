// The suggestion pool off the main thread: a module Worker (src/app/pool.js
// starts it) serving src/pool-tasks.js's questions through poolServer. Posts
// { type: 'ready' } once its modules load, so the client knows module
// Workers run here.
import { poolServer } from './pool-tasks.js';

const serve = poolServer(data => self.postMessage(data));
self.onmessage = ({ data }) => serve(data);
self.postMessage({ type: 'ready' });
