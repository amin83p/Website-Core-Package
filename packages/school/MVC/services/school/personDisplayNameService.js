const { requireCoreModule } = require('./schoolCoreContracts');
const personRepository = requireCoreModule('MVC/repositories/personRepository');
const userRepository = requireCoreModule('MVC/repositories/userRepository');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const personCache = new Map();
const userCache = new Map();

function cleanString(value, max = 500) {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = cleanString(value, 160);
    if (text) return text;
  }
  return '';
}

function buildPersonDisplayName(person = null, fallback = '') {
  if (!person || typeof person !== 'object') return cleanString(fallback, 160);
  const preferred = firstNonEmpty(
    person?.name?.preferred,
    person?.preferredName,
    person?.preferred_name
  );
  if (preferred) return preferred;

  const first = firstNonEmpty(person?.name?.first, person?.firstName, person?.first_name);
  const last = firstNonEmpty(person?.name?.last, person?.lastName, person?.last_name);
  const fullName = cleanString(`${first} ${last}`, 160);
  if (fullName) return fullName;

  return firstNonEmpty(person?.fullName, person?.displayName, fallback);
}

function getUserPersonId(user = null) {
  return toPublicId(user?.personId || user?.profile?.personId || user?.person?.id || '');
}

function getUserId(user = null) {
  return toPublicId(user?.id || user?._id || user?.userId || '');
}

async function getPersonById(personId) {
  const id = toPublicId(personId);
  if (!id) return null;
  if (personCache.has(id)) return personCache.get(id);
  let person = null;
  try {
    person = await personRepository.getById(id, {
      scope: { canViewAll: true },
      skipExecutor: true
    });
  } catch (error) {
    person = null;
  }
  personCache.set(id, person || null);
  return person || null;
}

async function getUserById(userId) {
  const id = toPublicId(userId);
  if (!id) return null;
  if (userCache.has(id)) return userCache.get(id);
  let user = null;
  try {
    user = await userRepository.getById(id, {
      scope: { canViewAll: true },
      skipExecutor: true
    });
  } catch (error) {
    user = null;
  }
  userCache.set(id, user || null);
  return user || null;
}

async function resolvePersonDisplayName(personId, options = {}) {
  const id = toPublicId(personId);
  const fallback = cleanString(options.fallback || id, 160);
  if (!id) return fallback;
  const person = await getPersonById(id);
  return buildPersonDisplayName(person, fallback);
}

async function resolveUserDisplayName(user = null, options = {}) {
  const personId = getUserPersonId(user);
  if (personId) {
    const name = await resolvePersonDisplayName(personId, { fallback: '' });
    if (name) return name;
  }
  if (user?.name && typeof user.name === 'object') {
    const fromUserName = buildPersonDisplayName(user, '');
    if (fromUserName) return fromUserName;
  }
  return cleanString(options.fallback || getUserId(user) || 'System', 160);
}

async function resolveUserIdDisplayName(userId, options = {}) {
  const id = toPublicId(userId);
  if (!id) return cleanString(options.fallback || 'System', 160);
  const user = await getUserById(id);
  if (!user) return cleanString(options.fallback || id, 160);
  return resolveUserDisplayName(user, { fallback: options.fallback || id });
}

module.exports = {
  buildPersonDisplayName,
  getUserPersonId,
  resolvePersonDisplayName,
  resolveUserDisplayName,
  resolveUserIdDisplayName,
  _private: {
    getPersonById,
    getUserById,
    cleanString
  }
};
