// MVC/controllers/school/studentController.js
const dataService = require('../../services/school/schoolDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const dataServiceGlobal = requireCoreModule('MVC/services/dataService'); 
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const settingService = requireCoreModule('MVC/services/settingService');
const { isAjax, buildDataServiceQuery, inferSearchableFields } = requireCoreModule('MVC/utils/generalTools');
const {
    getActiveOrgIdOrThrow: getActiveOrgIdOrThrowShared,
    assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared,
    canCreateOrgScopedItem,
    assertOrgAccess,
    normalizeOrgRoles,
    getPrimaryOrgRole
} = requireCoreModule('MVC/utils/orgContextUtils');

// File handling helpers (centralized)
const fileService = requireCoreModule('MVC/services/fileService');
const coreFilesService = requireCoreModule('MVC/services/coreFilesService');
const upload = requireCoreModule('MVC/middleware/upload');
const fileAssetStorage = requireCoreModule('MVC/services/fileAssetStorageService');
const path = require('path');
const crypto = require('crypto');
const { createTransactionContext, addDeleteCompensation } = requireCoreModule('MVC/services/transactionContextService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const {
    assertNoDuplicatePersonAccount,
    enrichPersonPickerRowsWithAccountState
} = require('../../services/school/schoolPeopleDuplicateGuardService');
const schoolPersonAccessService = require('../../services/school/schoolPersonAccessService');
const { ACADEMIC_STATUSES } = require('../../models/school/studentModel');
const { FEE_CATEGORIES } = require('../../models/school/feeCategoryCatalog');
const STUDENT_DELETE_FOOTPRINT_RULES = Object.freeze([
  { entityType: 'studentProgramRegistrations', field: 'studentId', label: 'Student Program Registrations' },
  { entityType: 'studentTermRegistrations', field: 'studentId', label: 'Student Term Registrations' },
  { entityType: 'classEnrollmentPeriods', field: 'studentId', label: 'Class Enrollment Periods' },
  { entityType: 'academicLedger', field: 'studentId', label: 'Academic Ledger' },
  { entityType: 'globalTransactions', field: 'party.studentId', label: 'Global Transactions' },
  { entityType: 'reportInstances', field: 'studentId', label: 'Report Instances' },
  { entityType: 'examAssignments', field: 'studentId', label: 'Exam Assignments' },
  { entityType: 'examAttempts', field: 'studentId', label: 'Exam Attempts' },
  { entityType: 'examAnswers', field: 'studentId', label: 'Exam Answers' }
]);
const STUDENT_DELETE_MAX_FOOTPRINT_SAMPLE = 5;

function routeAccess(req) {
    return dataService.buildRouteAccessContext(req);
}

function getActiveOrgIdOrThrow(reqUser) {
    return getActiveOrgIdOrThrowShared(reqUser);
}

async function assertCreateOrgContextOrThrow(reqUser) {
    return assertCreateOrgContextOrThrowShared(reqUser, { scopeLabel: 'students' });
}

function assertStudentOrgAccess(student, activeOrgId, reqUser) {
    assertOrgAccess(student, activeOrgId, reqUser, { orgField: 'orgId', allowSystemBypass: true });
}

function parseJsonSafe(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return fallback; }
}

