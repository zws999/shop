import { loadConfig } from '../src/config.js';
import { connect } from '../src/db.js';
import { audit } from '../src/notifications.js';
import { otpContext } from '../src/auth.js';
import { configureSecurity,openSecret,sealSecret } from '../src/security.js';

const config = loadConfig();
if (!config.APP_SECRET_PREVIOUS || config.APP_SECRET===config.APP_SECRET_PREVIOUS) {
  throw new Error('Set APP_SECRET to the new key and APP_SECRET_PREVIOUS to the distinct previous key.');
}
configureSecurity(config);
const db = await connect(config);
try {
  await db.tx(async tx => {
    for (const {id,mfa_secret} of (await tx.query('SELECT id,mfa_secret FROM users WHERE mfa_secret IS NOT NULL FOR UPDATE')).rows) {
      const context = otpContext(id);
      await tx.query('UPDATE users SET mfa_secret=$2 WHERE id=$1',[id,sealSecret(openSecret(mfa_secret,context),context)]);
    }
    for (const {id,secret} of (await tx.query('SELECT id,secret FROM license_keys FOR UPDATE')).rows) {
      await tx.query('UPDATE license_keys SET secret=$2 WHERE id=$1',[id,sealSecret(openSecret(secret))]);
    }
    for (const {id,message} of (await tx.query('SELECT id,message FROM outbox WHERE delivered_at IS NULL AND failed_at IS NULL FOR UPDATE')).rows) {
      await tx.query('UPDATE outbox SET message=$2 WHERE id=$1',[id,sealSecret(openSecret(message,'outbox'),'outbox')]);
    }
    await tx.query('DELETE FROM sessions');
    await audit(tx,{user:null},'security.encryption_rotated','store');
  });
  console.log('Secrets resealed and sessions revoked. Remove APP_SECRET_PREVIOUS before restarting.');
} finally {
  await db.close();
}
