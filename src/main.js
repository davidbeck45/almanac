// Boots the app. The forecast goes out first (src/app/early.js), while the
// shell (src/app/shell.js) and the views (src/views/) load: index.html
// preloads them all, so they download alongside it.
import { startForecast } from './app/early.js';

const early = startForecast();
const { boot } = await import('./app/shell.js');
boot({ early });
