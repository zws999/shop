import { processOutbox } from './notifications.js';
import { expireOrders } from './commerce.js';

export function startJobs(db,config) {
  let run;
  const task = async () => {
    await expireOrders(db);
    await db.query('DELETE FROM sessions WHERE expires_at<now()');
    await db.query('DELETE FROM account_tokens WHERE expires_at<now()');
    await db.query('DELETE FROM rate_limits WHERE expires_at<now()');
    await processOutbox(db,config);
  };
  const tick = () => {
    if (run) return;
    run = task().catch(error => {
      console.error(JSON.stringify({event:'jobs.error',code:error.code || error.name,
        ...(config.production ? {} : {message:error.message})}));
    }).finally(() => { run = undefined; });
  };
  const interval = setInterval(tick,30000);
  interval.unref();
  tick();
  return async () => {
    clearInterval(interval);
    await run;
  };
}
