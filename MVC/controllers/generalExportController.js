// MVC/controllers/generalExportController.js
const { Parser } = require('json2csv');
const { idsEqual } = require('../utils/idAdapter');

const dataService = require('../services/dataService'); // ✅ Single Data Access Point
const { SYSTEM_CONTEXT } = require('../../config/constants'); // Required for system-level fetching
const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });

// ==========================================================================
//  HELPERS
// ==========================================================================

// Helper to resolve User ID to Name
function resolveUser(userId, userMap) {
  if (!userId) return 'System/Unknown';
  if (userId === 'SYSTEM') return 'System Auto';
  const u = userMap.get(String(userId));
  return u ? (u.username || u.email) : `User#${userId}`;
}

function cleanText(value, max = 220) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  return text.length > max ? text.slice(0, max) : text;
}

function resolveLogActorLabel(log = {}, userMap = new Map()) {
  const actor = (log && typeof log.details?.actor === 'object') ? log.details.actor : {};
  const userId = cleanText(log.userId || actor.userId, 120);
  const username = cleanText(log.username || actor.username, 140);
  const displayName = cleanText(log.displayName || actor.displayName, 180);
  const actorType = cleanText(log.actorType || actor.actorType, 40).toLowerCase();
  const knownUser = userId ? userMap.get(String(userId)) : null;

  const isSystem = actorType === 'system' || String(userId || '').toLowerCase() === 'system';
  if (isSystem) return 'System';

  return displayName
    || cleanText(knownUser?.name || knownUser?.displayName, 180)
    || username
    || cleanText(knownUser?.username, 140)
    || (userId ? `User#${userId}` : 'User');
}

// Helper to format ISO dates
function fmtDate(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleString();
}

// Helper to attach standard Audit columns
function attachAudit(row, item, userMap) {
  const audit = item.audit || {};
  
  row['Created_By'] = resolveUser(audit.createUser || item.createUser, userMap);
  row['Created_At'] = fmtDate(audit.createDateTime || item.createDateTime);
  
  row['Updated_By'] = resolveUser(audit.lastUpdateUser || item.lastUpdateUser, userMap);
  row['Updated_At'] = fmtDate(audit.lastUpdateDateTime || item.lastUpdateDateTime);
  
  return row;
}

