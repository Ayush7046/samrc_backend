export function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}
function bodyObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Invalid request body.');
}
function email(value) {
  if (typeof value !== 'string') throw invalid('Enter a valid email address.');
  const result = value.trim().toLowerCase();
  if (result.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw invalid('Enter a valid email address.');
  return result;
}
function phone(value) {
  if (typeof value !== 'string') throw invalid('Enter a phone number with country code, for example +919876543210.');
  const result = value.replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(result)) throw invalid('Enter a phone number with country code, for example +919876543210.');
  return result;
}
function password(value, minimum) {
  if (typeof value !== 'string' || value.length < minimum || value.length > 128) throw invalid(`Password must contain ${minimum}–128 characters.`);
  return value;
}
export function validateSignup(body) {
  bodyObject(body);
  const validPassword = password(body.password, 12);
  if (typeof body.confirmPassword !== 'string' || body.confirmPassword !== validPassword) throw invalid('Passwords do not match. Please confirm your password.');
  const normalizedEmail = email(body.email);
  if (body.username != null && typeof body.username !== 'string') throw invalid('Enter a valid username.');
  const supplied = body.username?.trim();
  const generatedUsername = !supplied;
  const username = supplied || normalizedEmail.split('@')[0].replace(/[^a-z0-9_.-]/g, '_').slice(0, 48);
  if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(username)) throw invalid('Username must be 1–64 letters, numbers, dots, underscores or hyphens.');
  return { email: normalizedEmail, username, generatedUsername,
    password: validPassword, phone: body.phone == null || body.phone === '' ? null : phone(body.phone) };
}
export function validateLogin(body) {
  bodyObject(body);
  if (typeof body.identifier !== 'string') throw invalid('Enter your email or phone number.');
  const identifier = body.identifier.includes('@') ? email(body.identifier) : phone(body.identifier);
  return { identifier, isEmail: identifier.includes('@'), password: password(body.password, 1) };
}
