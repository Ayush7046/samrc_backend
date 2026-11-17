import { createApp } from './app.js';
import { config } from './config.js';
import * as database from './db.js';

const server = createApp(database, {
  auth: {
    origins: config.authOrigins,
    features: {
      sdkUrl: process.env.NATYASHALA_SDK_URL || 'https://drive.google.com/drive/folders/1a4CSZSJkiM77-6yrbwvmfEHnFoDVq4gM',
      scriptBankUrl: process.env.NATYASHALA_SCRIPT_BANK_URL || 'https://drive.google.com/drive/folders/1Q-ikod3Rw2cldYXn4-6GivJiJCk8fqbR',
    },
  },
}).listen(config.port, config.host, () => {
  console.log(`API listening on http://${config.host}:${config.port}`);
});

server.on('error', async error => {
  console.error(`API failed to start: ${error.code || 'unknown error'}`);
  await database.closeDatabase();
  process.exitCode = 1;
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  server.close(async () => {
    try {
      await database.closeDatabase();
    } catch {
      process.exitCode = 1;
    } finally {
      clearTimeout(timeout);
    }
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
