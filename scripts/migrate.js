import { loadConfig } from '../src/config.js';
import { connect, migrate } from '../src/db.js';

const db = await connect(loadConfig());
try {
  await migrate(db);
  console.log('Database migrations applied.');
} finally {
  await db.close();
}
