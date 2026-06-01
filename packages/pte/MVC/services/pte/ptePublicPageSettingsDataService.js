const ptePublicPageSettingRepository = require('../../repositories/ptePublicPageSettingRepository');
const { settingService, DEFAULTS } = require('./pteCoreContracts');
const { toPublicId } = require('../../utils/idAdapter');

const FREE_ORG_ID = Number(DEFAULTS?.FREE_ORG_ID || 900000);

const DEFAULT_PUBLIC_PAGE = Object.freeze({
  hero: {
    eyebrow: 'PTE Practice App',
    title: 'Prepare for PTE with guided practice, mock exams, and clear feedback.',
    subtitle: 'A practical PTE preparation space for applicants who want to build exam confidence across speaking, writing, reading, and listening.',
    primaryLabel: 'Join And Start Practicing',
    primaryHref: '/pte/join',
    secondaryLabel: 'Sign In',
    secondaryHref: '/login',
    signedInPrimaryLabel: 'Join Public PTE',
    signedInPrimaryHref: '/pte/join',
    signedInSecondaryLabel: 'Open Dashboard',
    signedInSecondaryHref: ''
  },
  imageShowcase: [
    {
      src: '/uploads/ORG_900000/PTE/Question_Bank/chart_1777008503524.webp',
      alt: 'PTE describe image sample with a colorful export volume chart',
      title: 'Describe Image Practice',
      caption: 'Train your response structure with chart, graph, and visual prompts.',
      durationMs: 4500,
      active: true,
      order: 10
    },
    {
      src: '/uploads/ORG_900000/PTE/Question_Bank/chart__1__1777009559266.webp',
      alt: 'PTE describe image sample showing sales channel performance lines',
      title: 'Speaking With Data',
      caption: 'Learn how to summarize trends clearly under exam timing.',
      durationMs: 4500,
      active: true,
      order: 20
    },
    {
      src: '/uploads/ORG_900000/PTE/Question_Bank/chart__2__1777010014581.webp',
      alt: 'PTE describe image sample showing ecommerce growth by category',
      title: 'Smart Visual Practice',
      caption: 'Build fluency for common PTE speaking and interpretation tasks.',
      durationMs: 4500,
      active: true,
      order: 30
    },
    {
      src: '/uploads/ORG_900000/PTE/Question_Bank/chart__3__1777093565501.webp',
      alt: 'PTE describe image sample for chart based speaking practice',
      title: 'Exam-Style Prompts',
      caption: 'Practice with materials that look and feel closer to the test room.',
      durationMs: 4500,
      active: true,
      order: 40
    }
  ],
  highlights: [
    { value: '4 Skills', label: 'Speaking, writing, reading, listening', active: true, order: 10 },
    { value: 'Mock Exams', label: 'Practice with test-like flow and timing', active: true, order: 20 },
    { value: 'AI Feedback', label: 'Review responses and improve faster', active: true, order: 30 }
  ],
  applicantFeatures: [
    {
      icon: 'bi-bullseye',
      title: 'Practice By Skill',
      body: 'Choose the skill you want to improve and work through targeted PTE tasks instead of wandering through a mixed question list.',
      active: true,
      order: 10
    },
    {
      icon: 'bi-pc-display-horizontal',
      title: 'Mock Exam Mode',
      body: 'Run longer practice sessions with a more realistic test rhythm so the timing, pressure, and transitions feel familiar.',
      active: true,
      order: 20
    },
    {
      icon: 'bi-mic-fill',
      title: 'Speaking Tasks',
      body: 'Practice read aloud, repeat sentence, describe image, answer short question, and other speaking-style responses.',
      active: true,
      order: 30
    },
    {
      icon: 'bi-headphones',
      title: 'Listening Practice',
      body: 'Work on dictation, missing word, highlight incorrect words, multiple choice, and listening summary activities.',
      active: true,
      order: 40
    },
    {
      icon: 'bi-pencil-square',
      title: 'Writing Support',
      body: 'Prepare for written summaries and email-style writing with clearer timing, response space, and review flow.',
      active: true,
      order: 50
    },
    {
      icon: 'bi-graph-up-arrow',
      title: 'Progress Feedback',
      body: 'Review attempts, scores, and feedback so you can see what is improving and what needs more attention.',
      active: true,
      order: 60
    }
  ],
  learningPath: [
    {
      step: '01',
      title: 'Join the platform',
      body: 'Create a public account, sign in, and get access to your learning workspace.',
      href: '',
      linkLabel: '',
      active: true,
      order: 10
    },
    {
      step: '02',
      title: 'Buy a suitable package',
      body: 'Browse the public PTE packages and add the package that matches your practice plan to your profile.',
      href: '/pte/packages',
      linkLabel: 'Browse Packages',
      active: true,
      order: 20
    },
    {
      step: '03',
      title: 'Choose a practice focus',
      body: 'Start with one weak area or rotate through all four PTE skills.',
      href: '',
      linkLabel: '',
      active: true,
      order: 30
    },
    {
      step: '04',
      title: 'Complete exam-style tasks',
      body: 'Practice with timers, prompts, audio, visual questions, and response tools.',
      href: '',
      linkLabel: '',
      active: true,
      order: 40
    },
    {
      step: '05',
      title: 'Review and improve',
      body: 'Use feedback and attempt history to decide what to practice next.',
      href: '',
      linkLabel: '',
      active: true,
      order: 50
    }
  ],
  pteOverview: {
    intro: 'PTE, the Pearson Test of English, is a computer-based English language test used by many applicants for study, work, and immigration goals. It measures how well you can understand and use English in academic and real-life communication tasks.',
    points: [
      'PTE tasks are grouped around speaking, writing, reading, and listening skills.',
      'The test is computer delivered, so typing, microphone confidence, and time management matter.',
      'Strong preparation means practicing the format, not only studying grammar or vocabulary.',
      'Applicants often improve faster when they review completed attempts and focus on repeated weak points.'
    ]
  },
  testTypes: [
    {
      title: 'PTE Academic',
      body: 'Commonly used for study abroad and professional pathways where academic English ability must be demonstrated.',
      active: true,
      order: 10
    },
    {
      title: 'PTE Core',
      body: 'Designed around practical English communication and used in some immigration-focused pathways.',
      active: true,
      order: 20
    }
  ],
  skillGroups: [
    { title: 'Speaking', items: ['Read Aloud', 'Repeat Sentence', 'Describe Image', 'Answer Short Question'], active: true, order: 10 },
    { title: 'Writing', items: ['Summarize Written Text', 'Writing Email', 'Organized response planning'], active: true, order: 20 },
    { title: 'Reading', items: ['Multiple Choice', 'Fill In The Blanks', 'Text comprehension'], active: true, order: 30 },
    { title: 'Listening', items: ['Write From Dictation', 'Highlight Incorrect Words', 'Summarize Spoken Text'], active: true, order: 40 }
  ],
  finalCta: {
    title: 'Ready to start your PTE preparation?',
    body: 'Create your account and join the public learning space for PTE practice.',
    primaryLabel: 'Create Account',
    primaryHref: '/pte/join',
    secondaryLabel: 'Browse Packages',
    secondaryHref: '/pte/packages',
    signedInTitle: 'Ready to add public PTE access?',
    signedInBody: 'Join the public PTE space with your current account so public packages can be assigned to the same login.',
    signedInPrimaryLabel: 'Join Public PTE',
    signedInPrimaryHref: '/pte/join',
    signedInSecondaryLabel: 'Browse Packages',
    signedInSecondaryHref: '/pte/packages'
  }
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function valueOrDefault(source, key, fallback = '') {
  return isPlainObject(source) && hasOwn(source, key) ? source[key] : fallback;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanString(value, max = 4000) {
  const out = String(value ?? '').replace(/\0/g, '').trim();
  return out.length > max ? out.slice(0, max) : out;
}

function cleanUrl(value, max = 1000) {
  return cleanString(value, max);
}

function cleanBoolean(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return fallback;
  if (['true', '1', 'yes', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'off'].includes(token)) return false;
  return fallback;
}

function cleanOrder(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return Number(fallback || 0);
  return parsed;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return Number(fallback);
  }
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function normalizeStringList(value, fallback = []) {
  const source = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(/\r?\n/) : fallback);
  return (Array.isArray(source) ? source : [])
    .map((item) => cleanString(isPlainObject(item) ? item.text : item, 400))
    .filter(Boolean);
}

function normalizeOrderedRows(value, fallback, normalizer, { runtime = false } = {}) {
  const source = Array.isArray(value) ? value : fallback;
  const rows = (Array.isArray(source) ? source : [])
    .map((row, index) => normalizer(isPlainObject(row) ? row : {}, index))
    .filter(Boolean);

  const sorted = rows.sort((a, b) => cleanOrder(a.order, 0) - cleanOrder(b.order, 0));
  return runtime ? sorted.filter((row) => row.active !== false) : sorted;
}

function normalizeHero(rawHero = {}, fallbackHero = DEFAULT_PUBLIC_PAGE.hero, { runtime = false, isSignedIn = false, dashboardHref = '/dashboard' } = {}) {
  const source = isPlainObject(rawHero) ? rawHero : {};
  const base = isPlainObject(fallbackHero) ? fallbackHero : {};
  const hero = {
    eyebrow: cleanString(valueOrDefault(source, 'eyebrow', base.eyebrow), 120),
    title: cleanString(valueOrDefault(source, 'title', base.title), 220),
    subtitle: cleanString(valueOrDefault(source, 'subtitle', base.subtitle), 700),
    primaryLabel: cleanString(valueOrDefault(source, 'primaryLabel', base.primaryLabel), 120),
    primaryHref: cleanUrl(valueOrDefault(source, 'primaryHref', base.primaryHref), 500),
    secondaryLabel: cleanString(valueOrDefault(source, 'secondaryLabel', base.secondaryLabel), 120),
    secondaryHref: cleanUrl(valueOrDefault(source, 'secondaryHref', base.secondaryHref), 500),
    signedInPrimaryLabel: cleanString(valueOrDefault(source, 'signedInPrimaryLabel', base.signedInPrimaryLabel), 120),
    signedInPrimaryHref: cleanUrl(valueOrDefault(source, 'signedInPrimaryHref', base.signedInPrimaryHref), 500),
    signedInSecondaryLabel: cleanString(valueOrDefault(source, 'signedInSecondaryLabel', base.signedInSecondaryLabel), 120),
    signedInSecondaryHref: cleanUrl(valueOrDefault(source, 'signedInSecondaryHref', base.signedInSecondaryHref), 500)
  };

  if (runtime && isSignedIn) {
    hero.primaryLabel = hero.signedInPrimaryLabel || hero.primaryLabel;
    hero.primaryHref = hero.signedInPrimaryHref || hero.primaryHref;
    hero.secondaryLabel = hero.signedInSecondaryLabel || hero.secondaryLabel;
    hero.secondaryHref = hero.signedInSecondaryHref || dashboardHref || hero.secondaryHref;
  }

  return hero;
}

function normalizeFinalCta(rawCta = {}, fallbackCta = DEFAULT_PUBLIC_PAGE.finalCta, { runtime = false, isSignedIn = false } = {}) {
  const source = isPlainObject(rawCta) ? rawCta : {};
  const base = isPlainObject(fallbackCta) ? fallbackCta : {};
  const cta = {
    title: cleanString(valueOrDefault(source, 'title', base.title), 220),
    body: cleanString(valueOrDefault(source, 'body', base.body), 700),
    primaryLabel: cleanString(valueOrDefault(source, 'primaryLabel', base.primaryLabel), 120),
    primaryHref: cleanUrl(valueOrDefault(source, 'primaryHref', base.primaryHref), 500),
    secondaryLabel: cleanString(valueOrDefault(source, 'secondaryLabel', base.secondaryLabel), 120),
    secondaryHref: cleanUrl(valueOrDefault(source, 'secondaryHref', base.secondaryHref), 500),
    signedInTitle: cleanString(valueOrDefault(source, 'signedInTitle', base.signedInTitle), 220),
    signedInBody: cleanString(valueOrDefault(source, 'signedInBody', base.signedInBody), 700),
    signedInPrimaryLabel: cleanString(valueOrDefault(source, 'signedInPrimaryLabel', base.signedInPrimaryLabel), 120),
    signedInPrimaryHref: cleanUrl(valueOrDefault(source, 'signedInPrimaryHref', base.signedInPrimaryHref), 500),
    signedInSecondaryLabel: cleanString(valueOrDefault(source, 'signedInSecondaryLabel', base.signedInSecondaryLabel), 120),
    signedInSecondaryHref: cleanUrl(valueOrDefault(source, 'signedInSecondaryHref', base.signedInSecondaryHref), 500)
  };

  if (runtime && isSignedIn) {
    cta.title = cta.signedInTitle || cta.title;
    cta.body = cta.signedInBody || cta.body;
    cta.primaryLabel = cta.signedInPrimaryLabel || cta.primaryLabel;
    cta.primaryHref = cta.signedInPrimaryHref || cta.primaryHref;
    cta.secondaryLabel = cta.signedInSecondaryLabel || cta.secondaryLabel;
    cta.secondaryHref = cta.signedInSecondaryHref || cta.secondaryHref;
  }

  return cta;
}

function normalizePage(rawPage = {}, options = {}) {
  const runtime = options.runtime === true;
  const isSignedIn = options.isSignedIn === true;
  const dashboardHref = cleanUrl(options.dashboardHref || '/dashboard', 500) || '/dashboard';
  const input = isPlainObject(rawPage) ? rawPage : {};

  return {
    hero: normalizeHero(input.hero, DEFAULT_PUBLIC_PAGE.hero, { runtime, isSignedIn, dashboardHref }),
    imageShowcase: normalizeOrderedRows(input.imageShowcase, DEFAULT_PUBLIC_PAGE.imageShowcase, (row, index) => {
      const src = cleanUrl(row.src, 1000);
      if (!src && runtime) return null;
      return {
        src,
        alt: cleanString(row.alt, 220),
        title: cleanString(row.title, 180),
        caption: cleanString(row.caption, 400),
        durationMs: clampNumber(row.durationMs, 1000, 60000, 4500),
        active: cleanBoolean(row.active, true),
        order: cleanOrder(row.order, (index + 1) * 10)
      };
    }, { runtime }),
    highlights: normalizeOrderedRows(input.highlights, DEFAULT_PUBLIC_PAGE.highlights, (row, index) => {
      const value = cleanString(row.value, 80);
      const label = cleanString(row.label, 180);
      if (runtime && !value && !label) return null;
      return {
        value,
        label,
        active: cleanBoolean(row.active, true),
        order: cleanOrder(row.order, (index + 1) * 10)
      };
    }, { runtime }),
    applicantFeatures: normalizeOrderedRows(input.applicantFeatures, DEFAULT_PUBLIC_PAGE.applicantFeatures, (row, index) => {
      const title = cleanString(row.title, 180);
      const body = cleanString(row.body, 700);
      if (runtime && !title && !body) return null;
      return {
        icon: cleanString(row.icon || 'bi-check2-circle', 80),
        title,
        body,
        active: cleanBoolean(row.active, true),
        order: cleanOrder(row.order, (index + 1) * 10)
      };
    }, { runtime }),
    learningPath: normalizeOrderedRows(input.learningPath, DEFAULT_PUBLIC_PAGE.learningPath, (row, index) => {
      const title = cleanString(row.title, 180);
      const body = cleanString(row.body, 700);
      if (runtime && !title && !body) return null;
      return {
        step: cleanString(row.step || String(index + 1).padStart(2, '0'), 20),
        title,
        body,
        href: cleanUrl(row.href, 500),
        linkLabel: cleanString(row.linkLabel, 120),
        active: cleanBoolean(row.active, true),
        order: cleanOrder(row.order, (index + 1) * 10)
      };
    }, { runtime }),
    pteOverview: {
      intro: cleanString(valueOrDefault(input?.pteOverview, 'intro', DEFAULT_PUBLIC_PAGE.pteOverview.intro), 1200),
      points: normalizeStringList(input?.pteOverview?.points, DEFAULT_PUBLIC_PAGE.pteOverview.points)
    },
    testTypes: normalizeOrderedRows(input.testTypes, DEFAULT_PUBLIC_PAGE.testTypes, (row, index) => {
      const title = cleanString(row.title, 180);
      const body = cleanString(row.body, 700);
      if (runtime && !title && !body) return null;
      return {
        title,
        body,
        active: cleanBoolean(row.active, true),
        order: cleanOrder(row.order, (index + 1) * 10)
      };
    }, { runtime }),
    skillGroups: normalizeOrderedRows(input.skillGroups, DEFAULT_PUBLIC_PAGE.skillGroups, (row, index) => {
      const title = cleanString(row.title, 120);
      const items = normalizeStringList(row.items, []);
      if (runtime && !title && !items.length) return null;
      return {
        title,
        items,
        active: cleanBoolean(row.active, true),
        order: cleanOrder(row.order, (index + 1) * 10)
      };
    }, { runtime }),
    finalCta: normalizeFinalCta(input.finalCta, DEFAULT_PUBLIC_PAGE.finalCta, { runtime, isSignedIn })
  };
}

function resolveConfiguredOrgId(settingKey, fallbackValue) {
  const raw = settingService.getValue('organization', settingKey);
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const fallbackParsed = Number.parseInt(String(fallbackValue ?? '').trim(), 10);
  if (Number.isFinite(fallbackParsed) && fallbackParsed > 0) return fallbackParsed;
  return FREE_ORG_ID;
}

function resolvePteJoinOrgOverride(fallbackValue) {
  const envParsed = Number.parseInt(String(process.env.PTE_JOIN_ORG_ID ?? '').trim(), 10);
  if (Number.isFinite(envParsed) && envParsed > 0) return envParsed;

  const packageSetting = settingService.getValue('pte', 'joinOrgId');
  const packageParsed = Number.parseInt(String(packageSetting ?? '').trim(), 10);
  if (Number.isFinite(packageParsed) && packageParsed > 0) return packageParsed;

  const fallbackParsed = Number.parseInt(String(fallbackValue ?? '').trim(), 10);
  if (Number.isFinite(fallbackParsed) && fallbackParsed > 0) return fallbackParsed;
  return FREE_ORG_ID;
}

function resolvePteJoinOrgId() {
  const freeOrgId = resolveConfiguredOrgId('freeOrgId', FREE_ORG_ID);
  return toPublicId(resolvePteJoinOrgOverride(freeOrgId));
}

function buildCreator(requestingUser = {}, orgId = '') {
  const user = requestingUser && typeof requestingUser === 'object' ? requestingUser : {};
  const nameValue = isPlainObject(user.name)
    ? [user.name.preferred, user.name.first, user.name.last].filter(Boolean).join(' ')
    : user.name;
  const displayName = cleanString(user.displayName || nameValue || user.username || user.email || user.id || '', 180);
  return {
    type: user.id ? 'user' : 'system',
    userId: cleanString(user.id, 160),
    username: cleanString(user.username, 140),
    email: cleanString(user.email, 220),
    displayName: displayName || 'System',
    orgId: toPublicId(orgId)
  };
}

function parsePagePayload(payload = {}) {
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch (_) {
      throw new Error('Invalid page JSON payload.');
    }
  }
  if (isPlainObject(payload?.page)) return payload.page;
  if (typeof payload?.pageJson === 'string') return parsePagePayload(payload.pageJson);
  if (isPlainObject(payload)) {
    const knownPageKeys = [
      'hero',
      'imageShowcase',
      'highlights',
      'applicantFeatures',
      'learningPath',
      'pteOverview',
      'testTypes',
      'skillGroups',
      'finalCta'
    ];
    if (knownPageKeys.some((key) => Object.prototype.hasOwnProperty.call(payload, key))) {
      return payload;
    }
  }
  throw new Error('No PTE public page settings were submitted. Please refresh the page and save again.');
}

async function getSettingsRecord(options = {}) {
  const orgId = toPublicId(options.orgId || resolvePteJoinOrgId());
  const existing = await ptePublicPageSettingRepository.getByOrgId(orgId, options);
  return {
    orgId,
    record: existing || null
  };
}

async function getPublicPageModel({ user = null, dashboardHref = '/dashboard' } = {}) {
  const { record } = await getSettingsRecord();
  return normalizePage(record?.page || DEFAULT_PUBLIC_PAGE, {
    runtime: true,
    isSignedIn: Boolean(user),
    dashboardHref
  });
}

async function getSettingsForManagement(requestingUser, options = {}) {
  const { orgId, record } = await getSettingsRecord(options);
  return {
    orgId,
    hasSavedSettings: Boolean(record?.id),
    settingId: record?.id || '',
    updatedAt: record?.updatedAt || record?.audit?.lastUpdateDateTime || '',
    page: normalizePage(record?.page || DEFAULT_PUBLIC_PAGE, { runtime: false }),
    defaults: deepClone(DEFAULT_PUBLIC_PAGE)
  };
}

async function saveSettings(payload = {}, requestingUser = {}, options = {}) {
  const orgId = toPublicId(options.orgId || resolvePteJoinOrgId());
  if (!orgId) throw new Error('Public PTE organization is not configured.');

  const incomingPage = parsePagePayload(payload);
  const normalizedPage = normalizePage(incomingPage, { runtime: false });
  const saved = await ptePublicPageSettingRepository.upsertForOrgId({
    orgId,
    page: normalizedPage,
    isActive: true,
    creator: buildCreator(requestingUser, orgId)
  }, {
    scope: { canViewAll: false, orgId }
  });

  return {
    orgId,
    settingId: saved?.id || '',
    updatedAt: saved?.updatedAt || saved?.audit?.lastUpdateDateTime || '',
    page: normalizePage(saved?.page || normalizedPage, { runtime: false })
  };
}

module.exports = {
  DEFAULT_PUBLIC_PAGE,
  normalizePage,
  resolvePteJoinOrgId,
  getPublicPageModel,
  getSettingsForManagement,
  saveSettings
};
