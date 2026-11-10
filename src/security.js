import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const passwordOptions = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };
let encryptionKey;
let previousKey;

export function configureSecurity(config) {
  encryptionKey = Buffer.from(config.APP_SECRET, 'hex');
  if (config.APP_SECRET_PREVIOUS && !/^[a-f0-9]{64}$/i.test(config.APP_SECRET_PREVIOUS)) {
    throw new Error('APP_SECRET_PREVIOUS must contain 32 bytes in hex.');
  }
  previousKey = config.APP_SECRET_PREVIOUS ? Buffer.from(config.APP_SECRET_PREVIOUS, 'hex') : undefined;
}
export const digest = value => createHash('sha256').update(value).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export const hashPassword = password => hash(password, passwordOptions);
export const checkPassword = (hashed, password) => verify(hashed, password);

export function sealSecret(value, context = '') {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [nonce, ciphertext, cipher.getAuthTag()].map(part => part.toString('base64url')).join('.');
}
export function openSecret(value, context = '') {
  const [nonce, ciphertext, tag] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  for (const key of [encryptionKey, previousKey].filter(Boolean)) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (error) {
      if (key === (previousKey || encryptionKey)) throw error;
    }
  }
  throw new Error('Encryption key unavailable.');
}
export function createTotpSecret() {
  const bytes = randomBytes(20);
  const bits = [...bytes].map(byte => byte.toString(2).padStart(8, '0')).join('');
  return bits.match(/.{5}/g).map(bits => alphabet[parseInt(bits, 2)]).join('');
}
export function totpAt(secret, step = Math.floor(Date.now() / 30000)) {
  const bits = [...secret].map(character => alphabet.indexOf(character).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map(bits => parseInt(bits, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const value = createHmac('sha1', key).update(counter).digest();
  const offset = value[value.length - 1] & 15;
  return String((value.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
export function verifyTotp(secret, otp, lastStep = -1) {
  if (!/^\d{6}$/.test(otp ?? '')) return null;
  const step = Math.floor(Date.now() / 30000);
  const code = Buffer.from(otp);
  return [step, step - 1, step + 1].find(candidate => candidate > Number(lastStep) &&
    timingSafeEqual(Buffer.from(totpAt(secret, candidate)), code)) ?? null;
}