function toBoolean(v) {
    return v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getRecordIdentity(record) {
    return toPublicId(record?.id)
        || toPublicId(record?.code)
        || toPublicId(record?.partyId)
        || toPublicId(record?.orgId)
        || toPublicId(record?._id)
        || '';
}

function buildFootprintBlockedMessage(studentDisplayName, footprint) {
    const safeName = escapeHtml(studentDisplayName);
    if (!Array.isArray(footprint) || !footprint.length) {
        return `Cannot delete ${safeName} because it has related history.`;
    }

    const items = footprint.map((entry) => {
        const sampleText = Array.isArray(entry.samples) && entry.samples.length > 0
            ? `<span class="font-monospace">(${entry.samples.join(', ')})</span>`
            : '';
        return `<li><strong>${escapeHtml(entry.label || '')}</strong>: ${Number(entry.count || 0)} record(s) found ${sampleText}</li>`;
    });

    return `Cannot delete ${safeName} because related history exists. Please remove these references first:<ul>${items.join('')}</ul>`;
}

async function collectStudentFootprint(studentId, activeOrgId, reqUser) {
    const targetStudentId = toPublicId(studentId);
    if (!targetStudentId) return [];

    const rows = [];
    for (const rule of STUDENT_DELETE_FOOTPRINT_RULES) {
        const field = String(rule?.field || '').trim();
        if (!field) continue;

        const query = {
            page: 1,
            [`${field}__eq`]: targetStudentId
        };
        if (activeOrgId) query.orgId__eq = String(activeOrgId);

        const items = await dataService.fetchData(rule.entityType, query, reqUser);
        if (!Array.isArray(items) || items.length === 0) continue;

        const samples = (items || [])
            .slice(0, STUDENT_DELETE_MAX_FOOTPRINT_SAMPLE)
            .map(getRecordIdentity)
            .filter(Boolean);

        rows.push({
            entityType: String(rule.entityType || '').trim(),
            label: String(rule.label || '').trim() || String(rule.entityType || '').trim(),
            count: items.length,
            samples
        });
    }

    return rows;
}

async function removePersonSchoolRole(personId, orgId, role, reqUser, options = {}) {
    const result = await schoolPersonAccessService.removePersonSchoolRole({ personId, orgId, role, reqUser, options });
    return result?.reason === 'school_role_not_attached'
        ? { ...result, reason: 'school_student_role_not_attached' }
        : result;
}

function formatStudentDisplayName(student, person) {
    const personLabel = `${String(person?.name?.first || '').trim()} ${String(person?.name?.last || '').trim()}`.trim();
    return personLabel || toPublicId(student?.id || '') || 'Student';
}

function normalizeToken(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function normalizeNameKey(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function sendGuardedResponse(req, res, guardResult, duplicateMessage, duplicateStatus = 409) {
    if (!guardResult || guardResult.status === 'acquired') return false;
    if (guardResult.status === 'busy') {
        const payload = {
            status: 'warning',
            message: duplicateMessage,
            idempotency: {
                state: 'busy',
                retryAfterMs: Number(guardResult.retryAfterMs || 0)
            }
        };
        if (isAjax(req)) {
            res.status(duplicateStatus).json(payload);
        } else {
            res.status(duplicateStatus).render('error', { title: 'Error', message: payload.message, user: req.user });
        }
        return true;
    }
    if (guardResult.status === 'replay') {
        const payload = guardResult.payload && typeof guardResult.payload === 'object'
            ? { ...guardResult.payload }
            : { status: 'success', message: 'Student save already completed.' };
        payload.idempotency = { state: 'replayed' };
        if (isAjax(req)) {
            res.json(payload);
        } else {
            const redirectTo = String(payload.redirectTo || '').trim();
            if (redirectTo) {
                res.redirect(redirectTo);
            } else {
                res.redirect('/school/students');
            }
        }
        return true;
    }
    return false;
}

function buildUniqueAccountCode(existingOrgAccounts, baseCode) {
    const usedCodes = new Set(
        (existingOrgAccounts || []).map((a) => String(a?.code || '').trim().toUpperCase()).filter(Boolean)
    );
    const base = (normalizeToken(baseCode) || `STU_${Date.now()}`).slice(0, 40);
    if (!usedCodes.has(base)) return base;

    for (let i = 2; i <= 9999; i++) {
        const suffix = `_${i}`;
        const candidate = `${base.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`;
        if (!usedCodes.has(candidate)) return candidate;
    }
    throw new Error('Unable to generate a unique account code for this student.');
}

function buildUniqueAccountName(existingOrgAccounts, baseName) {
    const usedNames = new Set(
        (existingOrgAccounts || []).map((a) => normalizeNameKey(a?.name)).filter(Boolean)
    );
    const compactBase = String(baseName || '').trim().replace(/\s+/g, ' ').slice(0, 160) || 'Student Account';
    if (!usedNames.has(normalizeNameKey(compactBase))) return compactBase;

    for (let i = 2; i <= 9999; i++) {
        const suffix = ` (${i})`;
        const candidate = `${compactBase.slice(0, Math.max(1, 160 - suffix.length))}${suffix}`;
        if (!usedNames.has(normalizeNameKey(candidate))) return candidate;
    }
    throw new Error('Unable to generate a unique account name for this student.');
}

function resolvePersonDisplayName(person, fallback) {
    const first = String(person?.name?.first || '').trim();
    const last = String(person?.name?.last || '').trim();
    const full = `${first} ${last}`.trim();
    return full || String(fallback || '').trim() || 'Student';
}

function findActiveOrgHeadAccount(accounts, orgId, headCategory, aliases = []) {
    const allowedCategories = new Set(
        [headCategory]
            .concat(Array.isArray(aliases) ? aliases : [])
            .map((v) => String(v || '').trim().toLowerCase())
            .filter(Boolean)
    );
    return (accounts || []).find((a) => {
        if (!idsEqual(a?.orgId || '', orgId || '')) return false;
        if (String(a?.status || '').toLowerCase() !== 'active') return false;
        return allowedCategories.has(String(a?.headCategory || 'none').toLowerCase());
    }) || null;
}

function normalizeFeeCategoryKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\(.*?\)/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function resolveStudentCategoryParentAccount(orgAccounts, studentsHeadAccount, feeCategory) {
    if (!studentsHeadAccount) return null;

    const key = normalizeFeeCategoryKey(feeCategory);
    const codeMap = {
        domestic: '1221',
        international: '1222',
        corporate: '1223',
        scholarship: '1224',
        government_funded: '1225',
        others: '1226',
        other: '1226',
        linc: '1227',
        linc_alberta: '1227',
        wcb: '1228',
        wcb_alberta: '1228'
    };
    const targetCode = codeMap[key];
    if (!targetCode) return null;

    return (orgAccounts || []).find((a) => {
        if (String(a?.status || '').toLowerCase() !== 'active') return false;
        if (!idsEqual(a?.parentId || '', studentsHeadAccount.id || '')) return false;
        return String(a?.code || '') === String(targetCode);
    }) || null;
}

async function createStudentSubAccount({
    student,
    person,
    selfFund,
    funderAccountId,
    accessibleAccounts,
    reqUser,
    options = {}
}) {
    const orgId = String(student?.orgId || '').trim();
    if (!orgId) throw new Error('Student organization is missing while creating account linkage.');

    const allAccessibleAccounts = Array.isArray(accessibleAccounts) ? accessibleAccounts : [];
    const orgAccounts = allAccessibleAccounts.filter((a) => String(a?.orgId || '') === orgId);
    const systemAccounts = allAccessibleAccounts.filter((a) => String(a?.orgId || '').toUpperCase() === 'SYSTEM');

    let parentAccount = null;
    if (selfFund) {
        const studentsHead =
            findActiveOrgHeadAccount(orgAccounts, orgId, 'students', ['student_all']) ||
            findActiveOrgHeadAccount(systemAccounts, 'SYSTEM', 'students', ['student_all']);
        if (!studentsHead) {
            throw new Error('No active "students" head account is configured. Please set one in School Accounts before admitting self-funded students.');
        }
        const candidatePool = String(studentsHead?.orgId || '').toUpperCase() === 'SYSTEM'
            ? systemAccounts
            : orgAccounts;
        parentAccount = resolveStudentCategoryParentAccount(candidatePool, studentsHead, student?.feeCategory) || studentsHead;
    } else {
        const funderId = String(funderAccountId || '').trim();
        if (!funderId) {
            throw new Error('Please select a funder account or enable self-funded mode.');
        }
        parentAccount = allAccessibleAccounts.find((a) => String(a.id || '') === funderId) || null;
        if (!parentAccount) {
            throw new Error('Selected funder account was not found in the active organization.');
        }
        const parentOrgId = String(parentAccount?.orgId || '').trim();
        if (parentOrgId && parentOrgId !== orgId && parentOrgId.toUpperCase() !== 'SYSTEM') {
            throw new Error('Selected funder account belongs to another organization and cannot be linked to this student.');
        }
    }

    const parentLevel = Number(parentAccount?.level || 1);
    const childLevel = parentLevel + 1;
    if (childLevel > 6) {
        throw new Error('Cannot create student account under the selected parent because account level would exceed 6.');
    }

    const displayName = resolvePersonDisplayName(person, student?.id);
    const baseCode = selfFund ? `STU_${student?.id}` : `FUND_STU_${student?.id}`;
    const code = buildUniqueAccountCode(orgAccounts, baseCode);
    const name = buildUniqueAccountName(
        orgAccounts,
        selfFund ? `${displayName} (Self-Funded Student)` : `${displayName} (Funded Student)`
    );

    const accountPayload = {
        orgId,
        code,
        name,
        type: String(parentAccount?.type || 'asset').toLowerCase(),
        level: childLevel,
        parentId: String(parentAccount?.id || ''),
        isControl: false,
        allowPost: true,
        partyRole: 'student',
        headCategory: 'none',
        normalBalance: String(parentAccount?.normalBalance || 'debit').toLowerCase() === 'credit' ? 'credit' : 'debit',
        status: 'active',
        description: `Auto-created for student ${student?.id || ''}.`
    };

    return await dataService.addData('schoolAccounts', accountPayload, reqUser, options);
}

function buildInlinePersonPayload(body, reqUser) {
    const now = new Date().toISOString();
    const firstName = String(body.newPersonFirstName || '').trim();
    const middleName = String(body.newPersonMiddleName || '').trim();
    const lastName = String(body.newPersonLastName || '').trim();
    const preferredName = String(body.newPersonPreferredName || '').trim();
    const notes = String(body.newPersonNotes || '').trim();
    const active = toBoolean(body.newPersonActive);
    const gender = String(body.newPersonGender || '').trim().toLowerCase();
    const dateOfBirth = String(body.newPersonDateOfBirth || '').trim();

    const emailsRaw = parseJsonSafe(body.newPersonEmails, []);
    const phonesRaw = parseJsonSafe(body.newPersonPhones, []);
    const addressesRaw = parseJsonSafe(body.newPersonAddresses, []);

    const emails = Array.isArray(emailsRaw)
        ? emailsRaw
            .map((e) => ({
                type: String(e?.type || 'work').trim().toLowerCase(),
                email: String(e?.email || '').trim(),
                isPrimary: Boolean(e?.isPrimary)
            }))
            .filter((e) => !!e.email)
        : [];

    const legacyEmail = String(body.newPersonEmail || '').trim();
    if (!emails.length && legacyEmail) {
        emails.push({ type: 'primary', email: legacyEmail, isPrimary: true });
    }

    if (!emails.length) {
        throw new Error('At least one email is required for new person registration.');
    }
    if (!emails.some((e) => e.isPrimary)) {
        emails[0].isPrimary = true;
    }

    const phones = Array.isArray(phonesRaw)
        ? phonesRaw
            .map((p) => ({
                type: String(p?.type || 'mobile').trim().toLowerCase(),
                number: String(p?.number || '').trim()
            }))
            .filter((p) => !!p.number)
        : [];

    const legacyPhone = String(body.newPersonPhone || '').trim();
    if (!phones.length && legacyPhone) {
        phones.push({ type: 'mobile', number: legacyPhone });
    }

    const addresses = Array.isArray(addressesRaw)
        ? addressesRaw
            .map((a) => ({
                type: String(a?.type || 'home').trim().toLowerCase(),
                line1: String(a?.line1 || '').trim(),
                city: String(a?.city || '').trim(),
                province: String(a?.province || '').trim(),
                postalCode: String(a?.postalCode || '').trim()
            }))
            .filter((a) => !!(a.line1 || a.city || a.province || a.postalCode))
        : [];

    if (!firstName || !lastName || !gender || !dateOfBirth) {
        throw new Error('New Person fields are incomplete. Please provide first name, last name, gender, and date of birth.');
    }

    const activeOrgId = String(reqUser?.activeOrgId || '').trim();
    const allowedOrgs = Array.isArray(reqUser?.allowedOrgs) ? reqUser.allowedOrgs : [];
    const activeOrgMeta = allowedOrgs.find((o) => String(o?.orgId || '') === activeOrgId) || null;
    const baseOrgRoles = normalizeOrgRoles(activeOrgMeta);
  const initialOrganizations = activeOrgId
    ? [{
      orgId: Number.isFinite(Number(activeOrgId)) ? Number(activeOrgId) : activeOrgId,
      name: String(activeOrgMeta?.name || activeOrgMeta?.orgName || '').trim(),
      roles: baseOrgRoles,
      role: getPrimaryOrgRole(activeOrgMeta),
      memberStatus: 'active',
      joinedAt: now
    }]
    : [];

    return {
        active,
        name: {
            first: firstName,
            middle: middleName || null,
            last: lastName,
            preferred: preferredName || null
        },
        demographics: {
            gender,
            dateOfBirth
        },
        contact: {
            emails,
            phones,
            email: emails.find((e) => e.isPrimary)?.email || emails[0]?.email || null
        },
        addresses,
        address: addresses[0] || {},
        tags: [],
        notes: notes || null,
        avatarUrl: null,
        organizations: initialOrganizations,
        audit: {
            createUser: reqUser?.id || reqUser?.username || 'SYSTEM',
            createDateTime: now,
            lastUpdateUser: reqUser?.id || reqUser?.username || 'SYSTEM',
            lastUpdateDateTime: now
        }
    };
}

async function ensurePersonHasOrgRole(personId, orgId, role, reqUser, options = {}) {
    return schoolPersonAccessService.ensurePersonHasSchoolRole({ personId, orgId, role, reqUser, options });
}

async function archiveLinkedStudentAccount(student, reqUser, accessContext = {}) {
    const linkedAccountId = String(student?.studentAccountId || '').trim();
    if (!linkedAccountId) return null;

    const account = await dataService.getDataById('schoolAccounts', linkedAccountId, reqUser, accessContext);
    if (!account) return null;
    if (String(account.status || '').toLowerCase() === 'archived') return account;

    return await dataService.updateData(
        'schoolAccounts',
        linkedAccountId,
        { ...account, status: 'archived', allowPost: false },
        reqUser
    );
}

async function recoverLinkedStudentAccount(student, reqUser, accessContext = {}) {
    const linkedAccountId = String(student?.studentAccountId || '').trim();
    if (!linkedAccountId) return null;

    const account = await dataService.getDataById('schoolAccounts', linkedAccountId, reqUser, accessContext);
    if (!account) return null;
    if (String(account.status || '').toLowerCase() !== 'archived') return account;

    return await dataService.updateData(
        'schoolAccounts',
        linkedAccountId,
        { ...account, status: 'active', allowPost: true },
        reqUser
    );
}

async function purgeLinkedStudentAccount(student, reqUser, txContext, outcome, warnings) {
    const linkedAccountId = String(student?.studentAccountId || '').trim();
    if (!linkedAccountId) {
        warnings.push('Student has no linked school account id.');
        return { removed: false, accountId: '' };
    }

    const accountSnapshot = await dataService.getDataById('schoolAccounts', linkedAccountId, reqUser);
    if (!accountSnapshot) {
        warnings.push(`Linked school account ${linkedAccountId} not found.`);
        return { removed: false, accountId: linkedAccountId };
    }

    const accountSnapshotClone = JSON.parse(JSON.stringify(accountSnapshot));
    await dataService.purgeData('schoolAccounts', linkedAccountId, reqUser, { transactionContext: txContext });

    if (txContext) {
        txContext.addCompensation(async () => {
            await dataService.addData('schoolAccounts', accountSnapshotClone, reqUser, { transactionContext: txContext });
        }, { type: 'restore_student_school_account', entityType: 'schoolAccounts', id: toPublicId(linkedAccountId) });
    }

    outcome.removedSchoolAccount = true;
    outcome.schoolAccountId = toPublicId(linkedAccountId);
    return { removed: true, accountId: toPublicId(linkedAccountId), snapshot: accountSnapshotClone };
}

function logStudentDeleteAuditEvent(level, payload) {
    const parts = [
        '[STUDENT_DELETE]',
        `level=${String(level || '').trim() || 'unknown'}`,
        `actor=${String(payload?.actor || '').trim() || 'unknown'}`,
        `studentId=${String(payload?.studentId || '').trim() || 'unknown'}`,
        `orgId=${String(payload?.orgId || '').trim() || 'unknown'}`,
        `outcome=${String(payload?.outcome || '').trim() || 'unknown'}`
    ];

    const footer = [
        `removedRole=${Boolean(payload?.removedRole) ? 'yes' : 'no'}`,
        `removedSchoolAccount=${Boolean(payload?.removedSchoolAccount) ? 'yes' : 'no'}`,
        `footprint=${Number(payload?.footprintCount || 0)}`
    ];

    console.info(`${parts.join(' ')} ${footer.join(' ')}`);
}

exports.listEligiblePersons = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';

    const personPayload = await schoolPersonAccessService.listPickerPersons({
      reqUser: req.user,
      q: query.q || '',
      query,
      requireSchoolRole: false
    });
    const mapped = personPayload.allRows || personPayload.rows || [];
    const enriched = await enrichPersonPickerRowsWithAccountState(mapped, {
      entityType: 'students',
      orgId: activeOrgId,
      requestingUser: req.user
    });

    const { data, pagination } = paginate(enriched, query);
    return res.json({
      status: 'success',
      results: data,
      pagination
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};
exports.listStudents = async (req, res) => {
    try {
        let query = await buildDataServiceQuery(req.query);
        const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
        if (query.q === searchDefaultKeyword) query.q = '';
        const canCreateStudents = await canCreateOrgScopedItem(req.user, { scopeLabel: 'students' });
        const searchTerm = String(query.q || '').trim().toLowerCase();
        const fetchQuery = { ...query };
        delete fetchQuery.q;
        delete fetchQuery.type;
        delete fetchQuery.searchFields;

        const allStudents = await dataService.fetchData('students', fetchQuery, req.user, dataService.buildRouteAccessContext(req));
        const personById = await schoolPersonAccessService.buildPersonByIdMap({
            reqUser: req.user,
            personIds: (Array.isArray(allStudents) ? allStudents : []).map((student) => student.personId)
        });

        const enrichedStudents = allStudents.map(student => {
            const person = personById.get(toPublicId(student.personId));
            const firstName = person?.name?.first || person?.firstName || 'Unknown';
            const lastName = person?.name?.last || person?.lastName || 'Person';
            const fullName = schoolPersonAccessService.formatPersonName(person, `${firstName} ${lastName}`.trim());
            return {
                ...student,
                firstName,
                lastName,
                name: fullName,
                email: schoolPersonAccessService.readPersonEmail(person) || 'N/A',
                phone: person?.contact?.phones?.[0]?.number || 'N/A'
            };
        });

        // Main student list must hide archived records (recovery page handles archived).
        const visibleStudents = enrichedStudents.filter((s) => {
            const st = String(s?.academicStatus || '').trim().toLowerCase();
            return st !== 'archived';
        });

        const searchedStudents = !searchTerm
            ? visibleStudents
            : visibleStudents.filter((student) => {
                const haystack = [
                    student.id,
                    student.personId,
                    student.firstName,
                    student.lastName,
                    student.name,
                    `${student.firstName || ''} ${student.lastName || ''}`.trim(),
                    `${student.lastName || ''} ${student.firstName || ''}`.trim(),
                    student.email,
                    student.phone,
                    student.feeCategory,
                    student.studentAccountId
                ].filter(Boolean).join(' ').toLowerCase();
                return haystack.includes(searchTerm);
            });

        const searchableFields = await inferSearchableFields(searchedStudents, { exclude: ['audit', 'attachments'] });
        const { data, pagination } = paginate(searchedStudents, query);

        if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

        res.render('school/student/studentList', {
            title: 'Student Directory',
            tableName: 'Students_Directory',
            newUrl: 'school/students',
            newLabel: canCreateStudents ? 'Admit Student' : null,
            data,
            searchableFields,
            includeModal: true,
            includeModal_Table: true,
            print: true,
            pagination,
            filters: req.query,
            feeCategories: FEE_CATEGORIES,
            user: req.user,
            actionStateId: req.actionStateId
        });
    } catch (error) {
        if (isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
};

exports.listArchivedStudents = async (req, res) => {
    try {
        let query = await buildDataServiceQuery(req.query);
        const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
        if (query.q === searchDefaultKeyword) query.q = '';

        const archivedQuery = { ...query, academicStatus: 'Archived' };
        const allStudents = await dataService.fetchData('students', archivedQuery, req.user, dataService.buildRouteAccessContext(req));
        const personById = await schoolPersonAccessService.buildPersonByIdMap({
            reqUser: req.user,
            personIds: (Array.isArray(allStudents) ? allStudents : []).map((student) => student.personId)
        });

        const enrichedStudents = allStudents.map(student => {
            const person = personById.get(toPublicId(student.personId));
            return {
                ...student,
                firstName: person?.name?.first || person?.firstName || 'Unknown',
                lastName: person?.name?.last || person?.lastName || 'Person',
                email: schoolPersonAccessService.readPersonEmail(person) || 'N/A',
                phone: person?.contact?.phones?.[0]?.number || 'N/A'
            };
        });

        const activeStudents = enrichedStudents.filter((s) => String(s?.academicStatus || '') !== 'Archived');
        const searchableFields = await inferSearchableFields(activeStudents, { exclude: ['audit', 'attachments'] });
        const { data, pagination } = paginate(activeStudents, query);

        if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

        res.render('school/student/studentRecovery', {
            title: 'Recover Archived Students',
            tableName: 'Archived_Students',
            data,
            searchableFields,
            includeModal: true,
            includeModal_Table: true,
            print: true,
            pagination,
            filters: req.query,
            feeCategories: FEE_CATEGORIES,
            user: req.user,
            actionStateId: req.actionStateId
        });
    } catch (error) {
        if (isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
};

exports.showForm = async (req, res) => {
    try {
        const isEdit = !!req.params.id;
        const activeOrgId = isEdit
            ? getActiveOrgIdOrThrow(req.user)
            : await assertCreateOrgContextOrThrow(req.user);
        let student = {};
        let personName = '';
        let personOrganizations = [];
        let funderAccountName = '';

        if (isEdit) {
            student = await dataService.getDataById('students', req.params.id, req.user, routeAccess(req));
            if (!student) throw new Error('Student not found.');
            assertStudentOrgAccess(student, activeOrgId, req.user);
            
            const person = await schoolPersonAccessService.getPersonById({ reqUser: req.user, personId: student.personId });
            if (person) {
                personName = schoolPersonAccessService.formatPersonName(person, '');
                personOrganizations = Array.isArray(person.organizations) ? person.organizations : [];
            }

            if (student.funderAccountId) {
                const accessibleAccounts = await dataService.fetchData('schoolAccounts', {}, req.user, routeAccess(req));
                const account = accessibleAccounts.find((a) => idsEqual(a.id, student.funderAccountId));
                if (account) {
                    funderAccountName = `${account.code || ''} - ${account.name || ''}`.trim();
                } else {
                    funderAccountName = String(student.funderAccountId);
                }
            }
        }

        const organizations = await dataServiceGlobal.fetchData('organizations', {}, req.user);
        const organizationLookup = {};
        (organizations || []).forEach((org) => {
            const id = String(org?.id || '').trim();
            if (!id) return;
            organizationLookup[id] = String(org?.name || org?.orgName || id).trim();
        });

        const countries = ['Canada', 'USA', 'UK', 'Australia', 'India', 'China', 'Brazil', 'Mexico', 'Nigeria', 'Iran', 'Other'];

        const editFormDisplayName = String(personName || '').trim() || 'Student';
        const editFormRecordId = String(student.id || student.personId || '').trim();

        res.render('school/student/studentForm', {
            title: isEdit ? `Edit Student: ${editFormDisplayName} (${editFormRecordId})` : 'Admit New Student',
            student,
            personName,
            personOrganizations,
            funderAccountName,
            organizationLookup,
            feeCategories: FEE_CATEGORIES,
            academicStatuses: ACADEMIC_STATUSES,
            countries,    
            user: req.user,
            includeModal: true,
            actionStateId: req.actionStateId
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
};

exports.saveStudent1 = async (req, res) => {
    try {
        const { id } = req.params;
        const activeOrgId = id
            ? getActiveOrgIdOrThrow(req.user)
            : await assertCreateOrgContextOrThrow(req.user);
        
        let parsedAttachments = [];
        if (req.body.attachments) {
            try { parsedAttachments = JSON.parse(req.body.attachments); } catch (e) { parsedAttachments = []; }
        }

        const payload = {
            personId: req.body.personId.trim(),
            localId: (req.body.localId || '').trim(),
            countryOfOrigin: req.body.countryOfOrigin || '',
            
            // Financial & Organizational Defaults
            feeCategory: req.body.feeCategory || '', 
            sendingOrganization: '',
            funderOrganization: '',
            funderAccountId: String(req.body.funderAccountId || '').trim(),
            studentIdAtFunder: String(req.body.studentIdAtFunder || '').trim(),
            selfFund: req.body.selfFund === 'true' || req.body.selfFund === 'on' || req.body.selfFund === true,
            funderNote: String(req.body.funderNote || '').trim(),
            
            // Status & Notes
            enrollmentDate: req.body.enrollmentDate,
            academicStatus: req.body.academicStatus || 'Active',
            notes: (req.body.notes || '').trim(),

            // Organization
            orgId: String(activeOrgId),
            
            attachments: parsedAttachments
        };

        if (payload.funderAccountId) {
            const accessibleAccounts = await dataService.fetchData('schoolAccounts', {}, req.user, routeAccess(req));
            const isValidFunder = accessibleAccounts.some((a) => idsEqual(a.id, payload.funderAccountId));
            if (!isValidFunder) throw new Error('Selected funder account is invalid or inaccessible.');
        }

        if (!payload.personId) throw new Error("A valid Person must be selected.");
        if (!id && req.body.studentId) payload.id = req.body.studentId.trim();

        if (id) {
            await dataService.updateData('students', id, payload, req.user);
        } else {
            await dataService.addData('students', payload, req.user);
        }

        if (isAjax(req)) return res.json({ status: 'success', message: 'Student saved successfully.' });
        res.redirect('/school/students');
    } catch (error) {
        if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
        res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
};

exports.saveStudent = async (req, res) => {
    let txContext = null;
    let guardKey = '';
    try {
        const { id } = req.params;
        const activeOrgId = id
            ? getActiveOrgIdOrThrow(req.user)
            : await assertCreateOrgContextOrThrow(req.user);
        guardKey = idempotencyGuardService.createGuardKey([
            'student_save',
            String(activeOrgId || '').trim(),
            String(id || '').trim(),
            req.body || {},
            Array.isArray(req.files) ? req.files.map((file) => ({
                name: String(file?.originalname || '').trim(),
                size: Number(file?.size || 0)
            })) : []
        ]);
        const guardResult = idempotencyGuardService.beginGuard({
            key: guardKey,
            runningTtlMs: 180000,
            replayTtlMs: 20000
        });
        if (sendGuardedResponse(req, res, guardResult, 'Student save is already in progress. Please wait.')) return;

        txContext = createTransactionContext({
            name: 'student_save',
            metadata: {
                studentId: toPublicId(id),
                activeOrgId: toPublicId(activeOrgId),
                requestUserId: toPublicId(req.user?.id) || String(req.user?.username || 'system')
            }
        });

        let existingStudent = null;
        if (id) {
            existingStudent = await dataService.getDataById('students', id, req.user, routeAccess(req));
            if (!existingStudent) throw new Error('Student not found.');
            assertStudentOrgAccess(existingStudent, activeOrgId, req.user);
        }

        let parsedAttachments = [];
        if (req.body.attachments) {
            try { parsedAttachments = JSON.parse(req.body.attachments); } catch (e) { parsedAttachments = []; }
        }

        const commentsRaw = req.body.newFileComments;
        const newFileComments = Array.isArray(commentsRaw) ? commentsRaw : (commentsRaw ? [commentsRaw] : []);

        if (req.files && req.files.length > 0) {
            req.files.forEach((file, idx) => {
                const normalizedPath = String(upload.getStoredFilePath(file) || '').replace(/\\/g, '/');
                const fileUrl = String(upload.getStoredFileUrl(file) || normalizedPath).replace(/\\/g, '/');

                parsedAttachments.push({
                    id: crypto.randomBytes(8).toString('hex'),
                    originalName: file.originalname,
                    filename: file.filename,
                    path: normalizedPath,
                    url: fileUrl,
                    size: file.size,
                    uploadDate: new Date().toISOString(),
                    comment: String(newFileComments[idx] || '').trim()
                });
            });
        }

        const personMode = existingStudent
            ? 'existing'
            : String(req.body.personMode || 'existing').trim().toLowerCase();
        let personId = toPublicId(req.body.personId);

        if (!existingStudent && personMode === 'new') {
            const personPayload = buildInlinePersonPayload(req.body, req.user);
            const createdPerson = await dataServiceGlobal.addData('persons', personPayload, req.user, { transactionContext: txContext });
            personId = toPublicId(createdPerson?.id);
            if (!personId) throw new Error('Failed to create person profile before student admission.');
            addDeleteCompensation(txContext, {
                service: dataServiceGlobal,
                entityType: 'persons',
                id: personId,
                requestingUser: req.user,
                label: 'student_new_person'
            });
        }

        const payload = {
            personId,
            localId: (req.body.localId || '').trim(),
            orgId: existingStudent?.orgId ? String(existingStudent.orgId) : String(activeOrgId),
            countryOfOrigin: req.body.countryOfOrigin || '',
            feeCategory: req.body.feeCategory || '',
            sendingOrganization: '',
            funderOrganization: '',
            funderAccountId: String(req.body.funderAccountId || '').trim(),
            studentAccountId: existingStudent?.studentAccountId ? String(existingStudent.studentAccountId) : '',
            studentIdAtFunder: String(req.body.studentIdAtFunder || '').trim(),
            selfFund: req.body.selfFund === 'true' || req.body.selfFund === 'on' || req.body.selfFund === true,
            funderNote: String(req.body.funderNote || '').trim(),
            enrollmentDate: req.body.enrollmentDate,
            academicStatus: req.body.academicStatus || 'Active',
            notes: (req.body.notes || '').trim(),
            attachments: parsedAttachments
        };

        if (payload.selfFund) {
            payload.funderAccountId = '';
            payload.studentIdAtFunder = '';
        }

        const shouldLoadAccounts = !id || !!payload.funderAccountId;
        const accessibleAccounts = shouldLoadAccounts
            ? await dataService.fetchData('schoolAccounts', {}, req.user, routeAccess(req))
            : [];
        if (payload.funderAccountId) {
            const selectedFunder = accessibleAccounts.find((a) => idsEqual(a.id || '', payload.funderAccountId));
            if (!selectedFunder) throw new Error('Selected funder account is invalid or inaccessible.');
            const selectedOrgId = String(selectedFunder.orgId || '').trim();
            const studentOrgId = String(payload.orgId || '').trim();
            if (selectedOrgId && selectedOrgId !== studentOrgId && selectedOrgId.toUpperCase() !== 'SYSTEM') {
                throw new Error('Selected funder account belongs to another organization.');
            }
        }

        if (!payload.personId) throw new Error("A valid Person must be selected.");
        if (!id && req.body.studentId) payload.id = req.body.studentId.trim();
        if (!id && !payload.selfFund && !payload.funderAccountId) {
            throw new Error('Please select funding mode: enable Self-funded, or choose a Funder Account.');
        }

        await assertNoDuplicatePersonAccount({
            entityType: 'students',
            orgId: payload.orgId,
            personId: payload.personId,
            excludeId: id,
            requestingUser: req.user
        });

        const roleUpdateResult = await ensurePersonHasOrgRole(payload.personId, payload.orgId, 'school_student', req.user, { transactionContext: txContext });
        if (roleUpdateResult?.changed && roleUpdateResult?.personId) {
            txContext.addCompensation(async () => {
                await schoolPersonAccessService.restorePersonOrganizations({
                    personId: roleUpdateResult.personId,
                    organizations: roleUpdateResult.beforeOrganizations || [],
                    reqUser: req.user,
                    options: { transactionContext: txContext }
                });
            }, { type: 'restore_person_org_roles', personId: roleUpdateResult.personId });
        }

        let createdStudentAccount = null;
        let createdStudentDisplayName = 'Student';

        if (id) {
            await dataService.updateData('students', id, payload, req.user, { transactionContext: txContext });
        } else {
            const savedStudent = await dataService.addData('students', payload, req.user, { transactionContext: txContext });
            const createdStudentId = toPublicId(savedStudent?.id);
            if (!createdStudentId) throw new Error('Student was saved but no student id was returned.');

            addDeleteCompensation(txContext, {
                service: dataService,
                entityType: 'students',
                id: createdStudentId,
                requestingUser: req.user,
                label: 'student_new_record'
            });

            const person = await schoolPersonAccessService.getPersonById({ reqUser: req.user, personId: savedStudent.personId });
            const studentAccount = await createStudentSubAccount({
                student: savedStudent,
                person,
                selfFund: payload.selfFund,
                funderAccountId: payload.funderAccountId,
                accessibleAccounts,
                reqUser: req.user,
                options: { transactionContext: txContext }
            });
            createdStudentDisplayName = resolvePersonDisplayName(person, savedStudent?.id);
            createdStudentAccount = studentAccount;
            const createdStudentAccountId = toPublicId(studentAccount?.id);
            if (!createdStudentAccountId) throw new Error('Student account creation did not return an id.');

            addDeleteCompensation(txContext, {
                service: dataService,
                entityType: 'schoolAccounts',
                id: createdStudentAccountId,
                requestingUser: req.user,
                label: 'student_new_account'
            });

            await dataService.updateData(
                'students',
                createdStudentId,
                { ...savedStudent, studentAccountId: createdStudentAccountId },
                req.user,
                { transactionContext: txContext }
            );
        }

        await txContext.commit({ flow: 'student_save', studentId: toPublicId(id) });

        const payloadOut = { status: 'success', message: 'Student saved successfully.' };
        if (isAjax(req)) {
            const result = { ...payloadOut };
            if (!id && createdStudentAccount) {
                result.autoCreatedAccount = {
                    id: String(createdStudentAccount.id || ''),
                    code: String(createdStudentAccount.code || ''),
                    name: String(createdStudentAccount.name || ''),
                    type: String(createdStudentAccount.type || ''),
                    level: Number(createdStudentAccount.level || 0),
                    partyRole: String(createdStudentAccount.partyRole || 'none'),
                    status: String(createdStudentAccount.status || ''),
                    studentName: createdStudentDisplayName,
                    editUrl: `/school/accounts/edit/${encodeURIComponent(String(createdStudentAccount.id || ''))}`
                };
            }
            idempotencyGuardService.completeGuard(guardKey, result);
            return res.json(result);
        }
        idempotencyGuardService.completeGuard(guardKey, payloadOut);
        res.redirect('/school/students');
    } catch (error) {
        if (guardKey) idempotencyGuardService.failGuard(guardKey);
        if (txContext) {
            await txContext.rollback({ flow: 'student_save', reason: error.message || 'Student save failed' });
        }
        const statusCode = Number(error?.statusCode || 400);
        const responsePayload = {
            status: 'error',
            code: error?.code || '',
            error,
            message: error.message,
            details: error?.details || null
        };
        if (isAjax(req)) return res.status(statusCode).json(responsePayload);
        res.status(statusCode).render('error', { title: 'Error', error, message: error.message, user: req.user, statusCode });
    }
};

exports.downloadAttachment = async (req, res) => {
    try {
        const { id, attId } = req.params;
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        const student = await dataService.getDataById('students', id, req.user, routeAccess(req));
        if (!student) return res.status(404).send('Student not found.');
        assertStudentOrgAccess(student, activeOrgId, req.user);

        const attachments = Array.isArray(student.attachments) ? student.attachments : [];

        let attachment = null;
        if (/^\d+$/.test(String(attId))) {
            const idx = Number(attId);
            attachment = (idx >= 0 && idx < attachments.length) ? attachments[idx] : null;
        } else {
            attachment = attachments.find(a => idsEqual(a?.id, attId)) || null;
        }

        if (!attachment) return res.status(404).send('Attachment not found.');

        const fileRef = String(attachment.url || attachment.path || '').trim();
        if (!fileRef) return res.status(404).send('File path missing.');

        const downloadName = attachment.originalName || attachment.filename || path.basename(fileRef);
        return await fileAssetStorage.sendDownload(res, fileRef, downloadName);
    } catch (error) {
        if (isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
        return res.status(500).send(error.message);
    }
};

exports.deleteAttachment = async (req, res) => {
    let guardKey = '';
    try {
        const { id, attId } = req.params;
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        guardKey = idempotencyGuardService.createGuardKey([
            'student_attachment_delete',
            String(activeOrgId || '').trim(),
            String(id || '').trim(),
            String(attId || '').trim()
        ]);
        const guardResult = idempotencyGuardService.beginGuard({
            key: guardKey,
            runningTtlMs: 60000,
            replayTtlMs: 10000
        });
        if (sendGuardedResponse(req, res, guardResult, 'Attachment delete is already in progress. Please wait.')) return;

        const student = await dataService.getDataById('students', id, req.user, routeAccess(req));
        if (!student) throw new Error('Student not found.');
        assertStudentOrgAccess(student, activeOrgId, req.user);

        const attachments = Array.isArray(student.attachments) ? student.attachments : [];
        let index = -1;

        if (/^\d+$/.test(String(attId))) {
            const idx = Number(attId);
            if (idx >= 0 && idx < attachments.length) index = idx;
        } else {
            index = attachments.findIndex(a => idsEqual(a?.id, attId));
        }

        if (index < 0) throw new Error('Attachment not found.');

        const attachment = attachments[index];

        // Build URL for deletion (FileService expects /uploads/...)
        let fileUrl = String(attachment?.url || '').trim();
        if (!fileUrl) {
            const normalizedPath = String(attachment?.path || '').replace(/\\/g, '/');
            fileUrl = coreFilesService.fromDiskPathToUploadsUrl(normalizedPath) || normalizedPath;
        }

        // Remove from DB first
        attachments.splice(index, 1);
        await dataService.updateData('students', id, { attachments }, req.user);

        // Delete physical file using centralized services
        let deleted = false;
        if (fileUrl) {
            deleted = await fileService.deleteFile(fileUrl);
        }

        // Fallback to upload helper if fileUrl missing or deleteFile returned false
        if (!deleted && attachment?.path) {
            await upload.deleteFilePaths(path.resolve(String(attachment.path)));
        }

        if (isAjax(req)) {
            const payloadOut = { status: 'success', message: 'Attachment deleted.', attachments };
            idempotencyGuardService.completeGuard(guardKey, payloadOut);
            return res.json(payloadOut);
        }
        idempotencyGuardService.completeGuard(guardKey, { status: 'success', message: 'Attachment deleted.', redirectTo: `/school/students/edit/${id}` });
        return res.redirect(`/school/students/edit/${id}`);
    } catch (error) {
        if (guardKey) idempotencyGuardService.failGuard(guardKey);
        if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
        return res.status(400).send(error.message);
    }
};

exports.deleteStudent = async (req, res) => {
    let guardKey = '';
    let txContext = null;
    try {
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        guardKey = idempotencyGuardService.createGuardKey([
            'student_delete',
            String(activeOrgId || '').trim(),
            String(req.params.id || '').trim()
        ]);
        const guardResult = idempotencyGuardService.beginGuard({
            key: guardKey,
            runningTtlMs: 90000,
            replayTtlMs: 12000
        });
        if (sendGuardedResponse(req, res, guardResult, 'Student delete is already in progress. Please wait.')) return;

        const student = await dataService.getDataById('students', req.params.id, req.user, routeAccess(req));
        if (!student) throw new Error('Student not found.');
        assertStudentOrgAccess(student, activeOrgId, req.user);

        const footprint = await collectStudentFootprint(student?.id, activeOrgId, req.user);
        const person = student?.personId
            ? await schoolPersonAccessService.getPersonById({ reqUser: req.user, personId: student.personId })
            : null;
        const studentDisplayName = formatStudentDisplayName(student, person);
        if (footprint.length > 0) {
            idempotencyGuardService.failGuard(guardKey);
            const detailPayload = {
                studentId: toPublicId(student?.id),
                personId: toPublicId(student?.personId),
                footprint
            };
            const payloadOut = {
                status: 'error',
                code: 'STUDENT_DELETE_BLOCKED',
                message: buildFootprintBlockedMessage(studentDisplayName, footprint),
                details: detailPayload,
                data: detailPayload
            };
            if (isAjax(req)) return res.status(409).json(payloadOut);
            return res.status(409).render('error', {
                title: 'Delete blocked',
                statusCode: 409,
                code: payloadOut.code,
                error: new Error(payloadOut.message),
                message: payloadOut.message,
                details: payloadOut.details,
                user: req.user
            });
        }

        txContext = createTransactionContext({
            name: 'student_delete',
            metadata: {
                studentId: toPublicId(student?.id),
                personId: toPublicId(student?.personId),
                activeOrgId: toPublicId(activeOrgId),
                requestUserId: toPublicId(req.user?.id) || String(req.user?.username || 'system')
            }
        });

        const studentSnapshot = JSON.parse(JSON.stringify(student || {}));
        const removed = {
            removedRole: false,
            removedSchoolAccount: false,
            removedStudent: false,
            studentAccountId: '',
            personId: toPublicId(student?.personId),
            warnings: []
        };

        const roleResult = await removePersonSchoolRole(student.personId, activeOrgId, 'school_student', req.user, { transactionContext: txContext });
        if (roleResult?.changed && roleResult?.personId) {
            removed.removedRole = true;
            txContext.addCompensation(async () => {
                await schoolPersonAccessService.restorePersonOrganizations({
                    personId: roleResult.personId,
                    organizations: roleResult.beforeOrganizations || [],
                    reqUser: req.user,
                    options: { transactionContext: txContext }
                });
            }, { type: 'restore_person_org_roles', personId: roleResult.personId });
        } else if (roleResult?.reason) {
        if (roleResult.reason === 'person_not_found') {
            removed.warnings.push('Person record was not found for role cleanup.');
        } else if (roleResult.reason === 'school_student_role_not_attached') {
            removed.warnings.push('Student role was not attached to the person membership. Legacy role token cleanup may still be needed.');
        } else if (roleResult.reason !== 'organization_link_not_found') {
            removed.warnings.push(`Role cleanup skipped: ${roleResult.reason}`);
        }
        }

        await purgeLinkedStudentAccount(student, req.user, txContext, removed, removed.warnings);

        await dataService.purgeData('students', student.id, req.user, { transactionContext: txContext });
        if (txContext) {
            txContext.addCompensation(async () => {
                await dataService.addData('students', studentSnapshot, req.user, { transactionContext: txContext });
            }, { type: 'restore_student_record', entityType: 'students', id: toPublicId(student?.id) });
        }
        removed.removedStudent = true;

        await txContext.commit({ flow: 'student_delete', studentId: toPublicId(student?.id) });
        logStudentDeleteAuditEvent('success', {
            actor: toPublicId(req.user?.id) || String(req.user?.username || 'system'),
            studentId: toPublicId(student?.id),
            orgId: toPublicId(activeOrgId),
            outcome: 'deleted',
            removedRole: removed.removedRole,
            removedSchoolAccount: removed.removedSchoolAccount,
            footprintCount: footprint.length
        });

        const payloadOut = {
            status: 'success',
            message: `Student ${escapeHtml(studentDisplayName)} deleted safely.`,
            note: `${removed.warnings.length > 0
                ? `${removed.warnings.join(' ')} `
                : ''}Person and user accounts are retained. If needed, remove those records from People/Users manually.`,
            data: {
                deletedStudentId: toPublicId(student?.id),
                removedRole: removed.removedRole,
                removedSchoolAccount: removed.removedSchoolAccount,
                personId: toPublicId(student?.personId),
                schoolAccountId: removed.schoolAccountId,
                warnings: removed.warnings
            },
            redirectTo: '/school/students'
        };
        idempotencyGuardService.completeGuard(guardKey, payloadOut);
        if (isAjax(req)) return res.json(payloadOut);
        res.redirect('/school/students');
    } catch (error) {
        if (guardKey) idempotencyGuardService.failGuard(guardKey);
        if (txContext) {
            await txContext.rollback({ flow: 'student_delete', reason: error.message || 'Student delete failed' });
            logStudentDeleteAuditEvent('error', {
                actor: toPublicId(req.user?.id) || String(req.user?.username || 'system'),
                studentId: toPublicId(req.params?.id),
                orgId: toPublicId(req?.user?.activeOrgId),
                outcome: `rollback_initiated:${error.message || 'unknown'}`,
                removedRole: false,
                removedSchoolAccount: false,
                footprintCount: 0
            });
        }
        if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
        res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
};

exports.archiveStudent = async (req, res) => {
    let guardKey = '';
    try {
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        guardKey = idempotencyGuardService.createGuardKey([
            'student_archive',
            String(activeOrgId || '').trim(),
            String(req.params.id || '').trim()
        ]);
        const guardResult = idempotencyGuardService.beginGuard({
            key: guardKey,
            runningTtlMs: 60000,
            replayTtlMs: 8000
        });
        if (sendGuardedResponse(req, res, guardResult, 'Student archive is already in progress. Please wait.')) return;

        const student = await dataService.getDataById('students', req.params.id, req.user, routeAccess(req));
        if (!student) throw new Error('Student not found.');
        assertStudentOrgAccess(student, activeOrgId, req.user);

        if (String(student.academicStatus || '').trim().toLowerCase() === 'archived') {
            const payloadOut = {
                status: 'success',
                message: 'Student is already archived.',
                data: { studentId: toPublicId(student.id) },
                redirectTo: '/school/students'
            };
            idempotencyGuardService.completeGuard(guardKey, payloadOut);
            if (isAjax(req)) return res.json(payloadOut);
            return res.redirect('/school/students');
        }

        const archivedStudent = await dataService.updateData(
            'students',
            student.id,
            { ...student, academicStatus: 'Archived' },
            req.user
        );
        if (archivedStudent?.studentAccountId) {
            await archiveLinkedStudentAccount(archivedStudent, req.user, routeAccess(req));
        }

        const payloadOut = {
            status: 'success',
            message: 'Student archived successfully.',
            data: { archivedStudentId: toPublicId(student.id) },
            redirectTo: '/school/students'
        };
        idempotencyGuardService.completeGuard(guardKey, payloadOut);
        if (isAjax(req)) return res.json(payloadOut);
        res.redirect('/school/students');
    } catch (error) {
        if (guardKey) idempotencyGuardService.failGuard(guardKey);
        if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
        res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
};

exports.recoverStudent = async (req, res) => {
    let guardKey = '';
    try {
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        guardKey = idempotencyGuardService.createGuardKey([
            'student_recover',
            String(activeOrgId || '').trim(),
            String(req.params.id || '').trim()
        ]);
        const guardResult = idempotencyGuardService.beginGuard({
            key: guardKey,
            runningTtlMs: 90000,
            replayTtlMs: 12000
        });
        if (sendGuardedResponse(req, res, guardResult, 'Student recovery is already in progress. Please wait.')) return;

        const student = await dataService.getDataById('students', req.params.id, req.user, routeAccess(req));
        if (!student) throw new Error('Student not found.');
        assertStudentOrgAccess(student, activeOrgId, req.user);

        if (String(student.academicStatus || '') !== 'Archived') {
            throw new Error('Only archived students can be recovered.');
        }

        const restoredStudent = await dataService.updateData(
            'students',
            req.params.id,
            { ...student, academicStatus: 'Active' },
          req.user
        );
        await recoverLinkedStudentAccount(restoredStudent, req.user, routeAccess(req));

        const payloadOut = {
            status: 'success',
            message: 'Student and linked account recovered successfully.',
            redirectTo: '/school/students/archived'
        };
        idempotencyGuardService.completeGuard(guardKey, payloadOut);
        if (isAjax(req)) return res.json(payloadOut);
        res.redirect('/school/students/archived');
    } catch (error) {
        if (guardKey) idempotencyGuardService.failGuard(guardKey);
        if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
        res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
};

