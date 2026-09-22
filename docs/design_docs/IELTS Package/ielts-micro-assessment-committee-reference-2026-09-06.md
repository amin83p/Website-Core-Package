# IELTS Micro-Assessment Question Origins and Evolution

**Committee reference document**  
**Date:** 2026-09-06 (revised for MongoDB runtime backend)  
**Subject:** How micro-assessment questions were created, evolved, weighted, scored, and used for feedback  
**Author:** Researcher (EdD dissertation) with supporting development artifacts in the Website-Core-Package repository

**Live data verified:** 2026-09-06 via MongoDB (`ieltsMicroAssessments`, `ieltsScoringHistory`) with `DATA_BACKEND=mongo`

---

## 1. Executive Summary

This document answers committee questions about the IELTS Writing Task 2 micro-assessment question bank used in the dissertation scoring pipeline. The evidence comes from:

- **Production runtime data** in MongoDB (`ieltsMicroAssessments`, `ieltsScoringHistory`, `ieltsPrompts`, `ieltsTask2Samples`)
- Application code (scoring services, repositories, tuning logs)
- Archived development files (40-item and 42-item prototype question documents, Steps Guide, V2.0–V2.3 calibration reports, early session JSON exports)

**Key findings:**

1. **How were the first questions made?** They were manually derived from the official IELTS Task 2 band descriptors. Development began with 40 operational yes/no questions (measurable features), then a 42-item rubric-language set, then a formal bank of **127 atomic items** keyed by criterion and band (e.g. `TR5-3`, `CC6-2`).

2. **AI or researcher?** **Researcher-authored.** AI answers the questions at runtime but did not generate the bank. Every v1 item is tagged *"First version (v1) imported via CSV"* (2026-02-11).

3. **Have they evolved?** **Yes.** The current 127-item bank is not the original 40 questions. It adds band mapping, polarity contracts, scope (essay/paragraph), weights, and deterministic/AI routing.

4. **Who and how evolved?** Primarily the researcher (design and rubric decomposition); collaborative engineering for scoring rules, prompts, and stability tuning. Evolution followed instability in early direct-AI scoring → five-step pipeline → CSV import → scoring-engine calibration V2.0–V2.3 → phased rule tuning (Feb–Apr 2026).

5. **Why evolved?** To improve **reliability**, **traceability** (sentence-level evidence), **construct validity**, and **calibration** against human examiner benchmarks.

**Scoring is not one AI judgment.** Step 4 applies 127 micro-questions (with paragraph instances where needed), uses weighted band gates (50% pass threshold per band), and Step 5 builds feedback from pass/fail results tied to sentence indices. Full scoring audits (`gateTrace`) are persisted in MongoDB collection `ieltsScoringHistory`.

---

## 2. Runtime Data Storage (MongoDB)

Production uses **`DATA_BACKEND=mongo`**. At runtime, IELTS entities are read and written through repository services — not by editing JSON files on disk.

| Entity | MongoDB collection | Legacy JSON mirror (dev/bootstrap/tests only) |
| --- | --- | --- |
| Micro-assessment bank | `ieltsMicroAssessments` | `data/ielts/microAssessments.json` |
| Scoring sessions + `gateTrace` | `ieltsScoringHistory` | `data/ielts/scoring/sessions/*.json` |
| AI prompt templates | `ieltsPrompts` | `data/ielts/prompts.json` |
| Task 2 sample essays | `ieltsTask2Samples` | `data/ielts/task2samples.json` |
| Tuning audit log | *(file-based)* | `docs/ielts/tuning-history.json` |

**How data flows at runtime:**

1. Step 4 loads active questions via `ieltsService.fetchData('microAssessments', { is_active: true })` → `ieltsRepositories.microAssessments` → **`ieltsMicroAssessments`** collection.
2. Admin CSV import and UI edits persist to Mongo when mongo backend is active (file-based model operations are disabled in mongo mode).
3. Completed scoring runs save full step payloads — including `gateTrace` — to **`ieltsScoringHistory`**.

**Org scoping:** Questions are org-scoped in production. The live bank verified on 2026-09-06 contains **127 documents** under `orgId: "900000"`, with `SYSTEM` org fallback supported in repository filters.

