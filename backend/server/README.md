# Express + MySQL backend

The dedicated Natyashala page now uses `GET /api/natyashala/programmes` and `POST /api/natyashala/inquiries`. Run `npm run db:migrate` to install inquiry storage. See the [project/inquiry walkthrough](../Docs/AI/Versions/v1.0.0.0/Sprints/NATYASHALA_PROJECT_WALKTHROUGH.md) for field contracts, staff access and verification.

Natyashala authentication is available. Run `npm run db:migrate` before first use and see the [login/signup walkthrough](../Docs/AI/Versions/v1.0.0.0/Sprints/LOGIN_SIGNUP_WALKTHROUGH.md) for routes, fields, sessions, tests and deployment settings.

Requires Node.js 20.19+ and a running MySQL server. The default database is `natak`.

From the project root:

```powershell
npm install
Copy-Item server/.env.example server/.env
```

Edit `server/.env` with your MySQL host, username and password. This file is ignored by Git. Keep credentials in the backend; never use `VITE_` variables for database secrets. Use a dedicated MySQL user with only the permissions your application needs when deploying.

If the database does not exist, create it using your MySQL administrator:

```sql
CREATE DATABASE IF NOT EXISTS natak CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Start the backend and frontend in separate terminals:

```powershell
npm run dev:server
```

```powershell
npm run dev
```

The API listens at `http://127.0.0.1:3001`. Vite forwards `/api` requests to it; restart Vite after this configuration change. If changing `API_PORT`, update the proxy target in `vite.config.ts` too.

- `GET /api/health`: API liveness, independent of MySQL.
- `GET /api/health/db`: executes a query against the configured database; returns 200 if connected or 503 if unavailable.

Frontend example:

```js
const response = await fetch('/api/health/db');
if (!response.ok) throw new Error('Database unavailable');
const status = await response.json();
```

Use the reusable database module inside backend routes/services:

```js
import { query } from './db.js';

// Example only: replace members with an existing table in your database.
const members = await query('SELECT id, name FROM members WHERE id = ?', [memberId]);
// INSERT/UPDATE/DELETE return a result containing insertId / affectedRows.
```

`query` uses prepared statements with parameter binding. Table/column names must be fixed or allowlisted in backend code. No endpoint accepts arbitrary SQL. The explicit migration installs authentication, role profiles, feeds and administrative access tables.

For production use `npm run start:server` and configure your web server to forward `/api` to Express (the Vite development proxy is not part of the built frontend). Set `API_HOST=0.0.0.0` only when the deployment needs external access. Business data and admin routes enforce session and role/site authorization.

Run `npm test` to test API responses with a simulated database. A live connection can be verified after configuration using `Invoke-RestMethod http://127.0.0.1:3001/api/health/db`.

Run `npm run test:db` for live CRUD experiments using an isolated, automatically cleaned-up table. See [the integration test guide](../tests/integration/README.md) for cases, permissions and cleanup behavior.

## Role profiles, feeds and review badges

Run `npm run db:migrate` before starting the updated server. The migration adds role-specific JSON data to the three existing profile tables without deleting or rewriting old profile values. New school promotions and admin tables use the same ownership-marker safety check. The `users` credentials table remains email, username, password_hash and phone.

All feature routes live under `/api/natyashala/auth/features`, within the existing session cookie path. Mutations require the allowed Origin, `X-Requested-With: SAMRC` and JSON. Roles are chosen once; editing a profile resets the review badge to yellow/pending. Pending and rejected profiles retain normal role access. Green/verified means staff approved the profile; it does not establish email/phone ownership.

`GET /profile` returns `{role, verificationStatus, profile}`. `PUT /profile` accepts a flat object with `role` and these fields:

- School: required `schoolName`, `schoolEmail`, `address`; optional `website`, `contactPhone`.
- Director: required `fullName`, `experience` (`0-1`, `1-2`, `2-3`, `3-5`, `5+`); optional `address`, `portfolio`; at least one of `email` or `contactPhone`.
- Sponsor: required `name`, `sponsorshipType`, `amountRange`, `availability` (`available`, `limited`, `unavailable`); optional `eligibility`; at least one of `email` or `contactPhone`.

