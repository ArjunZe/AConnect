/**
 * End-to-End Encryption (E2EE) Module
 * Uses standard Web Crypto API (AES-256-GCM) with key derived from room password.
 * Ciphertext is formatted as: ENC:v1:<iv_hex>:<ciphertext_hex>
 */

const keyCache = new Map();

async function getEncryptionKey(password) {
  const cleanPass = String(password || 'turtle').trim() || 'turtle';
  if (keyCache.has(cleanPass)) {
    return keyCache.get(cleanPass);
  }

  const enc = new TextEncoder();
  // Derive 256-bit key from password using SHA-256 with static domain separation salt
  const rawDigest = await crypto.subtle.digest('SHA-256', enc.encode(`aconnect_e2ee_salt_${cleanPass}`));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawDigest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );

  keyCache.set(cleanPass, cryptoKey);
  return cryptoKey;
}

export async function encryptPayload(plainText, password) {
  if (plainText === null || plainText === undefined) return '';
  const str = String(plainText);
  if (!str) return '';

  try {
    const key = await getEncryptionKey(password);
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit standard IV for AES-GCM
    const enc = new TextEncoder();

    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(str)
    );

    const ivHex = Array.from(iv).map((b) => b.toString(16).padStart(2, '0')).join('');
    const ctHex = Array.from(new Uint8Array(ciphertextBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

    return `ENC:v1:${ivHex}:${ctHex}`;
  } catch (err) {
    console.error('[E2EE] Encryption failed:', err);
    return str; // Fallback to avoid dropping transmission
  }
}

export async function decryptPayload(content, password) {
  if (!content || typeof content !== 'string') return content;
  if (!content.startsWith('ENC:v1:')) return content; // Not encrypted (e.g. system message)

  try {
    const parts = content.split(':');
    if (parts.length !== 4) return content;

    const ivHex = parts[2];
    const ctHex = parts[3];

    const iv = new Uint8Array(ivHex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
    const ciphertext = new Uint8Array(ctHex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));

    const key = await getEncryptionKey(password);
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch (err) {
    console.warn('[E2EE] Decryption failed (password mismatch or altered ciphertext):', err);
    return '🔒 [Encrypted Message - Key Mismatch]';
  }
}

export async function decryptMessages(messages = [], password) {
  if (!Array.isArray(messages)) return [];
  return Promise.all(
    messages.map(async (msg) => {
      if (!msg) return msg;
      const clone = { ...msg };
      if (typeof clone.text === 'string') {
        clone.text = await decryptPayload(clone.text, password);
      }
      return clone;
    })
  );
}
