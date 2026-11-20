# Landing sign-ups: switching them on and reviewing them

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
