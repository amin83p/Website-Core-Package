const SECTION_ID = '332233';
const SECTION_NAME = 'SCHOOL_REFERRALS';
const SECTION_LABEL = 'Referrals';
const PARENT_SECTION_ID = '332224';
const PARENT_SECTION_NAME = 'SCHOOL_PEOPLE';
const SYMBOL_ID = 'SYM_SYSTEM_102';
const HOME_URL = '/school/referrals';
const ACTOR = 'SYS_ROOT_001';

const REFERENCE_SECTION_IDS = Object.freeze(['332229', '332230', '332232']);

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
  description: 'Manage school referral contacts and their referring funder organizations.',
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
  value: 'bi bi-share',
  tags: [SECTION_NAME, SECTION_ID],
  orgId: 'SYSTEM',
  adoptExisting: true
});

const DEFAULT_STAFF_ACCESS_OPERATIONS = Object.freeze([
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

function cloneGrantForReferrals(sourceGrant = {}) {
  const ops = Array.isArray(sourceGrant?.operations) ? sourceGrant.operations : [];
  const mapped = ops.length
    ? ops.map((row) => ({
      operationId: String(row?.operationId || '').trim(),
      scopeId: String(row?.scopeId || 'SCP_ORG').trim() || 'SCP_ORG',
      maxAttemptsPerSession: row?.maxAttemptsPerSession ?? null,
      maxSessionDurationMinutes: row?.maxSessionDurationMinutes ?? null,
      maxFetchUploadVolumeKB: row?.maxFetchUploadVolumeKB ?? null
    })).filter((row) => row.operationId)
  : DEFAULT_STAFF_ACCESS_OPERATIONS.map((row) => ({
    ...row,
    maxAttemptsPerSession: null,
    maxSessionDurationMinutes: null,
    maxFetchUploadVolumeKB: null
  }));

  return {
    sectionId: SECTION_ID,
    adminAccess: Boolean(sourceGrant?.adminAccess),
    operations: mapped
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

async function linkUnderPeopleParent(sections, childSection, nowIso) {
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

async function upsertAccessGrants(accesses, nowIso) {
  const orFilters = REFERENCE_SECTION_IDS.map((sectionId) => ({ 'sections.sectionId': sectionId }));
  const profiles = await accesses.find({ $or: orFilters }).toArray();
  const seen = new Set();
  let updated = 0;
  for (const profile of profiles) {
    const profileId = String(profile?._id || '');
    if (!profileId || seen.has(profileId)) continue;
    seen.add(profileId);
    const grants = Array.isArray(profile.sections) ? profile.sections : [];
    if (grants.some((row) => String(row?.sectionId || '').trim() === SECTION_ID)) {
      continue;
    }
    const referenceGrant = grants.find((row) => REFERENCE_SECTION_IDS.includes(String(row?.sectionId || '').trim()));
    const nextGrant = cloneGrantForReferrals(referenceGrant || {});
    const sections = upsertSectionGrant(grants, nextGrant);
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

  const staffProfiles = await accesses.find({ name: 'SCHOOL_STAFF' }).toArray();
  for (const profile of staffProfiles) {
    const profileId = String(profile?._id || '');
    if (seen.has(profileId)) continue;
    const grants = Array.isArray(profile.sections) ? profile.sections : [];
    if (grants.some((row) => String(row?.sectionId || '').trim() === SECTION_ID)) continue;
    const sections = upsertSectionGrant(grants, cloneGrantForReferrals({}));
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

async function upsertRole(roles, nowIso) {
  const roleId = 'ROL1008';
  const existing = await roles.findOne({ id: roleId }) || await roles.findOne({ key: 'school_referral' });
  const next = {
    id: roleId,
    key: 'school_referral',
    label: 'School Referral',
    description: 'School-scoped referral contact role alias for audience targeting.',
    domain: 'school',
    packageName: 'SCHOOL',
    aliases: [
      'schoolreferral',
      'school-referral',
      'schoolreferrals',
      'school-referrals',
      'school_referrals'
    ],
    active: true,
    system: true,
    adoptExisting: true,
    audit: buildAudit(existing?.audit, nowIso)
  };
  if (!existing) {
    await roles.insertOne(next);
    return { action: 'inserted', role: next };
  }
  await roles.updateOne({ _id: existing._id }, { $set: next });
  return { action: 'updated', role: { ...existing, ...next } };
}

async function seedSchoolReferralsSection(db, options = {}) {
  if (!db || typeof db.collection !== 'function') {
    throw new Error('A MongoDB database handle is required.');
  }
  const nowIso = options.now instanceof Date ? options.now.toISOString() : new Date().toISOString();
  const sections = db.collection('sections');
  const symbols = db.collection('symbols');
  const accesses = db.collection('accesses');
  const roles = db.collection('roles');

  const sectionResult = await upsertSection(sections, nowIso);
  const parentResult = await linkUnderPeopleParent(sections, sectionResult.section, nowIso);
  const symbolResult = await upsertSymbol(symbols, nowIso);
  const accessResult = await upsertAccessGrants(accesses, nowIso);
  const roleResult = await upsertRole(roles, nowIso);

  return {
    status: 'success',
    sectionId: SECTION_ID,
    sectionName: SECTION_NAME,
    sectionLabel: SECTION_LABEL,
    homeURL: HOME_URL,
    section: sectionResult,
    parent: parentResult,
    symbol: symbolResult,
    access: accessResult,
    role: roleResult
  };
}

module.exports = {
  SECTION_ID,
  SECTION_NAME,
  SECTION_LABEL,
  PARENT_SECTION_ID,
  PARENT_SECTION_NAME,
  SYMBOL_ID,
  HOME_URL,
  seedSchoolReferralsSection
};