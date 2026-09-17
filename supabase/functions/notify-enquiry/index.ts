// notify-enquiry — tells us a landing-page form was submitted.
//
// Invoked by a Supabase Database Webhook on INSERT into test_applications and
// partnership_enquiries. It exists because the landing page is a static deploy:
// the browser can write a row with the public anon key, but it cannot hold a
// mail provider's key, so the notification has to come from the database side.
//
// What it deliberately does NOT do is put the applicant's phone number in the
// email. A notification's job is to tell you there is something to review; the
// detail belongs in Supabase, behind the service-role key, not copied into a
// third-party mail provider and then into an inbox that syncs to every device
// you own. The email carries a name and a table, and you go and look.
//
// Deploy:  supabase functions deploy notify-enquiry --no-verify-jwt
// Secrets: supabase secrets set RESEND_API_KEY=... NOTIFY_EMAIL_TO=... \
//            NOTIFY_EMAIL_FROM=... NOTIFY_WEBHOOK_SECRET=...
//
// Then in the dashboard: Database → Webhooks → new webhook per table, INSERT
// only, type HTTP Request, pointed at this function, with the header
// `x-sanko-secret: <NOTIFY_WEBHOOK_SECRET>`. --no-verify-jwt is why that shared
// secret matters: without it the endpoint is open to anyone who finds the URL.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_TO = Deno.env.get("NOTIFY_EMAIL_TO") ?? "";
const EMAIL_FROM = Deno.env.get("NOTIFY_EMAIL_FROM") ?? "";
const WEBHOOK_SECRET = Deno.env.get("NOTIFY_WEBHOOK_SECRET") ?? "";

const SUBJECTS: Record<string, string> = {
  test_applications: "New test access application",
  partnership_enquiries: "New partnership enquiry",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  if (!WEBHOOK_SECRET || req.headers.get("x-sanko-secret") !== WEBHOOK_SECRET) {
    // Same response for a missing and a wrong secret: a caller probing the
    // endpoint learns nothing about whether it guessed the header name.
    return new Response("not found", { status: 404 });
  }

  let payload: { table?: string; record?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const table = String(payload.table ?? "");
  const subject = SUBJECTS[table];
  if (!subject) {
    // A webhook pointed at a table this function does not know about. Accept it
    // so Supabase does not retry forever, but send nothing.
    return new Response("ignored", { status: 200 });
  }

  const record = payload.record ?? {};
  const name = typeof record.name === "string" ? record.name : "someone";
  const organisation = typeof record.organisation === "string" ? record.organisation : "";
  const who = organisation ? `${name} (${organisation})` : name;

  const lines = [
    `${who} submitted the ${table.replace(/_/g, " ")} form on sanko.africa.`,
    "",
    "The details are in Supabase. They are not repeated here on purpose:",
    "a notification should not copy personal data into a mail provider.",
    "",
    `Table: public.${table}`,
  ];

  if (!RESEND_API_KEY || !EMAIL_TO || !EMAIL_FROM) {
    console.error("notify-enquiry: mail not configured; nothing sent", { table });
    // 200 so the insert is never treated as failed because email is misconfigured.
    return new Response("mail not configured", { status: 200 });
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [EMAIL_TO],
      subject: `${subject} — ${name}`,
      text: lines.join("\n"),
    }),
  });

  if (!res.ok) {
    console.error("notify-enquiry: send failed", { status: res.status, table });
  }

  // Always 200. A failed email must not look like a failed application.
  return new Response("ok", { status: 200 });
});
