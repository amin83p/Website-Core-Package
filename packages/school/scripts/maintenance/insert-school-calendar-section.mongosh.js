// Idempotently seed School Calendar section/symbol into Mongo.
// Usage:
//   mongosh "$MONGO_URI" packages/school/scripts/maintenance/insert-school-calendar-section.mongosh.js

const now = new Date();
const SECTION_ID = '445581';
const SECTION_NAME = 'SCHOOL_CALENDAR';
const SYMBOL_ID = 'SYM_SYSTEM_063';
const PARENT_SECTION_ID = '122740';

const calendarSection = {
  id: SECTION_ID,
  name: SECTION_NAME,
  category: 'SCHOOL',
  description: 'View school days off, professional development activities, and personal school schedules in a layered calendar.',
  active: true,
  trackState: true,
  minimumAccessRequirement: 5,
  dashboardDisplay: true,
  mainDashboardDisplay: false,
  navigatorSection: false,
  homeURL: '/school/calendar',
  operations: [
    { id: 'OP1002', accessScope: 'SCP_ORG' },
    { id: 'OP1005', accessScope: 'SCP_ORG' }
  ],
  subsections: [],
  related: [],
  adoptExisting: true,
  updatedAt: now
};

const calendarSymbol = {
  id: SYMBOL_ID,
  name: SECTION_NAME,
  type: 'class',
  value: 'bi bi-calendar4-week',
  tags: [SECTION_NAME, SECTION_ID],
  orgId: 'SYSTEM',
  adoptExisting: true,
  updatedAt: now
};

db.sections.updateOne(
  { $or: [{ id: SECTION_ID }, { name: SECTION_NAME }] },
  {
    $set: calendarSection,
    $setOnInsert: { createdAt: now }
  },
  { upsert: true }
);

db.symbols.updateOne(
  { $or: [{ id: SYMBOL_ID }, { name: SECTION_NAME }] },
  {
    $set: calendarSymbol,
    $setOnInsert: { createdAt: now }
  },
  { upsert: true }
);

db.sections.updateOne(
  { id: PARENT_SECTION_ID },
  {
    $addToSet: {
      subsections: { id: SECTION_ID }
    },
    $set: { updatedAt: now }
  }
);

db.accesses.updateMany(
  { name: /^SCHOOL_/ },
  {
    $addToSet: {
      'accessJson.sections': {
        id: SECTION_ID,
        name: SECTION_NAME,
        category: 'SCHOOL',
        operations: [
          { id: 'OP1002', accessScope: 'SCP_ORG' },
          { id: 'OP1005', accessScope: 'SCP_ORG' }
        ]
      }
    },
    $set: { updatedAt: now }
  }
);

printjson({
  status: 'ok',
  section: SECTION_NAME,
  sectionId: SECTION_ID,
  symbolId: SYMBOL_ID,
  parentSectionId: PARENT_SECTION_ID
});
