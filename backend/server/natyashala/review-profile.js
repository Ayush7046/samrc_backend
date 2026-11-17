import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { profileTables } from './features-schema.js';
import { fail } from './profiles.js';

// Local operator command only. No HTTP route exposes verification decisions.
export async function reviewProfile(database, email, decision, reason) {
  return database.transaction(db=>applyProfileReview(db,email,decision,reason));
}
export async function applyProfileReview(db,email,decision,reason) {
  if (typeof email !== 'string' || !email.includes('@') || email.length > 254) fail(400,'An exact account email is required.');
  if (!['verify','reject'].includes(decision)) fail(400,'Decision must be verify or reject.');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 2000) fail(400,'A review reason of 1–2000 characters is required.');
    const [account] = await db.query('SELECT classification FROM account_status WHERE email=? FOR UPDATE',[email]);
    if (!account || !Object.hasOwn(profileTables, account.classification)) fail(400,'Account must have a selected role and submitted profile.');
    const [profile] = await db.query(`SELECT email FROM ${profileTables[account.classification]} WHERE email=? FOR UPDATE`,[email]);
    if (!profile) fail(400,'Account has no submitted profile.');
    await db.query('UPDATE account_status SET verified=? WHERE email=?',[decision === 'verify',email]);
    await db.query('INSERT INTO profile_reviews(id,email,decision,reason) VALUES(?,?,?,?)',[randomUUID(),email,decision,reason.trim()]);
    return {email,role:account.classification,decision};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const database = await import('../db.js');
  try {
    const [email,decision,...reason] = process.argv.slice(2);
    console.log(await reviewProfile(database,email,decision,reason.join(' ')));
  } catch(error) { console.error(error.message); process.exitCode=1; }
  finally { await database.closeDatabase(); }
}
