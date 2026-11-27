# School AI Assist

School AI Assist is a dedicated navigator (not School Settings) for org-wide AI configuration and audit.

## Subsections

| Route | Section constant | Purpose |
|-------|------------------|---------|
| `/school/ai-assist/providers` | `SCHOOL_AI_PROVIDER_KEYS` | API keys, vendor, models[], banned users |
| `/school/ai-assist/service-assignments` | `SCHOOL_AI_SERVICE_ASSIGNMENTS` | One provider + model per registered service |
| `/school/ai-assist/service-definitions` | `SCHOOL_AI_SERVICE_DEFINITIONS` | Inputs, prompts, and output mode per registered service |
| `/school/ai-assist/token-usage` | `SCHOOL_AI_TOKEN_USAGE` | Append-only usage ledger (Consumed Tokens) |
| `/school/ai-assist/token-usage/limits` | `SCHOOL_AI_USAGE_LIMITS` | Per-user token/request limits (list + form CRUD) |

## Service registry (code)

Registered keys live in `packages/school/MVC/config/schoolAiServiceRegistry.js`.

- `school.report_review` — Report Review Service (`planned`)
- `school.bimpr_goals_checker` — Bi-MPR Goals Checker (`implemented`; default preset JSON below)
- `school.word_of_day_autofill` — Word of the Day Autofill (`implemented`; vocabulary form AI fill)

## Report template bindings

On **Reports → Templates**, the **AI services** section lets designers attach multiple registry services to a template. Each definition input binds to a report field, DOCX prefill key, static text, or empty (filled on the instance).

At **report instance edit**, active bindings resolve against merged instance/prefill data. **Report Instance V2** exposes a single **AI Assist** button (modal + persistent results tray) backed by report-scoped APIs that do not require School AI Assist admin **READ_ALL**. The legacy (non-V2) editor still embeds one `schoolAiServiceRunner` per service when the user can access School AI Assist admin.

On **Fill Reports** (matrix), the same **AI Assist** control appears once at the matrix level when every active binding uses only **shared** report fields (or non-field sources). If any binding maps an input to a **private** (per-student) field, matrix AI Assist is hidden; teachers run those services from **Report Instance V2** for the relevant student.

### JSON output and `x-reportUi` (report AI Assist UI)

When a service definition uses **output mode JSON**, the report AI Assist catalog includes `outputMode` and `reportUi` derived from the definition’s `output.jsonSchema`.

Add a root **`x-reportUi`** object on the JSON schema (not sent to the model):

- `layout`: `"sections"` — render one card per `sections[]` entry instead of a single JSON block.
- Each section: `resultKey` (key in model JSON), `title`, `actions` (`copy`, `apply`), `inputId` (AI service input to update on **Apply**).
- Optional per section: `valueField`, `changeTypeField`, `changeSummaryField` when the model returns an object (e.g. `revised` + `changeType` + `changeSummary`) so cards show **No change / Minor edit / Updated / Replaced** and a short “what changed” line before **Apply**.

**Apply** writes the section text into the modal input and, when the template binding for that input uses `source: field`, into the matching report field on the instance or matrix (`.js-report-field` / matrix row fields).

### JSON output fields catalog (`outputs[]`)

When **output mode** is JSON, each service definition stores **`outputs[]`** (like `inputs[]`): `resultKey`, label, type, required, object subfields (`valueField`, …), and `status` (`active` | `schema_missing`). The JSON schema still defines the model contract; the catalog drives admin UI, validation, and report bindings.

On **Service definitions → Edit** (JSON mode):

- **Output fields** table lists catalog rows.
- **Sync from JSON schema** / **Check sync** opens a modal: new keys, stale keys (never auto-deleted), and type/required updates. Stable `resultKey` values preserve report template links.

**Report templates → AI services**: bind each **output** to a template field (`outputBindings`). At runtime, Report AI Assist Apply uses those bindings (with legacy `x-reportUi` / input binding fallback when `outputs[]` is empty).

### JSON output and `x-formUi` (form autofill)

