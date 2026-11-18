# School AI Assist

School AI Assist is a dedicated navigator (not School Settings) for org-wide AI configuration and audit.

## Subsections

| Route | Section constant | Purpose |
|-------|------------------|---------|
| `/school/ai-assist/providers` | `SCHOOL_AI_PROVIDER_KEYS` | API keys, vendor, models[], banned users |
| `/school/ai-assist/service-assignments` | `SCHOOL_AI_SERVICE_ASSIGNMENTS` | One provider + model per registered service |
| `/school/ai-assist/token-usage` | `SCHOOL_AI_TOKEN_USAGE` | Append-only usage ledger (Consumed Tokens) |
| `/school/ai-assist/token-usage/limits` | `SCHOOL_AI_USAGE_LIMITS` | Per-user token/request limits (list + form CRUD) |

## Service registry (code)

Registered keys live in `packages/school/MVC/config/schoolAiServiceRegistry.js`.

- `school.report_review` — Report Review Service (`planned`)

## Developer API

```javascript
const schoolAiRuntimeService = require('../services/school/schoolAiRuntimeService');
const schoolAiProviderInvokeService = require('../services/school/schoolAiProviderInvokeService');

const binding = await schoolAiRuntimeService.resolveForService({
  serviceKey: 'school.report_review',
  requestingUser: req.user
});

const result = await schoolAiProviderInvokeService.sendTextPrompt({
  binding,
  prompt: 'Summarize this report...',
  requestingUser: req.user
});
```

`resolveForService` enforces:

1. Active usage limits for the user (`schoolAiUserUsageLimits` + `schoolAiTokenUsage` rollups).
2. `bannedUserIds` on the selected provider key.
3. Service assignment, with fallback to org default provider + first active model when missing.

Every `sendTextPrompt` writes a `schoolAiTokenUsage` row (success or failed).

## Data entities

| Entity key | Collection |
|------------|------------|
| `schoolAiProviders` | `schoolAiProviders` |
| `schoolAiServiceAssignments` | `schoolAiServiceAssignments` |
| `schoolAiTokenUsage` | `schoolAiTokenUsage` |
| `schoolAiUserUsageLimits` | `schoolAiUserUsageLimits` |

## UI pattern

List pages follow `packages/school/docs/list-page-development-guide.md` (providers + token usage). Service assignments use the same page shell with a registry-driven matrix.