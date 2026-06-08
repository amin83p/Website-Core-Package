const SCHOOL_SUFFIX_TO_TOKEN = Object.freeze({
    student: 'school_student',
    teacher: 'school_teacher',
    staff: 'school_staff'
});
const SCHOOL_TOKEN_SET = new Set(Object.values(SCHOOL_SUFFIX_TO_TOKEN));

function canonicalizeRoleAtom(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/-/g, '_')
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    return normalized;
}

function isSchoolSuffixToken(value) {
    return Object.prototype.hasOwnProperty.call(SCHOOL_SUFFIX_TO_TOKEN, value);
}

function isSchoolToken(value) {
    return SCHOOL_TOKEN_SET.has(value);
}

function dedupePreserveOrder(values) {
    const seen = new Set();
    const output = [];

    for (const item of values) {
        const token = String(item || '').trim().toLowerCase();
        if (!token || seen.has(token)) continue;
        seen.add(token);
        output.push(token);
    }

    return output;
}

function splitRoleInputValues(values = []) {
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
    let changed = false;
    let mappedCount = 0;
    const normalized = canonicalizeRoleAtom(value);
    if (!normalized) return { tokens: parsed, changed, mappedCount };

    const memberConcatMatch = normalized.match(/^member(?:_)?(school_(student|teacher|staff))$/);
    if (memberConcatMatch) {
        parsed.push('member', memberConcatMatch[1]);
        return { tokens: parsed, changed: true, mappedCount: 1 };
    }

    const memberConcatCompactMatch = normalized.match(/^member(?:_)?(student|teacher|staff)$/);
    if (memberConcatCompactMatch) {
        parsed.push('member', `school_${memberConcatCompactMatch[1]}`);
        return { tokens: parsed, changed: true, mappedCount: 1 };
    }

    if (isSchoolToken(normalized)) {
        parsed.push(normalized);
        return { tokens: parsed, changed: false, mappedCount: 0 };
    }

    if (isSchoolSuffixToken(normalized)) {
        const mapped = SCHOOL_SUFFIX_TO_TOKEN[normalized];
        parsed.push(mapped);
        return { tokens: parsed, changed: true, mappedCount: 1 };
    }

    // Handle legacy "school <role>" tokenization (e.g. "school teacher").
    const schoolRoleMatch = normalized.match(/^school_(student|teacher|staff)$/);
    if (schoolRoleMatch) {
        parsed.push(normalized);
        return { tokens: parsed, changed: false, mappedCount: 0 };
    }

    parsed.push(normalized);
    return { tokens: parsed, changed: false, mappedCount: 0 };
}

function normalizeRoleTokenValues(values = []) {
    const segments = splitRoleInputValues(values);
    const tokens = [];
    let changed = false;
    let mappedCount = 0;
    const seen = new Set();

    let idx = 0;
    while (idx < segments.length) {
        const raw = String(segments[idx] || '').trim();
        const normalizedRaw = canonicalizeRoleAtom(raw);
        const current = normalizedRaw;
        const next = canonicalizeRoleAtom(segments[idx + 1]);
        const nextNext = canonicalizeRoleAtom(segments[idx + 2]);

        if (!current) {
            idx += 1;
            continue;
        }

        // Handle member + school + suffix (e.g. "member school teacher").
        if (current === 'member' && next === 'school' && isSchoolSuffixToken(nextNext)) {
            const normalized = SCHOOL_SUFFIX_TO_TOKEN[nextNext];
            if (!seen.has('member')) {
                seen.add('member');
                tokens.push('member');
            }
            if (!seen.has(normalized)) {
                seen.add(normalized);
                tokens.push(normalized);
            }
            changed = true;
            mappedCount += 1;
            idx += 3;
            continue;
        }

        // Handle member + school role (e.g. "member school_teacher").
        if (current === 'member' && String(next || '').startsWith('school_')) {
            const normalized = next;
            if (SCHOOL_TOKEN_SET.has(normalized)) {
                if (!seen.has('member')) {
                    seen.add('member');
                    tokens.push('member');
                }
                if (!seen.has(normalized)) {
                    seen.add(normalized);
                    tokens.push(normalized);
                }
                changed = true;
                mappedCount += 1;
                idx += 2;
                continue;
            }
        }

        // Handle school role split into two segments (e.g. "school teacher").
        if (current === 'school' && isSchoolSuffixToken(next)) {
            const normalized = SCHOOL_SUFFIX_TO_TOKEN[next];
            if (!seen.has(normalized)) {
                seen.add(normalized);
                tokens.push(normalized);
            }
            changed = true;
            mappedCount += 1;
            idx += 2;
            continue;
        }

        const result = parseRoleSegment(raw);
        if (!result.tokens.length) {
            idx += 1;
            continue;
        }

        if (result.changed || String(result.tokens[0] || '') !== normalizedRaw) changed = true;
        if (result.mappedCount) mappedCount += result.mappedCount;

        for (const token of result.tokens) {
            if (!seen.has(token)) {
                seen.add(token);
                tokens.push(token);
            }
        }
        idx += 1;
    }

    return {
        value: tokens.length ? tokens : ['member'],
        changed,
        mappedCount
    };
}

function normalizeOrgRoleTokens(orgMembership = {}) {
    const values = [];
    if (Array.isArray(orgMembership?.roles)) {
        values.push(...orgMembership.roles);
    }
    if (Object.prototype.hasOwnProperty.call(orgMembership || {}, 'role')) {
        values.push(orgMembership.role);
    }
    return normalizeRoleTokenValues(values).value;
}

function buildCanonicalOrgRole(orgMembership = {}) {
    const roles = normalizeOrgRoleTokens(orgMembership);
    return Array.isArray(roles) && roles.length > 0 ? roles[0] : 'member';
}

module.exports = {
    SCHOOL_SUFFIX_TO_TOKEN,
    SCHOOL_TOKEN_SET,
    canonicalizeRoleAtom,
    normalizeRoleTokenValues,
    normalizeOrgRoleTokens,
    buildCanonicalOrgRole
};
