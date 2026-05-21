/**
 * Seed/Upsert Activity Quota section tree in MongoDB `sections` collection.
 *
 * Usage:
 *   mongosh "<MONGODB_URI>/<DB_NAME>" scripts/insert-activity-quota-sections.mongosh.js
 *
 * Behavior:
 * - Upserts by section name (case-insensitive).
 * - Ensures ACTIVITY_QUOTA has children:
 *   ACTIVITY_QUOTA_OVERVIEW, ACTIVITY_QUOTA_LEDGER, ACTIVITY_QUOTA_RULES, ACTIVITY_QUOTA_ADD_CREDIT, ACTIVITY_QUOTA_PACKAGE, ACTIVITY_QUOTA_PACKAGE_MANAGER
 * - Links ACTIVITY_QUOTA under SYSTEM_FRAMEWORK navigator (if present).
 */

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();

const SYSTEM_FRAMEWORK = {
  id: '273755',
  name: 'SYSTEM_FRAMEWORK'
};

const OP_BUNDLE = [
  { id: 'OP1001', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1002', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1003', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1004', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1005', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1012', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1013', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1022', sessionAttempts: 5, sessionTime: 15, active: true }
];

const docs = [
  {
    id: '920101',
    name: 'ACTIVITY_QUOTA_OVERVIEW',
    category: 'SECURITY',
    description: 'Overview dashboard for activity quota balances, trends, and availability.',
    homeURL: '/activity-quota/overview',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    subsections: [],
    related: [],
    operations: OP_BUNDLE
  },
  {
    id: '920102',
    name: 'ACTIVITY_QUOTA_LEDGER',
    category: 'SECURITY',
    description: 'Ledger list for activity quota credit and consumption records.',
    homeURL: '/activity-quota/ledger',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    subsections: [],
    related: [],
    operations: OP_BUNDLE
  },
  {
    id: '920103',
    name: 'ACTIVITY_QUOTA_RULES',
    category: 'SECURITY',
    description: 'Activity quota consumption definition and resolution rules.',
    homeURL: '/activity-quota/rules',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    subsections: [],
    related: [],
    operations: OP_BUNDLE
  },
  {
    id: '920104',
    name: 'ACTIVITY_QUOTA_ADD_CREDIT',
    category: 'SECURITY',
    description: 'Add or adjust user credit allocations in the activity quota ledger.',
    homeURL: '/activity-quota/add-credit',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    subsections: [],
    related: [],
    operations: OP_BUNDLE
  },
  {
    id: '920105',
    name: 'ACTIVITY_QUOTA_PACKAGE',
    category: 'SECURITY',
    description: 'Package catalog for reusable activity quota configurations.',
    homeURL: '/activity-quota/packages',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    subsections: [],
    related: [],
    operations: OP_BUNDLE
  },
  {
    id: '920107',
    name: 'ACTIVITY_QUOTA_PACKAGE_MANAGER',
    category: 'SECURITY',
    description: 'Generic role-gated package assignment manager for user-level quota package lifecycle.',
    homeURL: '/activity-quota/package-manager',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    subsections: [],
    related: [],
    operations: OP_BUNDLE
  }
];

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildAudit(existingAudit) {
  const current = existingAudit && typeof existingAudit === 'object' ? existingAudit : {};
  return {
    createUser: String(current.createUser || ACTOR),
    createDateTime: String(current.createDateTime || NOW),
    lastUpdateUser: ACTOR,
    lastUpdateDateTime: NOW
  };
}

function upsertSectionByName(doc) {
  const existing = db.sections.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(doc.name)}$`, 'i') }
  });

  if (!existing) {
    const next = {
      ...doc,
      audit: buildAudit(null)
    };
    db.sections.insertOne(next);
    print(`Inserted section ${doc.name} (${doc.id}).`);
    return next;
  }

  const next = {
    ...doc,
    id: String(existing.id || doc.id),
    audit: buildAudit(existing.audit)
  };

  db.sections.updateOne(
    { _id: existing._id },
    { $set: next }
  );
  print(`Updated section ${doc.name} (${next.id}).`);
  return { ...existing, ...next };
}

const upsertedChildren = docs.map((doc) => upsertSectionByName(doc));

const parentSeed = {
  id: '920100',
  name: 'ACTIVITY_QUOTA',
  category: 'SECURITY',
  description: 'Navigator for Activity Quota management, ledger visibility, and quota rules.',
  homeURL: '',
  message: '',
  inactiveMessage: '',
  active: true,
  dashboardDisplay: true,
  mainDashboardDisplay: false,
  trackState: false,
  minimumAccessRequirement: 5,
  navigatorSection: true,
  subsections: upsertedChildren.map((row) => ({ id: String(row.id) })),
  related: [],
  operations: []
};

const parent = upsertSectionByName(parentSeed);

const framework =
  db.sections.findOne({ id: SYSTEM_FRAMEWORK.id, name: SYSTEM_FRAMEWORK.name }) ||
  db.sections.findOne({ name: SYSTEM_FRAMEWORK.name, navigatorSection: true });

if (!framework) {
  print(
    `WARNING: ${SYSTEM_FRAMEWORK.name} was not found. Add subsection manually: { id: "${parent.id}" }`
  );
} else {
  const subs = Array.isArray(framework.subsections) ? framework.subsections : [];
  const hasParent = subs.some((row) => row && String(row.id || '') === String(parent.id));
  if (hasParent) {
    print(`${SYSTEM_FRAMEWORK.name} already references ACTIVITY_QUOTA (${parent.id}).`);
  } else {
    const updateResult = db.sections.updateOne(
      { _id: framework._id },
      { $push: { subsections: { id: String(parent.id) } } }
    );
    print(
      `Linked ACTIVITY_QUOTA (${parent.id}) under ${SYSTEM_FRAMEWORK.name}. matched=${updateResult.matchedCount}, modified=${updateResult.modifiedCount}`
    );
  }
}

print('Activity Quota seed complete.');
