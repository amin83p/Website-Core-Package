// Idempotently seed School Books section/symbol into Mongo.
// Usage:
//   mongosh "$MONGO_URI" packages/school/scripts/maintenance/insert-school-books-section.mongosh.js

const now = new Date();
const SECTION_ID = '445585';
const SECTION_NAME = 'SCHOOL_BOOKS';
const SYMBOL_ID = 'SYM_SCHOOL_BOOKS_001';
const PARENT_SECTION_ID = '446110';
const ANCHOR_SECTION_ID = '445584';

const booksSection = {
  id: SECTION_ID,
  name: SECTION_NAME,
  category: 'SCHOOL',
  description: 'Manage school textbooks and materials, including bibliographic details and table of contents.',
  active: true,
  trackState: true,
  minimumAccessRequirement: 1,
  dashboardDisplay: true,
  mainDashboardDisplay: false,
  navigatorSection: false,
  homeURL: '/school/library/books',
  inactiveMessage: '',
  message: '',
  operations: [
    { id: 'OP1001', sessionAttempts: 5, sessionTime: 15, active: true },
    { id: 'OP1002', sessionAttempts: 5, sessionTime: 15, active: true },
    { id: 'OP1003', sessionAttempts: 5, sessionTime: 15, active: true },
    { id: 'OP1004', sessionAttempts: 5, sessionTime: 15, active: true },
    { id: 'OP1005', sessionAttempts: 5, sessionTime: 15, active: true }
  ],
  subsections: [],
  related: [],
  adoptExisting: true,
  updatedAt: now
};

const booksSymbol = {
  id: SYMBOL_ID,
  name: SECTION_NAME,
  type: 'class',
  value: 'bi bi-journal-text',
  tags: [SECTION_NAME, SECTION_ID],
  orgId: 'SYSTEM',
  adoptExisting: true,
  updatedAt: now
};

db.sections.updateOne(
  { $or: [{ id: SECTION_ID }, { name: SECTION_NAME }] },
  {
    $set: booksSection,
    $setOnInsert: { createdAt: now }
  },
  { upsert: true }
);

db.symbols.updateOne(
  { $or: [{ id: SYMBOL_ID }, { name: SECTION_NAME }] },
  {
    $set: booksSymbol,
    $setOnInsert: { createdAt: now }
  },
  { upsert: true }
);

const parent = db.sections.findOne({ id: PARENT_SECTION_ID });
if (parent) {
  const refs = Array.isArray(parent.subsections) ? parent.subsections : [];
  const alreadyLinked = refs.some((row) => String(row?.id || row || '').trim() === SECTION_ID);
  if (!alreadyLinked) {
    const next = [...refs];
    const anchorIdx = next.findIndex((row) => String(row?.id || row || '').trim() === ANCHOR_SECTION_ID);
    if (anchorIdx >= 0) next.splice(anchorIdx + 1, 0, { id: SECTION_ID });
    else next.push({ id: SECTION_ID });
    db.sections.updateOne(
      { _id: parent._id },
      {
        $set: {
          subsections: next,
          updatedAt: now
        }
      }
    );
  }
}

db.accesses.updateMany(
  { 'sections.sectionId': ANCHOR_SECTION_ID },
  {
    $addToSet: {
      sections: {
        sectionId: SECTION_ID,
        adminAccess: false,
        operations: [
          { operationId: 'OP1001', scopeId: 'SCP_OWNER' },
          { operationId: 'OP1002', scopeId: 'SCP_OWNER' },
          { operationId: 'OP1003', scopeId: 'SCP_OWNER' },
          { operationId: 'OP1004', scopeId: 'SCP_OWNER' },
          { operationId: 'OP1005', scopeId: 'SCP_OWNER' }
        ]
      }
    },
    $set: { updatedAt: now, updatedBy: 'system' }
  }
);

print(`Seeded ${SECTION_NAME} (${SECTION_ID}) section and symbol.`);
