# IELTS Research Commit Prompt Template

Use this prompt with an LLM to create commit messages that are committee-ready and reproducible.

## Prompt
You are a senior research engineer supporting an EdD dissertation audit trail.

Goal:
Produce a commit message and a structured change-log entry for IELTS scoring pipeline development.
The output must help a dissertation committee understand:
1) what changed,
2) why it changed,
3) which files were affected,
4) what impact is expected on scoring reliability/validity/traceability.

Rules:
- Be precise and factual.
- Do not invent files or tests.
- If reason is uncertain, state a short assumption.
- Keep commit subject <= 72 characters.
- Use imperative mood in commit subject.
- Return valid JSON only (no markdown, no backticks, no commentary).

Required JSON schema:
{
  "tweak_id": "TWEAK-###",
  "commit_type": "feat|fix|refactor|chore|docs|test",
  "scope": "ielts",
  "short_summary": "One sentence summary",
  "reason_for_change": "Why this tweak was needed",
  "files_changed": ["path/a", "path/b"],
  "validation_done": ["what was checked"],
  "dissertation_impact": "How this affects reliability/traceability/validity",
  "commit_subject": "type(scope): short subject",
  "commit_body": "Bullet-style body with What/Why/Impact"
}

Output constraints:
- `files_changed` must only contain paths present in provided git context.
- `commit_subject` must match the described changes.
- `commit_body` should include:
  - What changed
  - Why
  - Dissertation relevance

Input context will be appended below this template:
- Research context
- Git status
- Changed files
- Diff stats

## Runtime Context
- UTC now: 2026-03-17T01:44:50Z
- Git branch: master
- Git HEAD: 84f4f90

## Research Context
feat(IELTS): 
add IELTS tuning workflows, comparison dashboards, and harden credit/customer integrity

Introduce Step 3 and Step 4 tuning modes for IELTS scoring with model selection, run controls, and live (non-cached) model execution paths. Add dedicated Step 3/Step 4 compare pages, type-aware history filtering/routing, mixed-type comparison guards, and richer comparison analytics including cross-sample consistency insights. Refine tuning/full pipeline UI behavior and history interactions, including improved selection and shared table-partial alignment.

Also improve chat participant avatars by resolving person-level avatar fallbacks, add org-aware fields/defaults in IELTS prompt/interaction/micro-assessment models, and fix two credit customer integrity bugs by deriving org membership primary role consistently and preventing personId tampering on customer updates.

## Git Status (short)
M MVC/controllers/ielts/ieltsController.js
 D MVC/models/ielts/aiInteractionModel.js
 M MVC/models/queryExecutorBootstrap.js
 M MVC/repositories/ielts/index.js
 M MVC/routes/ielts/ieltsRoutes.js
 M MVC/services/ielts/ieltsDataService.js
 D MVC/views/ielts/aiAgent.ejs
 D MVC/views/ielts/aiExam.ejs
 M MVC/views/ielts/dashboard.ejs
 D MVC/views/ielts/interactionList.ejs
 M data/logs.json
 M data/sessions.json
 M docs/architecture-data-flow.md
 M scripts/backfillIeltsOrgId.js

## Changed Files (unstaged, name-status)
M	MVC/controllers/ielts/ieltsController.js
D	MVC/models/ielts/aiInteractionModel.js
M	MVC/models/queryExecutorBootstrap.js
M	MVC/repositories/ielts/index.js
M	MVC/routes/ielts/ieltsRoutes.js
M	MVC/services/ielts/ieltsDataService.js
D	MVC/views/ielts/aiAgent.ejs
D	MVC/views/ielts/aiExam.ejs
M	MVC/views/ielts/dashboard.ejs
D	MVC/views/ielts/interactionList.ejs
M	data/logs.json
M	data/sessions.json
M	docs/architecture-data-flow.md
M	scripts/backfillIeltsOrgId.js

## Changed Files (staged, name-status)
(no staged file changes)

## Diff Stat (unstaged)
MVC/controllers/ielts/ieltsController.js | 4143 ++++++++++++++----------------
 MVC/models/ielts/aiInteractionModel.js   |   73 -
 MVC/models/queryExecutorBootstrap.js     |  583 +++--
 MVC/repositories/ielts/index.js          |  418 ++-
 MVC/routes/ielts/ieltsRoutes.js          |  272 +-
 MVC/services/ielts/ieltsDataService.js   |  313 ++-
 MVC/views/ielts/aiAgent.ejs              |  446 ----
 MVC/views/ielts/aiExam.ejs               |  582 -----
 MVC/views/ielts/dashboard.ejs            |  348 ++-
 MVC/views/ielts/interactionList.ejs      |  172 --
 data/logs.json                           |  792 ++++++
 data/sessions.json                       |   46 +-
 docs/architecture-data-flow.md           |  327 ++-
 scripts/backfillIeltsOrgId.js            |  215 +-
 14 files changed, 3968 insertions(+), 4762 deletions(-)

## Diff Stat (staged)
(no staged diff stat)

