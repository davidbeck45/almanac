// Answers the CLI's Open-Meteo requests from New York's saved weather (saved.mjs):
//   node --import ./dev/offline/stub.mjs scripts/recommend.mjs --loc "40.71,-74.01,New York" …
// --city still looks the place up online; --loc doesn't.
import { offlineData, offlineFetch } from './saved.mjs';

globalThis.fetch = offlineFetch(globalThis.fetch, offlineData());
