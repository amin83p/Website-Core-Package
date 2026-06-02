const schoolDataService = require('./schoolDataService');
const dataServiceGlobal = require('../dataService');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');
const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });

function boolFromBody(value) {
  return value === 'true' || value === 'on' || value === true || value === 1 || value === '1';
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildPersonNameVariants(person, fallbackId = '') {
  const first = String(person?.name?.first || '').trim();
  const middle = String(person?.name?.middle || '').trim();
  const last = String(person?.name?.last || '').trim();
  const preferred = String(person?.name?.preferred || '').trim();
  const variants = [
    [first, middle, last].filter(Boolean).join(' '),
    [first, last].filter(Boolean).join(' '),
    [preferred, last].filter(Boolean).join(' '),
    preferred,
    fallbackId
  ];
  return Array.from(new Set(variants.map((item) => String(item || '').trim()).filter(Boolean)));
}

function matchesAccountSearch(account, searchQuery) {
  const normalizedQuery = normalizeSearchText(searchQuery);
  if (!normalizedQuery) return true;
  const tokens = normalizedQuery.split(' ').filter(Boolean);
  const haystack = normalizeSearchText([
    account?.id,
    account?.code,
    account?.name,
    account?.description,
    account?.parentName,
    account?.ownerSummary,
    account?.ownerSearchText
  ].filter(Boolean).join(' '));
  return tokens.every((token) => haystack.includes(token));
}

async function buildAccountOwnerMap(reqUser) {
  const [students, teachers, staff, persons] = await Promise.all([
    schoolDataService.fetchData('students', {}, reqUser),
    schoolDataService.fetchData('teachers', {}, reqUser),
    schoolDataService.fetchData('staff', {}, reqUser),
    dataServiceGlobal.fetchData('persons', {}, reqUser, PERSON_QUERY_OPTIONS)
  ]);

  const personMap = new Map((persons || []).map((person) => [toPublicId(person?.id), person]));
  const ownersByAccount = new Map();

  function pushOwner(accountId, type, ownerId, personId) {
    const normalizedAccountId = toPublicId(accountId);
    if (!normalizedAccountId) return;
    const person = personMap.get(toPublicId(personId)) || null;
    const labels = buildPersonNameVariants(person, String(ownerId || '').trim());
    if (!ownersByAccount.has(normalizedAccountId)) ownersByAccount.set(normalizedAccountId, []);
    ownersByAccount.get(normalizedAccountId).push({
      type,
      ownerId: String(ownerId || '').trim(),
      labels
    });
  }

  (students || []).forEach((student) => pushOwner(student?.studentAccountId, 'student', student?.id, student?.personId));
  (teachers || []).forEach((teacher) => pushOwner(teacher?.teacherAccountId, 'teacher', teacher?.id, teacher?.personId));
  (staff || []).forEach((member) => pushOwner(member?.staffAccountId, 'staff', member?.id, member?.personId));

  return ownersByAccount;
}

function enrichAccountsWithOwners(accounts, ownersByAccount) {
  const rows = Array.isArray(accounts) ? accounts : [];
  const idToName = new Map(rows.map((account) => [toPublicId(account?.id), `${account?.code || ''} - ${account?.name || ''}`.trim()]));

  return rows.map((account) => {
    const owners = ownersByAccount.get(toPublicId(account?.id)) || [];
    const ownerSummaryParts = owners.map((owner) => {
      const primaryLabel = owner.labels.find(Boolean) || owner.ownerId || '';
      return `${String(owner.type || '').toUpperCase()}: ${primaryLabel}`;
    });
    const ownerSearchText = Array.from(new Set(
      owners.flatMap((owner) => Array.isArray(owner.labels) ? owner.labels : [])
    )).join(' ');

    return {
      ...account,
      parentName: account?.parentId ? (idToName.get(toPublicId(account.parentId)) || account.parentId) : '-',
      ownerSummary: ownerSummaryParts.join(', '),
      ownerSearchText
    };
  });
}

async function findAccountOwnerConflicts(accountId, reqUser) {
  const targetAccountId = toPublicId(accountId);
  if (!targetAccountId) return [];

  const owners = [];
  const [students, teachers, staff] = await Promise.all([
    schoolDataService.fetchData('students', {}, reqUser),
    schoolDataService.fetchData('teachers', {}, reqUser),
    schoolDataService.fetchData('staff', {}, reqUser)
  ]);

  (students || []).forEach((student) => {
    if (!idsEqual(student?.studentAccountId, targetAccountId)) return;
    owners.push({
      type: 'student',
      id: toPublicId(student?.id),
      status: student?.academicStatus || 'Unknown'
    });
  });
  (teachers || []).forEach((teacher) => {
    if (!idsEqual(teacher?.teacherAccountId, targetAccountId)) return;
    owners.push({
      type: 'teacher',
      id: toPublicId(teacher?.id),
      status: teacher?.status || 'Unknown'
    });
  });
  (staff || []).forEach((member) => {
    if (!idsEqual(member?.staffAccountId, targetAccountId)) return;
    owners.push({
      type: 'staff',
      id: toPublicId(member?.id),
      status: member?.status || 'Unknown'
    });
  });

  return owners;
}

function buildAccountPayload(body, activeOrgId, existing = null) {
  const has = (key) => Object.prototype.hasOwnProperty.call(body || {}, key);
  const fallback = (key, def = '') => (existing && existing[key] !== undefined ? existing[key] : def);

  const code = has('code') ? String(body.code || '').trim() : String(fallback('code', '') || '').trim();
  const name = has('name') ? String(body.name || '').trim() : String(fallback('name', '') || '').trim();
  const type = has('type')
    ? String(body.type || '').trim().toLowerCase()
    : String(fallback('type', '') || '').trim().toLowerCase();
  const levelRaw = has('level') ? body.level : fallback('level', 1);
  const level = Number(levelRaw || 1);
  const parentId = has('parentId')
    ? (toPublicId(body.parentId) || null)
    : (fallback('parentId', null) ? toPublicId(fallback('parentId', null)) : null);
  const isControl = has('isControl') ? boolFromBody(body.isControl) : Boolean(fallback('isControl', false));
  const allowPost = has('allowPost') ? boolFromBody(body.allowPost) : Boolean(fallback('allowPost', false));
  const partyRole = has('partyRole')
    ? String(body.partyRole || 'none').trim().toLowerCase()
    : String(fallback('partyRole', 'none') || 'none').trim().toLowerCase();
  const headCategory = has('headCategory')
    ? String(body.headCategory || 'none').trim().toLowerCase()
    : String(fallback('headCategory', 'none') || 'none').trim().toLowerCase();
  const normalBalance = has('normalBalance')
    ? String(body.normalBalance || '').trim().toLowerCase()
    : String(fallback('normalBalance', '') || '').trim().toLowerCase();
  const status = has('status')
    ? String(body.status || 'active').trim().toLowerCase()
    : String(fallback('status', 'active') || 'active').trim().toLowerCase();
  const description = has('description')
    ? String(body.description || '').trim()
    : String(fallback('description', '') || '').trim();

  return {
    orgId: toPublicId(activeOrgId),
    code,
    name,
    type,
    level,
    parentId,
    isControl,
    allowPost,
    partyRole,
    headCategory,
    normalBalance,
    status,
    description
  };
}

module.exports = {
  matchesAccountSearch,
  buildAccountOwnerMap,
  enrichAccountsWithOwners,
  findAccountOwnerConflicts,
  buildAccountPayload
};
