const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const MAX_TARGET_DEPARTMENTS = 50;
const ID_PATTERN = /^[A-Za-z0-9:_-]+$/;

function normalizeTargetDepartmentIds(value) {
  const rawValues = Array.isArray(value)
    ? value
    : (value === undefined || value === null || value === '')
      ? []
      : String(value).split(/[,;\s]+/);

  const seen = new Set();
  const out = [];
  rawValues.forEach((entry) => {
    const id = toPublicId(entry);
    if (!id) return;
    if (!ID_PATTERN.test(id)) {
      throw new Error(`Invalid target department id: ${id}.`);
    }
    const key = String(id).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(id);
    if (out.length > MAX_TARGET_DEPARTMENTS) {
      throw new Error(`A template may target at most ${MAX_TARGET_DEPARTMENTS} departments.`);
    }
  });
  return out.sort((a, b) => String(a).localeCompare(String(b)));
}

function resolveTargetDepartmentFields(template = {}) {
  const ids = normalizeTargetDepartmentIds(template?.targetDepartmentIds);
  return { targetDepartmentIds: ids };
}

function parseTargetDepartmentIdsFromBody(body = {}, existingTemplate = null) {
  const present = String(body?.targetDepartmentIdsPresent || '').trim();
  if (!present) {
    return resolveTargetDepartmentFields(existingTemplate || {}).targetDepartmentIds;
  }
  const submitted = body?.targetDepartmentIds;
  if (submitted === undefined || submitted === null) {
    return [];
  }
  return normalizeTargetDepartmentIds(submitted);
}

function withResolvedTargetDepartments(template) {
  if (!template || typeof template !== 'object') return template;
  const { targetDepartmentIds } = resolveTargetDepartmentFields(template);
  return { ...template, targetDepartmentIds };
}

function resolveClassDeliveryDepartmentId(classData) {
  return toPublicId(classData?.deliveryDepartmentId) || '';
}

function templateMatchesDeliveryDepartment(template, deliveryDepartmentId) {
  const { targetDepartmentIds } = resolveTargetDepartmentFields(template);
  if (!targetDepartmentIds.length) return true;
  const deptId = toPublicId(deliveryDepartmentId);
  if (!deptId) return false;
  return targetDepartmentIds.some((id) => idsEqual(id, deptId));
}

function filterTemplatesForDeliveryDepartment(templates, deliveryDepartmentId, options = {}) {
  const alwaysIncludeTemplateId = toPublicId(options.alwaysIncludeTemplateId) || '';
  const list = Array.isArray(templates) ? templates : [];
  return list.filter((row) => {
    if (alwaysIncludeTemplateId && idsEqual(row?.id, alwaysIncludeTemplateId)) return true;
    return templateMatchesDeliveryDepartment(row, deliveryDepartmentId);
  });
}

function assertTemplateMatchesClass(template, classData) {
  const deliveryDepartmentId = resolveClassDeliveryDepartmentId(classData);
  const { targetDepartmentIds } = resolveTargetDepartmentFields(template);
  if (!targetDepartmentIds.length) return;
  if (!deliveryDepartmentId) {
    throw new Error('This report template is restricted to specific departments, but the class has no delivery department.');
  }
  if (!templateMatchesDeliveryDepartment(template, deliveryDepartmentId)) {
    throw new Error('The selected report template is not available for this class delivery department.');
  }
}

function summarizeTargetDepartments(template) {
  const { targetDepartmentIds } = resolveTargetDepartmentFields(template);
  if (!targetDepartmentIds.length) return 'General';
  return targetDepartmentIds.length === 1
    ? '1 department'
    : `${targetDepartmentIds.length} departments`;
}

module.exports = {
  MAX_TARGET_DEPARTMENTS,
  normalizeTargetDepartmentIds,
  resolveTargetDepartmentFields,
  parseTargetDepartmentIdsFromBody,
  withResolvedTargetDepartments,
  resolveClassDeliveryDepartmentId,
  templateMatchesDeliveryDepartment,
  filterTemplatesForDeliveryDepartment,
  assertTemplateMatchesClass,
  summarizeTargetDepartments
};
