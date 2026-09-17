/* Sanko landing v2 — deploy configuration.
   Same pattern as plant-count.js: globals, set before app.js runs.

   These are Supabase's PUBLIC keys and are meant to be visible in the browser.
   They are safe here because migration 016 grants anon INSERT and no SELECT on
   the two enquiry tables, and 003 leaves anon denied on everything else — a key
   that submits a form cannot read any submission back. Never put
   SUPABASE_SERVICE_ROLE_KEY in this file: it bypasses RLS, and view-source would
   hand every practitioner and patient record to anyone who looked.

   Split by host because one file serves both. The local values point at the
   Supabase CLI stack and are its standard development key — identical on every
   machine, valid only against 127.0.0.1, which is why committing them is safe
   and why they must never be what production uses.

   PRODUCTION IS NOT FILLED IN. While it is blank the forms stay in preview mode:
   still usable, and saying plainly that delivery is not connected rather than
   failing silently. Add the project URL and the anon key — the `anon` `public`
   key from Project Settings → API, not `service_role`. */

const LOCAL = {
  url: 'http://127.0.0.1:54321',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
};

const PRODUCTION = {
  url: '',
  anonKey: '',
};

const onLocalhost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
const active = onLocalhost ? LOCAL : PRODUCTION;

window.SANKO_SUPABASE_URL = active.url;
window.SANKO_SUPABASE_ANON_KEY = active.anonKey;
