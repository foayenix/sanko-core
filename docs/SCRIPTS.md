# Script inventory

Run commands from the repository root unless stated otherwise. No operational
command is required for offline tests except the automatic plant-data pretest.

| Group | Scripts | Inputs / dependencies |
| --- | --- | --- |
| Baseline checks | `check-repository.js`, `check-secrets.js` | Git checkout and Node. |
| Local diagnostics and previews | `doctor.js`, `preview-admin.js`, `preview-dashboard.js`, `seo_preview_server.py` | Doctor checks configured services; previews are local tools, Python 3 for SEO preview. |
| Database and backup | `migrate.js`, `backup.js` | Explicit database configuration and PostgreSQL tools; backups require an encryption key. |
| Operator/governance | `admin-account.js`, `knowledge-use.js` | Account tool generates hashes; governance uses configured DB and the committed draft terms. |
| Training/evaluation | `export-training-data.js`, `export-vision-data.js`, `export-consent.js`, `compare-vision.js`, `draft-eval-cases.js`, `promote-model.js` | Real exports/evaluations require configured services and reviewed input; never commit raw practitioner exports. Both exports run through `export-consent.js`, which excludes practitioners who have not accepted the contributor terms and records what was used in the knowledge-use ledger; `--dry-run` reports eligibility without writing. |
| Editorial eval generation | `build-editorial-eval-fixtures.js` | Deliberately overwrites editorial fixtures; review its diff and never treat editorial review as practitioner approval. |
| Plant build/review | `build-plant-data.js`, `plant-review.js` | Build is offline; pull/promote use configured DB and the ignored review queue. |
| Plant acquisition | `discover-sources.js`, `import-wikidata-vernaculars.js`, `fetch-gbif-taxonomy.js` | Network acquisition; review results before promoting them into runtime inputs. |
| Historical source extraction | `import-plateau-survey.js`, `extract-nigerian-plant-sources.py`, `extract-medicinal-book-mappings.py` | Explicit source inputs; Python tools require pdfplumber/pypdf respectively. Extraction scratch and book references stay ignored. |
| Landing build | `sanko-landing page/scripts/{sync-plant-count,build-privacy,build-resolver,build-hero-plates}.mjs` | Committed data, templates and assets. Resolver is an explicit rebuild; count/privacy run before the landing build. |

The three omitted legacy scripts and the unimported host scheduler are listed in
[the backlog](MIGRATION_BACKLOG.md). The `.claude/launch.json` entries target
retained preview commands; no private editor state or deployment linkage was
imported. SQL migration numbers are historical and must not be renumbered.

To reproduce public resolver output without changing publication dates, set
`RESOLVER_BUILD_DATE` to the `built_at` date in
`data/plants/resolver_build_report.json` before `npm run plants:resolver`.
An intentional new publication defaults to today and updates the report/sitemap.
