(function initSchoolRoleDisplayUtils(global) {
  'use strict';

  const SCHOOL_SUFFIX_TO_TOKEN = Object.freeze({
    student: 'school_student',
    teacher: 'school_teacher',
    staff: 'school_staff'
  });
  const SCHOOL_TOKEN_SET = new Set(Object.values(SCHOOL_SUFFIX_TO_TOKEN));

  function canonicalizeRoleAtom(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/-/g, '_')
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function isSchoolSuffixToken(value) {
    return Object.prototype.hasOwnProperty.call(SCHOOL_SUFFIX_TO_TOKEN, value);
  }

  function isSchoolPackageRoleToken(value) {
    return SCHOOL_TOKEN_SET.has(canonicalizeRoleAtom(value));
  }

  function splitRoleInputValues(values) {
    if (values === null || values === undefined) return [];
    const normalizedValues = Array.isArray(values) ? values : [values];
    const segments = [];
    for (const value of normalizedValues) {
      if (value === null || value === undefined) continue;
      String(value)
        .replace(/[;,|]/g, ' ')
        .split(/\s+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => segments.push(entry));
    }
    return segments;
  }

  function parseRoleSegment(value) {
    const parsed = [];
    const normalized = canonicalizeRoleAtom(value);
    if (!normalized) return parsed;

    const memberConcatMatch = normalized.match(/^member(?:_)?(school_(student|teacher|staff))$/);
    if (memberConcatMatch) return ['member', memberConcatMatch[1]];

    const memberConcatCompactMatch = normalized.match(/^member(?:_)?(student|teacher|staff)$/);
    if (memberConcatCompactMatch) return ['member', `school_${memberConcatCompactMatch[1]}`];

    if (SCHOOL_TOKEN_SET.has(normalized)) return [normalized];
    if (isSchoolSuffixToken(normalized)) return [SCHOOL_SUFFIX_TO_TOKEN[normalized]];

    const schoolRoleMatch = normalized.match(/^school_(student|teacher|staff)$/);
    if (schoolRoleMatch) return [normalized];

    return [normalized];
  }

  function normalizeOrgRoleTokens(orgMembership) {
    const values = [];
    if (Array.isArray(orgMembership?.roles)) values.push(...orgMembership.roles);
    if (Object.prototype.hasOwnProperty.call(orgMembership || {}, 'role')) {
      values.push(orgMembership.role);
    }

    const segments = splitRoleInputValues(values);
    const tokens = [];
    const seen = new Set();
    let idx = 0;

    while (idx < segments.length) {
      const current = canonicalizeRoleAtom(segments[idx]);
      const next = canonicalizeRoleAtom(segments[idx + 1]);
      const nextNext = canonicalizeRoleAtom(segments[idx + 2]);
      if (!current) {
        idx += 1;
        continue;
      }

      if (current === 'member' && next === 'school' && isSchoolSuffixToken(nextNext)) {
        const normalized = SCHOOL_SUFFIX_TO_TOKEN[nextNext];
        ['member', normalized].forEach((token) => {
          if (!seen.has(token)) {
            seen.add(token);
            tokens.push(token);
          }
        });
        idx += 3;
        continue;
      }

      if (current === 'member' && String(next || '').startsWith('school_') && SCHOOL_TOKEN_SET.has(next)) {
        ['member', next].forEach((token) => {
          if (!seen.has(token)) {
            seen.add(token);
            tokens.push(token);
          }
        });
        idx += 2;
        continue;
      }

      if (current === 'school' && isSchoolSuffixToken(next)) {
        const normalized = SCHOOL_SUFFIX_TO_TOKEN[next];
        if (!seen.has(normalized)) {
          seen.add(normalized);
          tokens.push(normalized);
        }
        idx += 2;
        continue;
      }

      parseRoleSegment(segments[idx]).forEach((token) => {
        if (!seen.has(token)) {
          seen.add(token);
          tokens.push(token);
        }
      });
      idx += 1;
    }

    return tokens;
  }

  function filterSchoolPackageOrgRoles(orgMembership) {
    return normalizeOrgRoleTokens(orgMembership).filter(isSchoolPackageRoleToken);
  }

  global.SchoolRoleDisplay = {
    SCHOOL_TOKEN_SET,
    isSchoolPackageRoleToken,
    normalizeOrgRoleTokens,
    filterSchoolPackageOrgRoles
  };
}(window));
