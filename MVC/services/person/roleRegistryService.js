const fs = require('fs');
const path = require('path');
const { resolveRepositoryBackendMode } = require('../../repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = require('../../infrastructure/mongo/mongoConnection');

const ROLE_DATA_PATH = path.join(__dirname, '../../../data/roles.json');
const CACHE_TTL_MS = 2000;

const LEGACY_SYSTEM_ROLE_KEYS = Object.freeze([
  'school_student',
  'school_teacher',
  'school_staff',
  'pte_student',
  'pte_student_public',
  'pte_teacher',
  'pte_instructor',
  'pte_trainer',
  'credit_customer'
]);

const LEGACY_SYSTEM_ROLE_ALIAS = Object.freeze({
  schoolstudent: 'school_student',
  'school-student': 'school_student',
  schoolstudents: 'school_student',
  'school-students': 'school_student',
  schoolteacher: 'school_teacher',
  'school-teacher': 'school_teacher',
  schoolteachers: 'school_teacher',
  'school-teachers': 'school_teacher',
  schoolstaff: 'school_staff',
  'school-staff': 'school_staff',
  schoolstaffs: 'school_staff',
  'school-staffs': 'school_staff',
  ptestudent: 'pte_student',
  'pte-student': 'pte_student',
  ptestudents: 'pte_student',
  'pte-students': 'pte_student',
  ptestudentpublic: 'pte_student_public',
  'pte-student-public': 'pte_student_public',
  ptestudentspublic: 'pte_student_public',
  'pte-students-public': 'pte_student_public',
  pteteacher: 'pte_teacher',
  'pte-teacher': 'pte_teacher',
  pteteachers: 'pte_teacher',
  'pte-teachers': 'pte_teacher',
  pteinstructor: 'pte_instructor',
  'pte-instructor': 'pte_instructor',
  pteinstructors: 'pte_instructor',
  'pte-instructors': 'pte_instructor',
  ptetrainer: 'pte_trainer',
  'pte-trainer': 'pte_trainer',
  ptetrainers: 'pte_trainer',
  'pte-trainers': 'pte_trainer',
  creditcustomer: 'credit_customer',
  'credit-customer': 'credit_customer',
  creditcustomers: 'credit_customer',
  'credit-customers': 'credit_customer'
});

const DEPRECATED_ROLE_KEYS = Object.freeze([
  'student',
  'teacher',
  'staff',
  'pte_studnet'
]);

const DEPRECATED_ROLE_TOKENS = Object.freeze([
  ...DEPRECATED_ROLE_KEYS,
  'students',
  'teachers',
  'staffs',
  'stuff',
  'ptestudnet',
  'pte-studnet',
  'pte_studnets',
  'ptestudnets'
]);

const LEGACY_MANUAL_TAG_PRESETS = Object.freeze([
  'user',
  'admin',
  'developer',
  'support',
  'mentor',
  'reviewer',
  'finance',
  'operations',
  'qa',
  'content',
  'sample-data',
  'sample-student',
  'sample-teacher',
  'sample-staff'
]);

let registryCache = {
  expiresAt: 0,
  payload: null
};

function normalizeRoleToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
}

function dedupe(values = []) {
  return Array.from(new Set((values || []).map(normalizeRoleToken).filter(Boolean)));
}