Contact emails are separate from login credentials. Phone numbers include the country code; website/portfolio links must use HTTP or HTTPS. Stored legacy data remains available to upgrade old profiles.

- `GET /directors`: schools see director profiles and review badges, with only submitted professional contact emails. `NATYASHALA_DIRECTOR_FEE` and `NATYASHALA_DIRECTOR_CURRENCY` configure the fixed fee; missing/invalid settings return `fee: null`.
- `POST /promotions`: schools publish `{title, description}`. `GET /promotions`: schools see their own posts; directors see school posts, submitted school contacts and review badges.
- `GET /sponsorships`: schools and directors see offers; sponsors see their own offers. Requests are visible only to the requesting school and owning sponsor. Only schools can apply through `POST /sponsorships/:id/requests` with `{message}`. Sponsors publish `{title, description, amount, currency}` through `POST /sponsorships`.
- `POST /requests/:id/approve`: only the owning sponsor can approve. A database transaction locks the offer, approves exactly one school, declines competing pending requests and closes the offer. Repeated/concurrent approval cannot allocate it twice.
- `GET /sdk`: any school profile can retrieve the configured `NATYASHALA_SDK_URL`; other roles cannot. Only HTTPS Google Drive file/folder links are accepted. Missing/invalid configuration returns 503. This gates link delivery; actual Drive sharing must be configured separately.

Directory, promotion and sponsorship feeds are bounded to 200 records per request.

## Admin access with the same credentials

Admins sign in with existing Natyashala credentials and session cookies. No default admin password or automatically elevated real account is created. The shared admin API remains under `/api/natyashala/auth/admin` because the current cookie is scoped to Natyashala; it is not a cross-domain single-sign-on implementation.

After an authorized operator identifies an exact **existing** account, explicitly bootstrap sudo access:

```powershell
npm run admin:bootstrap -- exact-existing@email.example
```

This local-only command adds the existing account to `sudo_admins` and records `sudo.bootstrap` in `admin_audit`. It does not create a user or reset a password. No HTTP endpoint grants sudo. No real sudo account has been selected during implementation.

- `GET /session`: `{isSudo, sites}` from current database memberships; existing login sessions reflect grants and revocations immediately.
- `GET /memberships`: sudo-only bounded membership list.
- `PUT /memberships` and `DELETE /memberships`: sudo-only `{email, site}` grants/revokes a site administrator for an existing user. One account can have multiple site memberships. Delegated admins cannot grant access or elevate themselves.
- `GET /sites/natyashala/users?limit=50&after=<email cursor>`: sudo or assigned Natyashala admin only. Returns `{users, hasMore, nextCursor}`; `limit` must be 1–100. Users include the login email for administrative identification and their separately submitted role profile.
- `POST /sites/natyashala/users/review`: assigned admin or sudo sends `{email, decision: 'verify' | 'reject', reason}`. A nonempty reason is required. The review and audit are committed together. Reject removes the green badge but does not block role features.

Membership site IDs use lowercase slugs; future-site memberships can be stored, but only `natyashala` currently implements user management. All other site-management URLs return 404. New sites must implement their own account scope before management is enabled. `admin_audit` retains actor, target, site, action, reason and timestamp for bootstrap, grant/revoke and browser review actions.

The existing local review command remains available to trusted database operators:

```powershell
npm run profile:review -- exact-existing@email.example verify "School affiliation checked"
npm run profile:review -- exact-existing@email.example reject "More profile evidence required"
```

Local review decisions are recorded in `profile_reviews`; browser-admin actions also carry the signed-in actor/site audit record.

Run `npm run test:features:db` and `npm run test:admin:db` for live MySQL integration checks. Fixtures use unique test emails and are removed along with their profiles, sessions, offers, requests, promotions and memberships; audit fixtures are explicitly cleaned. Neither test selects a real sudo account.
