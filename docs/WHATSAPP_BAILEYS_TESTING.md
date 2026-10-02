# Testing the WhatsApp care and evidence flows from real phones (Baileys)

This guide runs the guided WhatsApp flows on your own computer, against a
**test** Supabase project, and lets you use them from real phones through the
Baileys adapter. Everything you create is fictional and marked synthetic. The
features refuse to start without `CHANNEL_SYNTHETIC_ONLY=true`, so this is not
a route to real patients.

Baileys is an unofficial WhatsApp Web client. Use a **spare WhatsApp account**
for the bot, message it only from your own allowlisted phones, and don't use it
for bulk or unsolicited messages. It is not the production integration: Meta
delivery, templates and the 24-hour messaging window are not exercised here.

## What you need

- A computer with Node.js 20.19 or later, `psql` (PostgreSQL 16 client) and Git.
- A test Supabase project, or the local Supabase CLI stack described in the
  README ("Supabase" section: `supabase start`). **Never production.**
- Three WhatsApp numbers:
  - **Bot:** a spare account that Sanko links to as a device.
  - **Practitioner phone:** acts as practitioner (My vault) and evidence owner.
  - **Patient phone:** acts as the patient (My care).

  One number can be linked to only one care login at a time, so the
  practitioner and the patient need different phones.
- Optional: a Vault model server (see README, "Configuration"). The guided care
  and evidence flows don't use a model. Without one, ordinary Vault
  conversation (for example describing a new formulation) will fail with
  "Something went wrong".
- Optional: a TrueType font such as DejaVu Sans, if your test text uses
  characters outside Western European letters (for example Yorùbá ẹ ọ ṣ).
  Without it, report PDFs containing such characters are refused rather than
  sent incomplete.

## 1. Get the code

```bash
git fetch origin
git checkout claude/determined-noether-fp9c4t
npm ci
```

## 2. Configure `.env`

Start from `.env.example` and set these (local Supabase CLI values shown; for a
hosted test project use its URL, keys and session-pooler connection string):

```bash
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<service_role key printed by supabase start>
SUPABASE_ANON_KEY=<anon key printed by supabase start>
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres

# Existing care and evidence features, synthetic only
PATIENT_TRACKING_ENABLED=true
AGENT_TOOLS=full
CARE_PATIENT_ACCESS_ENABLED=true
CARE_ENCOUNTERS_ENABLED=true
CARE_SYNTHETIC_ONLY=true
CARE_ORIGIN=http://localhost:3000
EVIDENCE_ENABLED=true
EVIDENCE_SYNTHETIC_ONLY=true
EVIDENCE_ORIGIN=http://localhost:3000
PORTAL_RATE_LIMIT_KEY=<at least 32 characters, e.g. the output of: openssl rand -hex 32>

# The WhatsApp channel
CHANNEL_GUIDED_ENABLED=true
CHANNEL_SYNTHETIC_ONLY=true
CARE_CHANNEL_ACTIONS_ENABLED=true
CARE_CHANNEL_NOTIFICATIONS_ENABLED=true
EVIDENCE_CHANNEL_ACTIONS_ENABLED=true
EVIDENCE_CHANNEL_DELIVERY_ENABLED=true
# Send check-in notices and report PDFs through the Baileys adapter
CHANNEL_OUTBOUND_TRANSPORT=baileys

# Filled in after step 4
BAILEYS_ALLOWED_NUMBERS=

# Optional
# EVIDENCE_PDF_FONT=/path/to/DejaVuSans.ttf
# EVIDENCE_PDF_FONT_BOLD=/path/to/DejaVuSans-Bold.ttf
```

Always open the portals at `http://localhost:3000` (not `127.0.0.1`). The
portals accept requests only from the exact origin configured above.

## 3. Apply the migrations

```bash
npm run migrate
```

This includes `026_whatsapp_channel.sql`. Check with `npm run migrate:status`.
Then make sure Supabase's API sees the new database functions (harmless if it
already does):

```bash
psql "$SUPABASE_DB_URL" -c "notify pgrst, 'reload schema'"
```

## 4. Create the fictional test accounts

```bash
node scripts/setup-channel-test.js setup \
  --practitioner-phone +447700900123 \
  --patient-phone +447700900456 \
  --confirm-test-project
```

Use your two real phone numbers in international format. The script:

- creates five Supabase Auth logins: practitioner, patient, analyst, reviewer
  and admin. They use `@example.invalid` addresses; if Supabase rejects them,
  add `--email-domain` with a domain you control;
- makes a Vault account for the practitioner phone, a synthetic practice with
  the practitioner as a member, a patient login with no record yet, the
  practitioner as evidence owner of one fictional enrolled formulation, and
  analyst, reviewer and admin staff;
- prints each login's password **once**. Rerunning is safe and issues new
  passwords (`--keep-passwords` leaves them unchanged).

The practice uses the `Africa/Lagos` time zone by default (`--timezone` changes
it). Check-ins are only delivered between 08:00 and 19:59 practice time.

Copy the printed `BAILEYS_ALLOWED_NUMBERS=…` line into `.env`.

## 5. Start Sanko (two terminals)

```bash
# Terminal 1: portals, care check-in scheduler
npm start

# Terminal 2: the WhatsApp adapter, which also sends notices and PDFs
npm run whatsapp:test
```

In terminal 2, scan the QR code with the **bot** phone (WhatsApp → Settings →
Linked devices → Link a device). Wait for `Baileys connected. Listening only
to: …` with both of your numbers listed.

How choices appear: Baileys shows them as a numbered list. **Reply with the
number** (or type the option exactly). The one exception is the very first
question, "Which part of Sanko would you like to use?": type `My care` or
`My vault` in full.

