import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export function loadConfig(overrides = {}) {
  const config = { ...process.env, ...overrides };
  config.production = config.NODE_ENV === 'production';
  config.PORT = Number(config.PORT || 3030);
  config.HOST = config.HOST || (config.production ? '0.0.0.0' : '127.0.0.1');
  config.DATA_DIR = path.resolve(config.DATA_DIR || '.data');
  config.APP_URL ||= 'http://127.0.0.1:' + config.PORT;
  const url = new URL(config.APP_URL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || (config.production && url.protocol !== 'https:')) {
    throw new Error('APP_URL must be an origin and use HTTPS in production.');
  }
  config.APP_URL = url.origin;
  if (config.production && !config.DATABASE_URL) throw new Error('DATABASE_URL is required in production.');
  if (config.production && !config.APP_SECRET) throw new Error('APP_SECRET is required in production.');
  if (!config.APP_SECRET) {
    mkdirSync(config.DATA_DIR, { recursive: true });
    const secretPath = path.join(config.DATA_DIR, 'dev.key');
    try {
      writeFileSync(secretPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    config.APP_SECRET = readFileSync(secretPath, 'utf8').trim();
  }
  if (!/^[a-f0-9]{64}$/i.test(config.APP_SECRET)) {
    throw new Error('APP_SECRET must contain 32 random bytes encoded in hex.');
  }
  config.cookieSecret = createHash('sha256').update('303 cookies\0' + config.APP_SECRET).digest('hex');
  config.OWNER_USERNAME ||= 'zews1009485';
  config.GUEST_CHECKOUT ??= 'true';
  return config;
}
