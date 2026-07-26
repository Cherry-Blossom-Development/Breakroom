// AES-256-GCM encrypt/decrypt for storing third-party OAuth tokens (e.g. Square Connect
// access/refresh tokens) at rest. Key is separate from SECRET_KEY (JWT signing) since
// these are different security domains.

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyHex) throw new Error('TOKEN_ENCRYPTION_KEY is not set');
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be a 32-byte hex string (64 hex chars)');
  return key;
}

// Returns a single string: iv:authTag:ciphertext (all hex), safe to store in a TEXT column
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function decrypt(stored) {
  const [ivHex, authTagHex, ciphertextHex] = stored.split(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { encrypt, decrypt };
