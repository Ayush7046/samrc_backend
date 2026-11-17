import * as database from '../db.js';
import { migrateAuth } from './schema.js';
try {
  console.log('Authentication schema ready:', (await migrateAuth(database)).join(', '));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await database.closeDatabase();
}
