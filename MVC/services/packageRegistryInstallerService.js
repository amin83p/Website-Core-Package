const roleRepository = require('../repositories/roleRepository');
const sectionRepository = require('../repositories/sectionRepository');
const symbolRepository = require('../repositories/symbolRepository');
const accessRepository = require('../repositories/accessRepository');
const operationRepository = require('../repositories/operationRepository');
const systemSettingsRepository = require('../repositories/systemSettingsRepository');
const uploadFolderSettingsService = require('./uploadFolderSettingsService');
const settingService = require('./settingService');
const packageQueryExecutorService = require('./packageQueryExecutorService');
const packageRouteService = require('./packageRouteService');
const packageViewAssetService = require('./packageViewAssetService');
const startupLogger = require('../utils/startupLogger');

const ENTITY_KEYS = Object.freeze([
  'operations',
  'roles',
  'sections',
  'symbols',
  'accesses'
]);

const SYSTEM_ACTOR = 'SYSTEM';

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizePackageId(value = '') {
  return cleanText(value, 80).toLowerCase();
}

function normalizePackageName(value = '', fallback = 'CORE') {
  const token = cleanText(value, 120).toUpperCase();
  return token || fallback;
}

function normalizeDeclarationArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row && typeof row === 'object');
}

function normalizeEntitySummary() {
  return {
    requested: 0,
    created: 0,
    updated: 0,
    deactivated: 0,
    removed: 0,
    skipped: 0,
    failed: 0
  };
}

function normalizeUploadSummary() {
  return {
    requested: 0,
    definitionsRegistered: 0,
    definitionsRemoved: 0,
    valuesApplied: 0,
    valuesCleared: 0,
    skipped: 0,
    failed: 0,
    settingsUpdated: false
  };
}

function defaultInstallSummary(packageId = '', packageName = '') {
  return {
    packageId,
    packageName,
    backendMode: '',
    entities: {
      operations: normalizeEntitySummary(),
      roles: normalizeEntitySummary(),
      sections: normalizeEntitySummary(),
      symbols: normalizeEntitySummary(),
      accesses: normalizeEntitySummary()
    },
    uploadFolders: normalizeUploadSummary(),
    results: []
  };
}

function nowIso() {
  return new Date().toISOString();
}

function getOwnershipFromRow(row = {}) {
  const packageId = normalizePackageId(row?.packageId || row?.package?.id || row?.metadata?.packageId || '');
  const packageName = normalizePackageName(row?.packageName || row?.package?.name || row?.metadata?.packageName || '', '');
  return { packageId, packageName };
}

function buildInstallMetadata(packageId = '', packageName = '') {
  return {
    packageId,
    packageName
  };
}

