#!/usr/bin/env node
/* eslint-disable no-console */
const activityQuotaConsumptionDefinitionRepository = require('../MVC/repositories/activityQuotaConsumptionDefinitionRepository');
const { SECTIONS, OPERATIONS } = require('../config/accessConstants');

function cleanString(value, { max = 200, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const token = String(value).trim();
  if (!allowEmpty && !token) return null;
  return token.length > max ? token.slice(0, max) : token;
}

function getArg(name, fallback = '') {
  const full = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!full) return fallback;
  return cleanString(full.slice(name.length + 3), { max: 240, allowEmpty: true }) || fallback;
}

function addYears(dateToken, years = 10) {
  const base = new Date(`${dateToken}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return dateToken;
  base.setUTCFullYear(base.getUTCFullYear() + years);
  return base.toISOString().slice(0, 10);
}

function buildFormula({ volumeBase = 0, volumeMultiplier = 0, volumeContextKey = '' } = {}) {
  return {
    call: { base: 1, multiplier: 0, contextKey: '' },
    amount: { base: 0, multiplier: 0, contextKey: '' },
    token: { base: 0, multiplier: 0, contextKey: '' },
    volume: { base: volumeBase, multiplier: volumeMultiplier, contextKey: volumeContextKey }
  };
}

function buildSeedRows(orgId, timezone = 'UTC') {
  const startDate = new Date().toISOString().slice(0, 10);
  const endDate = addYears(startDate, 10);
  const validity = {
    mode: 'date_range',
    startDate,
    endDate,
    timezone
  };

  const rows = [
    {
      key: `${SECTIONS.PTE_PRACTICE_BY_SKILLS}::${OPERATIONS.CREATE}::fallback`,
      name: 'PTE Practice Start Fallback',
      sectionId: SECTIONS.PTE_PRACTICE_BY_SKILLS,
      operationId: OPERATIONS.CREATE,
      sourceEventType: '',
      isFallback: true,
      formula: buildFormula({ volumeBase: 0, volumeMultiplier: 1, volumeContextKey: 'questionCount' })
    },
    {
      key: `${SECTIONS.PTE_PRACTICE_BY_SKILLS}::${OPERATIONS.CREATE}::practice_attempt_started`,
      name: 'PTE Practice Start Event',
      sectionId: SECTIONS.PTE_PRACTICE_BY_SKILLS,
      operationId: OPERATIONS.CREATE,
      sourceEventType: 'practice_attempt_started',
      isFallback: false,
      formula: buildFormula({ volumeBase: 0, volumeMultiplier: 1, volumeContextKey: 'questionCount' })
    },
    {
      key: `${SECTIONS.PTE_PRACTICE_BY_SKILLS}::${OPERATIONS.UPDATE}::fallback`,
      name: 'PTE Practice Reopen Fallback',
      sectionId: SECTIONS.PTE_PRACTICE_BY_SKILLS,
      operationId: OPERATIONS.UPDATE,
      sourceEventType: '',
      isFallback: true,
      formula: buildFormula({ volumeBase: 0, volumeMultiplier: 1, volumeContextKey: 'questionCount' })
    },
    {
      key: `${SECTIONS.PTE_PRACTICE_BY_SKILLS}::${OPERATIONS.UPDATE}::practice_attempt_reopened`,
      name: 'PTE Practice Reopen Event',
      sectionId: SECTIONS.PTE_PRACTICE_BY_SKILLS,
      operationId: OPERATIONS.UPDATE,
      sourceEventType: 'practice_attempt_reopened',
      isFallback: false,
      formula: buildFormula({ volumeBase: 0, volumeMultiplier: 1, volumeContextKey: 'questionCount' })
    },
    {
      key: `${SECTIONS.PTE_PRACTICE_BY_SKILLS}::${OPERATIONS.READ_ALL}::fallback`,
      name: 'PTE Practice Attempts List Fallback',
      sectionId: SECTIONS.PTE_PRACTICE_BY_SKILLS,
      operationId: OPERATIONS.READ_ALL,
      sourceEventType: '',
      isFallback: true,
      formula: buildFormula({ volumeBase: 1, volumeMultiplier: 0, volumeContextKey: '' })
    },
    {
      key: `${SECTIONS.PTE_PRACTICE_BY_SKILLS}::${OPERATIONS.READ_ALL}::practice_attempts_list_viewed`,
      name: 'PTE Practice Attempts List Event',
      sectionId: SECTIONS.PTE_PRACTICE_BY_SKILLS,
      operationId: OPERATIONS.READ_ALL,
      sourceEventType: 'practice_attempts_list_viewed',
      isFallback: false,
      formula: buildFormula({ volumeBase: 1, volumeMultiplier: 0, volumeContextKey: '' })
    },
    {
      key: `${SECTIONS.PTE_PRACTICE_BY_SKILLS}::${OPERATIONS.READ}::fallback`,
      name: 'PTE Practice Attempt Detail Fallback',
      sectionId: SECTIONS.PTE_PRACTICE_BY_SKILLS,
      operationId: OPERATIONS.READ,
      sourceEventType: '',
      isFallback: true,
      formula: buildFormula({ volumeBase: 1, volumeMultiplier: 0, volumeContextKey: '' })
    },
    {
      key: `${SECTIONS.PTE_PRACTICE_BY_SKILLS}::${OPERATIONS.READ}::practice_attempt_detail_viewed`,
      name: 'PTE Practice Attempt Detail Event',
      sectionId: SECTIONS.PTE_PRACTICE_BY_SKILLS,
      operationId: OPERATIONS.READ,
      sourceEventType: 'practice_attempt_detail_viewed',
      isFallback: false,
      formula: buildFormula({ volumeBase: 1, volumeMultiplier: 0, volumeContextKey: '' })
    }
  ];

  return rows.map((row) => ({
    ...row,
    orgId,
    description: 'Seeded by script: definition-based PTE practice quota consumption.',
    active: true,
    targetUserIds: [],
    validity,
    consumeTiming: 'on_attempt',
    creator: {
      type: 'system',
      displayName: 'System',
      userId: '',
      username: '',
      email: '',
      orgId
    },
    audit: {
      createUser: 'System',
      createDateTime: new Date().toISOString(),
      lastUpdateUser: 'System',
      lastUpdateDateTime: new Date().toISOString()
    }
  }));
}

async function upsertRows(orgId, backendMode = '', timezone = 'UTC') {
  const rows = buildSeedRows(orgId, timezone);
  const existing = await activityQuotaConsumptionDefinitionRepository.list({
    query: {
      orgId__eq: orgId,
      sectionId__eq: SECTIONS.PTE_PRACTICE_BY_SKILLS
    },
    scope: { canViewAll: true },
    backendMode: backendMode || undefined
  });

  const map = new Map();
  (Array.isArray(existing) ? existing : []).forEach((row) => {
    const key = [
      cleanString(row?.sectionId, { max: 120, allowEmpty: true }) || '',
      cleanString(row?.operationId, { max: 120, allowEmpty: true }) || '',
      cleanString(row?.sourceEventType, { max: 120, allowEmpty: true }) || '',
      row?.isFallback === true ? 'fallback' : 'normal'
    ].join('::');
    map.set(key, row);
  });

  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const key = [
      row.sectionId,
      row.operationId,
      row.sourceEventType || '',
      row.isFallback ? 'fallback' : 'normal'
    ].join('::');
    const matched = map.get(key);
    if (!matched) {
      // eslint-disable-next-line no-await-in-loop
      await activityQuotaConsumptionDefinitionRepository.create(row, {
        backendMode: backendMode || undefined
      });
      created += 1;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await activityQuotaConsumptionDefinitionRepository.update(matched.id, {
      ...row,
      audit: {
        ...(matched.audit || {}),
        lastUpdateUser: 'System',
        lastUpdateDateTime: new Date().toISOString()
      }
    }, {
      backendMode: backendMode || undefined
    });
    updated += 1;
  }

  return { created, updated, total: rows.length };
}

async function main() {
  const orgId = getArg('org');
  if (!orgId) {
    throw new Error('Missing --org=<ORG_ID>.');
  }
  const backendMode = getArg('backend', '');
  const timezone = getArg('timezone', 'UTC');
  const result = await upsertRows(orgId, backendMode, timezone);
  console.log(`Seed complete for org=${orgId}. created=${result.created}, updated=${result.updated}, total=${result.total}`);
}

main().catch((error) => {
  console.error(`Seed failed: ${error.message}`);
  process.exit(1);
});