**Verified live bank statistics (MongoDB, 2026-09-06):**

| Metric | Value |
| --- | --- |
| Total documents | 127 |
| Active (`is_active: true`) | 127 |
| TR / CC / LR / GRA | 43 / 33 / 25 / 26 |
| Weight 3 / 2 / 1 | 64 / 45 / 18 |
| `signal_kind` deterministic / hybrid | 67 / 60 |
| Explicit `scope: paragraph` | 6 |
| `createdAt` range | 2026-02-11 → 2026-04-11 |
| Scoring sessions with `gateTrace` | 123 / 123 |

**CSV import history (unchanged):** The v1 bank was imported on **2026-02-11** through the admin UI. That import path now writes to `ieltsMicroAssessments` when mongo is active. The repository JSON file may exist in the codebase as a bootstrap mirror but is **not** the runtime source of truth in production.

---

## 3. Committee Questions and Answers

### 3.1 How were the first questions made?

The first questions were a **manual operationalization of the official IELTS Writing Task 2 band descriptors**, not free-form AI prompts.

#### Earliest prototype — 40 questions (`Task 2 - Simple Questions.docx`)

- Title: *IELTS Writing Task 2 – Strict Binary Yes/No Questions*
- 40 measurable items mixing TR, CC, LR, and GRA
- Examples:
  - Q1: *Are there at least 3 complete sentences forming one paragraph?*
  - Q6: *Does the essay include a stance sentence (e.g., 'I agree/disagree/believe/argue')?*
  - Q17: *Is connector density <2 or >12 per 100 words OR is the same connector repeated 3+ times consecutively?*
  - Q25: *Is type–token ratio (TTR) < 0.35 over the first 200 tokens...?*
  - Q40: *Are at least 90% of sentences error-free AND at least 60% are complex sentences...?*
- These translate rubric ideas into **countable surface features** (paragraph count, connector density, TTR, error rates)

#### Intermediate prototype — 42 questions (`Task 2 - YN - Rubric.docx`)

- Title: *IELTS Writing Task 2 – Yes/No Questions*
- Rubric-language items progressing through performance levels
- Examples:
  - Q4: *Are ideas at least minimally related to the topic?*
  - Q11: *Does the essay address all parts of the task and present a clear position throughout?*
  - Q18: *Are ideas arranged coherently with clear overall progression?*
  - Q32: *Is vocabulary used fluently and flexibly to convey precise meaning?*
  - Q42: *Is there full flexibility and accuracy across a wide range of structures?*
- Closer to examiner descriptor wording; less formula-driven than the 40-item set

#### Current formal bank — 127 items (MongoDB `ieltsMicroAssessments`)

| Criterion | Count (verified live) |
| --- | --- |
| TR | 43 |
| CC | 33 |
| LR | 25 |
| GRA | 26 |
| **Total** | **127** |

Each item includes:

- `baseKey` — e.g. `TR5-3`, `CC6-2`, `LR7-1`
- `atomic_question` — the yes/no (or categorical) micro-question text
- `rubric_anchor` — official descriptor language the item operationalizes
- `band` — target band gate (1–9)
- `weight` — importance within band-gate aggregation (1, 2, or 3)
- `scope` — `essay` or `paragraph` (6 items explicitly paragraph-scoped; others default to essay at runtime)
- `scoredAnswers` / `notScoredAnswers` — explicit pass/fail contract
- `signal_kind` — `deterministic` (67) or `hybrid` (60): rule-first vs rule+AI

Imported as **v1 via CSV on 2026-02-11** (`createdAt` on Mongo documents; `notes`: *"First version (v1) imported via CSV."*).

---

### 3.2 Were they created by AI or by the researcher?

**Researcher-authored (human), not AI-generated.**

| Evidence | What it shows |
| --- | --- |
| `notes` on all 127 Mongo documents | *"First version (v1) imported via CSV."* |
| `rubric_anchor` per item | Manual mapping to official descriptor text |
| `Steps Guide.docx` | First-person methodology rationale (*"In my methodology..."*) |
| Repository search | No file states the question bank was LLM-generated |
| Runtime role of AI | Step 3 extraction, Step 4 fallback answering, Step 5 feedback polish |

