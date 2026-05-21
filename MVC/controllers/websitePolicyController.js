// MVC/controllers/websitePolicyController.js
const dataService = require('../services/dataService');
const { sanitizeRouteCatalogOverrides, buildRouteCatalogViewModel } = require('../utils/requestRateRouteCatalog');

/* ============================================================
   HELPERS
============================================================ */
function parseBool(v) {
  if (typeof v === 'boolean') return v;
  return String(v || '').toLowerCase().trim() === 'true' || String(v) === '1';
}

function parseData(input) {
  if (!input) return null;
  if (typeof input === 'object') return input;
  try { return JSON.parse(input); } catch { return null; }
}

function parsePositiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseNonNegativeInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return fallback;
  return n >= 0 ? n : fallback;
}

function parseKeyMode(value, fallback = 'user_or_ip') {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'ip' || v === 'user_or_ip' || v === 'username_ip') return v;
  return fallback;
}

function parsePhase2Groups(value) {
  const parsed = String(value || 'auth,heavy')
    .split(',')
    .map((g) => g.trim().toLowerCase())
    .filter((g) => ['auth', 'picker', 'write', 'heavy', 'global'].includes(g));
  return parsed.length > 0 ? parsed : ['auth', 'heavy'];
}

function parseRouteOverrides(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  const out = [];

  for (let i = 0; i < list.length; i += 1) {
    const item = list[i] && typeof list[i] === 'object' ? list[i] : {};
    const pathRaw = String(item.path || '').trim();
    const path = pathRaw ? (pathRaw.startsWith('/') ? pathRaw : `/${pathRaw}`) : '';
    if (!path) continue;

    const methodRaw = String(item.method || '*').trim().toUpperCase();
    const method = ['*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(methodRaw) ? methodRaw : '*';

    const matchTypeRaw = String(item.matchType || 'prefix').trim().toLowerCase();
    const matchType = ['exact', 'prefix', 'contains'].includes(matchTypeRaw) ? matchTypeRaw : 'prefix';

    const keyModeRaw = String(item.keyMode || '').trim().toLowerCase();
    const keyMode = ['ip', 'user_or_ip', 'username_ip', ''].includes(keyModeRaw) ? keyModeRaw : '';

    const modeRaw = String(item.mode || 'inherit').trim().toLowerCase();
    const mode = ['inherit', 'monitor', 'enforce'].includes(modeRaw) ? modeRaw : 'inherit';

    const groupRaw = String(item.group || '').trim().toLowerCase();
    const group = ['auth', 'picker', 'write', 'heavy', 'global', ''].includes(groupRaw) ? groupRaw : '';

    const windowMs = parsePositiveInt(item.windowMs, null);
    const max = parsePositiveInt(item.max, null);
    const priorityNum = parseInt(item.priority, 10);
    const priority = Number.isFinite(priorityNum) ? priorityNum : 0;

    const startAtVal = item.startAt ? new Date(item.startAt) : null;
    const endAtVal = item.endAt ? new Date(item.endAt) : null;
    const startAt = (startAtVal && !Number.isNaN(startAtVal.getTime())) ? startAtVal.toISOString() : '';
    const endAt = (endAtVal && !Number.isNaN(endAtVal.getTime())) ? endAtVal.toISOString() : '';

    out.push({
      id: String(item.id || `ROV_${Date.now()}_${i + 1}`).trim(),
      label: String(item.label || '').trim(),
      enabled: item.enabled === true || String(item.enabled || '').toLowerCase() === 'true',
      method,
      matchType,
      path,
      startAt,
      endAt,
      windowMs,
      max,
      keyMode,
      mode,
      group,
      priority,
      notes: String(item.notes || '').trim()
    });
  }

  return out;
}

/* ============================================================
   CONTROLLER ACTIONS
============================================================ */
async function showPolicyForm(req, res) {
    try {
        const policy = await dataService.getWebsitePolicy();
        const routeCatalogRows = buildRouteCatalogViewModel(policy.requestControl || {});
        
        res.render('admin/websitePolicy', {
            title: 'Website Governance',
            policy,
            routeCatalogRows,
            user: req.user,
            includeModal: true,
            includeModal_Table: true,
            actionStateId: req.actionStateId
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

async function updatePolicy(req, res) {
    try {
        const body = req.body;

        // 1. Parse Special Website Features
        const maintenance = {
            enabled: body.maintenance_enabled === 'true',
            message: (body.maintenance_message || '').trim(),
            allowedRoles: body.maintenance_roles ? String(body.maintenance_roles).split(',').map(r => r.trim()).filter(Boolean) : [],
            allowedIps: body.maintenance_ips ? String(body.maintenance_ips).split(',').map(i => i.trim()).filter(Boolean) : []
        };

        const features = {
            registration: body.feat_registration === 'true',
            apiAccess: body.feat_apiAccess === 'true',
            publicAccess: body.feat_publicAccess === 'true',
            backgroundJobs: body.feat_backgroundJobs === 'true'
        };

        // 2. Parse Session Control
        const sessionControl = {
            maxSessions: parseNonNegativeInt(body.sess_maxSessions, 10),
            maxDuration: parseNonNegativeInt(body.sess_maxDuration, 720),
            idleTimeout: parseNonNegativeInt(body.sess_idleTimeout, 60)
        };

        // 2.5 Parse Request Control (Phases 1-3)
        const requestControl = {
            enabled: parseBool(body.req_enabled ?? 'true'),
            mode: String(body.req_mode || 'monitor').toLowerCase() === 'enforce' ? 'enforce' : 'monitor',
            logCooldownMs: parsePositiveInt(body.req_logCooldownMs, 60000),
            excludePaths: String(body.req_excludePaths || '')
                .split(',')
                .map((p) => p.trim())
                .filter(Boolean),
            phase2: {
                enabled: parseBool(body.req_phase2_enabled ?? 'false'),
                enforceGroups: parsePhase2Groups(body.req_phase2_groups)
            },
            phase3: {
                enabled: parseBool(body.req_phase3_enabled ?? 'true')
            },
            routeCatalog: sanitizeRouteCatalogOverrides(parseData(body.req_routeCatalog) || {}),
            routeOverrides: parseRouteOverrides(parseData(body.req_routeOverrides) || []),
            groups: {
                auth: {
                    windowMs: parsePositiveInt(body.req_auth_windowMs, 900000),
                    max: parsePositiveInt(body.req_auth_max, 30),
                    keyMode: parseKeyMode(body.req_auth_keyMode, 'username_ip')
                },
                picker: {
                    windowMs: parsePositiveInt(body.req_picker_windowMs, 60000),
                    max: parsePositiveInt(body.req_picker_max, 120),
                    keyMode: parseKeyMode(body.req_picker_keyMode, 'user_or_ip')
                },
                write: {
                    windowMs: parsePositiveInt(body.req_write_windowMs, 60000),
                    max: parsePositiveInt(body.req_write_max, 80),
                    keyMode: parseKeyMode(body.req_write_keyMode, 'user_or_ip')
                },
                heavy: {
                    windowMs: parsePositiveInt(body.req_heavy_windowMs, 600000),
                    max: parsePositiveInt(body.req_heavy_max, 20),
                    keyMode: parseKeyMode(body.req_heavy_keyMode, 'user_or_ip')
                },
                global: {
                    windowMs: parsePositiveInt(body.req_global_windowMs, 60000),
                    max: parsePositiveInt(body.req_global_max, 300),
                    keyMode: parseKeyMode(body.req_global_keyMode, 'user_or_ip')
                }
            }
        };

        // 3. Parse Complex Org-Style Structures
        const network = parseData(body.network) || {};
        const globalSchedule = parseData(body.globalSchedule) || {};
        const sections = parseData(body.sections) || [];
        const bannedUsers = parseData(body.bannedUsers) || [];

        // 4. Construct Update Object
        const updates = {
            maintenance,
            features,
            sessionControl, 
            requestControl,
            network,
            globalSchedule,
            sections,
            bannedUsers
        };

        // 5. Save
        await dataService.updateWebsitePolicy(updates, req.user);

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'Website Policy Updated Successfully.' });
        }
        res.redirect('/websitePolicy');

    } catch (error) {
        // ✅ FIX: Return 400 (Bad Request) for validation/parsing errors.
        if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
        res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

module.exports = { showPolicyForm, updatePolicy };
