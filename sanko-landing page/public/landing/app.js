(() => {
  /* ── hero flow connectors ─────────────────────────────────────────────
   * The thread used to be hand-written path data in a 1536x737 viewBox, drawn to
   * match a design mock at exactly that width. Every other width — and every
   * mobile layout — left the links floating away from the cards they were meant
   * to join. So the geometry is measured from the cards themselves and the path
   * is rebuilt whenever they move. The SVG is sized 1:1 with the wall in CSS
   * pixels, which keeps a 2px stroke exactly 2px at any viewport.
   */
  const flowWall = document.querySelector('.signal-wall');
  const flowThread = document.querySelector('[data-flow-thread]');
  const flowNodes = Array.from(document.querySelectorAll('[data-flow-node]'));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const px = (n) => Math.round(n * 10) / 10;

  // A 45-degree dog-leg between two points. `across` is the axis the cards are
  // strung along, so the same routing serves the row and the stacked layouts.
  const dogleg = (from, to, axis) => {
    const along = axis === 'x' ? 'x' : 'y';
    const off = axis === 'x' ? 'y' : 'x';
    const gap = to[along] - from[along];
    const drift = to[off] - from[off];
    const at = (a, o) => (axis === 'x' ? { x: a, y: o } : { x: o, y: a });

    if (gap <= 1) return [from, to];
    const diagonal = Math.min(Math.abs(drift), Math.max(gap - 24, 0));
    const lead = (gap - diagonal) / 2;
    const direction = Math.sign(drift) || 1;

    const a = at(from[along] + lead, from[off]);
    const b = at(from[along] + lead + diagonal, from[off] + direction * diagonal);
    const c = at(to[along], b[off]);
    return [from, a, b, c, to];
  };

  const toPath = (points) => points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.x)} ${px(p.y)}`)
    .join('');

  const diamond = (p, r) => `M${px(p.x)} ${px(p.y - r)}L${px(p.x + r)} ${px(p.y)}L${px(p.x)} ${px(p.y + r)}L${px(p.x - r)} ${px(p.y)}Z`;

  function drawFlow() {
    if (!flowWall || !flowThread || flowNodes.length < 2) return;

    const wall = flowWall.getBoundingClientRect();
    if (wall.width < 2) return;

    const boxes = flowNodes.map((node) => {
      const r = node.getBoundingClientRect();
      return { left: r.left - wall.left, top: r.top - wall.top, right: r.right - wall.left, bottom: r.bottom - wall.top, width: r.width, height: r.height };
    });

    // Layout is read back from the cards rather than from a media query, so the
    // routing can never disagree with what CSS actually did.
    const stacked = boxes[1].top >= boxes[0].bottom - 1;
    const axis = stacked ? 'y' : 'x';

    const segments = [];
    const knots = [];
    const ports = [];

    for (let i = 0; i < boxes.length - 1; i += 1) {
      const a = boxes[i];
      const b = boxes[i + 1];
      const from = stacked
        ? { x: a.left + a.width / 2, y: a.bottom }
        : { x: a.right, y: a.top + a.height * 0.62 };
      const to = stacked
        ? { x: b.left + b.width / 2, y: b.top }
        : { x: b.left, y: b.top + b.height * 0.52 };

      const points = dogleg(from, to, axis);
      segments.push(toPath(points));
      ports.push({ x: from.x, y: from.y });

      // The mock knots the thread twice: leaving capture, and entering the record.
      if (i === 0 || i === boxes.length - 2) {
        const mid = points[Math.floor(points.length / 2)];
        knots.push(mid);
      }
    }

    const d = segments.join('');
    const drops = [];
    const targets = [];
    let baseline = '';

    if (!stacked) {
      const floor = Math.max(...boxes.map((b) => b.bottom)) + 40;
      const first = boxes[0];
      const last = boxes[boxes.length - 1];
      baseline = `M${px(first.left)} ${px(floor)}L${px(last.right)} ${px(floor)}`;
      for (const box of boxes) {
        const x = box.left + box.width / 2;
        drops.push(`M${px(x)} ${px(box.bottom + 10)}L${px(x)} ${px(floor)}`);
        targets.push({ x, y: floor });
      }
      // Only write when it actually changes: this is padding on the element the
      // ResizeObserver is watching, and rewriting it every pass would spin.
      const next = `${px(floor - Math.max(...boxes.map((b) => b.bottom)) + 18)}px`;
      if (flowWall.style.getPropertyValue('--flow-floor') !== next) {
        flowWall.style.setProperty('--flow-floor', next);
      }
    } else if (flowWall.style.getPropertyValue('--flow-floor')) {
      flowWall.style.removeProperty('--flow-floor');
    }

    flowThread.setAttribute('viewBox', `0 0 ${px(wall.width)} ${px(wall.height)}`);
    flowThread.setAttribute('width', px(wall.width));
    flowThread.setAttribute('height', px(wall.height));
    flowThread.innerHTML = [
      baseline ? `<path class="flow-baseline" d="${baseline}"/>` : '',
      drops.length ? `<path class="flow-drops" d="${drops.join('')}"/>` : '',
      targets.map((t) => `<g class="flow-target" transform="translate(${px(t.x)} ${px(t.y)})"><circle r="4.5"/><path d="M-8 0H8M0-8V8"/></g>`).join(''),
      `<path class="knowledge-thread__base" d="${d}"/>`,
      `<path class="knowledge-thread__live" d="${d}"/>`,
      ports.map((p) => `<rect class="flow-port" x="${px(p.x - 4)}" y="${px(p.y - 4)}" width="8" height="8"/>`).join(''),
      knots.map((k) => `<path class="flow-knot" d="${diamond(k, 9)}"/>`).join(''),
    ].join('');

    // The path element is replaced on every redraw, so the draw-on animation
    // would restart on each resize. Run it once, then hold the thread drawn.
    const live = flowThread.querySelector('.knowledge-thread__live');
    if (live) {
      const length = live.getTotalLength();
      const settled = reduceMotion.matches || flowThread.dataset.animated === '1';
      live.style.strokeDasharray = String(length);
      live.style.strokeDashoffset = settled ? '0' : String(length);
      if (!settled) {
        window.setTimeout(() => { flowThread.dataset.animated = '1'; }, 2600);
      }
    }
  }

  if (flowWall && flowThread) {
    drawFlow();
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(() => drawFlow());
      observer.observe(flowWall);
      flowNodes.forEach((node) => observer.observe(node));
    } else {
      window.addEventListener('resize', drawFlow, { passive: true });
    }
    // Web fonts land after first paint and change every card's height.
    if (document.fonts?.ready) document.fonts.ready.then(drawFlow);
    reduceMotion.addEventListener?.('change', drawFlow);
  }

  const count = Number(window.SANKO_PLANT_MAPPING_COUNT);
  if (Number.isFinite(count)) {
    document.querySelectorAll('[data-plant-count]').forEach((node) => {
      node.textContent = String(count);
    });
  }

  document.querySelectorAll('[data-year]').forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });

  const hero = document.querySelector('.hero');
  requestAnimationFrame(() => hero?.classList.add('is-ready'));

  const menuButton = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.primary-nav');
  menuButton?.addEventListener('click', () => {
    const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!isOpen));
    menuButton.setAttribute('aria-label', isOpen ? 'Open navigation menu' : 'Close navigation menu');
    nav?.classList.toggle('is-open', !isOpen);
  });
  nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    nav.classList.remove('is-open');
    menuButton?.setAttribute('aria-expanded', 'false');
    menuButton?.setAttribute('aria-label', 'Open navigation menu');
  }));

  const voiceButton = document.querySelector('.voice-toggle');
  voiceButton?.addEventListener('click', () => {
    const note = voiceButton.closest('.voice-note');
    const isPlaying = voiceButton.getAttribute('aria-pressed') === 'true';
    voiceButton.setAttribute('aria-pressed', String(!isPlaying));
    voiceButton.setAttribute('aria-label', isPlaying ? 'Play illustrative voice note' : 'Pause illustrative voice note');
    note?.classList.toggle('is-playing', !isPlaying);
  });

  const toast = document.querySelector('[data-toast]');
  let toastTimer;
  const showToast = (message) => {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 4200);
  };

  document.querySelectorAll('[data-placeholder="whatsapp"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      showToast('WhatsApp test link placeholder — connect the Baileys-hosted agent URL here.');
    });
  });

  const form = document.querySelector('[data-partnership-form]');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const status = form.querySelector('.form-status');
    if (status) status.textContent = 'Preview received. Connect your form or CRM endpoint to deliver partnership enquiries.';
    showToast('Partnership form validated — delivery endpoint is still a placeholder.');
  });
})();
