# Request Rate Monitor: Operations, Setup, Management, and Troubleshooting

## 1. Purpose and Scope
This document explains how the request-rate monitor works in this project, how to configure it safely, how to operate it in production, and how to troubleshoot common problems.

The feature is implemented as middleware using `express-rate-limit` and supports:
- group-based limits (`auth`, `heavy`, `write`, `picker`, `global`)
- route-specific limits from website policy and organization policy
- monitor mode and enforce mode with phased rollout

## 2. Where It Lives
Core implementation and integration points:
- `app.js`
- `MVC/middleware/requestRateMonitor.js`
- `MVC/utils/requestRateRouteCatalog.js`
- `MVC/controllers/websitePolicyController.js`
- `MVC/models/websitePolicyModel.js`
- `MVC/controllers/orgPolicyController.js`
- `MVC/views/admin/websitePolicy.ejs`
- `MVC/views/orgPolicy/PolicyForm.ejs`
- `data/websitePolicy.json`
- `data/orgPolicies.json`
- `data/logs.json`

## 3. Middleware Order and Runtime Dependencies
The middleware chain order in `app.js` is critical:
1. `softAuth` populates `req.user` if a token exists.
2. `siteStateMiddleware` attaches `req.websitePolicy`.
3. `requestRatePhaseOne` evaluates request-rate limits.

Why this matters:
- request-rate config needs `req.websitePolicy.requestControl`
- org-level overrides need `req.user.activeOrgPolicy.requestControl`

## 4. High-Level Flow
For each incoming request, the monitor does this:
1. Build effective config (`getConfig(req)`) by merging website policy and valid org custom routes.
2. Run route-specific limiter first (`routeSpecificLimiter`).
3. If route-specific limiter did not handle the request, run group limiters in this order:
   - `auth`
   - `heavy`
   - `write`
   - `picker`
   - `global`
4. On limit breach, always log a `DENIED` event (`operationId: OP9003`).
5. Block with HTTP 429 only when effective enforcement is true.

## 5. Configuration Model

### 5.1 Website Policy (`data/websitePolicy.json`)
`requestControl` has these main fields:
- `enabled`: global switch for monitor
- `mode`: `monitor` or `enforce`
- `logCooldownMs`: suppress duplicate DENIED logs per key
- `excludePaths`: paths never rate-limited (prefix-aware)
- `phase2.enabled`: selective enforcement switch by group
- `phase2.enforceGroups`: groups enforced during phase 2
- `phase3.enabled`: route-specific matching (catalog + overrides)
- `routeCatalog`: predefined route map controls
- `routeOverrides`: custom route-specific rules
- `groups`: per-group `windowMs`, `max`, `keyMode`

### 5.2 Organization Policy (`data/orgPolicies.json`)
Org request control uses:
- `requestControl.customRoutes`: org-level route rules

Rules:
- Org custom routes are normalized and merged with website route overrides.
- If an org route overlaps a website rule (same/overlapping path + overlapping method), org route is ignored.
- Website rules remain authoritative.

Important behavior currently implemented:
- Even if website `phase3.enabled` is `false`, active org custom routes keep route-specific evaluation on for that request context.

## 6. Groups and Classification
If no specific route setting is applied, request is classified as one group:
- `auth`: login/captcha routes
- `heavy`: import/export/generate/download/sample-data patterns
- `write`: HTTP `POST|PUT|PATCH|DELETE`
- `picker`: GET + query `q` + picker/search/API heuristics
- `global`: fallback
- `excluded`: `OPTIONS` and paths in `excludePaths`

## 7. Route-Specific Matching

### 7.1 Sources
- Route catalog (`MVC/utils/requestRateRouteCatalog.js`)
- Website route overrides (`requestControl.routeOverrides`)
- Org custom routes (`activeOrgPolicy.requestControl.customRoutes`)

### 7.2 Match Inputs
- `method`: `*|GET|POST|PUT|PATCH|DELETE`
- `matchType`: `exact|prefix|contains`
- `path`
- active window: `startAt` / `endAt`
- `enabled`

### 7.3 Priority
When multiple rules match:
1. higher `priority` value
2. `exact` over `prefix` over `contains`
3. longer path wins

### 7.4 Effective Group
Group resolution order:
1. matched override `group` (if set)
2. matched route catalog group
3. classification fallback

## 8. Enforcement Logic (Monitor vs Block)

### 8.1 Group enforcement
`shouldEnforceForGroup(cfg, groupName)` returns true if:
- site mode is `enforce`, or
- phase2 is enabled and group is listed in `phase2.enforceGroups`

### 8.2 Route-specific enforcement
`mode` on route setting:
- `enforce`: always block on breach
- `monitor`: never block (log only)
- `inherit`: use group enforcement result

### 8.3 Why You Might See DENIED But No 429
If logs show:
- `status: DENIED`
- `monitorOnly: true`
then the limiter was exceeded but intentionally not blocked.

Typical reasons:
- website `mode` is `monitor`
- route `mode` is `inherit`
- group not included in phase2 enforcement
- route forced to `monitor`

## 9. Keying Strategy (`keyMode`)
Supported values:
- `ip`: by client IP only
- `user_or_ip`: by authenticated user id, fallback to IP
- `username_ip`: by username + IP (login abuse protection)

Use guidance:
- `auth`: prefer `username_ip`
- authenticated app routes: `user_or_ip`
- public API endpoints: usually `ip`

## 10. Logging and Observability

