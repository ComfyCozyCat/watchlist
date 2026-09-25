export const ITERATIONS = 600000;
const encoder = new TextEncoder();
export function decode64(value) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
export function encode64(value) { let raw = ''; for (const byte of new Uint8Array(value)) raw += String.fromCharCode(byte); return btoa(raw); }
export function validateEnvelope(envelope) {
  if (envelope?.version !== 1 || envelope.algorithm !== 'AES-256-GCM' || envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== ITERATIONS) throw new Error('Unsupported snapshot');
  if (decode64(envelope.salt).length !== 16 || decode64(envelope.nonce).length !== 12 || typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > 5000000) throw new Error('Invalid snapshot');
}
export async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', salt:decode64(salt), iterations:ITERATIONS, hash:'SHA-256'}, material, {name:'AES-GCM', length:256}, true, ['decrypt']);
}
export async function decrypt(envelope, key) {
  validateEnvelope(envelope);
  const raw = await crypto.subtle.decrypt({name:'AES-GCM', iv:decode64(envelope.nonce), additionalData:encoder.encode('watchlist-v1'), tagLength:128}, key, decode64(envelope.ciphertext));
  const snapshot = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw));
  if (snapshot.version !== 1 || !Array.isArray(snapshot.shows)) throw new Error('Invalid content');
  return snapshot;
}

// Separate authenticated contexts prevent confusing a local credential with an
// online progress document. Only progress envelopes are ever sent to GitHub.
async function writableKey(key) {
  return crypto.subtle.importKey('raw', await crypto.subtle.exportKey('raw', key), {name:'AES-GCM'}, false, ['encrypt', 'decrypt']);
}
export async function seal(value, key, salt, context) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv:nonce, additionalData:encoder.encode(context)}, await writableKey(key), encoder.encode(JSON.stringify(value)));
  return {version:1, algorithm:'AES-256-GCM', kdf:'PBKDF2-SHA256', iterations:ITERATIONS, salt, nonce:encode64(nonce), ciphertext:encode64(ciphertext)};
}
export async function openSealed(envelope, key, context) {
  validateEnvelope(envelope);
  const raw = await crypto.subtle.decrypt({name:'AES-GCM', iv:decode64(envelope.nonce), additionalData:encoder.encode(context)}, key, decode64(envelope.ciphertext));
  return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw));
}