**Important distinction:** During early prototyping, AI was the **respondent** to questions (answers fluctuated across runs and batch sizes). AI was **not** the author of the final question set.

---

### 3.3 Have they evolved from the first version?

**Yes — substantially.**

| Stage | Count | Nature | Status |
| --- | --- | --- | --- |
| Prototype A | 40 | Feature-threshold binary questions | Superseded |
| Prototype B | 42 | Rubric-language progressive Y/N | Intermediate |
| Formal v1 bank | 127 | Criterion-band atomic items + metadata | Current base (Mongo) |
| Runtime instances | 127+ | Paragraph-scoped copies (e.g. `CC4-1::P2`) | Generated per essay at scoring time |

The current bank is a fuller decomposition with explicit band mapping, answer polarity, essay vs paragraph scope, deterministic/hybrid/AI routing, and weights for aggregation.

---

### 3.4 Who evolved them, and how?

**Who**

- **Primary:** Researcher (EdD candidate) — question design, rubric decomposition, methodology framing
- **Collaborative engineering:** Scoring-rule calibration, pipeline hardening, automated test suites
- **AI:** Respondent and evidence extractor only; not question author

**How (documented evolution path)**

1. **Early direct-AI scoring** — Rubric-derived questions + sample essay fed directly to AI; answer fluctuation and batch-size sensitivity observed; motivated architectural change.

2. **Five-step pipeline** (`Steps Guide.docx` + current code):
   - **Step 1:** Deterministic paragraph/sentence indexing (no AI judgment)
   - **Step 2:** Observable feature extraction (structure, cohesion, lexical stats)
   - **Step 3:** Constrained AI evidence extraction (fixed JSON schema)
   - **Step 4:** Micro-assessment answering (deterministic rules first, AI fallback)
   - **Step 5:** Evidence-grounded feedback

3. **Formal bank import (2026-02-11)** — 127 items via CSV into admin UI → persisted to **`ieltsMicroAssessments`**; tagged v1.

4. **Scoring-engine calibration V2.0 → V2.3 (2026-02-12)** — Primarily **rules and prompts**, not question text rewrites (see Section 9).

5. **Item-level and rule-level tuning (Feb–Apr 2026)** — `docs/ielts/tuning-history.json`; patch rationales in bracketed `notes` on individual Mongo documents; behavior-freeze gates before accepting changes.

---

### 3.5 Why did they evolve?

1. **Reliability / reproducibility** — Early 40-question direct-AI approach produced unstable answers; deterministic preprocessing + constrained extraction + atomic questions reduced variance. Standard vs strict prompt policies and 3-run Step 3 consensus documented in `packages/ielts/docs/dissertation/ielts-prompt-policy-delta-matrix.md`.

2. **Traceability / auditability** — Evidence tied to `paragraphIndex` / `sentenceIndex` so feedback points to exact text.

3. **Construct validity** — Moved from surface metrics alone (TTR, connector counts) toward rubric-anchored atomic judgments for TR/CC/LR/GRA.

4. **Calibration against human benchmarks** — V2.0–V2.3 targeted mismatches with examiner scores (e.g. School Holidays: system 6.0 vs human 7.0).

5. **Controlled AI role** — Shifted AI from "judge the essay" to "find evidence" and "answer narrowly scoped questions," with deterministic rules handling an increasing share of items.

---

### 3.6 Suggested committee speaking script

> "The micro-assessments began as my manual decomposition of the official IELTS Task 2 band descriptors. I first prototyped about 40 strict yes/no questions using measurable features, but when I fed those directly to AI the answers fluctuated across runs and prompt chunk sizes. I then refined the wording toward rubric-aligned yes/no items and eventually built a formal bank of 127 atomic questions, each linked to a specific criterion, band, and rubric anchor. These were researcher-authored and imported into the system in February 2026; AI answers the questions but did not write them. In production the live bank is stored in MongoDB, not in static JSON files. The questions evolved because I needed greater stability, traceability to sentence-level evidence, and closer alignment with human examiner judgments. Later work focused on scoring rules, extraction prompts, and repeated-run stability rather than rewriting the core question set."

