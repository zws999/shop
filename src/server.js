import { loadConfig } from './config.js';
import { connect,migrate } from './db.js';
import { buildApp } from './app.js';
import { startJobs } from './jobs.js';

const config = loadConfig();
const db = await connect(config);
try {
  if (!config.production) await migrate(db);
  const app = buildApp({db,config});
  const server = app.listen(config.PORT,config.HOST,() => {
    console.log(JSON.stringify({event:'server.listening',url:config.APP_URL,database:db.kind}));
  });
  const stopJobs = config.JOBS_IN_SERVER==='false' ? async () => {} : startJobs(db,config);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await new Promise(resolve => server.close(resolve));
    await stopJobs();
    await db.close();
  };
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,() => {
    shutdown().catch(() => { process.exitCode=1; });
  });
  server.on('error',async error => {
    console.error(JSON.stringify({event:'server.error',code:error.code || error.name}));
    await shutdown();
    process.exitCode=1;
  });
} catch (error) {
  await db.close();
  throw error;
}