## 6. Try the care loop

**Patient phone:**

1. On a computer, open `http://localhost:3000/care/`, sign in as the patient,
   and choose **Link WhatsApp**. Note the code (valid 10 minutes, one use).
2. Message the bot: `My care`, then `LINK ABCD-2345` (your code).
3. Choose **Myself**, type a name, confirm **Create record**. Note the
   reference (`SK-…`).

**Practitioner phone:**

4. In the care portal, sign in as the practitioner and use **Invite a patient**
   with that reference.
5. Patient phone: `menu` → **Invitations** → **Accept** → **Accept tracking**.
   Then **Messages and privacy** → **Tracking choices** → **Turn messages on**
   → **Confirm change**.
6. Practitioner: in the care portal choose **Link WhatsApp**, then send
   `LINK <code>` to the bot from the practitioner phone. The practitioner number
   already has a Vault account, so it starts in My vault.
7. Send `menu` → **Record a visit** → the patient → **New visit now** →
   **Record visit**. Type a note. Choose what the patient sees and whether a
   preparation was given (your fictional formulation is under **From my
   Vault**). Then **Save draft** → **Sign this version** → **Release to
   patient** → **Mark completed** → **In 3 days**.
8. Make the check-in due now:
   ```bash
   node scripts/setup-channel-test.js check-ins-due --confirm-test-project
   ```
   Within about a minute (during practice daytime) the patient phone receives
   "there is a new message waiting".
9. Patient: `menu` → **Check-ins** → choose an answer → add your own words or
   **Nothing more to add** → **Send**.
10. Practitioner: `Care inbox` → the update → **Write next steps** → type them
    → **Send next steps**.
11. Patient: `menu` → **Practice replies** shows the attributed reply.

Also worth trying: `STOP` and `RESUME`, `LANGUAGE` in the middle of a task,
`BACK` and `CANCEL`, sending a free message such as "I started a new herbal
product", **My visits** → **Request a correction**, and `UNLINK`. With Baileys,
a number always answers the question currently shown, so stale-button checks
are covered by the automated tests rather than this walkthrough.

## 7. Try the evidence loop

1. Open `http://localhost:3000/evidence/`, sign in as the **practitioner**
   (same login as the care portal), choose **Link WhatsApp**, and send
   `LINK <code>` from the practitioner phone. This links evidence reports to
   the same chat; the care link stays.
2. Practitioner phone: `Evidence reports` → **Request a review** → your
   fictional formulation → **General overview** (or type a question) → check
   the recipe → **Confirm recipe** → read the notice → **Agree and submit**.
3. In the evidence portal (sign out and back in between roles):
   - **admin:** assign the analyst and the reviewer to the request, then
     triage it as accepted;
   - **analyst:** optionally ask the owner a question. Answer it from the
     practitioner phone (`Evidence reports` → **Check progress**). Then enter
     the report and submit it for review;
   - **reviewer:** within 10 minutes of signing in, approve with all checks,
     then release.
4. Practitioner phone: `Evidence reports` → **My reports** → the report →
   **Read summary**, then **Send full report** → **Send me a copy**. The PDF
   arrives in the chat from the bot.

## When nothing happens

Check, in order:

1. **Terminal 2 says `Baileys connected`.** If it printed a QR code, the bot
   isn't linked yet. If it says it was logged out, delete `.baileys-auth/` and
   link again.
2. **"Baileys ignored a message from +… — not in BAILEYS_ALLOWED_NUMBERS".**
   Copy the exact number it prints into `.env` and restart terminal 2.
3. **Only one adapter is running.** A second `npm run whatsapp:test` on the
   same account makes both drop messages; the adapter refuses to start if it
   detects one.
4. **The first message got the "Which part of Sanko" question.** Type
   `My care` or `My vault` in full; a number doesn't work for this question.
5. **Startup errors** such as `LIVE_CHANNEL_NOT_QUALIFIED`,
   `CARE_CHANNEL_REQUIRES_CARE` or `EVIDENCE_CHANNEL_REQUIRES_EVIDENCE` mean a
   setting in step 2 is missing. Both terminals check the same settings.
6. **"Please verify again"** means the chat session expired (12 hours by
   default, `CHANNEL_SESSION_MINUTES`) or the link was replaced. Get a new
   code from the portal; your task is kept. Signing a visit note needs a code
   from the last 10 minutes.
7. **No check-in notice:** the follow-up must be due (step 6.8), it must be
   08:00–19:59 at the practice, the patient must have turned messages on, and
   the patient phone must not have sent `STOP` (send `RESUME`).
8. **No PDF:** `EVIDENCE_CHANNEL_DELIVERY_ENABLED=true` and
   `CHANNEL_OUTBOUND_TRANSPORT=baileys` must both be set. If the chat says the
   file "could not be produced", the report contains characters the font
   cannot draw: set `EVIDENCE_PDF_FONT`.
9. **"Could not find the function … in the schema cache"** in a terminal: run
   the `notify pgrst, 'reload schema'` command from step 3.
10. **Portal sign-in or Link WhatsApp fails:** open the portal at exactly
   `http://localhost:3000`, check `SUPABASE_ANON_KEY` and
   `PORTAL_RATE_LIMIT_KEY`, and rerun the setup script if passwords are lost.

## Cleaning up

Remove the linked device from the bot phone (Settings → Linked devices) and
delete `.baileys-auth/`. With the local Supabase CLI, `supabase stop
--no-backup` discards the test database. Records created here are fictional,
but the chat content you type is stored in the test database like any other
record.
