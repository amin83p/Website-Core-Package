(function (global) {
  'use strict';

  const ROW_KINDS = [
    'pulledClassSession',
    'pulledActivityAssignee',
    'manualRow',
    'importedTimesheet'
  ];

  const ROW_KIND_LABELS = {
    pulledClassSession: 'Pulled Class Session',
    pulledActivityAssignee: 'Pulled Activity Work Session — Assignee',
    manualRow: 'Added Manual Row By Users',
    importedTimesheet: 'Imported Timesheet'
  };

  const MANDATORY_DISPLAY_FIELD = 'departmentName';

  const DISPLAY_FIELD_CATALOG = {
    departmentName: 'Department Name',
    activityName: 'Activity Name',
    workSessionName: 'Work Session Name',
    assigneeNote: 'Assignee Note In the Work Session',
    className: 'Class Name',
    sessionDateTime: 'Session Start/End Time',
    importedRowContent: 'Imported Timesheet Row Content'
  };

  const ALLOWED_FIELDS_BY_KIND = {
    pulledClassSession: ['departmentName', 'className', 'sessionDateTime'],
    pulledActivityAssignee: ['departmentName', 'activityName', 'workSessionName', 'assigneeNote', 'className', 'sessionDateTime'],
    manualRow: ['departmentName', 'activityName', 'workSessionName', 'assigneeNote', 'className', 'sessionDateTime'],
    importedTimesheet: ['departmentName', 'activityName', 'workSessionName', 'assigneeNote', 'className', 'sessionDateTime', 'importedRowContent']
  };

  const DEFAULT_POLICY = {
    pulledClassSession: [{ kind: 'field', field: 'departmentName', line: 1 }, { kind: 'field', field: 'sessionDateTime', line: 2 }],
    pulledActivityAssignee: [{ kind: 'field', field: 'departmentName', line: 1 }, { kind: 'field', field: 'sessionDateTime', line: 2 }],
    manualRow: [{ kind: 'field', field: 'departmentName', line: 1 }, { kind: 'field', field: 'sessionDateTime', line: 2 }],
    importedTimesheet: [
      { kind: 'field', field: 'departmentName', line: 1 },
      { kind: 'field', field: 'importedRowContent', line: 1 },
      { kind: 'field', field: 'sessionDateTime', line: 2 }
    ]
  };

  function cleanText(value) {
    return String(value ?? '').trim();
  }

  function isLegacyImportEntry(entry) {
    return entry?.isLegacyImport === true || String(entry?.sessionId || '').startsWith('legacyimp-');
  }

  function isWorkSessionTimesheetEntry(entry) {
    return entry?.isSchoolActivity === true || String(entry?.sessionId || '').startsWith('act-');
  }

  function resolveTimesheetRowDisplayKind(entry) {
    if (isLegacyImportEntry(entry)) return 'importedTimesheet';
    if (entry?.isManual === true) return 'manualRow';
    if (isWorkSessionTimesheetEntry(entry)) return 'pulledActivityAssignee';
    return 'pulledClassSession';
  }

  function resolveTokenDisplayLine(token) {
    if (token?.kind === 'field' && token.field === MANDATORY_DISPLAY_FIELD) return 1;
    const line = Number(token?.line);
    return line === 2 ? 2 : 1;
  }

  function inferLegacyTokenLine(token) {
    if (token?.line === 1 || token?.line === 2) return resolveTokenDisplayLine(token);
    if (token?.kind === 'field' && token.field === 'sessionDateTime') return 2;
    return 1;
  }

  function ensureMandatoryDepartmentName(layout, kind) {
    if (!(ALLOWED_FIELDS_BY_KIND[kind] || []).includes(MANDATORY_DISPLAY_FIELD)) {
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
      normalized.push({ ...token, line: resolveTokenDisplayLine(token) });
    });
    if (!hasDepartment) {
      normalized.unshift({ kind: 'field', field: MANDATORY_DISPLAY_FIELD, line: 1 });
    }
    return normalized;
  }

  function buildDepartmentMapFromRows(departments) {
    const map = new Map();
    (Array.isArray(departments) ? departments : []).forEach((row) => {
      const id = cleanText(row?.id);
      if (id) map.set(id, row);
    });
    return map;
  }

  function pickFirstOrgDepartment(departments, orgId) {
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

  function departmentRowsForComposeContext(composeContext) {
    return composeContext.orgDepartments || composeContext.departments || [];
  }

  function departmentMatchesOrg(row, orgId) {
    const orgKey = cleanText(orgId);
    if (!orgKey) return true;
    const rowOrg = cleanText(row?.orgId);
    return !rowOrg || rowOrg === orgKey;
  }

  function hydrateDepartmentMap(composeContext) {
    composeContext = composeContext || {};
    let departmentMap = composeContext.departmentMap;
    if (!(departmentMap instanceof Map)) {
      departmentMap = buildDepartmentMapFromRows(composeContext.orgDepartments || composeContext.departments || []);
    }
    return departmentMap;
  }

  function resolveDepartmentRecordForEntry(entry, composeContext) {
    composeContext = composeContext || {};
    const departmentMap = hydrateDepartmentMap(composeContext);
    const orgId = composeContext.orgId || entry?.orgId;
    const departments = departmentRowsForComposeContext(composeContext);
    const id = cleanText(entry?.deliveryDepartmentId || entry?.departmentId || entry?.compensationLookup?.departmentId);
    if (id && departmentMap.has(id)) {
      return { row: departmentMap.get(id), via: 'id' };
    }
    const entryCode = cleanText(entry?.deliveryDepartmentCode || entry?.departmentCode);
    if (entryCode) {
      const byCode = departments.find((row) => departmentMatchesOrg(row, orgId)
        && row?.active !== false
        && cleanText(row?.code || row?.departmentCode) === entryCode);
      if (byCode) return { row: byCode, via: 'code' };
    }
    const entryName = cleanText(entry?.deliveryDepartmentName || entry?.departmentName);
    if (entryName) {
      const byName = departments.find((row) => departmentMatchesOrg(row, orgId)
        && row?.active !== false
        && cleanText(row?.name || row?.title || row?.departmentName) === entryName);
      if (byName) return { row: byName, via: 'name' };
    }
    return {
      row: pickFirstOrgDepartment(departments, orgId),
      via: 'firstOrg'
    };
  }

  function resolveDepartmentDisplayValue(entry, displayKind, composeContext) {
    composeContext = composeContext || {};
    const { row: dept } = resolveDepartmentRecordForEntry(entry, composeContext);
    const backendName = cleanText(dept?.name || dept?.title || dept?.departmentName);
    const backendCode = cleanText(dept?.code || dept?.departmentCode);
    const entryName = cleanText(entry?.deliveryDepartmentName || entry?.departmentName);
    const entryCode = cleanText(entry?.deliveryDepartmentCode || entry?.departmentCode);
    return backendCode || entryCode || backendName || entryName;
  }

  function resolveFieldValue(fieldKey, entry, displayKind, composeContext) {
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
        return cleanText(entry.importedRowContent || entry.legacyImportClassName || entry.description || entry.className);
      case 'sessionDateTime':
        return resolveSessionStartEndTimeText(entry);
      default:
        return '';
    }
  }

  function resolveSessionStartEndTimeText(entry) {
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

  function composeSegments(layout, entry, displayKind, composeContext) {
    composeContext = composeContext || {};
    const escape = typeof composeContext.escapeHtmlFn === 'function' ? composeContext.escapeHtmlFn : (v) => v;
    let text = '';
    let html = '';
    (Array.isArray(layout) ? layout : []).forEach((token) => {
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

  function layoutForDisplayLine(layout, lineNumber) {
    const targetLine = lineNumber === 2 ? 2 : 1;
    return (Array.isArray(layout) ? layout : []).filter(
      (token) => resolveTokenDisplayLine(token) === targetLine
    );
  }

  function resolvePolicy(policy) {
    const src = policy && typeof policy === 'object' ? policy : {};
    const out = {};
    ROW_KINDS.forEach((kind) => {
      const allowed = new Set(ALLOWED_FIELDS_BY_KIND[kind] || []);
      const rows = Array.isArray(src[kind]) ? src[kind] : DEFAULT_POLICY[kind];
      const normalized = rows.map((row) => {
        if (!row || typeof row !== 'object') return null;
        if (row.kind === 'separator') {
          return {
            kind: 'separator',
            text: String(row.text ?? '').slice(0, 120),
            line: inferLegacyTokenLine({ ...row, kind: 'separator' })
          };
        }
        if (row.kind === 'field' && allowed.has(row.field)) {
          return {
            kind: 'field',
            field: row.field,
            line: inferLegacyTokenLine(row)
          };
        }
        return null;
      }).filter(Boolean);
      const base = normalized.length ? normalized : [...DEFAULT_POLICY[kind]];
      out[kind] = ensureMandatoryDepartmentName(base, kind);
    });
    return out;
  }

  function composeTimesheetRowDisplay(entry, policy, options) {
    options = options || {};
    const resolvedPolicy = resolvePolicy(policy);
    const displayKind = resolveTimesheetRowDisplayKind(entry);
    const layout = resolvedPolicy[displayKind] || DEFAULT_POLICY[displayKind];
    const composeContext = {
      escapeHtmlFn: options.escapeHtmlFn,
      departmentMap: options.departmentMap,
      orgDepartments: options.orgDepartments || options.departments,
      orgId: options.orgId || entry?.orgId
    };
    const primary = composeSegments(layoutForDisplayLine(layout, 1), entry, displayKind, composeContext);
    const secondary = composeSegments(layoutForDisplayLine(layout, 2), entry, displayKind, composeContext);
    let primaryText = primary.text;
    let primaryHtml = primary.html;
    if (!primaryText) {
      const fallback = resolveDepartmentDisplayValue(entry, displayKind, composeContext)
        || resolveFieldValue('className', entry, displayKind, composeContext)
        || resolveFieldValue('importedRowContent', entry, displayKind, composeContext)
        || cleanText(entry.description || entry.classId || 'Activity');
      primaryText = fallback;
      const escape = typeof options.escapeHtmlFn === 'function' ? options.escapeHtmlFn : (v) => v;
      primaryHtml = escape(fallback);
    }
    return {
      displayKind,
      primaryText,
      primaryHtml,
      timeRowText: secondary.text,
      timeRowHtml: secondary.html,
      showTimeRow: Boolean(secondary.text)
    };
  }

  global.TimesheetDisplayComposer = {
    ROW_KINDS,
    ROW_KIND_LABELS,
    MANDATORY_DISPLAY_FIELD,
    DISPLAY_FIELD_CATALOG,
    ALLOWED_FIELDS_BY_KIND,
    DEFAULT_POLICY,
    resolvePolicy,
    resolveTimesheetRowDisplayKind,
    resolveTokenDisplayLine,
    composeTimesheetRowDisplay
  };
})(typeof window !== 'undefined' ? window : globalThis);