function sameJsonShape(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function dedupeStrings(values = []) {
  return Array.from(new Set(
    safeArray(values).map((row) => cleanText(row, 180)).filter(Boolean)
  ));
}

function normalizeBoolean(value, fallback = true) {
  if (value === undefined) return Boolean(fallback);
  return value === true;
}

function normalizePackageContext(context = {}) {
  const packageId = normalizePackageId(context?.packageId || context?.manifest?.id || '');
  if (!packageId) throw new Error('Package installer requires packageId.');
  const packageName = normalizePackageName(
    context?.packageName
    || context?.manifest?.packageName
    || context?.manifest?.name
    || packageId.toUpperCase(),
    packageId.toUpperCase()
  );
  return { packageId, packageName };
}

function isOwnershipConflict(existing = {}, packageId = '') {
  const owner = getOwnershipFromRow(existing);
  if (!owner.packageId) return false;
  return owner.packageId !== packageId;
}

function isOwnedByPackage(existing = {}, packageId = '') {
  const owner = getOwnershipFromRow(existing);
  return owner.packageId === packageId;
}

function isUnmanaged(existing = {}) {
  return !getOwnershipFromRow(existing).packageId;
}

function shouldAdoptExisting(declaration = {}, options = {}) {
  if (declaration?.adoptExisting === true) return true;
  return options?.allowAdoptExisting === true;
}

function markResult(summary, category, input = {}) {
  const bucket = summary.entities[category];
  if (!bucket) return;
  const status = cleanText(input?.status, 40).toLowerCase();
  if (status === 'created') bucket.created += 1;
  else if (status === 'updated') bucket.updated += 1;
  else if (status === 'deactivated') bucket.deactivated += 1;
  else if (status === 'removed') bucket.removed += 1;
  else if (status === 'skipped') bucket.skipped += 1;
  else if (status === 'failed') bucket.failed += 1;

  summary.results.push({
    category,
    status,
    key: cleanText(input?.key, 240),
    id: cleanText(input?.id, 240),
    message: cleanText(input?.message, 800)
  });
}

function markUploadFolderResult(summary, input = {}) {
  const uploadSummary = summary.uploadFolders;
  const status = cleanText(input?.status, 40).toLowerCase();
  if (status === 'updated') uploadSummary.valuesApplied += 1;
  else if (status === 'removed') uploadSummary.definitionsRemoved += 1;
  else if (status === 'requested') uploadSummary.requested += 1;
  else if (status === 'skipped') uploadSummary.skipped += 1;
  else if (status === 'failed') uploadSummary.failed += 1;

  summary.results.push({
    category: 'uploadFolders',
    status,
    key: cleanText(input?.key, 240),
    id: cleanText(input?.id, 240),
    message: cleanText(input?.message, 800)
  });
}

function normalizeUninstallAction(value = '') {
  const token = cleanText(value, 40).toLowerCase();
  return token === 'remove' ? 'remove' : 'disable';
}

function normalizeOperationDeclaration(row = {}, packageMeta = {}) {
  const name = cleanText(row?.name, 180).toUpperCase();
  if (!name) throw new Error('Operation declaration requires name.');
  const auditUser = cleanText(row?.audit?.createUser || row?.audit?.lastUpdateUser, 120) || SYSTEM_ACTOR;
  const auditNow = nowIso();
  return {
    id: cleanText(row?.id, 120) || undefined,
    name,
    description: cleanText(row?.description, 1200),
    active: normalizeBoolean(row?.active, true),
    system: row?.system === true,
    trackState: row?.trackState !== false,
    keepActive: row?.keepActive === true,
    sectionId: cleanText(row?.sectionId, 120) || undefined,
    packageId: packageMeta.packageId,
    packageName: packageMeta.packageName,
    package: buildInstallMetadata(packageMeta.packageId, packageMeta.packageName, row?.package || {}),
    audit: {
      createUser: auditUser,
      createDateTime: cleanText(row?.audit?.createDateTime, 80) || auditNow,
      lastUpdateUser: cleanText(row?.audit?.lastUpdateUser, 120) || auditUser,
      lastUpdateDateTime: cleanText(row?.audit?.lastUpdateDateTime, 80) || auditNow
    }
  };
}

function normalizeRoleDeclaration(row = {}, packageMeta = {}) {
  const key = cleanText(row?.key, 180).toLowerCase();
  if (!key) throw new Error('Role declaration requires key.');
  const inferredDomain = key.includes('_') ? key.split('_')[0] : 'core';
  const packageName = normalizePackageName(row?.packageName || packageMeta.packageName, packageMeta.packageName);
  return {
    id: cleanText(row?.id, 120) || undefined,
    key,
    label: cleanText(row?.label, 220) || key.toUpperCase(),
    description: cleanText(row?.description, 1200),
    domain: cleanText(row?.domain, 120).toLowerCase() || inferredDomain,
    packageName,
    aliases: dedupeStrings(row?.aliases || []),
    active: normalizeBoolean(row?.active, true),
    system: row?.system === true,
    packageId: packageMeta.packageId,
    package: buildInstallMetadata(packageMeta.packageId, packageName, row?.package || {})
  };
}

function normalizeSectionOperations(value = []) {
  return normalizeDeclarationArray(value).map((row) => ({
    id: cleanText(row?.id, 120),
    sessionAttempts: Number.isInteger(row?.sessionAttempts) ? row.sessionAttempts : 5,
    sessionTime: Number.isInteger(row?.sessionTime) ? row.sessionTime : 15,
    active: row?.active !== false
  })).filter((row) => row.id);
}

function normalizeSectionDeclaration(row = {}, packageMeta = {}) {
  const name = cleanText(row?.name, 180).toUpperCase();
  if (!name) throw new Error('Section declaration requires name.');
  const category = cleanText(row?.category, 120).toUpperCase() || 'GENERAL';
  const minAccess = Number.isInteger(row?.minimumAccessRequirement) ? row.minimumAccessRequirement : 5;
  return {
    id: cleanText(row?.id, 120) || undefined,
    name,
    category,
    description: cleanText(row?.description, 1200) || `${name} section`,
    active: normalizeBoolean(row?.active, true),
    trackState: row?.trackState !== false,
    minimumAccessRequirement: minAccess < 1 ? 1 : (minAccess > 10 ? 10 : minAccess),
    dashboardDisplay: row?.dashboardDisplay === true,
    mainDashboardDisplay: row?.mainDashboardDisplay === true,
    navigatorSection: row?.navigatorSection === true,
    homeURL: cleanText(row?.homeURL, 600),
    inactiveMessage: cleanText(row?.inactiveMessage, 600),
    message: cleanText(row?.message, 600),
    operations: normalizeSectionOperations(row?.operations || []),
    subsections: safeArray(row?.subsections),
    related: safeArray(row?.related),
    packageId: packageMeta.packageId,
    packageName: packageMeta.packageName,
    package: buildInstallMetadata(packageMeta.packageId, packageMeta.packageName, row?.package || {})
  };
}

function normalizeSymbolDeclaration(row = {}, packageMeta = {}) {
  const name = cleanText(row?.name, 200).toUpperCase();
  if (!name) throw new Error('Symbol declaration requires name.');
  const type = cleanText(row?.type, 40).toLowerCase() || 'class';
  let value = cleanText(row?.value, 6000);
  if (!value && type === 'class') value = 'bi bi-circle-square';
  return {
    id: cleanText(row?.id, 120) || undefined,
    name,
    type: ['class', 'image', 'raw'].includes(type) ? type : 'class',
    value,
    tags: dedupeStrings(row?.tags || [name]),
    orgId: cleanText(row?.orgId, 120) || 'SYSTEM',
    packageId: packageMeta.packageId,
    packageName: packageMeta.packageName,
    package: buildInstallMetadata(packageMeta.packageId, packageMeta.packageName, row?.package || {})
  };
}

function normalizeAccessSections(value = []) {
  return normalizeDeclarationArray(value).map((sectionRow) => ({
    sectionId: cleanText(sectionRow?.sectionId, 120),
    adminAccess: sectionRow?.adminAccess === true,
    operations: normalizeDeclarationArray(sectionRow?.operations).map((opRow) => ({
      operationId: cleanText(opRow?.operationId, 120),
      scopeId: cleanText(opRow?.scopeId, 120) || null,
      maxAttemptsPerSession: Number.isInteger(opRow?.maxAttemptsPerSession) ? opRow.maxAttemptsPerSession : null,
      maxSessionDurationMinutes: Number.isInteger(opRow?.maxSessionDurationMinutes) ? opRow.maxSessionDurationMinutes : null,
      maxFetchUploadVolumeKB: Number.isInteger(opRow?.maxFetchUploadVolumeKB) ? opRow.maxFetchUploadVolumeKB : null
    })).filter((op) => op.operationId)
  })).filter((row) => row.sectionId);
}

function normalizeAccessDeclaration(row = {}, packageMeta = {}) {
  const name = cleanText(row?.name, 180).toUpperCase();
  if (!name) throw new Error('Access declaration requires name.');
  return {
    id: cleanText(row?.id, 120) || undefined,
    name,
    orgId: row?.orgId === undefined || row?.orgId === null || row?.orgId === ''
      ? null
      : cleanText(row?.orgId, 120),
    description: cleanText(row?.description, 1200),
    active: normalizeBoolean(row?.active, true),
    fullAdmin: row?.fullAdmin === true,
    adminCategories: dedupeStrings(row?.adminCategories || []),
    validity: {
      startDate: row?.validity?.startDate || null,
      endDate: row?.validity?.endDate || null
    },
    sections: normalizeAccessSections(row?.sections || []),
    packageId: packageMeta.packageId,
    packageName: packageMeta.packageName,
    package: buildInstallMetadata(packageMeta.packageId, packageMeta.packageName, row?.package || {})
  };
}

function normalizeUploadFolderDeclaration(row = {}, packageMeta = {}) {
  const key = cleanText(row?.key, 220);
  if (!key) throw new Error('Upload folder declaration requires key.');
  return {
    key,
    packageName: normalizePackageName(row?.packageName || packageMeta.packageName, packageMeta.packageName),
    group: cleanText(row?.group, 220),
    label: cleanText(row?.label, 220),
    defaultTemplate: cleanText(row?.defaultTemplate, 800),
    placeholders: dedupeStrings(row?.placeholders || []),
    valueTemplate: cleanText(row?.template || row?.value || row?.path, 800),
    applyDefault: row?.applyDefault === true
  };
}

function mergeEntityPayload(existing = {}, normalized = {}, fields = []) {
  const patch = {};
  fields.forEach((field) => {
    if (normalized[field] !== undefined) patch[field] = normalized[field];
  });
  if (Object.prototype.hasOwnProperty.call(normalized, 'packageId')) patch.packageId = normalized.packageId;
  if (Object.prototype.hasOwnProperty.call(normalized, 'packageName')) patch.packageName = normalized.packageName;
  if (Object.prototype.hasOwnProperty.call(normalized, 'package')) patch.package = normalized.package;
  return {
    ...existing,
    ...patch
  };
}

function normalizeOrgIdComparable(value) {
  if (value === null || value === undefined || value === '') return '';
  return cleanText(value, 120);
}

function createDefaultDependencies(overrides = {}) {
  return {
    roleRepository: overrides.roleRepository || roleRepository,
    sectionRepository: overrides.sectionRepository || sectionRepository,
    symbolRepository: overrides.symbolRepository || symbolRepository,
    accessRepository: overrides.accessRepository || accessRepository,
    operationRepository: overrides.operationRepository || operationRepository,
    systemSettingsRepository: overrides.systemSettingsRepository || systemSettingsRepository,
    uploadFolderSettingsService: overrides.uploadFolderSettingsService || uploadFolderSettingsService,
    settingService: overrides.settingService || settingService,
    logger: overrides.logger || startupLogger
  };
}

async function findOperationByName(repo, name, options = {}) {
  if (typeof repo.getByName === 'function') {
    return repo.getByName(name, options);
  }
  const rows = await repo.list({ ...options, query: { name__eq: name, limit: 1 } });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function findRoleByKey(repo, key, options = {}) {
  if (typeof repo.getByKey === 'function') {
    return repo.getByKey(key, options);
  }
  const rows = await repo.list({ ...options, query: { key__eq: key, limit: 1 } });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function findSectionByName(repo, name, options = {}) {
  if (typeof repo.getByName === 'function') {
    return repo.getByName(name, options);
  }
  const rows = await repo.list({ ...options, query: { name__eq: name, limit: 1 } });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function findSymbolByNameOrg(repo, name, orgId, options = {}) {
  const rows = await repo.list({
    ...options,
    query: {
      name__eq: name,
      orgId__eq: orgId,
      limit: 1
    }
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function findAccessByNameOrg(repo, name, orgId, options = {}) {
  const rows = await repo.list({
    ...options,
    query: {
      name__eq: name,
      orgId__eq: orgId,
      limit: 1
    }
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

function isAccessIdentityMatch(existing = {}, normalized = {}) {
  const existingOrg = normalizeOrgIdComparable(existing?.orgId);
  const incomingOrg = normalizeOrgIdComparable(normalized?.orgId);
  return cleanText(existing?.name, 180).toUpperCase() === cleanText(normalized?.name, 180).toUpperCase()
    && existingOrg === incomingOrg;
}

function isSymbolIdentityMatch(existing = {}, normalized = {}) {
  return cleanText(existing?.name, 180).toUpperCase() === cleanText(normalized?.name, 180).toUpperCase()
    && normalizeOrgIdComparable(existing?.orgId) === normalizeOrgIdComparable(normalized?.orgId);
}

function buildEntityDefinitions(deps, packageMeta, backendMode) {
  const repoOptions = { backendMode };
  return {
    operations: {
      normalize: (row) => normalizeOperationDeclaration(row, packageMeta),
      find: async (normalized) => findOperationByName(deps.operationRepository, normalized.name, repoOptions),
      create: async (payload) => deps.operationRepository.create(payload, repoOptions),
      update: async (id, payload) => deps.operationRepository.update(id, payload, repoOptions),
      remove: async (id) => deps.operationRepository.remove(id, repoOptions),
      supportsActiveToggle: true,
      updateFields: ['name', 'description', 'active', 'system', 'trackState', 'keepActive', 'sectionId', 'audit']
    },
    roles: {
      normalize: (row) => normalizeRoleDeclaration(row, packageMeta),
      find: async (normalized) => findRoleByKey(deps.roleRepository, normalized.key, repoOptions),
      create: async (payload) => deps.roleRepository.create(payload, repoOptions),
      update: async (id, payload) => deps.roleRepository.update(id, payload, repoOptions),
      remove: async (id) => deps.roleRepository.remove(id, repoOptions),
      supportsActiveToggle: true,
      updateFields: ['key', 'label', 'description', 'domain', 'packageName', 'aliases', 'active', 'system']
    },
    sections: {
      normalize: (row) => normalizeSectionDeclaration(row, packageMeta),
      find: async (normalized) => findSectionByName(deps.sectionRepository, normalized.name, repoOptions),
      create: async (payload) => deps.sectionRepository.create(payload, repoOptions),
      update: async (id, payload) => deps.sectionRepository.update(id, payload, repoOptions),
      remove: async (id) => deps.sectionRepository.remove(id, repoOptions),
      supportsActiveToggle: true,
      updateFields: [
        'name',
        'category',
        'description',
        'active',
        'trackState',
        'minimumAccessRequirement',
        'dashboardDisplay',
        'mainDashboardDisplay',
        'navigatorSection',
        'homeURL',
        'inactiveMessage',
        'message',
        'operations',
        'subsections',
        'related'
      ]
    },
    symbols: {
      normalize: (row) => normalizeSymbolDeclaration(row, packageMeta),
      find: async (normalized) => findSymbolByNameOrg(deps.symbolRepository, normalized.name, normalized.orgId, repoOptions),
      create: async (payload) => deps.symbolRepository.create(payload, repoOptions),
      update: async (id, payload) => deps.symbolRepository.update(id, payload, repoOptions),
      remove: async (id) => deps.symbolRepository.remove(id, repoOptions),
      supportsActiveToggle: false,
      updateFields: ['name', 'type', 'value', 'tags', 'orgId']
    },
    accesses: {
      normalize: (row) => normalizeAccessDeclaration(row, packageMeta),
      find: async (normalized) => findAccessByNameOrg(
        deps.accessRepository,
        normalized.name,
        normalized.orgId === null ? '' : normalized.orgId,
        repoOptions
      ),
      create: async (payload) => deps.accessRepository.create(payload, repoOptions),
      update: async (id, payload) => deps.accessRepository.update(id, payload, repoOptions),
      remove: async (id) => deps.accessRepository.remove(id, repoOptions),
      supportsActiveToggle: true,
      updateFields: ['name', 'orgId', 'description', 'active', 'fullAdmin', 'adminCategories', 'validity', 'sections']
    }
  };
}

function isReadonlyExistingRow(category, row = {}) {
  if (category === 'roles') return row?.system === true;
  if (category === 'operations') return row?.system === true;
  return false;
}

function findStableIdentity(category, normalized = {}) {
  if (category === 'roles') return normalized.key;
  if (category === 'operations') return normalized.name;
  if (category === 'sections') return normalized.name;
  if (category === 'symbols') return `${normalized.orgId}:${normalized.name}`;
  if (category === 'accesses') return `${normalizeOrgIdComparable(normalized.orgId)}:${normalized.name}`;
  return '';
}

function rowBelongsToSameIdentity(category, existing = {}, normalized = {}) {
  if (category === 'symbols') return isSymbolIdentityMatch(existing, normalized);
  if (category === 'accesses') return isAccessIdentityMatch(existing, normalized);
  if (category === 'roles') return cleanText(existing?.key, 180).toLowerCase() === normalized.key;
  if (category === 'operations') return cleanText(existing?.name, 180).toUpperCase() === normalized.name;
  if (category === 'sections') return cleanText(existing?.name, 180).toUpperCase() === normalized.name;
  return false;
}

function buildUninstallSummaryMessage(action, category, reason) {
  if (action === 'remove') return reason || 'Removed per uninstall action.';
  return reason || 'Deactivated per uninstall action.';
}

function summarizeUninstallOwnershipResult(category, existing = {}, summary, identity = '') {
  const owner = getOwnershipFromRow(existing);
  if (!owner.packageId) {
    markResult(summary, category, {
      status: 'skipped',
      key: identity,
      id: cleanText(existing?.id, 120),
      message: 'Record is unmanaged.'
    });
    return 'skipped';
  }
  if (isOwnershipConflict(existing, summary.packageId)) {
    markResult(summary, category, {
      status: 'skipped',
      key: identity,
      id: cleanText(existing?.id, 120),
      message: 'Record is owned by another package.'
    });
    return 'skipped';
  }
  if (isReadonlyExistingRow(category, existing)) {
    markResult(summary, category, {
      status: 'skipped',
      key: identity,
      id: cleanText(existing?.id, 120),
      message: 'System-protected record is read-only.'
    });
    return 'skipped';
  }
  return null;
}

async function installEntityDeclarations(manifest, summary, context, deps, options = {}) {
  const declarationsByCategory = {
    operations: normalizeDeclarationArray(manifest.operations),
    roles: normalizeDeclarationArray(manifest.roles),
    sections: normalizeDeclarationArray(manifest.sections),
    symbols: normalizeDeclarationArray(manifest.symbols),
    accesses: normalizeDeclarationArray(manifest.accesses)
  };
  const entityDefs = buildEntityDefinitions(
    deps,
    { packageId: summary.packageId, packageName: summary.packageName },
    summary.backendMode
  );

  for (const category of ENTITY_KEYS) {
    const rows = declarationsByCategory[category] || [];
    const entityDef = entityDefs[category];
    if (!entityDef) continue;

    for (const declaration of rows) {
      summary.entities[category].requested += 1;
      let normalized;
      try {
        normalized = entityDef.normalize(declaration);
      } catch (error) {
        markResult(summary, category, {
          status: 'failed',
          key: findStableIdentity(category, declaration),
          message: error?.message || String(error)
        });
        continue;
      }

      const identity = findStableIdentity(category, normalized);
      try {
        const existing = await entityDef.find(normalized);
        if (existing && !rowBelongsToSameIdentity(category, existing, normalized)) {
          markResult(summary, category, {
            status: 'failed',
            key: identity,
            id: cleanText(existing?.id, 120),
            message: 'Found a conflicting record identity.'
          });
          continue;
        }

        if (existing) {
          if (isOwnershipConflict(existing, summary.packageId)) {
            markResult(summary, category, {
              status: 'skipped',
              key: identity,
              id: cleanText(existing?.id, 120),
              message: 'Record is owned by another package.'
            });
            continue;
          }

          const adoptExisting = shouldAdoptExisting(declaration, options);
          const existingOwner = getOwnershipFromRow(existing);
          if (!existingOwner.packageId && !adoptExisting) {
            markResult(summary, category, {
              status: 'skipped',
              key: identity,
              id: cleanText(existing?.id, 120),
              message: 'Existing record is unmanaged. Set adoptExisting=true to claim ownership.'
            });
            continue;
          }

          if (isReadonlyExistingRow(category, existing)) {
            const desired = mergeEntityPayload(existing, normalized, entityDef.updateFields);
            if (sameJsonShape(existing, desired)) {
              markResult(summary, category, {
                status: 'skipped',
                key: identity,
                id: cleanText(existing?.id, 120),
                message: 'No changes.'
              });
            } else {
              markResult(summary, category, {
                status: 'skipped',
                key: identity,
                id: cleanText(existing?.id, 120),
                message: 'System-protected record is read-only.'
              });
            }
            continue;
          }

          const patch = mergeEntityPayload(existing, normalized, entityDef.updateFields);
          if (sameJsonShape(existing, patch)) {
            markResult(summary, category, {
              status: 'skipped',
              key: identity,
              id: cleanText(existing?.id, 120),
              message: 'No changes.'
            });
            continue;
          }

          const updated = await entityDef.update(existing.id, patch);
          markResult(summary, category, {
            status: 'updated',
            key: identity,
            id: cleanText(updated?.id || existing?.id, 120),
            message: 'Updated existing record.'
          });
          continue;
        }

        const created = await entityDef.create(normalized);
        markResult(summary, category, {
          status: 'created',
          key: identity,
          id: cleanText(created?.id, 120),
          message: 'Created.'
        });
      } catch (error) {
        markResult(summary, category, {
          status: 'failed',
          key: identity,
          message: error?.message || String(error)
        });
      }
    }
  }
}

async function removeOrDisableEntityDeclarations(manifest, summary, deps, options = {}) {
  const action = normalizeUninstallAction(options?.action);
  const packageId = summary.packageId;
  const packageName = summary.packageName;
  const declarationsByCategory = {
    operations: normalizeDeclarationArray(manifest.operations),
    roles: normalizeDeclarationArray(manifest.roles),
    sections: normalizeDeclarationArray(manifest.sections),
    symbols: normalizeDeclarationArray(manifest.symbols),
    accesses: normalizeDeclarationArray(manifest.accesses)
  };
  const entityDefs = buildEntityDefinitions(
    deps,
    { packageId, packageName },
    summary.backendMode
  );

  for (const category of ENTITY_KEYS) {
    const rows = declarationsByCategory[category] || [];
    const entityDef = entityDefs[category];
    if (!entityDef) continue;

    for (const declaration of rows) {
      summary.entities[category].requested += 1;
      let normalized;
      try {
        normalized = entityDef.normalize(declaration);
      } catch (error) {
        markResult(summary, category, {
          status: 'failed',
          key: findStableIdentity(category, declaration),
          message: error?.message || String(error)
        });
        continue;
      }

      const identity = findStableIdentity(category, normalized);
      try {
        const existing = await entityDef.find(normalized);
        if (!existing || !rowBelongsToSameIdentity(category, existing, normalized)) {
          markResult(summary, category, {
            status: 'skipped',
            key: identity,
            message: 'Record not found.'
          });
          continue;
        }

        const blocked = summarizeUninstallOwnershipResult(category, existing, summary, identity);
        if (blocked) continue;

        if (action === 'remove' && typeof entityDef.remove === 'function') {
          await entityDef.remove(existing.id);
          markResult(summary, category, {
            status: 'removed',
            key: identity,
            id: cleanText(existing?.id, 120),
            message: buildUninstallSummaryMessage('remove')
          });
          continue;
        }

        if (action === 'remove' && !entityDef.remove) {
          markResult(summary, category, {
            status: 'failed',
            key: identity,
            id: cleanText(existing?.id, 120),
            message: 'Remove operation is not supported.'
          });
          continue;
        }

        if (!entityDef.supportsActiveToggle) {
          markResult(summary, category, {
            status: 'skipped',
            key: identity,
            id: cleanText(existing?.id, 120),
            message: 'No active field to deactivate.'
          });
          continue;
        }

        if (normalized.active === false || existing.active === false) {
          markResult(summary, category, {
            status: 'skipped',
            key: identity,
            id: cleanText(existing?.id, 120),
            message: 'Already inactive.'
          });
          continue;
        }

        const updated = await entityDef.update(existing.id, {
          active: false
        });
        markResult(summary, category, {
          status: 'deactivated',
          key: identity,
          id: cleanText(updated?.id || existing?.id, 120),
          message: buildUninstallSummaryMessage('disable')
        });
      } catch (error) {
        markResult(summary, category, {
          status: 'failed',
          key: identity,
          message: error?.message || String(error)
        });
      }
    }
  }
}

async function installUploadFolderDeclarations(manifest, summary, deps) {
  const declarations = normalizeDeclarationArray(manifest.uploadFolders);
  if (!declarations.length) return;

  const uploadSummary = summary.uploadFolders;
  const uploadService = deps.uploadFolderSettingsService;
  const settingsRepo = deps.systemSettingsRepository;
  const uploadDefs = uploadService.getUploadFolderDefinitions();
  const existingKeys = new Set(uploadDefs.map((row) => String(row?.key || '').trim()).filter(Boolean));

  const patch = {};
  declarations.forEach((row) => {
    uploadSummary.requested += 1;
    let normalized;
    try {
      normalized = normalizeUploadFolderDeclaration(row, {
        packageId: summary.packageId,
        packageName: summary.packageName
      });
    } catch (error) {
      uploadSummary.failed += 1;
      summary.results.push({
        category: 'uploadFolders',
        status: 'failed',
        key: cleanText(row?.key, 220),
        id: '',
        message: error?.message || String(error)
      });
      return;
    }

    try {
      const hasKnownKey = existingKeys.has(normalized.key);
      if (!hasKnownKey) {
        if (!normalized.defaultTemplate) {
          throw new Error(`Unknown upload folder key "${normalized.key}" requires defaultTemplate.`);
        }
        uploadService.registerUploadFolderDefinitions([{
          key: normalized.key,
          packageName: normalized.packageName,
          group: normalized.group || 'Package Uploads',
          label: normalized.label || normalized.key,
          defaultTemplate: normalized.defaultTemplate,
          placeholders: normalized.placeholders
        }]);
        existingKeys.add(normalized.key);
        uploadSummary.definitionsRegistered += 1;
      }

      let desiredTemplate = normalized.valueTemplate;
      if (!desiredTemplate && normalized.applyDefault) {
        desiredTemplate = normalized.defaultTemplate || '';
      }
      if (!desiredTemplate && normalized.defaultTemplate && !hasKnownKey) {
        desiredTemplate = normalized.defaultTemplate;
      }
      if (!desiredTemplate) {
        uploadSummary.skipped += 1;
        summary.results.push({
          category: 'uploadFolders',
          status: 'skipped',
          key: normalized.key,
          id: '',
          message: 'No value template provided.'
        });
        return;
      }

      const sanitizedPatch = uploadService.sanitizeUploadFolderSettingsPatch({
        [normalized.key]: desiredTemplate
      });
      patch[normalized.key] = sanitizedPatch[normalized.key];
      uploadSummary.valuesApplied += 1;
      markUploadFolderResult(summary, {
        status: 'updated',
        key: normalized.key,
        id: '',
        message: 'Upload folder value prepared.'
      });
    } catch (error) {
      markUploadFolderResult(summary, {
        status: 'failed',
        key: normalized.key,
        id: '',
        message: error?.message || String(error)
      });
    }
  });

  if (!Object.keys(patch).length) return;

  const settings = await settingsRepo.getSettings({ backendMode: summary.backendMode });
  const currentFolders = settings?.app?.uploadFolders || {};
  const merged = uploadService.mergeUploadFolderSettings(currentFolders, patch);
  if (sameJsonShape(currentFolders, merged)) return;

  await settingsRepo.updateSettings({
    app: {
      ...(settings?.app || {}),
      uploadFolders: merged
    }
  }, SYSTEM_ACTOR, { backendMode: summary.backendMode });

  try {
    if (deps.settingService && typeof deps.settingService.refresh === 'function') {
      await deps.settingService.refresh();
    }
  } catch (_) {
    // Non-fatal: persistence succeeded, runtime cache can refresh naturally on restart.
  }
  uploadSummary.settingsUpdated = true;
}

async function removeOrDisableUploadFolderDeclarations(manifest, summary, deps, options = {}) {
  const action = normalizeUninstallAction(options?.action);
  const declarations = normalizeDeclarationArray(manifest.uploadFolders);
  if (!declarations.length) return;

  const uploadSummary = summary.uploadFolders;
  const uploadService = deps.uploadFolderSettingsService;
  const settingsRepo = deps.systemSettingsRepository;
  const packageName = cleanText(summary.packageName, 80).toUpperCase();
  const uploadDefs = uploadService.getUploadFolderDefinitions();
  const packageDefinitions = new Set(
    uploadDefs
      .filter((row) => {
        const definitionPackage = cleanText(row?.packageName, 120).toUpperCase();
        return !packageName || definitionPackage === packageName;
      })
      .map((row) => String(row?.key || '').trim())
      .filter(Boolean)
  );
  const currentSettings = (await settingsRepo.getSettings({ backendMode: summary.backendMode }))
    ?.app?.uploadFolders || {};
  const nextSettings = { ...(currentSettings || {}) };
  const changedKeys = [];

  declarations.forEach((row) => {
    uploadSummary.requested += 1;
    let normalized;
    try {
      normalized = normalizeUploadFolderDeclaration(row, {
        packageId: summary.packageId,
        packageName: summary.packageName
      });
    } catch (error) {
      markUploadFolderResult(summary, {
        status: 'failed',
        key: cleanText(row?.key, 220),
        id: '',
        message: error?.message || String(error)
      });
      return;
    }

    const key = normalized.key;
    if (!packageDefinitions.has(key)) {
      markUploadFolderResult(summary, {
        status: 'skipped',
        key,
        id: '',
        message: 'Upload folder definition not owned by package.'
      });
      return;
    }

    if (action === 'remove') {
      try {
        const removed = uploadService.removeUploadFolderDefinitions([key]);
        if (removed > 0) {
          markUploadFolderResult(summary, {
            status: 'removed',
            key,
            id: '',
            message: 'Upload folder definition removed.'
          });
        } else {
          markUploadFolderResult(summary, {
            status: 'skipped',
            key,
            id: '',
            message: 'Upload folder definition was not dynamically registered.'
          });
        }
      } catch (error) {
        markUploadFolderResult(summary, {
          status: 'failed',
          key,
          id: '',
          message: error?.message || String(error)
        });
      }

      if (Object.prototype.hasOwnProperty.call(nextSettings, key)) {
        delete nextSettings[key];
        changedKeys.push(key);
      }
      return;
    }

    if (Object.prototype.hasOwnProperty.call(nextSettings, key)) {
      delete nextSettings[key];
      changedKeys.push(key);
    }

    markUploadFolderResult(summary, {
      status: 'cleared',
      key,
      id: '',
      message: 'Upload folder assignment cleared for disable action.'
    });
  });

  if (!changedKeys.length) return;

  const currentJson = JSON.stringify(currentSettings || {});
  const nextJson = JSON.stringify(nextSettings || {});
  if (currentJson === nextJson) return;

  const settings = await settingsRepo.getSettings({ backendMode: summary.backendMode });
  await settingsRepo.updateSettings({
    app: {
      ...(settings?.app || {}),
      uploadFolders: nextSettings
    }
  }, SYSTEM_ACTOR, { backendMode: summary.backendMode });

  uploadSummary.valuesCleared += changedKeys.length;
  uploadSummary.settingsUpdated = true;

  try {
    if (deps.settingService && typeof deps.settingService.refresh === 'function') {
      await deps.settingService.refresh();
    }
  } catch (_) {
    // Non-fatal: persistence succeeded, runtime cache can refresh naturally on restart.
  }
}
async function installPackageRegistryDeclarations(context = {}, options = {}) {
  const deps = createDefaultDependencies(options);
  const packageMeta = normalizePackageContext(context);
  const manifest = context?.manifest && typeof context.manifest === 'object'
    ? context.manifest
    : {};
  const summary = defaultInstallSummary(packageMeta.packageId, packageMeta.packageName);
  summary.backendMode = cleanText(context?.backendMode || options?.backendMode, 20);

  await installEntityDeclarations(manifest, summary, context, deps, options);
  await installUploadFolderDeclarations(manifest, summary, deps);
  return summary;
}

async function removePackageRegistryDeclarations(context = {}, options = {}) {
  const deps = createDefaultDependencies(options);
  const packageMeta = normalizePackageContext(context);
  const manifest = context?.manifest && typeof context.manifest === 'object'
    ? context.manifest
    : {};
  const summary = defaultInstallSummary(packageMeta.packageId, packageMeta.packageName);
  summary.backendMode = cleanText(context?.backendMode || options?.backendMode, 20);
  const action = normalizeUninstallAction(options?.action || context?.action);

  await removeOrDisableEntityDeclarations(manifest, summary, deps, { ...options, action });
  await removeOrDisableUploadFolderDeclarations(manifest, summary, deps, { ...options, action });
  return summary;
}

function createLoaderHooks(options = {}) {
  const deps = createDefaultDependencies(options);
  const logger = deps.logger || startupLogger;
  const queryHooks = packageQueryExecutorService.createLoaderHooks({
    ...options,
    logger
  });
  const routeHooks = packageRouteService.createLoaderHooks({
    ...options,
    logger
  });
  const viewAssetHooks = packageViewAssetService.createLoaderHooks({
    ...options,
    logger
  });
  return {
    registerRoutes: async (context = {}) => {
      const summary = await routeHooks.registerRoutes(context);
      if (logger && typeof logger.info === 'function' && (summary?.requested || summary?.mounted || summary?.failed)) {
        logger.info('PACKAGE_INSTALLER', 'ROUTES', `Route registration complete for ${summary.packageId}.`, {
          packageId: summary.packageId,
          requested: summary.requested,
          prepared: summary.prepared,
          mounted: summary.mounted,
          failed: summary.failed
        });
      }
      return summary;
    },
    registerViews: async (context = {}) => {
      const summary = await viewAssetHooks.registerViews(context);
      if (logger && typeof logger.info === 'function' && (summary?.requested || summary?.registered || summary?.failed)) {
        logger.info('PACKAGE_INSTALLER', 'VIEWS', `View registration complete for ${summary.packageId}.`, {
          packageId: summary.packageId,
          requested: summary.requested,
          registered: summary.registered,
          failed: summary.failed
        });
      }
      return summary;
    },
    registerAssets: async (context = {}) => {
      const summary = await viewAssetHooks.registerAssets(context);
      if (logger && typeof logger.info === 'function' && (summary?.requested || summary?.mounted || summary?.failed)) {
        logger.info('PACKAGE_INSTALLER', 'ASSETS', `Asset registration complete for ${summary.packageId}.`, {
          packageId: summary.packageId,
          requested: summary.requested,
          mounted: summary.mounted,
          failed: summary.failed
        });
      }
      return summary;
    },
    registerRegistryData: async (context = {}) => {
      const summary = await installPackageRegistryDeclarations(context, {
        ...options,
        uploadFoldersOnly: false
      });
      if (logger && typeof logger.info === 'function') {
        logger.info('PACKAGE_INSTALLER', 'REGISTRY_SYNC', `Registry sync complete for ${summary.packageId}.`, {
          packageId: summary.packageId,
          operations: summary.entities.operations,
          roles: summary.entities.roles,
          sections: summary.entities.sections,
          symbols: summary.entities.symbols,
          accesses: summary.entities.accesses
        });
      }
      return summary;
    },
    registerUploadFolders: async () => {
      // Upload folders are installed in the same pass above to keep declaration ordering deterministic.
    },
    registerQueryExecutors: async (context = {}) => {
      const summary = await queryHooks.registerQueryExecutors(context);
      if (logger && typeof logger.info === 'function' && (summary?.registered || summary?.failed)) {
        logger.info('PACKAGE_INSTALLER', 'QUERY_EXECUTORS', `Query executor sync complete for ${summary.packageId}.`, {
          packageId: summary.packageId,
          requested: summary.requested,
          registered: summary.registered,
          failed: summary.failed
        });
      }
      return summary;
    }
  };
}

module.exports = {
  ENTITY_KEYS,
  installPackageRegistryDeclarations,
  removePackageRegistryDeclarations,
  createLoaderHooks,
  createDefaultDependencies
};


