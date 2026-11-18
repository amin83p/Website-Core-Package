'use strict';

const SCHOOL_AI_SERVICES = Object.freeze([
  Object.freeze({
    serviceKey: 'school.report_review',
    label: 'Report Review Service',
    description: 'AI-assisted review and feedback for school report instances.',
    status: 'planned',
    category: 'reports'
  })
]);

function listAiServices({ includePlanned = true } = {}) {
  const rows = SCHOOL_AI_SERVICES.map((row) => ({ ...row }));
  if (includePlanned) return rows;
  return rows.filter((row) => String(row.status || '').toLowerCase() === 'implemented');
}

function getAiServiceByKey(serviceKey = '') {
  const token = String(serviceKey || '').trim();
  if (!token) return null;
  return SCHOOL_AI_SERVICES.find((row) => String(row.serviceKey) === token) || null;
}

module.exports = {
  SCHOOL_AI_SERVICES,
  listAiServices,
  getAiServiceByKey
};