When a service fills a school form from structured JSON (today: **Word of the Day**), the output catalog is built from `output.jsonSchema.properties` merged with root **`x-formUi`** on the schema (stripped before the model prompt, same as `x-reportUi`).

- `fields[]`: `resultKey` (JSON key), `label`, `widget` (`text`, `textarea`, `stringList`, `radioGroup`, `checkboxGroup`, …).
- Optional `enumSource` (e.g. `difficulty`, `wordTypes`) for server-side sanitizers; optional `minItems` / `maxItems` for lists.

Feature code maps outputs to DOM targets via **form binding profiles** (`packages/school/MVC/config/schoolAiFormBindingProfiles.js`): each profile has `consumerKey`, `serviceKey`, and `outputBindings[]` (`resultKey`, `target: dom|hook`, `selector` or `hook`).

WoD flow: `schoolAiOutputBindingService.mapAiResultToFormValues` normalizes the model JSON using the catalog + profile; `POST /school/word-of-day/api/ai-autofill` returns `{ fields }`; the form applies values with `schoolAiFormAutofill.js` and the WoD binding profile.

To add a new output field: extend the schema property, add a `x-formUi.fields` row, add a binding row (and sanitizer if needed), then re-sync the preset to Mongo when using the sync script.

### Preset JSON files (defaults + copy source)

When no org row exists in `schoolAiServiceDefinitions`, the app loads defaults from disk:

| Service key | Preset file |
|-------------|-------------|
| `school.bimpr_goals_checker` | `packages/school/MVC/config/schoolAiServiceDefinitionPresets/school.bimpr_goals_checker.json` |
| `school.word_of_day_autofill` | `packages/school/MVC/config/schoolAiServiceDefinitionPresets/school.word_of_day_autofill.json` |

To configure the live service in the UI (no hardcoded JS):

1. Open **AI Assist → Service definitions → Edit** for the service key.
2. Set **Output mode** to **JSON**.
3. Copy **`output.jsonInstructions`** from the preset JSON into **JSON instructions**.
4. Copy the entire **`output.jsonSchema`** object (including **`x-reportUi`**) into **JSON schema**.
5. Copy **`inputs`** and **`prompt`** fields from the same file into the form (inputs table + prompt textareas), or align your org row with the file and **Save**.

At runtime, report AI Assist reads **`output.jsonSchema`** (and `x-reportUi`) from the **saved org definition** (`schoolAiServiceDefinitions` entity). With **`DATA_BACKEND=mongo`**, that is the MongoDB collection **`schoolAiServiceDefinitions`**; with JSON backend, the file is `data/school/schoolAiServiceDefinitions.json`. The preset file is only used until an org-specific row exists.

To push a preset into Mongo after editing the JSON file:

`node packages/school/scripts/maintenance/sync-bimpr-ai-service-definition.js`

Word of the Day autofill (Mongo only — does not update `data/school/schoolAiServiceDefinitions.json`):

`node packages/school/scripts/maintenance/sync-word-of-day-ai-service-definition.js`

The **`school.bimpr_goals_checker`** preset uses JSON with goals `goal_1`–`goal_4` and optional `notes`. Orgs with an older **markdown** saved definition should re-save using JSON mode and the schema from the preset file.

The **`school.word_of_day_autofill`** preset returns `pronunciation`, a multi-sentence practical `meaning`, three everyday `examples` (full sentences, not one-liners), `difficulty` (`easy` \| `medium` \| `hard`), and `wordTypes` aligned with the Word of the Day form. Teachers invoke it from **Word of the Day → New/Edit → Generate with AI** (`POST /school/word-of-day/api/ai-autofill`) only when they have an **active usage limit** row for **Word of the Day Autofill** or **All services** with remaining quota (**AI Assist → Usage Limits**). Assign **Gemini 2.5 Flash** (or Pro) under **Service assignments**. After editing the preset JSON, re-run the WoD sync script so Mongo matches disk (or paste prompts in **Service definitions → Edit**).

```http
POST /school/reports/ai-assist/prepare
POST /school/reports/ai-assist/run
POST /school/reports/ai-assist/history
```