Rate-limit events are written through `logger._push(...)` with:
- `sectionId: "000000"`
- `operationId: "OP9003"`
- `status: "DENIED"`

Useful `details` fields:
- `monitorOnly`
- `enforceByGroup`
- `routeSpecific`
- `routeSpecificSource` (`catalog` or `override`)
- `routeId`, `routeLabel`
- `specificMode`
- `policyScope` (`website` or `website+org_custom_routes`)
- `rateLimitGroup`
- `path`, `method`, `key`
- `limit`, `used`, `remaining`, `resetTime`

## 11. Setup and Rollout Procedure

### Step 1: Baseline in monitor mode
In website policy:
- `requestControl.enabled = true`
- `requestControl.mode = "monitor"`
- `phase2.enabled = false`
- set conservative group limits

Observe logs for at least one full traffic cycle.

### Step 2: Selective enforcement (phase2)
- set `phase2.enabled = true`
- set `phase2.enforceGroups` (start with `auth`, `heavy`)

Keep other groups monitor-only while tuning thresholds.

### Step 3: Route-level controls (phase3)
- set `phase3.enabled = true`
- tune route catalog settings and route overrides
- use route `mode = "enforce"` only on validated hot spots

### Step 4: Full enforce (optional)
- set site `mode = "enforce"` once stable
- keep explicit `monitor` for routes you still want observe-only

## 12. How to Manage It

### 12.1 Via UI
- Website: `/websitePolicy` -> Request Control section
- Organization: `/organizationPolicies` -> policy form -> Request Control tab

### 12.2 Via JSON (direct)
Files:
- `data/websitePolicy.json`
- `data/orgPolicies.json`

After direct edits:
1. verify JSON validity
2. restart server if needed by runtime environment
3. confirm with real request tests and logs

## 13. Working Configuration Examples

### 13.1 Enforce login abuse quickly
Set website:
- `mode: "monitor"`
- `phase2.enabled: true`
- `phase2.enforceGroups: ["auth"]`
- `groups.auth.max: 10`

Result:
- only auth group blocks; others still monitor.

### 13.2 Route hard-block regardless of global mode
Add override:
```json
{
  "id": "ROV_login_api",
  "enabled": true,
  "method": "POST",
  "matchType": "exact",
  "path": "/api/login",
  "windowMs": 60000,
  "max": 5,
  "keyMode": "ip",
  "mode": "enforce",
  "group": "auth",
  "priority": 100
}
```

Result:
- route blocks after threshold even if site mode stays monitor.

### 13.3 Org-specific throttle
In org policy `customRoutes`, add route with `mode: "enforce"` and low `max`.
If no website conflict exists, it will apply to users in that org context.

## 14. Troubleshooting Playbook

### Symptom A: "Fast refresh does nothing"
Checks:
1. inspect logs (`OP9003`) for your path
2. if logs exist with `monitorOnly: true`, enforcement is off
3. confirm route `mode` is not `inherit` under monitor-only group
4. set route `mode: "enforce"` or enable phase2 for that group

### Symptom B: "Requests are not considered at all"
Checks:
1. `requestControl.enabled` must be true
2. path not in `excludePaths`
3. method/path/matchType actually match request
4. route is `enabled: true`
5. schedule window valid (`startAt/endAt`)
6. if org route overlaps website rule, org rule is dropped

### Symptom C: "Org route not taking effect"
Checks:
1. user has active org context (`req.user.activeOrgId`)
2. org policy loaded into `req.user.activeOrgPolicy`
3. org custom route has no conflict with website rules
4. route path is normalized and starts with `/`

### Symptom D: "Getting 429 on API unexpectedly"
Checks:
1. identify `rateLimitGroup` and `routeId` from logs
2. verify matched override priority
3. confirm `keyMode` (shared NAT IP can amplify `ip` mode)
4. increase `max` or move to `monitor`

### Symptom E: "Too many logs"
Checks:
1. increase `logCooldownMs`
2. remove duplicated overlapping overrides
3. keep only one high-priority winner per path family

## 15. Validation Checklist After Any Change
1. syntax check files changed
2. run manual request burst for target route/group
3. verify logs include expected `group`, `routeId`, `monitorOnly`
4. confirm response behavior:
   - monitor mode: request passes
   - enforce mode: returns 429 with JSON for API/AJAX, view for HTML
5. monitor for false positives for at least one business cycle

## 16. Practical Test Commands

PowerShell burst test:
```powershell
1..10 | ForEach-Object {
  try {
    Invoke-WebRequest "http://localhost:3000/school/classes/new" -Method GET -UseBasicParsing | Out-Null
    "OK $_"
  } catch {
    "ERR $_"
  }
}
```

API burst with query:
```powershell
1..20 | ForEach-Object {
  try {
    Invoke-WebRequest "http://localhost:3000/api/something?q=test" -Method GET -Headers @{ "X-AJAX-Request" = "true" } -UseBasicParsing | Out-Null
    "OK $_"
  } catch {
    "ERR $_"
  }
}
```

## 17. Operational Guardrails
- Start with monitor mode, then enforce gradually.
- Avoid very low thresholds globally.
- Prefer route-specific enforcement for known abusive paths.
- Keep auth and heavy routes stricter than global.
- Use `user_or_ip` where authenticated identity exists.
- Document every override with clear `label` and `notes`.
- Remove stale temporary overrides after incidents.

## 18. Change Log Note
Current code includes an adjustment so active org custom routes can still be evaluated even when website `phase3.enabled` is false.