---

## 4. Question Evolution Timeline

```
Official IELTS Task 2 Band Descriptors
        |
        +---> 40 operational Y/N questions (feature thresholds)
        |           |
        |           v  [instability: AI answers fluctuated]
        +---> 42 rubric-language Y/N questions
                    |
                    v  [full decomposition + metadata]
              127-item micro-assessment bank (v1 CSV import → MongoDB)
                    |
                    v
              5-step pipeline with sentence-level evidence indexing
```

| Version line | What it refers to |
| --- | --- |
| Question bank v1 | 127 CSV-imported items in `ieltsMicroAssessments`; evolution in `notes`, metadata, associated rules |
| Scoring engine V2.0–V2.3 | Aggregation logic, deterministic rules, Step 3 prompts — **not** a separate question bank |

There is **no V2.1/V2.2 question bank** in the repository; those labels refer to scoring-engine iterations.

---

## 5. Five-Step Pipeline Overview

| Step | Name | AI used? | Purpose |
| --- | --- | --- | --- |
| 1 | Freeze / preprocess | No | Normalize text; assign paragraph and sentence indices (`essayPreprocessingService.js`) |
| 2 | Feature analysis | No | Extract observable structure, cohesion, lexical stats (`essayAnalysisService.js`) |
| 3 | Evidence extraction | Yes (constrained) | Stance, topic sentences, body support, lexical/grammar control signals (`aiExtractionService.js`) |
| 4 | Micro-assessment grading | Partial | Answer 127 questions from Mongo: deterministic rules first, AI batch fallback (`step3ScoringService.js`) |
| 5 | Feedback | Yes (constrained) | Criterion-structured feedback from Step 4 results (`step5FeedbackService.js`) |

**Design principle:** Steps 1–2 are fully deterministic. Step 3 finds evidence only (no band scores). Step 4 aggregates many atomic pass/fail decisions. Step 5 narrates results — it does not re-score the essay. Step 4 outputs and `gateTrace` are saved to **`ieltsScoringHistory`**.

---

## 6. How Weights Work

Each micro-assessment carries a numeric `weight` used only during **band-gate aggregation** (Step 4), not when answering individual questions.

### Current distribution (127 items — verified from MongoDB)

| Weight | Count | Role |
| --- | --- | --- |
| 3 | 64 | Highest-importance indicators within a band gate |
| 2 | 45 | Medium importance |
| 1 | 18 | Supporting indicators |

**Default:** If missing or invalid, weight defaults to `1` (`normalizeQuestionWeight` in `step3ScoringService.js`).

### What weight means

Within a single band gate (e.g. all TR questions at Band 6), each question contributes its weight toward a pass ratio:

```
passRatio = passedWeight / totalWeight
```

A question with weight 3 counts three times as much as weight 1 when deciding whether the essay clears that band threshold.

**Committee answer:** Weights were assigned by the researcher during bank design to reflect relative importance of each atomic indicator within a band gate — not learned automatically by AI.

---

## 7. How Scoring Works (Step 4)

Implemented in `packages/ielts/MVC/services/ielts/step3ScoringService.js` (legacy service name; this is **Step 4** in the UI).

### 7.1 Four-stage process

**Stage 1 — Answer each micro-question**

For each question instance:

1. **Deterministic rule first** — If `scoringRules[baseKey]` exists, return Yes/No using Step 2 features + Step 3 extraction evidence.
2. **AI fallback** — If no rule or rule returns `null`, batch to AI with structured prompt + sentence index map.
3. **Pass/fail** — Evaluated via explicit answer contract (`answerContractUtils.js`):
   - Answer in `scoredAnswers` → **pass**
   - Answer in `notScoredAnswers` → **fail**
   - **V2.0 fix:** For fault-check questions like *"Is there irrelevant detail?"*, answer **No** correctly **passes** (previously treated as 0 points).

**Stage 2 — Aggregate paragraph instances**

