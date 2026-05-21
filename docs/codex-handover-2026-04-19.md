# Codex Handover Report (2026-04-19)

## Snapshot
- Branch: `master`
- Base commit (HEAD): `89d2dcf`
- Workspace has **uncommitted** and **untracked** changes.

## What Is Implemented

### 1) PTE Questions Bank foundation (under `PTE`, not `PTE_PEOPLE`)
- Access constants include:
  - `SECTIONS.PTE`
  - `SECTIONS.PTE_QUESTIONS_BANK`
  - File: `config/accessConstants.js`
- PTE router mounts Questions Bank:
  - `router.use('/questions-bank', require('./questionBankRoutes'));`
  - File: `MVC/routes/pte/pteMainRoute.js`
- New section seed and repair script (links child to `PTE`, removes from `PTE_PEOPLE` if present):
  - `scripts/seed-pte-questions-bank-section.js`
- New symbol seed:
  - `scripts/seed-pte-questions-bank-symbols.js`

### 2) PTE Questions Bank backend
- New files:
  - `MVC/models/pte/pteQuestionVersionModel.js`
  - `MVC/repositories/pteQuestionVersionRepository.js`
  - `MVC/services/pte/pteQuestionBankDataService.js`
  - `MVC/services/pte/questionTypeRegistry.js` (20 question types + validation rules/metadata)
  - `MVC/controllers/pte/questionBankController.js`
  - `MVC/routes/pte/questionBankRoutes.js`
  - `data/pteQuestionVersions.json`
- Core capabilities currently wired:
  - list/new/edit/save
  - validate draft
  - publish/revise/retire/archive/duplicate-family/delete
  - exam preview routes:
    - `GET /pte/questions-bank/preview/exam/:id`
    - `POST /pte/questions-bank/preview/exam`
  - media upload and download routes
  - org media library endpoint:
    - `GET /pte/questions-bank/media/library`

### 3) PTE Questions Bank frontend
- New views:
  - `MVC/views/pte/questionsBank/questionBankList.ejs`
  - `MVC/views/pte/questionsBank/questionBankForm.ejs`
  - `MVC/views/pte/questionsBank/questionBankExamPreview.ejs`
- Implemented UX updates:
  - Student Preview button
  - Exam Fullscreen button (dedicated route)
  - Preview shown in modal
  - Saved Media Library modal
  - Modal fallback mode works even without Bootstrap modal runtime (`window.bootstrap.Modal` missing)
  - Saved media info text now shows active org path:
    - `uploads/ORG_<activeOrgId>/pte-question-bank`
  - Saved media modal refresh button moved right and restyled.

### 4) PTE Students attachment storage path update
- Requirement implemented: student media now stores in org + student/item folder:
  - `uploads/ORG_<activeOrgId>/pte-students/<studentId_or_itemId>`
- Changes:
  - `MVC/middleware/upload.js`
    - added `fixedCategory === 'pte-students'` dynamic folder logic
  - `MVC/routes/pte/studentRoutes.js`
    - changed to `upload('pte-students', true)`
  - `MVC/controllers/pte/studentController.js`
    - generates `mediaItemId` for new form sessions
  - `MVC/views/pte/students/studentForm.ejs`
    - hidden field `mediaItemId`

### 5) Membership form edit bug + source type support
- Fixed bug where periods showed in list but not in edit form:
  - controller now falls back from `membershipItem.periods` to `membershipItem.summary.periods`
  - view does same fallback
- Added/validated source type support including `Activity Quota Package`.
- Files:
  - `MVC/controllers/userMembershipController.js`
  - `MVC/views/membership/membershipForm.ejs`

## Files With Current Local Changes
- Modified:
  - `MVC/controllers/pte/studentController.js`
  - `MVC/controllers/userMembershipController.js`
  - `MVC/infrastructure/mongo/mongoIndexManager.js`
  - `MVC/middleware/upload.js`
  - `MVC/routes/pte/pteMainRoute.js`
  - `MVC/routes/pte/studentRoutes.js`
  - `MVC/services/ielts/ai/providers/googleVertexService.js`
  - `MVC/services/ielts/aiService.js`
  - `MVC/services/ielts/scoringRules.js`
  - `MVC/views/ielts/scoringV0326.ejs`
  - `MVC/views/membership/membershipForm.ejs`
  - `MVC/views/pte/students/studentForm.ejs`
  - `config/accessConstants.js`
  - `docs/ielts/tuning-history.json`
  - `package.json`
  - `scripts/seed-pte-students-section.js`
  - `scripts/seed-pte-symbols.js`
  - `test/ielts.stability-accuracy.step6r.test.js`
- Deleted:
  - `uploads/ORG_900000/pte-students/20250105_125816_1776629466202.jpg`
- Untracked:
  - `MVC/controllers/pte/questionBankController.js`
  - `MVC/models/pte/pteQuestionVersionModel.js`
  - `MVC/repositories/pteQuestionVersionRepository.js`
  - `MVC/routes/pte/questionBankRoutes.js`
  - `MVC/services/pte/pteQuestionBankDataService.js`
  - `MVC/services/pte/questionTypeRegistry.js`
  - `MVC/views/pte/questionsBank/*`
  - `data/pteQuestionVersions.json`
  - `scripts/seed-pte-questions-bank-section.js`
  - `scripts/seed-pte-questions-bank-symbols.js`

## Important Notes
- There are unrelated IELTS files already modified in this workspace.
- Do **not** revert unrelated changes.
- The deleted upload file may be intentional test cleanup or accidental; confirm before commit.
- In this environment, `node --check ...` failed with sandbox `EPERM` on `C:\Users\KATANA`, so local syntax verification is still needed at office.

## Resume Checklist (Tomorrow)
1. Run seeds for section/symbols:
   - `node scripts/seed-pte-questions-bank-section.js`
   - `node scripts/seed-pte-questions-bank-symbols.js`
2. Verify navigation:
   - `PTE_QUESTIONS_BANK` appears under `PTE` dashboard.
   - It is not under `PTE_PEOPLE`.
3. Verify PTE Questions Bank form:
   - modal preview works
   - exam fullscreen works
   - saved media library opens and loads
   - path label shows active org correctly
4. Verify PTE Students upload path:
   - upload document on new applicant and edit applicant
   - check physical path includes `/pte-students/<studentId_or_itemId>`
   - download/delete still works
5. Verify membership edit page:
   - records with existing periods load in edit form correctly
   - source type dropdown includes `Activity Quota Package`
6. Run your usual smoke tests in office environment.

## Paste-Ready Prompt For Tomorrow Codex Session
```text
Continue from docs/codex-handover-2026-04-19.md.

Constraints:
- Keep IELTS domain untouched unless explicitly requested.
- Do not revert unrelated local changes.
- Keep PTE Questions Bank under PTE (not PTE_PEOPLE).

First:
1) Inspect git status and summarize only PTE + membership related diffs.
2) Run/verify seeds:
   - node scripts/seed-pte-questions-bank-section.js
   - node scripts/seed-pte-questions-bank-symbols.js
3) Verify routes/views for:
   - /pte/questions-bank
   - /pte/questions-bank/new
   - /pte/questions-bank/edit/:id
   - /pte/questions-bank/preview/exam/:id
   - /pte/questions-bank/media/library

Then fix any remaining bugs found during verification, with priority:
1) PTE Questions Bank UI/preview/media workflows.
2) PTE Students document path and attachment actions.
3) Membership periods edit rendering and source-type validation.

At the end, provide:
- files changed
- test steps run
- remaining risks/TODOs
```

