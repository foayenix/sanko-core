# Landing sign-ups and visits: switching them on and reviewing them

The landing page has two forms: test-access applications and partnership
enquiries. They post straight to Supabase with the public anon key
(`sanko-landing page/public/landing-v2/app.js`). The control room reads them
under **Sign-ups** at `/admin`.

## Current state

- Production values in `sanko-landing page/public/landing-v2/config.js` are
  blank. Until they are filled in, both forms stay in preview mode on the live
  site: they say delivery is not connected and store nothing.
- Nothing submitted before this switch was kept.

## Switch them on

1. Apply the migrations to the production database:

   ```bash
   npm run migrate:status
   npm run migrate
   ```

   `016_landing_enquiries.sql` creates the tables. `028_landing_enquiry_decisions.sql`
   adds operator attribution and narrows what the anon key may insert.
2. In Supabase, open Project Settings → API. Copy the project URL and the `anon`
   `public` key into `PRODUCTION` in `landing-v2/config.js`. Never use the
   `service_role` key there: it bypasses RLS, and anyone who views the page
   source would get it.
3. Deploy the landing page. Submit one test application on the live site and
   confirm it appears under Sign-ups. Then decline it so it does not stay
   pending.

## What a decision does

- **Approve and Decline** record a timestamp, your operator reference (from your
  `ADMIN_ACCOUNTS` entry) and an optional internal note.
- **Only a pending application can be decided.** If two people press at once,
  the second gets a conflict.
- **Approving does not let anyone talk to the agent.** Who the agent replies to
  is server configuration (for testing, `BAILEYS_ALLOWED_NUMBERS`), so letting a
  number in is a separate, deliberate step.
- **Mark answered** on an enquiry records that someone replied. Replies
  themselves go out from your own email client.
- **Retention:** PRIVACY.md says an application is deleted within 12 months of
  its decision. The view shows that date, but nothing deletes rows
  automatically yet.

## Website visits (Vercel Web Analytics)

Every page on the site loads `/_vercel/insights/script.js`: the landing pages,
the privacy page (from `templates/privacy.html`) and every plant page (from
`scripts/build-resolver.mjs`). The script sets no cookies; PRIVACY.md says what
it collects.

1. **Turn it on in Vercel.** Open the project that serves sanko.africa, go to the
   Analytics tab and enable Web Analytics. Until then the script path returns
   404 and nothing is counted. On a local preview it always returns 404; that is
   expected.
2. **Show it in the control room (optional).** Set these on the backend server:

   | Variable | Value |
   |---|---|
   | `VERCEL_ANALYTICS_TOKEN` | A Vercel access token |
   | `VERCEL_ANALYTICS_PROJECT` | The project ID (`prj_…`) or name |
   | `VERCEL_TEAM_ID` | The team ID (`team_…`), if the project is under a team |

   Vercel has no read-only tokens. Anyone holding this token can change the
   website, not just read its numbers. Create it scoped to the one team, give
   it an expiry, and keep it only in the server environment, never in the
   landing page.

The Sign-ups view then shows:
- page views over the last 7 and 30 days;
- the five most viewed paths;
- applications per page view.

Results are cached in memory for ten minutes. The numbers are page views, not
people. Vercel counts production traffic only, from the day analytics was
enabled.