function toTitleCase(value = '') {
  return String(value || '')
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function resolvePackageNameForKey(key = '') {
  const token = normalizeRoleToken(key);
  if (token.startsWith('school_')) {
    return 'SCHOOL';
  }
  if (token.startsWith('pte_')) return 'PTE';
  if (token.startsWith('credit_')) return 'CREDIT';
  return 'CORE';
}

function resolveDomainForKey(key = '') {
  const token = normalizeRoleToken(key);
  if (token.startsWith('school_')) {
    return 'school';
  }
  if (token.startsWith('pte_')) return 'pte';
  if (token.startsWith('credit_')) return 'credit';
  return 'core';
}

function createBuiltInRoleRow(key, overrides = {}) {
  const token = normalizeRoleToken(key);
  return {
    key: token,
    label: toTitleCase(token),
    description: '',
    domain: resolveDomainForKey(token),
    packageName: resolvePackageNameForKey(token),
    aliases: [],
    active: true,
    system: false,
    ...overrides
  };
}

function buildBuiltInRoleSeedRows() {
  const rows = [];
  const byKey = new Map();

  LEGACY_SYSTEM_ROLE_KEYS.forEach((key) => {
    const row = createBuiltInRoleRow(key, { system: true });
    rows.push(row);
    byKey.set(row.key, row);
  });

  LEGACY_MANUAL_TAG_PRESETS.forEach((key) => {
    if (byKey.has(normalizeRoleToken(key))) return;
    const row = createBuiltInRoleRow(key, { system: false });
    rows.push(row);
    byKey.set(row.key, row);
  });

  Object.entries(LEGACY_SYSTEM_ROLE_ALIAS).forEach(([alias, key]) => {
    const canonical = normalizeRoleToken(key);
    const row = byKey.get(canonical);
    if (!row) return;
    row.aliases = dedupe([...(row.aliases || []), alias]);
  });

  return rows;
}

function normalizeRoleRow(raw = {}, fallback = {}) {
  const key = normalizeRoleToken(raw.key || fallback.key || '');
  if (!key) return null;
  if (isDeprecatedRoleKey(key)) return null;

  const aliases = dedupe(raw.aliases || fallback.aliases || [])
    .filter((alias) => alias !== key && !isDeprecatedRoleToken(alias));

  const packageName = String(raw.packageName || fallback.packageName || resolvePackageNameForKey(key))
    .trim()
    .toUpperCase();

  return {
    id: String(raw.id || fallback.id || '').trim(),
    key,
    label: String(raw.label || fallback.label || toTitleCase(key)).trim() || toTitleCase(key),
    description: String(raw.description || fallback.description || '').trim(),
    domain: normalizeRoleToken(raw.domain || fallback.domain || resolveDomainForKey(key)),
    packageName: packageName || resolvePackageNameForKey(key),
    aliases,
    active: raw.active !== false,
    system: raw.system === true
  };
}

function isDeprecatedRoleKey(value = '') {
  const token = normalizeRoleToken(value);
  return DEPRECATED_ROLE_KEYS.includes(token);
}

function isDeprecatedRoleToken(value = '') {
  const token = normalizeRoleToken(value);
  return DEPRECATED_ROLE_TOKENS.includes(token);
}

function isDeprecatedGenericSchoolRoleKey(value = '') {
  return ['student', 'teacher', 'staff'].includes(normalizeRoleToken(value));
}

function isDeprecatedGenericSchoolRoleToken(value = '') {
  return ['student', 'teacher', 'staff', 'students', 'teachers', 'staffs', 'stuff'].includes(normalizeRoleToken(value));
}

function pluralVariant(key = '') {
  const token = normalizeRoleToken(key);
  if (!token) return '';
  if (token.endsWith('s')) return token;
  return `${token}s`;
}

function compactVariant(key = '') {
  return normalizeRoleToken(key).replace(/[_-]/g, '');
}

function buildRoleRegistry(rows = []) {
  const builtIns = buildBuiltInRoleSeedRows();
  const mergedInput = Array.isArray(rows) && rows.length ? rows : builtIns;
  const normalizedRows = [];
  const roleByKey = new Map();

  mergedInput.forEach((row) => {
    const normalized = normalizeRoleRow(row);
    if (!normalized) return;
    if (roleByKey.has(normalized.key)) return;
    roleByKey.set(normalized.key, normalized);
    normalizedRows.push(normalized);
  });

  // Ensure built-in minimum coverage even if the file is partial.
  builtIns.forEach((row) => {
    const normalized = normalizeRoleRow(row);
    if (!normalized) return;
    if (roleByKey.has(normalized.key)) return;
    roleByKey.set(normalized.key, normalized);
    normalizedRows.push(normalized);
  });

  const activeRoles = normalizedRows.filter((row) => row.active !== false);
  const systemRoles = activeRoles.filter((row) => row.system === true);
  const userDefinedRoles = activeRoles.filter((row) => row.system !== true);

  const systemRoleKeys = systemRoles.map((row) => row.key);
  const manualTagPresets = userDefinedRoles.map((row) => row.key);

  const systemRoleAlias = {};
  systemRoles.forEach((row) => {
    const variants = dedupe([
      row.key,
      ...row.aliases,
      pluralVariant(row.key),
      compactVariant(row.key),
      pluralVariant(compactVariant(row.key))
    ]);
    variants.forEach((alias) => {
      systemRoleAlias[alias] = row.key;
    });
  });

  const audienceAliasToCanonical = {
    all: 'all',
    user: 'user',
    users: 'user',
    member: 'user',
    members: 'user'
  };
  const audienceCanonicalExtra = {
    user: ['users']
  };

  activeRoles.forEach((row) => {
    const key = row.key;
    const keyPlural = pluralVariant(key);
    const variants = dedupe([
      key,
      ...row.aliases,
      keyPlural,
      compactVariant(key),
      pluralVariant(compactVariant(key))
    ]);
    variants.forEach((alias) => {
      audienceAliasToCanonical[alias] = key;
    });
    if (keyPlural && keyPlural !== key) {
      audienceCanonicalExtra[key] = dedupe([...(audienceCanonicalExtra[key] || []), keyPlural]);
    }
  });

  return {
    roles: normalizedRows,
    activeRoles,
    systemRoleKeys: dedupe(systemRoleKeys),
    manualTagPresets: dedupe(manualTagPresets),
    systemRoleAlias,
    audienceAliasToCanonical,
    audienceCanonicalExtra
  };
}

function readRolesFromJsonSync() {
  try {
    const raw = fs.readFileSync(ROLE_DATA_PATH, 'utf8');
    const cleaned = String(raw || '').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function getRoleRegistrySnapshot() {
  const now = Date.now();
  if (registryCache.payload && registryCache.expiresAt > now) {
    return registryCache.payload;
  }

  const rows = readRolesFromJsonSync();
  const payload = buildRoleRegistry(rows);
  registryCache = {
    payload,
    expiresAt: now + CACHE_TTL_MS
  };
  return payload;
}

async function getRoleRegistry(options = {}) {
  const mode = resolveRepositoryBackendMode(options || {});
  if (mode !== 'mongo') return getRoleRegistrySnapshot();

  try {
    const collection = getMongoCollection('roles');
    const rows = await collection
      .find({})
      .sort({ key: 1, id: 1 })
      .limit(5000)
      .toArray();
    const normalizedRows = (Array.isArray(rows) ? rows : []).map((row) => ({
      ...(row || {}),
      id: String(row?.id || row?._id || '').trim()
    }));
    return buildRoleRegistry(normalizedRows);
  } catch (_) {
    return getRoleRegistrySnapshot();
  }
}

function clearRoleRegistryCache() {
  registryCache = {
    expiresAt: 0,
    payload: null
  };
}

module.exports = {
  normalizeRoleToken,
  dedupe,
  isDeprecatedRoleKey,
  isDeprecatedRoleToken,
  isDeprecatedGenericSchoolRoleKey,
  isDeprecatedGenericSchoolRoleToken,
  buildBuiltInRoleSeedRows,
  buildRoleRegistry,
  getRoleRegistrySnapshot,
  getRoleRegistry,
  clearRoleRegistryCache
};
