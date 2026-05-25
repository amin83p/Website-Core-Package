# PTE AI Provider Package Env Fallback (Step 41)

## Summary

PTE’s package-owned AI provider adapters should resolve secrets and model settings
through package-prefixed environment variables, while keeping existing shared/env fallback
paths for compatibility.

## What Changed

- Added regression coverage to guard package provider boundary defaults:
  - `test/pte-package-ai-provider-env-fallback-step41.test.js`

The test validates that package-owned provider adapters for OpenAI, Anthropic,
Azure OpenAI, Gemini, and Vertex explicitly reference package-scoped variables such as:

- `PTE_OPENAI_*`
- `PTE_ANTHROPIC_*`
- `PTE_AZURE_OPENAI_*`
- `PTE_GEMINI_*`
- `PTE_VERTEX_*`

It also verifies JSON output schema naming in OpenAI/Azure requests is now package-scoped (`pte_response_schema`), not IELTS-specific.

## Why

This step helps keep PTE package modules self-describing and easier to move into a
package-owned deployment path without relying on other domain-specific env naming.

## Acceptance Criteria

- AI provider source files reference package-scoped env vars in their provider-level resolver code.
- Package-owned schema references are not silently tied to IELTS-specific schema naming.
- Regression test is committed and runnable as a unit test.

## Next Step

- Continue package boundary hardening for remaining high-leverage utility/service modules.
