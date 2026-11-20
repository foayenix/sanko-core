# Plant literature index — coordinator runbook

**Who runs this:** a Claude Code session, on the founder's behalf (founder
decision, 20 November 2026). The founder brings reviewers' sheets to a session;
the session runs the commands, commits the results and reports back.

Each session starts in a fresh container with only what is committed. Reviewer
sheets are deliberately not committed (`data/literature/review/` is gitignored),
so everything a session needs to know is in this file, the
[reviewer guide](LITERATURE_REVIEWER_GUIDE.md), `data/literature/README.md` and
`data/literature/calibration/`.

## Hard rules

1. **Never make a reviewer's decision.** A session does not fill, correct,
   complete or "tidy" any include/exclude decision or classification. If a sheet
   is wrong, the reviewer fixes it.
2. **Never import a sheet without a confirmed reviewer pseudonym.** Ask the
   founder which pseudonym each file belongs to unless they said so. Never take
   one from a file name, and never record a real name or email address.
3. **Never commit a reviewer's sheet.** Copy uploads into the scratchpad, not the
   repository. Only `verifications.json` and `calibration/` reports are committed.
4. **Never import calibration sheets one by one.** Two independent calibration
   sheets produce a report. Only the single reconciled sheet is imported.
5. **Thresholds trigger a question, not an action.** Report them; the founder
   decides.

The only edit a session may make to a sheet is mechanical and must be reported:
re-saving a semicolon-delimited file (some spreadsheet locales save CSV with `;`)
as comma-delimited, without changing any cell.

## Start of every session

```bash
git fetch origin && git status
```

```bash
npm ci
```

```bash
npm run literature:check
```

```bash
npm run literature:review -- status
```

If `literature:check` fails, stop and report: committed data is invalid.

## Identify what the founder brought

| The sheet has… | It is | Go to |
| --- | --- | --- |
| `minutes_spent` and no `auto_*` columns | a calibration sheet | Calibration |
| `auto_*` columns | a review queue sheet | Queue import |

A sheet whose header parses as a single column was saved with semicolons; apply
the mechanical fix above and say so.

## Calibration

The current sample is `calibration-1` (50 entries; manifest committed at
`data/literature/calibration/calibration-1-sample.json`). To give reviewers a
fresh blank copy:

```bash
npm run literature:review -- calibration-sheet --seed calibration-1
```

**When both reviewers' sheets arrive:**

```bash
npm run literature:review -- calibration-report --seed calibration-1 --a <sheet-a.csv> --reviewer-a <id> --b <sheet-b.csv> --reviewer-b <id>
```

If it reports incomplete rows, send the list back to the founder for the
reviewers; do not fill gaps. When it succeeds, commit
`data/literature/calibration/calibration-1-report.json` and report to the founder:

| Measure | Report it as a problem when | Why |
| --- | --- | --- |
| `priority_scope_misses.miss_rate` | above 0.10 | The automated safety/human flag is missing too much to decide the queue; the founder may widen the scope |
| `inter_reviewer.evidence_kind.kappa` or `.is_safety_study.kappa` | below 0.6 | The guide's rules are unclear; revise the guide before scaling |
| `automated_vs_reviewer` study type agreement | — | Report the figure; it sets how much to trust `auto_*` columns |
| `median_minutes_per_entry` | — | Multiply by the open priority queue to give the founder a time estimate |

Also list the disagreements by field, so the reviewers can reconcile. The
reviewers then send **one reconciled sheet**; import it under the pseudonym of
whichever reviewer prepared it, and name both pseudonyms in the commit message:

```bash
npm run literature:review -- verify --file <reconciled.csv> --reviewer <id>
```

## Queue import

```bash
npm run literature:review -- verify --file <sheet.csv> --reviewer <id>
```

The import is all-or-nothing. If it refuses, give the founder the problem list
for the reviewer. Rows with no `decision` are skipped, not errors, so a
part-finished sheet can be imported.

## After any import

```bash
npm run literature:check
```

```bash
npm run literature:build
```

```bash
npm run literature:review -- status
```

Commit `data/literature/verifications.json` with a message naming the sheet,
the reviewer pseudonym and the number of events imported, then push to the
session's development branch. Report to the founder: events imported, entries
now public, entries remaining in the priority queue.

## Producing new sheets for reviewers

```bash
npm run literature:review -- queue
```

This writes the safety and human priority queue, excluding entries already
verified. Split it between reviewers by plant if asked, without changing rows,
and hand the files to the founder. `allowed-values.csv` goes with every sheet.

## Decisions on record

| Date | Decision |
| --- | --- |
| 18 Nov 2026 | Open literature index approved; index before profiles; no consumer publishing |
| 19 Nov 2026 | Safety and human studies verified first; calibration round before scaling |
| 20 Nov 2026 | Claude Code sessions run the coordinator commands |

Open, awaiting the founder: a narrower protocol for plants over the 500-hit cap
(neem, moringa, ginger, garlic, papaya and others); whether marjoram keeps its
safety slot in the pilot.
