import { createHmac, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'crypto';

function getKeyBytes(): Buffer {
  const key = (process.env.FARMACIAS_KEY ?? '').trim();
  if (!key) throw new Error('Variável FARMACIAS_KEY não encontrada no .env');
  const b64 = key.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

export function decrypt(token: string): string {
  const keyBytes    = getKeyBytes();
  const signingKey  = keyBytes.subarray(0, 16);
  const encryptKey  = keyBytes.subarray(16, 32);

  const b64        = token.replace(/-/g, '+').replace(/_/g, '/');
  const tokenBytes = Buffer.from(b64, 'base64');

  const dataToSign = tokenBytes.subarray(0, tokenBytes.length - 32);
  const hmac       = tokenBytes.subarray(tokenBytes.length - 32);
  const expected   = createHmac('sha256', signingKey).update(dataToSign).digest();

  if (!timingSafeEqual(hmac, expected)) {
    throw new Error('Token Fernet inválido — HMAC incorreto');
  }

  const iv         = tokenBytes.subarray(9, 25);
  const ciphertext = tokenBytes.subarray(25, tokenBytes.length - 32);
  const decipher   = createDecipheriv('aes-128-cbc', encryptKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}

export function encrypt(plaintext: string): string {
  const keyBytes   = getKeyBytes();
  const signingKey = keyBytes.subarray(0, 16);
  const encryptKey = keyBytes.subarray(16, 32);

  const iv        = randomBytes(16);
  const timestamp = BigInt(Math.floor(Date.now() / 1000));
  const tsBuf     = Buffer.alloc(8);
  tsBuf.writeBigUInt64BE(timestamp);

  const cipher     = createCipheriv('aes-128-cbc', encryptKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const dataToSign = Buffer.concat([Buffer.from([0x80]), tsBuf, iv, ciphertext]);
  const hmac       = createHmac('sha256', signingKey).update(dataToSign).digest();

  return Buffer.concat([dataToSign, hmac])
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
