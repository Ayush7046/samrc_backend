import { Router } from 'express';
import { randomUUID, createHash } from 'node:crypto';
import { profileTables } from './features-schema.js';
import { fail, text, validateProfile, profileFromRow, getProfile } from './profiles.js';
function amount(value) {
  const result = String(value ?? '');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(result) || Number(result) <= 0) fail(400, 'Enter a positive amount with up to two decimal places.');
  return Number(result).toFixed(2);
}
function currency(value) {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) fail(400, 'Enter a three-letter currency code.');
  return value;
}
function settings(options) {
  const rawFee = options.directorFee ?? (process.env.NATYASHALA_DIRECTOR_FEE ? { amount: process.env.NATYASHALA_DIRECTOR_FEE, currency: process.env.NATYASHALA_DIRECTOR_CURRENCY } : null);
  let fee = null, url = null, scriptBankUrl = null;
  try { if (rawFee) fee = { amount: amount(rawFee.amount), currency: currency(rawFee.currency) }; } catch { /* Invalid configuration is unavailable. */ }
  try {
    const candidate = new URL(options.sdkUrl ?? process.env.NATYASHALA_SDK_URL);
    if (candidate.protocol === 'https:' && candidate.hostname === 'drive.google.com' && !candidate.username && !candidate.password && !candidate.port && /^\/(file\/d\/|drive\/folders\/)[A-Za-z0-9_-]+/.test(candidate.pathname)) url = candidate.href;
  } catch { /* Unconfigured link is not public. */ }
  try {
    const candidate = new URL(options.scriptBankUrl ?? process.env.NATYASHALA_SCRIPT_BANK_URL);
    if (candidate.protocol === 'https:' && candidate.hostname === 'drive.google.com' && !candidate.username && !candidate.password && !candidate.port && /^\/(file\/d\/|drive\/folders\/)[A-Za-z0-9_-]+/.test(candidate.pathname)) scriptBankUrl = candidate.href;
  } catch { /* Unconfigured script bank link is not public. */ }
  return { fee, url, scriptBankUrl };
}
export function createFeaturesRouter(database, authenticate, options = {}) {
  const router = Router();
  const configured = settings(options);
  router.use(authenticate);
  const allowed = (...roles) => (req, _res, next) => {
    if (!roles.includes(req.account.classification)) return next(Object.assign(new Error('A profile with the required role is needed.'), {status:403}));
    next();
  };
  router.get('/profile', async (req,res)=>res.json(await getProfile(database,req.account.email)));
  router.put('/profile', async (req,res)=>{
    const data=validateProfile(req.body),role=req.body.role;
    const name=data.schoolName||data.fullName||data.name;
    await database.transaction(async db=>{
      const [account]=await db.query('SELECT classification FROM account_status WHERE email=? FOR UPDATE',[req.account.email]);
      if(account.classification && account.classification!==role) fail(409,'Your role has already been selected. Contact the team to change it.');
      const table=profileTables[role];
      const [existing]=await db.query('SELECT * FROM '+table+' WHERE email=?',[req.account.email]);
      // Preserve legacy fields in both storage and the extensible document when upgrading a profile.
      const merged={...(profileFromRow(role,existing)||{}),...data};
      await db.query('INSERT INTO '+table+' (email,organisation_name,display_name,contact_phone,city,description,profile_data) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE organisation_name=VALUES(organisation_name),display_name=VALUES(display_name),contact_phone=VALUES(contact_phone),profile_data=VALUES(profile_data)',[req.account.email,name,name,data.contactPhone,existing?.city||'',existing?.description||'',JSON.stringify(merged)]);
      if (role === 'school') {
        await db.query(
          'UPDATE school_profiles SET dice_code=?, staff_size=?, student_count=? WHERE email=?',
          [merged.diceCode||null, merged.staffSize||null, merged.studentCount||null, req.account.email]
        );
      }
      await db.query('UPDATE account_status SET classification=?,verified=FALSE WHERE email=?',[role,req.account.email]);
    });
    res.json(await getProfile(database,req.account.email));
  });
  router.get('/directors',allowed('school'),async (_req,res)=>{
    const rows=await database.query("SELECT p.*,a.verified FROM director_profiles p JOIN account_status a ON a.email=p.email WHERE a.classification='director' ORDER BY p.display_name LIMIT 200");
    const directors=rows.map(row=>{
      const base=profileFromRow('director',row);
      return {
        ...base,
        id:createHash('sha256').update(row.email).digest('hex'),
        displayName:row.display_name,
        city:row.city,
        description:row.description,
        avatarUrl:row.avatar_url || base.avatarUrl || null,
        verified:Boolean(row.verified)
      };
    });
    res.json({directors,fee:configured.fee});
  });
  router.get('/schools',allowed('school','director','sponsor'),async (_req,res)=>{
    const rows=await database.query("SELECT p.*,a.verified FROM school_profiles p JOIN account_status a ON a.email=p.email WHERE a.classification='school' ORDER BY p.display_name LIMIT 200");
    const schools=rows.map(row=>{
      const data=profileFromRow('school',row);
      return {
        id:createHash('sha256').update(row.email).digest('hex'),
        schoolName:data.schoolName || row.organisation_name,
        schoolEmail:data.schoolEmail,
        contactPhone:data.contactPhone,
        address:data.address || row.city,
        city:row.city,
        description:row.description,
        diceCode:row.dice_code || data.diceCode || '',
        staffSize:row.staff_size || data.staffSize || '',
        studentCount:row.student_count || data.studentCount || '',
        verified:Boolean(row.verified)
      };
    });
    res.json({schools});
  });
  router.get('/sponsors',allowed('school','director','sponsor'),async (_req,res)=>{
    const rows=await database.query("SELECT p.*,a.verified FROM sponsor_profiles p JOIN account_status a ON a.email=p.email WHERE a.classification='sponsor' ORDER BY p.organisation_name LIMIT 200");
    const sponsors=rows.map(row=>({...profileFromRow('sponsor',row),id:createHash('sha256').update(row.email).digest('hex'),name:row.organisation_name,verified:Boolean(row.verified)}));
    res.json({sponsors});
  });
  router.post('/promotions',allowed('school'),async(req,res)=>{
    const id=randomUUID();
    const seekingSponsor=Boolean(req.body?.seekingSponsor);
    let duration=Number(req.body?.durationDays) || 7;
    if (duration < 1 || duration > 60) duration = 7;
    await database.query(
      'INSERT INTO school_promotions(id,school_email,title,description,seeking_sponsor,duration_days,expires_at) VALUES(?,?,?,?,?,?,DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? DAY))',
      [id,req.account.email,text(req.body,'title',200),text(req.body,'description',2000),seekingSponsor,duration,duration]
    );
    res.status(201).json({id});
  });
  router.get('/promotions',allowed('school','director','sponsor'),async(req,res)=>{
    const own=req.account.classification==='school';
    const rows=await database.query(
      "SELECT p.*,s.id,s.title,s.description AS post_description,s.seeking_sponsor,s.duration_days,s.expires_at,s.created_at,a.verified " +
      "FROM school_promotions s JOIN school_profiles p ON p.email=s.school_email JOIN account_status a ON a.email=p.email " +
      "WHERE a.classification='school'" +
      (own ? ' AND s.school_email=?' : ' AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)') +
      ' ORDER BY s.created_at DESC LIMIT 200',
      own ? [req.account.email] : []
    );
    const promotions=rows.map(row=>{
      const data=profileFromRow('school',row);
      const isExpired = row.expires_at ? new Date(row.expires_at).getTime() < Date.now() : false;
      return {
        id:row.id,
        schoolName:data.schoolName,
        schoolEmail:data.schoolEmail,
        contactPhone:data.contactPhone,
        address:data.address,
        title:row.title,
        description:row.post_description,
        seekingSponsor:Boolean(row.seeking_sponsor),
        durationDays:row.duration_days || 7,
        expiresAt:row.expires_at,
        expired:isExpired,
        verified:Boolean(row.verified),
        createdAt:row.created_at
      };
    });
    res.json({promotions});
  });
  router.get('/sdk', allowed('school'), (_req, res) => {
    if (!configured.url) fail(503, 'The drama kit link has not been configured. Please contact the team.');
    const result = { url: configured.url };
    if (configured.scriptBankUrl) result.scriptBankUrl = configured.scriptBankUrl;
    res.json(result);
  });
  router.get('/sponsorships', allowed('school','director','sponsor'), async (req,res) => {
    const sponsor = req.account.classification === 'sponsor';
    const offers = await database.query(`SELECT o.id,p.organisation_name AS sponsorName,o.title,o.description,o.amount,o.currency,o.status,o.duration_days,o.expires_at,a.verified FROM sponsorship_offers o JOIN sponsor_profiles p ON p.email=o.sponsor_email JOIN account_status a ON a.email=p.email WHERE ${sponsor ? 'o.sponsor_email = ?' : "a.classification='sponsor' AND (o.status='open' OR EXISTS(SELECT 1 FROM sponsorship_requests r WHERE r.offer_id=o.id AND r.school_email=?)) AND (o.expires_at IS NULL OR o.expires_at > CURRENT_TIMESTAMP)"} ORDER BY o.created_at DESC LIMIT 200`, [req.account.email]);
    const requests = req.account.classification==='director' ? [] : await database.query(`SELECT r.id,r.offer_id AS offerId,p.organisation_name AS schoolName,r.message,r.status FROM sponsorship_requests r JOIN sponsorship_offers o ON o.id=r.offer_id JOIN school_profiles p ON p.email=r.school_email WHERE ${sponsor ? 'o.sponsor_email' : 'r.school_email'}=? ORDER BY r.created_at DESC LIMIT 200`, [req.account.email]);
    res.json({offers:offers.map(offer=>({...offer,durationDays:offer.duration_days||7,expiresAt:offer.expires_at,verified:Boolean(offer.verified)})),requests});
  });
  router.post('/sponsorships', allowed('sponsor'), async (req,res) => {
    const id = randomUUID();
    let duration = Number(req.body?.durationDays) || 7;
    if (duration < 1 || duration > 60) duration = 7;
    await database.query(
      'INSERT INTO sponsorship_offers(id,sponsor_email,title,description,amount,currency,duration_days,expires_at) VALUES(?,?,?,?,?,?,?,DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? DAY))',
      [id,req.account.email,text(req.body,'title',200),text(req.body,'description',2000),amount(req.body?.amount),currency(req.body?.currency),duration,duration]
    );
    res.status(201).json({id});
  });
  router.post('/sponsorships/:id/requests', allowed('school'), async (req,res) => {
    const id = randomUUID(), message = text(req.body,'message',2000);
    await database.transaction(async db => {
      const [offer] = await db.query('SELECT o.status,a.verified,a.classification FROM sponsorship_offers o JOIN account_status a ON a.email=o.sponsor_email WHERE o.id=? FOR UPDATE',[req.params.id]);
      if (!offer || offer.classification !== 'sponsor') fail(404,'Sponsorship not found.');
      if (offer.status !== 'open') fail(409,'This sponsorship is already allocated.');
      try { await db.query('INSERT INTO sponsorship_requests(id,offer_id,school_email,message) VALUES(?,?,?,?)',[id,req.params.id,req.account.email,message]); }
      catch(error) { if(error.code==='ER_DUP_ENTRY') fail(409,'You have already requested this sponsorship.'); throw error; }
    });
    res.status(201).json({id});
  });
  router.post('/requests/:id/approve', allowed('sponsor'), async (req,res) => {
    await database.transaction(async db => {
      // Lock the offer first so competing approvals always serialize.
      const [target] = await db.query('SELECT offer_id FROM sponsorship_requests WHERE id=?',[req.params.id]);
      if (!target) fail(404,'Request not found.');
      const [offer] = await db.query('SELECT status,sponsor_email FROM sponsorship_offers WHERE id=? FOR UPDATE',[target.offer_id]);
      if (!offer || offer.sponsor_email !== req.account.email) fail(404,'Request not found.');
      if (offer.status !== 'open') fail(409,'This sponsorship is already allocated.');
      const [request] = await db.query('SELECT r.status,a.verified,a.classification FROM sponsorship_requests r JOIN account_status a ON a.email=r.school_email WHERE r.id=? FOR UPDATE',[req.params.id]);
      if (!request || request.status !== 'pending' || request.classification !== 'school') fail(409,'This school request is not eligible for approval.');
      await db.query("UPDATE sponsorship_requests SET status=CASE WHEN id=? THEN 'approved' ELSE 'declined' END WHERE offer_id=? AND status='pending'",[req.params.id,target.offer_id]);
      await db.query("UPDATE sponsorship_offers SET status='closed' WHERE id=?",[target.offer_id]);
    });
    res.json({status:'approved'});
  });
  router.use((error,_req,res,_next) => {
    if ([400,403,404,409,503].includes(error.status)) return res.status(error.status).json({message:error.message});
    console.error('Feature request failed:',error.code || error.name);
    res.status(503).json({message:'Feature service unavailable. Please try again later.'});
  });
  return router;
}
