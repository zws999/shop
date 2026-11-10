import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { connect, migrate } from '../src/db.js';
import { emailSchema,otpContext,passwordSchema,rotateRecovery,usernameSchema } from '../src/auth.js';
import { audit } from '../src/notifications.js';
import { configureSecurity,createTotpSecret,hashPassword,sealSecret } from '../src/security.js';

const mode = process.argv[2] || 'init';
if (!['init','rotate'].includes(mode)) throw new Error('Use npm run owner -- init or npm run owner -- rotate.');
const config = loadConfig();
configureSecurity(config);
const password = passwordSchema.safeParse(config.OWNER_PASSWORD);
if (!password.success) throw new Error('Set OWNER_PASSWORD to a unique passphrase of 14–128 characters.');
const email = emailSchema.safeParse(config.OWNER_EMAIL);
if (!email.success) throw new Error('Set OWNER_EMAIL to a valid email address.');
const username = usernameSchema.parse(config.OWNER_USERNAME);
const secret = createTotpSecret();
const hashed = await hashPassword(password.data);
const db = await connect(config);
try {
  if (!config.production) await migrate(db);
  const codes = await db.tx(async tx => {
    const {rows:[owner]} = await tx.query("SELECT id FROM users WHERE role='owner' FOR UPDATE");
    if (mode==='init' && owner) throw new Error('Owner already initialized. Use rotate to replace credentials and revoke sessions.');
    if (mode==='rotate' && !owner) throw new Error('Run owner initialization first.');
    const id = owner?.id ?? randomUUID();
    const encrypted = sealSecret(secret,otpContext(id));
    if (owner) {
      await tx.query(`UPDATE users SET email=$2,username=$3,password_hash=$4,mfa_secret=$5,last_otp_step=-1,verified_at=now()
        WHERE id=$1`,[id,email.data,username,hashed,encrypted]);
      await tx.query('DELETE FROM sessions WHERE user_id=$1',[id]);
    } else {
      await tx.query(`INSERT INTO users(id,email,username,password_hash,role,verified_at,mfa_secret)
        VALUES($1,$2,$3,$4,'owner',now(),$5)`,[id,email.data,username,hashed,encrypted]);
    }
    const recovery = await rotateRecovery(tx,id);
    await audit(tx,{user:{id}},mode==='init'?'owner.initialized':'owner.credentials_rotated',id);
    return recovery;
  });
  console.log('Owner ' + username + ' is ready. Add this setup key to an authenticator app (time-based, 6 digits, 30 seconds).');
  console.log(secret);
  console.log('Store these one-time recovery codes privately. This is the only display.');
  console.log(codes.join('\n'));
  console.log('Remove OWNER_PASSWORD from the initialization environment now.');
} finally {
  await db.close();
}
