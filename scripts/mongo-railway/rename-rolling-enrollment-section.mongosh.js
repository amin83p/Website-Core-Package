const SECTION_ID = '445572';
const LEGACY_SECTION_NAME = 'SCHOOL_CLASS_ENROLLMENT_PERIODS';
const SECTION_NAME = 'SCHOOL_ROLLING_ENROLLMENT';
const SECTION_HOME_URL = '/school/rolling-enrollment';
const PARENT_SECTION_ID = '139382';
const PARENT_SECTION_NAME = 'SCHOOL_ACADEMIA';
const SYMBOL_ID = 'SYM_SYSTEM_064';
const RELATED_CLASS_SECTION_ID = '442039';

const sectionRow = {
  id: SECTION_ID,
  name: SECTION_NAME,
  category: 'SCHOOL',
  description: 'Rolling Enrollment lifecycle for rolling classes.',
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
    'OP1006',
    'OP1010',
    'OP1012',
    'OP1013',
    'OP1021',
    'OP1022',
    'OP1023'
  ].map((id) => ({
    id,
    sessionAttempts: 10,
    sessionTime: 30,
    active: true
  })),
  subsections: [],
  related: [{ id: RELATED_CLASS_SECTION_ID }],
  packageId: 'school',
  packageName: 'SCHOOL',
  package: {
    packageId: 'school',
    packageName: 'SCHOOL'
  }
};

const symbolRow = {
  id: SYMBOL_ID,
  name: SECTION_NAME,
  type: 'class',
  value: 'bi bi-person-check',
  tags: [SECTION_NAME, LEGACY_SECTION_NAME, SECTION_ID],
  orgId: 'SYSTEM'
};

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function upsertSection() {
  const legacyNameRegex = new RegExp(`^${escapeRegExp(LEGACY_SECTION_NAME)}$`, 'i');
  const nextNameRegex = new RegExp(`^${escapeRegExp(SECTION_NAME)}$`, 'i');
  db.sections.updateOne(
    { $or: [{ id: SECTION_ID }, { name: legacyNameRegex }, { name: nextNameRegex }] },
    {
      $set: {
        ...sectionRow,
        updatedAt: new Date(),
        updatedBy: 'system'
      },
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
      $set: {
        ...symbolRow,
        updatedAt: new Date(),
        updatedBy: 'system'
      },
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
    print(`Parent section ${PARENT_SECTION_NAME} was not found; rolling enrollment section was not attached.`);
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
    if (!inserted && String(row && row.id) === RELATED_CLASS_SECTION_ID) {
      next.push({ id: SECTION_ID });
      inserted = true;
    }
  });
  if (!inserted) next.push({ id: SECTION_ID });

  db.sections.updateOne(
    { _id: parent._id },
    { $set: { subsections: next, updatedAt: new Date(), updatedBy: 'system' } }
  );
  print(`Attached ${SECTION_ID} under ${parent.id || parent.name}`);
}

upsertSection();
upsertSymbol();
ensureParentSubsection();
