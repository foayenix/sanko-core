# Sanko Core repository transfer

Transfer date: 2026-09-17.

## Provenance and the handoff discrepancy

The requested source, `foayenix/sanko-vault` branch `canonical/sanko-core`, resolved
to **359b57d1dc3c85750ec95ae0828ff3269e265893**. At inspection,
`pages/notebook-transcription` resolved to that exact same commit. There were no
separate canonical consolidation documents on that remote branch. This record,
the backlog, script inventory and repository instructions were created during
the transfer, rather than claimed to have been recovered from an earlier cleanup.

The target started at **d588073**, its README-only initialization commit. Source
files were exported with `git archive` into that checkout. No source `.git`,
branches, commits, merge ancestry, remotes, untracked files or local credentials
were copied. The baseline commit is a normal child of the target initialization.
The only development remote is `foayenix/sanko-core`.

The archive was read only throughout. This transfer does not change its GitHub
archive setting, close its old PRs, or alter existing deployments.

## Transferred

- The canonical application: WhatsApp webhook and Baileys adapter, agent tools,
  registration, simulator, operator/admin and aggregate dashboards, Supabase
  access, privacy/account controls, consent gates, correction and review flows.
- Canonical local LLM, speech and page-transcription adapters, transcription
  corrections, practitioner-named specimens and their provenance/grounding
  safeguards. These were already integrated in the named source; they were
  retained after offline tests and SQL verification, not merged from another
  branch. Live model qualification remains in the backlog.
- Plant runtime index and committed provenance sources: **479 names, 442
  resolved**, along with staged/discovery/quarantined source metadata. Generated
  runtime and provenance datasets reproduce byte for byte from the source snapshot.
  The public resolver report and source listing were refreshed to include the
  already-committed discovery-source metadata; no new mappings were promoted.
- Seventeen SQL migrations, preserving every filename and byte, including
  `015_page_transcription.sql`, `016_landing_enquiries.sql`, and
  `018_specimens.sql`. No `017` exists in the source; numbering was not invented.
- All 16 canonical test files, their helper, 56 eval cases, eval tools, training
  documentation, product/design/brand/privacy references and the PRD document.
- Static landing pages, plant resolver pages, brand assets, React demo, existing
  deployment configuration, local launch configuration, and working maintenance
  and review scripts.

## Repairs and omissions

- Recovered the original, unmodified `governance/contributor-terms-v1.md` and
  `.summary.txt` from archive backup commit
  **55d4668531175197f6b1a26e3c4c0a7e01fcab22**. Their absence broke registration
  and many tests in a clean source checkout. They remain explicitly draft and
  disabled by default. No replacement legal terms were invented.
- Renamed the npm package and root service identity to `sanko-core`; retained the
  product term “Vault.” Set the backend Node floor to 20.19 to match the toolchain.
- Added `pretest` to build the ignored plant report. Corrected a test that required
  uncommitted copyrighted book extracts to assert their exclusion from production
  using committed metadata instead. The private extracts were not imported.
- Changed synthetic secret-test fixtures to assemble their values at runtime,
  keeping their detection assertions while allowing the repository scan to pass.
  No test directory was exempted from scanning.
- Made the public resolver build date pinnable with `RESOLVER_BUILD_DATE` and
  added its reproduction check to CI; refreshed the publication date and sitemap.
- Hoisted two static React demo components out of render scope to fix lint.
- Applied compatible npm dependency updates in both lockfiles; both full audits
  reported zero known vulnerabilities at transfer time.
- Removed three source scripts: `scripts/serve-day.sh` (unscoped process killing
  and missing log-directory setup), `scripts/snapshot-legacy-plant-lookup.js`
  (completed one-time snapshot, output already exists), and
  `sanko-landing page/scripts/build-og-card.py` (missing external brand kit and
  machine-specific font). Their recovery paths and replacement work are in the
  backlog. Existing generated artwork and immutable legacy data were retained.
- Did not import the backup's machine-specific launchd scheduler. Corrected the
  README's missing-scheduler reference, stale test counts, incomplete migration
  list and contradictory local/hosted deployment claims.
- Retained existing CI checks and added landing lint/build, dependency audits,
  repository structure checks and disposable PostgreSQL migration validation.

## Validation

- Backend: **481 tests passed, 99 suites, no skips** on local Node 24.
- Evaluation fixture validation: **56 valid**, **0 practitioner-reviewed**;
  42 editorial and 14 unreviewed. This is not a live model evaluation.
- Both applications: locked installs and dependency audits; zero known advisories.
- Landing: lint and production build passed.
- Data: plant/provenance rebuild, landing plant count and privacy generation
  match committed outputs. Canonical SQL files retain their original hashes.
- PostgreSQL 16: all **17 migrations applied**, repeat run did nothing, status
  showed **17 applied / 0 pending** in an isolated temporary database. This does
  not exercise a running Supabase API, storage service or deployed edge function.
- Repository scan: credential patterns, excluded private/generated paths,
  tracked script targets and relative module imports checked before commit.
- GitHub CI runs against the pushed commit: Node 20/24 tests, data reproducibility,
  secret/structure checks, landing validation and disposable database migrations.
  Consult that commit's actual check results for remote status.

`TRANSFER_MANIFEST.json` records every canonical path with its source Git blob,
target hash and transfer disposition, plus recovered and newly added files. It is
a historical snapshot of this transfer, not a constraint on future development.

## Readiness boundary

Use **sanko-core/main as the sole development baseline**. All further migrations,
fixes and selective archive ports belong here. No bulk branch merge is needed.
Repository readiness is separate from production readiness: deployments,
credentials, live WhatsApp, model accuracy, Supabase storage and edge delivery,
backup restore operations and practitioner-reviewed evaluations still require
their own environment-specific checks. See the backlog for explicit gates.
