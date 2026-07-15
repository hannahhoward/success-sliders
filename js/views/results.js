// Results view — the private facilitator page (#/r/{exerciseId}[/{d}]).
// SECURITY: the decryption key is present here and every decrypted string is
// attacker-controllable. Everything renders as text through el() children;
// dynamic positions are assigned via node.style (CSP forbids style attributes).

import { el, mount, copyText, myExercises } from '../ui.js';
import { decryptResponse } from '../crypto.js';
import { configured, getExercise, watchResponses } from '../firebase.js';

// Same pattern the router matches — pulls the key out of a pasted results link.
const RESULTS_LINK_RE = /#\/r\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]{40,50})/;

export async function renderResults(exerciseId, dFromUrl) {
  let d = dFromUrl;
  if (d != null) {
    try {
      sessionStorage.setItem('ss:key:' + exerciseId, d);
    } catch {
      // Storage unavailable — the key still lives in this closure.
    }
    // Strip the key from the address bar; replaceState does not retrigger the router.
    history.replaceState(null, '', location.pathname + location.search + '#/r/' + exerciseId);
  } else {
    try {
      d = sessionStorage.getItem('ss:key:' + exerciseId);
    } catch {
      d = null;
    }
    if (!d) d = myExercises().find((e) => e.id === exerciseId)?.d ?? null;
  }

  if (!configured) {
    mount(el('div', { className: 'card stack-tight' },
      el('div', { className: 'banner' },
        'This deployment isn’t connected to its backend yet, so results can’t load.'),
      el('p', { className: 'muted small' }, 'Fill in firebase-config.js and redeploy to enable it.'),
    ));
    return;
  }

  if (!d) {
    renderKeyPrompt();
    return;
  }

  let ex = null;
  try {
    ex = await getExercise(exerciseId);
  } catch {
    ex = null;
  }
  if (!ex || typeof ex.title !== 'string' || !Array.isArray(ex.labels) || ex.labels.length < 2
    || !Number.isInteger(ex.max) || ex.max < 2 || !Number.isInteger(ex.budget) || !ex.pub) {
    mount(el('div', { className: 'card empty-state' },
      el('h2', {}, 'Exercise not found'),
      el('p', { className: 'muted' }, 'Check that you copied the whole link — or the exercise may no longer exist.'),
      el('a', { href: '#/' }, 'Create a new exercise'),
    ));
    return;
  }

  const formLink = location.origin + location.pathname + '#/s/' + exerciseId;
  const header = el('div', { className: 'card stack-tight' },
    el('h1', {}, ex.title),
    el('p', { className: 'muted' },
      `${ex.labels.length} dimensions · budget ${ex.budget} points · scale 1–${ex.max}`),
    el('div', { className: 'field' },
      el('span', { className: 'label' }, 'Form link — share with participants'),
      el('div', { className: 'link-box' },
        el('input', { className: 'input mono', readOnly: true, value: formLink, 'aria-label': 'Form link' }),
        el('button', { className: 'btn', type: 'button', onClick: () => copyText(formLink, 'Form link copied') }, 'Copy'),
      ),
    ),
    el('p', { className: 'small faint' }, 'This results page is private — don’t share its link.'),
  );

  const errorSlot = el('div');
  const region = el('div', { className: 'stack' });
  mount(el('div', { className: 'stack' }, header, errorSlot, region));

  const cache = new Map(); // doc.id → Promise<entry>; each doc is decrypted exactly once.
  let mode = 'aggregate';
  let latest = null;
  let seq = 0;

  const classify = async (doc) => {
    let obj;
    try {
      obj = await decryptResponse(ex.pub, d, exerciseId, doc);
    } catch {
      return { status: 'unreadable' };
    }
    // Decrypted plaintext is still untrusted — mirror the exercise rules.
    const name = typeof obj?.name === 'string' ? obj.name.trim().slice(0, 80) : '';
    const values = obj?.values;
    const ok = name.length > 0
      && Array.isArray(values) && values.length === ex.labels.length
      && values.every((v) => Number.isInteger(v) && v >= 1 && v <= ex.max)
      && values.reduce((a, b) => a + b, 0) === ex.budget;
    if (!ok) return { status: 'invalid', name };
    return { status: 'ok', name, values, created: doc.created };
  };

  const renderRegion = () => {
    if (!latest) return;
    const { ok, invalid, unreadable } = latest;
    const nodes = [];

    nodes.push(el('p', { className: 'muted small' },
      `${ok.length} response${ok.length === 1 ? '' : 's'}`,
      invalid.length ? [', ', el('span', {
        tabIndex: 0,
        dataset: { tip: 'Decrypted, but broke the exercise rules (name, values, or point total) — excluded from results.' },
      }, `${invalid.length} invalid`)] : null,
      unreadable ? [', ', el('span', {
        tabIndex: 0,
        dataset: { tip: 'Could not be decrypted — possibly tampered or corrupted' },
      }, `${unreadable} unreadable`)] : null,
    ));

    if (!ok.length) {
      nodes.push(el('div', { className: 'card empty-state' },
        el('p', { className: 'muted' }, 'No responses yet — share the form link above. New responses appear here live.'),
      ));
      region.replaceChildren(...nodes);
      return;
    }

    const segButton = (label, value) => el('button', {
      type: 'button',
      'aria-pressed': String(mode === value),
      onClick: () => {
        if (mode === value) return;
        mode = value;
        renderRegion();
      },
    }, label);
    nodes.push(el('div', { className: 'seg', role: 'group', 'aria-label': 'Results view' },
      segButton('Aggregate', 'aggregate'),
      segButton('Individual', 'individual'),
    ));

    if (mode === 'aggregate') {
      nodes.push(el('div', { className: 'card' }, ex.labels.map((label, i) => {
        const vals = ok.map((r) => r.values[i]);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const spread = Math.max(...vals) - Math.min(...vals);

        const track = el('div', { className: 'dot-track' });
        const groups = new Map(); // value → respondent names
        for (const r of ok) {
          if (!groups.has(r.values[i])) groups.set(r.values[i], []);
          groups.get(r.values[i]).push(r.name);
        }
        for (const [v, names] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
          const tip = `${names.join(', ')} (${names.length} of ${ok.length})`;
          // Stack up to 4 dots per value; the tooltip carries the full list.
          for (let k = 0; k < Math.min(names.length, 4); k++) {
            const dot = el('button', { type: 'button', className: 'dot', dataset: { tip }, 'aria-label': tip });
            dot.style.left = ((v - 1) / (ex.max - 1)) * 100 + '%';
            if (k > 0) dot.style.marginTop = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 7 + 'px';
            track.append(dot);
          }
        }
        const tick = el('div', { className: 'mean-tick' });
        tick.style.left = ((mean - 1) / (ex.max - 1)) * 100 + '%';
        track.append(tick);

        return el('div', { className: 'dotplot-row' },
          el('div', { className: 'dotplot-label' }, label,
            spread >= 2 ? el('span', { className: 'sub' }, 'wide spread') : null),
          track,
          el('div', { className: 'mean-value' }, mean.toFixed(1), el('span', { className: 'sub' }, 'mean')),
        );
      })));
    } else {
      nodes.push(...ok.map((r) => {
        const rows = ex.labels.map((label, i) => {
          const bar = el('div', { className: 'mini-bar' });
          bar.style.width = (r.values[i] / ex.max) * 100 + '%';
          return el('div', { className: 'mini-row' },
            el('span', { className: 'small' }, label),
            el('div', { className: 'mini-bar-track' }, bar),
            el('span', { className: 'mini-value' }, String(r.values[i])),
          );
        });
        return el('div', { className: 'respondent-card' },
          el('div', { className: 'row' },
            el('strong', {}, r.name),
            el('span', { className: 'small faint' }, r.created?.toDate?.().toLocaleString() ?? ''),
            r.dup ? el('span', { className: 'small error-text' }, 'duplicate name') : null,
          ),
          rows,
        );
      }));
      nodes.push(...invalid.map((r) => el('div', { className: 'respondent-card' },
        el('div', { className: 'row' },
          el('strong', {}, r.name || 'Unnamed'),
          el('span', { className: 'small error-text' }, 'invalid response — excluded from aggregate'),
        ),
      )));
    }

    region.replaceChildren(...nodes);
  };

  const onDocs = async (docs) => {
    const token = ++seq;
    for (const doc of docs) {
      if (!cache.has(doc.id)) cache.set(doc.id, classify(doc));
    }
    const entries = await Promise.all(docs.map((doc) => cache.get(doc.id)));
    if (token !== seq) return; // a newer snapshot already rendered
    const ok = entries.filter((e) => e.status === 'ok');
    const invalid = entries.filter((e) => e.status === 'invalid');
    const unreadable = entries.filter((e) => e.status === 'unreadable').length;
    const counts = new Map();
    for (const e of ok) counts.set(e.name.toLowerCase(), (counts.get(e.name.toLowerCase()) ?? 0) + 1);
    for (const e of ok) e.dup = counts.get(e.name.toLowerCase()) > 1;
    latest = { ok, invalid, unreadable };
    renderRegion();
  };

  return watchResponses(exerciseId, onDocs, () => {
    errorSlot.replaceChildren(el('div', { className: 'banner' }, 'Live connection lost — reload to retry.'));
  });
}

// No key in the URL, sessionStorage, or localStorage: ask for the full link.
function renderKeyPrompt() {
  const input = el('input', {
    className: 'input mono',
    type: 'text',
    placeholder: 'https://…#/r/…',
    'aria-label': 'Results link',
  });
  const errLine = el('p', { className: 'small error-text' });
  const open = () => {
    const m = input.value.match(RESULTS_LINK_RE);
    if (m) {
      location.hash = m[0]; // full route from the pasted link; the router re-enters
    } else {
      errLine.textContent = 'That doesn’t look like a results link.';
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') open();
  });
  mount(el('div', { className: 'card stack-tight' },
    el('h2', {}, 'Results link needed'),
    el('p', { className: 'muted' },
      'This browser doesn’t have the key for these results. Paste the full results link to open them.'),
    el('div', { className: 'link-box' },
      input,
      el('button', { className: 'btn btn-primary', type: 'button', onClick: open }, 'Open'),
    ),
    errLine,
  ));
}
