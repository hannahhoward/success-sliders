// Firebase web-app config. The apiKey is a public identifier, not a secret —
// all access control lives in firestore.rules.
// Filled from `firebase apps:sdkconfig web` once the project is provisioned.
export const firebaseConfig = {
  apiKey: '__FIREBASE_API_KEY__',
  authDomain: '__FIREBASE_PROJECT__.firebaseapp.com',
  projectId: '__FIREBASE_PROJECT__',
  storageBucket: '__FIREBASE_PROJECT__.firebasestorage.app',
  messagingSenderId: '__FIREBASE_SENDER_ID__',
  appId: '__FIREBASE_APP_ID__',
};
