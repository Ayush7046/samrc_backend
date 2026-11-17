import * as database from './db.js';
import { migrateAuth } from './auth/schema.js';
import { migrateInquiries } from './natyashala/schema.js';
import { migrateFeatures } from './natyashala/features-schema.js';
try {
  console.log('Authentication schema ready:', (await migrateAuth(database)).join(', '));
  console.log('Inquiry schema ready:', await migrateInquiries(database));
  console.log('Feature schema ready:', (await migrateFeatures(database)).join(', '));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await database.closeDatabase(); }
