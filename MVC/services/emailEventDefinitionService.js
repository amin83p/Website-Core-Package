const adminChekersService = require('./adminChekersService');
const emailEventDefinitionRepository = require('../repositories/emailEventDefinitionRepository');
const sectionsOperationsCatalogCacheService = require('./cache/sectionsOperationsCatalogCacheService');
const accessService = require('./security');
const packageNavigationService = require('./packageNavigationService');
const { listSupportedEmailEvents } = require('../../config/emailEventCatalog');

function cleanString(value, { max = 5000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeKeyToken(value = '') {
  return cleanString(value, { max: 120, allowEmpty: true }).toUpperCase();
}

function isSystemCatalogAuthor(user = null) {
  if (!user) return false;
  if (!adminChekersService.isSuperAdmin(user)) return false;
  return String(user?.activeOrgId || '').toUpperCase() === 'SYSTEM';
}

function catalogEventToDefinition(event = {}) {
  return {
    id: normalizeKeyToken(event.eventKey),
    eventKey: normalizeKeyToken(event.eventKey),
    sectionId: normalizeKeyToken(event.sectionId),
    operationId: normalizeKeyToken(event.operationId),
    packageName: cleanString(event.packageName, { max: 64, allowEmpty: true }).toUpperCase() || 'CORE',
    label: cleanString(event.label, { max: 180, allowEmpty: true }) || normalizeKeyToken(event.eventKey),
    resolverId: cleanString(event.resolverId, { max: 120, allowEmpty: true }) || '',
    allowedPlaceholders: Array.isArray(event.allowedPlaceholders) ? event.allowedPlaceholders.slice() : [],
    requiredPlaceholders: Array.isArray(event.requiredPlaceholders) ? event.requiredPlaceholders.slice() : [],
    runtimePlaceholders: Array.isArray(event.runtimePlaceholders) ? event.runtimePlaceholders.slice() : [],
    isActive: event.isActive !== false
  };
}

function decorateDefinitionRow(row = {}) {
  const requiredSet = new Set(Array.isArray(row.requiredPlaceholders) ? row.requiredPlaceholders : []);
  const runtimeSet = new Set(Array.isArray(row.runtimePlaceholders) ? row.runtimePlaceholders : []);
  const allowed = Array.isArray(row.allowedPlaceholders) ? row.allowedPlaceholders : [];
  const placeholders = allowed.map((key) => {
    const token = normalizeKeyToken(key);
    let kind = 'optional';
    if (runtimeSet.has(token)) kind = 'runtime';
    else if (requiredSet.has(token)) kind = 'resolver';
    return {
      key: token,
      kind,
      description: kind === 'runtime'
        ? 'Injected at send time via injectedValues (optional in template).'
        : (kind === 'resolver' ? 'Resolved from sender context (required in template).' : 'Allowed placeholder token.')
    };
  });
  return {
    ...row,
    compositeKey: `${row.sectionId}::${row.eventKey}`,
    placeholders
  };
}

async function userCanAccessSectionName(user = null, sectionNameToken = '') {
  if (!user) return false;
  if (isSystemCatalogAuthor(user)) return true;
  const section = await sectionsOperationsCatalogCacheService.findSectionByName(sectionNameToken);
  if (!section || section.active !== true) return false;
  const ops = Array.isArray(section.operations) ? section.operations : [];
  if (!ops.length) return false;
  for (const op of ops) {
    const operationId = op?.id || op;
    const result = await accessService.evaluateAccess({
      user,
      sectionId: section.id,
      operationId
    });
    if (result?.allowed) return true;
  }
  return false;
}

function isPackageEnabledForDefinition(row = {}) {
  const packageName = cleanString(row?.packageName, { max: 64, allowEmpty: true }).toUpperCase();
  if (!packageName || packageName === 'CORE') return true;
  return packageNavigationService.isPackageEnabled(packageName);
}

const emailEventDefinitionService = {
  isSystemCatalogAuthor,
  catalogEventToDefinition,
  decorateDefinitionRow,

  async listDefinitions(query = {}) {
    const rows = await emailEventDefinitionRepository.list({
      scope: { canViewAll: true },
      query: { ...(query || {}), page: 1, limit: 5000 }
    });
    return (Array.isArray(rows) ? rows : []).map((row) => decorateDefinitionRow(row));
  },

  async getDefinitionByEventKey(eventKey = '') {
    const row = await emailEventDefinitionRepository.getByEventKey(eventKey, {
      scope: { canViewAll: true }
    });
    return row ? decorateDefinitionRow(row) : null;
  },

  async syncFromCodeCatalog() {
    const events = listSupportedEmailEvents({ includeInactive: true });
    let upserted = 0;
    for (const event of events) {
      await emailEventDefinitionRepository.upsertByEventKey(
        catalogEventToDefinition(event),
        { scope: { canViewAll: true } }
      );
      upserted += 1;
    }
    return { upserted, total: events.length };
  },

  async resolveDefinitionRows(includeInactive = false) {
    const query = includeInactive ? {} : { isActive__eq: 'true' };
    let rows = await this.listDefinitions(query);
    let source = 'mongo';

    if (!rows.length) {
      try {
        await this.syncFromCodeCatalog();
        rows = await this.listDefinitions(query);
        if (rows.length) source = 'mongo-after-sync';
      } catch (_) {
        // Continue to code-catalog fallback when sync is unavailable.
      }
    }

    if (!rows.length) {
      rows = listSupportedEmailEvents({ includeInactive })
        .map((event) => decorateDefinitionRow(catalogEventToDefinition(event)));
      source = 'code-catalog';
    }

    return { rows, source };
  },

  async getAccessibleEventDefinitions(requestingUser = null, options = {}) {
    const includeInactive = options?.includeInactive === true;
    const forceEventKeys = new Set(
      (Array.isArray(options?.forceEventKeys) ? options.forceEventKeys : [])
        .map((key) => normalizeKeyToken(key))
        .filter(Boolean)
    );

    const { rows } = await this.resolveDefinitionRows(includeInactive);

    const accessible = [];
    for (const row of rows) {
      const eventKey = normalizeKeyToken(row?.eventKey);
      if (!eventKey) continue;

      const forced = forceEventKeys.has(eventKey);
      if (!forced) {
        if (!includeInactive && row.isActive === false) continue;
        if (!isPackageEnabledForDefinition(row)) continue;
        const canAccess = await userCanAccessSectionName(requestingUser, row.sectionId);
        if (!canAccess) continue;
      }

      accessible.push({
        ...row,
        readOnly: forced && !(await userCanAccessSectionName(requestingUser, row.sectionId))
      });
    }

    return accessible.sort((a, b) => {
      const packageCmp = String(a.packageName || '').localeCompare(String(b.packageName || ''));
      if (packageCmp !== 0) return packageCmp;
      return String(a.label || a.eventKey).localeCompare(String(b.label || b.eventKey));
    });
  },

  buildPlaceholderRegistrySnapshot(definitions = []) {
    const rows = Array.isArray(definitions) ? definitions : [];
    return rows.map((event) => ({
      key: event.eventKey,
      eventKey: event.eventKey,
      packageName: event.packageName,
      sectionId: event.sectionId,
      operationId: event.operationId,
      label: event.label,
      allowed: Array.isArray(event.allowedPlaceholders) ? event.allowedPlaceholders.slice() : [],
      required: Array.isArray(event.requiredPlaceholders) ? event.requiredPlaceholders.slice() : [],
      runtime: Array.isArray(event.runtimePlaceholders) ? event.runtimePlaceholders.slice() : [],
      placeholders: Array.isArray(event.placeholders) ? event.placeholders.slice() : []
    }));
  },

  async getAccessiblePlaceholderRegistry(requestingUser = null, options = {}) {
    const definitions = await this.getAccessibleEventDefinitions(requestingUser, options);
    return this.buildPlaceholderRegistrySnapshot(definitions);
  },

  classifyPlaceholderKind(token = '', definition = {}) {
    const key = normalizeKeyToken(token);
    if (!key || !definition) return 'optional';
    const required = new Set((definition.requiredPlaceholders || []).map(normalizeKeyToken));
    const runtime = new Set((definition.runtimePlaceholders || []).map(normalizeKeyToken));
    if (runtime.has(key)) return 'runtime';
    if (required.has(key)) return 'resolver';
    return 'optional';
  },

  buildPlaceholderPickerRows(definition = {}, eventKey = '') {
    if (!definition || typeof definition !== 'object') return [];
    const decorated = Array.isArray(definition.placeholders) && definition.placeholders.length
      ? definition
      : decorateDefinitionRow(definition);
    const token = normalizeKeyToken(eventKey || decorated.eventKey || '');
    return (Array.isArray(decorated.placeholders) ? decorated.placeholders : []).map((row) => {
      const key = normalizeKeyToken(row?.key || '');
      const kind = String(row?.kind || 'optional');
      const kindLabel = kind === 'resolver'
        ? 'Required'
        : (kind === 'runtime' ? 'Runtime' : 'Allowed');
      return {
        id: key,
        key,
        name: `{{${key}}} (${kindLabel})`,
        kind: kindLabel,
        description: row?.description || '',
        eventKey: token
      };
    }).filter((row) => row.key);
  },

  buildGlobalPlaceholderPickerRows(registrySnapshot = []) {
    const rows = Array.isArray(registrySnapshot) ? registrySnapshot : [];
    const byKey = new Map();

    rows.forEach((eventRow) => {
      const eventKey = normalizeKeyToken(eventRow?.eventKey || '');
      const eventLabel = cleanString(eventRow?.label, { max: 180, allowEmpty: true }) || eventKey;
      const allowed = Array.isArray(eventRow?.allowed) ? eventRow.allowed : [];
      allowed.forEach((token) => {
        const key = normalizeKeyToken(token);
        if (!key || key === 'NONE') return;
        let entry = byKey.get(key);
        if (!entry) {
          entry = {
            id: key,
            key,
            name: `{{${key}}}`,
            eventKeys: [],
            eventLabels: []
          };
          byKey.set(key, entry);
        }
        if (eventKey && !entry.eventKeys.includes(eventKey)) {
          entry.eventKeys.push(eventKey);
          entry.eventLabels.push(eventLabel || eventKey);
        }
      });
    });

    return Array.from(byKey.values())
      .map((entry) => ({
        ...entry,
        description: entry.eventLabels.length
          ? `Used in: ${entry.eventLabels.join(', ')}`
          : ''
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }
};

module.exports = emailEventDefinitionService;