// ==========================================================================
//  STRATEGIES
// ==========================================================================
const exportStrategies = {
  
  // --- USERS ---
  users: {
    fetch: async () => dataService.fetchData('users', {}, SYSTEM_CONTEXT),
    process: async (users, userMap) => {
      const persons = await dataService.fetchData('persons', {}, SYSTEM_CONTEXT, PERSON_QUERY_OPTIONS);
      
      return users.map(u => {
        const person = persons.find(p => idsEqual(p.id, u.personId));
        const personName = person 
          ? [person.name?.first, person.name?.last].filter(Boolean).join(' ') 
          : 'Unlinked';

        const row = {
          ID: u.id,
          Email: u.email,
          Username: u.username || '',
          Linked_Person: personName,
          Primary_Org: u.primaryOrgId || 'None',
          Status: u.status,
          Is_Active: u.active ? 'Yes' : 'No',
          Source: u.registrationSource,
          Last_Login: fmtDate(u.lastLoginAt)
        };
        return attachAudit(row, u, userMap);
      });
    }
  },

  // --- PERSONS ---
  persons: {
    fetch: async () => dataService.fetchData('persons', {}, SYSTEM_CONTEXT, PERSON_QUERY_OPTIONS),
    process: async (persons, userMap) => {
      return persons.map(p => {
        const row = {
          ID: p.id,
          First_Name: p.name?.first,
          Last_Name: p.name?.last,
          Email: p.contact?.email || '',
          Phone: p.contact?.phones?.[0]?.number || '',
          Status: p.active ? 'Active' : 'Inactive',
          Org_Count: (p.organizations || []).length,
          Tags: (p.tags || []).join(', ')
        };
        return attachAudit(row, p, userMap);
      });
    }
  },

  // --- ORGANIZATIONS ---
  organizations: {
    fetch: async () => dataService.fetchData('organizations', {}, SYSTEM_CONTEXT),
    process: async (orgs, userMap) => {
      return orgs.map(o => {
        const row = {
          ID: o.id,
          Legal_Name: o.identity?.legalName,
          Display_Name: o.identity?.displayName,
          Active: o.active ? 'Yes' : 'No',
          Plan: o.billing?.plan || 'free',
          Members_Count: o.people?.membersCount || 0,
          Contact_Email: o.contact?.email || ''
        };
        return attachAudit(row, o, userMap);
      });
    }
  },

  // --- OPERATIONS ---
  operations: {
    fetch: async () => dataService.fetchData('operations', {}, SYSTEM_CONTEXT),
    process: async (ops, userMap) => {
      return ops.map(op => {
        const row = {
          ID: op.id,
          Name: op.name,
          Active: op.active ? 'Yes' : 'No',
          System_Protected: op.system ? 'Yes' : 'No'
        };
        return attachAudit(row, op, userMap);
      });
    }
  },

  // --- ROLES ---
  roles: {
    fetch: async () => dataService.fetchData('roles', {}, SYSTEM_CONTEXT),
    process: async (roles, userMap) => {
      return roles.map(role => {
        const row = {
          ID: role.id,
          Key: role.key,
          Label: role.label,
          Domain: role.domain,
          Package_Name: role.packageName,
          Aliases: Array.isArray(role.aliases) ? role.aliases.join(', ') : '',
          Active: role.active !== false ? 'Yes' : 'No',
          System_Protected: role.system ? 'Yes' : 'No'
        };
        return attachAudit(row, role, userMap);
      });
    }
  },

  // --- SECTIONS ---
  sections: {
    fetch: async () => dataService.fetchData('sections', {}, SYSTEM_CONTEXT),
    process: async (secs, userMap) => {
      return secs.map(s => {
        const row = {
          ID: s.id,
          Name: s.name,
          Home_URL: s.homeURL,
          // Min Access deprecated, but keeping for export if field exists
          Active: s.active ? 'Yes' : 'No',
          Main_Dashboard_Display: s.mainDashboardDisplay ? 'Yes' : 'No',
          Dashboard_Display: s.dashboardDisplay ? 'Yes' : 'No'
        };
        return attachAudit(row, s, userMap);
      });
    }
  },

  // --- SCOPES (NEW) ---
  scopes: {
    fetch: async () => dataService.fetchData('scopes', {}, SYSTEM_CONTEXT),
    process: async (scopes, userMap) => {
      return scopes.map(s => {
        const row = {
          ID: s.id,
          Name: s.name,
          Level: s.level,
          Description: s.description,
          Active: s.active ? 'Yes' : 'No'
        };
        return attachAudit(row, s, userMap);
      });
    }
  },

  // --- ACCESS PROFILES (NEW) ---
  accesses: {
    fetch: async () => dataService.fetchData('accesses', {}, SYSTEM_CONTEXT),
    process: async (items, userMap) => {
      return items.map(a => {
        const row = {
          ID: a.id,
          Name: a.name,
          Org_Scope: a.orgId || 'Global',
          Full_Admin: a.fullAdmin ? 'YES' : 'No',
          Active: a.active ? 'Yes' : 'No',
          Valid_From: fmtDate(a.validity?.startDate),
          Valid_Until: fmtDate(a.validity?.endDate),
          Section_Count: (a.sections || []).length
        };
        return attachAudit(row, a, userMap);
      });
    }
  },

  // --- ACCESS POLICIES (NEW) ---
  accessPolicies: {
    fetch: async () => dataService.fetchData('accessPolicies', {}, SYSTEM_CONTEXT),
    process: async (items, userMap) => {
      // Need user names for Target User column
      // We already have userMap, so we can resolve target User ID
      return items.map(p => {
        const row = {
          ID: p.id,
          Policy_Name: p.policyName,
          Target_User: resolveUser(p.userId, userMap),
          Active: p.active ? 'Yes' : 'No',
          Valid_From: fmtDate(p.validityPeriod?.startDate),
          Valid_Until: fmtDate(p.validityPeriod?.endDate),
          Overrides_Count: (p.sections || []).length
        };
        return attachAudit(row, p, userMap);
      });
    }
  },

  // --- TABLE SETTINGS ---
  tablesettings: {
    fetch: async () => dataService.fetchData('tableSettings', {}, SYSTEM_CONTEXT),
    process: async (tss, userMap) => {
      return tss.map(ts => {
        const row = {
          User: resolveUser(ts.userId, userMap),
          Table_ID: ts.tableId,
          Columns_Configured: Object.keys(ts.settings?.visibleColumns || {}).length
        };
        return attachAudit(row, ts, userMap);
      });
    }
  },

  // --- LOGS ---
  logs: {
    fetch: async (req) => {
      // Use body for POST (Export Modal)
      const { sectionId, operationId, userId, startDate, endDate } = req.body;
      return await dataService.fetchData('logs', { sectionId, operationId, userId, startDate, endDate }, SYSTEM_CONTEXT);
    },
    process: async (logs, userMap) => {
      const sections = await dataService.fetchData('sections', {}, SYSTEM_CONTEXT);
      const operations = await dataService.fetchData('operations', {}, SYSTEM_CONTEXT);

      return logs.map(log => {
        const sec = sections.find(s => s.id === log.sectionId);
        const op = operations.find(o => o.id === log.operationId);
        const actorLabel = resolveLogActorLabel(log, userMap);

        return {
          Timestamp: fmtDate(log.timestamp),
          Level: log.level || 'INFO',
          User: actorLabel,
          Org_ID: log.orgId || 'N/A',
          Section: sec ? sec.name : (log.sectionId === '000000' ? 'SYSTEM' : log.sectionId),
          Operation: op ? op.name : log.operationId,
          Status: log.status,
          IP_Address: log.details?.ip || '',
          Message: log.details?.errorMessage || ''
        };
      });
    }
  }
};

