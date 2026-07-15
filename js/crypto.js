// End-to-end encryption for responses.
//
// Each exercise has a P-256 keypair. The public key lives on the (publicly
// readable) exercise doc; the private scalar `d` lives only in the results
// URL fragment and, optionally, the creator's localStorage. It is never sent
// to any server — URL fragments don't leave the browser.
//
// Every response is encrypted ECIES-style with a fresh ephemeral keypair:
//   ECDH(ephemeral_priv, exercise_pub) → HKDF-SHA256(salt, info) → AES-256-GCM
// The exercise id is bound as AAD, so a ciphertext copied into another
// exercise's responses will not decrypt.

const EC = { name: 'ECDH', namedCurve: 'P-256' };
const HKDF_INFO = new TextEncoder().encode('success-sliders/v1');

export function b64uEncode(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function b64uDecode(str) {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  const s = atob(padded.replaceAll('-', '+').replaceAll('_', '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// → { pub: {x, y}, d }  (all base64url strings, JWK field encoding)
export async function generateExerciseKeys() {
  const pair = await crypto.subtle.generateKey(EC, true, ['deriveBits']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { pub: { x: jwk.x, y: jwk.y }, d: jwk.d };
}

function importPub(pub) {
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', ...pub }, EC, false, []);
}

async function deriveAesKey(privateKey, publicKey, salt, use) {
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: HKDF_INFO },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    [use],
  );
}

// Encrypt a response object against an exercise public key ({x, y}).
// → { eph: {x, y}, salt, iv, ct }  (base64url strings, matches firestore.rules)
export async function encryptResponse(exercisePub, exerciseId, obj) {
  const eph = await crypto.subtle.generateKey(EC, true, ['deriveBits']);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(eph.privateKey, await importPub(exercisePub), salt, 'encrypt');
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(exerciseId) },
    key,
    new TextEncoder().encode(JSON.stringify(obj)),
  );
  const ephJwk = await crypto.subtle.exportKey('jwk', eph.publicKey);
  return { eph: { x: ephJwk.x, y: ephJwk.y }, salt: b64uEncode(salt), iv: b64uEncode(iv), ct: b64uEncode(ct) };
}

// Decrypt one response doc using the exercise private scalar `d` plus the
// public {x, y} from the exercise doc. Throws on tampered/foreign ciphertext.
export async function decryptResponse(exercisePub, d, exerciseId, res) {
  const priv = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', ...exercisePub, d },
    EC,
    false,
    ['deriveBits'],
  );
  const key = await deriveAesKey(priv, await importPub(res.eph), b64uDecode(res.salt), 'decrypt');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64uDecode(res.iv), additionalData: new TextEncoder().encode(exerciseId) },
    key,
    b64uDecode(res.ct),
  );
  return JSON.parse(new TextDecoder().decode(pt));
}
