# School Package Pass 27 Model Ownership Batch 1 (2026-06-01)

## Outcome
- Replaced delegated wrappers with package-owned model implementations for:
  - `academicSnapshotModel.js`
  - `holidayModel.js`
  - `payRateModel.js`
  - `schoolAccountModel.js`
  - `schoolIndexModel.js`
  - `sessionStatusModel.js`
  - `staffModel.js`
  - `teacherModel.js`
  - `termModel.js`
  - `timesheetModel.js`
  - `timesheetPeriodModel.js`
  - `studentProgramRegistrationModel.js`
  - `studentTermRegistrationModel.js`
  - `studentProgramPriorSubjectModel.js`
  - `transactionJournalModel.js`
  - `withdrawalModel.js`

## Notes
- Shared framework utilities are bridged via `requireCoreModule(...)`.
- Added `resolveCoreRoot()` in `schoolCoreModuleResolver` so package-owned models resolve app-level `data/school/*` safely in both source and installed package locations.
- Remaining School models stay as wrappers for later passes.
