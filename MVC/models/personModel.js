// MVC/models/personModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');
const { toIdArray, toPublicId, idsEqual } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');
const { projectPersonForRead } = require('../services/person/personTagProjectionService');
const roleRegistryService = require('../services/person/roleRegistryService');

const dataPath = path.join(__dirname, '../../data/persons.json');

const PERSON_SYSTEM_TAG_KEYS = Object.freeze([
  // School domain-managed roles
  'school_student',
  'school_teacher',
  'school_staff',
  // Credit domain-managed roles
  'credit_customer'
]);
const PERSON_SYSTEM_TAG_ALIAS = Object.freeze({
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
  creditcustomer: 'credit_customer',
  'credit-customer': 'credit_customer',
  creditcustomers: 'credit_customer',
  'credit-customers': 'credit_customer'
});
const PERSON_MANUAL_TAG_PRESETS = Object.freeze([
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

const AUDIENCE_ALIAS_TO_CANONICAL = Object.freeze({
  all: 'all',
  user: 'user',
  users: 'user',
  member: 'user',
  members: 'user',
  admin: 'admin',
  admins: 'admin',
  developer: 'developer',
  developers: 'developer',
  dev: 'developer',
  support: 'support',
  supports: 'support',
  school_student: 'school_student',
  school_students: 'school_student',
  schoolstudent: 'school_student',
  schoolstudents: 'school_student',
  school_teacher: 'school_teacher',
  school_teachers: 'school_teacher',
  schoolteacher: 'school_teacher',
  schoolteachers: 'school_teacher',
  school_staff: 'school_staff',
  school_staffs: 'school_staff',
  schoolstaff: 'school_staff',
  schoolstaffs: 'school_staff',
  credit_customer: 'credit_customer',
  credit_customers: 'credit_customer',
  creditcustomer: 'credit_customer',
  creditcustomers: 'credit_customer'
});
const AUDIENCE_CANONICAL_EXTRA = Object.freeze({
  user: ['users'],
  admin: ['admins'],
  developer: ['developers'],
  support: ['supports'],
  school_student: ['school_students'],
  school_teacher: ['school_teachers'],
  school_staff: ['school_staffs'],
  credit_customer: ['credit_customers']
});

async function readAllPersonsRaw() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    const cleaned = String(data || '').replace(/^\uFEFF/, '');
    return JSON.parse(cleaned);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve persons');
  }
}

function normalizeTagToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
}

