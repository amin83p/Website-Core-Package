const SECTION_ID = '445575';
const SECTION_NAME = 'SCHOOL_LEAVE_REQUESTS';
const SECTION_HOME_URL = '/school/leave-requests';
const PARENT_SECTION_ID = '139382';
const PARENT_SECTION_NAME = 'SCHOOL_ACADEMIA';
const SYMBOL_ID = 'SYM_SYSTEM_059';
const ACCESS_PROFILES = ['SCHOOL_STUDENT', 'SCHOOL_TEACHER', 'SCHOOL_STAFF'];

const ownerOperations = ['OP1001', 'OP1002', 'OP1003', 'OP1005'].map((operationId) => ({
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
  description: 'Submit, review, and approve student, teacher, and staff leave requests with schedule blocking after approval.',
  active: true,
  trackState: true,
  minimumAccessRequirement: 5,
  dashboardDisplay: true,
  mainDashboardDisplay: false,
  navigatorSection: false,
  homeURL: SECTION_HOME_URL,
  inactiveMessage: '',
  message: '',
  operations: [
    'OP1001',
    'OP1002',
    'OP1003',
    'OP1004',
    'OP1005',
    'OP1012',
    'OP1013',
    'OP1022'
  ].map((id) => ({
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
  value: 'bi bi-calendar-x',
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
    print(`Parent section ${PARENT_SECTION_NAME} was not found; leave request section was not attached.`);
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
    if (!inserted && String(row && row.id) === '445570') {
      next.push({ id: SECTION_ID });
      inserted = true;
    }
  });
  if (!inserted) next.push({ id: SECTION_ID });

  db.sections.updateOne({ _id: parent._id }, { $set: { subsections: next, updatedAt: new Date(), updatedBy: 'system' } });
  print(`Attached ${SECTION_ID} under ${parent.id || parent.name}`);
}

function ensureAccessProfile(profileName) {
  db.accesses.updateOne(
    { name: profileName },
    {
      $setOnInsert: {
        name: profileName,
        active: true,
        fullAdmin: false,
        sections: []
      }
    },
    { upsert: true }
  );

  const matched = db.accesses.updateOne(
    { name: profileName, 'sections.sectionId': SECTION_ID },
    {
      $set: {
        'sections.$.adminAccess': false,
        'sections.$.operations': ownerOperations,
        updatedAt: new Date(),
        updatedBy: 'system'
      }
    }
  );

  if (matched.matchedCount > 0) {
    print(`Updated access grant ${profileName} -> ${SECTION_ID}`);
    return;
  }

  db.accesses.updateOne(
    { name: profileName },
    {
      $push: {
        sections: {
          sectionId: SECTION_ID,
          adminAccess: false,
          operations: ownerOperations
        }
      },
      $set: { updatedAt: new Date(), updatedBy: 'system' }
    }
  );
  print(`Inserted access grant ${profileName} -> ${SECTION_ID}`);
}

upsertSection();
upsertSymbol();
ensureParentSubsection();
ACCESS_PROFILES.forEach(ensureAccessProfile);

print('School leave request section seed complete.');
