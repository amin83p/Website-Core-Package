/**
 * Seed/convert DEBUG_HUB into a navigator container for debug tools.
 *
 * Usage:
 *   mongosh "<MONGODB_URI>/<DB_NAME>" scripts/migrate-debug-hub-sections.mongosh.js
 *   mongosh "<MONGODB_URI>/<DB_NAME>" scripts/migrate-debug-hub-sections.mongosh.js -- --apply
 *   mongosh "<MONGODB_URI>/<DB_NAME>" scripts/migrate-debug-hub-sections.mongosh.js --apply --report=/tmp/debug-hub-migration.json
 *
 * By default this runs in dry-run mode and prints the planned write actions.
 */

const NOW = new Date().toISOString();
const ACTOR = 'SYS_ROOT_001';
const DEBUG_HUB_ID = '111975';
const WEBSITE_POLICY_ID = '408631';
const SYSTEM_SETTING_ID = '883303';

const OP_READ = [{ id: 'OP1002', sessionAttempts: 5, sessionTime: 15, active: true }];

const TARGET_SECTIONS = [
  {
    id: '930201',
    name: 'DEBUG_ACCESS_SIMULATOR',
    description: 'Simulate authorization checks by user, organization, and operation.',
    homeURL: '/debug/access-debug'
  },
  {
    id: '930202',
    name: 'DEBUG_ACCESS_AUDITOR',
    description: 'Generate a full effective-permission report for a selected user.',
    homeURL: '/debug/access-audit'
  },
  {
    id: '930203',
    name: 'DEBUG_INTEGRITY_AUDITOR',
    description: 'Run integrity checks for duplicate links, orphan role records, and broken references.',
    homeURL: '/debug/integrity-audit'
  },
  {
    id: '930204',
    name: 'DEBUG_USER_PERSON_CHECKER',
    description: 'Verify linkage integrity between Person records and User accounts.',
    homeURL: '/debug/user-person-checker'
  },
  {
    id: '930205',
    name: 'DEBUG_USER_SESSION_INSPECTOR',
    description: 'Inspect the request user context and effective organization details.',
    homeURL: '/debug/user-debug'
  },
  {
    id: '930206',
    name: 'DEBUG_HEIC_CONVERTER',
    description: 'Batch convert HEIC image files into JPEG format.',
    homeURL: '/debug/heic-converter'
  }
];

function parseArgValue(name, fallback = null) {
  const args = Array.isArray(process?.argv) ? process.argv : [];
  const token = args.find((item) => typeof item === 'string' && item.toLowerCase().startsWith(`${name.toLowerCase()}=`));
  if (!token) return fallback;
  return token.substring(name.length + 1);
}

const FLAGS = (() => {
  const args = Array.isArray(process?.argv) ? process.argv : [];
  const apply = args.some((item) => String(item).toLowerCase() === '--apply');
  const allowNoOp = args.some((item) => String(item).toLowerCase() === '--help');
  const report = parseArgValue('--report', null) || null;
  return { apply, allowNoOp, report };
})();

if (FLAGS.allowNoOp) {
  print('Usage: mongosh "<MONGODB_URI>/<DB_NAME>" scripts/migrate-debug-hub-sections.mongosh.js [--apply] [--report=<path>]');
  print('No changes are written unless --apply is specified.');
  print('Default is dry-run mode.');
  // eslint-disable-next-line no-undef
  quit(0);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nextAudit(existingAudit = {}) {
  return {
    createUser: String(existingAudit.createUser || ACTOR),
    createDateTime: String(existingAudit.createDateTime || NOW),
    lastUpdateUser: ACTOR,
    lastUpdateDateTime: NOW
  };
}

function normalizeSection(section = {}) {
  return {
    id: String(section.id || '').trim(),
    name: String(section.name || '').trim(),
    homeURL: String(section.homeURL || '').trim(),
    active: !!section.active
  };
}

function toReportPayload(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'undefined' ? null : v)));
}

function buildSectionDoc(target) {
  return {
    id: String(target.id || ''),
    name: String(target.name || ''),
    category: 'SYSTEM',
    description: String(target.description || ''),
    homeURL: String(target.homeURL || ''),
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 10,
    navigatorSection: false,
    subsections: [],
    related: [],
    operations: OP_READ
  };
}

