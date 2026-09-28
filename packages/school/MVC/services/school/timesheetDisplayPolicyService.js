'use strict';

const timesheetLegacyImportService = require('./timesheetLegacyImportService');

const ROW_KINDS = Object.freeze([
  'pulledClassSession',
  'pulledActivityAssignee',
  'manualRow',
  'importedTimesheet'
]);

const MANDATORY_DISPLAY_FIELD = 'departmentName';

const DISPLAY_FIELD_KEYS = Object.freeze([
  'departmentName',
  'activityName',
  'workSessionName',
  'assigneeNote',
  'className',
  'sessionDateTime',
  'importedRowContent'
]);

const DISPLAY_FIELD_CATALOG = Object.freeze({
  departmentName: { label: 'Department Name', mandatory: true },
  activityName: { label: 'Activity Name' },
  workSessionName: { label: 'Work Session Name' },
  assigneeNote: { label: 'Assignee Note In the Work Session' },
  className: { label: 'Class Name' },
  sessionDateTime: { label: 'Session Start/End Time' },
  importedRowContent: { label: 'Imported Timesheet Row Content' }
});

const ALLOWED_FIELDS_BY_KIND = Object.freeze({
  pulledClassSession: ['departmentName', 'className', 'sessionDateTime'],
  pulledActivityAssignee: [
    'departmentName',
    'activityName',
    'workSessionName',
    'assigneeNote',
    'className',
    'sessionDateTime'
  ],
  manualRow: [
    'departmentName',
    'activityName',
    'workSessionName',
    'assigneeNote',
    'className',
    'sessionDateTime'
  ],
  importedTimesheet: [
    'departmentName',
    'activityName',
    'workSessionName',
    'assigneeNote',
    'className',
    'sessionDateTime',
    'importedRowContent'
  ]
});

function defaultLayoutForKind(kind) {
  switch (kind) {
    case 'pulledClassSession':
      return [
        { kind: 'field', field: 'departmentName', line: 1 },
        { kind: 'field', field: 'sessionDateTime', line: 2 }
      ];
    case 'pulledActivityAssignee':
      return [
        { kind: 'field', field: 'departmentName', line: 1 },
        { kind: 'field', field: 'sessionDateTime', line: 2 }
      ];
    case 'manualRow':
      return [
        { kind: 'field', field: 'departmentName', line: 1 },
        { kind: 'field', field: 'sessionDateTime', line: 2 }
      ];
    case 'importedTimesheet':
      return [
        { kind: 'field', field: 'departmentName', line: 1 },
        { kind: 'field', field: 'importedRowContent', line: 1 },
        { kind: 'field', field: 'sessionDateTime', line: 2 }
      ];
    default:
      return [{ kind: 'field', field: 'departmentName', line: 1 }];
  }
}

const DEFAULT_POLICY = Object.freeze({
  pulledClassSession: defaultLayoutForKind('pulledClassSession'),
  pulledActivityAssignee: defaultLayoutForKind('pulledActivityAssignee'),
  manualRow: defaultLayoutForKind('manualRow'),
  importedTimesheet: defaultLayoutForKind('importedTimesheet')
});

function cleanText(value) {
  return String(value ?? '').trim();
}

function allowedFieldsForKind(kind) {
  const key = String(kind || '').trim();
  return ALLOWED_FIELDS_BY_KIND[key] || [];
}

function isWorkSessionTimesheetEntry(entry = {}) {
  return entry?.isSchoolActivity === true || String(entry?.sessionId || '').startsWith('act-');
}

function resolveTimesheetRowDisplayKind(entry = {}) {
  if (timesheetLegacyImportService.isLegacyImportEntry(entry)) return 'importedTimesheet';
  if (entry?.isManual === true) return 'manualRow';
  if (isWorkSessionTimesheetEntry(entry)) return 'pulledActivityAssignee';
  return 'pulledClassSession';
}

function resolveTokenDisplayLine(token = {}) {
  if (token?.kind === 'field' && token.field === MANDATORY_DISPLAY_FIELD) return 1;
  const line = Number(token?.line);
  return line === 2 ? 2 : 1;
}

