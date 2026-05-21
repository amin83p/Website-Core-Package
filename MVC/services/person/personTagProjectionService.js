const roleRegistryService = require('./roleRegistryService');

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

function canonicalSystemRoleTagFactory(systemRoleKeys = [], systemRoleAlias = {}) {
  const allowed = new Set((Array.isArray(systemRoleKeys) ? systemRoleKeys : []).map(normalizeTagToken));
  const aliases = Object.entries(systemRoleAlias || {}).reduce((acc, [key, value]) => {
    const source = normalizeTagToken(key);
    const target = normalizeTagToken(value);
    if (source && target) acc[source] = target;
    return acc;
  }, {});

  return (value) => {
    const normalized = normalizeTagToken(value);
    if (!normalized) return null;
    if (allowed.has(normalized)) return normalized;
    return aliases[normalized] || null;
  };
}

function normalizeManualTagsLenient(tagsInput, canonicalSystemRoleTag) {
  return dedupeTags(toTagArray(tagsInput)).filter((tag) => !canonicalSystemRoleTag(tag));
}

function collectSystemTagsFromOrganizations(person, canonicalSystemRoleTag) {
  const orgList = Array.isArray(person?.organizations) ? person.organizations : [];
  const tags = [];
  orgList.forEach((org) => {
    const roles = Array.isArray(org?.roles) ? org.roles : (org?.role ? [org.role] : []);
    roles.forEach((role) => {
      const canonical = canonicalSystemRoleTag(role);
      if (canonical) tags.push(canonical);
    });
  });
  return dedupeTags(tags);
}

function projectPersonForRead(rawPerson, options = {}) {
  const registry = roleRegistryService.getRoleRegistrySnapshot();
  const {
    systemRoleKeys = registry.systemRoleKeys || [],
    systemRoleAlias = registry.systemRoleAlias || {},
    domainSystemTags = [],
    cloneInput = true
  } = options || {};

  const canonicalSystemRoleTag = canonicalSystemRoleTagFactory(systemRoleKeys, systemRoleAlias);
  const person = cloneInput
    ? JSON.parse(JSON.stringify(rawPerson || {}))
    : (rawPerson || {});

  const manualTags = normalizeManualTagsLenient(person.manualTags ?? person.tags ?? [], canonicalSystemRoleTag);
  const roleSystemTags = collectSystemTagsFromOrganizations(person, canonicalSystemRoleTag);
  const externalSystemTags = dedupeTags(domainSystemTags);
  const systemTags = dedupeTags([...roleSystemTags, ...externalSystemTags]);
  const mergedTags = dedupeTags([...manualTags, ...systemTags]);

  person.manualTags = manualTags;
  person.systemTags = systemTags;
  person.tags = mergedTags;

  return person;
}

module.exports = {
  projectPersonForRead
};
