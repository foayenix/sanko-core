# Deployment checklist: testing the WhatsApp care and evidence flows

Use this to put the merged code on a server so you can test the guided WhatsApp
flows from real phones. It is a **synthetic test deployment**: every new feature
refuses to run unless `CHANNEL_SYNTHETIC_ONLY=true` and works only with
fictional test accounts. It is not a release to practitioners or patients.

Tick each box in order. Commands assume a Linux server with a shell; adapt them
to your host's dashboard if it has no shell.

## 0. Decide before you start

- [ ] **Which Supabase project?** Use a **separate test project**, not the one
      holding real practitioners' Vaults. The setup script writes fictional
      accounts and records, and the care tables it touches are shared with real
      data.
- [ ] **How will WhatsApp reach the server?** Pick one:
  - **Meta Cloud API (webhook)** — the production-shaped route. Needs a public
        HTTPS address and a Meta app with a WhatsApp test number.
  - **Baileys** — links a spare WhatsApp account as a device. No public
        address needed, but someone must scan a QR code once, and it is an
        unofficial client meant for testing only.
- [ ] **Which phones?** One for the practitioner (also the evidence owner) and
      a different one for the patient. One number can be linked to only one care
      login at a time.

## 1. Server prerequisites

- [ ] Node.js 20.19 or later (`node --version`).
- [ ] `psql` (PostgreSQL 16 client) on the machine that runs migrations.
- [ ] HTTPS in front of the app (Meta webhook mode always; the portals need it
      too when `NODE_ENV=production`). Note the public origin, e.g.
      `https://sanko-test.example.org`.
- [ ] Optional but recommended: a Unicode font for report PDFs, e.g.
      `sudo apt-get install -y fonts-dejavu-core`
      (gives `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`).
- [ ] Optional: the Vault model server (see README "Configuration"). The guided
      flows don't need it; without it, ordinary Vault conversation replies
      "Something went wrong".

## 2. Get the code

