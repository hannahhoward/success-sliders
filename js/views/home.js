// Home view: create an exercise, get its share links, and list exercises
// remembered in this browser.

import {
  copyText,
  el,
  forgetExercise,
  mount,
  myExercises,
  rememberExercise,
  toast,
} from '../ui.js';
import { generateExerciseKeys } from '../crypto.js';
import { configured, createExercise } from '../firebase.js';

const DEFAULT_LABELS = [
  'Deliver on time',
  'Deliver on budget',
  'Deliver all planned scope',
  'Meet quality requirements',
  'Stakeholder satisfaction',
  'Team satisfaction',
];

const POINTS_PER_SLIDER = 3;
const MIN_LABELS = 2;
const MAX_LABELS = 12;

export async function renderHome() {
  mount(...[formCard(), mineCard()].filter((n) => n != null));
}

function linkBase() {
  return location.origin + location.pathname;
}

function formUrl(id) {
  return linkBase() + '#/s/' + id;
}

function resultsUrl(id, d) {
  return linkBase() + '#/r/' + id + '/' + d;
}

// Empty string / fractional / out-of-widget values all read as 0 (invalid).
function intVal(input) {
  const v = input.valueAsNumber;
  return Number.isInteger(v) ? v : 0;
}

function fmtDate(ms) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formCard() {
  const labels = [...DEFAULT_LABELS];
  // Budget tracks 3×n until the user edits it by hand.
  let budgetTouched = false;
  // Guards against re-enabling Create (via update()) while a create is in flight.
  let creating = false;

  const titleInput = el('input', {
    className: 'input',
    id: 'x-title',
    maxLength: 120,
    required: true,
    placeholder: 'Q3 launch — success sliders',
    oninput: update,
  });

  const scaleInput = el('input', {
    className: 'input',
    id: 'x-scale',
    type: 'number',
    min: 2,
    max: 10,
    step: 1,
    value: 5,
    required: true,
    oninput: update,
  });

  const budgetInput = el('input', {
    className: 'input',
    id: 'x-budget',
    type: 'number',
    step: 1,
    value: POINTS_PER_SLIDER * labels.length,
    required: true,
    oninput: () => { budgetTouched = true; update(); },
  });

  const dimsWrap = el('div', { className: 'stack-tight' });

  const addBtn = el('button', {
    className: 'btn btn-small',
    type: 'button',
    onclick: () => {
      if (labels.length >= MAX_LABELS) return;
      labels.push('');
      syncBudget();
      renderDims();
      update();
      dimsWrap.lastElementChild?.querySelector('input')?.focus();
    },
  }, 'Add dimension');

  const errNode = el('p', { className: 'small error-text', hidden: true });

  const rememberInput = el('input', { type: 'checkbox', checked: true });

  const createBtn = el('button', { className: 'btn btn-primary', type: 'submit' }, 'Create exercise');

  function syncBudget() {
    if (budgetTouched) return;
    budgetInput.value = POINTS_PER_SLIDER * labels.length;
  }

  function renderDims() {
    dimsWrap.replaceChildren(...labels.map((value, i) => el('div', { className: 'row' },
      el('input', {
        className: 'input grow',
        value,
        maxLength: 80,
        required: true,
        'aria-label': 'Dimension ' + (i + 1),
        oninput: (e) => { labels[i] = e.target.value; update(); },
      }),
      el('button', {
        className: 'btn btn-small btn-quiet',
        type: 'button',
        disabled: labels.length <= MIN_LABELS,
        'aria-label': 'Remove dimension ' + (i + 1),
        onclick: () => {
          labels.splice(i, 1);
          syncBudget();
          renderDims();
          update();
          // The activated button was destroyed — keep keyboard focus in the list.
          dimsWrap.children[Math.min(i, labels.length - 1)]?.querySelector('input')?.focus();
        },
      }, '×'),
    )));
    addBtn.disabled = labels.length >= MAX_LABELS;
  }

  function update() {
    const n = labels.length;
    const maxV = intVal(scaleInput);
    const budgetV = intVal(budgetInput);
    budgetInput.min = n + 1;
    if (maxV) budgetInput.max = maxV * n - 1;
    let msg = '';
    if (labels.some((l) => !l.trim())) {
      msg = 'Every dimension needs a label.';
    } else if (!maxV || maxV < 2 || maxV > 10) {
      msg = 'Scale must be between 2 and 10.';
    } else if (!budgetV || budgetV <= n || budgetV >= maxV * n) {
      // Mirrors firestore.rules: n < budget < max×n, so every move up
      // must be offset by a move down.
      msg = 'Total points must be between ' + (n + 1) + ' and ' + (maxV * n - 1) +
        ' — with ' + n + ' sliders scored 1 to ' + maxV + ', anything else leaves nothing to trade off.';
    }
    errNode.textContent = msg;
    errNode.hidden = !msg;
    createBtn.disabled = !configured || creating || !!msg || !titleInput.value.trim();
  }

  async function create() {
    update();
    if (createBtn.disabled) return;
    const data = {
      title: titleInput.value.trim(),
      labels: labels.map((l) => l.trim()),
      max: intVal(scaleInput),
      budget: intVal(budgetInput),
    };
    creating = true;
    createBtn.disabled = true;
    createBtn.textContent = 'Creating…';
    try {
      const keys = await generateExerciseKeys();
      const id = await createExercise({ ...data, pub: keys.pub });
      const remembered = rememberInput.checked;
      if (remembered) rememberExercise({ id, title: data.title, d: keys.d, created: Date.now() });
      mount(...[shareCard(id, data.title, keys.d, remembered), mineCard()].filter((n) => n != null));
    } catch (err) {
      console.error(err);
      toast('Couldn\'t create the exercise — check your connection');
      creating = false;
      createBtn.disabled = false;
      createBtn.textContent = 'Create exercise';
    }
  }

  const card = el('div', { className: 'card stack' },
    el('div', {},
      el('h1', {}, 'Set project priorities, together'),
      el('p', { className: 'muted' },
        'Everyone spreads the same fixed budget of points across the sliders — when everything can\'t be top priority, the real trade-offs show up.'),
    ),
    configured ? null : el('div', { className: 'banner' },
      'This deployment isn\'t connected to its backend yet, so exercises can\'t be created. Fill in js/firebase-config.js to finish setup.'),
    el('form', { className: 'stack', onsubmit: (e) => { e.preventDefault(); create(); } },
      el('div', { className: 'field' },
        el('label', { className: 'label', htmlFor: 'x-title' }, 'Exercise name'),
        titleInput,
      ),
      el('div', { className: 'field' },
        el('span', { className: 'label' }, 'Dimensions'),
        el('div', { className: 'stack-tight' },
          dimsWrap,
          el('div', {}, addBtn),
        ),
      ),
      el('div', { className: 'row' },
        el('div', { className: 'field grow' },
          el('label', { className: 'label', htmlFor: 'x-scale' }, 'Scale (1 to…)'),
          scaleInput,
        ),
        el('div', { className: 'field grow' },
          el('label', { className: 'label', htmlFor: 'x-budget' }, 'Total points'),
          budgetInput,
        ),
      ),
      el('p', { className: 'small muted' }, '18 points across 6 sliders is the classic balanced setup.'),
      errNode,
      el('label', { className: 'small row' },
        rememberInput,
        el('span', {},
          'Remember this exercise in this browser ',
          el('span', { className: 'muted' }, '(skip on a shared computer)'),
        ),
      ),
      el('div', {}, createBtn),
    ),
  );

  renderDims();
  update();
  return card;
}

