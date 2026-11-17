import { Router } from 'express';
import { createFeaturesRouter } from '../natyashala/features-router.js';
import { createPortfolioRouter } from '../natyashala/portfolio.js';
import { createAdminRouter } from '../admin/router.js';
import { createHash, randomBytes } from 'node:crypto';
import { validateSignup, validateLogin } from './validation.js';
import { hashPassword, verifyPassword } from './passwords.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const sessionDuration = 7 * 24 * 60 * 60 * 1000;
// A valid fixed dummy hash keeps unknown-account login on the same hashing path.
const dummyHash = `scrypt-v1$${'0'.repeat(32)}$${'0'.repeat(128)}`;
function sessionToken(req, cookieName) {
  const value = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
}
function publicUser(row) {
  return { email: row.email, username: row.username, phone: row.phone,
    verified: Boolean(row.verified), classification: row.classification || null };
}

export function createAuthRouter(database, options = {}) {
  const router = Router();
  const cookieName = options.cookieName || 'natyashala_session';
  const cookiePath = options.cookiePath || '/api/natyashala/auth';
  const origins = new Set(options.origins || ['http://localhost:8443', 'http://127.0.0.1:8443', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://127.0.0.1:3001']);
  const secure = options.secure ?? process.env.NODE_ENV === 'production';
  const cookieOptions = { httpOnly: true, secure, sameSite: 'lax', path: cookiePath };
  const attempts = new Map();
  let activeHashes = 0;

  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use((req, res, next) => {
    if (req.method === 'GET') return next();
    const origin = req.get('origin');
    const allowed = !origin || origins.has(origin) || (() => {
      try {
        const u = new URL(origin);
        return ['localhost', '127.0.0.1'].includes(u.hostname);
      } catch { return false; }
    })();
    if (!allowed || req.get('x-requested-with') !== 'SAMRC') {
      return res.status(403).json({ message: 'Request origin not allowed.' });
    }
    const hasBody = req.get('content-length') && req.get('content-length') !== '0';
    if (hasBody && !req.is('application/json') && !req.is('multipart/form-data')) {
      return res.status(415).json({ message: 'Unsupported content type.' });
    }
    next();
  });
  function limit(req, res, next) {
    const now = Date.now();
    for (const [key, bucket] of attempts) if (bucket.until <= now) attempts.delete(key);
    const key = req.ip;
    const bucket = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    if (bucket.count >= (options.attemptLimit ?? 20) || (!attempts.has(key) && attempts.size >= 10000)) {
      res.set('Retry-After', String(Math.ceil((bucket.until - now) / 1000)));
      return res.status(429).json({ message: 'Too many attempts. Try again later.' });
    }
    bucket.count += 1;
    attempts.set(key, bucket);
    if (activeHashes >= 4) return res.status(503).json({ message: 'Sign-in is busy. Please try again.' });
    next();
  }
  async function hashing(work) {
    if (activeHashes >= 4) throw Object.assign(new Error('Hashing capacity reached'), { code: 'AUTH_BUSY' });
    activeHashes += 1;
    try { return await work(); } finally { activeHashes -= 1; }
  }
  async function addSession(db, email, req) {
    const old = sessionToken(req, cookieName);
    if (old) await db.query('DELETE FROM auth_sessions WHERE token_hash = ?', [digest(old)]);
    await db.query('DELETE FROM auth_sessions WHERE expires_at <= UTC_TIMESTAMP()');
    const token = randomBytes(32).toString('hex');
    await db.query('INSERT INTO auth_sessions (token_hash, email, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))', [digest(token), email]);
    return token;
  }
  function setSession(res, token) {
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: sessionDuration });
  }
  router.post('/signup', limit, async (req, res, next) => {
    try {
      const input = validateSignup(req.body);
      const passwordHash = await hashing(() => hashPassword(input.password));
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const username = attempt === 0 ? input.username : `${input.username.slice(0, 48)}_${randomBytes(4).toString('hex')}`;
        try {
          const token = await database.transaction(async db => {
            await db.query('INSERT INTO users (email, username, password_hash, phone) VALUES (?, ?, ?, ?)', [input.email, username, passwordHash, input.phone]);
            await db.query('INSERT INTO account_status (email) VALUES (?)', [input.email]);
            return addSession(db, input.email, req);
          });
          setSession(res, token);
          return res.status(201).json({ user: { email: input.email, username, phone: input.phone, verified: false, classification: null } });
        } catch (error) {
          if (error.code !== 'ER_DUP_ENTRY') throw error;
          const existing = await database.query('SELECT email FROM users WHERE email = ? OR phone = ?', [input.email, input.phone]);
          if (existing.length || !input.generatedUsername || attempt === 5) {
            return res.status(409).json({ message: 'An account already uses this email, username or phone number.' });
          }
        }
      }
    } catch (error) { next(error); }
  });
  router.post('/login', limit, async (req, res, next) => {
    try {
      const input = validateLogin(req.body);
      const rows = await database.query(`SELECT u.*, s.verified, s.classification FROM users u JOIN account_status s ON s.email = u.email WHERE u.${input.isEmail ? 'email' : 'phone'} = ?`, [input.identifier]);
      const user = rows[0];
      const valid = await hashing(() => verifyPassword(input.password, user?.password_hash || dummyHash));
      if (!user || !valid) return res.status(401).json({ message: 'Email/phone or password is incorrect.' });
      const token = await database.transaction(db => addSession(db, user.email, req));
      setSession(res, token);
      res.json({ user: publicUser(user) });
    } catch (error) { next(error); }
  });
  router.get('/session', async (req, res, next) => {
    try {
      const token = sessionToken(req, cookieName);
      if (!token) return res.status(401).json({ message: 'Please log in.' });
      const rows = await database.query('SELECT u.email, u.username, u.phone, s.verified, s.classification FROM auth_sessions a JOIN users u ON u.email = a.email JOIN account_status s ON s.email = u.email WHERE a.token_hash = ? AND a.expires_at > UTC_TIMESTAMP()', [digest(token)]);
      if (!rows.length) {
        res.clearCookie(cookieName, cookieOptions);
        return res.status(401).json({ message: 'Please log in.' });
      }
      res.json({ user: publicUser(rows[0]) });
    } catch (error) { next(error); }
  });
  router.post('/logout', async (req, res, next) => {
    try {
      const token = sessionToken(req, cookieName);
      if (token) await database.query('DELETE FROM auth_sessions WHERE token_hash = ?', [digest(token)]);
      res.clearCookie(cookieName, cookieOptions);
      res.status(204).end();
    } catch (error) { next(error); }
  });
  async function authenticate(req, res, next) {
    try {
      const token = sessionToken(req, cookieName);
      if (!token) return res.status(401).json({ message: 'Please log in.' });
      const [account] = await database.query('SELECT s.email, s.verified, s.classification FROM auth_sessions a JOIN account_status s ON s.email = a.email WHERE a.token_hash = ? AND a.expires_at > UTC_TIMESTAMP()', [digest(token)]);
      if (!account) return res.status(401).json({ message: 'Please log in.' });
      req.account = account;
      next();
    } catch(error) { next(error); }
  }
  router.use('/features', createFeaturesRouter(database, authenticate, options.features));
  router.use('/features', createPortfolioRouter(database, authenticate));
  router.use('/admin', createAdminRouter(database, authenticate));
  router.use((error, _req, res, _next) => {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    console.error('Authentication request failed:', error.code || error.name);
    res.status(503).json({ message: 'Account service unavailable. Please try again later.' });
  });
  return router;
}
