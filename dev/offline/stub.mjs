// Answers the CLI's Open-Meteo requests from New York's saved weather
// (saved.mjs), for testing the CLI any day without the network:
//   node --import ./dev/offline/stub.mjs scripts/recommend.mjs --loc "40.71,-74.01,New York" …
// Test data only: whatever --loc or --city it's given (no lookup), the CLI
// runs on New York's saved week and climate, and its output names the place
// "New York (saved)", so an answer can't pass for another city's.
import { offlineData, offlineFetch, savedPlaceArgs, SAVED_NAME } from './saved.mjs';

const args = process.argv.slice(2), saved = savedPlaceArgs(args);
if (saved.join('\0') !== args.join('\0')) {
  console.error(`Offline: every place runs on New York's saved weather (test data), named "${SAVED_NAME}".`);
  process.argv.splice(2, Infinity, ...saved);
}
globalThis.fetch = offlineFetch(globalThis.fetch, offlineData());
