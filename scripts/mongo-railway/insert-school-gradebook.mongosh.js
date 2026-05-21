/**
 * Railway / MongoDB: seed SCHOOL_GRADEBOOK (Grades Matrix) section + symbol + link under SCHOOL + teacher access.
 *
 * Usage (from repo root, with URI):
 *   mongosh "mongodb+srv://USER:PASS@cluster.mongodb.net/DATABASE_NAME" scripts/mongo-railway/insert-school-gradebook.mongosh.js
 *
 * Or open mongosh against your DB, then:
 *   load("scripts/mongo-railway/insert-school-gradebook.mongosh.js")
 *
 * Collections (match jsonToMongoMigrationService): sections, symbols, accesses
 */

const SECTION_ID = "778769";
const SYMBOL_ID = "SYM_SYSTEM_037A";
const PARENT_SCHOOL_NAME = "SCHOOL";
const PARENT_SCHOOL_ID = "122740";

const sectionDoc = {
  name: "SCHOOL_GRADEBOOK",
  category: "SCHOOL",
  description:
    "Session grades matrix: gradebooks, quizzes, assignments, and weighted final scores.",
  homeURL: "/school/grades-matrix",
  message: "",
  inactiveMessage: "",
  active: true,
  dashboardDisplay: true,
  trackState: true,
  minimumAccessRequirement: 5,
  subsections: [],
  related: [],
  operations: [
    { id: "OP1001", sessionAttempts: 5, sessionTime: 15, active: true },
    { id: "OP1002", sessionAttempts: 5, sessionTime: 15, active: true },
    { id: "OP1003", sessionAttempts: 5, sessionTime: 15, active: true },
    { id: "OP1004", sessionAttempts: 5, sessionTime: 15, active: true },
    { id: "OP1005", sessionAttempts: 5, sessionTime: 15, active: true },
    { id: "OP1006", sessionAttempts: 5, sessionTime: 15, active: true },
    { id: "OP1010", sessionAttempts: 5, sessionTime: 15, active: true },
    { id: "OP1012", sessionAttempts: 5, sessionTime: 15, active: true },
    { id: "OP1013", sessionAttempts: 5, sessionTime: 15, active: true },
    { id: "OP1022", sessionAttempts: 5, sessionTime: 15, active: true },
  ],
  audit: {
    createUser: "SYS_ROOT_001",
    createDateTime: "2026-03-30T12:00:00.000Z",
    lastUpdateUser: "SYS_ROOT_001",
    lastUpdateDateTime: "2026-03-30T12:00:00.000Z",
  },
  id: SECTION_ID,
  navigatorSection: false,
  mainDashboardDisplay: false,
};

const symbolDoc = {
  name: "SCHOOL_GRADEBOOK",
  type: "class",
  value: "bi bi-journal-bookmark-fill",
  tags: ["SCHOOL_GRADEBOOK", SECTION_ID],
  audit: {
    createUser: "ROOT_001",
    createDateTime: "2026-03-30T12:00:00.000Z",
    lastUpdateUser: "ROOT_001",
    lastUpdateDateTime: "2026-03-30T12:00:00.000Z",
  },
  orgId: "SYSTEM",
  id: SYMBOL_ID,
};

// --- 1) sections ---
if (db.sections.findOne({ id: SECTION_ID })) {
  print("sections: document id " + SECTION_ID + " already exists — skip insert.");
} else {
  const r = db.sections.insertOne(sectionDoc);
  print("sections: inserted SCHOOL_GRADEBOOK, acknowledged: " + r.acknowledged);
}

// --- 2) symbols ---
if (db.symbols.findOne({ id: SYMBOL_ID })) {
  print("symbols: document id " + SYMBOL_ID + " already exists — skip insert.");
} else if (db.symbols.findOne({ name: "SCHOOL_GRADEBOOK" })) {
  print("symbols: name SCHOOL_GRADEBOOK already exists — skip insert (check id).");
} else {
  const r = db.symbols.insertOne(symbolDoc);
  print("symbols: inserted SCHOOL_GRADEBOOK icon, acknowledged: " + r.acknowledged);
}

// --- 3) Parent navigator section "SCHOOL": add subsection ref { id: "778769" } ---
const schoolParent =
  db.sections.findOne({ id: PARENT_SCHOOL_ID, name: PARENT_SCHOOL_NAME }) ||
  db.sections.findOne({ name: PARENT_SCHOOL_NAME, navigatorSection: true });

if (!schoolParent) {
  print(
    "sections: parent SCHOOL not found (tried id " +
      PARENT_SCHOOL_ID +
      "). Add subsections entry manually: { id: \"" +
      SECTION_ID +
      "\" }"
  );
} else {
  const subs = schoolParent.subsections || [];
  const has = subs.some((s) => s && String(s.id) === SECTION_ID);
  if (has) {
    print('sections: SCHOOL.subsections already contains { id: "' + SECTION_ID + '" } — skip.');
  } else {
    const r = db.sections.updateOne(
      { _id: schoolParent._id },
      { $addToSet: { subsections: { id: SECTION_ID } } }
    );
    print("sections: SCHOOL parent updated, matched: " + r.matchedCount + ", modified: " + r.modifiedCount);
  }
}

// --- 4) Access profile example: GENERAL_SCHOOL_TEACHER + orgId (adjust name/orgId for Railway) ---
const accessProfileName = "GENERAL_SCHOOL_TEACHER";
const accessOrgId = 900000;
const grant = { sectionId: SECTION_ID, adminAccess: true, operations: [] };

const prof = db.accesses.findOne({ name: accessProfileName, orgId: accessOrgId });
if (!prof) {
  print(
    "accesses: no profile { name: \"" +
      accessProfileName +
      "\", orgId: " +
      accessOrgId +
      " } — add grant manually in UI or run update with your profile name/orgId."
  );
} else {
  const sections = prof.sections || [];
  const hasGrant = sections.some((s) => s && String(s.sectionId) === SECTION_ID);
  if (hasGrant) {
    print("accesses: profile already grants section " + SECTION_ID + " — skip.");
  } else {
    const r = db.accesses.updateOne({ _id: prof._id }, { $push: { sections: grant } });
    print("accesses: profile updated, matched: " + r.matchedCount + ", modified: " + r.modifiedCount);
  }
}

print("Done. Routes expect SECTIONS.SCHOOL_GRADEBOOK in app config (accessConstants.js).");
