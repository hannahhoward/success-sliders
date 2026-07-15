// Live E2E smoke test for success-sliders against the real Firestore project.
// Exercises the exact client code path (web SDK + the app's own crypto.js) and
// verifies the security rules deny everything they should.
//
// Usage: node e2e.mjs '<firebaseConfig JSON>'
// Note: created docs cannot be deleted by design (rules deny delete) — this
// leaves a handful of small test docs behind; clean via Firebase console.

import { initializeApp } from 'firebase/app';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import {
  b64uEncode, decryptResponse, encryptResponse, generateExerciseKeys,
} from '../../js/crypto.js';

const config = JSON.parse(process.argv[2] ?? 'null');
if (!config?.projectId) {
  console.error('pass the firebase config JSON as argv[2]');
  process.exit(2);
}

const db = getFirestore(initializeApp(config));
let pass = 0;
let fail = 0;

async function check(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    fail++;
    console.log(`FAIL  ${name}: ${err.message}`);
  }
}

async function expectDenied(name, fn) {
  await check(name, async () => {
    try {
      await fn();
    } catch (err) {
      if (err.code === 'permission-denied') return;
      throw new Error(`expected permission-denied, got: ${err.code ?? err.message}`);
    }
    throw new Error('expected permission-denied, but the write/read succeeded');
  });
}

const keys = await generateExerciseKeys();
const exercise = {
  v: 1,
  title: 'E2E smoke test exercise',
  labels: ['Deliver on time', 'Deliver on budget', 'Meet quality requirements'],
  max: 5,
  budget: 9,
  pub: keys.pub,
};

// --- positive path -----------------------------------------------------------
let exerciseId;
await check('create exercise', async () => {
  const ref = await addDoc(collection(db, 'exercises'), { ...exercise, created: serverTimestamp() });
  exerciseId = ref.id;
});

await check('read exercise back', async () => {
  const snap = await getDoc(doc(db, 'exercises', exerciseId));
  if (!snap.exists()) throw new Error('missing');
  const d = snap.data();
  if (d.title !== exercise.title || d.pub.x !== keys.pub.x) throw new Error('data mismatch');
});

const respondents = [
  { name: 'Ana', values: [4, 2, 3] },
  { name: 'Raj', values: [3, 3, 3] },
  { name: 'Zoë', values: [5, 1, 3] },
];

await check('submit 3 encrypted responses', async () => {
  for (const r of respondents) {
    const payload = await encryptResponse(keys.pub, exerciseId, r);
    await addDoc(collection(db, 'exercises', exerciseId, 'responses'), {
      v: 1, ...payload, created: serverTimestamp(),
    });
  }
});

await check('list + decrypt all responses, plaintexts match', async () => {
  const snap = await getDocs(collection(db, 'exercises', exerciseId, 'responses'));
  if (snap.size !== 3) throw new Error(`expected 3 docs, got ${snap.size}`);
  const decrypted = [];
  for (const d of snap.docs) decrypted.push(await decryptResponse(keys.pub, keys.d, exerciseId, d.data()));
  for (const r of respondents) {
    const hit = decrypted.find((p) => p.name === r.name);
    if (!hit || JSON.stringify(hit.values) !== JSON.stringify(r.values)) {
      throw new Error(`decrypted payload mismatch for ${r.name}`);
    }
  }
});

await check('AAD binding: ciphertext from another exercise fails to decrypt', async () => {
  const payload = await encryptResponse(keys.pub, 'someOtherExerciseId0', { name: 'Eve', values: [3, 3, 3] });
  try {
    await decryptResponse(keys.pub, keys.d, exerciseId, payload);
  } catch {
    return;
  }
  throw new Error('decryption unexpectedly succeeded across exercise ids');
});

// --- rules must deny ---------------------------------------------------------
await expectDenied('deny: list exercises collection', () => getDocs(collection(db, 'exercises')));
await expectDenied('deny: update exercise', () => updateDoc(doc(db, 'exercises', exerciseId), { title: 'tampered' }));
await expectDenied('deny: delete exercise', () => deleteDoc(doc(db, 'exercises', exerciseId)));
await expectDenied('deny: exercise with extra field', () =>
  addDoc(collection(db, 'exercises'), { ...exercise, junk: true, created: serverTimestamp() }));
await expectDenied('deny: exercise with oversized title', () =>
  addDoc(collection(db, 'exercises'), { ...exercise, title: 'x'.repeat(200), created: serverTimestamp() }));
await expectDenied('deny: exercise with degenerate budget (= n)', () =>
  addDoc(collection(db, 'exercises'), { ...exercise, budget: 3, created: serverTimestamp() }));
await expectDenied('deny: exercise with client-set created', () =>
  addDoc(collection(db, 'exercises'), { ...exercise, created: new Date() }));

const validPayload = await encryptResponse(keys.pub, exerciseId, { name: 'Sam', values: [3, 3, 3] });
await expectDenied('deny: response under nonexistent exercise', () =>
  addDoc(collection(db, 'exercises', 'doesNotExist000000000', 'responses'),
    { v: 1, ...validPayload, created: serverTimestamp() }));
await expectDenied('deny: response with oversized ct', () =>
  addDoc(collection(db, 'exercises', exerciseId, 'responses'),
    { v: 1, ...validPayload, ct: b64uEncode(new Uint8Array(9000)), created: serverTimestamp() }));
await expectDenied('deny: response with extra field', () =>
  addDoc(collection(db, 'exercises', exerciseId, 'responses'),
    { v: 1, ...validPayload, junk: 1, created: serverTimestamp() }));

let firstResponseId;
{
  const snap = await getDocs(collection(db, 'exercises', exerciseId, 'responses'));
  firstResponseId = snap.docs[0].id;
}
await expectDenied('deny: update response', () =>
  updateDoc(doc(db, 'exercises', exerciseId, 'responses', firstResponseId), { ct: 'AAAA' }));
await expectDenied('deny: delete response', () =>
  deleteDoc(doc(db, 'exercises', exerciseId, 'responses', firstResponseId)));

console.log(`\n${pass} passed, ${fail} failed`);
console.log(`test exercise: ${exerciseId} (remove via Firebase console if desired)`);
process.exit(fail === 0 ? 0 : 1);
