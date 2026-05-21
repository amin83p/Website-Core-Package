const MODE_OPTIONS = Object.freeze([
  { value: 'global', label: 'Global', description: 'All records across all organizations and sections supported by the access grant.' },
  { value: 'admin', label: 'Admin', description: 'All records inside the resolved administrative boundary.' },
  { value: 'organization', label: 'Organization', description: 'All records inside the resolved organization boundary.' },
  { value: 'department', label: 'Department', description: 'Records inside the resolved department boundary.' },
  { value: 'division', label: 'Division', description: 'Records inside the resolved division boundary.' },
  { value: 'owner', label: 'Owner', description: 'Only records owned or created by the acting user.' },
  { value: 'user', label: 'User', description: 'Only records that belong to the acting user as the subject.' }
]);

const BINDING_OPTIONS = Object.freeze({
  orgSource: [
    { value: 'none', label: 'None' },
    { value: 'activeOrgId', label: 'Active Organization' },
    { value: 'allowedOrgIds', label: 'All Allowed Organizations' }
  ],
  departmentSource: [
    { value: 'none', label: 'None' },
    { value: 'userDepartments', label: 'User Departments' },
    { value: 'activeOrg', label: 'All Departments In Active Organization' }
  ],
  divisionSource: [
    { value: 'none', label: 'None' },
    { value: 'userDivisions', label: 'User Divisions' },
    { value: 'activeOrg', label: 'All Divisions In Active Organization' }
  ],
  ownerSource: [
    { value: 'none', label: 'None' },
    { value: 'userId', label: 'User ID' },
    { value: 'personId', label: 'Person ID' }
  ],
  userSource: [
    { value: 'none', label: 'None' },
    { value: 'userId', label: 'User ID' },
    { value: 'personId', label: 'Person ID' }
  ],
  personSource: [
    { value: 'none', label: 'None' },
    { value: 'personId', label: 'Person ID' },
    { value: 'userId', label: 'User ID' }
  ]
});

const DEFAULT_TARGET_FIELDS = Object.freeze({
  orgField: 'orgId',
  departmentField: 'departmentId',
  divisionField: 'divisionId',
  ownerField: 'createdByUserId',
  userField: 'userId',
  personField: 'personId'
});

function getBindingValues(key) {
  return new Set((BINDING_OPTIONS[key] || []).map((item) => item.value));
}

function labelFor(list, value) {
  const item = (list || []).find((entry) => entry.value === value);
  return item ? item.label : String(value || '');
}

function inferLegacyMode(scopeName = '') {
  const normalized = String(scopeName || '').trim().toUpperCase();
  if (normalized === 'GLOBAL') return 'global';
  if (normalized === 'ADMIN') return 'admin';
  if (normalized === 'ORGANIZATION' || normalized === 'ORG') return 'organization';
  if (normalized === 'DEPARTMENT' || normalized === 'DEPT') return 'department';
  if (normalized === 'DIVISION' || normalized === 'DIV') return 'division';
  if (normalized === 'OWNER') return 'owner';
  if (normalized === 'USER') return 'user';
  return 'organization';
}

function createDefaultScopeDefinition(scopeName = '') {
  const mode = inferLegacyMode(scopeName);
  const base = {
    mode,
    bindings: {
      orgSource: 'none',
      departmentSource: 'none',
      divisionSource: 'none',
      ownerSource: 'none',
      userSource: 'none',
      personSource: 'none'
    },
    targetFields: {
      ...DEFAULT_TARGET_FIELDS
    },
    options: {
      includeGlobal: false,
      treatDepartmentAsOrganization: false,
      treatDivisionAsOrganization: false
    }
  };

  if (mode === 'global') {
    base.options.includeGlobal = true;
  } else if (mode === 'admin' || mode === 'organization') {
    base.bindings.orgSource = 'activeOrgId';
  } else if (mode === 'department') {
    base.bindings.orgSource = 'activeOrgId';
    base.bindings.departmentSource = 'userDepartments';
    base.options.treatDepartmentAsOrganization = true;
  } else if (mode === 'division') {
    base.bindings.orgSource = 'activeOrgId';
    base.bindings.divisionSource = 'userDivisions';
    base.options.treatDivisionAsOrganization = true;
  } else if (mode === 'owner') {
    base.bindings.orgSource = 'activeOrgId';
    base.bindings.ownerSource = 'userId';
  } else if (mode === 'user') {
    base.bindings.orgSource = 'activeOrgId';
    base.bindings.userSource = 'userId';
    base.bindings.personSource = 'personId';
  }

  return base;
}

function sanitizeFieldName(value, fallback = '') {
  const trimmed = String(value || '').trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/[^A-Za-z0-9_.]/g, '');
}

function normalizeBindingValue(key, value, fallback) {
  const allowed = getBindingValues(key);
  return allowed.has(value) ? value : fallback;
}

