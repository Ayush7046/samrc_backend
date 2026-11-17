import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { authority, requireSudo, requireSite, siteName, accountEmail, audit } from './access.js';
import { getProfile, fail } from '../natyashala/profiles.js';
import { profileTables } from '../natyashala/features-schema.js';
import { applyProfileReview } from '../natyashala/review-profile.js';
import { verifyPassword } from '../auth/passwords.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const dummyHash = `scrypt-v1$${'0'.repeat(32)}$${'0'.repeat(128)}`;

function sessionToken(req, cookieName) {
  const value = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
}

export function createAdminRouter(database, parentAuthenticate, options = {}) {
  const router = Router();
  const cookieName = options.cookieName || 'samrc_admin_session';
  const cookiePath = options.cookiePath || '/';
  const secure = options.secure ?? process.env.NODE_ENV === 'production';
  const cookieOptions = { httpOnly: true, secure, sameSite: 'lax', path: cookiePath };

  // 1. Dedicated Admin Login
  router.post('/login', async (req, res, next) => {
    try {
      const email = accountEmail(req.body);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!password) fail(400, 'Enter your administrator password.');

      const [user] = await database.query('SELECT email, username, password_hash FROM users WHERE email=?', [email]);
      const valid = await verifyPassword(password, user?.password_hash || dummyHash);
      if (!user || !valid) fail(401, 'Invalid administrator email or password.');

      const access = await authority(database, email);
      if (!access.isSudo && access.sites.length === 0) {
        fail(403, 'Access Denied: This account does not have administrator privileges.');
      }

      const token = randomBytes(32).toString('hex');
      await database.query(
        'INSERT INTO auth_sessions (token_hash, email, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY))',
        [digest(token), email]
      );

      res.cookie(cookieName, token, { ...cookieOptions, maxAge: 24 * 60 * 60 * 1000 });
      await audit(database, email, email, '*', 'admin.login', 'Administrator signed into admin console');

      res.json({
        user: { email: user.email, username: user.username },
        isSudo: access.isSudo,
        sites: access.sites,
      });
    } catch (error) { next(error); }
  });

  // 2. Dedicated Admin Logout (POST or GET)
  router.all('/logout', async (req, res, next) => {
    try {
      const token = sessionToken(req, cookieName);
      if (token) {
        await database.query('DELETE FROM auth_sessions WHERE token_hash = ?', [digest(token)]);
      }
      res.clearCookie(cookieName, cookieOptions);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  // 3. Admin Authentication Middleware
  async function authenticateAdmin(req, res, next) {
    try {
      const token = sessionToken(req, cookieName);
      if (token) {
        const rows = await database.query(
          'SELECT a.email, u.username FROM auth_sessions a JOIN users u ON u.email = a.email WHERE a.token_hash = ? AND a.expires_at > UTC_TIMESTAMP()',
          [digest(token)]
        );
        if (rows.length) {
          const email = rows[0].email;
          const access = await authority(database, email);
          req.account = {
            email,
            username: rows[0].username,
            isSudo: access.isSudo,
            sites: access.sites,
            isAdminSession: true,
          };
          return next();
        }
        res.clearCookie(cookieName, cookieOptions);
      }

      // Fallback for parent router authentication (preserves integration test harness)
      if (parentAuthenticate) {
        return parentAuthenticate(req, res, async err => {
          if (err) return next(err);
          if (req.account?.email) {
            const access = await authority(database, req.account.email);
            req.account.isSudo = access.isSudo;
            req.account.sites = access.sites;
            req.account.isAdminSession = false;
          }
          next();
        });
      }

      return res.status(401).json({ message: 'Please log in to administration.' });
    } catch (error) { next(error); }
  }

  router.use(authenticateAdmin);
  router.get('/session', async (req, res) => res.json(await authority(database, req.account.email)));
  router.get('/memberships',async(req,res)=>{
    await requireSudo(database,req.account.email);
    const memberships=await database.query('SELECT email,site FROM site_admin_memberships ORDER BY email,site LIMIT 1000');
    res.json({memberships});
  });
  for(const method of ['put','delete']) router[method]('/memberships',async(req,res)=>{
    await requireSudo(database,req.account.email);
    const email=accountEmail(req.body),site=siteName(req.body?.site);
    await database.transaction(async db=>{
      await requireSudo(db,req.account.email);
      const [target]=await db.query('SELECT email FROM users WHERE email=? FOR UPDATE',[email]);
      if(!target) fail(404,'Existing account not found.');
      if(method==='put') await db.query('INSERT IGNORE INTO site_admin_memberships(email,site) VALUES(?,?)',[email,site]);
      else await db.query('DELETE FROM site_admin_memberships WHERE email=? AND site=?',[email,site]);
      await audit(db,req.account.email,email,site,method==='put'?'membership.grant':'membership.revoke',method==='put'?'Sudo granted site administrator access':'Sudo revoked site administrator access');
    });
    res.json({email,site});
  });
  router.get('/sites/:site/users',async(req,res)=>{
    await requireSite(database,req.account.email,req.params.site);
    const limit=Number(req.query.limit??50),after=req.query.after??'';
    if(!Number.isInteger(limit)||limit<1||limit>100||typeof after!=='string'||after.length>254) fail(400,'Use a limit from 1 to 100 and a valid cursor.');
    // Current credentials belong to Natyashala. New sites must implement their own account scope.
    const rows=await database.query(`SELECT email,username FROM users WHERE email>? ORDER BY email LIMIT ${limit+1}`,[after]);
    const hasMore=rows.length>limit,visible=rows.slice(0,limit);
    const users=await Promise.all(visible.map(async row=>{const data=await getProfile(database,row.email);return {...row,role:data.role,verified:data.verificationStatus==='verified',profile:data.profile};}));
    res.json({users,hasMore,nextCursor:hasMore?visible.at(-1).email:null});
  });
  router.post('/sites/:site/users/review',async(req,res)=>{
    await requireSite(database,req.account.email,req.params.site);
    const email=accountEmail(req.body);
    const result=await database.transaction(async db=>{
      await requireSite(db,req.account.email,req.params.site);
      const reviewed=await applyProfileReview(db,email,req.body?.decision,req.body?.reason);
      await audit(db,req.account.email,email,req.params.site,'profile.'+req.body.decision,req.body.reason.trim());
      return reviewed;
    });
    res.json(result);
  });
  router.patch('/sites/:site/users/:email/profile', async (req,res) => {
    await requireSite(database, req.account.email, req.params.site);
    const targetEmail = accountEmail({ email: req.params.email });
    const { field, value } = req.body || {};
    if (!field || typeof field !== 'string' || field.length > 100) fail(400, 'Invalid field name.');
    const result = await database.transaction(async db => {
      await requireSite(db, req.account.email, req.params.site);
      const [account] = await db.query('SELECT classification FROM account_status WHERE email=?', [targetEmail]);
      if (!account || !account.classification) fail(404, 'User profile not found.');
      const table = profileTables[account.classification];
      if (!table) fail(400, 'Unsupported profile.');
      const [row] = await db.query(`SELECT profile_data FROM ${table} WHERE email=?`, [targetEmail]);
      let data = {};
      try { data = typeof row?.profile_data === 'string' ? JSON.parse(row.profile_data) : (row?.profile_data || {}); } catch {}
      data[field] = String(value ?? '').trim();
      await db.query(`UPDATE ${table} SET profile_data=? WHERE email=?`, [JSON.stringify(data), targetEmail]);
      await audit(db, req.account.email, targetEmail, req.params.site, 'profile.field_edit', `Admin updated ${field}`);
      return getProfile(db, targetEmail);
    });
    res.json(result);
  });
  router.use((error, _req, res, _next) => {
    if ([400, 401, 403, 404, 409].includes(error.status)) return res.status(error.status).json({ message: error.message });
    console.error('Admin request failed:', error.code || error.name);
    res.status(503).json({ message: 'Administration service unavailable.' });
  });
  return router;
}
