import { loadConfig } from '../src/config.js';
import { connect } from '../src/db.js';
import { startJobs } from '../src/jobs.js';
import { configureSecurity } from '../src/security.js';

const config = loadConfig();
if (!config.DATABASE_URL) throw new Error('The standalone worker requires a PostgreSQL DATABASE_URL.');
configureSecurity(config);
const db = await connect(config);
const stop = startJobs(db,config);
const hold = setInterval(() => {},60000);
let shuttingDown = false;
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(hold);
  await stop();
  await db.close();
});
