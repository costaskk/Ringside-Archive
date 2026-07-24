import crypto from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

function encryptionKey() {
  const raw = String(process.env.INTEGRATION_ENCRYPTION_KEY || '').trim();
  if (!raw) throw new Error('INTEGRATION_ENCRYPTION_KEY is not configured.');
  let key;
  if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
  else {
    try { key = Buffer.from(raw, 'base64'); } catch { key = Buffer.alloc(0); }
  }
  if (key.length !== 32) throw new Error('INTEGRATION_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  return key;
}

function b64url(buffer) { return Buffer.from(buffer).toString('base64url'); }
function fromB64url(value) { return Buffer.from(String(value || ''), 'base64url'); }

export function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const compressed = gzipSync(Buffer.from(JSON.stringify(value), 'utf8'), { level: 9 });
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${b64url(iv)}.${b64url(tag)}.${b64url(ciphertext)}`;
}

export function decryptJson(payload) {
  const [version, ivText, tagText, ciphertextText] = String(payload || '').split('.');
  if (version !== 'v1' || !ivText || !tagText || !ciphertextText) throw new Error('Unsupported encrypted integration payload.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), fromB64url(ivText));
  decipher.setAuthTag(fromB64url(tagText));
  const compressed = Buffer.concat([decipher.update(fromB64url(ciphertextText)), decipher.final()]);
  return JSON.parse(gunzipSync(compressed).toString('utf8'));
}


export function signValue(value, expiresAt) {
  const canonical = `${Number(expiresAt)}.${String(value)}`;
  return b64url(crypto.createHmac('sha256', encryptionKey()).update(canonical).digest());
}

export function verifySignedValue(value, expiresAt, signature) {
  const expiry = Number(expiresAt || 0);
  if (!expiry || expiry < Date.now()) return false;
  const expected = Buffer.from(signValue(value, expiry));
  const actual = Buffer.from(String(signature || ''));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
