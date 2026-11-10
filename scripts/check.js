import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

for (const directory of ['src','public','scripts','test']) {
  const entries = await readdir(directory,{recursive:true,withFileTypes:true});
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(?:js|mjs)$/.test(entry.name)) continue;
    const result = spawnSync(process.execPath,['--check',path.join(entry.parentPath,entry.name)],{stdio:'inherit'});
    if (result.status!==0) process.exit(result.status ?? 1);
  }
}
console.log('JavaScript syntax checks passed.');