function inferLegacyTokenLine(token = {}) {
  if (token?.line === 1 || token?.line === 2) return resolveTokenDisplayLine(token);
  if (token?.kind === 'field' && token.field === 'sessionDateTime') return 2;
  return 1;
}

function normalizeLayoutToken(raw, kind) {
  if (!raw || typeof raw !== 'object') return null;
  const allowed = new Set(allowedFieldsForKind(kind));
  if (String(raw.kind || '').toLowerCase() === 'separator') {
    const text = String(raw.text ?? '').slice(0, 120);
    return { kind: 'separator', text, line: inferLegacyTokenLine({ ...raw, kind: 'separator' }) };
  }
  const field = String(raw.field || raw.key || '').trim();
  if (String(raw.kind || '').toLowerCase() === 'field' && allowed.has(field)) {
    return {
      kind: 'field',
      field,
      line: inferLegacyTokenLine({ kind: 'field', field, line: raw.line })
    };
  }
  return null;
}

function ensureMandatoryDepartmentName(layout, kind) {
  if (!allowedFieldsForKind(kind).includes(MANDATORY_DISPLAY_FIELD)) {
    return Array.isArray(layout) ? layout : [];
  }
  const normalized = [];
  let hasDepartment = false;
  (Array.isArray(layout) ? layout : []).forEach((token) => {
    if (token?.kind === 'field' && token.field === MANDATORY_DISPLAY_FIELD) {
      if (hasDepartment) return;
      hasDepartment = true;
      normalized.push({ kind: 'field', field: MANDATORY_DISPLAY_FIELD, line: 1 });
      return;
    }
    normalized.push({
      ...token,
      line: resolveTokenDisplayLine(token)
    });
  });
  if (!hasDepartment) {
    normalized.unshift({ kind: 'field', field: MANDATORY_DISPLAY_FIELD, line: 1 });
  }
  return normalized;
}

function normalizeLayout(input, kind, fallback = []) {
  const rows = Array.isArray(input) ? input : [];
  const normalized = rows.map((row) => normalizeLayoutToken(row, kind)).filter(Boolean);
  const base = normalized.length
    ? normalized
    : (Array.isArray(fallback) ? fallback : []).map((row) => normalizeLayoutToken(row, kind)).filter(Boolean);
  const withMandatory = ensureMandatoryDepartmentName(base, kind);
  return withMandatory.length ? withMandatory : ensureMandatoryDepartmentName(defaultLayoutForKind(kind), kind);
}

function normalizePolicyFromStored(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  ROW_KINDS.forEach((kind) => {
    out[kind] = normalizeLayout(src[kind], kind, defaultLayoutForKind(kind));
  });
  return out;
}

function normalizePolicyFromForm(input = {}) {
  return normalizePolicyFromStored(input);
}

function resolvePolicy(input = {}) {
  return normalizePolicyFromStored(input);
}

function validatePolicyInput(input = {}) {
  return normalizePolicyFromForm(input);
}

function buildDepartmentMapFromRows(departments = []) {
  const map = new Map();
  (Array.isArray(departments) ? departments : []).forEach((row) => {
    const id = cleanText(row?.id);
    if (id) map.set(id, row);
  });
  return map;
}

function normalizeDepartmentMapInput(input) {
  if (input instanceof Map) return input;
  if (Array.isArray(input)) return buildDepartmentMapFromRows(input);
  return new Map();
}

function pickFirstOrgDepartment(departments = [], orgId = '') {
  const orgKey = cleanText(orgId);
  return (Array.isArray(departments) ? departments : [])
    .filter((row) => {
      if (!orgKey) return true;
      const rowOrg = cleanText(row?.orgId);
      return !rowOrg || rowOrg === orgKey;
    })
    .filter((row) => row?.active !== false)
    .sort((a, b) => cleanText(a?.name || a?.code || a?.id).localeCompare(cleanText(b?.name || b?.code || b?.id)))[0] || null;
}

