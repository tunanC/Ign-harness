/* ═══════════════════════════════════════════════════════════════════
   crypto.ts — Password encryption for local settings.json storage.

   Uses Web Crypto API (SubtleCrypto) with PBKDF2 key derivation +
   AES-256-GCM. The key is derived from a fixed application passphrase.

   Output format: base64(salt[16] || iv[12] || ciphertext)
   ═══════════════════════════════════════════════════════════════════ */

const KEY_PASSPHRASE = 'Ign.client.v1';
const ALGO = 'AES-GCM';
const SALT_LEN = 16;
const IV_LEN = 12;
const ITERATIONS = 100_000;

async function deriveKey(salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(KEY_PASSPHRASE),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGO, length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt plaintext password → base64-encoded ciphertext blob. */
export async function encryptPassword(plaintext: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    new TextEncoder().encode(plaintext),
  );

  // salt || iv || ciphertext
  const buf = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
  buf.set(salt, 0);
  buf.set(iv, salt.length);
  buf.set(new Uint8Array(ciphertext), salt.length + iv.length);

  return btoa(String.fromCharCode(...buf));
}

/** Decrypt a base64-encoded ciphertext blob back to plaintext. */
export async function decryptPassword(encrypted: string): Promise<string> {
  const buf = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const salt = buf.slice(0, SALT_LEN);
  const iv = buf.slice(SALT_LEN, SALT_LEN + IV_LEN);
  const ciphertext = buf.slice(SALT_LEN + IV_LEN);

  const key = await deriveKey(salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: ALGO, iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(plaintext);
}
