const { normalizePrefillKey, stableValueToken, getPrefillValue } = require('./reportPrefillKeyUtils');

/** @typedef {{ keys: string[], primary: string }} PrefillMirrorGroup */

const EACH_STUDENT_ATTENDANCE_PERCENT_MIRRORS = Object.freeze([
  'student_attendance_span_percent',
  'class_attendance_present'
]);

function normalizeScope(reportScope = '') {
  const scope = String(reportScope || '').trim().toLowerCase();
  if (scope === 'each_student' || scope === 'student' || scope === 'per_student') {
    return 'each_student';
  }
  if (scope === 'class' || scope === 'class_wide') {
    return 'class';
  }
  return scope;
}

function isEachStudentScope(reportScope = '') {
  return normalizeScope(reportScope) === 'each_student';
}

/**
 * Scope-aware mirror groups: on each-student reports several legacy catalog keys
 * receive the same live value (see buildPrefillSnapshot primaryAttendance).
 */
function listMirrorGroupsForScope(reportScope = '') {
  if (!isEachStudentScope(reportScope)) return [];
  return [EACH_STUDENT_ATTENDANCE_PERCENT_MIRRORS];
}

function findMirrorGroup(reportScope, rawKey = '') {
  const key = normalizePrefillKey(rawKey);
  if (!key || !isEachStudentScope(reportScope)) return null;
  const lower = key.toLowerCase();
  for (const group of listMirrorGroupsForScope(reportScope)) {
    if (group.some((member) => member.toLowerCase() === lower)) {
      return group;
    }
  }
  return null;
}

/**
 * Ordered mirror keys with primary first (student_attendance_span_percent for attendance).
 */
function resolveMirrorGroup(reportScope, rawKey = '') {
  const group = findMirrorGroup(reportScope, rawKey);
  if (!group) {
    const single = normalizePrefillKey(rawKey);
    return single ? [single] : [];
  }
  const lowerMembers = new Set(group.map((k) => k.toLowerCase()));
  const primary = group.find((k) => k === 'student_attendance_span_percent')
    || group.find((k) => lowerMembers.has(normalizePrefillKey(k).toLowerCase()))
    || group[0];
  const rest = group.filter((k) => k.toLowerCase() !== primary.toLowerCase());
  return [primary, ...rest];
}

function pickPrimaryMirrorKey(reportScope, rawKey = '') {
  const resolved = resolveMirrorGroup(reportScope, rawKey);
  return resolved[0] || normalizePrefillKey(rawKey);
}

/**
 * Expand user-selected prefill keys to all mirrors in the same group (each-student only).
 */
function expandKeysForApply(reportScope, selectedKeys = []) {
  const out = new Set();
  const list = Array.isArray(selectedKeys) ? selectedKeys : [selectedKeys];
  list.forEach((raw) => {
    const key = normalizePrefillKey(raw);
    if (!key) return;
    const group = resolveMirrorGroup(reportScope, key);
    if (group.length) {
      group.forEach((member) => out.add(member));
    } else {
      out.add(key);
    }
  });
  return [...out];
}

function mirrorKeysForChange(reportScope, primaryKey, refreshedPrefill = {}) {
  const group = resolveMirrorGroup(reportScope, primaryKey);
  if (group.length <= 1) return [];
  const primary = normalizePrefillKey(primaryKey);
  const resolved = getPrefillValue(refreshedPrefill, primary);
  const proposedToken = stableValueToken(resolved.found ? resolved.value : undefined);
  return group
    .filter((k) => k.toLowerCase() !== primary.toLowerCase())
    .filter((k) => {
      const alt = getPrefillValue(refreshedPrefill, k);
      if (!alt.found) return true;
      return stableValueToken(alt.value) === proposedToken;
    });
}

function collapseMirrorPrefillChanges(changes = [], { reportScope = '', template = null } = {}) {
  const list = Array.isArray(changes) ? [...changes] : [];
  if (!isEachStudentScope(reportScope) || list.length < 2) return list;

  const used = new Set();
  const out = [];

  list.forEach((change, index) => {
    if (used.has(index)) return;
    const key = normalizePrefillKey(change?.prefillKey || '');
    const group = findMirrorGroup(reportScope, key);
    if (!group || group.length < 2) {
      out.push(change);
      return;
    }

    const siblings = [];
    const fieldIds = new Set(
      (change.fields || [])
        .map((f) => String(f?.fieldId || '').trim())
        .filter(Boolean)
    );
    const proposedToken = stableValueToken(change?.newRawValue);

    list.forEach((other, otherIndex) => {
      if (otherIndex === index || used.has(otherIndex)) return;
      const otherKey = normalizePrefillKey(other?.prefillKey || '');
      if (!group.some((g) => g.toLowerCase() === otherKey.toLowerCase())) return;
      if (stableValueToken(other?.newRawValue) !== proposedToken) return;
      const otherFieldIds = (other.fields || [])
        .map((f) => String(f?.fieldId || '').trim())
        .filter(Boolean);
      let sharesField = fieldIds.size === 0 && otherFieldIds.length === 0;
      if (!sharesField) {
        sharesField = otherFieldIds.some((id) => fieldIds.has(id));
      }
      if (!sharesField && fieldIds.size && otherFieldIds.length) return;
      siblings.push({ other, otherIndex, otherKey });
    });

    if (!siblings.length) {
      out.push(change);
      return;
    }

    const candidates = [{ change, index, key }];
    siblings.forEach((row) => candidates.push({
      change: row.other,
      index: row.otherIndex,
      key: row.otherKey
    }));

  const preferPrimary = (row) => {
      const fieldPrefill = normalizePrefillKey(
        row.change.fields?.[0]?.fieldId
          ? template?.schema?.fields?.find((f) => String(f.id) === row.change.fields[0].fieldId)?.prefillKey
          : ''
      );
      const rowKey = normalizePrefillKey(row.key);
      if (fieldPrefill && fieldPrefill.toLowerCase() === rowKey.toLowerCase()) return 0;
      if (rowKey === 'student_attendance_span_percent') return 1;
      if ((row.change.fields || []).some((f) => f?.fieldId)) return 2;
      return 3;
    };
    candidates.sort((a, b) => preferPrimary(a) - preferPrimary(b));

    const winner = candidates[0];
    const mirrorKeys = candidates
      .slice(1)
      .map((c) => normalizePrefillKey(c.key))
      .filter(Boolean);

    candidates.forEach((c) => used.add(c.index));

    if (!mirrorKeys.length) {
      out.push(winner.change);
      return;
    }

    out.push({
      ...winner.change,
      mirrorKeys,
      prefillKey: pickPrimaryMirrorKey(reportScope, winner.key)
    });
  });

  return out;
}

function isSnapshotKeyCoveredByPrimary(changesByKey, reportScope, normalizedKey) {
  const primary = pickPrimaryMirrorKey(reportScope, normalizedKey);
  if (changesByKey.has(primary)) return true;
  const group = findMirrorGroup(reportScope, normalizedKey);
  if (!group) return false;
  return group.some((member) => changesByKey.has(member));
}

module.exports = {
  EACH_STUDENT_ATTENDANCE_PERCENT_MIRRORS,
  normalizeScope,
  isEachStudentScope,
  listMirrorGroupsForScope,
  findMirrorGroup,
  resolveMirrorGroup,
  pickPrimaryMirrorKey,
  expandKeysForApply,
  mirrorKeysForChange,
  collapseMirrorPrefillChanges,
  isSnapshotKeyCoveredByPrimary
};