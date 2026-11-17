import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)), quiet: true });

function positiveInteger(name, fallback, maximum = 65535) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

export const config = {
  authOrigins: (process.env.AUTH_ORIGINS || 'http://localhost:8443,http://127.0.0.1:8443,http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:3001').split(',').map(value => value.trim()).filter(Boolean),
  host: process.env.API_HOST || '127.0.0.1',
  port: positiveInteger('API_PORT', 3001),
  database: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: positiveInteger('DB_PORT', 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME || 'natak',
    connectionLimit: positiveInteger('DB_CONNECTION_LIMIT', 10, 100),
    waitForConnections: true,
    queueLimit: 100,
    connectTimeout: 10000,
    multipleStatements: false,
  },
};