// ==========================================================================
//  MAIN CONTROLLER FUNCTION
// ==========================================================================
async function performExport(req, res) {
  try {
    // 1. Identify Context
    let type = req.body.exportType;
    if (!type) {
      // Fallback: extract from URL
      const cleanUrl = req.baseUrl.endsWith('/') ? req.baseUrl.slice(0, -1) : req.baseUrl;
      const urlParts = cleanUrl.split('/');
      type = urlParts[urlParts.length - 1]; 
    }

    // Normalize type (handle singular/plural variances)
    if (type === 'access') type = 'accesses';
    if (type === 'accessPolicy') type = 'accessPolicies';
    if (type === 'scope') type = 'scopes';

    const strategy = exportStrategies[type];
    if (!strategy) {
      return res.status(400).json({ status: 'error', message: `No export strategy defined for type: ${type}` });
    }

    // 2. Pre-fetch User Map (Efficiency)
    // Always fetch ALL users to resolve names for audit columns
    const allUsers = await dataService.fetchData('users', {}, SYSTEM_CONTEXT);
    const userMap = new Map(allUsers.map(u => [String(u.id), u]));

    // 3. Fetch Data
    // We pass 'req' because Logs strategy needs filter params from body
    const rawData = await strategy.fetch(req);
    
    // 4. Process Data
    const finalData = await strategy.process(rawData, userMap, req);

    // 5. Export Logic
    const format = req.body.format || 'csv';
    const filename = `${type}_export_${new Date().toISOString().slice(0, 10)}`;

    if (format === 'csv') {
      const json2csvParser = new Parser();
      const csv = json2csvParser.parse(finalData);
      res.header('Content-Type', 'text/csv');
      res.attachment(`${filename}.csv`);
      return res.send(csv);

    } else if (format === 'json') {
      res.header('Content-Type', 'application/json');
      res.attachment(`${filename}.json`);
      return res.send(JSON.stringify(finalData, null, 2));

    } else {
      return res.status(400).json({ status: 'error', message: 'Invalid format.' });
    }

  } catch (error) {
    console.error('General Export Error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
}

module.exports = { performExport };
