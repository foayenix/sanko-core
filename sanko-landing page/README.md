# Sanko landing site and demonstration app

This directory contains both a static public site (`public/`) and the React/Vite
product demonstration (`src/`). The React screens include illustrative records;
they are not evidence of live practitioner usage or clinical effectiveness.

From the repository root:

```sh
npm --prefix "sanko-landing page" ci
npm --prefix "sanko-landing page" run lint
npm --prefix "sanko-landing page" run build
```

The build synchronizes the landing plant count and renders the privacy notice
from the root `PRIVACY.md`, then builds the demo and copies the static assets.
For local development use `npm --prefix "sanko-landing page" run dev`.

Existing static-host configuration is in `public/vercel.json`; it routes `/` to
`landing-v2/index.html`. The separate `public/landing/` path and historical design
references are preserved. Verify the intended site/root before deploying.
Production forms require explicit public configuration and a tested delivery path;
see [the migration backlog](../docs/MIGRATION_BACKLOG.md). No deployment occurred
as part of the repository transfer.
