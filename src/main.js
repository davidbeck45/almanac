// Boots the app. The forecast goes out first (src/app/early.js), while the
// shell (src/app/shell.js) and the views (src/views/) load: index.html
// preloads them all, so they download alongside it.
import { startForecast } from './app/early.js';

const early = startForecast();
// One module that doesn't arrive fails the whole import: the page says so,
// with Reload (showUnloaded, in index.html, which also hears this script fail
// when early.js's own modules don't arrive), rather than stay blank. Only the
// import: an error inside boot never wipes a page that works.
const shell = await import('./app/shell.js').catch(err => {
  showUnloaded();
  throw err;
});
shell.boot({ early });
