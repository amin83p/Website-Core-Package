const SECTION_ID = '445582';
const SECTION_NAME = 'SCHOOL_DATA_MAINTENANCE';
const SECTION_HOME_URL = '/school/data-maintenance';
const PARENT_SECTION_ID = '139382';
const PARENT_SECTION_NAME = 'SCHOOL_ACADEMIA';
const SAMPLE_DATA_SECTION_ID = '445561';
const SYMBOL_ID = 'SYM_SYSTEM_200';

const ownerOperations = ['OP1001', 'OP1002', 'OP1003'].map((operationId) => ({
  operationId,
  scopeId: 'SCP_OWNER',
  maxAttemptsPerSession: null,
  maxSessionDurationMinutes: null,
  maxFetchUploadVolumeKB: null
}));

const sectionRow = {
  id: SECTION_ID,
  name: SECTION_NAME,
  category: 'SCHOOL',
  description: 'Browse school collections and selectively hard-delete records for test cleanup.',
  active: true,
  trackState: true,
  minimumAccessRequirement: 1,
  dashboardDisplay: true,
  mainDashboardDisplay: false,
  navigatorSection: false,
  homeURL: SECTION_HOME_URL,
  inactiveMessage: '',
  message: '',
  operations: ['OP1001', 'OP1002', 'OP1003'].map((id) => ({
    id,
    sessionAttempts: 5,
    sessionTime: 15,
    active: true
  })),
  subsections: [],
  related: [],
  adoptExisting: true
};

const symbolRow = {
  id: SYMBOL_ID,
  name: SECTION_NAME,
  type: 'class',
  value: 'bi bi-database-gear',
  tags: [SECTION_NAME, SECTION_ID],
  orgId: 'SYSTEM',
  adoptExisting: true
};

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function upsertSection() {
  const nameRegex = new RegExp(`^${escapeRegExp(SECTION_NAME)}$`, 'i');
  db.sections.updateOne(
    { $or: [{ id: SECTION_ID }, { name: nameRegex }] },
    {
      $set: sectionRow,
      $setOnInsert: { createdAt: new Date(), createdBy: 'system' }
    },
    { upsert: true }
  );
  print(`Upserted section ${SECTION_ID} ${SECTION_NAME}`);
}

function upsertSymbol() {
  const nameRegex = new RegExp(`^${escapeRegExp(SECTION_NAME)}$`, 'i');
  db.symbols.updateOne(
    { $or: [{ id: SYMBOL_ID }, { name: nameRegex }] },
    {
      $set: symbolRow,
      $setOnInsert: { createdAt: new Date(), createdBy: 'system' }
    },
    { upsert: true }
  );
  print(`Upserted SYSTEM symbol ${SYMBOL_ID}`);
}

function ensureParentSubsection() {
  const parent = db.sections.findOne({
    $or: [
      { id: PARENT_SECTION_ID },
      { name: new RegExp(`^${escapeRegExp(PARENT_SECTION_NAME)}$`, 'i') }
    ]
  });
  if (!parent) {
    print(`Parent section ${PARENT_SECTION_NAME} was not found; data maintenance section was not attached.`);
    return;
  }

  const subsections = Array.isArray(parent.subsections) ? parent.subsections : [];
  if (subsections.some((row) => String(row && row.id) === SECTION_ID)) {
    print(`Parent ${parent.id || parent.name} already contains ${SECTION_ID}`);
    return;
  }

  const next = [];
  let inserted = false;
  subsections.forEach((row) => {
    next.push(row);
    if (!inserted && String(row && row.id) === SAMPLE_DATA_SECTION_ID) {
      next.push({ id: SECTION_ID });
      inserted = true;
    }
  });
  if (!inserted) next.push({ id: SECTION_ID });

  db.sections.updateOne({ _id: parent._id }, { $set: { subsections: next, updatedAt: new Date(), updatedBy: 'system' } });
  print(`Attached ${SECTION_ID} under ${parent.id || parent.name}`);
}

function grantAccessFromSampleData() {
  const profiles = db.accesses.find({ 'sections.sectionId': SAMPLE_DATA_SECTION_ID }).toArray();
  if (!profiles.length) {
    print(`WARNING: No access profiles with ${SAMPLE_DATA_SECTION_ID} found.`);
    return;
  }
  profiles.forEach((profile) => {
    const sampleGrant = (Array.isArray(profile.sections) ? profile.sections : [])
      .find((row) => String(row.sectionId || '') === SAMPLE_DATA_SECTION_ID);
    const operations = Array.isArray(sampleGrant?.operations) && sampleGrant.operations.length
      ? sampleGrant.operations
      : ownerOperations;
    const adminAccess = sampleGrant?.adminAccess === true;
    const matched = db.accesses.updateOne(
      { _id: profile._id, 'sections.sectionId': SECTION_ID },
      {
        $set: {
          'sections.$.adminAccess': adminAccess,
          'sections.$.operations': operations,
          updatedAt: new Date(),
          updatedBy: 'system'
        }
      }
    );
    if (matched.matchedCount > 0) {
      print(`Updated access grant ${profile.name} -> ${SECTION_ID}`);
      return;
    }
    db.accesses.updateOne(
      { _id: profile._id },
      {
        $push: {
          sections: {
            sectionId: SECTION_ID,
            adminAccess,
            operations
          }
        },
        $set: { updatedAt: new Date(), updatedBy: 'system' }
      }
    );
    print(`Inserted access grant ${profile.name} -> ${SECTION_ID}`);
  });
}

upsertSection();
upsertSymbol();
ensureParentSubsection();
grantAccessFromSampleData();

print('School data maintenance section seed complete.');