Six paragraph-scoped questions are instantiated per eligible body paragraph (e.g. `CC4-1::P2`). Multiple instances merge to one row per `baseKey` via `aggregateInstanceResults()`.

**Stage 3 — Weighted band-gate progression (per criterion)**

`calculateBandScores()` processes TR, CC, LR, GRA independently:

1. Collect available band levels in results (sorted ascending)
2. Start at lowest available band as baseline
3. For each higher band gate:
   - `passRatio = passedWeight / totalWeight`
   - **≥ 0.50** → advance criterion band to that level
   - **0.35 – 0.49** → drop band by 0.5 and stop
   - **< 0.35** → drop band by 1.0 and stop
4. Clamp criterion score to 1–9
5. Store full audit in `gateTrace[criterion].evaluatedGates[]` inside the scoring session document in **`ieltsScoringHistory`**

**Stage 4 — Overall band**

```
overall = round(mean(TR, CC, LR, GRA) × 2) / 2
```

Standard IELTS half-band rounding.

### 7.2 Worked example — CC partial gate (MongoDB `ieltsScoringHistory`)

**Source:** Production scoring session `sessionId: 445534` — **Cambridge 16/Test 02 (BOOK)**  
**Final scores:** TR 3, **CC 5.5**, LR 4, GRA 3.5 → **Overall 4**

**Coherence & Cohesion (CC) — Band 6 partial failure (0.36 pass ratio):**

| Band gate | Status | Pass ratio | Passed weight | Total weight | Resulting band |
| --- | --- | --- | --- | --- | --- |
| 1 | baseline | — | — | — | 1 |
| 2 | passed | 1.00 | 3 | 3 | 2 |
| 3 | passed | 1.00 | 5 | 5 | 3 |
| 4 | passed | 1.00 | 12 | 12 | 4 |
| 5 | passed | 0.81 | 13 | 16 | 5 |
| 6 | **partial** | **0.36** | **4** | **11** | **5.5** (stopped) |

At the Band 6 gate, only 4 of 11 weighted points passed (36%). Because 0.35 ≤ 0.36 < 0.50, CC received a **partial** outcome: band reduced by 0.5 from the attempted gate (6 → 5.5), and progression stopped.

**Sample rows at the Band 6 gate (from `gateTrace.CC.evaluatedGates[].rowChecks`):**

| baseKey | Value | Pass? | Weight |
| --- | --- | --- | --- |
| CC6-1 | No | Fail | 3 |
| CC6-2 | No | Fail | 2 |
| CC6-3 | Yes | Fail | 2 |
| CC6-4 | No | Pass | 2 |
| CC6-5 | No | Pass | 2 |

This illustrates that scoring is **transparent and auditable**: each band decision is decomposable into weighted micro-question outcomes stored in MongoDB under `steps.step4grade.response.json.data.meta.gateTrace`.

---

## 8. How Feedback Is Generated (Step 5)

Implemented in `packages/ielts/MVC/services/ielts/step5FeedbackService.js`. Feedback is **derived from Step 4 results**, not a fresh essay judgment.

### 8.1 Input selection

1. Read graded rows from `gradingResult.aggregatedResults` (from the saved scoring session in `ieltsScoringHistory`)
2. Scope to band range `[floor(currentBand), targetBand]` where `targetBand = min(9, ceil(currentBand + 0.5))`
3. Split into **weaknesses** (failed answer contract) and **strengths** (passed)

### 8.2 Weakness prioritization

```
priority = (weight × 2) + band + (hasEvidence ? 0.5 : 0) + (aggregateSource ? 0.5 : 0)
```

Top 10 weaknesses retained. Evidence sentence indices convert to display refs (`P2-S3`, `S8`) and text snippets from the frozen essay.

### 8.3 Two-layer output

**Layer 1 — Deterministic fallback (always built):**

- Summary citing current band and top weakness criterion
- `byCriterion` blocks (TR/CC/LR/GRA) with fix hints
- `improvements` list (up to 6 items)
- `strengths` list (up to 5 passed indicators)

**Layer 2 — AI refinement (preferred):**