function departmentRowsForComposeContext(composeContext = {}) {
  return composeContext.orgDepartments || composeContext.departments || [];
}

function departmentMatchesOrg(row = {}, orgId = '') {
  const orgKey = cleanText(orgId);
  if (!orgKey) return true;
  const rowOrg = cleanText(row?.orgId);
  return !rowOrg || rowOrg === orgKey;
}

function hydrateDepartmentMap(composeContext = {}) {
  const departmentMap = normalizeDepartmentMapInput(composeContext.departmentMap);
  if (!departmentMap.size && Array.isArray(composeContext.orgDepartments)) {
    buildDepartmentMapFromRows(composeContext.orgDepartments).forEach((value, key) => {
      departmentMap.set(key, value);
    });
  }
  return departmentMap;
}

function resolveDepartmentRecordForEntry(entry = {}, composeContext = {}) {
  const departmentMap = hydrateDepartmentMap(composeContext);
  const orgId = composeContext.orgId || entry.orgId;
  const departments = departmentRowsForComposeContext(composeContext);
  const id = cleanText(
    entry.deliveryDepartmentId
    || entry.departmentId
    || entry?.compensationLookup?.departmentId
  );
  if (id && departmentMap.has(id)) {
    return { row: departmentMap.get(id), via: 'id' };
  }
  const entryCode = cleanText(entry.deliveryDepartmentCode || entry.departmentCode);
  if (entryCode) {
    const byCode = departments.find((row) => departmentMatchesOrg(row, orgId)
      && row?.active !== false
      && cleanText(row?.code || row?.departmentCode) === entryCode);
    if (byCode) return { row: byCode, via: 'code' };
  }
  const entryName = cleanText(entry.deliveryDepartmentName || entry.departmentName);
  if (entryName) {
    const byName = departments.find((row) => departmentMatchesOrg(row, orgId)
      && row?.active !== false
      && cleanText(row?.name || row?.title || row?.departmentName) === entryName);
    if (byName) return { row: byName, via: 'name' };
  }
  return { row: pickFirstOrgDepartment(departments, orgId), via: 'firstOrg' };
}

function resolveDepartmentDisplayValue(entry = {}, displayKind = '', composeContext = {}) {
  const { row: dept } = resolveDepartmentRecordForEntry(entry, composeContext);
  const backendName = cleanText(dept?.name || dept?.title || dept?.departmentName);
  const backendCode = cleanText(dept?.code || dept?.departmentCode);
  const entryName = cleanText(entry.deliveryDepartmentName || entry.departmentName);
  const entryCode = cleanText(entry.deliveryDepartmentCode || entry.departmentCode);
  return backendCode || entryCode || backendName || entryName;
}

function resolveFieldValue(fieldKey, entry = {}, displayKind = '', composeContext = {}) {
  switch (fieldKey) {
    case 'departmentName':
      return resolveDepartmentDisplayValue(entry, displayKind, composeContext);
    case 'activityName':
      return cleanText(entry.activityName);
    case 'workSessionName':
      return cleanText(entry.workSessionName);
    case 'assigneeNote':
      return cleanText(entry.assigneeNote);
    case 'className':
      return cleanText(entry.className);
    case 'importedRowContent':
      return cleanText(
        entry.importedRowContent
        || entry.legacyImportClassName
        || entry.description
        || entry.className
      );
    case 'sessionDateTime':
      return resolveSessionStartEndTimeText(entry);
    default:
      return '';
  }
}

function resolveSessionStartEndTimeText(entry = {}) {
  if (entry?.isPriorPeriodAdjustment === true) {
    const referenceDate = cleanText(entry?.adjustmentMeta?.sourceSessionDate || entry?.date);
    return referenceDate ? `Ref: ${referenceDate}` : 'Prior period correction';
  }
  const startTime = cleanText(entry.startTime);
  const endTime = cleanText(entry.endTime);
  if (!startTime) {
    return entry?.isManual === true ? 'Manual time' : '';
  }
  return endTime ? `${startTime} – ${endTime}` : startTime;
}

