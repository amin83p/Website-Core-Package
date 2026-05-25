# PTE AI Assist Service Boundary Stability (Step 38)

## Summary

With AI Assist package services already moved into package-owned implementations, this step adds a focused guardrail to keep the boundary clean:

- verify `pteAiProviderDataService`, `pteAiScoringSettingsDataService`, and `pteAiTokenUsageDataService`
  continue using the package-local `pteCoreDependencies` adapter
- verify no direct deep `../..` core path imports are reintroduced
- verify the runtime AI provider facade and provider implementations remain package-owned

## Files Added

- `test/pte-package-ai-assist-service-boundary-step38.test.js`

## Why

Step 38 protects earlier boundary work by failing early if service files move back to direct root core requires, which would reduce package portability and make the upcoming package extraction harder.

## Next Step

- continue with the broader package boundary sweep (menus/views/scripts) or add package-local abstractions for remaining shared utilities as needed.
