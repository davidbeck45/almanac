// Prints a wear journal export (the app's Export) holding the sample wears,
// moved to today, for trying --journal without David's own file:
//   node dev/offline/journal.mjs > /tmp/journal.json
import { journalExport } from '../../src/history.js';
import { NEW_YORK, shiftedHistory } from './saved.mjs';

process.stdout.write(`${JSON.stringify(journalExport(shiftedHistory(), NEW_YORK, []), null, 2)}\n`);
