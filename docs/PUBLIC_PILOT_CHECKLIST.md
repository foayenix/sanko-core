# Public pilot readiness checklist

For taking Sanko from a laptop-linked test bot to a WhatsApp number real people
may message. It covers what Meta requires, what this repository already blocks
on purpose, and what has to be decided by a person rather than configured.

`docs/WHATSAPP_DEPLOYMENT_CHECKLIST.md` remains the step-by-step for a
**synthetic** test deployment, and its section 4 is still the authority on
environment names. This document is the layer above it: what must be true
before anyone outside the project messages the number.

Two things to settle before reading further.

## 0. Which pilot is this?

- [ ] **Track A — Vault only.** Real practitioners document their own
      formulations in chat. No patients, no care records, no evidence reports.
      Reachable with configuration and operations work alone.
- [ ] **Track B — care and evidence with real patients.** Not reachable by
      configuration. `src/channel/config.js` throws `LIVE_CHANNEL_NOT_QUALIFIED`
      unless `CHANNEL_SYNTHETIC_ONLY=true`, and the care backend additionally
      requires synthetic actors, subjects and practices. There is deliberately
      no live path to switch on. Track B needs the open decisions in section 7
      recorded first, then a reviewed code change that removes the gate.

Everything below applies to Track A unless marked **[B]**.

## 1. Meta

The current test setup (Baileys, a spare account linked as a device) is not a
production transport: it is an unofficial client, and the deployment checklist
already labels it testing-only. A public pilot means the Cloud API.

- [ ] Meta Business portfolio created for the business that will own the number.
- [ ] **Business verification** completed (legal name, address, documents).
      Unverified businesses are capped at a low messaging tier.
- [ ] WhatsApp Business Account created inside that portfolio.
- [ ] **Production phone number** chosen. A number already registered to a
      personal WhatsApp account must be deleted from WhatsApp first, and a
      number in use with Baileys cannot also serve the Cloud API. Decide
      whether `+234 813 402 7027` becomes the production number or is retired
      to testing.
- [ ] Display name submitted and approved (reviewed against Meta's naming
      policy; rejection is common on first attempt).
- [ ] **Public privacy policy URL** reachable and specific to this service —
      Meta asks for it, and `PRIVACY.md` is the source text.
- [ ] System-user access token issued (permanent). Dashboard temporary tokens
      expire and produce `whatsapp.send_failed` 401 in the logs.
- [ ] `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PHONE_NUMBER_ID` set;
      webhook subscribed to the **messages** field.
- [ ] **Graph API version confirmed.** `src/services/whatsapp.js` pins
      `v19.0`. Check Meta's changelog; if that version is retired, the code
      must be updated before any send works.
- [ ] Messaging limit tier understood (how many unique recipients per day the
      number may start conversations with) and the pilot sized under it.
- [ ] **Opt-in evidence** for every number the service will message first:
      how consent was collected, and where it is recorded.
- [ ] **[B]** Message templates. Business-initiated check-in notices are plain
      messages today, so Meta delivers them only inside 24 hours of the
      patient's last inbound message; outside it they are recorded as failed.
      Approved templates are **not implemented** — this is code work, not a
      dashboard setting.

## 2. Hosting

Decided: **self-hosted on Apple silicon** — the development laptop during the
run-up, a Mac mini at launch. Renting GPU capacity was priced and rejected.
That keeps the model local, so the items below replace the usual "rent a box"
ones rather than sitting beside them.

- [ ] **A public HTTPS address that reaches the machine**, through an outbound
      tunnel rather than port forwarding: a named Cloudflare Tunnel (stable
      hostname, free) or Tailscale Funnel. Home and mobile ISPs commonly place
      customers behind carrier-grade NAT, where forwarding a port cannot work
      at all. Meta needs the hostname to stay the same.
- [ ] `NODE_ENV=production` (refuses unsigned webhooks, requires HTTPS portal
      origins), `TRUST_PROXY` set for the tunnel, `PORT` set.
