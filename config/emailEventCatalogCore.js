'use strict';

const { SECTIONS, OPERATIONS } = require('./accessConstants');

function cleanString(value, { max = 160, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeToken(value = '', { max = 160 } = {}) {
  return cleanString(value, { max, allowEmpty: true }).toUpperCase();
}

function toEventKey(sectionId = '', operationId = '') {
  return `${normalizeToken(sectionId, { max: 120 })}::${normalizeToken(operationId, { max: 120 })}`;
}

function freezeEvent(raw = {}) {
  const eventKey = normalizeToken(raw.eventKey, { max: 120 });
  const sectionId = normalizeToken(raw.sectionId, { max: 120 });
  const operationId = normalizeToken(raw.operationId, { max: 120 });
  const packageName = normalizeToken(raw.packageName || 'CORE', { max: 64 });
  const label = cleanString(raw.label, { max: 180, allowEmpty: true });
  const resolverId = cleanString(raw.resolverId, { max: 120, allowEmpty: true });
  const allowedPlaceholders = Array.isArray(raw.allowedPlaceholders)
    ? raw.allowedPlaceholders.map((token) => normalizeToken(token, { max: 120 })).filter(Boolean)
    : [];
  const requiredPlaceholders = Array.isArray(raw.requiredPlaceholders)
    ? raw.requiredPlaceholders.map((token) => normalizeToken(token, { max: 120 })).filter(Boolean)
    : [];
  const runtimePlaceholders = Array.isArray(raw.runtimePlaceholders)
    ? raw.runtimePlaceholders.map((token) => normalizeToken(token, { max: 120 })).filter(Boolean)
    : [];
  const isActive = raw.isActive !== false;
  if (!eventKey || !sectionId || !operationId) {
    throw new Error('[emailEventCatalog] Every event must include eventKey, sectionId, and operationId.');
  }

  const allowedSet = new Set(allowedPlaceholders);
  const missingFromAllowed = requiredPlaceholders.filter((token) => !allowedSet.has(token));
  if (missingFromAllowed.length > 0) {
    throw new Error(
      `[emailEventCatalog] Event '${eventKey}' has required placeholders not listed in allowedPlaceholders: ${missingFromAllowed.join(', ')}.`
    );
  }
  runtimePlaceholders.forEach((token) => allowedSet.add(token));

  return Object.freeze({
    eventKey,
    label: label || eventKey,
    packageName,
    sectionId,
    operationId,
    resolverId: resolverId || '',
    allowedPlaceholders: Object.freeze(Array.from(allowedSet)),
    requiredPlaceholders: Object.freeze(Array.from(new Set(requiredPlaceholders))),
    runtimePlaceholders: Object.freeze(Array.from(new Set(runtimePlaceholders))),
    isActive
  });
}

function cloneEvent(event = null) {
  if (!event) return null;
  return {
    eventKey: event.eventKey,
    label: event.label,
    packageName: event.packageName,
    sectionId: event.sectionId,
    operationId: event.operationId,
    resolverId: event.resolverId,
    allowedPlaceholders: Array.isArray(event.allowedPlaceholders) ? event.allowedPlaceholders.slice() : [],
    requiredPlaceholders: Array.isArray(event.requiredPlaceholders) ? event.requiredPlaceholders.slice() : [],
    runtimePlaceholders: Array.isArray(event.runtimePlaceholders) ? event.runtimePlaceholders.slice() : [],
    isActive: event.isActive !== false
  };
}

function includeEvent(event = null, { includeInactive = false } = {}) {
  if (!event) return false;
  if (includeInactive) return true;
  return event.isActive !== false;
}

module.exports = {
  SECTIONS,
  OPERATIONS,
  cleanString,
  normalizeToken,
  toEventKey,
  freezeEvent,
  cloneEvent,
  includeEvent
};
