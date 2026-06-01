# School Package Pass 2 Route Layer (2026-06-01)

## Outcome
- Added package-owned School route tree in `packages/school/MVC/routes`.
- `schoolMainRoute` now mirrors the core School mount map.
- Added route wrapper modules that resolve current core School routes through `schoolCoreContracts.requireCoreModule(...)`.

## Notes
- Behavior is intentionally preserved via wrapper delegation in this pass.
- Controller/service/model extraction is deferred to later passes.
- Core `/school` mount is still active; package route tree is now ready for controlled cutover.
