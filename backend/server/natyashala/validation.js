import { programmes } from './catalogue.js';
export function validateInquiry(body) {
  const gu = body?.locale === 'gu';
  function fail(en, local) { throw Object.assign(new Error(gu ? local : en), { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Invalid inquiry.', 'પૂછપરછની વિગતો માન્ય નથી.');
  function text(key, max, en, local, required = true) {
    if (!required && body[key] == null) return '';
    if (typeof body[key] !== 'string') fail(`Enter ${en}.`, `${local} દાખલ કરો.`);
    const value = body[key].trim();
    if ((required && !value) || value.length > max || /\u0000/.test(value)) fail(`Enter ${en} (up to ${max} characters).`, `${local} દાખલ કરો (મહત્તમ ${max} અક્ષર).`);
    return value;
  }
  const reference = text('reference', 36, 'a valid reference', 'માન્ય સંદર્ભ');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(reference)) fail('Invalid submission reference. Please reload the page.', 'સંદર્ભ માન્ય નથી. કૃપા કરીને પેજ ફરી ખોલો.');
  const organisation = text('organisation', 200, 'the school or organisation name', 'શાળા અથવા સંસ્થાનું નામ');
  const contactName = text('contactName', 120, 'the contact person’s name', 'સંપર્ક વ્યક્તિનું નામ');
  let phone = text('phone', 40, 'a mobile number', 'મોબાઈલ નંબર').replace(/[૦-૯]/g, digit => String(digit.charCodeAt(0) - 0x0AE6)).replace(/[\s()-]/g, '');
  if (/^[6-9]\d{9}$/.test(phone)) phone = `+91${phone}`;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) fail('Enter a 10-digit Indian mobile number or include the country code.', '૧૦ અંકનો ભારતીય મોબાઈલ નંબર અથવા દેશના કોડ સાથે નંબર દાખલ કરો.');
  const email = text('email', 254, 'an email address', 'ઈમેલ આઈડી').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email address.', 'માન્ય ઈમેલ આઈડી દાખલ કરો.');
  const programme = text('programme', 40, 'a programme', 'વિકલ્પ');
  if (!programmes.some(item => item.id === programme)) fail('Select one of the available programmes.', 'ઉપલબ્ધ વિકલ્પોમાંથી એક પસંદ કરો.');
  if (!['en', 'gu'].includes(body.locale)) fail('Select a supported language.', 'માન્ય ભાષા પસંદ કરો.');
  return { reference: reference.toLowerCase(), organisation, contactName, phone, email, programme, message: text('message', 2000, 'a message', 'સંદેશ', false), locale: body.locale };
}