Body includes `context` (`matrix` | `instance`), `bindingRowId`, optional `inputs`, and identity: `instanceId` for V2, or `assignmentId` + `assignmentRowId` + `teacherId` for Fill Reports. Optional `answersOverride` / `sharedAnswersOverride` / `commonAnswersOverride` apply unsaved DOM values at run time. JSON runs return `result.data` (parsed object) plus `displayText`.

Each report run is recorded on `SCHOOL_AI_TOKEN_USAGE` with `usageSource: report_ai_assist`, full `inputPayload` (`resolved` merged field values plus `coerced` values sent to the model) / `outputPayload`, and report scope ids. The Instance V2 and Fill Reports AI Assist tray loads all runs for the current report scope via `POST /school/reports/ai-assist/history` (newest first; only the latest run is expanded by default). Each tray card shows run time and who ran the assist (`ranByLabel`). Optional `bindingRowId` filters to one binding. Run responses include `usageRecordId`.

## Developer API

Preferred path: load the org definition, then call the execution service (resolves provider/model, builds prompts, shapes output).

```javascript
const schoolAiServiceExecutionService = require('../services/school/schoolAiServiceExecutionService');

const result = await schoolAiServiceExecutionService.run({
  serviceKey: 'school.report_review',
  inputs: { report_text: '...merged report fields...' },
  requestingUser: req.user,
  accessContext: { scopeId: req.accessScope }
});
// result: { ok, displayText, data?, rawText, traceId, mode, serviceKey, modelId }
```

HTTP from feature UIs:

```http
POST /school/ai-assist/services/:serviceKey/run
Content-Type: application/json

{ "inputs": { "report_text": "..." } }
```

Embed the runner partial from a controller:

```javascript
const { prepareServiceRunnerContext } = require('../controllers/school/schoolAiAssistController');

const aiServiceRunner = await prepareServiceRunnerContext('school.report_review', req, {
  inputSource: mergedReportFields
});
// Pass aiServiceRunner to EJS: include school/aiAssist/partials/schoolAiServiceRunner
```

Lower-level invoke (when you already have a final prompt string):

```javascript
const schoolAiRuntimeService = require('../services/school/schoolAiRuntimeService');
const schoolAiProviderInvokeService = require('../services/school/schoolAiProviderInvokeService');

const binding = await schoolAiRuntimeService.resolveForService({
  serviceKey: 'school.report_review',
  requestingUser: req.user
});

const llm = await schoolAiProviderInvokeService.sendTextPrompt({
  binding,
  prompt: userPrompt,
  systemPrompt,
  requestingUser: req.user
});
```

`resolveForService` enforces:

1. Active usage limits for the user (`schoolAiUserUsageLimits` + `schoolAiTokenUsage` rollups).
2. `bannedUserIds` on the selected provider key.
3. Service assignment, with fallback to org default provider + first active model when missing.

Every `sendTextPrompt` writes a `schoolAiTokenUsage` row (success or failed).

## Google Gemini (API key provider)

School AI Assist uses **`@google/genai`** (not the deprecated `@google/generative-ai`) for the **`google-gemini`** provider in `packages/school/MVC/services/school/ai/providers/googleGeminiService.js`. Requests use the stable Gemini API **v1** surface; the client enables built-in exponential backoff retries on **408, 429, and 5xx** (including **503** high-demand responses). Other packages (IELTS, PTE, Benchpath) may still use the legacy SDK until migrated.

## Data entities

| Entity key | Collection |
|------------|------------|
| `schoolAiProviders` | `schoolAiProviders` |
| `schoolAiServiceAssignments` | `schoolAiServiceAssignments` |
| `schoolAiServiceDefinitions` | `schoolAiServiceDefinitions` |
| `schoolAiTokenUsage` | `schoolAiTokenUsage` |
| `schoolAiUserUsageLimits` | `schoolAiUserUsageLimits` |

## UI pattern

List pages follow `packages/school/docs/list-page-development-guide.md` (providers + token usage). Service assignments use the same page shell with a registry-driven matrix.