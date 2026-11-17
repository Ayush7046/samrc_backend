// Versioned migration marker lets us refuse unrelated pre-existing tables.
export async function migrateAuth(database) {
  const names = ['users', 'account_status', 'auth_sessions'];
  const existing = await database.query("SELECT TABLE_NAME AS name, TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('users', 'account_status', 'auth_sessions')");
  for (const table of existing) {
    if (table.comment !== 'samrc-natyashala-auth-v1') throw new Error(`Refusing to modify existing ${table.name}; manual schema review required.`);
  }
  const suffix = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='samrc-natyashala-auth-v1'";
  await database.query(`CREATE TABLE IF NOT EXISTS users (
    email VARCHAR(254) PRIMARY KEY,
    username VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(16) NULL UNIQUE
  ) ${suffix}`);
  await database.query(`CREATE TABLE IF NOT EXISTS account_status (
    email VARCHAR(254) PRIMARY KEY,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    classification VARCHAR(32) NULL DEFAULT NULL,
    FOREIGN KEY (email) REFERENCES users(email) ON DELETE CASCADE
  ) ${suffix}`);
  await database.query(`CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash CHAR(64) PRIMARY KEY,
    email VARCHAR(254) NOT NULL,
    expires_at DATETIME NOT NULL,
    INDEX (expires_at),
    FOREIGN KEY (email) REFERENCES users(email) ON DELETE CASCADE
  ) ${suffix}`);
  return names;
}
