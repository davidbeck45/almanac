// Bottles taken out of rotation on this device (empty, lent out, not feeling it).
const KEY = 'scentcast.hidden'; // ids this device hid, in any list
const SHOWN_KEY = 'scentcast.shown'; // DEFAULT_HIDDEN ids it switched back on in the demo

// Hidden from the demo until a device switches them on in Manage, so a
// first-time visitor (someone I send the link to) never sees these. They tidy
// the demo only: someone's own list or shared link shows every bottle in it.
export const DEFAULT_HIDDEN = [
  '4310', // Jake (Hollister)
];

const isDefault = id => DEFAULT_HIDDEN.includes(id);

function read(key) {
  const stored = localStorage.getItem(key);
  return stored === null ? null : JSON.parse(stored).map(String);
}

// { hidden, shown }: the device's own hides, and the defaults it turned back
// on. Before the split, one stored list held the defaults too; a default in it
// was still hidden, and one missing from it had been switched on.
export function loadHidden() {
  try {
    const stored = read(KEY) ?? [];
    let shown = read(SHOWN_KEY);
    if (shown === null && localStorage.getItem(KEY) !== null) shown = DEFAULT_HIDDEN.filter(id => !stored.includes(id));
    return { hidden: new Set(stored.filter(id => !isDefault(id))), shown: new Set(shown ?? []) };
  } catch {
    return { hidden: new Set(), shown: new Set() };
  }
}

export function saveHidden({ hidden, shown }) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...hidden]));
    localStorage.setItem(SHOWN_KEY, JSON.stringify([...shown]));
  } catch {}
}

// The ids to leave out of a list: the device's own hides everywhere, plus the
// defaults it hasn't switched on when the list is the demo.
export function hiddenFor({ hidden, shown }, isDemo) {
  if (!isDemo) return new Set(hidden);
  return new Set([...hidden, ...DEFAULT_HIDDEN.filter(id => !shown.has(id))]);
}

// Hides or shows a bottle in one list and saves. A default switched in the
// demo only moves it in or out of `shown`, so it never leaks into other lists.
export function setHidden(state, id, hide, isDemo) {
  if (isDemo && isDefault(id)) {
    if (hide) {
      state.shown.delete(id);
    } else {
      state.shown.add(id);
      state.hidden.delete(id);
    }
  } else if (hide) {
    state.hidden.add(id);
  } else {
    state.hidden.delete(id);
  }
  saveHidden(state);
}
