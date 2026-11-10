import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { HttpError, parse, uuid } from './http.js';
import { audit, notify } from './notifications.js';
import { checkPassword, digest, hashPassword, openSecret, randomToken, verifyTotp } from './security.js';

export const emailSchema = z.string().trim().toLowerCase().max(254).email();
export const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{2,31}$/, 'Use 3–32 letters, numbers, underscores or hyphens.');
export const passwordSchema = z.string().min(14, 'Use at least 14 characters.').max(128);
const loginSchema = z.object({ login: z.string().trim().toLowerCase().min(1).max(254), password: z.string().min(1).max(128),
  otp: z.string().trim().max(40).optional().default('') });
const secretSchema = z.string().regex(/^[\w-]{43}$/, 'Invalid or expired link.');
const otpContext = userId => 'totp:' + userId;
const sessionAge = role => role === 'customer' ? 14 * 86400000 : 8 * 3600000;
const safeUser = user => user ? { id:user.id, email:user.email, username:user.username, role:user.role, verifiedAt:user.verified_at,
  mfaAt:user.mfa_at || null, reauthAt:user.reauth_at || null } : null;

export function authCookies(config) {
  const prefix = config.production ? '__Host-' : '';
  return { session:prefix+'303-session', cart:prefix+'303-cart',
    options:{ path:'/', httpOnly:true, sameSite:'lax', secure:config.production } };
}

