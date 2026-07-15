// Participant view: allocate a fixed point budget across the exercise's
// dimensions. The sum must equal the budget exactly to submit — every move
// up has to be paid for by a move down.

import { el, mount, toast } from '../ui.js';
import { encryptResponse } from '../crypto.js';
import { configured, getExercise, submitResponse } from '../firebase.js';

const DEFAULT_LABELS = [
  'Deliver on time',
  'Deliver on budget',
  'Deliver all planned scope',
  'Meet quality requirements',
  'Stakeholder satisfaction',
  'Team satisfaction',
];

const SUBMITTED_KEY = 'ss:submitted:';

function hasSubmitted(exerciseId) {
  try {
    return localStorage.getItem(SUBMITTED_KEY + exerciseId) != null;
  } catch {
    return false;
  }
}

function markSubmitted(exerciseId) {
  try {
    localStorage.setItem(SUBMITTED_KEY + exerciseId, new Date().toISOString());
  } catch {
    // Private-mode or full storage: only loses the repeat-submission banner.
  }
}

// Mirror of firestore.rules validExercise() for the fields this view uses.
// Returns a normalized copy, or null if the doc is malformed.
function validateExercise(doc) {
  if (!doc || typeof doc !== 'object') return null;
  if (!Array.isArray(doc.labels) || doc.labels.length < 2 || doc.labels.length > 12) return null;
  const labels = doc.labels.map(String);
  const { max, budget } = doc;
  if (!Number.isInteger(max) || max < 2 || max > 10) return null;
  if (!Number.isInteger(budget) || budget <= labels.length || budget >= max * labels.length) return null;
  if (!doc.pub || typeof doc.pub.x !== 'string' || typeof doc.pub.y !== 'string') return null;
  const title = String(doc.title ?? '').trim() || 'Untitled exercise';
  return { title, labels, max, budget, pub: { x: doc.pub.x, y: doc.pub.y } };
}

// Balanced start: sum already equals the budget, so participants begin at
// "everything matters equally" and must trade to express priorities.
function balancedValues(n, max, budget) {
  const base = Math.min(Math.max(Math.floor(budget / n), 1), max);
  const values = new Array(n).fill(base);
  let rest = budget - base * n;
  for (let i = 0; i < n && rest > 0; i++) {
    if (values[i] < max) {
      values[i] += 1;
      rest -= 1;
    }
  }
  return values;
}

function plural(count, noun) {
  return count + ' ' + noun + (count === 1 ? '' : 's');
}

function renderNotFound() {
  mount(el('div', { className: 'card empty-state' },
    el('h2', {}, 'Exercise not found'),
    el('p', { className: 'muted' },
      'This link may be wrong, or the exercise may have been removed. Check that you copied the whole URL from your facilitator.'),
    el('a', { href: '#/' }, 'Create a new exercise'),
  ));
}

function renderSuccess(exerciseId, name) {
  mount(el('div', { className: 'card empty-state' },
    el('h2', {}, `Thanks, ${name} — your response is in.`),
    el('p', { className: 'small muted' },
      'Made a mistake? You can submit again — the facilitator will see both responses.'),
    el('a', {
      href: '#/s/' + exerciseId,
      onclick: (e) => {
        e.preventDefault();
        renderForm(exerciseId);
      },
    }, 'Submit another response'),
  ));
}

