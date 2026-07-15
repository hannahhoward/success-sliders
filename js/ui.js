// Tiny DOM helpers. All user-controlled strings are set via textContent
// (never innerHTML) — XSS safety depends on every view building nodes
// through el()/text children.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key.startsWith('on')) {
      // Only ever functions — string handlers would become CSP-blocked inline attrs.
      if (typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key in node && key !== 'list' && key !== 'form') {
      node[key] = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

export function mount(...nodes) {
  const root = document.getElementById('app');
  root.replaceChildren(...nodes);
  return root;
}

export function toast(message) {
  document.querySelector('.toast')?.remove();
  const node = el('div', { className: 'toast', role: 'status' }, message);
  document.body.append(node);
  setTimeout(() => node.remove(), 2400);
}

export async function copyText(text, message = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast('Copy failed — select the text manually');
  }
}

// localStorage list of exercises created in this browser (convenience only;
// the results link is the real capability).
const MINE_KEY = 'success-sliders:mine';

export function rememberExercise(entry) {
  const mine = myExercises().filter((e) => e.id !== entry.id);
  mine.unshift(entry);
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(mine.slice(0, 50)));
  } catch {
    // Private-mode or full storage: the results link still works; just not remembered.
  }
}

export function myExercises() {
  try {
    return JSON.parse(localStorage.getItem(MINE_KEY)) ?? [];
  } catch {
    return [];
  }
}

export function forgetExercise(id) {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(myExercises().filter((e) => e.id !== id)));
  } catch {
    // Ignore — see rememberExercise.
  }
}
