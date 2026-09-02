const SECTION_ID = '555013';
const SECTION_NAME = 'SCHOOL_WORK_SESSIONS';
const SECTION_LABEL = 'Work Session Explorer';
const PARENT_SECTION_ID = '139382';
const LEGACY_PARENT_SECTION_ID = '555012';
const SYMBOL_ID = 'SYM_SYSTEM_135';
const HOME_URL = '/school/work-sessions';

const now = new Date();

function op(id, scopeId) {
  return {
    operationId: id,
    scopeId: scopeId || 'SCP_ORG',
    maxAttemptsPerSession: null,
    maxSessionDurationMinutes: null,
    maxFetchUploadVolumeKB: null
  };
}

const section = {
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
  operations: ['OP1001', 'OP1002', 'OP1003', 'OP1004', 'OP1005'].map((id) => ({
    id,
    sessionAttempts: 10,
    sessionTime: 30,
    active: true
  })),
  subsections: [],
  related: [],
  adoptExisting: true,
  audit: {
    createUser: 'system',
    createDateTime: now,
    lastUpdateUser: 'system',
    lastUpdateDateTime: now
  }
};

const symbol = {
  id: SYMBOL_ID,
  name: SECTION_NAME,
  type: 'class',
  value: 'bi bi-journal-check',
  tags: [SECTION_NAME, SECTION_ID],
  orgId: 'SYSTEM',
  adoptExisting: true,
  audit: {
    createUser: 'system',
    createDateTime: now,
    lastUpdateUser: 'system',
    lastUpdateDateTime: now
  }
};

db.sections.updateOne(
  { $or: [{ id: SECTION_ID }, { name: SECTION_NAME }] },
  { $set: section, $setOnInsert: { createdAt: now } },
  { upsert: true }
);

db.sections.deleteMany({
  name: SECTION_NAME,
  id: { $ne: SECTION_ID }
});

db.symbols.updateOne(
  { $or: [{ id: SYMBOL_ID }, { name: SECTION_NAME }] },
  { $set: symbol, $setOnInsert: { createdAt: now } },
  { upsert: true }
);

db.sections.updateOne(
  { id: LEGACY_PARENT_SECTION_ID },
  {
    $pull: { subsections: { id: SECTION_ID } },
    $set: { 'audit.lastUpdateUser': 'system', 'audit.lastUpdateDateTime': now }
  }
);

db.sections.updateOne(
  { id: PARENT_SECTION_ID },
  {
    $pull: { subsections: { id: SECTION_ID } },
    $set: { 'audit.lastUpdateUser': 'system', 'audit.lastUpdateDateTime': now }
  }
);

db.sections.updateOne(
  { id: PARENT_SECTION_ID },
  {
    $push: { subsections: { id: SECTION_ID } },
    $set: { 'audit.lastUpdateUser': 'system', 'audit.lastUpdateDateTime': now }
  }
);

db.accesses.updateMany(
  { name: 'SCHOOL_TEACHER' },
  { $pull: { sections: { sectionId: SECTION_ID } } }
);

db.accesses.updateMany(
  { name: 'SCHOOL_TEACHER' },
  {
    $push: {
      sections: {
        sectionId: SECTION_ID,
        adminAccess: false,
        operations: [
          op('OP1002', 'SCP_DEPT'),
          op('OP1003', 'SCP_DEPT')
        ]
      }
    },
    $set: {
      lastUpdateDateTime: now,
      lastUpdateUser: 'system'
    }
  }
);

db.accesses.updateMany(
  { name: 'SCHOOL_STAFF' },
  { $pull: { sections: { sectionId: SECTION_ID } } }
);

db.accesses.updateMany(
  { name: 'SCHOOL_STAFF' },
  {
    $push: {
      sections: {
        sectionId: SECTION_ID,
        adminAccess: false,
        operations: [
          op('OP1001'),
          op('OP1002'),
          op('OP1003'),
          op('OP1004'),
          op('OP1005')
        ]
      }
    },
    $set: {
      lastUpdateDateTime: now,
      lastUpdateUser: 'system'
    }
  }
);

print(`Upserted ${SECTION_LABEL} section ${SECTION_ID} and symbol ${SYMBOL_ID}.`);
