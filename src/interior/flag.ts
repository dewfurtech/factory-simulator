/**
 * The interior mode is not ready for customers, so its start button is hidden unless switched on.
 * Open the site once with `?interior` (or `?interior=1`) to turn it on in this browser; `?interior=0` turns it off.
 * The dev server hides it too. Interior projects already made still open and list either way.
 */
const KEY = 'factory:interior-mode';

export function interiorEnabled(search: string = location.search): boolean {
  const asked = new URLSearchParams(search).get('interior');
  try {
    if (asked !== null) {
      if (asked === '0' || asked === 'off') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, '1');
    }
    return localStorage.getItem(KEY) === '1';
  } catch {
    // Storage blocked (private window): follow the address alone.
    return (asked !== null && asked !== '0' && asked !== 'off');
  }
}