- [ ] **The machine never sleeps**: power settings plus `caffeinate`, and
      lid-closed operation confirmed if it is a laptop. A sleeping server is an
      offline bot with no error anywhere.
- [ ] **Everything restarts by itself**: `launchd` agents (or `pm2`) for the
      Node process, Ollama and the database stack, started at login and
      restarted on crash, verified by rebooting the machine and messaging the
      bot without touching a terminal.
- [ ] **Power and connectivity interruptions survivable**: a UPS for the mini,
      and a known answer for what happens to a message that arrives while the
      machine is down. Meta retries webhook deliveries for a period — confirm
      the current window in Meta's documentation rather than assuming one; the
      inbound recovery sweep in migration `019` only covers messages the app
      already accepted, not ones it never received.
- [ ] `PORTAL_RATE_LIMIT_KEY` at least 32 random characters.
- [ ] `PORTAL_RATE_LIMIT_KEY` at least 32 random characters.
- [ ] `/health` returns `{"status":"ok"}` from the public origin.
- [ ] Logs retained somewhere you can search after an incident.
- [ ] `ADMIN_PASSWORD` strong, and `/admin` plus `/simulator` reachable only by
      people who should see practitioner content.
- [ ] Baileys shut down: linked device removed from the spare phone,
      `BAILEYS_AUTH_DIR` deleted. Two transports on one number drop messages.

## 3. The model

Decided: the model stays on the machine. Renting GPU capacity was priced and
rejected; the Anthropic API was not taken, so practitioner text does not leave
the box and the sovereignty posture `npm run doctor` reports stands as written.
What remains is sizing.

- [ ] **Mac mini specified for the model, not the price.**
      `qwen2.5:32b-instruct-q4_K_M` is about 20 GB of weights before any
      context, and Whisper and the vision model want their own room. A base
      16 GB machine cannot serve it; 48 GB is the sensible floor and 64 GB
      leaves headroom for a larger model later.
- [ ] **Concurrency sized and bounded.** One machine serves roughly one
      generation at a time: a second practitioner messaging mid-reply waits
      behind the first. Decide the number of pilot practitioners from measured
      tokens per second, and decide what the bot says when it is busy.
- [ ] Transcription path tested end to end with real voice notes, including
      the failure message when the model is missing.
- [ ] The laptop is understood as temporary: everything in section 2 is
      rehearsed on it so the move to the mini is a migration, not a rebuild.

## 4. Data protection and legal

- [ ] `PRIVACY.md` gaps closed: verified data-residency statements, consistent
      logging language, approved incident procedure. The document records these
      as outstanding.
- [ ] Lawful basis and notices reviewed for the jurisdictions in scope —
      Nigeria (NDPR) for `+234` numbers, UK GDPR for the `+44` numbers already
      in the test allowlist.
- [ ] Retention decided and implemented for: interrupted drafts, prompts and
      labels, answers, provider media, PDFs, stored contact addresses.
- [ ] Subject-access, deletion and recovery requests have a named route and a
      response time.
- [ ] **Contributor terms stay off.** They are a draft; enabling them is not
      part of routine development.
- [ ] Public demonstration data kept separate from pilot data.

## 5. Safety and clinical scope

- [ ] Written scope statement: what Sanko does (documentation, continuity) and
      what it does not (diagnosis, treatment advice, emergencies).
- [ ] Escalation wording for a message that describes an emergency, with local
      contacts, reviewed by a person who is accountable for it.
- [ ] **Named staffed responsibility and response hours** for anything a
      practitioner or patient sends into the number. Required before real
      people can expect an answer at all.
- [ ] Wording reviewed per language (English, Yorùbá, Igbo, Hausa as
      configured), including limited literacy and mixed-language use, with
      intended users rather than the team.

## 6. Quality evidence

- [ ] Understand what is **not** evidence: offline tests validate application
      behaviour, not model accuracy.
