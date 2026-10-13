// Bottles taken out of rotation on this device (empty, lent out, not feeling it).
const KEY = 'scentcast.hidden';

// Hidden until a device makes its own choice in Manage, so a first-time
// visitor (someone I send the link to) never sees these. They tidy the demo
// only: someone's own list or shared link shows every bottle in it.
export const DEFAULT_HIDDEN = [
  '4310', // Jake (Hollister)
];

// Whether the hidden set is this device's own choice rather than the defaults.
let chosen = false;

export function loadHidden() {
  try {
    const stored = localStorage.getItem(KEY);
    chosen = stored !== null;
    return new Set((stored === null ? DEFAULT_HIDDEN : JSON.parse(stored)).map(String));
  } catch {
    chosen = false;
    return new Set(DEFAULT_HIDDEN);
  }
}

export function saveHidden(hidden) {
  chosen = true;
  try { localStorage.setItem(KEY, JSON.stringify([...hidden])); } catch {}
}

// The ids to leave out of a list: everything hidden for the demo, and for any
// other list only what this device chose to hide.
export function hiddenFor(hidden, isDemo) {
  if (isDemo || chosen) return hidden;
  return new Set([...hidden].filter(id => !DEFAULT_HIDDEN.includes(id)));
}
