// Prints a dev/shoot.mjs --init script that answers the page's Open-Meteo
// requests from New York's saved weather (saved.mjs), so screenshots work
// any day without the network. --journal also fills an empty wear journal
// with the sample wears.
//   node dev/shoot.mjs --init "$(node dev/offline/init.mjs --journal)" \
//     --url 'http://127.0.0.1:5173/?loc=40.71,-74.01,New%20York#/wear/now' --wait .pick --out shots/now.png
import { offlineData, offlineFetch, shiftedHistory } from './saved.mjs';

const lines = [`window.fetch = (${offlineFetch})(window.fetch.bind(window), ${JSON.stringify(offlineData())});`];
// src/history.js's key; a reload keeps wears logged since.
if (process.argv.includes('--journal')) {
  lines.push(`if (!localStorage.getItem('scentcast.history')) localStorage.setItem('scentcast.history', ${JSON.stringify(JSON.stringify(shiftedHistory()))});`);
}
process.stdout.write(`{\n${lines.join('\n')}\n}\n`);