- [ ] Eval suite: 56 cases exist and none currently qualifies for the 100-case
      practitioner-reviewed promotion gate (`npm run eval:reviewed`). Decide
      whether the pilot proceeds without it, and record that decision.
- [ ] Plant data baseline understood: **479 names, 442 resolved**, with around
      ten archive branches deliberately unported (`docs/MIGRATION_BACKLOG.md`).
      Port what the pilot needs, with provenance, or state the limitation.
- [ ] `npm run lint`, `npm test`, `npm run check-secrets`,
      `npm run check-repository` green on the deployed commit.

## 7. Open decisions that block readiness claims **[B]**

Recorded in `docs/WHATSAPP_CHANNEL_IMPLEMENTATION.md`; no owners are assigned
in the repository. Each needs a person's decision, written down:

- [ ] Identity, enrolment and recovery: is a portal link code sufficient
      assurance, session length, step-up for sensitive actions, shared devices,
      recovery runbook.
- [ ] Reviewed wording per language, with usability testing.
- [ ] Meta qualification: API version, interactive/list/document limits,
      templates, the 24-hour window, opt-in rules, media terms.
- [ ] Retention of drafts, prompts, answers, media, PDFs, contact addresses.
- [ ] Staffed care responsibility and response hours.
- [ ] Whether report PDFs may leave the service.
- [ ] Practitioner invitation, care export, chat amendments, analyst question
      notifications (`EVIDENCE_NOTIFICATIONS_ENABLED` is still refused).
- [ ] Backup, restore and migration rehearsal including `026`.

## 8. Operations before launch

- [ ] `npm run backup` and `npm run backup:verify` pass, with
      `BACKUP_ENCRYPTION_KEY` stored apart from the backups. `npm run doctor`
      currently fails this check.
- [ ] **Restore rehearsed** into a scratch database, not just verified.
- [ ] Migration rehearsal on a copy of the production database, including the
      PostgREST schema reload.
- [ ] Alerting on (`doctor` reports `alerting:false` today) with a destination
      someone reads.
- [ ] Cost monitoring reviewed (`002_cost_monitoring_view.sql`) if the model
      moves to a paid API.
- [ ] Rollback written down: which flags to turn off, and the rule that
      migrations and records are never dropped to roll back.
- [ ] **Where the database actually lives, decided.** The local Supabase CLI
      stack is a development stack whose data sits in a Docker volume on the
      machine. Either move the pilot to a hosted Supabase project (the model
      stays local either way) or keep it local with encrypted backups held off
      the machine and a restore that has been run, not just verified. On one
      self-hosted machine this is the largest data-loss risk in the project.
- [ ] **Full-disk encryption on and screen lock short.** Records on a portable
      machine mean theft is a data breach; FileVault is the difference between
      a lost laptop and a notifiable incident.
- [ ] **Move to the Mac mini written as a procedure before it is needed**: the
      `.env`, the database (dump and restore, or the Docker volume), the Ollama
      models, the launchd agents, the tunnel credentials, and a dry run that
      ends with the bot answering from the mini while the laptop is off.

## 9. Pre-launch smoke test on the production number

- [ ] Two phones that are not the team's only phones, added as recipients while
      the app is in development mode.
- [ ] Registration and privacy notice as a brand-new practitioner.
- [ ] A formulation captured by text, by voice note, and by photo.
- [ ] A deliberate failure: model stopped mid-conversation, confirm the
      practitioner is told rather than left silent.
- [ ] Restart the app mid-turn and confirm the inbound recovery sweep answers
      the message (migration `019`).
- [ ] **[B]** The care and evidence loops from
      `docs/WHATSAPP_BAILEYS_TESTING.md`, on Meta, with real buttons.

## 10. Do not ship

- [ ] Baileys as the production transport.
- [ ] Real patients in care or evidence while section 7 is open.
- [ ] Contributor terms enabled.
- [ ] A number that is also linked as a Baileys device.
- [ ] Any claim of model accuracy that the eval suite does not support.
