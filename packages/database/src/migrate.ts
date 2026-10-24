// Migration command line:
//   tsx src/migrate.ts up            apply every pending migration
//   tsx src/migrate.ts down          revert the latest migration
//   tsx src/migrate.ts down --all    revert every migration
//   tsx src/migrate.ts status        list migrations and when they ran
import { loadConfig } from './config.js';
import { createDb, createPool } from './db.js';
import { migrateDown, migrateUp, migrationStatus } from './migrator.js';

async function main(command: string | undefined, flags: string[]): Promise<void> {
  if (command !== 'up' && command !== 'down' && command !== 'status') {
    throw new Error('usage: migrate <up | down [--all] | status>');
  }
  const db = createDb(createPool({ connectionString: loadConfig().DATABASE_URL, max: 2 }));
  try {
    if (command === 'status') {
      for (const m of await migrationStatus(db)) {
        console.log(
          `${m.name.padEnd(20)} ${m.executedAt ? `applied ${m.executedAt.toISOString()}` : 'pending'}`,
        );
      }
      return;
    }
    const results =
      command === 'up'
        ? await migrateUp(db)
        : await migrateDown(db, { all: flags.includes('--all') });
    if (results.length === 0) console.log('Nothing to do.');
    for (const r of results)
      console.log(`${r.direction === 'Up' ? 'applied ' : 'reverted'} ${r.migrationName}`);
  } finally {
    await db.destroy();
  }
}

main(process.argv[2], process.argv.slice(3)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