function normalizeScopeDefinition(input, scopeName = '') {
  const fallback = createDefaultScopeDefinition(scopeName);
  const source = input && typeof input === 'object' ? input : {};
  const allowedModes = new Set(MODE_OPTIONS.map((item) => item.value));

  const mode = allowedModes.has(source.mode) ? source.mode : fallback.mode;
  const bindingsSource = source.bindings && typeof source.bindings === 'object' ? source.bindings : {};
  const targetFieldsSource = source.targetFields && typeof source.targetFields === 'object' ? source.targetFields : {};
  const optionsSource = source.options && typeof source.options === 'object' ? source.options : {};

  const normalized = {
    mode,
    bindings: {
      orgSource: normalizeBindingValue('orgSource', bindingsSource.orgSource, fallback.bindings.orgSource),
      departmentSource: normalizeBindingValue('departmentSource', bindingsSource.departmentSource, fallback.bindings.departmentSource),
      divisionSource: normalizeBindingValue('divisionSource', bindingsSource.divisionSource, fallback.bindings.divisionSource),
      ownerSource: normalizeBindingValue('ownerSource', bindingsSource.ownerSource, fallback.bindings.ownerSource),
      userSource: normalizeBindingValue('userSource', bindingsSource.userSource, fallback.bindings.userSource),
      personSource: normalizeBindingValue('personSource', bindingsSource.personSource, fallback.bindings.personSource)
    },
    targetFields: {
      orgField: sanitizeFieldName(targetFieldsSource.orgField, fallback.targetFields.orgField),
      departmentField: sanitizeFieldName(targetFieldsSource.departmentField, fallback.targetFields.departmentField),
      divisionField: sanitizeFieldName(targetFieldsSource.divisionField, fallback.targetFields.divisionField),
      ownerField: sanitizeFieldName(targetFieldsSource.ownerField, fallback.targetFields.ownerField),
      userField: sanitizeFieldName(targetFieldsSource.userField, fallback.targetFields.userField),
      personField: sanitizeFieldName(targetFieldsSource.personField, fallback.targetFields.personField)
    },
    options: {
      includeGlobal: optionsSource.includeGlobal === true || fallback.options.includeGlobal === true,
      treatDepartmentAsOrganization: optionsSource.treatDepartmentAsOrganization === true || fallback.options.treatDepartmentAsOrganization === true,
      treatDivisionAsOrganization: optionsSource.treatDivisionAsOrganization === true || fallback.options.treatDivisionAsOrganization === true
    }
  };

  return normalized;
}

function summarizeScopeDefinition(definition) {
  const normalized = normalizeScopeDefinition(definition);
  const parts = [];

  parts.push(labelFor(MODE_OPTIONS, normalized.mode));

  if (normalized.bindings.orgSource !== 'none') {
    parts.push(`Org: ${labelFor(BINDING_OPTIONS.orgSource, normalized.bindings.orgSource)}`);
  }
  if (normalized.bindings.departmentSource !== 'none') {
    parts.push(`Dept: ${labelFor(BINDING_OPTIONS.departmentSource, normalized.bindings.departmentSource)}`);
  }
  if (normalized.bindings.divisionSource !== 'none') {
    parts.push(`Division: ${labelFor(BINDING_OPTIONS.divisionSource, normalized.bindings.divisionSource)}`);
  }
  if (normalized.bindings.ownerSource !== 'none') {
    parts.push(`Owner: ${labelFor(BINDING_OPTIONS.ownerSource, normalized.bindings.ownerSource)}`);
  }
  if (normalized.bindings.userSource !== 'none') {
    parts.push(`User: ${labelFor(BINDING_OPTIONS.userSource, normalized.bindings.userSource)}`);
  }
  if (normalized.bindings.personSource !== 'none') {
    parts.push(`Person: ${labelFor(BINDING_OPTIONS.personSource, normalized.bindings.personSource)}`);
  }
  if (normalized.options.includeGlobal) {
    parts.push('Includes Global');
  }
  if (normalized.options.treatDepartmentAsOrganization) {
    parts.push('Dept=>Org');
  }
  if (normalized.options.treatDivisionAsOrganization) {
    parts.push('Division=>Org');
  }

  return parts.join(' | ');
}

function getScopeDefinitionOptions() {
  return {
    modes: MODE_OPTIONS,
    bindings: BINDING_OPTIONS,
    defaultTargetFields: DEFAULT_TARGET_FIELDS
  };
}

module.exports = {
  MODE_OPTIONS,
  BINDING_OPTIONS,
  DEFAULT_TARGET_FIELDS,
  inferLegacyMode,
  createDefaultScopeDefinition,
  normalizeScopeDefinition,
  summarizeScopeDefinition,
  getScopeDefinitionOptions
};