function composeSegments(layout, entry, displayKind, composeContext = {}) {
  const escape = typeof composeContext.escapeHtmlFn === 'function' ? composeContext.escapeHtmlFn : (v) => v;
  let text = '';
  let html = '';
  layout.forEach((token) => {
    if (token.kind === 'separator') {
      const part = String(token.text ?? '');
      text += part;
      html += escape(part).replace(/\n/g, '<br>');
      return;
    }
    const value = resolveFieldValue(token.field, entry, displayKind, composeContext);
    if (!value) return;
    text += value;
    html += escape(value);
  });
  return { text: text.trim(), html: html.trim() };
}

function layoutForDisplayLine(layout = [], lineNumber = 1) {
  const targetLine = lineNumber === 2 ? 2 : 1;
  return (Array.isArray(layout) ? layout : []).filter(
    (token) => resolveTokenDisplayLine(token) === targetLine
  );
}

function composeTimesheetRowDisplay(entry = {}, policy = DEFAULT_POLICY, options = {}) {
  const resolvedPolicy = resolvePolicy(policy);
  const displayKind = resolveTimesheetRowDisplayKind(entry);
  const layout = resolvedPolicy[displayKind] || defaultLayoutForKind(displayKind);
  const line1Layout = layoutForDisplayLine(layout, 1);
  const line2Layout = layoutForDisplayLine(layout, 2);
  const primary = composeSegments(line1Layout, entry, displayKind, options);
  const secondary = composeSegments(line2Layout, entry, displayKind, options);
  let primaryText = primary.text;
  let primaryHtml = primary.html;
  if (!primaryText) {
    const fallback = resolveDepartmentDisplayValue(entry, displayKind, options)
      || resolveFieldValue('className', entry, displayKind, options)
      || resolveFieldValue('importedRowContent', entry, displayKind, options)
      || cleanText(entry.description || entry.classId || 'Activity');
    primaryText = fallback;
    const escape = typeof options.escapeHtmlFn === 'function' ? options.escapeHtmlFn : (v) => v;
    primaryHtml = escape(fallback);
  }

  const timeRowText = secondary.text;
  const timeRowHtml = secondary.html;

  return {
    displayKind,
    primaryText,
    primaryHtml,
    timeRowText,
    timeRowHtml,
    showTimeRow: Boolean(timeRowText)
  };
}

function enrichEntryDisplayMetadata(entry = {}, context = {}) {
  if (!entry || typeof entry !== 'object') return entry;
  const next = { ...entry };
  if (!cleanText(next.activityName) && context.activityTitle) {
    next.activityName = cleanText(context.activityTitle);
  }
  if (!cleanText(next.workSessionName) && context.workSessionTitle) {
    next.workSessionName = cleanText(context.workSessionTitle);
  }
  if (!cleanText(next.assigneeNote) && context.assigneeNote !== undefined) {
    next.assigneeNote = cleanText(context.assigneeNote);
  }
  if (!cleanText(next.importedRowContent)) {
    next.importedRowContent = cleanText(
      next.legacyImportClassName || next.description || next.className
    );
  }
  return next;
}

module.exports = {
  ROW_KINDS,
  MANDATORY_DISPLAY_FIELD,
  DISPLAY_FIELD_KEYS,
  DISPLAY_FIELD_CATALOG,
  ALLOWED_FIELDS_BY_KIND,
  DEFAULT_POLICY,
  allowedFieldsForKind,
  resolveTimesheetRowDisplayKind,
  resolveTokenDisplayLine,
  normalizePolicyFromStored,
  normalizePolicyFromForm,
  resolvePolicy,
  validatePolicyInput,
  composeTimesheetRowDisplay,
  resolveFieldValue,
  resolveDepartmentDisplayValue,
  buildDepartmentMapFromRows,
  pickFirstOrgDepartment,
  resolveSessionStartEndTimeText,
  enrichEntryDisplayMetadata,
  isWorkSessionTimesheetEntry
};
