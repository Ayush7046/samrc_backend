import { profileTables } from './features-schema.js';
export const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function text(body, name, max, optional = false) {
  const value = body?.[name];
  if (optional && value == null) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.trim().length > max || /\u0000/.test(value)) fail(400, `Enter a valid ${name} (up to ${max} characters).`);
  return value.trim();
}
function email(body,key,optional=true) {
  const value=text(body,key,254,optional).toLowerCase();
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail(400,`Enter a valid ${key}.`);
  return value;
}
function phone(body) {
  const value=text(body,'contactPhone',40,true).replace(/[\s()-]/g,'');
  if (value && !/^\+[1-9]\d{7,14}$/.test(value)) fail(400,'Enter a contact phone including country code.');
  return value;
}
function url(body,key) {
  const value=text(body,key,1000,true);
  if (!value) return '';
  try { const parsed=new URL(value); if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password) throw new Error(); }
  catch { fail(400,`Enter an HTTP or HTTPS ${key} link.`); }
  return value;
}
export function validateProfile(body) {
  const role=body?.role;
  if (!Object.hasOwn(profileTables,role)) fail(400,'Choose school, director or sponsor.');
  const contactPhone=phone(body);
  if (role==='school') return {schoolName:text(body,'schoolName',200),schoolEmail:email(body,'schoolEmail',false),address:text(body,'address',1000),website:url(body,'website'),contactPhone,diceCode:text(body,'diceCode',100,true),staffSize:text(body,'staffSize',50,true),studentCount:text(body,'studentCount',50,true)};
  const contactEmail=email(body,'email');
  if (!contactEmail && !contactPhone) fail(400,'Enter a contact email or contact phone.');
  if (role==='director') {
    const experience=text(body,'experience',10);
    if (!['0-1','1-2','2-3','3-5','5+'].includes(experience)) fail(400,'Choose a supported experience range.');
    return {fullName:text(body,'fullName',120),address:text(body,'address',1000,true),experience,email:contactEmail,contactPhone,portfolio:url(body,'portfolio')};
  }
  const availability=text(body,'availability',20);
  if (!['available','limited','unavailable'].includes(availability)) fail(400,'Choose a supported availability status.');
  return {name:text(body,'name',200),email:contactEmail,contactPhone,sponsorshipType:text(body,'sponsorshipType',200),amountRange:text(body,'amountRange',200),eligibility:text(body,'eligibility',2000,true),availability};
}
export function profileFromRow(role,row) {
  if (!row) return null;
  const saved=typeof row.profile_data==='string'?JSON.parse(row.profile_data):row.profile_data;
  if (saved) return saved;
  // Existing records remain editable; never infer a public contact from the login email.
  const common={organisationName:row.organisation_name,displayName:row.display_name,contactPhone:row.contact_phone,city:row.city,description:row.description};
  if(role==='school') return {...common,schoolName:row.organisation_name,schoolEmail:'',address:row.city,website:'',diceCode:row.dice_code||'',staffSize:row.staff_size||'',studentCount:row.student_count||''};
  if(role==='director') return {...common,fullName:row.display_name,address:row.city,experience:'',email:'',portfolio:''};
  return {...common,name:row.organisation_name,email:'',sponsorshipType:'',amountRange:'',eligibility:row.description,availability:'available'};
}
export async function getProfile(database,email) {
  const [account]=await database.query('SELECT classification,verified FROM account_status WHERE email=?',[email]);
  if(!account) fail(404,'Account not found.');
  const table=Object.hasOwn(profileTables,account.classification)?profileTables[account.classification]:null;
  const [row]=table?await database.query(`SELECT * FROM ${table} WHERE email=?`,[email]):[];
  return {role:account.classification||null,verificationStatus:account.verified?'verified':'pending',profile:profileFromRow(account.classification,row)};
}
