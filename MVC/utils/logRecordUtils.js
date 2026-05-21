const { toPublicId } = require('./idAdapter');

const REDACTED_VALUE = '[REDACTED]';
const SYSTEM_USER_ID = 'system';
const SYSTEM_ORG_ID = 'SYSTEM';
const SYSTEM_USERNAME = 'system';
const SYSTEM_DISPLAY_NAME = 'System';

const SENSITIVE_KEY_PATTERN = /(pass(word)?|token|cookie|auth(entication|orization)?|secret|api[_-]?key|session[_-]?key|private[_-]?key)/i;

function cleanText(value, max = 200) {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeId(value, fallback = '') {
  const normalized = toPublicId(value);
  if (normalized) return normalized;
  const text = cleanText(value, 120);
  return text || fallback;
}

function isSystemId(value) {
  const token = cleanText(value, 120).toLowerCase();
  return token === 'system' || token === 'sys' || token === 'root_system';
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function shouldRedactKey(key) {
  const text = cleanText(key, 160).toLowerCase();
  if (!text) return false;
  return SENSITIVE_KEY_PATTERN.test(text);
}

function redactSensitiveValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item, seen));
  }

  const output = {};
  Object.entries(value).forEach(([key, raw]) => {
    if (shouldRedactKey(key)) {
      output[key] = REDACTED_VALUE;
      return;
    }
    output[key] = redactSensitiveValue(raw, seen);
  });
  return output;
}

function buildActorSnapshot(user, options = {}) {
  const source = isPlainObject(user) ? user : {};
  const fallback = isPlainObject(options?.fallbackActor) ? options.fallbackActor : {};

  const rawUserId = source.id || source.userId || fallback.userId || '';
  const userId = normalizeId(rawUserId, '');
  const username = cleanText(source.username || fallback.username || '', 140);
  const displayName = cleanText(
    source.displayName || source.name || fallback.displayName || fallback.name || username || userId || '',
    180
  );
  const orgId = normalizeId(
    source.activeOrgId || source.primaryOrgId || source.orgId || fallback.orgId || options?.orgId || '',
    ''
  );

  const treatAsSystem = !userId || isSystemId(userId) || (!username && !displayName && options?.forceSystem === true);
  if (treatAsSystem) {
    return {
      actorType: 'system',
      userId: SYSTEM_USER_ID,
      username: SYSTEM_USERNAME,
      displayName: SYSTEM_DISPLAY_NAME,
      orgId: normalizeId(orgId, SYSTEM_ORG_ID) || SYSTEM_ORG_ID
    };
  }

  return {
    actorType: 'user',
    userId,
    username: username || userId,
    displayName: displayName || username || userId,
    orgId: orgId || null
  };
}

function normalizeStatus(status) {
  const token = cleanText(status || 'SUCCESS', 40).toUpperCase();
  return token || 'SUCCESS';
}

function normalizeActionStateId(value) {
  return cleanText(value, 180);
}

function normalizeDetails(details, options = {}) {
  const base = isPlainObject(details) ? details : {};
  const redacted = redactSensitiveValue(base);
  const output = isPlainObject(redacted) ? { ...redacted } : {};

  if (options?.requestId) {
    output.requestId = cleanText(options.requestId, 120);
  } else if (output.requestId) {
    output.requestId = cleanText(output.requestId, 120);
  }

  if (options?.actorSnapshot) {
    output.actor = {
      actorType: options.actorSnapshot.actorType,
      userId: options.actorSnapshot.userId,
      username: options.actorSnapshot.username,
      displayName: options.actorSnapshot.displayName,
      orgId: options.actorSnapshot.orgId
    };
  } else if (isPlainObject(output.actor)) {
    const actor = buildActorSnapshot({}, { fallbackActor: output.actor });
    output.actor = {
      actorType: actor.actorType,
      userId: actor.userId,
      username: actor.username,
      displayName: actor.displayName,
      orgId: actor.orgId
    };
  }

  const actionStateId = normalizeActionStateId(
    options?.actionStateId
    || output.actionStateId
    || ''
  );
  if (actionStateId) output.actionStateId = actionStateId;

  return output;
}

function canonicalizeLogInput(input = {}) {
  const actionStateId = normalizeActionStateId(input.actionStateId || input?.details?.actionStateId);
  const actor = buildActorSnapshot(input.user, {
    orgId: input.orgId,
    fallbackActor: input?.details?.actor
  });
  const details = normalizeDetails(input.details, {
    requestId: input.requestId,
    actorSnapshot: actor,
    actionStateId
  });

  return {
    id: cleanText(input.id, 120),
    timestamp: cleanText(input.timestamp, 60),
    sectionId: cleanText(input.sectionId, 120),
    operationId: cleanText(input.operationId, 120),
    userId: actor.userId,
    username: actor.username,
    displayName: actor.displayName,
    orgId: actor.orgId,
    actorType: actor.actorType,
    status: normalizeStatus(input.status),
    details,
    requestId: cleanText(details.requestId || input.requestId || '', 120),
    actionStateId: normalizeActionStateId(actionStateId || details.actionStateId || '')
  };
}

function normalizePersistedLogRecord(record = {}) {
  if (!isPlainObject(record)) return null;

  const actor = buildActorSnapshot(record.user, {
    orgId: record.orgId,
    fallbackActor: {
      userId: record.userId,
      username: record.username,
      displayName: record.displayName,
      orgId: record.orgId,
      actorType: record.actorType,
      ...(isPlainObject(record.details?.actor) ? record.details.actor : {})
    },
    forceSystem: true
  });

  const details = normalizeDetails(record.details, {
    requestId: record.requestId,
    actorSnapshot: actor,
    actionStateId: record.actionStateId
  });

  const actionStateId = normalizeActionStateId(record.actionStateId || details.actionStateId || '');

  return {
    ...record,
    userId: actor.userId,
    username: actor.username,
    displayName: actor.displayName,
    orgId: actor.orgId,
    actorType: actor.actorType,
    details,
    requestId: cleanText(record.requestId || details.requestId || '', 120),
    actionStateId
  };
}

module.exports = {
  REDACTED_VALUE,
  canonicalizeLogInput,
  normalizePersistedLogRecord,
  normalizeStatus,
  normalizeDetails,
  buildActorSnapshot,
  cleanText
};