function findSectionByName(name) {
  return db.sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') } });
}

function findSectionByHomeURL(homeURL) {
  return db.sections.findOne({ homeURL });
}

function collectExistingChildrenById() {
  const byId = {};
  for (const child of TARGET_SECTIONS) {
    const byName = findSectionByName(child.name);
    if (byName && byName.id) {
      byId[child.homeURL] = String(byName.id);
      continue;
    }
    const byURL = findSectionByHomeURL(child.homeURL);
    if (byURL && byURL.id) {
      byId[child.homeURL] = String(byURL.id);
    }
  }
  return byId;
}

function sectionPayload(sectionId, desired, previous, exists) {
  return {
    sectionId,
    name: desired.name,
    homeURL: desired.homeURL,
    previous: toReportPayload(previous || null),
    desired: toReportPayload(desired),
    action: exists ? 'update' : 'create'
  };
}

function writeReport(filePath, payload) {
  if (!filePath) return;
  let fs;
  try {
    fs = require('fs');
  } catch (error) {
    print(`Warning: cannot write report because fs is unavailable. ${error?.message || ''}`);
    return;
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    print(`Report written to ${filePath}`);
  } catch (error) {
    print(`Warning: could not write report to ${filePath}. ${error?.message || ''}`);
  }
}

const report = {
  timestamp: NOW,
  mode: FLAGS.apply ? 'apply' : 'dry-run',
  summary: {
    requests: [],
    sectionPlans: [],
    parentPlans: [],
    websitePolicySection: null,
    debugHubBefore: null,
    debugHubAfter: null,
    systemSettingBefore: null,
    systemSettingAfter: null
  }
};

const debugHub = db.sections.findOne({ id: DEBUG_HUB_ID }) || db.sections.findOne({ name: 'DEBUG_HUB' });
const websitePolicy = db.sections.findOne({ id: WEBSITE_POLICY_ID }) || db.sections.findOne({ name: 'WEBSITE_POLICY' });
const systemSetting = db.sections.findOne({ id: SYSTEM_SETTING_ID }) || db.sections.findOne({ name: 'SYSTEM_SETTING' });

report.summary.debugHubBefore = normalizeSection(debugHub || {});
report.summary.websitePolicySection = normalizeSection(websitePolicy || {});
report.summary.systemSettingBefore = normalizeSection(systemSetting || {});

if (!debugHub) {
  report.summary.requests.push({
    action: 'blocked',
    reason: `DEBUG_HUB section ${DEBUG_HUB_ID} was not found in Mongo.`
  });
}

const existingChildren = collectExistingChildrenById();
const childPlans = [];
for (const plannedChild of TARGET_SECTIONS) {
  const desired = buildSectionDoc(plannedChild);
  const byName = findSectionByName(plannedChild.name);
  const byURL = byName ? null : findSectionByHomeURL(plannedChild.homeURL);
  const existing = byName || byURL;

  if (existing) {
    const sectionId = String(existing.id || plannedChild.id);
    const updated = {
      ...desired,
      id: sectionId,
      audit: nextAudit(existing.audit)
    };

    childPlans.push(sectionPayload(sectionId, updated, existing, true));

    if (FLAGS.apply) {
      db.sections.updateOne({ _id: existing._id }, { $set: updated });
      print(`Updated child section: ${desired.name} (${sectionId}).`);
    } else {
      print(`DRY-RUN: would update child section: ${desired.name} (${sectionId}).`);
    }
    existingChildren[plannedChild.homeURL] = sectionId;
  } else {
    const next = {
      ...desired,
      audit: nextAudit(null)
    };
    childPlans.push(sectionPayload(plannedChild.id, next, null, false));
    if (FLAGS.apply) {
      db.sections.insertOne(next);
      print(`Created child section: ${desired.name} (${plannedChild.id}).`);
      existingChildren[plannedChild.homeURL] = plannedChild.id;
    } else {
      print(`DRY-RUN: would create child section: ${desired.name} (${plannedChild.id}).`);
    }
  }
}

