const SECTION_ID = '445580';
const SECTION_NAME = 'SCHOOL_ACTIVITIES';
const SECTION_LABEL = 'School Activities';
const PARENT_SECTION_ID = '139382';
const SYMBOL_ID = 'SYM_SYSTEM_062';
const HOME_URL = '/school/activities';

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
  operations: ['OP1001', 'OP1002', 'OP1003', 'OP1004', 'OP1005'].map((id) => ({
    id,
    sessionAttempts: 5,
    sessionTime: 15,
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
  value: 'bi bi-calendar-event',
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

db.symbols.updateOne(
  { $or: [{ id: SYMBOL_ID }, { name: SECTION_NAME }] },
  { $set: symbol, $setOnInsert: { createdAt: now } },
  { upsert: true }
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