- Structured prompt: current/target band, allowed evidence refs only, weakness lines with snippets, Step 3 language evidence snapshot
- Temperature = 0; JSON output enforced
- Response sanitized to allowed `S#` refs only
- If AI fails → deterministic fallback returned (logged)

**Committee answer:** Feedback is criterion-structured and evidence-grounded. AI polishes the narrative; diagnostic content comes from Step 4 pass/fail results tied to sentence locations.

---

## 9. Scoring Engine Versions V2.0 – V2.3

These versions evolved **scoring rules and extraction prompts**, not the 127 question texts. Documented in archived calibration reports (`V2.0 to V2.1.docx`, etc.).

| Version | Date | Focus | Key change |
| --- | --- | --- | --- |
| V2.0 | 2026-02-12 | Clean Water calibration | Fixed aggregation polarity; density-based LR repetition; TR conclusion fallback |
| V2.1 | 2026-02-12 | School Holidays calibration | "Ambition penalty" fix — reward lexical ambition despite spelling slips; CC topic-sentence fallback |
| V2.2 | 2026-02-12 | Extraction robustness | Step 3 prompt: decouple skill/range from spelling errors; hardened CC6-2 rule paths |
| V2.3 | 2026-02-12 | Ambition priority | Moved critical lexical instructions to top of Step 3 prompt; CC6-1 linked to topic-sentence evidence |

**Validation samples:**

- V2.0: Cambridge 20 Test 01 (Clean Water) — system 5.0 → 6.5 (matched examiner)
- V2.1–V2.3: Cambridge 20 Test 02 (School Holidays) — target 7.0 (examiner band)

Post-import tuning (Phases 6–12, Apr 2026) continued in `docs/ielts/tuning-history.json` with one-row and micro-batch rule patches (e.g. `LR9-1`, `CC9-1`, `TR5-*`).

---

## Appendix A — Sample Prototype Questions

### A.1 Forty-item operational prototype (excerpts)

| # | Question (abbreviated) | Construct focus |
| --- | --- | --- |
| 1 | At least 3 complete sentences in one paragraph? | Structure |
| 6 | Stance sentence present? | TR |
| 9 | Each sub-question has body coverage? | TR |
| 12 | Explanation/example after topic sentence? | TR development |
| 17 | Connector density abnormal? | CC |
| 22 | Body paragraph starts with topic sentence? | CC |
| 25 | TTR below threshold? | LR |
| 34–36 | Complex sentence proportion bands? | GRA |
| 38–40 | Error-free sentence proportion bands? | GRA |

### A.2 Forty-two-item rubric-language prototype (excerpts)

| # | Question (abbreviated) | Construct focus |
| --- | --- | --- |
| 4 | Ideas minimally related to topic? | TR (low band) |
| 11 | Clear position throughout? | TR (Band 7+) |
| 18 | Coherent progression? | CC |
| 22 | Clear central topic per paragraph? | CC |
| 32 | Fluent, flexible, precise vocabulary? | LR (Band 8+) |
| 40 | Variety of complex error-free structures? | GRA (Band 7+) |

---

## Appendix B — Artifact Index

### Tier 1 — Runtime (MongoDB, production source of truth)

| Collection | Purpose |
| --- | --- |
| `ieltsMicroAssessments` | Live 127-item question bank |
| `ieltsScoringHistory` | Scoring sessions, `gateTrace`, step payloads |
| `ieltsPrompts` | Step 3/4/5 AI prompt templates |
| `ieltsTask2Samples` | Task 2 sample essays and prompts |
| `ieltsApiProviders` | AI provider configuration |
| `ieltsAiTokenUsages` | Token usage audit trail |

### Tier 2 — Repository code and file-based mirrors

| Path | Purpose |
| --- | --- |
| `packages/ielts/MVC/repositories/ielts/index.js` | Mongo/JSON repository routing |
| `packages/ielts/MVC/services/ielts/step3ScoringService.js` | Step 4 grading + band calculation |
| `packages/ielts/MVC/services/ielts/step5FeedbackService.js` | Step 5 feedback generation |
| `packages/ielts/MVC/services/ielts/answerContractUtils.js` | Pass/fail answer contracts |
| `packages/ielts/MVC/services/ielts/scoringRules/` | Deterministic rules per baseKey |
| `data/ielts/microAssessments.json` | JSON mirror (dev/bootstrap/tests; not runtime in mongo mode) |
| `data/ielts/prompts.json` | JSON mirror for prompts |
| `data/ielts/scoring/sessions/*.json` | Legacy session file exports |
| `docs/ielts/tuning-history.json` | Post-import tuning audit log |
| `scripts/ielts/mongo-committee-stats.js` | Live Mongo verification utility (added 2026-09-06) |

