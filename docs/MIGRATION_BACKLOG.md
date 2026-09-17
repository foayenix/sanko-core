# Archive migration backlog

Develop all follow-up work in `foayenix/sanko-core`. Archive refs below are pinned
evidence for selective ports, not branches to merge wholesale.

## Notebook, specimens and local processing: live qualification

The requested canonical snapshot equals notebook commit
`359b57d1dc3c85750ec95ae0828ff3269e265893`. Its integrated implementation, tests,
eval fixture and SQL were retained and verified offline. The remaining work is:

- Exercise actual notebook photos through local OCR, correction review, language
  marks/diacritics, media retention and the transcription export path. Test
  actual Ollama/Whisper configurations and missing-model failure behavior.
- Verify practitioner-named specimen persistence, account export/deletion,
  scoping and ambiguous/unknown mappings against a real Supabase API and storage
  bucket. Apply migrations to a disposable Supabase environment first.
- Run and independently review the photo eval with the intended local model.
  Passing scripted tests is not evidence of field accuracy; no model score was
  produced during this transfer.
- Review private local-processing recovery work separately from
  `backup/sanko-local-sync` (`55d4668531175197f6b1a26e3c4c0a7e01fcab22`). Only the
  two missing governance documents were recovered from it in the baseline.
- Obtain practitioner review for the eval suite; none of the 56 cases currently
  qualifies for the 100-case practitioner-reviewed promotion gate.

## Newer archive main work intentionally not folded into the older canonical data

Archive main at **c23fec32cc707a7206579670f2a3468a29a2d046** contains work absent
from the requested canonical snapshot. It must be reconciled with the retained
local agent before inclusion; copying its generated output alone loses provenance.

| Work | Archive PR / branch | Acceptance gate |
| --- | --- | --- |
| Port Harcourt source adjudication | #8 `plants/port-harcourt` | Port evidence, builder changes and tests together; verify provenance and regenerated index. |
| Published name corrections | #9 `plants/resolve-unmatched-names` | Preserve correction provenance, ambiguity and unresolved-name safeguards. |
| Bayelsa/Ijaw survey | #10 `plants/bayelsa-ijaw-survey` | Review source eligibility and language metadata; reproduce all generated output. |
| Rivers survey and plant parts | #11/#14 `plants/rivers-state-survey`, `plants/rivers-plant-parts` | Port source tables, extraction/review records and tests as one reviewed change. |
| Legacy botanical taxonomy | #12 `plants/legacy-taxonomy` | Keep legacy status distinct from practitioner verification. |
| Contested-name adjudication | #13 `plants/adjudicate-contested` | Verify reviewer attribution and exclusions; no automatic winner selection. |
| Photo identification guard | #15 `plants/photo-identification-guard` | Compare with the existing specimen grounding tests; verify no model-origin species can persist. |
| Resolver search, diacritics, chat links | #16/#17/#18 `plants/name-search`, `plants/title-case-diacritics`, `plants/whatsapp-deep-link` | Port associated tests and builders; verify data parity, URL escaping and mobile interactions. |

The baseline remains at 479 names / 442 resolved. This is a deliberate source
selection, not a claim to include every improvement already merged in the archive.

## Deployment and operations

- Rebind any future CI/CD or hosting source to `sanko-core`; the transfer itself
  did not change production deployments, domains, GitHub settings or live data.
- Qualify landing form delivery and `supabase/functions/notify-enquiry`; compare
  archive `forms/email-delivery` and `forms/email-not-hosted-db` selectively.
  Blank production form configuration is not a working delivery integration.
- Replace the omitted `scripts/serve-day.sh` with a supervisor that owns only
  this deployment's processes, creates its log directories and shuts down safely.
- Replace the backup branch's `ops/com.sanko.backup.plist` with host-specific
  configuration and a verified restore drill. Do not copy old absolute paths or
  its shell command's ambiguous success/failure scheduling behavior.
- Replace `sanko-landing page/scripts/build-og-card.py` with a reproducible
  generator using committed assets and explicitly managed fonts/dependencies.
  Keep the existing `public/og-card.png` until the replacement is reviewed.
- `scripts/snapshot-legacy-plant-lookup.js` has already served its purpose. The
  committed `data/plants/legacy_lookup_v1.json` is immutable source evidence;
  do not regenerate it from a newer runtime index.
- Private book extraction scripts take separately supplied source PDFs and Python
  dependencies. Keep those copyrighted inputs and outputs out of Git.
- Contributor terms remain disabled pending legal review and practitioner
  consultation; recovered draft text is not evidence of either approval.

All three omitted scripts remain recoverable at canonical source commit
`359b57d1dc3c85750ec95ae0828ff3269e265893`. Historical branches and the archive
repository were not modified or deleted.
