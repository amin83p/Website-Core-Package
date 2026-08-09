'use strict';

const startupLogger = require('../../utils/startupLogger');

const ALLOWED_ENFORCE_GROUPS = Object.freeze(['auth', 'picker', 'write', 'heavy', 'global']);
const TARGET_ENFORCE_GROUPS = Object.freeze(['write', 'heavy']);

function normalizeGroupList(groups) {
  const set = new Set();
  if (Array.isArray(groups)) {
    groups.forEach((group) => {
      const token = String(group || '').trim().toLowerCase();
      if (ALLOWED_ENFORCE_GROUPS.includes(token)) set.add(token);
    });
  }
  TARGET_ENFORCE_GROUPS.forEach((group) => set.add(group));
  return ALLOWED_ENFORCE_GROUPS.filter((group) => set.has(group));
}

function needsWriteHeavyEnforcement(requestControl = {}) {
  const phase2 = requestControl.phase2 || {};
  if (phase2.enabled !== true) return true;
  const groups = Array.isArray(phase2.enforceGroups)
    ? phase2.enforceGroups.map((group) => String(group || '').trim().toLowerCase())
    : [];
  return !groups.includes('write') || !groups.includes('heavy');
}

async function ensureWriteHeavyRateLimitEnforcement(options = {}) {
  const getWebsitePolicy = options.getWebsitePolicy;
  const updateWebsitePolicy = options.updateWebsitePolicy;
  if (typeof getWebsitePolicy !== 'function' || typeof updateWebsitePolicy !== 'function') {
    throw new Error('getWebsitePolicy and updateWebsitePolicy are required.');
  }

  const policy = await getWebsitePolicy();
  const requestControl = policy?.requestControl || {};
  if (!needsWriteHeavyEnforcement(requestControl)) {
    return { updated: false, enforceGroups: requestControl.phase2?.enforceGroups || [] };
  }

  const phase2 = requestControl.phase2 || {};
  const enforceGroups = normalizeGroupList(phase2.enforceGroups);
  await updateWebsitePolicy({
    requestControl: {
      ...requestControl,
      phase2: {
        ...phase2,
        enabled: true,
        enforceGroups
      }
    }
  }, options.requestingUser || { id: 'SYSTEM', username: 'rate-limit-bootstrap' });

  startupLogger.info('REQUEST_RATE', 'PHASE2_ENFORCE', 'Enabled write/heavy rate-limit enforcement.', {
    enforceGroups
  });

  return { updated: true, enforceGroups };
}

module.exports = {
  ALLOWED_ENFORCE_GROUPS,
  TARGET_ENFORCE_GROUPS,
  normalizeGroupList,
  needsWriteHeavyEnforcement,
  ensureWriteHeavyRateLimitEnforcement
};
