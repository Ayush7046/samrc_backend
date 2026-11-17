export const profileTables = Object.freeze({ school: 'school_profiles', director: 'director_profiles', sponsor: 'sponsor_profiles' });
export async function migrateFeatures(database) {
  const names = [...Object.values(profileTables), 'sponsorship_offers', 'sponsorship_requests', 'profile_reviews', 'school_promotions', 'sudo_admins', 'site_admin_memberships', 'admin_audit', 'director_portfolio_files'];
  const existing = await database.query(`SELECT TABLE_NAME AS name, TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${names.map(() => '?').join(',')})`, names);
  for (const table of existing) if (table.comment !== 'samrc-natyashala-features-v1') throw new Error(`Existing ${table.name} needs manual schema review.`);
  const suffix = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='samrc-natyashala-features-v1'";
  for (const name of Object.values(profileTables)) await database.query(`CREATE TABLE IF NOT EXISTS ${name} (
    email VARCHAR(254) PRIMARY KEY, organisation_name VARCHAR(200) NOT NULL,
    display_name VARCHAR(120) NOT NULL, contact_phone VARCHAR(16) NOT NULL,
    city VARCHAR(120) NOT NULL, description TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (email) REFERENCES users(email) ON DELETE CASCADE
  ) ${suffix}`);
  await database.query(`CREATE TABLE IF NOT EXISTS sponsorship_offers (
    id CHAR(36) PRIMARY KEY, sponsor_email VARCHAR(254) NOT NULL,
    title VARCHAR(200) NOT NULL, description TEXT NOT NULL,
    amount DECIMAL(12,2) NOT NULL, currency CHAR(3) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'open', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sponsor_email) REFERENCES sponsor_profiles(email) ON DELETE CASCADE,
    INDEX(status,created_at)
  ) ${suffix}`);
  await database.query(`CREATE TABLE IF NOT EXISTS sponsorship_requests (
    id CHAR(36) PRIMARY KEY, offer_id CHAR(36) NOT NULL, school_email VARCHAR(254) NOT NULL,
    message TEXT NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(offer_id,school_email),
    FOREIGN KEY(offer_id) REFERENCES sponsorship_offers(id) ON DELETE CASCADE,
    FOREIGN KEY(school_email) REFERENCES school_profiles(email) ON DELETE CASCADE
  ) ${suffix}`);
  await database.query(`CREATE TABLE IF NOT EXISTS profile_reviews (
    id CHAR(36) PRIMARY KEY, email VARCHAR(254) NOT NULL, decision VARCHAR(16) NOT NULL,
    reason VARCHAR(2000) NOT NULL, reviewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(email) REFERENCES users(email) ON DELETE CASCADE
  ) ${suffix}`);
  // Additive v2 extension: retain every original profile column and value.
  for (const name of Object.values(profileTables)) {
    const columns = await database.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [name,'profile_data']);
    if (!columns.length) await database.query(`ALTER TABLE ${name} ADD COLUMN profile_data JSON NULL`);
  }
  await database.query(`CREATE TABLE IF NOT EXISTS school_promotions (
    id CHAR(36) PRIMARY KEY, school_email VARCHAR(254) NOT NULL,
    title VARCHAR(200) NOT NULL, description TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(school_email) REFERENCES school_profiles(email) ON DELETE CASCADE
  ) ${suffix}`);
  await database.query(`CREATE TABLE IF NOT EXISTS sudo_admins (
    email VARCHAR(254) PRIMARY KEY, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(email) REFERENCES users(email) ON DELETE CASCADE
  ) ${suffix}`);
  await database.query(`CREATE TABLE IF NOT EXISTS site_admin_memberships (
    email VARCHAR(254) NOT NULL, site VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(email,site), FOREIGN KEY(email) REFERENCES users(email) ON DELETE CASCADE
  ) ${suffix}`);
  await database.query(`CREATE TABLE IF NOT EXISTS admin_audit (
    id CHAR(36) PRIMARY KEY, actor_email VARCHAR(254) NOT NULL,
    target_email VARCHAR(254) NOT NULL, site VARCHAR(64) NOT NULL,
    action VARCHAR(40) NOT NULL, reason VARCHAR(2000) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX(site,created_at)
  ) ${suffix}`);
  // New school profile fields + director portfolio_works + v1.3.1.0 extensions (additive migration)
  for (const col of [
    ['school_profiles', 'dice_code', 'VARCHAR(100) NULL'],
    ['school_profiles', 'staff_size', 'VARCHAR(50) NULL'],
    ['school_profiles', 'student_count', 'VARCHAR(50) NULL'],
    ['director_profiles', 'portfolio_works', 'JSON NULL'],
    ['director_profiles', 'avatar_url', 'VARCHAR(500) NULL'],
    ['school_promotions', 'seeking_sponsor', 'BOOLEAN NOT NULL DEFAULT FALSE'],
    ['school_promotions', 'duration_days', 'INT NOT NULL DEFAULT 7'],
    ['school_promotions', 'expires_at', 'TIMESTAMP NULL'],
    ['sponsorship_offers', 'duration_days', 'INT NOT NULL DEFAULT 7'],
    ['sponsorship_offers', 'expires_at', 'TIMESTAMP NULL'],
  ]) {
    const existing = await database.query(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
      [col[0], col[1]]
    );
    if (!existing.length) {
      try {
        await database.query(`ALTER TABLE ${col[0]} ADD COLUMN ${col[1]} ${col[2]}`);
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') throw err;
      }
    }
  }
  await database.query(`CREATE TABLE IF NOT EXISTS director_portfolio_files (
    id CHAR(36) PRIMARY KEY,
    director_email VARCHAR(254) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(director_email) REFERENCES director_profiles(email) ON DELETE CASCADE,
    INDEX(director_email, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='samrc-natyashala-features-v1'`);
  return names;
}