### Tier 3 — Historical archives (Dropbox / Downloads)

| File | Purpose |
| --- | --- |
| `Task 2 - Simple Questions.docx` | Original 40-item operational prototype |
| `Task 2 - YN - Rubric.docx` | Intermediate 42-item rubric-language prototype |
| `Steps Guide.docx` | Five-step methodology narrative |
| `V2.0 to V2.1.docx` | Scoring calibration report |
| `V2.1 to V2.2.docx` | Scoring calibration report |
| `V2.2 to V2.3.docx` | Scoring calibration report |
| `B20-T0*-ScoringV2.*.json` | Early longitudinal session exports (pre-Mongo or export copies) |

---

## Appendix C — Prototype to Current Bank Lineage Table

Direct one-to-one mapping is not always possible because the 127-item bank decomposes descriptors into more atomic, band-specific questions. The table below shows **conceptual lineage** where a prototype idea maps to a current `baseKey`.

| Prototype | Prototype idea (abbreviated) | Current baseKey | Current atomic question (abbreviated) | Relationship |
| --- | --- | --- | --- | --- |
| 40-Q6 | Stance sentence present | TR5-3 | Is a position/opinion expressed? | Operationalized as rubric item |
| 40-Q9 | Sub-question body coverage | TR6-1 | Address all parts at least once? | Multi-part task coverage |
| 40-Q12 | Explanation/example after topic | TR5-6 | Main ideas not sufficiently developed? | Inverse fault-check |
| 40-Q15 | At least 2 paragraphs | CC4-5 | Paragraphing absent or confusing? | Inverse structure check |
| 40-Q17 | Connector density abnormal | CC5-3, CC5-5 | Cohesive devices inadequate/overused? | Split into fault checks |
| 40-Q22 | Topic sentence per body para | CC7-4 | Clear central topic per paragraph? | Direct CC operationalization |
| 40-Q25 | TTR threshold | LR5-1, LR6-1 | Vocabulary range limited/adequate? | Moved from metric to rubric judgment |
| 40-Q38–40 | Error-free sentence % | GRA7-2, GRA8-2 | Error-free sentences frequent/majority? | GRA band gates |
| 42-Q4 | Minimally related to topic | TR4-1 | Response minimal/tangential? | Low-band TR fault check |
| 42-Q6 | Position unclear | TR4-2 | Position present but unclear? | Low-band TR fault check |
| 42-Q11 | Clear position throughout | TR7-2 | Position clear throughout? | High-band TR feature |
| 42-Q17 | Cohesive devices inaccurate | CC4-3 | Basic cohesive devices inaccurate? | Low-band CC fault check |
| 42-Q18 | Coherent progression | CC6-1 | Clear overall progression? | Mid-band CC feature |
| 42-Q22 | Central topic per paragraph | CC7-4 | Clear central topic per paragraph? | High-band CC feature |
| 42-Q25 | Basic vocabulary repetitive | LR4-2 | Vocabulary repetitive? | Low-band LR fault check |
| 42-Q32 | Fluent flexible vocabulary | LR8-1 | Vocabulary flexible and precise? | High-band LR feature |
| 42-Q36 | Limited sentence structures | GRA4-1 | Grammatical range very limited? | Low-band GRA fault check |
| 42-Q40 | Complex error-free variety | GRA7-2 | Error-free sentences frequent? | Mid/high GRA feature |

**Note:** Many 40-item operational metrics (connector density thresholds, TTR cutoffs) are now handled in **Step 2 deterministic features** and **scoring rules** rather than as standalone AI-answered questions — another form of evolution toward stability.

---

*End of document*
