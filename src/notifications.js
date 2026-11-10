import { randomUUID } from 'node:crypto';
import { escapeHtml } from './http.js';
import { openSecret, sealSecret } from './security.js';

export async function notify(tx, to, subject, message) {
  if (!to) return;
  await tx.query('INSERT INTO outbox(recipient,subject,message) VALUES ($1,$2,$3)', [to,subject,sealSecret(message,'outbox')]);
}
export async function audit(tx, req, action, target, metadata = {}) {
  await tx.query('INSERT INTO audit_logs(actor_id,action,target,metadata) VALUES($1,$2,$3,$4)',
    [req.user?.id || null, action, String(target), JSON.stringify(metadata)]);
}
function mailHtml(subject, message) {
  return '<div style="background:#08080c;color:#f7f7fa;padding:32px 16px;font:16px system-ui,sans-serif"><main style="max-width:560px;margin:auto;background:#191920;border:1px solid #343140;border-radius:18px;padding:28px">' +
    '<strong style="font-size:32px;color:#b29aff">303</strong><span style="font-size:11px;letter-spacing:.15em;padding-left:12px">SERVICES / SHOP</span>' +
    '<h1 style="font-size:23px">' + escapeHtml(subject) + '</h1>' +
    '<div style="line-height:1.6;overflow-wrap:anywhere;white-space:pre-wrap">' + escapeHtml(message).replace(
      /https?:\/\/[^\s<]+/g, url => '<a style="color:#c5b3ff" href="' + url + '">' + url + '</a>') +
    '</div></main></div>';
}
export async function processOutbox(db, config) {
  if (!config.RESEND_API_KEY || !config.MAIL_FROM) return 0;
  const lockId = randomUUID();
  const { rows } = await db.query(
    `UPDATE outbox SET lock_id=$1,locked_until=now()+interval '5 minutes'
     WHERE id IN (
       SELECT id FROM outbox WHERE delivered_at IS NULL AND failed_at IS NULL
       AND next_attempt <= now() AND (locked_until IS NULL OR locked_until<now())
       ORDER BY next_attempt LIMIT 10 FOR UPDATE SKIP LOCKED
     ) RETURNING id,recipient,subject,message,attempts`, [lockId]);
  for (const mail of rows) {
    try {
      const message = openSecret(mail.message,'outbox');
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + config.RESEND_API_KEY, 'Content-Type': 'application/json',
          'Idempotency-Key': '303/' + mail.id },
        body: JSON.stringify({ from: config.MAIL_FROM, to: [mail.recipient], subject: mail.subject,
          text: message, html: mailHtml(mail.subject, message) }),
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error('provider_http_' + response.status);
      const result = await response.json();
      await db.query(`UPDATE outbox SET delivered_at=now(),provider_id=$3,locked_until=NULL,lock_id=NULL,
        message='[delivered]' WHERE id=$1 AND lock_id=$2`, [mail.id,lockId,result.id ?? null]);
    } catch (error) {
      const retrySeconds = Math.min(7200, 60 * 2 ** mail.attempts);
      const reason = /^provider_http_\d+$/.test(error.message) ? error.message : 'provider_unreachable';
      await db.query(`UPDATE outbox SET attempts=attempts+1,last_error=$3,locked_until=NULL,lock_id=NULL,
        failed_at=CASE WHEN attempts>=7 THEN now() END,next_attempt=now()+$4::int*interval '1 second',
        message=CASE WHEN attempts>=7 THEN '[delivery failed]' ELSE message END
        WHERE id=$1 AND lock_id=$2`, [mail.id,lockId,reason,retrySeconds]);
      if (mail.attempts >= 7) console.error(JSON.stringify({ event:'mail.delivery_failed', id:mail.id, reason }));
    }
  }
  return rows.length;
}