function toTagArray(tagsInput) {
  if (!tagsInput) return [];
  if (Array.isArray(tagsInput)) return tagsInput;
  return String(tagsInput)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function dedupeTags(values) {
  return Array.from(new Set((values || []).map(normalizeTagToken).filter(Boolean)));
}

function getRoleRegistrySnapshot() {
  return roleRegistryService.getRoleRegistrySnapshot();
}

function canonicalSystemRoleTag(value) {
  const normalized = normalizeTagToken(value);
  if (!normalized) return null;
  const registry = getRoleRegistrySnapshot();
  const systemKeys = new Set(dedupeTags(registry.systemRoleKeys || []));
  const aliasMap = registry.systemRoleAlias || {};
  if (systemKeys.has(normalized)) return normalized;
  return aliasMap[normalized] || null;
}

function canonicalAudienceTag(value) {
  const normalized = normalizeTagToken(value);
  if (!normalized) return null;
  const registry = getRoleRegistrySnapshot();
  const audienceAlias = registry.audienceAliasToCanonical || AUDIENCE_ALIAS_TO_CANONICAL;
  return audienceAlias[normalized] || normalized;
}

function normalizeManualTagsLenient(tagsInput) {
  return dedupeTags(toTagArray(tagsInput)).filter((tag) => !canonicalSystemRoleTag(tag));
}

function normalizeManualTags(tagsInput) {
  const normalizedInput = dedupeTags(toTagArray(tagsInput));
  const blockedSystemTags = normalizedInput
    .map((tag) => canonicalSystemRoleTag(tag))
    .filter(Boolean);
  if (blockedSystemTags.length > 0) {
    const uniqueBlocked = dedupeTags(blockedSystemTags);
    throw new Error(`System tags cannot be set manually: ${uniqueBlocked.join(', ')}.`);
  }

  const registry = getRoleRegistrySnapshot();
  const manualPresets = Array.isArray(registry.manualTagPresets) && registry.manualTagPresets.length
    ? registry.manualTagPresets
    : PERSON_MANUAL_TAG_PRESETS;
  const allowedSet = new Set(manualPresets.map((t) => normalizeTagToken(t)));
  const unknown = normalizedInput.filter((tag) => !allowedSet.has(tag));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown manual tag(s): ${unknown.join(', ')}. Allowed manual tags: ${manualPresets.join(', ')}.`
    );
  }

  return normalizedInput;
}

function normalizeAnyTagList(tagsInput) {
  return dedupeTags(toTagArray(tagsInput));
}

function normalizeOrganizationMembership(org, fallbackJoinedAt) {
  const rawRoles = Array.isArray(org?.roles) ? org.roles : (org?.role ? [org.role] : []);
  const normalizedRoles = rawRoles
    .map((r) => String(r || '').trim().toLowerCase())
    .filter(Boolean)
    .filter((r, idx, arr) => arr.indexOf(r) === idx);

  if (!normalizedRoles.length) normalizedRoles.push('member');

  const orgIdRaw = org?.orgId;
  const orgIdNumber = Number(orgIdRaw);
  return {
    ...org,
    orgId: Number.isFinite(orgIdNumber) ? orgIdNumber : orgIdRaw,
    roles: normalizedRoles,
    role: normalizedRoles[0],
    memberStatus: String(org?.memberStatus || 'active').trim().toLowerCase() || 'active',
    joinedAt: org?.joinedAt || fallbackJoinedAt || new Date().toISOString()
  };
}

function normalizeOrganizationsForPerson(person) {
  if (!person || !Array.isArray(person.organizations)) return;
  const now = new Date().toISOString();
  person.organizations = person.organizations.map((org) => normalizeOrganizationMembership(org, now));
}

function collectAudienceRolesFromOrganizations(person) {
  const orgList = Array.isArray(person?.organizations) ? person.organizations : [];
  const roles = [];
  orgList.forEach((org) => {
    const rawRoles = Array.isArray(org?.roles) ? org.roles : (org?.role ? [org.role] : []);
    rawRoles.forEach((role) => {
      const token = normalizeTagToken(role);
      if (token) roles.push(token);
    });
  });
  return dedupeTags(roles);
}

function resolvePersonEnrichmentOptions(options = {}) {
  return {
    includeSchoolRoles: options?.includeSchoolRoles === true
  };
}

let cachedSchoolRoleTagProvider;
function getSchoolRoleTagProvider() {
  if (cachedSchoolRoleTagProvider !== undefined) return cachedSchoolRoleTagProvider;
  try {
    cachedSchoolRoleTagProvider = require('../services/school/schoolRoleTagProvider');
  } catch (error) {
    cachedSchoolRoleTagProvider = null;
  }
  return cachedSchoolRoleTagProvider;
}

async function resolveSchoolRoleIndexForEnrichment(enrichment = {}) {
  if (enrichment?.includeSchoolRoles === false) return null;
  const provider = getSchoolRoleTagProvider();
  if (!provider || typeof provider.buildSchoolRoleIndex !== 'function') return null;
  return await provider.buildSchoolRoleIndex();
}

function hydratePersonForRead(rawPerson, options = {}) {
  const p = JSON.parse(JSON.stringify(rawPerson || {}));
  normalizeOrganizationsForPerson(p);
  const enrichment = resolvePersonEnrichmentOptions(options?.enrichment || options);
  const schoolRoleIndex = options?.schoolRoleIndex || null;
  const personId = toPublicId(p?.id);
  const schoolSystemTags = (
    enrichment.includeSchoolRoles && personId
      ? Array.from((schoolRoleIndex && schoolRoleIndex.get(String(personId).trim())) || [])
      : []
  );
  const registry = getRoleRegistrySnapshot();
  return projectPersonForRead(p, {
    systemRoleKeys: registry.systemRoleKeys || PERSON_SYSTEM_TAG_KEYS,
    systemRoleAlias: registry.systemRoleAlias || PERSON_SYSTEM_TAG_ALIAS,
    domainSystemTags: schoolSystemTags,
    cloneInput: false
  });
}

function preparePersonForPersist(rawPerson) {
  const p = { ...(rawPerson || {}) };
  const manualTags = normalizeManualTags(p.manualTags ?? p.tags ?? []);
  p.manualTags = manualTags;
  p.tags = manualTags; // persisted user-editable tags only
  delete p.systemTags;
  return p;
}

function buildAudienceTagsFromPerson(person) {
  const manual = normalizeManualTagsLenient(person?.manualTags ?? []);
  const system = normalizeAnyTagList(person?.systemTags ?? []);
  const merged = normalizeAnyTagList(person?.tags ?? []);
  const orgRoles = collectAudienceRolesFromOrganizations(person);

  const canonical = dedupeTags(
    ['all', 'user', ...manual, ...system, ...merged, ...orgRoles]
      .map(canonicalAudienceTag)
      .filter(Boolean)
  );

  const expanded = [...canonical];
  const registry = getRoleRegistrySnapshot();
  const canonicalExtra = registry.audienceCanonicalExtra || AUDIENCE_CANONICAL_EXTRA;
  canonical.forEach((token) => {
    const extra = canonicalExtra[token];
    if (Array.isArray(extra)) expanded.push(...extra);
  });
  return dedupeTags(expanded);
}

// Get all persons (hydrated with manual/system/merged tags)
async function getAllPersons(options = {}) {
  const enrichment = resolvePersonEnrichmentOptions(options?.enrichment || options);
  const persons = await readAllPersonsRaw();
  const schoolRoleIndex = await resolveSchoolRoleIndexForEnrichment(enrichment);
  return persons.map((p) => hydratePersonForRead(p, { enrichment, schoolRoleIndex }));
}

function personBelongsToOrganization(person, orgId) {
  const memberships = Array.isArray(person?.organizations) ? person.organizations : [];
  return memberships.some((org) => idsEqual(org?.orgId, orgId));
}

async function findPersonsByOrganizationId(orgId, options = {}) {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) return [];

  const enrichment = resolvePersonEnrichmentOptions(options?.enrichment || options);
  const limit = Number(options?.limit) > 0 ? Number(options.limit) : null;
  const persons = await readAllPersonsRaw();
  const schoolRoleIndex = await resolveSchoolRoleIndexForEnrichment(enrichment);
  const matches = [];

  for (const rawPerson of persons) {
    const person = { ...(rawPerson || {}) };
    normalizeOrganizationsForPerson(person);
    if (!personBelongsToOrganization(person, targetOrgId)) continue;
    matches.push(hydratePersonForRead(person, { enrichment, schoolRoleIndex }));
    if (limit && matches.length >= limit) break;
  }

  return matches;
}

async function countPersonsByOrganizationId(orgId) {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) return 0;

  const persons = await readAllPersonsRaw();
  let count = 0;
  for (const rawPerson of persons) {
    const person = { ...(rawPerson || {}) };
    normalizeOrganizationsForPerson(person);
    if (personBelongsToOrganization(person, targetOrgId)) count += 1;
  }
  return count;
}

async function existsPersonByOrganizationId(orgId) {
  return (await countPersonsByOrganizationId(orgId)) > 0;
}

function applyPersonScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;

  const allowedPersonIds = Array.isArray(scope?.personIds)
    ? new Set(toIdArray(scope.personIds))
    : null;

  if (allowedPersonIds && allowedPersonIds.size > 0) {
    return list.filter((row) => allowedPersonIds.has(toPublicId(row?.id)));
  }

  return [];
}

function buildPersonQueryPlan(options = {}) {
  const query = options?.query || {};
  const incomingScope = options?.scope || {};

  return {
    entity: 'persons',
    query,
    scope: {
      canViewAll: incomingScope?.canViewAll !== false,
      personIds: Array.isArray(incomingScope?.personIds) ? toIdArray(incomingScope.personIds) : []
    },
    enrichment: resolvePersonEnrichmentOptions(options?.enrichment || options),
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['id', 'name.first', 'name.last', 'contact.email', 'contact.emails[0].email'],
      dateFields: ['audit.createDateTime', 'audit.lastUpdateDateTime', 'createdAt', 'date']
    }
  };
}

async function queryPersons(options = {}) {
  const plan = buildPersonQueryPlan(options);
  const executor = getEntityQueryExecutor('persons');

  // Future DB adapter path (Mongo/NoSQL): if registered, model delegates query execution.
  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  // JSON fallback path: keep existing behavior while migration is in progress.
  const getAllPersonsFn = module.exports?.getAllPersons;
  const allPersons = await (typeof getAllPersonsFn === 'function'
    ? getAllPersonsFn({ enrichment: plan.enrichment })
    : getAllPersons({ enrichment: plan.enrichment }));
  const scopedPersons = applyPersonScope(allPersons, plan.scope);
  return applyGenericFilter(scopedPersons, plan.query, plan.fallback);
}

// Get a single person by id (hydrated)
async function getPersonById(id, options = {}) {
  const enrichment = resolvePersonEnrichmentOptions(options?.enrichment || options);
  const persons = await readAllPersonsRaw();
  const found = persons.find((p) => idsEqual(p?.id, id));
  if (!found) return null;
  const schoolRoleIndex = await resolveSchoolRoleIndexForEnrichment(enrichment);
  return hydratePersonForRead(found, { enrichment, schoolRoleIndex });
}

async function getAudienceTagsForPerson(personId, options = {}) {
  const person = await getPersonById(personId, options);
  if (!person) return ['all', 'user'];
  return buildAudienceTagsFromPerson(person);
}

// Generate a simple random id as string
function generateId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/* ---------------- VALIDATION ---------------- */
function validateData(person) {
  const errors = [];

  // Allows letters, spaces, hyphens, apostrophes.
  const nameRegex = /^[a-zA-Z\s\-']+$/;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!person || typeof person !== 'object') {
    return { isValid: false, errors: ['No person data provided'] };
  }

  if (!person.name?.first?.trim()) {
    errors.push('First Name is required.');
  } else if (!nameRegex.test(person.name.first)) {
    errors.push('First Name contains invalid characters.');
  }

  if (!person.name?.last?.trim()) {
    errors.push('Last Name is required.');
  } else if (!nameRegex.test(person.name.last)) {
    errors.push('Last Name contains invalid characters.');
  }

  if (person.name?.middle && !nameRegex.test(person.name.middle)) {
    errors.push('Middle Name contains invalid characters.');
  }

  if (!person.demographics?.dateOfBirth) {
    errors.push('Date of Birth is required.');
  } else {
    const dob = new Date(person.demographics.dateOfBirth);
    const now = new Date();
    if (Number.isNaN(dob.getTime())) {
      errors.push('Date of Birth is not a valid date.');
    } else if (dob > now) {
      errors.push('Date of Birth cannot be in the future.');
    } else if (dob.getFullYear() < 1900) {
      errors.push('Date of Birth is unreasonably old (before 1900).');
    }
  }

  const validGenders = ['male', 'female', 'nonbinary', 'other'];
  if (!person.demographics?.gender) {
    errors.push('Gender is required.');
  } else if (!validGenders.includes(String(person.demographics.gender).toLowerCase())) {
    errors.push(`Gender must be one of: ${validGenders.join(', ')}.`);
  }

  if (!Array.isArray(person.contact?.emails)) {
    errors.push('Contact emails must be an array.');
  } else {
    const validEmails = person.contact.emails.filter((e) =>
      e?.email && emailRegex.test(String(e.email).trim())
    );

    if (validEmails.length === 0) {
      errors.push('At least one valid email address is required.');
    }

    const primary = person.contact.emails.find((e) => e.isPrimary) || person.contact.emails[0];
    if (primary && !emailRegex.test(String(primary.email || ''))) {
      errors.push('The primary email address is invalid.');
    }
  }

  if (person.contact?.phones && !Array.isArray(person.contact.phones)) {
    errors.push('Phones must be an array.');
  }
  if (person.addresses && !Array.isArray(person.addresses)) {
    errors.push('Addresses must be an array.');
  }
  if (person.organizations && !Array.isArray(person.organizations)) {
    errors.push('Organizations must be an array.');
  }
  if (person.tags && !Array.isArray(person.tags)) {
    errors.push('Tags must be an array.');
  }
  if (person.manualTags && !Array.isArray(person.manualTags)) {
    errors.push('Manual Tags must be an array.');
  }

  if (Array.isArray(person.organizations)) {
    person.organizations.forEach((org, index) => {
      if (!org.orgId) errors.push(`Organization at index ${index} is missing an ID.`);
      if (!Array.isArray(org.roles) || !org.roles.length) {
        errors.push(`Organization at index ${index} must include at least one role.`);
      }
    });
  }

  return errors.length ? { isValid: false, errors } : { isValid: true };
}
/* ---------------- END VALIDATION ---------------- */

async function addPerson(person) {
  await queueWrite(async () => {
    const persons = await readAllPersonsRaw();
    const toPersist = preparePersonForPersist({ ...person, id: generateId() });
    normalizeOrganizationsForPerson(toPersist);

    const v = validateData(toPersist);
    if (!v.isValid) throw new Error(v.errors.join('\r\n'));

    persons.push(toPersist);
    await fs.writeFile(dataPath, JSON.stringify(persons, null, 2));
    person.id = toPersist.id;
  });
  return getPersonById(person.id);
}

async function updatePerson(id, updates) {
  await queueWrite(async () => {
    const persons = await readAllPersonsRaw();
    const idx = persons.findIndex((p) => idsEqual(p?.id, id));
    if (idx === -1) throw new Error('Person not found');

    const current = persons[idx];
    const merged = {
      ...current,
      ...updates,
      name: { ...current.name, ...(updates.name || {}) },
      demographics: { ...current.demographics, ...(updates.demographics || {}) },
      contact: {
        ...current.contact,
        ...(updates.contact || {}),
        emails: updates.contact?.emails ?? current.contact?.emails ?? [],
        phones: updates.contact?.phones ?? current.contact?.phones ?? []
      },
      addresses: updates.addresses ?? current.addresses ?? [],
      organizations: updates.organizations ?? current.organizations ?? [],
      audit: { ...current.audit, ...(updates.audit || {}) }
    };
    normalizeOrganizationsForPerson(merged);
    const toPersist = preparePersonForPersist(merged);

    const v = validateData(toPersist);
    if (!v.isValid) throw new Error(v.errors.join('\r\n'));

    persons[idx] = toPersist;
    await fs.writeFile(dataPath, JSON.stringify(persons, null, 2));
  });
}

async function deletePerson(id) {
  await queueWrite(async () => {
    const persons = await readAllPersonsRaw();
    const filtered = persons.filter((p) => !idsEqual(p?.id, id));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

function getAllowedManualTags() {
  const registry = getRoleRegistrySnapshot();
  const manualPresets = Array.isArray(registry.manualTagPresets) && registry.manualTagPresets.length
    ? registry.manualTagPresets
    : PERSON_MANUAL_TAG_PRESETS;
  return dedupeTags(manualPresets);
}

function getSystemTagKeys() {
  const registry = getRoleRegistrySnapshot();
  const systemKeys = Array.isArray(registry.systemRoleKeys) && registry.systemRoleKeys.length
    ? registry.systemRoleKeys
    : PERSON_SYSTEM_TAG_KEYS;
  return dedupeTags(systemKeys);
}

module.exports = {
  getAllPersons,
  findPersonsByOrganizationId,
  countPersonsByOrganizationId,
  existsPersonByOrganizationId,
  queryPersons,
  buildPersonQueryPlan,
  getPersonById,
  getAudienceTagsForPerson,
  addPerson,
  updatePerson,
  deletePerson,
  normalizeManualTags,
  getAllowedManualTags,
  getSystemTagKeys,
  PERSON_MANUAL_TAG_PRESETS,
  PERSON_SYSTEM_TAG_KEYS
};
