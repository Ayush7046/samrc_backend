import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const multer = require('multer');

const UPLOAD_DIR = join(process.cwd(), 'server', 'uploads', 'portfolio');
mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const id = randomUUID();
    const ext = file.originalname.split('.').pop()?.toLowerCase() || 'bin';
    file._assignedId = id;
    cb(null, `${id}.${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error('Only PDF, JPEG, PNG, WebP and GIF files are allowed.'), { status: 400 }));
  },
});

export function createPortfolioRouter(database, authenticate) {
  const router = Router();
  router.use(authenticate);
  const requireDirector = (req, _res, next) => {
    if (req.account.classification !== 'director') return next(Object.assign(new Error('Only drama directors can manage portfolio files.'), { status: 403 }));
    next();
  };

  // List director's own portfolio files
  router.get('/portfolio/files', requireDirector, async (req, res) => {
    const rows = await database.query(
      'SELECT id, original_name, stored_name, mime_type, file_size, created_at FROM director_portfolio_files WHERE director_email=? ORDER BY created_at DESC LIMIT 20',
      [req.account.email]
    );
    res.json({ files: rows });
  });

  // List another director's portfolio files (public — any authenticated user)
  router.get('/portfolio/files/:directorId', async (req, res) => {
    const { directorId } = req.params;
    const rows = await database.query(
      'SELECT id, original_name, stored_name, mime_type, file_size, created_at FROM director_portfolio_files WHERE director_email=? ORDER BY created_at DESC LIMIT 20',
      [directorId]
    );
    res.json({ files: rows });
  });

  // Upload a file (director only, max 5 files per director)
  router.post('/portfolio/files', requireDirector, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const count = await database.query(
      'SELECT COUNT(*) AS total FROM director_portfolio_files WHERE director_email=?',
      [req.account.email]
    );
    if (count[0].total >= 5) {
      return res.status(409).json({ message: 'Maximum 5 portfolio files allowed. Remove one before adding another.' });
    }
    const id = req.file._assignedId || randomUUID();
    await database.query(
      'INSERT INTO director_portfolio_files(id, director_email, original_name, stored_name, mime_type, file_size) VALUES(?,?,?,?,?,?)',
      [id, req.account.email, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size]
    );
    res.status(201).json({ id, storedName: req.file.filename, originalName: req.file.originalname, mimeType: req.file.mimetype, fileSize: req.file.size });
  });

  // Upload avatar / profile picture (director only)
  router.post('/portfolio/avatar', requireDirector, upload.single('avatar'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No image uploaded.' });
    if (!req.file.mimetype.startsWith('image/')) return res.status(400).json({ message: 'Only images can be used as profile picture.' });
    const avatarUrl = `/api/natyashala/auth/features/portfolio/serve/${req.file.filename}`;
    const [existing] = await database.query('SELECT profile_data FROM director_profiles WHERE email=?', [req.account.email]);
    let data = {};
    try { data = typeof existing?.profile_data === 'string' ? JSON.parse(existing.profile_data) : (existing?.profile_data || {}); } catch {}
    data.avatarUrl = avatarUrl;
    await database.query(
      'UPDATE director_profiles SET avatar_url=?, profile_data=? WHERE email=?',
      [avatarUrl, JSON.stringify(data), req.account.email]
    );
    res.json({ avatarUrl });
  });

  // Delete a portfolio file (director only, own files)
  router.delete('/portfolio/files/:id', requireDirector, async (req, res) => {
    import('node:fs/promises').then(async ({ unlink }) => {
      const rows = await database.query(
        'SELECT stored_name FROM director_portfolio_files WHERE id=? AND director_email=?',
        [req.params.id, req.account.email]
      );
      if (!rows.length) return res.status(404).json({ message: 'File not found.' });
      await database.query('DELETE FROM director_portfolio_files WHERE id=?', [req.params.id]);
      try { await unlink(join(UPLOAD_DIR, rows[0].stored_name)); } catch { /* file may already be gone */ }
      res.json({ deleted: true });
    });
  });

  // Serve uploaded files (authenticated users only)
  router.get('/portfolio/serve/:identifier', async (req, res) => {
    const { identifier } = req.params;
    const baseId = identifier.replace(/\.[a-z0-9]+$/i, '');
    const rows = await database.query(
      'SELECT stored_name, mime_type, original_name FROM director_portfolio_files WHERE id=? OR stored_name=? OR id=?',
      [identifier, identifier, baseId]
    );
    let filename = rows[0]?.stored_name;
    let mime = rows[0]?.mime_type;
    let originalName = rows[0]?.original_name || 'portfolio-file';

    if (!filename) {
      if (/^[a-f0-9-]+\.(pdf|jpe?g|png|webp|gif)$/i.test(identifier)) {
        filename = identifier;
      } else {
        return res.status(404).json({ message: 'File not found.' });
      }
    }

    const filepath = join(UPLOAD_DIR, filename);
    if (mime) res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(originalName)}"`);
    res.sendFile(filepath, err => {
      if (err) res.status(404).json({ message: 'File not found.' });
    });
  });

  router.use((error, _req, res, _next) => {
    if ([400, 403, 404, 409].includes(error.status)) return res.status(error.status).json({ message: error.message });
    console.error('Portfolio error:', error.code || error.name);
    res.status(503).json({ message: 'Portfolio service unavailable.' });
  });

  return router;
}
