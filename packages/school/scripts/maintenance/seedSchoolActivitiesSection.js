const SECTION_ID = '555012';
const COLLIDING_SECTION_ID = '445580';
const SECTION_NAME = 'SCHOOL_ACTIVITIES';
const SECTION_LABEL = 'School Activities';
const PARENT_SECTION_ID = '139382';
const PARENT_SECTION_NAME = 'SCHOOL_ACADEMIA';
const SYMBOL_ID = 'SYM_SYSTEM_062';
const HOME_URL = '/school/activities';
const ACTOR = 'SYS_ROOT_001';

const OP_BUNDLE = Object.freeze([
  { id: 'OP1001', sessionAttempts: 10, sessionTime: 30, active: true },
  { id: 'OP1002', sessionAttempts: 10, sessionTime: 30, active: true },
  { id: 'OP1003', sessionAttempts: 10, sessionTime: 30, active: true },
  { id: 'OP1004', sessionAttempts: 10, sessionTime: 30, active: true },
  { id: 'OP1005', sessionAttempts: 10, sessionTime: 30, active: true }
]);

const SECTION_DOC = Object.freeze({
  id: SECTION_ID,
  name: SECTION_NAME,
  category: 'SCHOOL',
  description: 'Define school activities such as PD sessions, track attendee participation, and reflect payable attendance into schedules and timesheets.',
  active: true,
  trackState: true,
  minimumAccessRequirement: 5,
  dashboardDisplay: true,
  mainDashboardDisplay: false,
  navigatorSection: false,
  homeURL: HOME_URL,
  inactiveMessage: '',
  message: '',
  operations: OP_BUNDLE,
  subsections: [],
  related: [],
  adoptExisting: true
});

const SYMBOL_DOC = Object.freeze({
  id: SYMBOL_ID,
  name: SECTION_NAME,
  type: 'class',
  value: 'bi bi-calendar-event',
  tags: [SECTION_NAME, SECTION_ID],
  orgId: 'SYSTEM',
  adoptExisting: true
});

const STAFF_ACCESS_OPERATIONS = Object.freeze([
  { operationId: 'OP1001', scopeId: 'SCP_ORG' },
  { operationId: 'OP1002', scopeId: 'SCP_ORG' },
  { operationId: 'OP1003', scopeId: 'SCP_ORG' },
  { operationId: 'OP1004', scopeId: 'SCP_ORG' },
  { operationId: 'OP1005', scopeId: 'SCP_ORG' }
]);

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildAudit(existingAudit, nowIso) {
  const current = existingAudit && typeof existingAudit === 'object' ? existingAudit : {};
  return {
    createUser: String(current.createUser || ACTOR),
    createDateTime: String(current.createDateTime || nowIso),
    lastUpdateUser: ACTOR,
    lastUpdateDateTime: nowIso
  };
}

function mergeOperations(existingOps = []) {
  const byId = new Map();
  for (const op of Array.isArray(existingOps) ? existingOps : []) {
    const id = String(op?.id || '').trim();
    if (id) byId.set(id, { ...op, id });
  }
  for (const op of OP_BUNDLE) {
    const current = byId.get(op.id);
    byId.set(op.id, current ? { ...op, ...current, active: current.active !== false } : { ...op });
  }
  return Array.from(byId.values());
}

function sectionNamePattern() {
  return new RegExp(`^${escapeRegex(SECTION_NAME)}$`, 'i');
}

function isActivitiesStaffGrant(grant = {}) {
  if (String(grant?.sectionId || '').trim() !== COLLIDING_SECTION_ID) return false;
  const ops = Array.isArray(grant?.operations) ? grant.operations : [];
  if (ops.length !== STAFF_ACCESS_OPERATIONS.length) return false;
  const expected = STAFF_ACCESS_OPERATIONS.map((row) => `${row.operationId}:${row.scopeId}`).sort().join('|');
  const actual = ops.map((row) => `${String(row?.operationId || '').trim()}:${String(row?.scopeId || '').trim()}`).sort().join('|');
  return expected === actual;
}

async function removeCollidingActivitiesSection(sections) {
  const collisionDocs = await sections.find({
    id: COLLIDING_SECTION_ID,
    name: { $regex: sectionNamePattern() }
  }).toArray();
  let removed = 0;
  for (const doc of collisionDocs) {
    await sections.deleteOne({ _id: doc._id });
    removed += 1;
  }
  return { removed };
}

async function upsertSection(sections, nowIso) {
  await removeCollidingActivitiesSection(sections);
  const existing =
    await sections.findOne({ id: SECTION_ID })
    || await sections.findOne({ name: { $regex: sectionNamePattern() } });
  const next = {
    ...SECTION_DOC,
    id: SECTION_ID,
    active: existing?.active !== false,
    audit: buildAudit(existing?.audit, nowIso),
    operations: mergeOperations(existing?.operations),
    related: Array.isArray(existing?.related) ? existing.related : SECTION_DOC.related,
    subsections: Array.isArray(existing?.subsections) ? existing.subsections : SECTION_DOC.subsections
  };
  if (!existing) {
    await sections.insertOne(next);
    return { action: 'inserted', section: next };
  }
  await sections.updateOne({ _id: existing._id }, { $set: next });
  return { action: 'updated', section: { ...existing, ...next } };
}

