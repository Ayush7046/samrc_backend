import { randomUUID } from 'node:crypto';
import { fail, text } from '../natyashala/profiles.js';
export const implementedSites = ['natyashala'];
export function siteName(value) {
  if (typeof value!=='string'|| !/^[a-z][a-z0-9-]{0,63}$/.test(value)) fail(400,'Enter a valid site identifier.');
  return value;
}
export function accountEmail(body) {
  const email=text(body,'email',254);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400,'Enter an exact existing account email.');
  return email;
}
export async function authority(db,email) {
  const sudo=await db.query('SELECT email FROM sudo_admins WHERE email=?',[email]);
  const sites=await db.query('SELECT site FROM site_admin_memberships WHERE email=? ORDER BY site',[email]);
  return {isSudo:Boolean(sudo.length),sites:sites.map(row=>row.site)};
}
export async function requireSudo(db,email) {
  if(!(await authority(db,email)).isSudo) fail(403,'Sudo administrator access is required.');
}
export async function requireSite(db,email,site) {
  siteName(site);
  if(!implementedSites.includes(site)) fail(404,'This site has no management API yet.');
  const access=await authority(db,email);
  if(!access.isSudo&&!access.sites.includes(site)) fail(403,'Administrator access to this site is required.');
}
export async function audit(db,actor,target,site,action,reason) {
  await db.query('INSERT INTO admin_audit(id,actor_email,target_email,site,action,reason) VALUES(?,?,?,?,?,?)',[randomUUID(),actor,target,site,action,reason]);
}
