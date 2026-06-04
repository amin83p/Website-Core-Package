# IELTS Scoring Hardening Utilities

## 1) Patch-Impact Comparison

Use this tool to compare two scoring exports/sessions and list score-impact drift:

```bash
npm run ielts:impact:compare -- --before <before.json> --after <after.json> --out <report.json> --top 25
```

Outputs:
- paired session summary (strict/loose match)
- overall and criterion deltas
- top keys where pass-state changed
- top keys where value changed
- keys becoming unevaluable

## 2) Behavior Freeze Baseline (Guard + Low-Band)

Freeze-check current scoring behavior from the latest accepted green state:

```bash
npm run ielts:freeze:check
```

This prints only drifted keys when behavior changes and exits non-zero on drift.

Node test equivalent:

```bash
npm run test:ielts:freeze
```

Recommended CI gate command (must pass before merge):

```bash
npm run test:ielts:gate
```

`test:ielts:gate` includes:
- baseline freeze drift check
- patch-hardening metadata/toggles check
- stability suite
- TR/CC run-profile suite
- low-band activation/followup/polarity guards

## 3) One-Command Preflight (Before Every Tuning Batch)

Run freeze check + full gate + impact comparison in one command:

```bash
npm run ielts:preflight -- --before <accepted.json> --after <current.json> --profile scripts/ielts/phaseProfiles/current.json --out <report.json> --top 25
```

Optional flags:

```bash
npm run ielts:preflight -- --before <accepted.json> --after <current.json> --skip-gate
npm run ielts:preflight -- --before <accepted.json> --after <current.json> --skip-freeze
npm run ielts:preflight -- --before <accepted.json> --after <current.json> --skip-acceptance
```

This command is designed for your patch-cycle preflight, not for fast local iteration.

Phase profile files:
- `scripts/ielts/phaseProfiles/current.json` (active lock)
- `scripts/ielts/phaseProfiles/phase-6-6.5.json` (named snapshot)

## 4) Manual JSON Tuning History (Simplified)

Use one manual JSON file as the source of truth:

`docs/ielts/tuning-history.json`

For each micro-batch, append one object with:
- changed keys
- expected vs actual effect
- guard/low-band impact
- keep/rollback decision

This keeps the process lightweight while preserving full traceability.

## 5) Tactical Patch Group Toggles (Runtime Safety)

`scoringRules.js` now supports grouped toggles for tactical batches.
Default state: all groups enabled (no behavior change).

Disable groups globally:

```bash
set IELTS_RULE_PATCH_DISABLED_GROUPS=phase5_cc_gra_boundary,phase6_cc7_thin_conclusion
```

Override a single group explicitly:

```bash
set IELTS_RULE_PATCH_PHASE6_CC7_THIN_CONCLUSION=off
set IELTS_RULE_PATCH_PHASE6_CC7_THIN_CONCLUSION=on
```

These toggles are for controlled rollback diagnostics during tuning.
