/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT_DIR, 'data', 'systemSettings.json');

const PTE_ROOT_REF = { id: '910001', name: 'PTE' };

const OP_BUNDLE = [
  { id: 'OP1001', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1002', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1003', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1004', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1005', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1012', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1013', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1022', sessionAttempts: 5, sessionTime: 15, active: true }
];

const SECTION_SEEDS = Object.freeze({
  PTE_PUBLIC_PAGE: {
    id: '930123',
    name: 'PTE_PUBLIC_PAGE',
    category: 'PTE',
    description: 'Manage public PTE landing page content, slider images, calls to action, and applicant information.',
    homeURL: '/pte/public-page',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    related: [],
    subsections: [],
    operations: OP_BUNDLE
  },
  PTE_PEOPLE: {
    id: '930100',
    name: 'PTE_PEOPLE',
    category: 'PTE',
    description: 'Navigator for PTE people-related sections.',
    homeURL: '',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: false,
    minimumAccessRequirement: 5,
    navigatorSection: true,
    operations: [],
    subsections: []
  },
  PTE_STUDENTS: {
    id: '930101',
    name: 'PTE_STUDENTS',
    category: 'PTE',
    description: 'Manage PTE applicants/students lifecycle, packages, and supporting documents.',
    homeURL: '/pte/students',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    related: [],
    subsections: [],
    operations: OP_BUNDLE
  },
  PTE_PUBLIC_APPLICANTS: {
    id: '930122',
    name: 'PTE_PUBLIC_APPLICANTS',
    category: 'PTE',
    description: 'Manage applicants who joined from the public PTE website flow.',
    homeURL: '/pte/public-applicants',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    related: [],
    subsections: [],
    operations: OP_BUNDLE
  },
  PTE_TEACHERS: {
    id: '930113',
    name: 'PTE_TEACHERS',
    category: 'PTE',
    description: 'Manage PTE teachers linked to person records, courses, and lifecycle status.',
    homeURL: '/pte/teachers',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    related: [],
    subsections: [],
    operations: OP_BUNDLE
  },
  PTE_QUESTIONS_BANK: {
    id: '930102',
    name: 'PTE_QUESTIONS_BANK',
    category: 'PTE',
    description: 'Author, version, and manage PTE question bank items with immutable published revisions.',
    homeURL: '/pte/questions-bank',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    related: [],
    subsections: [],
    operations: OP_BUNDLE
  },
  PTE_TESTS: {
    id: '930103',
    name: 'PTE_TESTS',
    category: 'PTE',
    description: 'Define and version PTE tests, allocating published questions across all four skills.',
    homeURL: '/pte/tests',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    related: [],
    subsections: [],
    operations: OP_BUNDLE
  },
  PTE_COURSES: {
    id: '930112',
    name: 'PTE_COURSES',
    category: 'PTE',
    description: 'Manage PTE courses with teachers, students, schedules, and lifecycle status.',
    homeURL: '/pte/courses',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    related: [],
    subsections: [],
    operations: OP_BUNDLE
  },
  PTE_AI_ASSISST: {
    id: '930114',
    name: 'PTE_AI_ASSISST',
    category: 'PTE',
    description: 'Navigator for PTE AI provider and key settings.',
    homeURL: '',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: false,
    minimumAccessRequirement: 5,
    navigatorSection: true,
    related: [],
    subsections: [],
    operations: []
  },
  PTE_AI_PROVIDER_KEYS: {
    id: '930115',
    name: 'PTE_AI_PROVIDER_KEYS',
    category: 'PTE',
    description: 'Define API providers and keys for PTE AI-assisted features.',
    homeURL: '/pte/ai-assisst/api-providers',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    related: [],
    subsections: [],
    operations: OP_BUNDLE
  },
  PTE_AI_SCORING_SETTINGS: {
    id: '930119',
    name: 'PTE_AI_SCORING_SETTINGS',
    category: 'PTE',
    description: 'Assign PTE scoring question types to saved AI provider keys and models.',
    homeURL: '/pte/ai-assisst/scoring-settings',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    related: [],
    subsections: [],
    operations: OP_BUNDLE
  },
  PTE_AI_TOKEN_USAGE: {
    id: '930118',
    name: 'PTE_AI_TOKEN_USAGE',
    category: 'PTE',
    description: 'Track PTE AI communication usage with token consumption and runtime metadata.',
    homeURL: '/pte/ai-assisst/token-usage',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    related: [],
    subsections: [],
    operations: OP_BUNDLE
  },
  PTE_SCORING: {
    id: '930116',
    name: 'PTE_SCORING',
    category: 'PTE',
    description: 'Navigator for PTE scoring tools and defaults management.',
    homeURL: '',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: false,
    minimumAccessRequirement: 5,
    navigatorSection: true,
    related: [],
    subsections: [],
    operations: []
  },
  PTE_SCORING_DEFAULTS: {
    id: '930117',
    name: 'PTE_SCORING_DEFAULTS',
    category: 'PTE',
    description: 'Manage global scoring defaults by PTE question type with revision history.',
    homeURL: '/pte/scoring/defaults',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    related: [],
    subsections: [],
    operations: OP_BUNDLE
  },
  PTE_ATTEMPT: {
    id: '930104',
    name: 'PTE_ATTEMPT',
    category: 'PTE',
    description: 'Navigator for PTE runtime attempt records, details, and performance views.',
    homeURL: '',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: false,
    minimumAccessRequirement: 5,
    navigatorSection: true,
    related: [],
    subsections: [],
    operations: []
  },
  PTE_ATTEMPT_LEDGER: {
    id: '930105',
    name: 'PTE_ATTEMPT_LEDGER',
    category: 'PTE',
    description: 'Browse event-level runtime attempt ledger entries across PTE attempts.',
    homeURL: '/pte/attempt/ledger',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    related: [],
    subsections: [],
    operations: OP_BUNDLE
  },
  PTE_ATTEMPT_DETAILS: {
    id: '930106',
    name: 'PTE_ATTEMPT_DETAILS',
    category: 'PTE',
    description: 'Detailed per-attempt session and item drill-down view.',
    homeURL: '/pte/attempt/details',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    related: [],
    subsections: [],
    operations: OP_BUNDLE
  },
  PTE_ATTEMPT_OVERALL_PERFORMANCE: {
    id: '930107',
    name: 'PTE_ATTEMPT_OVERALL_PERFORMANCE',
    category: 'PTE',
    description: 'Overall learner performance, trends, and analytics view.',
    homeURL: '/pte/attempt/overall-performance',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    related: [],
    subsections: [],
    operations: OP_BUNDLE
  },
  PTE_PRACTICE: {
    id: '930108',
    name: 'PTE_PRACTICE',
    category: 'PTE',
    description: 'Navigator for PTE practice sections.',
    homeURL: '',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: false,
    minimumAccessRequirement: 5,
    navigatorSection: true,
    related: [],
    subsections: [],
    operations: []
  },
  PTE_PRACTICE_BY_SKILLS: {
    id: '930109',
    name: 'PTE_PRACTICE_BY_SKILLS',
    category: 'PTE',
    description: 'Run skill-based PTE practice sessions with type multi-select and runtime ledger tracking.',
    homeURL: '/pte/practice/by-skills',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    related: [],
    subsections: [],
    operations: OP_BUNDLE
  },
  PTE_SMART_PRACTICE: {
    id: '930121',
    name: 'PTE_SMART_PRACTICE',
    category: 'PTE',
    description: 'Generate adaptive PTE practice plans from student performance, self-rated difficulty, and question difficulty.',
    homeURL: '/pte/practice/smart',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    related: [],
    subsections: [],
    operations: OP_BUNDLE
  },
  PTE_MOCK_EXAMS: {
    id: '930120',
    name: 'PTE_MOCK_EXAMS',
    category: 'PTE',
    description: 'Run strict PTE mock exams from published registered tests with real-test timing and sequencing rules.',
    homeURL: '/pte/practice/mock-exams',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    related: [],
    subsections: [],
    operations: OP_BUNDLE
  },
  PTE_FEEDBACK: {
    id: '930110',
    name: 'PTE_FEEDBACK',
    category: 'PTE',
    description: 'Navigator for PTE feedback sections.',
    homeURL: '',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: false,
    minimumAccessRequirement: 5,
    navigatorSection: true,
    related: [],
    subsections: [],
    operations: []
  },
  PTE_FEEDBACK_ON_PRACTICE: {
    id: '930111',
    name: 'PTE_FEEDBACK_ON_PRACTICE',
    category: 'PTE',
    description: 'Review started practice sessions and provide per-question feedback for learners.',
    homeURL: '/pte/feedback/practice',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    related: [],
    subsections: [],
    operations: OP_BUNDLE
  }
});

const ROOT_REQUIRED_NAMES = Object.freeze([
  'PTE_PUBLIC_PAGE',
  'PTE_PEOPLE',
  'PTE_QUESTIONS_BANK',
  'PTE_TESTS',
  'PTE_COURSES',
  'PTE_AI_ASSISST',
  'PTE_SCORING',
  'PTE_ATTEMPT',
  'PTE_PRACTICE',
  'PTE_FEEDBACK'
]);

const PTE_PEOPLE_REQUIRED_NAMES = Object.freeze(['PTE_STUDENTS', 'PTE_PUBLIC_APPLICANTS', 'PTE_TEACHERS']);
const PTE_PEOPLE_EXCLUDE_NAMES = Object.freeze([
  'PTE_QUESTIONS_BANK',
  'PTE_TESTS',
  'PTE_COURSES',
  'PTE_AI_ASSISST',
  'PTE_AI_PROVIDER_KEYS',
  'PTE_AI_SCORING_SETTINGS',
  'PTE_AI_TOKEN_USAGE',
  'PTE_SCORING',
  'PTE_SCORING_DEFAULTS',
  'PTE_ATTEMPT',
  'PTE_ATTEMPT_LEDGER',
  'PTE_ATTEMPT_DETAILS',
  'PTE_ATTEMPT_OVERALL_PERFORMANCE',
  'PTE_PRACTICE',
  'PTE_PRACTICE_BY_SKILLS',
  'PTE_SMART_PRACTICE',
  'PTE_MOCK_EXAMS',
  'PTE_FEEDBACK',
  'PTE_FEEDBACK_ON_PRACTICE',
  'PTE_PUBLIC_PAGE'
]);
const PTE_AI_ASSISST_REQUIRED_NAMES = Object.freeze(['PTE_AI_PROVIDER_KEYS', 'PTE_AI_SCORING_SETTINGS', 'PTE_AI_TOKEN_USAGE']);
const PTE_SCORING_REQUIRED_NAMES = Object.freeze(['PTE_SCORING_DEFAULTS']);
const PTE_ATTEMPT_REQUIRED_NAMES = Object.freeze([
  'PTE_ATTEMPT_LEDGER',
  'PTE_ATTEMPT_DETAILS',
  'PTE_ATTEMPT_OVERALL_PERFORMANCE'
]);
const PTE_PRACTICE_REQUIRED_NAMES = Object.freeze(['PTE_PRACTICE_BY_SKILLS', 'PTE_SMART_PRACTICE', 'PTE_MOCK_EXAMS']);
const PTE_FEEDBACK_REQUIRED_NAMES = Object.freeze(['PTE_FEEDBACK_ON_PRACTICE']);

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const out = { uri: '', db: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    const next = String(argv[i + 1] || '').trim();
    if ((token === '--uri' || token === '-u') && next) {
      out.uri = next;
      i += 1;
      continue;
    }
    if ((token === '--db' || token === '-d') && next) {
      out.db = next;
      i += 1;
      continue;
    }
  }
  return out;
}

