const SECTION_ID = '555013';
const SECTION_NAME = 'SCHOOL_WORK_SESSIONS';
const SECTION_LABEL = 'Work Session Explorer';
const PARENT_SECTION_ID = '139382';
const PARENT_SECTION_NAME = 'SCHOOL_ACADEMIA';
const LEGACY_PARENT_SECTION_ID = '555012';
const LEGACY_PARENT_SECTION_NAME = 'SCHOOL_ACTIVITIES';
const SYMBOL_ID = 'SYM_SYSTEM_135';
const HOME_URL = '/school/work-sessions';
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
  description: 'Browse and manage assigned work sessions across school activities.',
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
  value: 'bi bi-journal-check',
  tags: [SECTION_NAME, SECTION_ID],
  orgId: 'SYSTEM',
  adoptExisting: true
});

const TEACHER_ACCESS_OPERATIONS = Object.freeze([
  { operationId: 'OP1002', scopeId: 'SCP_DEPT' },
  { operationId: 'OP1003', scopeId: 'SCP_DEPT' }
]);

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

function sectionNamePattern() {
  return new RegExp(`^${escapeRegex(SECTION_NAME)}$`, 'i');
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

function buildGrant(sectionId, operations, adminAccess = false) {
  return {
    sectionId,
    adminAccess,
    operations: operations.map((row) => ({
      operationId: row.operationId,
      scopeId: row.scopeId,
      maxAttemptsPerSession: null,
      maxSessionDurationMinutes: null,
      maxFetchUploadVolumeKB: null
    }))
  };
}

function upsertSectionGrant(sections, grant) {
  const sectionId = String(grant?.sectionId || '').trim();
  if (!sectionId) return sections;
  const list = Array.isArray(sections) ? sections : [];
  const filtered = list.filter((row) => String(row?.sectionId || '').trim() !== sectionId);
  return [...filtered, grant];
}

async function upsertSection(sections, nowIso) {
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

async function unlinkFromParent(sections, parentId, parentName, childId, nowIso) {
  const parent =
    await sections.findOne({ id: parentId })
    || await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(parentName)}$`, 'i') } });
  if (!parent) return { unlinked: false, message: `${parentName} was not found.` };
  const refs = Array.isArray(parent.subsections) ? parent.subsections : [];
  const stillLinked = refs.some((row) => String(row?.id || row || '').trim() === childId);
  if (!stillLinked) {
    return { unlinked: false, message: `${SECTION_NAME} is not linked under ${parentName}.` };
  }
  await sections.updateOne(
    { _id: parent._id },
    {
      $pull: { subsections: { id: childId } },
      $set: {
        'audit.lastUpdateUser': ACTOR,
        'audit.lastUpdateDateTime': nowIso
      }
    }
  );
  return { unlinked: true, message: `Removed ${SECTION_NAME} (${childId}) from ${parentName}.` };
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

async function upsertProfileAccess(accesses, profileName, grant, nowIso) {
  const profiles = await accesses.find({ name: profileName }).toArray();
  let updated = 0;
  for (const profile of profiles) {
    const sections = upsertSectionGrant(Array.isArray(profile.sections) ? profile.sections : [], grant);
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
  return { profileName, updatedProfiles: updated };
}

async function seedSchoolWorkSessionsSection(db, options = {}) {
  if (!db || typeof db.collection !== 'function') {
    throw new Error('A MongoDB database handle is required.');
  }
  const nowIso = options.now instanceof Date ? options.now.toISOString() : new Date().toISOString();
  const sections = db.collection('sections');
  const symbols = db.collection('symbols');
  const accesses = db.collection('accesses');

  const sectionResult = await upsertSection(sections, nowIso);
  const legacyParentResult = await unlinkFromParent(
    sections,
    LEGACY_PARENT_SECTION_ID,
    LEGACY_PARENT_SECTION_NAME,
    SECTION_ID,
    nowIso
  );
  const parentResult = await linkUnderParent(sections, sectionResult.section, nowIso);
  const symbolResult = await upsertSymbol(symbols, nowIso);
  const teacherAccessResult = await upsertProfileAccess(
    accesses,
    'SCHOOL_TEACHER',
    buildGrant(SECTION_ID, TEACHER_ACCESS_OPERATIONS),
    nowIso
  );
  const staffAccessResult = await upsertProfileAccess(
    accesses,
    'SCHOOL_STAFF',
    buildGrant(SECTION_ID, STAFF_ACCESS_OPERATIONS),
    nowIso
  );

  return {
    status: 'success',
    sectionId: SECTION_ID,
    sectionName: SECTION_NAME,
    sectionLabel: SECTION_LABEL,
    homeURL: HOME_URL,
    section: sectionResult,
    legacyParent: legacyParentResult,
    parent: parentResult,
    symbol: symbolResult,
    access: {
      teacher: teacherAccessResult,
      staff: staffAccessResult
    }
  };
}

module.exports = {
  SECTION_ID,
  SECTION_NAME,
  SECTION_LABEL,
  PARENT_SECTION_ID,
  PARENT_SECTION_NAME,
  LEGACY_PARENT_SECTION_ID,
  SYMBOL_ID,
  HOME_URL,
  seedSchoolWorkSessionsSection
};
