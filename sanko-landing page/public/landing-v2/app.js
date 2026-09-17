/* Sanko landing v2 — minimal behaviour.
   One orchestrated hero moment; everything else answers a user action. */
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.add('js');

  /* Live plant-mapping count (set by ../landing/plant-count.js) */
  var count = window.SANKO_PLANT_MAPPING_COUNT;
  if (typeof count === 'number' && isFinite(count)) {
    document.querySelectorAll('[data-plant-count]').forEach(function (el) {
      el.textContent = count.toLocaleString('en-GB');
    });
  }

  /* Disclosure menu */
  var btn = document.getElementById('menu-btn');
  var panel = document.getElementById('menu-panel');

  function closeMenu() {
    if (!btn || !panel) return;
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }

  if (btn && panel) {
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      panel.hidden = open;
      btn.setAttribute('aria-expanded', String(!open));
    });
    panel.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
        closeMenu();
        btn.focus();
      }
    });
  }

  /* Mobile action bar: appears once the hero action has scrolled away */
  var dock = document.getElementById('dock');
  var hero = document.querySelector('.hero-actions');
  if (dock && hero && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      dock.classList.toggle('is-up', !entries[0].isIntersecting);
    }, { rootMargin: '0px 0px -40px 0px' }).observe(hero);
  }

  /* Records assemble when they reach the viewport, not at load.
     The hero card is already in view, so it still plays immediately. */
  var records = document.querySelectorAll('.record-anim');
  if (records.length && 'IntersectionObserver' in window) {
    records.forEach(function (el) { el.classList.add('is-armed'); });
    var recordsIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-running');
        recordsIO.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px' });
    records.forEach(function (el) { recordsIO.observe(el); });
  }

  /* Placeholder endpoints stay honest until they are wired up */
  var WA_URL = window.SANKO_WHATSAPP_URL || '';
  document.querySelectorAll('[data-wa]').forEach(function (el) {
    if (WA_URL) el.setAttribute('href', WA_URL);
  });

  /* Forms post straight to PostgREST with the public anon key. Migration 016
     grants anon INSERT and no SELECT, so the row cannot be read back: asking for
     it returns 42501. A plain POST already returns nothing, so this header states
     the intent rather than rescuing the request — but it must never become
     `return=representation`, which the grant cannot satisfy. */
  var DB_URL = (window.SANKO_SUPABASE_URL || '').replace(/\/+$/, '');
  var DB_KEY = window.SANKO_SUPABASE_ANON_KEY || '';
  var DB_READY = Boolean(DB_URL && DB_KEY);

  function submitRow(table, row) {
    return fetch(DB_URL + '/rest/v1/' + table, {
      method: 'POST',
      headers: {
        'apikey': DB_KEY,
        'Authorization': 'Bearer ' + DB_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(row)
    }).then(function (res) {
      if (!res.ok) throw new Error('insert failed: ' + res.status);
    });
  }

  function value(form, name) {
    var el = form.elements[name];
    return el ? el.value.trim() : '';
  }

  var FORMS = [
    {
      id: 'apply-form',
      table: 'test_applications',
      trap: 'company',
      preview: 'Applications are not connected yet — your number was not sent or stored.',
      sending: 'Sending…',
      done: 'Thank you. We review each application before granting access, and the Sanko agent will message you once your number is approved.',
      build: function (form) {
        var name = value(form, 'name');
        var phone = value(form, 'phone');
        if (!name) return { error: 'Please add your name.' };
        if ((phone.match(/\d/g) || []).length < 7) {
          return { error: 'Please add a WhatsApp number, including your country code.' };
        }
        return { row: { name: name, phone_number: phone, intended_use: value(form, 'role') || null } };
      }
    },
    {
      id: 'partner-form',
      table: 'partnership_enquiries',
      trap: 'website',
      preview: 'Form delivery is not connected yet — nothing was sent.',
      sending: 'Sending…',
      done: 'Thank you. We will come back to you at the address you gave.',
      build: function (form) {
        var name = value(form, 'name');
        var email = value(form, 'email');
        if (!name) return { error: 'Please add your name.' };
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Please check your work email.' };
        return {
          row: {
            name: name,
            email: email,
            organisation: value(form, 'organisation') || null,
            message: value(form, 'message') || null
          }
        };
      }
    }
  ];

  FORMS.forEach(function (spec) {
    var form = document.getElementById(spec.id);
    if (!form) return;
    var note = form.querySelector('.form-note');
    var button = form.querySelector('button[type="submit"]');

    function say(text) { if (note) note.textContent = text; }

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      /* A filled honeypot is a bot. Report success and post nothing. */
      if (value(form, spec.trap)) { say(spec.done); form.reset(); return; }

      if (!DB_READY) { say(spec.preview); return; }

      var built = spec.build(form);
      if (built.error) { say(built.error); return; }

      if (button) button.disabled = true;
      say(spec.sending);

      submitRow(spec.table, built.row).then(function () {
        form.reset();
        say(spec.done);
      }).catch(function () {
        say('That did not send. Please try again, or email us if it keeps failing.');
      }).then(function () {
        if (button) button.disabled = false;
      });
    });
  });
})();
