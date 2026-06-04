# BenchPath Reference Split Plan

This file summarizes what should be saved in separate canonical files, based on the current BenchPath reference data and the dependency map.

## Current Files Reviewed

- `data/benchpath/reference/source.json`
- `data/benchpath/reference/source-fragments.json`
- `data/benchpath/reference/clb.framework.json`
- `data/benchpath/reference/clb.skills.json`

## Extracted Snapshot

- Sources: `19`
- Source fragments: `13`
- Frameworks: `1` (`framework:clb`)
- Skills: `4` (`listening`, `speaking`, `reading`, `writing`)
- Stages: `3` (`stage:1`, `stage:2`, `stage:3`)
- Benchmark IDs found in skills: `48`
- Competency Area IDs found in skills: `16`

For full extracted IDs and mappings, see:

- `data/benchpath/reference/benchpath-reference-extraction-map.json`

## What Should Be Separated Next

### 1) `clb.competency-areas.json`

Save:

- Canonical competency area records
- Link each area to:
  - `frameworkId`
  - `skillId`
  - `sourceRefs`
- Use IDs already referenced in `clb.skills.json` as seed values

### 2) `clb.benchmarks.json`

Save:

- Canonical benchmark records (`benchmark:<skill>:<level>`)
- Link each benchmark to:
  - `frameworkId`
  - `skillId`
  - `stageId`
  - `sourceRefs`
- Use IDs already referenced in `clb.skills.json` as initial seed set

### 3) `clb.competencies.json`

Save:

- Competency records under each benchmark and competency area
- Link each competency to:
  - `benchmarkId`
  - `competencyAreaId`
  - `sourceRefs`

### 4) `clb.indicators.json`

Save:

- Indicator records linked to competencies
- Optional benchmark snapshots for query speed
- `sourceRefs` for traceability

### 5) `clb.profile-of-ability.json`

Save:

- One main profile per `skill + benchmark` (1:1 with benchmark)
- Profile descriptors, language metadata, and `sourceRefs`

### 6) `clb.features-of-communication.json`

Save:

- Feature descriptors tied to benchmark and/or competency scope
- Scope metadata (`scopeType`, foreign keys)
- `sourceRefs`

### 7) `clb.sample-task-labels.json`

Save:

- Official sample-task labels only (not runtime teacher tasks)
- Links to benchmark and optional competency
- `sourceRefs`

## Reference-Layer Rule Applied

All meaningful records in all files above should include `sourceRefs` so every canonical statement remains traceable to `source.json` and `source-fragments.json`.

