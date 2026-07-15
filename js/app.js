import { el, mount } from './ui.js';
import { renderHome } from './views/home.js';
import { renderForm } from './views/form.js';
import { renderResults } from './views/results.js';

// Hash routes: #/ (create) · #/s/{exerciseId} (form) · #/r/{exerciseId}/{key} (results).
// The results view strips the key from the URL bar on load (history.replaceState),
// so #/r/{exerciseId} without a key is also valid — it recovers the key from
// session/local storage or asks for the full link.
const ROUTES = [
  [/^$/, () => renderHome()],
  [/^s\/([A-Za-z0-9_-]{10,40})$/, (m) => renderForm(m[1])],
  [/^r\/([A-Za-z0-9_-]{10,40})\/([A-Za-z0-9_-]{40,50})$/, (m) => renderResults(m[1], m[2])],
  [/^r\/([A-Za-z0-9_-]{10,40})$/, (m) => renderResults(m[1], null)],
];

let cleanup = null;

async function route() {
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  window.scrollTo(0, 0);
  const path = location.hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  const match = ROUTES.map(([re, render]) => [path.match(re), render]).find(([m]) => m);
  if (!match) {
    mount(el('div', { className: 'card empty-state' },
      el('h2', {}, 'Not found'),
      el('p', { className: 'muted' }, 'This link doesn’t match anything here. Check that you copied the whole URL.'),
      el('a', { href: '#/' }, 'Create a new exercise'),
    ));
    return;
  }
  try {
    cleanup = await match[1](match[0]);
  } catch (err) {
    console.error(err);
    mount(el('div', { className: 'card empty-state' },
      el('h2', {}, 'Something went wrong'),
      el('p', { className: 'muted' }, String(err?.message ?? err)),
      el('a', { href: '#/' }, 'Back to start'),
    ));
  }
}

window.addEventListener('hashchange', route);
route();