async function linkUnderParent(sections, childSection, nowIso) {
  const childId = String(childSection?.id || '').trim();
  const parent =
    await sections.findOne({ id: PARENT_SECTION_ID })
    || await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(PARENT_SECTION_NAME)}$`, 'i') } });
  if (!parent) {
    return { linked: false, message: `${PARENT_SECTION_NAME} was not found.` };
  }
  const refs = Array.isArray(parent.subsections) ? parent.subsections : [];
  const alreadyLinked = refs.some((row) => String(row?.id || row || '').trim() === childId);
  if (alreadyLinked) {
    return { linked: true, message: `${SECTION_NAME} is already linked under ${PARENT_SECTION_NAME}.` };
  }
  await sections.updateOne(
    { _id: parent._id },
    {
      $push: { subsections: { id: childId } },
      $set: {
        'audit.lastUpdateUser': ACTOR,
        'audit.lastUpdateDateTime': nowIso
      }
    }
  );
  return { linked: true, message: `Linked ${SECTION_NAME} (${childId}) under ${PARENT_SECTION_NAME}.` };
}

async function upsertSymbol(symbols, nowIso) {
  const existing =
    await symbols.findOne({ id: SYMBOL_ID })
    || await symbols.findOne({
      name: { $regex: sectionNamePattern() },
      $or: [{ orgId: 'SYSTEM' }, { orgId: { $exists: false } }, { orgId: null }, { orgId: '' }]
    });
  const next = {
    ...SYMBOL_DOC,
    id: String(existing?.id || SYMBOL_DOC.id),
    tags: Array.from(new Set([SECTION_NAME, SECTION_ID, ...(Array.isArray(existing?.tags) ? existing.tags : [])])),
    audit: buildAudit(existing?.audit, nowIso)
  };
  if (!existing) {
    await symbols.insertOne(next);
    return { action: 'inserted', symbol: next };
  }
  await symbols.updateOne({ _id: existing._id }, { $set: next });
  return { action: 'updated', symbol: { ...existing, ...next } };
}

function buildStaffGrant() {
  return {
    sectionId: SECTION_ID,
    adminAccess: false,
    operations: STAFF_ACCESS_OPERATIONS.map((row) => ({
      operationId: row.operationId,
      scopeId: row.scopeId,
      maxAttemptsPerSession: null,
      maxSessionDurationMinutes: null,
      maxFetchUploadVolumeKB: null
    }))
  };
}

function buildAcademiaNavigatorGrant() {
  return {
    sectionId: PARENT_SECTION_ID,
    adminAccess: false,
    operations: []
  };
}

function upsertSectionGrant(sections, grant) {
  const sectionId = String(grant?.sectionId || '').trim();
  if (!sectionId) return sections;
  const list = Array.isArray(sections) ? sections : [];
  const existing = list.find((row) => String(row?.sectionId || '').trim() === sectionId);
  if (existing) {
    return list.map((row) => (String(row?.sectionId || '').trim() === sectionId ? grant : row));
  }
  return [...list, grant];
}

async function upsertStaffAccess(accesses, nowIso) {
  const grants = [buildStaffGrant(), buildAcademiaNavigatorGrant()];
  const profiles = await accesses.find({ name: 'SCHOOL_STAFF' }).toArray();
  let updated = 0;
  for (const profile of profiles) {
    let sections = Array.isArray(profile.sections) ? profile.sections : [];
    sections = sections.filter((row) => !isActivitiesStaffGrant(row));
    for (const grant of grants) {
      sections = upsertSectionGrant(sections, grant);
    }
    const changed = JSON.stringify(profile.sections || []) !== JSON.stringify(sections);
    if (!changed) continue;
    await accesses.updateOne(
      { _id: profile._id },
      {
        $set: {
          sections,
          lastUpdateDateTime: nowIso,
          lastUpdateUser: ACTOR
        }
      }
    );
    updated += 1;
  }
  return { updatedProfiles: updated };
}

async function seedSchoolActivitiesSection(db, options = {}) {
  if (!db || typeof db.collection !== 'function') {
    throw new Error('A MongoDB database handle is required.');
  }
  const nowIso = options.now instanceof Date ? options.now.toISOString() : new Date().toISOString();
  const sections = db.collection('sections');
  const symbols = db.collection('symbols');
  const accesses = db.collection('accesses');

  const collisionResult = await removeCollidingActivitiesSection(sections);
  const sectionResult = await upsertSection(sections, nowIso);
  const parentResult = await linkUnderParent(sections, sectionResult.section, nowIso);
  const symbolResult = await upsertSymbol(symbols, nowIso);
  const accessResult = await upsertStaffAccess(accesses, nowIso);

  return {
    status: 'success',
    sectionId: SECTION_ID,
    sectionName: SECTION_NAME,
    homeURL: HOME_URL,
    collision: collisionResult,
    section: sectionResult,
    parent: parentResult,
    symbol: symbolResult,
    access: accessResult
  };
}

module.exports = {
  SECTION_ID,
  COLLIDING_SECTION_ID,
  SECTION_NAME,
  PARENT_SECTION_ID,
  PARENT_SECTION_NAME,
  SYMBOL_ID,
  HOME_URL,
  seedSchoolActivitiesSection
};