report.summary.sectionPlans = childPlans;

const expectedSubsections = TARGET_SECTIONS
  .map((item) => existingChildren[item.homeURL] || item.id)
  .concat([WEBSITE_POLICY_ID])
  .filter(Boolean)
  .map((id) => String(id));

if (!websitePolicy && FLAGS.apply) {
  print(`SKIP: WEBSITE_POLICY (${WEBSITE_POLICY_ID}) not found; it will not be auto-created by this migration.`);
  report.summary.requests.push({
    action: 'warning',
    reason: `WEBSITE_POLICY (${WEBSITE_POLICY_ID}) was not found; skipping addition to DEBUG_HUB subsections.`
  });
}

if (debugHub) {
  const updatedDebugHub = {
    ...debugHub,
    navigatorSection: true,
    subsections: expectedSubsections.map((id) => ({ id })),
    operations: Array.isArray(debugHub.operations) ? debugHub.operations : [],
    audit: nextAudit(debugHub.audit),
    dashboardDisplay: true,
    mainDashboardDisplay: false
  };
  report.summary.parentPlans.push(sectionPayload(DEBUG_HUB_ID, updatedDebugHub, debugHub, true));
  if (FLAGS.apply) {
    db.sections.updateOne({ _id: debugHub._id }, { $set: updatedDebugHub });
    print(`Updated DEBUG_HUB: navigatorSection=true, subsections=${expectedSubsections.length}`);
  } else {
    print('DRY-RUN: would update DEBUG_HUB navigatorSection=true and set subsections.');
  }
}

if (systemSetting) {
  const hasDebugHub = Array.isArray(systemSetting.subsections || []) &&
    systemSetting.subsections.some((row) => String(row.id || '') === String(DEBUG_HUB_ID));
  if (!hasDebugHub) {
    report.summary.parentPlans.push({
      sectionId: SYSTEM_SETTING_ID,
      name: systemSetting.name || 'SYSTEM_SETTING',
      action: 'info',
      desired: { addDebugHubAsSubsection: String(DEBUG_HUB_ID) },
      previous: { subsCount: (systemSetting.subsections || []).length },
      reason: 'Already linked in current snapshot?'
    });
  } else {
    report.summary.parentPlans.push({
      sectionId: SYSTEM_SETTING_ID,
      name: systemSetting.name || 'SYSTEM_SETTING',
      action: 'noop',
      previous: { hasDebugHub },
      desired: { hasDebugHub }
    });
  }
  if (FLAGS.apply && !hasDebugHub) {
    db.sections.updateOne(
      { _id: systemSetting._id },
      { $push: { subsections: { id: DEBUG_HUB_ID } } }
    );
    print(`Linked DEBUG_HUB (${DEBUG_HUB_ID}) under SYSTEM_SETTING.`);
  } else if (FLAGS.apply) {
    print(`SYSTEM_SETTING already links DEBUG_HUB (${DEBUG_HUB_ID}).`);
  } else if (!hasDebugHub) {
    print('DRY-RUN: would link DEBUG_HUB under SYSTEM_SETTING.');
  }
}

report.summary.debugHubAfter = normalizeSection(db.sections.findOne({ id: DEBUG_HUB_ID }) || debugHub || {});
report.summary.systemSettingAfter = normalizeSection(db.sections.findOne({ id: SYSTEM_SETTING_ID }) || systemSetting || {});

print('--- Debug Hub Migration Report ---');
print(JSON.stringify({
  mode: report.mode,
  debugHubBefore: report.summary.debugHubBefore,
  debugHubAfter: report.summary.debugHubAfter,
  sectionPlans: report.summary.sectionPlans,
  parentPlans: report.summary.parentPlans,
  websitePolicySection: report.summary.websitePolicySection,
  systemSettingBefore: report.summary.systemSettingBefore,
  systemSettingAfter: report.summary.systemSettingAfter,
  requests: report.summary.requests
}, null, 2));

writeReport(FLAGS.report, report);

if (!FLAGS.apply) {
  print('Dry-run completed. Add --apply to write changes.');
}
