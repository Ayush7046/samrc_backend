import { Router } from 'express';
import { createHash } from 'node:crypto';
import { programmes } from './catalogue.js';
import { validateInquiry } from './validation.js';
import { config } from '../config.js';

export function createNatyashalaRouter(database, options = {}) {
  const router = Router();
  const origins = new Set(options.origins || config.authOrigins);
  const buckets = new Map();
  router.get('/programmes', (_req, res) => res.json({ programmes }));
  router.post('/inquiries', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const gu = req.body?.locale === 'gu';
    const error = (status, en, local) => res.status(status).json({ message: gu ? local : en });
    if (!origins.has(req.get('origin')) || req.get('x-requested-with') !== 'SAMRC' || !req.is('application/json')) return error(403, 'Request origin not allowed.', 'આ પેજ પરથી વિનંતી સ્વીકાર્ય નથી.');
    const now = Date.now();
    for (const [key, value] of buckets) if (value.until <= now) buckets.delete(key);
    const bucket = buckets.get(req.ip) || { count: 0, until: now + 10 * 60 * 1000 };
    if (bucket.count >= (options.limit ?? 5) || (!buckets.has(req.ip) && buckets.size >= 10000)) {
      res.set('Retry-After', String(Math.ceil((bucket.until - now) / 1000)));
      return error(429, 'Too many inquiries. Please try again in a few minutes.', 'ઘણી વિનંતીઓ થઈ છે. કૃપા કરીને થોડી મિનિટો પછી પ્રયત્ન કરો.');
    }
    bucket.count += 1;
    buckets.set(req.ip, bucket);
    try {
      const input = validateInquiry(req.body);
      const { reference, ...payload } = input;
      const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      try {
        await database.query('INSERT INTO natyashala_inquiries (reference, organisation, contact_name, phone, email, programme_id, message, locale, payload_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [reference, input.organisation, input.contactName, input.phone, input.email, input.programme, input.message, input.locale, hash]);
      } catch (failure) {
        if (failure.code !== 'ER_DUP_ENTRY') throw failure;
        const rows = await database.query('SELECT payload_hash FROM natyashala_inquiries WHERE reference = ?', [reference]);
        if (!rows.length || rows[0].payload_hash !== hash) return error(409, 'This reference was already used. Start a new inquiry.', 'આ સંદર્ભનો ઉપયોગ થઈ ગયો છે. નવી પૂછપરછ શરૂ કરો.');
        return res.status(200).json({ reference, status: 'received' });
      }
      return res.status(201).json({ reference, status: 'received' });
    } catch (failure) {
      if (failure.status === 400) return res.status(400).json({ message: failure.message });
      console.error('Inquiry submission failed:', failure.code || failure.name);
      return error(503, 'We could not save your inquiry. Please retry or call us.', 'તમારી પૂછપરછ સાચવી શકાઈ નથી. ફરી પ્રયત્ન કરો અથવા અમને ફોન કરો.');
    }
  });
  return router;
}
