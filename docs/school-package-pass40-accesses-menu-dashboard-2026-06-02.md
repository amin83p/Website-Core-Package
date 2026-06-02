# School Package Pass 40: Access + Menu/Dashboard Follow-up (2026-06-02)

## Goal
Close the manifest gap left after initial seeding by completing the School package access surface and top-level menu/dashboard wiring in a PTE-aligned follow-up pass.

## Actions completed
- Added missing permission grants to the existing SCHOOL access profiles where route checks require them but profile entries were incomplete.
  - Added `OP1004` to:
    - `SCHOOL_CLASS_ENROLLMENT_PERIODS`
    - `SCHOOL_HOLIDAYS`
  - Added `OP1005` to:
    - `SCHOOL_PROGRAM_REGISTRATIONS`
    - `SCHOOL_SESSION_STATUSES`
  - Added `OP1023` to:
    - `SCHOOL_STUDENTS`
- Added top-level school menu entries for:
  - Teachers (`/school/teachers`)
  - Staff (`/school/staff`)
- Added dashboard entries for:
  - Teachers (`/school/teachers`)
  - Staff (`/school/staff`)

## Notes
- This pass keeps previous route-mounted runtime and role/section/symbol seeding intact.
- Access updates are additive and follow `SCP_OWNER` scope to preserve behavior while aligning with route-level checks.