- [ ] `git fetch origin && git checkout main && git pull` — must include merge
      commit `d38159b` (PR #7) or later.
- [ ] `npm ci`
- [ ] `npm test` (optional sanity check; should report all tests passing).

## 3. Back up the database you will migrate

- [ ] Even for a test project, take a backup first:
      `BACKUP_ENCRYPTION_KEY=<32-byte key> npm run backup` then
      `npm run backup:verify`. Keep the key somewhere other than the backups.

## 4. Configure the environment

Set these in the server's `.env` or your host's environment settings. Don't
commit them and don't paste secrets into chats.

**Supabase (test project)**

- [ ] `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
- [ ] `SUPABASE_DB_URL` — direct (session pooler) connection string, used by
      migrations and the setup script.

**Server**

- [ ] `PORT` (default 3000).
- [ ] `NODE_ENV=production` if the server is reachable from the internet.
      Production refuses unsigned webhooks and requires HTTPS portal origins.
- [ ] `TRUST_PROXY` — set to your proxy/load balancer as described in
      `.env.example`, otherwise all visitors share one rate limit.
- [ ] `PORTAL_RATE_LIMIT_KEY` — at least 32 random characters
      (`openssl rand -hex 32`).

**Existing care and evidence features (synthetic only)**

```bash
PATIENT_TRACKING_ENABLED=true
AGENT_TOOLS=full
CARE_PATIENT_ACCESS_ENABLED=true
CARE_ENCOUNTERS_ENABLED=true
CARE_SYNTHETIC_ONLY=true
CARE_ORIGIN=https://sanko-test.example.org      # your exact public origin, no trailing slash
EVIDENCE_ENABLED=true
EVIDENCE_SYNTHETIC_ONLY=true
EVIDENCE_ORIGIN=https://sanko-test.example.org  # same origin is fine
```

**The WhatsApp channel**

```bash
CHANNEL_GUIDED_ENABLED=true
CHANNEL_SYNTHETIC_ONLY=true
CARE_CHANNEL_ACTIONS_ENABLED=true
CARE_CHANNEL_NOTIFICATIONS_ENABLED=true
EVIDENCE_CHANNEL_ACTIONS_ENABLED=true
EVIDENCE_CHANNEL_DELIVERY_ENABLED=true
CHANNEL_OUTBOUND_TRANSPORT=meta        # or baileys (section 7B)
EVIDENCE_PDF_FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
EVIDENCE_PDF_FONT_BOLD=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
```

**Meta Cloud API (only for section 7A)**

- [ ] `META_VERIFY_TOKEN` — any random string; you'll enter the same value in
      Meta's webhook settings.
- [ ] `META_ACCESS_TOKEN` — a token for the WhatsApp test number. Temporary
      tokens from the Meta dashboard expire after about a day; use a system-user
      token for anything longer.
- [ ] `META_PHONE_NUMBER_ID` — the test number's ID (not the phone number).
- [ ] `META_APP_SECRET` — required in production; webhooks without a valid
      signature are refused.

**Baileys (only for section 7B)**

- [ ] `BAILEYS_ALLOWED_NUMBERS=+<practitioner>,+<patient>`
- [ ] `BAILEYS_AUTH_DIR` — a directory that survives restarts and redeploys.

## 5. Run the migrations

- [ ] `npm run migrate`
- [ ] `npm run migrate:status` — `026_whatsapp_channel.sql` must be listed as
      applied. Migrations 001–025 must not be reported as changed.
- [ ] Refresh Supabase's API schema (harmless if already current):
      `psql "$SUPABASE_DB_URL" -c "notify pgrst, 'reload schema'"`

## 6. Create the fictional test accounts

Run this from a machine with the test project's settings. The script refuses to
run when `NODE_ENV=production`, so run it from your laptop or with that unset.

- [ ] ```bash
      node scripts/setup-channel-test.js setup \
        --practitioner-phone +<practitioner> --patient-phone +<patient> \
        --confirm-test-project
      ```
- [ ] Save the five printed logins and passwords (shown once; rerun to reset).
- [ ] If Supabase rejects the `@example.invalid` addresses, rerun with
      `--email-domain <a domain you control>`.

## 7A. Start with Meta Cloud API

- [ ] Check the Graph API version: the code calls
      `https://graph.facebook.com/v19.0` (`src/services/whatsapp.js`). Confirm in
      Meta's changelog that v19.0 is still supported. If it isn't, the version must
      be updated in code before sends will work.
- [ ] Start the app: `npm start` (one process runs the webhook, portals, care
      scheduler and the outbound queue). Use your host's process manager so it
      restarts on failure.
- [ ] `curl https://<your-origin>/health` returns `{"status":"ok"}`.
- [ ] In the Meta app: WhatsApp → Configuration → Webhook. Callback URL
      `https://<your-origin>/webhook`, verify token = `META_VERIFY_TOKEN`. Verify,
      then subscribe to the **messages** field (it also carries delivery statuses).
- [ ] While the Meta app is in development mode, add both test phones as
      allowed recipients of the test number.
- [ ] Know the 24-hour rule: Sanko's check-in notice is a plain message, which
      Meta only delivers within 24 hours of the patient's last message to the
      number. Outside that window it fails (recorded as failed, not sent).
      Approved message templates for notices are not implemented yet.

## 7B. Or start with Baileys

- [ ] Set `CHANNEL_OUTBOUND_TRANSPORT=baileys` so notices and PDFs go through
      the linked account. Only the Baileys process then runs the outbound queue.
- [ ] Start two long-running processes: `npm start` (portals and care
      scheduler) and `npm run whatsapp:test` (WhatsApp adapter). Only one Baileys
      process per WhatsApp account, or both drop messages.
- [ ] Open the `whatsapp:test` logs, then scan the QR code with the **spare**
      WhatsApp account (Settings → Linked devices → Link a device). Wait for
      `Baileys connected. Listening only to: …`.
- [ ] If your host can't show a QR code in its logs, link it on your own
      computer first. Then copy the `BAILEYS_AUTH_DIR` folder to the server
      securely: it is a login credential for that WhatsApp account.

## 8. Smoke test

- [ ] Open `https://<your-origin>/care/` and `/evidence/`, and sign in with the
      practitioner login.
- [ ] Patient phone: message the bot `My care`. You should get the generic
      menu ("link this chat to your Sanko account once").
- [ ] Follow "Try the care loop" and "Try the evidence loop" in
      `docs/WHATSAPP_BAILEYS_TESTING.md`. The steps are the same with Meta,
      except Meta shows real buttons and lists instead of numbered text. To
      make a check-in due without waiting days:
      `node scripts/setup-channel-test.js check-ins-due --confirm-test-project`
      (delivered 08:00–19:59 practice time, Africa/Lagos by default).

## 9. If nothing happens

- [ ] **No reply at all (Meta):** check the app logs for
      `webhook.signature_invalid` (wrong `META_APP_SECRET`) or nothing at all
      (webhook URL wrong, not subscribed to `messages`, or the server isn't
      reachable over HTTPS).
- [ ] **Logs show the message but no reply arrives (Meta):**
      `whatsapp.send_failed` with status 401 means an expired
      `META_ACCESS_TOKEN`. Other errors may mean the phone isn't an allowed test
      recipient, or the Graph API version (7A) is no longer supported.
- [ ] **No reply (Baileys):** look for "not in BAILEYS_ALLOWED_NUMBERS" and
      `Baileys connected`; see "When nothing happens" in
      `docs/WHATSAPP_BAILEYS_TESTING.md`.
- [ ] **The server won't start:** errors such as `LIVE_CHANNEL_NOT_QUALIFIED`,
      `CARE_CHANNEL_REQUIRES_CARE`, `INVALID_CARE_ORIGIN` or
      `EVIDENCE_ORIGIN_REQUIRED` name the missing or wrong setting from section 4.
- [ ] **"Could not find the function … in the schema cache":** run the reload
      command in section 5.
- [ ] **Portal sign-in fails:** the browser address must match `CARE_ORIGIN` /
      `EVIDENCE_ORIGIN` exactly; check `SUPABASE_ANON_KEY`, `PORTAL_RATE_LIMIT_KEY`
      and `TRUST_PROXY`.

## 10. Turning it off

- [ ] Set `CHANNEL_GUIDED_ENABLED=false` (and the four `*_CHANNEL_*` flags) and
      restart. The outbound queue stops; records, suppressions and audit are kept.
- [ ] Don't drop migration 026 or delete its tables to roll back.
- [ ] Baileys: remove the linked device from the spare phone and delete
      `BAILEYS_AUTH_DIR`.
