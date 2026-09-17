# Sanko Core

All new development belongs in this repository. `foayenix/sanko-vault` is a
historical source, not a second development remote. See the transfer record and
migration backlog under `docs/` before porting any archived work.

- Preserve migration filenames and applied SQL checksums; add new migrations.
- Keep private transcripts, auth state, secrets, models, backups and copyrighted
  source extracts out of Git. Use `.env.example` for configuration names only.
- Validate backend changes with `npm test`, `npm run check-secrets`, and
  `npm run check-repository`. Plant data must reproduce from committed sources.
- Validate landing changes with `npm --prefix "sanko-landing page" run lint`
  and `npm --prefix "sanko-landing page" run build`.
- Offline tests validate application behavior, not model accuracy. Contributor
  terms remain a draft; do not enable them as part of routine development.