function inferDbNameFromUri(uri = '') {
  const safe = String(uri || '').trim();
  if (!safe) return '';
  try {
    const normalized = safe.startsWith('mongodb://') || safe.startsWith('mongodb+srv://')
      ? safe
      : `mongodb://${safe}`;
    const parsed = new URL(normalized);
    const pathname = String(parsed.pathname || '').replace(/^\//, '').trim();
    if (!pathname) return '';
    if (pathname.includes('/')) return pathname.split('/')[0];
    return pathname;
  } catch (_) {
    return '';
  }
}

function buildAudit(existingAudit) {
  const current = existingAudit && typeof existingAudit === 'object' ? existingAudit : {};
  return {
    createUser: String(current.createUser || ACTOR),
    createDateTime: String(current.createDateTime || NOW),
    lastUpdateUser: ACTOR,
    lastUpdateDateTime: NOW
  };
}

async function findSectionByRef(sectionsCollection, ref = {}) {
  const id = String(ref?.id || '').trim();
  if (id) {
    const byId = await sectionsCollection.findOne({ id });
    if (byId) return byId;
  }
  const name = String(ref?.name || '').trim();
  if (!name) return null;
  return sectionsCollection.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') }
  });
}

async function findSectionByName(sectionsCollection, name = '') {
  const token = String(name || '').trim();
  if (!token) return null;
  return sectionsCollection.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(token)}$`, 'i') }
  });
}

async function upsertSectionByName(sectionsCollection, doc) {
  const existing = await findSectionByName(sectionsCollection, doc.name);

  if (!existing) {
    const next = { ...doc, audit: buildAudit(null) };
    await sectionsCollection.insertOne(next);
    console.log(`Inserted section ${next.name} (${next.id}).`);
    return next;
  }

  const next = {
    ...doc,
    id: String(existing.id || doc.id),
    audit: buildAudit(existing.audit)
  };
  await sectionsCollection.updateOne({ _id: existing._id }, { $set: next });
  console.log(`Updated section ${next.name} (${next.id}).`);
  return { ...existing, ...next };
}

async function repairSubsectionRefs(sectionsCollection, refs = []) {
  const output = [];
  const seen = new Set();
  for (const ref of Array.isArray(refs) ? refs : []) {
    // eslint-disable-next-line no-await-in-loop
    const resolved = await findSectionByRef(sectionsCollection, ref || {});
    if (!resolved || !resolved.id) continue;
    const id = String(resolved.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push({ id });
  }
  return output;
}

async function resolveIdByNameMap(sectionsCollection, names = []) {
  const map = new Map();
  for (const name of Array.isArray(names) ? names : []) {
    // eslint-disable-next-line no-await-in-loop
    const section = await findSectionByName(sectionsCollection, name);
    const id = String(section?.id || '').trim();
    if (id) map.set(String(name), id);
  }
  return map;
}

function appendMissingRefs(baseRefs = [], ids = []) {
  const out = Array.isArray(baseRefs) ? baseRefs.slice() : [];
  const seen = new Set(out.map((row) => String(row?.id || '').trim()).filter(Boolean));
  for (const id of Array.isArray(ids) ? ids : []) {
    const token = String(id || '').trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push({ id: token });
  }
  return out;
}

async function updateSectionSubsectionsByName(sectionsCollection, sectionName, nextSubsections = []) {
  const section = await findSectionByName(sectionsCollection, sectionName);
  if (!section) return false;

  const sectionDoc = { ...section };
  delete sectionDoc._id;
  await sectionsCollection.updateOne(
    { _id: section._id },
    {
      $set: {
        ...sectionDoc,
        subsections: Array.isArray(nextSubsections) ? nextSubsections : [],
        audit: buildAudit(section.audit)
      }
    }
  );
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = String(
    args.uri
    || process.env.MONGODB_URI
    || process.env.MONGO_URI
  ).trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI (legacy MONGO_URI supported).');

  const dbName = String(
    args.db
    || process.env.MONGODB_DB
    || process.env.MONGO_DB
    || inferDbNameFromUri(uri)
    || 'app'
  ).trim();

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const sections = db.collection('sections');

    for (const seed of Object.values(SECTION_SEEDS)) {
      // eslint-disable-next-line no-await-in-loop
      await upsertSectionByName(sections, seed);
    }

    const idByName = await resolveIdByNameMap(sections, [
      ...ROOT_REQUIRED_NAMES,
      ...PTE_PEOPLE_REQUIRED_NAMES,
      ...PTE_PEOPLE_EXCLUDE_NAMES,
      ...PTE_AI_ASSISST_REQUIRED_NAMES,
      ...PTE_SCORING_REQUIRED_NAMES,
      ...PTE_ATTEMPT_REQUIRED_NAMES,
      ...PTE_PRACTICE_REQUIRED_NAMES,
      ...PTE_FEEDBACK_REQUIRED_NAMES
    ]);

    const pteRoot = await findSectionByRef(sections, PTE_ROOT_REF);
    if (!pteRoot) {
      console.warn('WARNING: PTE parent section was not found. Sections were upserted but parent links were not repaired.');
    } else {
      const repairedRootRefs = await repairSubsectionRefs(sections, pteRoot.subsections || []);
      const requiredRootIds = ROOT_REQUIRED_NAMES
        .map((name) => idByName.get(name))
        .filter(Boolean);
      const nextRootRefs = appendMissingRefs(repairedRootRefs, requiredRootIds);

      const rootDoc = { ...pteRoot };
      delete rootDoc._id;
      await sections.updateOne(
        { _id: pteRoot._id },
        {
          $set: {
            ...rootDoc,
            id: String(pteRoot.id || PTE_ROOT_REF.id),
            subsections: nextRootRefs,
            audit: buildAudit(pteRoot.audit)
          }
        }
      );
      console.log(`Repaired PTE root subsections. total=${nextRootRefs.length}`);
    }

    const ptePeople = await findSectionByName(sections, 'PTE_PEOPLE');
    if (ptePeople) {
      const repairedPeopleRefs = await repairSubsectionRefs(sections, ptePeople.subsections || []);
      const excludedIds = new Set(
        PTE_PEOPLE_EXCLUDE_NAMES
          .map((name) => idByName.get(name))
          .filter(Boolean)
      );
      const filteredPeopleRefs = repairedPeopleRefs
        .filter((ref) => !excludedIds.has(String(ref?.id || '').trim()));

      const requiredPeopleIds = PTE_PEOPLE_REQUIRED_NAMES
        .map((name) => idByName.get(name))
        .filter(Boolean);
      const nextPeopleRefs = appendMissingRefs(filteredPeopleRefs, requiredPeopleIds);

      const updated = await updateSectionSubsectionsByName(sections, 'PTE_PEOPLE', nextPeopleRefs);
      if (updated) {
        console.log(`Repaired PTE_PEOPLE subsections. total=${nextPeopleRefs.length}`);
      }
    }

    const pteAttempt = await findSectionByName(sections, 'PTE_ATTEMPT');
    if (pteAttempt) {
      const repairedAttemptRefs = await repairSubsectionRefs(sections, pteAttempt.subsections || []);
      const requiredAttemptIds = PTE_ATTEMPT_REQUIRED_NAMES
        .map((name) => idByName.get(name))
        .filter(Boolean);
      const nextAttemptRefs = appendMissingRefs(repairedAttemptRefs, requiredAttemptIds);

      const updated = await updateSectionSubsectionsByName(sections, 'PTE_ATTEMPT', nextAttemptRefs);
      if (updated) {
        console.log(`Repaired PTE_ATTEMPT subsections. total=${nextAttemptRefs.length}`);
      }
    }

    const pteAiAssisst = await findSectionByName(sections, 'PTE_AI_ASSISST');
    if (pteAiAssisst) {
      const repairedAiRefs = await repairSubsectionRefs(sections, pteAiAssisst.subsections || []);
      const requiredAiIds = PTE_AI_ASSISST_REQUIRED_NAMES
        .map((name) => idByName.get(name))
        .filter(Boolean);
      const nextAiRefs = appendMissingRefs(repairedAiRefs, requiredAiIds);

      const updated = await updateSectionSubsectionsByName(sections, 'PTE_AI_ASSISST', nextAiRefs);
      if (updated) {
        console.log(`Repaired PTE_AI_ASSISST subsections. total=${nextAiRefs.length}`);
      }
    }

    const ptePractice = await findSectionByName(sections, 'PTE_PRACTICE');
    if (ptePractice) {
      const repairedPracticeRefs = await repairSubsectionRefs(sections, ptePractice.subsections || []);
      const requiredPracticeIds = PTE_PRACTICE_REQUIRED_NAMES
        .map((name) => idByName.get(name))
        .filter(Boolean);
      const nextPracticeRefs = appendMissingRefs(repairedPracticeRefs, requiredPracticeIds);

      const updated = await updateSectionSubsectionsByName(sections, 'PTE_PRACTICE', nextPracticeRefs);
      if (updated) {
        console.log(`Repaired PTE_PRACTICE subsections. total=${nextPracticeRefs.length}`);
      }
    }

    const pteScoring = await findSectionByName(sections, 'PTE_SCORING');
    if (pteScoring) {
      const repairedScoringRefs = await repairSubsectionRefs(sections, pteScoring.subsections || []);
      const requiredScoringIds = PTE_SCORING_REQUIRED_NAMES
        .map((name) => idByName.get(name))
        .filter(Boolean);
      const nextScoringRefs = appendMissingRefs(repairedScoringRefs, requiredScoringIds);

      const updated = await updateSectionSubsectionsByName(sections, 'PTE_SCORING', nextScoringRefs);
      if (updated) {
        console.log(`Repaired PTE_SCORING subsections. total=${nextScoringRefs.length}`);
      }
    }

    const pteFeedback = await findSectionByName(sections, 'PTE_FEEDBACK');
    if (pteFeedback) {
      const repairedFeedbackRefs = await repairSubsectionRefs(sections, pteFeedback.subsections || []);
      const requiredFeedbackIds = PTE_FEEDBACK_REQUIRED_NAMES
        .map((name) => idByName.get(name))
        .filter(Boolean);
      const nextFeedbackRefs = appendMissingRefs(repairedFeedbackRefs, requiredFeedbackIds);

      const updated = await updateSectionSubsectionsByName(sections, 'PTE_FEEDBACK', nextFeedbackRefs);
      if (updated) {
        console.log(`Repaired PTE_FEEDBACK subsections. total=${nextFeedbackRefs.length}`);
      }
    }

    console.log('PTE sections upsert + relationship repair complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`PTE sections seed failed: ${error.message}`);
  process.exit(1);
});
