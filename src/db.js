import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

export async function connect(config) {
  if (config.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 12 });
    pool.on('error', error => console.error(JSON.stringify({ event: 'pg.idle_error', code: error.code })));
    return {
      kind: 'postgres',
      query: (sql, params) => pool.query(sql, params),
      async tx(run) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await run({ query: (sql, params) => client.query(sql, params), exec: sql => client.query(sql) });
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
      close: () => pool.end()
    };
  }

  const memory = config.PGLITE_MEMORY === 'true';
  if (!memory) await mkdir(config.DATA_DIR, { recursive: true });
  const engine = new PGlite(memory ? 'memory://' : path.join(config.DATA_DIR, 'postgres'));
  await engine.waitReady;
  const wrap = target => ({
    async query(sql, params) {
      const result = await target.query(sql, params);
      return { ...result, rowCount: result.affectedRows || result.rows.length };
    },
    exec: sql => target.exec(sql)
  });
  return {
    kind: 'pglite',
    ...wrap(engine),
    tx: run => engine.transaction(tx => run(wrap(tx))),
    close: () => engine.close()
  };
}

export async function migrate(db) {
  const directory = new URL('../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter(file => /^\d{3}-.+\.sql$/.test(file)).sort();
  await db.tx(async tx => {
    if (db.kind === 'postgres') await tx.query('SELECT pg_advisory_xact_lock(3032026)');
    await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations (file text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const file of files) {
      const sql = await readFile(new URL(file, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const { rows } = await tx.query('SELECT checksum FROM schema_migrations WHERE file=$1', [file]);
      if (rows.length) {
        if (rows[0].checksum !== checksum) throw new Error('Applied migration has changed: ' + file);
        continue;
      }
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations(file,checksum) VALUES($1,$2)', [file, checksum]);
    }
  });
}
