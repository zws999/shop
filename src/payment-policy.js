import { createHash } from 'node:crypto';
import { keccak_256 } from '@noble/hashes/sha3.js';

export const cryptoMethods = Object.freeze({
  btc: { coin: 'bitcoin', precision: 8, scheme: 'bitcoin', confirmations: 3, network: 'Bitcoin Mainnet' },
  eth: { coin: 'ethereum', precision: 18, scheme: 'ethereum', confirmations: 12, network: 'Ethereum Mainnet' },
  ltc: { coin: 'litecoin', precision: 8, scheme: 'litecoin', confirmations: 6, network: 'Litecoin Mainnet' },
  sol: { coin: 'solana', precision: 9, scheme: 'solana', confirmations: 32, network: 'Solana Mainnet' }
});

const base58Alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const bech32Alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const bech32Generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function base58Decode(input) {
  let value = 0n;
  for (const char of input) {
    const digit = base58Alphabet.indexOf(char);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const hex = value.toString(16);
  const leading = Buffer.alloc(input.match(/^1*/)[0].length);
  const payload = value ? Buffer.from(hex.length % 2 === 0 ? hex : '0' + hex, 'hex') : Buffer.alloc(0);
  return Buffer.concat([leading, payload]);
}

function base58Wallet(input, prefixes) {
  const data = base58Decode(input);
  if (!data || data.length !== 25 || !prefixes.includes(data[0])) return false;
  const hash = createHash('sha256').update(data.subarray(0, 21)).digest();
  return createHash('sha256').update(hash).digest().subarray(0, 4).equals(data.subarray(21));
}

function segwitWallet(input, prefix) {
  if (input !== input.toLowerCase() && input !== input.toUpperCase()) return false;
  const value = input.toLowerCase();
  if (!value.startsWith(prefix + '1')) return false;
  const words = [...value.slice(prefix.length + 1)].map(char => bech32Alphabet.indexOf(char));
  if (words.length < 8 || words.some(word => word < 0) || words[0] > 16) return false;
  const high = [...prefix].map(char => char.charCodeAt(0) >> 5);
  const low = [...prefix].map(char => char.charCodeAt(0) & 31);
  let checksum = 1;
  for (const word of [...high, 0, ...low, ...words]) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ word;
    for (let bit = 0; bit < 5; bit += 1) {
      if ((top >>> bit) & 1) checksum ^= bech32Generators[bit];
    }
  }
  const version = words[0];
  if (checksum !== (version === 0 ? 1 : 0x2bc830a3)) return false;
  const program = words.slice(1, -6);
  const programBits = program.length * 5;
  const remainingBits = programBits % 8;
  if (remainingBits >= 5 || (program.at(-1) & ((1 << remainingBits) - 1))) return false;
  const bytes = Math.floor(programBits / 8);
  return version === 0 ? [20, 32].includes(bytes) : bytes >= 2 && bytes <= 40;
}

function ethereumWallet(input) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(input) || /^0x0{40}$/.test(input)) return false;
  const value = input.slice(2);
  const lower = value.toLowerCase();
  if (value === lower || value === value.toUpperCase()) return true;
  const digest = Buffer.from(keccak_256(Buffer.from(lower))).toString('hex');
  const checksum = [...lower].map((char, i) => parseInt(digest[i], 16) >= 8 ? char.toUpperCase() : char).join('');
  return checksum === value;
}

export function validatePaymentDestination(id, input) {
  if (typeof input !== 'string' || input.length > 200) return false;
  switch (id) {
    case 'btc': return input.length <= 90 && (segwitWallet(input, 'bc') || base58Wallet(input, [0, 5]));
    case 'eth': return ethereumWallet(input);
    case 'ltc': return input.length <= 90 && (segwitWallet(input, 'ltc') || base58Wallet(input, [48, 50]));
    case 'sol': {
      if (input.length < 32 || input.length > 44) return false;
      const data = base58Decode(input);
      return data?.length === 32 && data.some(byte => byte !== 0);
    }
    case 'revolut': return /^@[a-z0-9_]{2,36}$/i.test(input);
    case 'paypal': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
    default: return false;
  }
}

export function paymentReference(method, reference) {
  const value = reference.trim();
  if (method === 'btc' || method === 'ltc') return /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : null;
  if (method === 'eth') return /^0x[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : null;
  if (method === 'sol') return value.length <= 88 && base58Decode(value)?.length === 64 ? value : null;
  if (method === 'revolut') return /^[\p{L}\p{N} ._\-:/]{4,160}$/u.test(value) ? value.toLowerCase() : null;
  return null;
}

export function decimalUnits(input, precision) {
  if (typeof input !== 'string' || !/^\d{1,20}(\.\d+)?$/.test(input)) return null;
  const [whole, fraction = ''] = input.split('.');
  if (fraction.length > precision) return null;
  return BigInt(whole + fraction.padEnd(precision, '0'));
}

export function formatUnits(units, precision) {
  const digits = units.toString().padStart(precision + 1, '0');
  const decimal = digits.slice(-precision).replace(/0+$/, '');
  return decimal ? digits.slice(0, -precision) + '.' + decimal : digits.slice(0, -precision);
}

export function quoteCryptoUnits(totalMinor, fiatPrice, precision) {
  const rate = decimalUnits(fiatPrice, 12);
  if (!rate || rate <= 0n || !Number.isSafeInteger(totalMinor) || totalMinor <= 0) return null;
  const numerator = BigInt(totalMinor) * 10n ** BigInt(10 + precision);
  return formatUnits((numerator + rate - 1n) / rate, precision);
}

export function cryptoPaymentUri(method, destination, amount) {
  const { scheme, precision } = cryptoMethods[method];
  if (method === 'eth') return `ethereum:${destination}@1?value=${decimalUnits(amount, precision)}`;
  return `${scheme}:${destination}?amount=${amount}`;
}

export async function marketPrice(config, method, currency) {
  if (!config.COINGECKO_API_KEY) throw new Error('Crypto pricing is unavailable.');
  const pro = config.COINGECKO_PLAN === 'pro';
  const coin = cryptoMethods[method].coin;
  const fiat = currency.toLowerCase();
  const host = pro ? 'https://pro-api.coingecko.com' : 'https://api.coingecko.com';
  const url = new URL('/api/v3/simple/price', host);
  url.search = new URLSearchParams({ ids: coin, vs_currencies: fiat, include_last_updated_at: 'true', precision: 'full' }).toString();
  const response = await fetch(url, {
    headers: { [pro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key']: config.COINGECKO_API_KEY },
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) throw new Error('Crypto pricing is unavailable.');
  const data = (await response.json())[coin];
  const age = Date.now() - data?.last_updated_at * 1000;
  if (!Number.isFinite(age) || age < -60_000 || age > 300_000 || !Number.isFinite(data?.[fiat]) || data[fiat] <= 0) {
    throw new Error('Crypto pricing is unavailable.');
  }
  return { price: data[fiat].toFixed(12), quotedAt: new Date(data.last_updated_at * 1000) };
}
