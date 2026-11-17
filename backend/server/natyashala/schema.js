export async function migrateInquiries(database) {
  const existing = await database.query("SELECT TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'natyashala_inquiries'");
  if (existing.length && existing[0].comment !== 'samrc-natyashala-inquiries-v1') throw new Error('Existing natyashala_inquiries needs manual schema review.');
  await database.query(`CREATE TABLE IF NOT EXISTS natyashala_inquiries (
    reference CHAR(36) PRIMARY KEY,
    organisation VARCHAR(200) NOT NULL,
    contact_name VARCHAR(120) NOT NULL,
    phone VARCHAR(16) NOT NULL,
    email VARCHAR(254) NOT NULL,
    programme_id VARCHAR(40) NOT NULL,
    message TEXT NOT NULL,
    locale VARCHAR(2) NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'new',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX (status, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='samrc-natyashala-inquiries-v1'`);
  return 'natyashala_inquiries';
}