export function identity(db, config) {
  const names = authCookies(config);
  return async (req,res,next) => {
    req.cartId = req.signedCookies[names.cart];
    if (!uuid.test(req.cartId ?? '')) {
      req.cartId = randomUUID();
      res.cookie(names.cart, req.cartId, { ...names.options, signed:true, maxAge:30*86400000 });
    }
    req.sessionHash = null;
    req.user = null;
    const token = req.cookies[names.session];
    if (secretSchema.safeParse(token).success) {
      const hashed = digest(token);
      const { rows:[user] } = await db.query(
        `SELECT u.id,u.email,u.username,u.role,u.verified_at,s.mfa_at,s.reauth_at
         FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, [hashed]);
      if (user) {
        req.sessionHash = hashed;
        req.user = safeUser(user);
      }
    }
    next();
  };
}

export function customer(req,res,next) {
  if (!req.user) return res.status(401).json({ error:'Sign in to continue.' });
  next();
}
export function owner(req,res,next) {
  if (req.user?.role !== 'owner' || !req.user.mfaAt) return res.status(403).json({ error:'Owner sign-in with MFA is required.' });
  next();
}
export function reauth(req,res,next) {
  if (req.user?.role !== 'owner' || !req.user.mfaAt ||
      !req.user.reauthAt || Date.now() - new Date(req.user.reauthAt).getTime() > 300000) {
    return res.status(403).json({ error:'Confirm your password and a fresh authenticator code to continue.', code:'REAUTH_REQUIRED' });
  }
  next();
}
export async function rate(db, namespace, identifier, limit, seconds) {
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const expires = new Date((bucket + 2) * seconds * 1000);
  const { rows:[row] } = await db.query(`INSERT INTO rate_limits(rate_key,bucket,hits,expires_at) VALUES($1,$2,1,$3)
    ON CONFLICT(rate_key,bucket) DO UPDATE SET hits=rate_limits.hits+1 RETURNING hits`,
    [namespace + ':' + digest(String(identifier)), bucket, expires]);
  if (row.hits > limit) throw new HttpError(429,'Too many attempts. Wait a few minutes and try again.');
}
async function createSession(tx,req,res,user,config,mfa) {
  if (req.sessionHash) await tx.query('DELETE FROM sessions WHERE token_hash=$1', [req.sessionHash]);
  const names = authCookies(config);
  const token = randomToken();
  const maxAge = sessionAge(user.role);
  await tx.query('INSERT INTO sessions(token_hash,user_id,expires_at,mfa_at) VALUES($1,$2,$3,$4)',
    [digest(token), user.id, new Date(Date.now()+maxAge), mfa ? new Date() : null]);
  return () => res.cookie(names.session, token, { ...names.options,maxAge });
}
async function consumeMfa(tx, user, otp, allowRecovery) {
  if (!user.mfa_secret) return false;
  const step = verifyTotp(openSecret(user.mfa_secret, otpContext(user.id)),otp,user.last_otp_step);
  if (step !== null) {
    const result = await tx.query('UPDATE users SET last_otp_step=$2 WHERE id=$1 AND last_otp_step<$2', [user.id,step]);
    return result.rowCount === 1;
  }
  if (allowRecovery && /^[a-f0-9]{16}$/i.test(otp.replaceAll('-',''))) {
    const result = await tx.query('DELETE FROM recovery_codes WHERE user_id=$1 AND code_hash=$2',
      [user.id,digest(otp.replaceAll('-','').toLowerCase())]);
    return result.rowCount === 1;
  }
  return false;
}
async function emailToken(tx,user,purpose,config) {
  const token = randomToken();
  await tx.query('DELETE FROM account_tokens WHERE user_id=$1 AND purpose=$2',[user.id,purpose]);
  await tx.query(`INSERT INTO account_tokens(token_hash,user_id,purpose,expires_at)
    VALUES($1,$2,$3,$4)`,[digest(token),user.id,purpose,new Date(Date.now()+(purpose==='verify' ? 86400000 : 1800000))]);
  const title = purpose === 'verify' ? 'Verify your 303 account' : 'Reset your 303 password';
  const verb = purpose === 'verify' ? 'verify your email address' : 'choose a new password';
  await notify(tx,user.email,title,'Use this link to ' + verb + ':\n\n' + config.APP_URL + '/account?' + purpose + '=' + token +
    '\n\nIf you did not request this email, you can disregard it.');
}
export async function rotateRecovery(tx,userId) {
  const codes = Array.from({length:10},() => randomBytes(8).toString('hex'));
  await tx.query('DELETE FROM recovery_codes WHERE user_id=$1',[userId]);
  for (const code of codes) await tx.query('INSERT INTO recovery_codes(code_hash,user_id) VALUES($1,$2)',[digest(code),userId]);
  return codes.map(code => code.match(/.{4}/g).join('-'));
}
export { otpContext };

export function authRouter({db,config}) {
  const router = express.Router();
  const names = authCookies(config);
  let dummyPassword;
  router.get('/me',(req,res) => res.json({user:req.user}));
  router.post('/auth/register',async (req,res) => {
    await rate(db,'register',req.ip,8,3600);
    const data = parse(z.object({email:emailSchema,username:usernameSchema,password:passwordSchema}),req.body);
    if (data.username === config.OWNER_USERNAME.toLowerCase()) throw new HttpError(409,'Choose a different username.');
    const hashed = await hashPassword(data.password);
    const { user, setCookie } = await db.tx(async tx => {
      const { rows:[user] } = await tx.query(`INSERT INTO users(email,username,password_hash)
        VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *`,[data.email,data.username,hashed]);
      if (!user) throw new HttpError(409,'Could not create an account with these details.');
      await emailToken(tx,user,'verify',config);
      await notify(tx,user.email,'Welcome to 303 Services/Shop','Your account is ready. Check your inbox for your verification link.');
      return { user,setCookie:await createSession(tx,req,res,user,config,false) };
    });
    setCookie();
    res.status(201).json({user:safeUser(user)});
  });
  router.post('/auth/login',async (req,res) => {
    await rate(db,'login_ip',req.ip,25,900);
    const data = parse(loginSchema,req.body);
    await rate(db,'login_identity',data.login,8,900);
    const { rows:[record] } = await db.query('SELECT * FROM users WHERE email=$1 OR username=$1',[data.login]);
    if (!record) dummyPassword ||= hashPassword(randomToken());
    const valid = await checkPassword(record?.password_hash || await dummyPassword,data.password);
    if (!record || !valid) {
      await audit(db,{user:null},'auth.login_failed','account');
      throw new HttpError(401,'Invalid sign-in details.');
    }
    const result = await db.tx(async tx => {
      const { rows:[user] } = await tx.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[record.id]);
      if (record.password_hash !== user?.password_hash) throw new HttpError(401,'Invalid sign-in details.');
      const mfa = user.role !== 'customer';
      if (mfa && !await consumeMfa(tx,user,data.otp,true)) {
        await audit(tx,{user},'auth.mfa_failed',user.id);
        return null;
      }
      const setCookie = await createSession(tx,req,res,user,config,mfa);
      await audit(tx,{user},'auth.sign_in',user.id,{mfa});
      return { user:safeUser({...user,mfa_at:mfa ? new Date() : null}),setCookie };
    });
    if (!result) throw new HttpError(401,'Enter a fresh authenticator or recovery code.');
    result.setCookie();
    res.json({user:result.user});
  });
  router.post('/auth/logout',async (req,res) => {
    if (req.sessionHash) await db.query('DELETE FROM sessions WHERE token_hash=$1',[req.sessionHash]);
    res.clearCookie(names.session,names.options);
    res.json({ok:true});
  });
  router.post('/auth/forgot',async (req,res) => {
    const {email} = parse(z.object({email:emailSchema}),req.body);
    await rate(db,'forgot_ip',req.ip,10,3600);
    await rate(db,'forgot_email',email,3,3600);
    await db.tx(async tx => {
      const {rows:[user]} = await tx.query("SELECT id,email FROM users WHERE email=$1 AND role='customer' FOR UPDATE",[email]);
      if (user) await emailToken(tx,user,'reset',config);
    });
    res.json({ok:true});
  });
  router.post('/auth/resend',customer,async (req,res) => {
    await rate(db,'resend',req.user.id,3,3600);
    await db.tx(async tx => {
      const {rows:[user]} = await tx.query('SELECT id,email,verified_at FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
      if (user && !user.verified_at) await emailToken(tx,user,'verify',config);
    });
    res.json({ok:true});
  });
  router.post('/auth/verify',async (req,res) => {
    await rate(db,'verify',req.ip,30,900);
    const {token} = parse(z.object({token:secretSchema}),req.body);
    await db.tx(async tx => {
      const {rows:[match]} = await tx.query("DELETE FROM account_tokens WHERE token_hash=$1 AND purpose='verify' AND expires_at>now() RETURNING user_id",[digest(token)]);
      if (!match) throw new HttpError(400,'Invalid or expired link.');
      await tx.query('UPDATE users SET verified_at=COALESCE(verified_at,now()) WHERE id=$1',[match.user_id]);
    });
    res.json({ok:true});
  });
  router.post('/auth/reset',async (req,res) => {
    await rate(db,'reset',req.ip,10,3600);
    const {token,password} = parse(z.object({token:secretSchema,password:passwordSchema}),req.body);
    const hashed = await hashPassword(password);
    await db.tx(async tx => {
      const {rows:[match]} = await tx.query("DELETE FROM account_tokens WHERE token_hash=$1 AND purpose='reset' AND expires_at>now() RETURNING user_id",[digest(token)]);
      if (!match) throw new HttpError(400,'Invalid or expired link.');
      await tx.query("UPDATE users SET password_hash=$2 WHERE id=$1 AND role='customer'",[match.user_id,hashed]);
      await tx.query('DELETE FROM sessions WHERE user_id=$1',[match.user_id]);
      await audit(tx,{user:{id:match.user_id}},'auth.password_reset',match.user_id);
    });
    res.clearCookie(names.session,names.options);
    res.json({ok:true});
  });
  router.post('/auth/reauth',owner,async (req,res) => {
    await rate(db,'reauth',req.user.id,8,900);
    const data = parse(loginSchema.omit({login:true}),req.body);
    const {rows:[record]} = await db.query('SELECT password_hash FROM users WHERE id=$1',[req.user.id]);
    const valid = record && await checkPassword(record.password_hash,data.password);
    const success = await db.tx(async tx => {
      const {rows:[user]} = await tx.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
      if (!valid || record.password_hash !== user?.password_hash || !await consumeMfa(tx,user,data.otp,false)) {
        await audit(tx,req,'auth.reauth_failed',req.user.id);
        return false;
      }
      const updated = await tx.query('UPDATE sessions SET reauth_at=now() WHERE token_hash=$1 AND expires_at>now()',[req.sessionHash]);
      return updated.rowCount === 1;
    });
    if (!success) throw new HttpError(401,'Invalid password or authenticator code. Use a fresh code.');
    res.json({ok:true});
  });
  router.post('/auth/recovery-codes',owner,reauth,async (req,res) => {
    const codes = await db.tx(async tx => {
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
      const codes = await rotateRecovery(tx,req.user.id);
      await audit(tx,req,'auth.recovery_rotated',req.user.id);
      return codes;
    });
    res.json({codes});
  });
  return router;
}
