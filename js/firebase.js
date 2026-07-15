import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

// False until firebase-config.js is filled with a real project config.
export const configured =
  typeof firebaseConfig?.apiKey === 'string' && !firebaseConfig.apiKey.startsWith('__');

const db = configured ? getFirestore(initializeApp(firebaseConfig)) : null;

function store() {
  if (!db) throw new Error('This deployment is not connected to a backend yet.');
  return db;
}

// data: { title, labels, max, budget, pub } — see firestore.rules for shape.
export async function createExercise(data) {
  const ref = await addDoc(collection(store(), 'exercises'), { v: 1, ...data, created: serverTimestamp() });
  return ref.id;
}

export async function getExercise(id) {
  const snap = await getDoc(doc(store(), 'exercises', id));
  return snap.exists() ? snap.data() : null;
}

// payload: { eph, salt, iv, ct } from crypto.js encryptResponse.
export async function submitResponse(exerciseId, payload) {
  await addDoc(collection(store(), 'exercises', exerciseId, 'responses'), {
    v: 1,
    ...payload,
    created: serverTimestamp(),
  });
}

// Live-subscribes to responses, oldest first. Returns the unsubscribe fn.
export function watchResponses(exerciseId, onChange, onError) {
  const q = query(collection(store(), 'exercises', exerciseId, 'responses'), orderBy('created', 'asc'));
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  );
}