function renderExercise(exerciseId, ex, offline) {
  const { labels, max, budget } = ex;
  const n = labels.length;
  let submitting = false;

  const meterFill = el('div', { className: 'meter-fill' });
  const meterValue = el('span', { className: 'value' }, '');
  const meter = el('div', { className: 'points-meter' },
    el('span', {}, 'Points used'),
    el('div', { className: 'meter-track' }, meterFill),
    meterValue,
  );

  const status = el('div', { className: 'small muted', role: 'status' }, '');

  const nameInput = el('input', {
    className: 'input',
    type: 'text',
    maxLength: 80,
    required: true,
    autocomplete: 'name',
    placeholder: 'So the facilitator knows whose answer this is',
    oninput: () => refresh(),
  });

  const submitBtn = el('button', {
    className: 'btn btn-primary',
    type: 'button',
    onclick: () => submit(),
  }, 'Submit response');
  submitBtn.style.width = '100%';

  const sliders = balancedValues(n, max, budget).map((start, i) => {
    const chip = el('span', { className: 'chip' }, String(start));
    const input = el('input', {
      className: 'range',
      type: 'range',
      min: 1,
      max,
      step: 1,
      value: String(start),
      'aria-label': labels[i],
    });
    const setFill = (v) => input.style.setProperty('--fill', ((v - 1) / (max - 1)) * 100 + '%');
    setFill(start);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      chip.textContent = String(v);
      setFill(v);
      refresh();
    });
    const row = el('div', { className: 'slider-row' },
      el('div', { className: 'slider-head' },
        el('span', { className: 'slider-label' }, labels[i]),
        chip,
      ),
      input,
      el('div', { className: 'ticks', 'aria-hidden': 'true' },
        Array.from({ length: max }, (_, s) => el('span', {}, String(s + 1))),
      ),
    );
    return { input, row };
  });

  function used() {
    return sliders.reduce((sum, s) => sum + Number(s.input.value), 0);
  }

  function refresh() {
    const u = used();
    meterValue.textContent = u + ' / ' + budget;
    meterFill.style.width = Math.min(100, (u / budget) * 100) + '%';
    meter.classList.toggle('done', u === budget);
    meter.classList.toggle('over', u > budget);
    if (u < budget) {
      status.replaceChildren(plural(budget - u, 'point') + ' left to allocate');
    } else if (u > budget) {
      status.replaceChildren(el('span', { className: 'error-text' },
        plural(u - budget, 'point') + ' over — take some back'));
    } else {
      status.replaceChildren(nameInput.value.trim() === '' ? 'Add your name to submit.' : 'Ready to submit.');
    }
    submitBtn.disabled = offline || submitting || nameInput.value.trim() === '' || u !== budget;
  }

  async function submit() {
    const name = nameInput.value.trim().slice(0, 80);
    const values = sliders.map((s) => Number(s.input.value));
    if (offline || name === '' || values.reduce((a, b) => a + b, 0) !== budget) return;
    submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
    try {
      const payload = await encryptResponse(ex.pub, exerciseId, { name, values });
      await submitResponse(exerciseId, payload);
      markSubmitted(exerciseId);
      renderSuccess(exerciseId, name);
    } catch (err) {
      console.error(err);
      toast('Submitting failed — please try again');
      submitting = false;
      submitBtn.textContent = 'Submit response';
      refresh();
    }
  }

  mount(el('div', { className: 'stack' },
    hasSubmitted(exerciseId) && el('div', { className: 'banner' },
      'You’ve already submitted to this exercise — submitting again adds a second response.'),
    offline && el('div', { className: 'card' },
      el('div', { className: 'banner' },
        'This deployment isn’t connected to its backend yet, so responses can’t be submitted.'),
    ),
    el('div', {},
      el('h1', {}, ex.title),
      el('p', { className: 'muted' },
        `Distribute exactly ${budget} points across these ${n} dimensions on a 1–${max} scale. ` +
        'Everything can’t be top priority — to move one up, take another down.'),
    ),
    meter,
    el('div', { className: 'card' },
      sliders.map((s) => s.row),
      el('hr', { className: 'divider' }),
      el('div', { className: 'stack' },
        el('label', { className: 'field' },
          el('span', { className: 'label' }, 'Your name'),
          nameInput,
        ),
        submitBtn,
        status,
      ),
    ),
  ));
  refresh();
}

export async function renderForm(exerciseId) {
  mount(el('div', { className: 'card empty-state' },
    el('p', { className: 'muted' }, 'Loading…'),
  ));

  if (!configured) {
    // No backend: show the exercise UI with canonical defaults so the page
    // is still previewable; the banner + disabled submit explain why.
    renderExercise(exerciseId, {
      title: 'Success Sliders',
      labels: DEFAULT_LABELS,
      max: 5,
      budget: 18,
      pub: null,
    }, true);
    return;
  }

  let doc = null;
  try {
    doc = await getExercise(exerciseId);
  } catch (err) {
    // Network failure ≠ bad link: getExercise returns null only when the doc
    // genuinely doesn't exist, and throws when it couldn't be fetched.
    console.error(err);
    mount(el('div', { className: 'card empty-state' },
      el('h2', {}, 'Couldn’t load the exercise'),
      el('p', { className: 'muted' }, 'Check your connection and reload this page.'),
    ));
    return;
  }
  const ex = validateExercise(doc);
  if (!ex) {
    renderNotFound();
    return;
  }
  renderExercise(exerciseId, ex, false);
}