function linkField(labelText, url) {
  return el('div', { className: 'field' },
    el('span', { className: 'label' }, labelText),
    el('div', { className: 'link-box' },
      el('input', {
        className: 'input mono',
        value: url,
        readOnly: true,
        'aria-label': labelText,
        onfocus: (e) => e.target.select(),
      }),
      el('button', { className: 'btn', type: 'button', onclick: () => copyText(url) }, 'Copy'),
    ),
  );
}

function shareCard(id, title, d, remembered) {
  const rUrl = resultsUrl(id, d);
  return el('div', { className: 'card stack' },
    el('div', {},
      el('h2', {}, 'Share it'),
      el('p', { className: 'muted' }, title),
    ),
    linkField('Form link — send this to participants', formUrl(id)),
    linkField('Results link — keep this private', rUrl),
    el('div', { className: 'banner' },
      remembered
        ? 'The results link is the only key to the answers and can\'t be recovered if lost. It\'s also remembered in this browser, but save it somewhere safe too.'
        : 'The results link is the only key to the answers — save it somewhere safe now. It can\'t be recovered if you lose it.'),
    el('div', { className: 'row' },
      el('a', { className: 'btn btn-primary', href: rUrl }, 'Open results'),
      el('button', { className: 'btn btn-quiet', type: 'button', onclick: () => renderHome() }, 'Create another exercise'),
    ),
  );
}

function mineCard() {
  const mine = myExercises();
  if (!mine.length) return null;
  const card = el('div', { className: 'card stack' },
    el('h2', {}, 'Your exercises'),
    el('div', { className: 'stack-tight' }, mine.map((entry) => mineRow(entry, () => {
      const next = mineCard();
      if (next) card.replaceWith(next);
      else card.remove();
    }))),
  );
  return card;
}

function mineRow(entry, refresh) {
  const fUrl = formUrl(entry.id);
  const rUrl = resultsUrl(entry.id, entry.d);
  return el('div', { className: 'row' },
    el('div', { className: 'grow' },
      el('a', { href: rUrl }, entry.title || 'Untitled exercise'),
      el('div', { className: 'small faint' }, fmtDate(entry.created)),
    ),
    el('button', {
      className: 'btn btn-small',
      type: 'button',
      onclick: () => copyText(fUrl, 'Form link copied'),
    }, 'Copy form link'),
    el('button', {
      className: 'btn btn-small',
      type: 'button',
      onclick: () => copyText(rUrl, 'Results link copied'),
    }, 'Copy results link'),
    el('button', {
      className: 'btn btn-small btn-danger-quiet',
      type: 'button',
      onclick: () => { forgetExercise(entry.id); refresh(); },
    }, 'Forget'),
  );
}
