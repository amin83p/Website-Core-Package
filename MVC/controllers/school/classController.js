// MVC/controllers/school/classController.js
const fs = require('fs').promises;
const path = require('path');
const schoolDataService = require('../../services/school/schoolDataService');
const dataService = require('../../services/dataService'); 
const paginate = require('../../utils/paginationHelper');
const indexService = require('../../services/school/schoolIndexService');
const {isAjax, buildDataServiceQuery, inferSearchableFields} = require('../../utils/generalTools');
const settingService = require('../../services/settingService'); // ✅ Use Dynamic Service
const fileAssetStorage = require('../../services/fileAssetStorageService');
const uploadFolderSettingsService = require('../../services/uploadFolderSettingsService');
const adminChekersService = require('../../services/adminChekersService');
const { ALL_FEE_CATEGORIES_KEY } = require('../../models/school/feeCategoryCatalog');
const {
    getFeeCategories,
    isValidFeeCategory,
    ALL_FEE_CATEGORIES_LABEL
} = require('../../models/school/feeCategoryCatalog');
const {
    normalizePostingPolicyRows,
    resolvePostingPoliciesOrThrow,
    resolveInheritedPostingPolicy
} = require('../../services/school/postingPolicyService');
const transactionDefinitionPreviewService = require('../../services/school/transactionDefinitionPreviewService');
const programRegistrationDraftService = require('../../services/school/programRegistrationDraftService');
const sessionStatusPolicyService = require('../../services/school/sessionStatusPolicyService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const registrationIntegrityService = require('../../services/school/registrationIntegrityService');
const academicLedgerService = require('../../services/school/academicLedgerService');
const academicSnapshotService = require('../../services/school/academicSnapshotService');
const classEnrollmentReadService = require('../../services/school/classEnrollmentReadService');
const gradesMatrixController = require('./gradesMatrixController');
const accessService = require('../../services/security/index');
const finalGradesWorkflowService = require('../../services/school/finalGradesWorkflowService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const { isRollingClassWorkflowEnabledForClass } = require('../../services/school/phase2FeatureFlagService');
const {
    getActiveOrgIdOrThrow: getActiveOrgIdOrThrowShared,
    assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared,
    canCreateOrgScopedItem,
    assertOrgAccess
} = require('../../utils/orgContextUtils');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');
const reportAssignmentSessionUtils = require('../../utils/reportAssignmentSessionUtils');
const attendanceMatrixPolicyModel = require('../../models/school/attendanceMatrixPolicyModel');
const attendanceMatrixMetricsService = require('../../services/school/attendanceMatrixMetricsService');
const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });

function isSafeChildPath(basePath, targetPath) {
    const normalizedBase = path.resolve(basePath);
    const normalizedTarget = path.resolve(targetPath);
    return normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}${path.sep}`);
}

async function pathExists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    } catch (_) {
        return false;
    }
}

async function deleteDirectoryIfExists(basePath, relativeSegments = []) {
    const safeSegments = (Array.isArray(relativeSegments) ? relativeSegments : [])
        .map((segment) => String(segment || '').trim())
        .filter(Boolean);
    const targetPath = path.resolve(basePath, ...safeSegments);
    if (!isSafeChildPath(basePath, targetPath)) {
        throw new Error('Security Violation: Refusing to delete path outside allowed base directory.');
    }
    const existed = await pathExists(targetPath);
    if (!existed) {
        return { existed: false, removed: false, path: targetPath };
    }
    await fs.rm(targetPath, { recursive: true, force: true });
    const stillExists = await pathExists(targetPath);
    return {
        existed: true,
        removed: !stillExists,
        path: targetPath
    };
}

async function cleanupClassRelatedFolders(classData) {
    const classId = String(classData?.id || '').trim();
    const orgId = String(classData?.orgId || '').trim();
    if (!classId) return { removed: [], failed: [] };

    const removed = [];
    const failed = [];

    const tryDelete = async (basePath, segments = []) => {
        try {
            const result = await deleteDirectoryIfExists(basePath, segments);
            if (result.existed && result.removed) {
                removed.push(result.path);
            }
        } catch (error) {
            failed.push({
                basePath,
                segments: (Array.isArray(segments) ? segments : []).join('/'),
                message: error?.message || String(error)
            });
        }
    };

    const classStorageBase = path.resolve(__dirname, '../../../data/school/classes_storage');
    await tryDelete(classStorageBase, [classId]);

    const storedWorkspace = String(classData?.uploadWorkspace?.relativePath || '').trim();
    const configuredWorkspace = uploadFolderSettingsService.resolveUploadFolder('school.classWorkspace', { classId });
    const defaultWorkspace = uploadFolderSettingsService.resolveDefaultUploadFolder('school.classWorkspace', { classId });
    const workspaceTargets = [storedWorkspace, defaultWorkspace, configuredWorkspace].filter(Boolean);
    const scopeKey = orgId || 'GLOBAL';
    const uploadTargets = [
        ...workspaceTargets.map((relativePath) => ({ scopeKey, relativePath })),
        { scopeKey, relativePath: `classes/${classId}` },
        { scopeKey, relativePath: `class/${classId}` }
    ];

    for (const target of uploadTargets.filter((target, index, list) => (
        list.findIndex((item) => item.scopeKey === target.scopeKey && item.relativePath === target.relativePath) === index
    ))) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const removedUpload = await fileAssetStorage.deleteRelativePath(target);
            if (removedUpload) removed.push(`/uploads/${fileAssetStorage.scopeFolder(target.scopeKey)}/${target.relativePath}`);
        } catch (error) {
            failed.push({
                basePath: `/uploads/${fileAssetStorage.scopeFolder(target.scopeKey)}`,
                segments: target.relativePath,
                message: error?.message || String(error)
            });
        }
    }

    return { removed, failed };
}

function roundMoney(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return 0;
    return Number(num.toFixed(2));
}

function parseData(input) {
  try { return typeof input === 'string' ? JSON.parse(input) : input; } catch { return null; }
}

function parseBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const token = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
    return fallback;
}

function toArrayOfStrings(value) {
    if (Array.isArray(value)) {
        return value.map((row) => String(row || '').trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value.split(',').map((row) => String(row || '').trim()).filter(Boolean);
    }
    return [];
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
            : { status: 'success', message: 'Class operation already completed.' };
        payload.idempotency = { state: 'replayed' };
        if (isAjax(req)) {
            res.json(payload);
        } else {
            res.redirect('/school/classes');
        }
        return true;
    }
    return false;
}

function normalizeClassBillingMode(value) {
    return String(value || '').trim().toLowerCase() === 'no_charge' ? 'no_charge' : 'chargeable';
}

function normalizeClassRegistrationMode(value, fallback = 'term_based') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'rolling') return 'rolling';
    if (normalized === 'term_based') return 'term_based';
    return String(fallback || '').trim().toLowerCase() === 'rolling' ? 'rolling' : 'term_based';
}

/**
 * Rolling classes: final grade uses only attendance + assignments (sessions’ gradebooks,
 * quizzes, and assignments roll into the assignments bucket in the grades matrix). Midterm
 * and final exam weights are not applicable and must be zero.
 */
function normalizeEvaluationForRegistrationMode(evaluation, registrationMode) {
    const ev = evaluation && typeof evaluation === 'object' ? evaluation : {};
    const w = ev.weights && typeof ev.weights === 'object' ? ev.weights : {};
    const passingScore = Number(ev.passingScore);
    const base = {
        passingScore: Number.isFinite(passingScore) ? passingScore : 60,
        weights: {
            attendance: Number(w.attendance) || 0,
            assignments: Number(w.assignments) || 0,
            midterm: Number(w.midterm) || 0,
            finalExam: Number(w.finalExam) || 0
        }
    };
    if (String(registrationMode || '').trim().toLowerCase() === 'rolling') {
        base.weights.midterm = 0;
        base.weights.finalExam = 0;
    }
    return base;
}

function normalizeDateOnlyOrEmpty(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        throw new Error('Cycle dates must use YYYY-MM-DD format.');
    }
    return trimmed;
}

function extractProgramIdFromRequest(req) {
    return toPublicId(req?.body?.programId || req?.query?.programId || '');
}

function assertRollingWorkflowEnabledForClass(req, classData) {
    const enabled = isRollingClassWorkflowEnabledForClass({
        classRow: classData,
        orgId: classData?.orgId,
        programId: extractProgramIdFromRequest(req)
    });
    if (!enabled) {
        throw new Error('Rolling class workflow is disabled for this organization/program scope.');
    }
}

function getClassRegistrationModeKey(classData) {
    return String(classData?.registrationMode || 'term_based').trim().toLowerCase() === 'rolling' ? 'rolling' : 'term_based';
}

/**
 * Rolling enrollment periods that have ended (or are closed) but have no Pass/Continue/Withdraw decision yet.
 * Excludes draft/planned/cancelled/archived/error rows.
 */
function periodNeedsCompletionDecision(period) {
    const today = new Date().toISOString().slice(0, 10);
    const d = String(period.completionDecision || '').trim().toLowerCase();
    if (d === 'pass' || d === 'continue' || d === 'withdraw') return false;
    const status = String(period.status || '').trim().toLowerCase();
    if (['cancelled', 'archived', 'error', 'draft', 'planned'].includes(status)) return false;
    if (status === 'completed' || status === 'withdrawn') return true;
    const end = String(period.endDate || '').trim();
    if (end && end <= today) return true;
    return false;
}

function isUserInstructorOnClass(classData, personId) {
    const pid = String(personId || '').trim();
    if (!pid) return false;
    const rows = Array.isArray(classData?.instructors) ? classData.instructors : [];
    return rows.some((r) => idsEqual(r.personId, pid) && String(r.status || 'active').toLowerCase() !== 'inactive');
}

async function resolveActorDisplayName(reqUser) {
    const pid = reqUser?.personId;
    if (!pid) return String(reqUser?.username || reqUser?.email || 'User').trim().slice(0, 160) || 'User';
    try {
        const person = await dataService.getDataById('persons', pid, reqUser, PERSON_QUERY_OPTIONS);
        if (person?.name) {
            const label = `${person.name.first || ''} ${person.name.last || ''}`.trim();
            if (label) return label.slice(0, 160);
        }
    } catch (e) { /* ignore */ }
    return String(reqUser?.username || pid).slice(0, 160);
}

async function buildFinalGradeWorkflowCapabilities(req, classData) {
    const ip = req.ip;
    const isSuper = adminChekersService.isAdmin(req.user);
    const [gbUp, depUp, clsUp] = await Promise.all([
        accessService.evaluateAccess({ user: req.user, sectionId: SECTIONS.SCHOOL_GRADEBOOK, operationId: OPERATIONS.UPDATE, ipAddress: ip }),
        accessService.evaluateAccess({ user: req.user, sectionId: SECTIONS.SCHOOL_DEPARTMENTS, operationId: OPERATIONS.UPDATE, ipAddress: ip }),
        accessService.evaluateAccess({ user: req.user, sectionId: SECTIONS.SCHOOL_CLASSES, operationId: OPERATIONS.UPDATE, ipAddress: ip })
    ]);
    const instructor = isUserInstructorOnClass(classData, req.user?.personId);
    return {
        canTeacher: isSuper || (instructor && gbUp.allowed),
        canDeptApprove: isSuper || depUp.allowed,
        canSeniorLock: isSuper || clsUp.allowed,
        canReleaseLock: isSuper || depUp.allowed || clsUp.allowed
    };
}

async function assertFinalGradeWorkflowAccess(req, classData, action) {
    const ip = req.ip;
    if (adminChekersService.isAdmin(req.user)) return;
    if (action === 'teacher_draft' || action === 'teacher_finalize') {
        if (!isUserInstructorOnClass(classData, req.user?.personId)) {
            throw new Error('Only assigned class instructors can edit or submit final grades for this class.');
        }
        const ev = await accessService.evaluateAccess({
            user: req.user,
            sectionId: SECTIONS.SCHOOL_GRADEBOOK,
            operationId: OPERATIONS.UPDATE,
            ipAddress: ip
        });
        if (!ev.allowed) throw new Error('You do not have permission to update gradebook data.');
        return;
    }
    if (action === 'dept_approve') {
        const ev = await accessService.evaluateAccess({
            user: req.user,
            sectionId: SECTIONS.SCHOOL_DEPARTMENTS,
            operationId: OPERATIONS.UPDATE,
            ipAddress: ip
        });
        if (!ev.allowed) throw new Error('Department administrator permission is required for this approval step.');
        return;
    }
    if (action === 'senior_lock') {
        const ev = await accessService.evaluateAccess({
            user: req.user,
            sectionId: SECTIONS.SCHOOL_CLASSES,
            operationId: OPERATIONS.UPDATE,
            ipAddress: ip
        });
        if (!ev.allowed) throw new Error('School class administrator permission is required to lock final grades.');
        return;
    }
    if (action === 'release_lock') {
        const dep = await accessService.evaluateAccess({
            user: req.user,
            sectionId: SECTIONS.SCHOOL_DEPARTMENTS,
            operationId: OPERATIONS.UPDATE,
            ipAddress: ip
        });
        const cls = await accessService.evaluateAccess({
            user: req.user,
            sectionId: SECTIONS.SCHOOL_CLASSES,
            operationId: OPERATIONS.UPDATE,
            ipAddress: ip
        });
        if (!dep.allowed && !cls.allowed) {
            throw new Error('Only a department or school class administrator can release a lock.');
        }
        return;
    }
    throw new Error('Invalid workflow action.');
}

function assertRollingClassConfigAllowed(req, classData, fallbackOrgId = '') {
    const registrationMode = String(classData?.registrationMode || '').trim().toLowerCase();
    if (registrationMode !== 'rolling') return;
    const enabled = isRollingClassWorkflowEnabledForClass({
        classRow: classData,
        orgId: String(fallbackOrgId || classData?.orgId || '').trim(),
        programId: extractProgramIdFromRequest(req)
    });
    if (!enabled) {
        throw new Error('Rolling class mode is disabled for this organization/program scope.');
    }
}

function normalizeWeight(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Number(num.toFixed(2));
}

function normalizeCredits(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return 0;
    return Number(num.toFixed(2));
}

function normalizeCurriculum(curriculumInput) {
    const curriculum = curriculumInput && typeof curriculumInput === 'object' ? curriculumInput : {};
    const subjects = Array.isArray(curriculum.subjects) ? curriculum.subjects : [];
    const normalizedSubjects = subjects.map((subject, index) => ({
        subjectId: String(subject?.subjectId || '').trim(),
        code: String(subject?.code || subject?.subjectId || '').trim(),
        name: String(subject?.name || '').trim(),
        allocatedHours: Number(subject?.allocatedHours || 0),
        weight: normalizeWeight(subject?.weight)
    })).filter((subject) => subject.subjectId);

    if (normalizedSubjects.length) {
        const totalWeight = normalizeWeight(normalizedSubjects.reduce((sum, subject) => sum + Number(subject.weight || 0), 0));
        if (Math.abs(totalWeight - 100) > 0.01) {
            throw new Error(`Curriculum subject fee weights must total 100. Current total is ${totalWeight.toFixed(2)}.`);
        }
    }

    return {
        subjects: normalizedSubjects,
        totalHours: Number(curriculum.totalHours || 0)
    };
}

function normalizeClassPricing(pricingInput) {
    const pricing = pricingInput && typeof pricingInput === 'object' ? pricingInput : {};
    const feeRules = Array.isArray(pricing.feeRules) ? pricing.feeRules : [];
    const seen = new Set();

    return {
        mode: String(pricing.mode || 'auto').trim().toLowerCase() === 'manual' ? 'manual' : 'auto',
        feeRules: feeRules.map((rule) => ({
            feeCategory: String(rule?.feeCategory || '').trim(),
            suggestedAmount: roundMoney(rule?.suggestedAmount),
            amount: roundMoney(rule?.amount),
            currency: String(rule?.currency || 'CAD').trim().toUpperCase() || 'CAD',
            transactionDefinitionId: String(rule?.transactionDefinitionId || '').trim(),
            transactionDefinitionCode: String(rule?.transactionDefinitionCode || rule?.code || '').trim().toUpperCase(),
            transactionDefinitionName: String(rule?.transactionDefinitionName || rule?.label || '').trim(),
            notes: String(rule?.notes || '').trim(),
            active: rule?.active !== false && String(rule?.active) !== 'false',
            manualOverride: rule?.manualOverride === true || String(rule?.manualOverride) === 'true'
        })).filter((rule) => {
            if (!isValidFeeCategory(rule.feeCategory, { includeAll: true })) return false;
            if (seen.has(rule.feeCategory)) return false;
            seen.add(rule.feeCategory);
            return true;
        })
    };
}

function buildEffectiveSubjectWeights(subjects) {
    const rows = Array.isArray(subjects) ? subjects : [];
    if (!rows.length) return [];

    const rawTotal = rows.reduce((sum, subject) => sum + Number(subject?.weight || 0), 0);
    if (rawTotal <= 0) {
        const evenWeight = Number((100 / rows.length).toFixed(2));
        return rows.map((subject, index) => ({
            subjectId: String(subject?.subjectId || '').trim(),
            weight: index === rows.length - 1
                ? Number((100 - evenWeight * (rows.length - 1)).toFixed(2))
                : evenWeight
        }));
    }

    let running = 0;
    return rows.map((subject, index) => {
        const normalized = index === rows.length - 1
            ? Number((100 - running).toFixed(2))
            : Number(((Number(subject?.weight || 0) / rawTotal) * 100).toFixed(2));
        running += normalized;
        return {
            subjectId: String(subject?.subjectId || '').trim(),
            weight: normalized
        };
    });
}

function selectSubjectFeeRuleForProposal(subject, feeCategory, effectiveDate) {
    const rules = Array.isArray(subject?.feeRules) ? subject.feeRules : [];
    const isActiveRule = (rule) => rule && rule.active !== false && String(rule.active) !== 'false';
    const isEffectiveRule = (rule) => {
        if (!isActiveRule(rule)) return false;
        const validFrom = String(rule.validFrom || '').trim();
        const validTo = String(rule.validTo || '').trim();
        if (validFrom && effectiveDate < validFrom) return false;
        if (validTo && effectiveDate > validTo) return false;
        return true;
    };
    const sortRules = (rows) => rows.sort((a, b) => String(b.validFrom || '').localeCompare(String(a.validFrom || '')));
    const normalizedCategory = String(feeCategory || '').trim();

    const specificEffective = sortRules(rules.filter((rule) => isEffectiveRule(rule) && String(rule.feeCategory || '').trim() === normalizedCategory));
    if (specificEffective[0]) return specificEffective[0];

    const fallbackEffective = sortRules(rules.filter((rule) => isEffectiveRule(rule) && String(rule.feeCategory || '').trim() === ALL_FEE_CATEGORIES_KEY));
    if (fallbackEffective[0]) return fallbackEffective[0];

    const specificActive = sortRules(rules.filter((rule) => isActiveRule(rule) && String(rule.feeCategory || '').trim() === normalizedCategory));
    if (specificActive[0]) return specificActive[0];

    const fallbackActive = sortRules(rules.filter((rule) => isActiveRule(rule) && String(rule.feeCategory || '').trim() === ALL_FEE_CATEGORIES_KEY));
    return fallbackActive[0] || null;
}

async function buildClassFeeProposal({ curriculumSubjects, reqUser, effectiveDate }) {
    const subjectCatalog = await schoolDataService.fetchData('subjects', {}, reqUser);
    const subjectMap = new Map(subjectCatalog.map((subject) => [String(subject.id || ''), subject]));
    const effectiveWeightMap = new Map(buildEffectiveSubjectWeights(curriculumSubjects).map((item) => [item.subjectId, item.weight]));
    const categories = getFeeCategories({ includeAll: true });

    const feeRules = categories.map((feeCategory) => {
        const breakdown = [];
        const warnings = [];
        let currency = 'CAD';
        let suggestedAmount = 0;

        curriculumSubjects.forEach((curriculumItem) => {
            const subjectId = String(curriculumItem?.subjectId || '').trim();
            if (!subjectId) return;
            const subject = subjectMap.get(subjectId);
            if (!subject) {
                warnings.push(`Subject ${subjectId} was not found and was excluded from pricing.`);
                return;
            }
            const matchedRule = selectSubjectFeeRuleForProposal(subject, feeCategory, effectiveDate);
            if (!matchedRule) {
                warnings.push(`No fee rule was found for ${subject.title || subjectId} in ${feeCategory === ALL_FEE_CATEGORIES_KEY ? ALL_FEE_CATEGORIES_LABEL : feeCategory}.`);
                return;
            }

            const lineCurrency = String(matchedRule.currency || currency || 'CAD').trim().toUpperCase() || 'CAD';
            if (breakdown.length === 0) currency = lineCurrency;
            if (lineCurrency !== currency) {
                warnings.push(`Skipped ${subject.title || subjectId} because its currency ${lineCurrency} does not match ${currency}.`);
                return;
            }

            const weight = normalizeWeight(effectiveWeightMap.get(subjectId));
            const baseAmount = roundMoney(matchedRule.amount);
            const amount = roundMoney(baseAmount * (weight / 100));
            suggestedAmount += amount;
            breakdown.push({
                subjectId,
                subjectCode: subject.code || curriculumItem.code || subjectId,
                subjectTitle: subject.title || curriculumItem.name || subjectId,
                weight,
                baseAmount,
                amount,
                currency
            });
        });

        return {
            feeCategory,
            suggestedAmount: roundMoney(suggestedAmount),
            amount: roundMoney(suggestedAmount),
            currency,
            notes: '',
            active: breakdown.length > 0,
            manualOverride: false,
            warnings,
            breakdown
        };
    });

    return { feeRules };
}

function selectClassFeeRule(classData, feeCategory) {
    const rules = Array.isArray(classData?.pricing?.feeRules) ? classData.pricing.feeRules : [];
    const normalizedCategory = String(feeCategory || '').trim();
    const activeRules = rules.filter((rule) => rule && rule.active !== false && String(rule.active) !== 'false');
    return activeRules.find((rule) => String(rule.feeCategory || '').trim() === normalizedCategory)
        || activeRules.find((rule) => String(rule.feeCategory || '').trim() === ALL_FEE_CATEGORIES_KEY)
        || null;
}

function sanitizeCurrency(value) {
    const code = String(value || 'CAD').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(code) ? code : null;
}

function normalizeAddedRows(rowsInput) {
    const rows = Array.isArray(rowsInput) ? rowsInput : [];
    return rows
        .map((row) => ({
            include: !(row?.include === false || String(row?.include || '').toLowerCase() === 'false' || String(row?.include || '') === '0'),
            debitAccountId: toPublicId(row?.debitAccountId || row?.debitAccount?.id || ''),
            creditAccountId: toPublicId(row?.creditAccountId || row?.creditAccount?.id || ''),
            amount: Number(row?.amount),
            currency: sanitizeCurrency(row?.currency || 'CAD'),
            memo: String(row?.memo || '').trim()
        }))
        .filter((row) => row.include);
}

async function buildPostableAccountMap(reqUser, activeOrgId) {
    const allowedOrgIds = new Set([toPublicId(activeOrgId), 'SYSTEM']);
    const rows = await schoolDataService.fetchData('schoolAccounts', {}, reqUser);
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((account) => {
        const accountId = toPublicId(account?.id);
        if (!accountId) return;
        if (!allowedOrgIds.has(toPublicId(account?.orgId))) return;
        if (!Boolean(account?.allowPost)) return;
        if (String(account?.status || '').toLowerCase() !== 'active') return;
        map.set(accountId, account);
    });
    return map;
}

function enrichEditedRowsWithAccountSnapshots(rowsInput, accountMap, labelPrefix = 'Draft row') {
    const rows = Array.isArray(rowsInput) ? rowsInput : [];
    return rows.map((row, index) => {
        const next = { ...(row || {}) };
        const debitAccountId = toPublicId(next?.debitAccountId || next?.debitAccount?.id || '');
        const creditAccountId = toPublicId(next?.creditAccountId || next?.creditAccount?.id || '');
        if (!debitAccountId && !creditAccountId) return next;

        if (debitAccountId && creditAccountId && debitAccountId === creditAccountId) {
            throw new Error(`${labelPrefix} #${index + 1} cannot use the same account for debit and credit.`);
        }

        if (debitAccountId) {
            const debitAccount = accountMap.get(debitAccountId);
            if (!debitAccount) throw new Error(`${labelPrefix} #${index + 1} debit account is invalid or not postable.`);
            next.debitAccount = {
                id: toPublicId(debitAccount.id),
                code: String(debitAccount.code || '').trim(),
                name: String(debitAccount.name || '').trim()
            };
        }

        if (creditAccountId) {
            const creditAccount = accountMap.get(creditAccountId);
            if (!creditAccount) throw new Error(`${labelPrefix} #${index + 1} credit account is invalid or not postable.`);
            next.creditAccount = {
                id: toPublicId(creditAccount.id),
                code: String(creditAccount.code || '').trim(),
                name: String(creditAccount.name || '').trim()
            };
        }

        return next;
    });
}

function buildManualClassEnrollmentAdjustmentPair({
    classData,
    student,
    feeCategory,
    debitAccount,
    creditAccount,
    amount,
    currency,
    memo,
    lineKey,
    startDate,
    externalReference,
    requestUser
}) {
    const nowIso = new Date().toISOString();
    const effectiveDate = String(startDate || '').trim() || nowIso.slice(0, 10);
    const orgId = toPublicId(classData?.orgId || '');
    const generatedBy = toPublicId(requestUser?.id) || String(requestUser?.username || 'system');
    const classId = toPublicId(classData?.id || '');
    const studentId = toPublicId(student?.id || '');

    const base = {
        orgId,
        status: 'posted',
        postedAt: nowIso,
        effectiveDate,
        transactionType: 'charge',
        party: {
            studentId,
            personId: toPublicId(student?.personId || ''),
            programId: toPublicId(classData?.programId || ''),
            feeCategory: String(feeCategory || '').trim()
        },
        fee: {
            category: String(feeCategory || '').trim(),
            code: 'CLASS_MANUAL_ADJUSTMENT',
            label: `Class Enrollment Manual Adjustment (${classId})`,
            frequency: 'one_time',
            isOptional: false
        },
        amount: {
            value: roundMoney(amount),
            currency
        },
        memo: memo || 'Manual class enrollment adjustment',
        externalReference: String(externalReference || '').trim(),
        internalNote: `Manual class enrollment adjustment (${classId})`,
        metadata: {
            sourceType: 'manual_class_enrollment_adjustment',
            classId,
            studentId,
            generatedBy,
            isManualAdjustment: true
        }
    };

    return [
        {
            ...base,
            source: {
                module: 'school_class_enrollment',
                eventType: 'class_enrollment_manual_adjustment',
                eventId: `CLSENRMAN-${classId}-${studentId}-${lineKey}-DR`,
                idempotencyKey: `CLSENRMAN|${classId}|${studentId}|${lineKey}|DR`
            },
            amount: {
                ...base.amount,
                direction: 'debit'
            },
            metadata: {
                ...base.metadata,
                ledgerSide: 'debit',
                accountId: toPublicId(debitAccount?.id || ''),
                accountCode: String(debitAccount?.code || '').trim(),
                accountName: String(debitAccount?.name || '').trim()
            }
        },
        {
            ...base,
            source: {
                module: 'school_class_enrollment',
                eventType: 'class_enrollment_manual_adjustment',
                eventId: `CLSENRMAN-${classId}-${studentId}-${lineKey}-CR`,
                idempotencyKey: `CLSENRMAN|${classId}|${studentId}|${lineKey}|CR`
            },
            amount: {
                ...base.amount,
                direction: 'credit'
            },
            metadata: {
                ...base.metadata,
                ledgerSide: 'credit',
                accountId: toPublicId(creditAccount?.id || ''),
                accountCode: String(creditAccount?.code || '').trim(),
                accountName: String(creditAccount?.name || '').trim()
            }
        }
    ];
}

function normalizeEnrollmentTransactionDraftState({
    draftTransactionItems = [],
    editedRows = [],
    addedRows = [],
    accountMap,
    classData,
    student,
    feeCategory,
    startDate,
    externalReference,
    requestUser
}) {
    const currentItems = programRegistrationDraftService.normalizeDraftTransactionItems(draftTransactionItems || []);
    if (!currentItems.length) {
        throw new Error('Transaction draft rows are missing. Rebuild the preview and try again.');
    }

    const enrichedEdits = enrichEditedRowsWithAccountSnapshots(editedRows, accountMap, 'Draft row');
    const edited = programRegistrationDraftService.applyDraftRowEditsToItems(currentItems, enrichedEdits);
    const parsedAddedRows = normalizeAddedRows(addedRows);

    const appendedManualItems = [];
    parsedAddedRows.forEach((row, index) => {
        if (!row.debitAccountId || !row.creditAccountId) {
            throw new Error(`Manual row #${index + 1} requires both debit and credit accounts.`);
        }
        if (row.debitAccountId === row.creditAccountId) {
            throw new Error(`Manual row #${index + 1} cannot use the same account for debit and credit.`);
        }
        if (!Number.isFinite(row.amount) || row.amount <= 0) {
            throw new Error(`Manual row #${index + 1} amount must be greater than zero.`);
        }
        if (!row.currency) {
            throw new Error(`Manual row #${index + 1} currency must be a valid ISO code (for example CAD).`);
        }

        const debitAccount = accountMap.get(row.debitAccountId);
        const creditAccount = accountMap.get(row.creditAccountId);
        if (!debitAccount) throw new Error(`Manual row #${index + 1} debit account is invalid or not postable.`);
        if (!creditAccount) throw new Error(`Manual row #${index + 1} credit account is invalid or not postable.`);

        const lineKey = `${Date.now()}-${index + 1}-${Math.floor(Math.random() * 1000)}`;
        appendedManualItems.push(...buildManualClassEnrollmentAdjustmentPair({
            classData,
            student,
            feeCategory,
            debitAccount,
            creditAccount,
            amount: row.amount,
            currency: row.currency,
            memo: row.memo,
            lineKey,
            startDate,
            externalReference,
            requestUser
        }));
    });

    const items = edited.items.concat(appendedManualItems);
    const previewRows = programRegistrationDraftService.buildDraftPreviewRowsFromItems(items);
    const totalAmount = roundMoney(previewRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    if (!items.length || !previewRows.length) {
        throw new Error('At least one valid transaction row is required for chargeable enrollment.');
    }

    return {
        items,
        previewRows,
        totalAmount
    };
}

async function buildClassEnrollmentTransactionDraft({
    classData,
    student,
    startDate,
    externalReference,
    reqUser,
    programIdForPosting = ''
}) {
    const billingMode = normalizeClassBillingMode(classData?.billingMode);
    if (billingMode === 'no_charge') {
        return {
            billingMode: 'no_charge',
            isChargeable: false,
            feeCategory: String(student?.feeCategory || '').trim() || '',
            draftTransactionItems: [],
            draftPreviewRows: [],
            totalAmount: 0
        };
    }

    const feeCategory = String(student?.feeCategory || '').trim();
    if (!feeCategory) {
        throw new Error('Student fee category is required for chargeable class enrollment.');
    }

    const classFeeRule = selectClassFeeRule(classData, feeCategory);
    if (!classFeeRule) {
        throw new Error(`No class fee rule matches student fee category "${feeCategory}".`);
    }

    const classFeeAmount = roundMoney(classFeeRule?.amount);
    if (!(classFeeAmount > 0)) {
        throw new Error(`Class fee for fee category "${feeCategory}" must be greater than zero for chargeable enrollment.`);
    }

    const inheritedPostingPolicy = resolveInheritedPostingPolicy({
        feeCategory,
        classItem: classData
    });
    const transactionDefinitionId = toPublicId(
        classFeeRule?.transactionDefinitionId || inheritedPostingPolicy?.transactionDefinitionId || ''
    );
    if (!transactionDefinitionId) {
        throw new Error(`Transaction template is missing for fee category "${feeCategory}".`);
    }

    const definition = await schoolDataService.getDataById('transactionTemplates', transactionDefinitionId, reqUser);
    if (!definition) {
        throw new Error(`Transaction template ${transactionDefinitionId} was not found.`);
    }
    if (String(definition?.status || '').trim().toLowerCase() !== 'active') {
        throw new Error(`Transaction template ${definition?.code || definition?.id} must be active.`);
    }

    const allowedOrgIds = new Set([toPublicId(classData?.orgId || ''), 'SYSTEM']);
    const allAccounts = await schoolDataService.fetchData('schoolAccounts', {}, reqUser);
    const postingAccounts = (Array.isArray(allAccounts) ? allAccounts : []).filter((account) => {
        if (!allowedOrgIds.has(toPublicId(account?.orgId))) return false;
        if (!Boolean(account?.allowPost)) return false;
        return String(account?.status || '').trim().toLowerCase() === 'active';
    });

    const previewRows = transactionDefinitionPreviewService.buildPreviewRows(
        definition,
        postingAccounts,
        classData?.orgId,
        {
            amount: classFeeAmount,
            studentAccountId: toPublicId(student?.studentAccountId || ''),
            studentId: toPublicId(student?.id || ''),
            personId: toPublicId(student?.personId || ''),
            feeCategory
        }
    );

    const items = transactionDefinitionPreviewService.buildPostingItemsFromPreview({
        definition,
        previewRows,
        orgId: classData?.orgId,
        requestBody: {
            studentId: toPublicId(student?.id || ''),
            personId: toPublicId(student?.personId || ''),
            programId: toPublicId(programIdForPosting || classData?.programId || ''),
            feeCategory,
            effectiveDate: String(startDate || '').trim(),
            externalReference: String(externalReference || '').trim(),
            sourceEventType: 'class_enrollment_fee',
            sourceEventId: `CLSENR-${toPublicId(classData?.id || '')}-${toPublicId(student?.id || '')}-${Date.now()}`,
            idempotencyKey: `CLSENR|${toPublicId(classData?.id || '')}|${toPublicId(student?.id || '')}|${String(startDate || '').trim()}|${toPublicId(programIdForPosting || '')}`
        },
        reqUser
    });

    const draftTransactionItems = programRegistrationDraftService.normalizeDraftTransactionItems(items);
    const draftPreviewRows = programRegistrationDraftService.buildDraftPreviewRowsFromItems(draftTransactionItems);
    const totalAmount = roundMoney(draftPreviewRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));

    if (!draftTransactionItems.length || !draftPreviewRows.length) {
        throw new Error('No transaction rows were generated for this chargeable class enrollment.');
    }

    return {
        billingMode,
        isChargeable: true,
        feeCategory,
        classFeeRule: {
            feeCategory: String(classFeeRule?.feeCategory || '').trim(),
            amount: classFeeAmount,
            currency: String(classFeeRule?.currency || 'CAD').trim().toUpperCase() || 'CAD',
            transactionDefinitionId,
            transactionDefinitionCode: String(definition?.code || '').trim().toUpperCase(),
            transactionDefinitionName: String(definition?.name || definition?.id || '').trim()
        },
        draftTransactionItems,
        draftPreviewRows,
        totalAmount
    };
}

function cleanPersonId(id) {
    return toPublicId(id);
}

/**
 * Add roster rows for any personId present in saved gradebook scores so the session manager
 * can show gradebooks (and attendance rows) when enrollment produced an empty roster.
 * If allowedPersonIds is provided, gradebook-only rows outside this set are ignored.
 */
function mergeGradebookScorePersonsIntoEnrichedRoster(enrichedRoster, session, persons, options = {}) {
    if (!Array.isArray(enrichedRoster)) return;
    const allowedPersonIds = options?.allowedPersonIds instanceof Set ? options.allowedPersonIds : null;
    const seen = new Set(enrichedRoster.map((r) => String(cleanPersonId(r.personId))));
    const idsFromGb = new Set();
    (session.gradebooks || []).forEach((gb) => {
        if (!gb || !gb.scores || typeof gb.scores !== 'object') return;
        Object.keys(gb.scores).forEach((k) => {
            const pid = cleanPersonId(k);
            if (pid) idsFromGb.add(pid);
        });
    });
    idsFromGb.forEach((pid) => {
        if (allowedPersonIds && !allowedPersonIds.has(String(pid))) return;
        if (seen.has(String(pid))) return;
        seen.add(String(pid));
        const person = persons.find((p) => idsEqual(p.id, pid));
        const displayName = person ? `${person.name?.first || ''} ${person.name?.last || ''}`.trim() : 'Unknown Student';
        enrichedRoster.push({
            personId: pid,
            attendance: 'absent',
            notes: '',
            comments: [],
            name: displayName
        });
    });
}

async function getSessionStatusMetaForOrg(orgId) {
    const definitions = await sessionStatusPolicyService.getStatusDefinitions(orgId, { includeInactive: true });
    return sessionStatusPolicyService.buildClientStatusMeta(definitions);
}

function getActiveSessionStatusMeta(statusMeta = []) {
    const rows = (Array.isArray(statusMeta) ? statusMeta : []).filter((row) => row?.active !== false);
    return rows.length ? rows : (Array.isArray(statusMeta) ? statusMeta : []);
}

function resolveDefaultSessionStatusCode(statusMeta = []) {
    const activeRows = getActiveSessionStatusMeta(statusMeta);
    if (!activeRows.length) return 'scheduled';
    const scheduled = activeRows.find((row) => row.code === 'scheduled');
    if (scheduled) return 'scheduled';
    return String(activeRows[0].code || 'scheduled');
}

function getActiveOrgIdOrThrow(reqUser) {
    return getActiveOrgIdOrThrowShared(reqUser);
}

async function assertCreateOrgContextOrThrow(reqUser) {
    return assertCreateOrgContextOrThrowShared(reqUser, { scopeLabel: 'classes' });
}

function assertClassOrgAccess(classData, activeOrgId, reqUser) {
    assertOrgAccess(classData, activeOrgId, reqUser, { orgField: 'orgId', allowSystemBypass: true });
}

async function getClassByIdWithOrgCheck(classId, reqUser) {
    const activeOrgId = getActiveOrgIdOrThrow(reqUser);
    const classData = await schoolDataService.getDataById('classes', classId, reqUser);
    if (!classData) throw new Error('Class not found');
    assertClassOrgAccess(classData, activeOrgId, reqUser);
    return { classData, activeOrgId };
}

function normalizeDateOnlyValue(value) {
    const token = String(value || '').trim();
    if (!token) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
    const parsed = new Date(token);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
}

function isActivePeriodOnDate(row, referenceDate = '') {
    const status = String(row?.status || '').trim().toLowerCase();
    if (!['active', 'planned'].includes(status)) return false;
    const day = normalizeDateOnlyValue(referenceDate) || new Date().toISOString().slice(0, 10);
    const start = normalizeDateOnlyValue(row?.startDate);
    const end = normalizeDateOnlyValue(row?.endDate);
    // For session/attendance visibility we require period start <= reference day
    // for both active and planned states.
    if (start && start > day) return false;
    if (end && end < day) return false;
    return true;
}

function normalizeClockTime(value) {
    const token = String(value || '').trim();
    if (!token) return '';
    const match = token.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return '';
    const hh = String(Math.max(0, Math.min(23, Number(match[1] || 0)))).padStart(2, '0');
    const mm = String(Math.max(0, Math.min(59, Number(match[2] || 0)))).padStart(2, '0');
    return `${hh}:${mm}`;
}

function toContentSortKey(item = {}, fallback = '') {
    const type = String(item?.type || '').trim().toLowerCase();
    const time = normalizeClockTime(item?.time || '');
    if (time) return `${time}__${type}__${fallback}`;
    return `99:99__${type}__${fallback}`;
}

function normalizeSessionContentItems(raw = []) {
    const rows = Array.isArray(raw) ? raw : [];
    const out = [];
    const used = new Set();
    rows.forEach((row, index) => {
        if (!row || typeof row !== 'object') return;
        const type = String(row.type || '').trim().toLowerCase();
        if (!['html', 'file'].includes(type)) return;
        const title = String(row.title || '').trim() || (type === 'html' ? 'HTML Content' : 'File Content');
        const idRaw = String(row.id || '').trim() || `CNT_${Date.now()}_${index}`;
        const id = used.has(idRaw) ? `${idRaw}_${index}` : idRaw;
        used.add(id);
        out.push({
            id,
            type,
            title: title.slice(0, 200),
            time: normalizeClockTime(row.time || ''),
            html: type === 'html' ? String(row.html || '').trim().slice(0, 120000) : '',
            fileUrl: type === 'file' ? String(row.fileUrl || '').trim().slice(0, 2000) : '',
            notes: String(row.notes || '').trim().slice(0, 2000)
        });
    });
    return out;
}

function normalizeSessionContentOrder(raw = []) {
    return Array.from(new Set((Array.isArray(raw) ? raw : [])
        .map((row) => String(row || '').trim())
        .filter(Boolean)));
}

function resolveSessionExamLinkByDateTime(allocation = {}, session = {}) {
    const sessionDate = normalizeDateOnlyValue(session?.date);
    const sessionStart = normalizeClockTime(session?.startTime);
    const sourceDate = normalizeDateOnlyValue(
        allocation?.extensions?.sourceSession?.sessionDate
        || allocation?.windowStartLocalDate
        || allocation?.scheduling?.windowStartLocalDate
    );
    const sourceStart = normalizeClockTime(
        allocation?.extensions?.sourceSession?.startTime
        || allocation?.windowStartLocalTime
        || allocation?.scheduling?.windowStartLocalTime
    );
    if (!sessionDate || !sourceDate || sessionDate !== sourceDate) return false;
    if (!sessionStart || !sourceStart) return true;
    return sessionStart === sourceStart;
}

function sortSessionContentItemsByOrder(items = [], order = []) {
    const orderMap = new Map((Array.isArray(order) ? order : []).map((id, index) => [String(id || '').trim(), index]));
    return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
        const aId = String(a?.id || '').trim();
        const bId = String(b?.id || '').trim();
        const aOrder = orderMap.has(aId) ? orderMap.get(aId) : Number.MAX_SAFE_INTEGER;
        const bOrder = orderMap.has(bId) ? orderMap.get(bId) : Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return toContentSortKey(a, aId).localeCompare(toContentSortKey(b, bId));
    });
}

async function resolveSessionRosterPersonIds({ classData, session, reqUser, students = [] } = {}) {
    const activeOrgId = String(reqUser?.activeOrgId || classData?.orgId || '').trim();
    const sessionDate = normalizeDateOnlyValue(session?.date);
    const studentRows = Array.isArray(students) ? students : [];
    const studentToPersonMap = new Map(
        studentRows
            .map((row) => [toPublicId(row?.id), cleanPersonId(row?.personId)])
            .filter(([studentId, personId]) => Boolean(studentId && personId))
    );
    const enrollmentSnapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
        classId: classData?.id,
        classItem: classData,
        reqUser,
        activeOrgId,
        sessionDates: sessionDate ? [sessionDate] : [],
        startDate: sessionDate,
        endDate: sessionDate,
        canonicalStatuses: ['active']
    });

    const snapshotIds = enrollmentSnapshot?.studentIds instanceof Set
        ? enrollmentSnapshot.studentIds
        : new Set();
    const personIds = new Set();
    snapshotIds.forEach((id) => {
        const sid = toPublicId(id);
        if (!sid) return;
        const pid = cleanPersonId(studentToPersonMap.get(sid));
        if (pid) personIds.add(pid);
    });

    return {
        personIds,
        source: String(enrollmentSnapshot?.source || 'canonical')
    };
}

async function buildClassEnrollmentPeriodMetrics(reqUser, classIds = []) {
    const idSet = new Set((Array.isArray(classIds) ? classIds : []).map((id) => toPublicId(id)).filter(Boolean));
    const rows = await schoolDataService.getAccessibleClassEnrollmentPeriods(reqUser);
    const periodRows = Array.isArray(rows) ? rows : [];
    const today = new Date().toISOString().slice(0, 10);
    const map = new Map();

    periodRows.forEach((row) => {
        const classId = toPublicId(row?.classId);
        if (!classId) return;
        if (idSet.size && !idSet.has(classId)) return;
        const status = String(row?.status || '').trim().toLowerCase();
        const metrics = map.get(classId) || { openPeriodCount: 0, activePeriodCount: 0, totalPeriodCount: 0 };
        metrics.totalPeriodCount += 1;
        if (['draft', 'planned', 'active'].includes(status)) metrics.openPeriodCount += 1;
        if (isActivePeriodOnDate(row, today)) metrics.activePeriodCount += 1;
        map.set(classId, metrics);
    });

    return map;
}

async function buildClassLifecycleContext(classData, reqUser) {
    const classId = toPublicId(classData?.id);
    const metricsMap = await buildClassEnrollmentPeriodMetrics(reqUser, [classId]);
    const metrics = metricsMap.get(classId) || { openPeriodCount: 0, activePeriodCount: 0, totalPeriodCount: 0 };

    let previousClass = null;
    let nextClass = null;
    const previousClassId = toPublicId(classData?.previousClassId);
    const nextClassId = toPublicId(classData?.nextClassId);

    if (previousClassId) {
        try {
            previousClass = await schoolDataService.getDataById('classes', previousClassId, reqUser);
        } catch (_) { /* ignore */ }
    }
    if (nextClassId) {
        try {
            nextClass = await schoolDataService.getDataById('classes', nextClassId, reqUser);
        } catch (_) { /* ignore */ }
    }

    return {
        isRolling: String(classData?.registrationMode || '').trim().toLowerCase() === 'rolling',
        activePeriodCount: Number(metrics.activePeriodCount || 0),
        openPeriodCount: Number(metrics.openPeriodCount || 0),
        totalPeriodCount: Number(metrics.totalPeriodCount || 0),
        previousClass: previousClass ? { id: toPublicId(previousClass.id), title: String(previousClass.title || previousClass.id || '').trim() } : null,
        nextClass: nextClass ? { id: toPublicId(nextClass.id), title: String(nextClass.title || nextClass.id || '').trim() } : null
    };
}

function normalizeIncomingSessions(rawSessions = []) {
    const sessions = Array.isArray(rawSessions) ? rawSessions : [];
    return sessions.map((session) => {
        const normalized = session && typeof session === 'object' ? { ...session } : {};
        if (!normalized.delivery || typeof normalized.delivery !== 'object') normalized.delivery = {};
        const resolvedDeliveredBy = cleanPersonId(
            normalized.delivery?.deliveredBy
            || normalized.deliveredBy
            || normalized.teacherId
            || normalized.instructorId
        );
        if (resolvedDeliveredBy) {
            normalized.delivery.deliveredBy = resolvedDeliveredBy;
        }
        const resolvedDeliveredByName = String(
            normalized.delivery?.deliveredByName
            || normalized.deliveredByName
            || normalized.teacherName
            || normalized.instructorName
            || normalized.delivery?.deliveredBy
            || ''
        ).trim();
        if (resolvedDeliveredByName) {
            normalized.delivery.deliveredByName = resolvedDeliveredByName;
        }
        if (Array.isArray(normalized.roster)) {
            normalized.roster = normalized.roster.map((row) => ({ ...row, personId: cleanPersonId(row?.personId) }));
        }
        return normalized;
    });
}

function resolveSessionTeacherId(sessionRow = {}, fallbackTeacherId = '') {
    return cleanPersonId(
        sessionRow?.delivery?.deliveredBy
        || sessionRow?.deliveredBy
        || sessionRow?.teacherId
        || sessionRow?.instructorId
        || fallbackTeacherId
    );
}

function resolveFallbackTeacherIdFromBody(body = {}) {
    const fromBody = cleanPersonId(body?.defaultTeacherId || body?.primaryTeacherId || body?.instructorId);
    if (fromBody) return fromBody;
    const parsedInstructors = parseData(body?.instructors);
    if (Array.isArray(parsedInstructors) && parsedInstructors.length) {
        const firstInstructorId = cleanPersonId(parsedInstructors[0]?.personId);
        if (firstInstructorId) return firstInstructorId;
    }
    return '';
}

async function detectSessionConflicts({ classId = '', sessions = [], activeOrgId = '', reqUser, fallbackTeacherId = '' }) {
    const parsedSessions = Array.isArray(sessions) ? sessions : [];
    const statusMap = await sessionStatusPolicyService.getStatusMap(activeOrgId, { includeInactive: true });
    const allClasses = await schoolDataService.fetchData('classes', {}, reqUser);
    const scopedClasses = (Array.isArray(allClasses) ? allClasses : []).filter((row) => {
        if (!activeOrgId) return true;
        return idsEqual(row?.orgId, activeOrgId);
    });
    const classIdTitleMap = new Map(
        scopedClasses.map((row) => [toPublicId(row?.id), String(row?.title || row?.id || '').trim()])
    );
    const classSessionsBundle = await Promise.all(
        scopedClasses.map(async (row) => ({
            classId: toPublicId(row?.id),
            sessions: await schoolDataService.getClassSessions(row?.id, reqUser)
        }))
    );
    const teacherDayMap = new Map();
    classSessionsBundle.forEach((bundle) => {
        const sourceClassId = String(bundle?.classId || '').trim();
        const sourceClassRow = scopedClasses.find((row) => idsEqual(row?.id, sourceClassId));
        const classFallbackTeacherId = cleanPersonId(sourceClassRow?.instructors?.[0]?.personId);
        const sessionRows = Array.isArray(bundle?.sessions) ? bundle.sessions : [];
        sessionRows.forEach((sessionRow) => {
            if (sessionStatusPolicyService.shouldExcludeFromTeacherIndexByMap(statusMap, {
                status: sessionRow?.status,
                notes: sessionRow?.notes
            })) return;
            const tid = resolveSessionTeacherId(sessionRow, classFallbackTeacherId);
            const date = String(sessionRow?.date || '').trim();
            const startTime = String(sessionRow?.startTime || '').trim();
            const endTime = String(sessionRow?.endTime || '').trim();
            if (!tid || !date || !startTime || !endTime) return;
            const key = `${tid}::${date}`;
            if (!teacherDayMap.has(key)) teacherDayMap.set(key, []);
            teacherDayMap.get(key).push({
                classId: sourceClassId,
                startTime,
                endTime
            });
        });
    });
    const conflicts = [];

    const normalizedSessions = parsedSessions.map((session, index) => ({
        ...session,
        _rowIndex: index,
        resolvedPersonId: resolveSessionTeacherId(session, fallbackTeacherId)
    }));

    normalizedSessions.forEach((ses, index) => {
        if (sessionStatusPolicyService.shouldExcludeFromTeacherIndexByMap(statusMap, {
            status: ses?.status,
            notes: ses?.notes
        })) return;

        const tid = ses.resolvedPersonId;
        if (!tid || !ses.date || !ses.startTime || !ses.endTime) return;

        const newStart = new Date(`${ses.date}T${ses.startTime}`);
        const newEnd = new Date(`${ses.date}T${ses.endTime}`);
        if (Number.isNaN(newStart.getTime()) || Number.isNaN(newEnd.getTime())) return;

        const teacherDay = teacherDayMap.get(`${tid}::${ses.date}`) || [];
        teacherDay.forEach((existingSes) => {
            if (classId && idsEqual(existingSes.classId, classId)) return;

            const existStart = new Date(`${ses.date}T${existingSes.startTime}`);
            const existEnd = new Date(`${ses.date}T${existingSes.endTime}`);
            if (Number.isNaN(existStart.getTime()) || Number.isNaN(existEnd.getTime())) return;

            if (newStart < existEnd && newEnd > existStart) {
                const conflictClassTitle = classIdTitleMap.get(toPublicId(existingSes.classId)) || existingSes.classId;
                conflicts.push({
                    sessionIndex: index,
                    date: ses.date,
                    teacherName: ses?.delivery?.deliveredByName || tid,
                    conflictClass: conflictClassTitle,
                    existTime: `${existingSes.startTime} - ${existingSes.endTime}`
                });
            }
        });

        for (let j = 0; j < normalizedSessions.length; j++) {
            if (index === j) continue;
            const otherSes = normalizedSessions[j];

            if (sessionStatusPolicyService.shouldExcludeFromTeacherIndexByMap(statusMap, {
                status: otherSes?.status,
                notes: otherSes?.notes
            })) continue;
            if (otherSes.resolvedPersonId !== tid || otherSes.date !== ses.date) continue;
            if (!otherSes.startTime || !otherSes.endTime) continue;

            const otherStart = new Date(`${otherSes.date}T${otherSes.startTime}`);
            const otherEnd = new Date(`${otherSes.date}T${otherSes.endTime}`);
            if (Number.isNaN(otherStart.getTime()) || Number.isNaN(otherEnd.getTime())) continue;

            if (newStart < otherEnd && newEnd > otherStart) {
                conflicts.push({
                    sessionIndex: index,
                    date: ses.date,
                    teacherName: ses?.delivery?.deliveredByName || tid,
                    conflictClass: 'Another unsaved session in this list',
                    existTime: `${otherSes.startTime} - ${otherSes.endTime}`
                });
            }
        }
    });

    return conflicts;
}

function buildConflictBlockingMessage(conflicts = []) {
    if (!Array.isArray(conflicts) || !conflicts.length) return '';
    const lines = conflicts.slice(0, 5).map((c) =>
        `${c.date}: ${c.teacherName} overlaps ${c.conflictClass} (${c.existTime})`
    );
    const suffix = conflicts.length > 5 ? ` (+${conflicts.length - 5} more)` : '';
    return `Scheduling conflicts detected. Resolve the session overlaps before saving. ${lines.join(' | ')}${suffix}`;
}

function collectRollingSessionDateViolations({
    registrationMode = 'term_based',
    cycleStartDate = '',
    cycleEndDate = '',
    sessions = []
} = {}) {
    const mode = String(registrationMode || '').trim().toLowerCase();
    if (mode !== 'rolling') return [];

    const normalizedStart = normalizeDateOnlyValue(cycleStartDate);
    const normalizedEnd = normalizeDateOnlyValue(cycleEndDate);
    const rows = Array.isArray(sessions) ? sessions : [];
    const violations = [];

    if (!normalizedStart) {
        violations.push({
            type: 'missing_cycle_start',
            message: 'Cycle Start Date is required for rolling classes before generating/saving sessions.'
        });
        return violations;
    }

    rows.forEach((row, index) => {
        const dateToken = String(row?.date || '').trim();
        if (!dateToken) return;
        const normalizedDate = normalizeDateOnlyValue(dateToken);
        if (!normalizedDate) {
            violations.push({
                type: 'invalid_session_date',
                index,
                date: dateToken,
                sessionId: String(row?.sessionId || '').trim()
            });
            return;
        }
        if (normalizedDate < normalizedStart || (normalizedEnd && normalizedDate > normalizedEnd)) {
            violations.push({
                type: 'out_of_cycle_window',
                index,
                date: normalizedDate,
                sessionId: String(row?.sessionId || '').trim()
            });
        }
    });

    return violations;
}

function assertRollingSessionsWithinCycleWindowOrThrow(input = {}) {
    const violations = collectRollingSessionDateViolations(input);
    if (!violations.length) return;

    const missingCycleStart = violations.find((row) => row.type === 'missing_cycle_start');
    if (missingCycleStart) {
        throw new Error(String(missingCycleStart.message || 'Cycle Start Date is required for rolling classes.'));
    }

    const invalidDateCount = violations.filter((row) => row.type === 'invalid_session_date').length;
    const outsideRows = violations.filter((row) => row.type === 'out_of_cycle_window');
    const outsideSample = outsideRows.slice(0, 5).map((row) => {
        const sid = String(row?.sessionId || '').trim();
        return sid ? `${row.date} (${sid})` : row.date;
    }).join(', ');
    const outsideSuffix = outsideRows.length > 5 ? ` (+${outsideRows.length - 5} more)` : '';
    const parts = [
        `Rolling class sessions must stay within cycle dates.`
    ];
    if (invalidDateCount > 0) {
        parts.push(`${invalidDateCount} session(s) have invalid date format.`);
    }
    if (outsideRows.length > 0) {
        parts.push(`Out-of-window session date(s): ${outsideSample}${outsideSuffix}.`);
    }
    throw new Error(parts.join(' '));
}

function buildClassFromBody(body, reqUserId, isNew = false, activeOrgId = '', existingRecord = null) {
  const now = new Date().toISOString();
  const curriculum = normalizeCurriculum(parseData(body.curriculum) || { subjects: [], totalHours: 0 });
  const pricing = normalizeClassPricing(parseData(body.pricing) || { feeRules: [] });
  const billingMode = normalizeClassBillingMode(body.billingMode);
  const postingTemplates = normalizePostingPolicyRows(parseData(body.postingTemplates) || []);
  const schedule = parseData(body.schedule) || { current: {}, history: [] };
  const instructors = parseData(body.instructors) || [];
  const enrollment = parseData(body.enrollment) || { maxCapacity: 30, students: [] };
  const allowedProgramTerms = parseData(body.allowedProgramTerms) || [];
  const deliveryDepartmentId = String(body.deliveryDepartmentId || '').trim();
  const deliveryDepartmentName = String(body.deliveryDepartmentName || '').trim();
  const hasBodyField = (field) => Object.prototype.hasOwnProperty.call(body || {}, field);
  const fromBodyOrExisting = (field, fallback = '') => {
      if (hasBodyField(field)) return body[field];
      if (existingRecord && Object.prototype.hasOwnProperty.call(existingRecord, field)) return existingRecord[field];
      return fallback;
  };
  const registrationMode = normalizeClassRegistrationMode(fromBodyOrExisting('registrationMode', 'term_based'), existingRecord?.registrationMode || 'term_based');
  const evaluation = normalizeEvaluationForRegistrationMode(
      parseData(body.evaluation) || { passingScore: 60, weights: {} },
      registrationMode
  );
  const cycleGroupId = String(fromBodyOrExisting('cycleGroupId', '') || '').trim();
  const cycleStartDate = normalizeDateOnlyOrEmpty(fromBodyOrExisting('cycleStartDate', ''));
  const cycleEndDate = normalizeDateOnlyOrEmpty(fromBodyOrExisting('cycleEndDate', ''));
  if (cycleStartDate && cycleEndDate && cycleEndDate < cycleStartDate) {
    throw new Error('Cycle end date cannot be before cycle start date.');
  }
  const rawIsClosedForNewEnrollment = fromBodyOrExisting('isClosedForNewEnrollment', false);
  const isClosedForNewEnrollment = rawIsClosedForNewEnrollment === true || String(rawIsClosedForNewEnrollment).trim().toLowerCase() === 'true';
  const previousClassId = String(fromBodyOrExisting('previousClassId', '') || '').trim();
  const nextClassId = String(fromBodyOrExisting('nextClassId', '') || '').trim();
  const parsedCycleNo = Number.parseInt(String(fromBodyOrExisting('cycleNo', existingRecord?.cycleNo || '') || '').trim(), 10);
  const cycleNo = Number.isFinite(parsedCycleNo) && parsedCycleNo > 0 ? parsedCycleNo : 1;

  if (isNew && Array.isArray(instructors)) {
      instructors.forEach(inst => { inst.status = 'active'; inst.assignedAt = now; inst.unassignedAt = null; });
  }

  return {
    orgId: String(activeOrgId || '').trim(),
    deliveryDepartmentId,
    deliveryDepartmentName,
    title: (body.title || '').trim(),
    status: (body.status || 'active'),
    registrationMode,
    cycleGroupId,
    cycleStartDate,
    cycleEndDate,
    isClosedForNewEnrollment,
    previousClassId,
    nextClassId,
    cycleNo,
    billingMode,
    credits: normalizeCredits(body.credits),
    allowedProgramTerms,
    statusHistory: isNew ? [{ status: (body.status || 'active'), date: now, updatedBy: reqUserId, reason: 'Initial creation' }] : [],
    curriculum, pricing, postingTemplates, schedule, instructors, enrollment, evaluation,
    audit: { lastUpdateUser: reqUserId, lastUpdateDateTime: now }
  };
}

function validateChargeablePostingTemplatesOrThrow(rowsInput) {
    const rows = Array.isArray(rowsInput) ? rowsInput : [];
    if (!rows.length) {
        throw new Error('At least one Posting Policy is required when Class Billing Mode is Chargeable.');
    }
    const allRow = rows.find((row) => String(row?.feeCategory || '').trim() === ALL_FEE_CATEGORIES_KEY);
    if (!allRow) {
        throw new Error('Missing All Categories Posting Policy. Add it as the fallback for Chargeable classes.');
    }
    const missingTemplate = rows.find((row) => !String(row?.transactionDefinitionId || '').trim());
    if (missingTemplate) {
        const category = String(missingTemplate?.feeCategory || ALL_FEE_CATEGORIES_LABEL).trim() || ALL_FEE_CATEGORIES_LABEL;
        throw new Error(`Posting Policy for ${category} requires a Transaction Template.`);
    }
}

async function resolveAllowedProgramTermsOrThrow(rows, activeOrgId, reqUser, options = {}) {
    const requestedRows = Array.isArray(rows) ? rows : [];
    if (!requestedRows.length) return [];

    const registrationMode = String(options.registrationMode || 'term_based').trim().toLowerCase();
    const allowProgramOnlyRows = registrationMode === 'rolling';

    const [programs, terms] = await Promise.all([
        schoolDataService.fetchData('programs', {}, reqUser),
        schoolDataService.fetchData('terms', {}, reqUser)
    ]);

    const programMap = new Map(programs.map((program) => [toPublicId(program.id), program]));
    const termMap = new Map(terms.map((term) => [toPublicId(term.id), term]));
    const pairSet = new Set();

    return requestedRows.map((row, index) => {
        const programId = toPublicId(row?.programId);
        const termId = toPublicId(row?.termId);
        if (!programId) throw new Error('Each program row requires a selected program.');
        if (!termId && !allowProgramOnlyRows) {
            throw new Error('Each class eligibility row requires both program and term for term-based classes.');
        }

        const pairKey = termId ? `${programId}::${termId}` : `${programId}::__program_only__`;
        if (pairSet.has(pairKey)) throw new Error(`Duplicate class eligibility pair detected: ${programId} / ${termId || '(program only)'}`);
        pairSet.add(pairKey);

        const program = programMap.get(programId);
        if (!program) throw new Error(`Selected program ${programId} is not accessible.`);
        if (!idsEqual(program.orgId, activeOrgId)) {
            throw new Error(`Selected program ${programId} belongs to another organization.`);
        }

        if (!termId) {
            return {
                programId,
                termId: '',
                order: Number(row?.order || (index + 1)),
                programCode: String(program.code || row?.programCode || '').trim().toUpperCase(),
                programName: String(program.name || row?.programName || programId).trim(),
                termCode: String(row?.termCode || '').trim().toUpperCase(),
                termName: String(row?.termName || '').trim(),
                notes: String(row?.notes || '').trim()
            };
        }

        const term = termMap.get(termId);
        if (!term) throw new Error(`Selected term ${termId} is not accessible.`);
        if (!idsEqual(term.orgId, activeOrgId)) {
            throw new Error(`Selected term ${termId} belongs to another organization.`);
        }

        const allowedOnProgram = Array.isArray(program.terms)
            ? program.terms.find((entry) => idsEqual(entry?.termId, termId))
            : null;
        if (!allowedOnProgram) {
            throw new Error(`Term ${termId} is not assigned to program ${program.name || programId}.`);
        }

        return {
            programId,
            termId,
            order: Number(row?.order || (index + 1)),
            programCode: String(program.code || row?.programCode || '').trim().toUpperCase(),
            programName: String(program.name || row?.programName || programId).trim(),
            termCode: String(allowedOnProgram.termCode || term.code || row?.termCode || '').trim().toUpperCase(),
            termName: String(allowedOnProgram.termName || term.name || row?.termName || termId).trim(),
            notes: String(row?.notes || '').trim()
        };
    }).sort((a, b) => a.order - b.order).map((item, index) => ({ ...item, order: index + 1 }));
}

function assertRollingClassHasAllowedProgramOrThrow(classPayload) {
    const mode = String(classPayload?.registrationMode || '').trim().toLowerCase();
    if (mode !== 'rolling') return;
    const rows = Array.isArray(classPayload?.allowedProgramTerms) ? classPayload.allowedProgramTerms : [];
    const hasProgram = rows.some((r) => toPublicId(r?.programId));
    if (!hasProgram) {
        throw new Error('Rolling classes require at least one program on the Program Terms tab. Add a program without a term, or a full program–term pair. This is required for academic ledger and enrollment defaults.');
    }
}

async function resolveDeliveryDepartmentFromBody(body, reqUser) {
    const deliveryDepartmentId = String(body.deliveryDepartmentId || '').trim();
    if (!deliveryDepartmentId) throw new Error('Delivery Department is required.');

    const dept = await schoolDataService.getDataById('departments', deliveryDepartmentId, reqUser);
    if (!dept) throw new Error('Selected Delivery Department was not found.');

    return {
        deliveryDepartmentId: toPublicId(dept.id),
        deliveryDepartmentName: `${dept.code || ''} ${dept.name || ''}`.trim() || toPublicId(dept.id)
    };
}

async function listClasses(req, res) {
  try {
    let query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if(query.q===searchDefaultKeyword) query={};
    const canCreateClasses = await canCreateOrgScopedItem(req.user, { scopeLabel: 'classes' });

    const classes = await schoolDataService.fetchData('classes', query, req.user);
    const orgs = await dataService.fetchData('organizations', {}, req.user);
    const classIds = (Array.isArray(classes) ? classes : []).map((row) => toPublicId(row?.id)).filter(Boolean);
    const periodMetricsMap = await buildClassEnrollmentPeriodMetrics(req.user, classIds);
    const searchableFields = await inferSearchableFields(classes, { exclude: ['audit', 'attachments'] });
    const classTitleMap = new Map((Array.isArray(classes) ? classes : []).map((row) => [toPublicId(row?.id), String(row?.title || '').trim()]));

    const enriched = classes.map(c => {
        const org = orgs.find((o) => idsEqual(o.id, c.orgId));
        const classId = toPublicId(c?.id);
        const metrics = periodMetricsMap.get(classId) || { activePeriodCount: 0, openPeriodCount: 0 };
        const previousClassId = toPublicId(c?.previousClassId);
        const nextClassId = toPublicId(c?.nextClassId);
        return {
            ...c,
            orgName: org ? org.identity?.displayName || org.name : `Unknown Org (#${c.orgId})`,
            activePeriodCount: Number(metrics.activePeriodCount || 0),
            openPeriodCount: Number(metrics.openPeriodCount || 0),
            previousClassTitle: previousClassId ? (classTitleMap.get(previousClassId) || previousClassId) : '',
            nextClassTitle: nextClassId ? (classTitleMap.get(nextClassId) || nextClassId) : ''
        };
    });

    const { data, pagination } = paginate(enriched, req.query.page, req.query.limit);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/class/classes', {
      title: 'Class Management', 
      tableName: 'Classes_Management',
      data, searchableFields, 
      newUrl: 'school/classes', 
      newLabel: canCreateClasses ? 'Add Class' : null,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: true,
      print: true,
      pagination,
      filters: req.query,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

async function showAddForm(req, res) {
  try {
    await assertCreateOrgContextOrThrow(req.user);
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const subjects = await schoolDataService.fetchData('subjects', {}, req.user);
    const sessionStatusMeta = await getSessionStatusMetaForOrg(activeOrgId);
    const subjectFeeCatalog = subjects.map((subject) => ({
      id: String(subject.id || ''),
      code: String(subject.code || '').trim(),
      title: String(subject.title || '').trim(),
      credits: normalizeCredits(subject?.configuration?.credits),
      feeRules: Array.isArray(subject.feeRules) ? subject.feeRules : []
    }));
    res.render('school/class/classForm', {
      title: 'Add Class', classData: null, includeModal: true, user: req.user,
      lifecycleContext: {},
      feeCategories: getFeeCategories({ includeAll: false }),
      allFeeCategoryKey: ALL_FEE_CATEGORIES_KEY,
      allFeeCategoryLabel: ALL_FEE_CATEGORIES_LABEL,
      sessionStatusMeta,
      defaultSessionStatusCode: resolveDefaultSessionStatusCode(sessionStatusMeta),
      subjectFeeCatalog,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

async function showAddWizardForm(req, res) {
  try {
    await assertCreateOrgContextOrThrow(req.user);
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const subjects = await schoolDataService.fetchData('subjects', {}, req.user);
    const sessionStatusMeta = await getSessionStatusMetaForOrg(activeOrgId);
    const subjectFeeCatalog = subjects.map((subject) => ({
      id: String(subject.id || ''),
      code: String(subject.code || '').trim(),
      title: String(subject.title || '').trim(),
      credits: normalizeCredits(subject?.configuration?.credits),
      feeRules: Array.isArray(subject.feeRules) ? subject.feeRules : []
    }));
    res.render('school/class/classWizardForm', {
      title: 'Class Setup Wizard',
      classData: null,
      includeModal: true,
      user: req.user,
      feeCategories: getFeeCategories({ includeAll: false }),
      allFeeCategoryKey: ALL_FEE_CATEGORIES_KEY,
      allFeeCategoryLabel: ALL_FEE_CATEGORIES_LABEL,
      sessionStatusMeta,
      defaultSessionStatusCode: resolveDefaultSessionStatusCode(sessionStatusMeta),
      subjectFeeCatalog,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

async function showEditForm(req, res) {
  try {
    const { classData } = await getClassByIdWithOrgCheck(req.params.id, req.user);
    const lifecycleContext = await buildClassLifecycleContext(classData, req.user);
    const sessionStatusMeta = await getSessionStatusMetaForOrg(classData?.orgId || getActiveOrgIdOrThrow(req.user));
    const subjects = await schoolDataService.fetchData('subjects', {}, req.user);
    const subjectFeeCatalog = subjects.map((subject) => ({
      id: String(subject.id || ''),
      code: String(subject.code || '').trim(),
      title: String(subject.title || '').trim(),
      credits: normalizeCredits(subject?.configuration?.credits),
      feeRules: Array.isArray(subject.feeRules) ? subject.feeRules : []
    }));

    // Data Service handles all file logic now!
    const sessionsData = await schoolDataService.getClassSessions(req.params.id, req.user);

    if (classData.instructors) {
        classData.instructors.forEach(inst => {
            inst.personId = cleanPersonId(inst.personId);
        });
    }
    if (classData.enrollment?.students) {
        classData.enrollment.students.forEach(stu => {
            stu.personId = cleanPersonId(stu.personId);
        });
    }
    if (sessionsData) {
        sessionsData.forEach(s => {
            if (Array.isArray(s.roster)) {
                s.roster.forEach(r => { r.personId = cleanPersonId(r.personId); });
            }
            if (s.delivery?.deliveredBy) s.delivery.deliveredBy = cleanPersonId(s.delivery.deliveredBy);
        });
    }

    res.render('school/class/classForm', {
      title: 'Edit Class', 
      classData, 
      lifecycleContext,
      sessionsData, 
      includeModal: true, 
      feeCategories: getFeeCategories({ includeAll: false }),
      allFeeCategoryKey: ALL_FEE_CATEGORIES_KEY,
      allFeeCategoryLabel: ALL_FEE_CATEGORIES_LABEL,
      sessionStatusMeta,
      defaultSessionStatusCode: resolveDefaultSessionStatusCode(sessionStatusMeta),
      subjectFeeCatalog,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

async function showEditWizardForm(req, res) {
  try {
    const { classData } = await getClassByIdWithOrgCheck(req.params.id, req.user);
    const lifecycleContext = await buildClassLifecycleContext(classData, req.user);
    const sessionStatusMeta = await getSessionStatusMetaForOrg(classData?.orgId || getActiveOrgIdOrThrow(req.user));
    const subjects = await schoolDataService.fetchData('subjects', {}, req.user);
    const subjectFeeCatalog = subjects.map((subject) => ({
      id: String(subject.id || ''),
      code: String(subject.code || '').trim(),
      title: String(subject.title || '').trim(),
      credits: normalizeCredits(subject?.configuration?.credits),
      feeRules: Array.isArray(subject.feeRules) ? subject.feeRules : []
    }));

    const sessionsData = await schoolDataService.getClassSessions(req.params.id, req.user);

    if (classData.instructors) {
        classData.instructors.forEach(inst => {
            inst.personId = cleanPersonId(inst.personId);
        });
    }
    if (classData.enrollment?.students) {
        classData.enrollment.students.forEach(stu => {
            stu.personId = cleanPersonId(stu.personId);
        });
    }
    if (sessionsData) {
        sessionsData.forEach(s => {
            if (Array.isArray(s.roster)) {
                s.roster.forEach(r => { r.personId = cleanPersonId(r.personId); });
            }
            if (s.delivery?.deliveredBy) s.delivery.deliveredBy = cleanPersonId(s.delivery.deliveredBy);
        });
    }

    res.render('school/class/classWizardForm', {
      title: 'Class Setup Wizard',
      classData,
      lifecycleContext,
      sessionsData,
      includeModal: true,
      feeCategories: getFeeCategories({ includeAll: false }),
      allFeeCategoryKey: ALL_FEE_CATEGORIES_KEY,
      allFeeCategoryLabel: ALL_FEE_CATEGORIES_LABEL,
      sessionStatusMeta,
      defaultSessionStatusCode: resolveDefaultSessionStatusCode(sessionStatusMeta),
      subjectFeeCatalog,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

async function getClassTemplate(req, res) {
  try {
    const sourceClassId = String(req.params.id || '').trim();
    if (!sourceClassId) throw new Error('Class id is required.');

    const { classData } = await getClassByIdWithOrgCheck(sourceClassId, req.user);

    const template = {
      id: String(classData.id || ''),
      title: String(classData.title || '').trim(),
      status: String(classData.status || 'draft').trim().toLowerCase() || 'draft',
      billingMode: normalizeClassBillingMode(classData.billingMode),
      credits: normalizeCredits(classData.credits),
      deliveryDepartmentId: String(classData.deliveryDepartmentId || '').trim(),
      deliveryDepartmentName: String(classData.deliveryDepartmentName || '').trim(),
      curriculum: {
        subjects: Array.isArray(classData?.curriculum?.subjects)
          ? classData.curriculum.subjects.map((subject) => ({
            subjectId: String(subject?.subjectId || '').trim(),
            code: String(subject?.code || subject?.subjectId || '').trim(),
            name: String(subject?.name || '').trim(),
            allocatedHours: Number(subject?.allocatedHours || 0),
            weight: normalizeWeight(subject?.weight)
          })).filter((subject) => subject.subjectId)
          : [],
        totalHours: Number(classData?.curriculum?.totalHours || 0)
      },
      pricing: normalizeClassPricing(classData.pricing || { mode: 'auto', feeRules: [] }),
      postingTemplates: normalizePostingPolicyRows(classData.postingTemplates || []),
      allowedProgramTerms: Array.isArray(classData.allowedProgramTerms)
        ? classData.allowedProgramTerms.map((row, index) => ({
          programId: String(row?.programId || '').trim(),
          termId: String(row?.termId || '').trim(),
          order: Number(row?.order || (index + 1)),
          programCode: String(row?.programCode || '').trim().toUpperCase(),
          programName: String(row?.programName || '').trim(),
          termCode: String(row?.termCode || '').trim().toUpperCase(),
          termName: String(row?.termName || '').trim(),
          notes: String(row?.notes || '').trim()
        })).filter((row) => row.programId && (String(classData.registrationMode || '').trim().toLowerCase() === 'rolling' || row.termId))
        : [],
      instructors: Array.isArray(classData.instructors)
        ? classData.instructors.map((instructor) => ({
          personId: cleanPersonId(instructor?.personId),
          name: String(instructor?.name || instructor?.personId || '').trim(),
          role: String(instructor?.role || 'Primary').trim(),
          status: String(instructor?.status || 'active').trim().toLowerCase()
        })).filter((instructor) => instructor.personId)
        : [],
      enrollment: {
        maxCapacity: Number(classData?.enrollment?.maxCapacity || 30)
      },
      evaluation: normalizeEvaluationForRegistrationMode(
        {
          passingScore: Number(classData?.evaluation?.passingScore || 60),
          weights: {
            attendance: Number(classData?.evaluation?.weights?.attendance || 0),
            assignments: Number(classData?.evaluation?.weights?.assignments || 0),
            midterm: Number(classData?.evaluation?.weights?.midterm || 0),
            finalExam: Number(classData?.evaluation?.weights?.finalExam || 0)
          }
        },
        classData?.registrationMode || 'term_based'
      ),
      // Intentionally do not copy session ledger from source class.
      // New class sessions must be generated/rebuilt for the new lifecycle.
      sessions: []
    };

    return res.json({ status: 'success', template });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function addClass(req, res) {
  let guardKey = '';
  try {
    const activeOrgId = await assertCreateOrgContextOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
        'class_add',
        String(activeOrgId || '').trim(),
        req.body || {}
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
        key: guardKey,
        runningTtlMs: 180000,
        replayTtlMs: 15000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Class creation is already in progress. Please wait.')) return;
    const incomingSessionsRaw = req.body.sessions ? JSON.parse(req.body.sessions) : [];
    const sessions = normalizeIncomingSessions(incomingSessionsRaw);
    const fallbackTeacherId = resolveFallbackTeacherIdFromBody(req.body);
    const createConflicts = await detectSessionConflicts({
        classId: '',
        sessions,
        activeOrgId,
        reqUser: req.user,
        fallbackTeacherId
    });
    if (createConflicts.length) {
        throw new Error(buildConflictBlockingMessage(createConflicts));
    }

    const resolvedDeliveryDepartment = await resolveDeliveryDepartmentFromBody(req.body, req.user);
    req.body.deliveryDepartmentId = resolvedDeliveryDepartment.deliveryDepartmentId;
    req.body.deliveryDepartmentName = resolvedDeliveryDepartment.deliveryDepartmentName;
    const item = buildClassFromBody(req.body, req.user?.id, true, activeOrgId);
    item.allowedProgramTerms = await resolveAllowedProgramTermsOrThrow(item.allowedProgramTerms, activeOrgId, req.user, {
        registrationMode: item.registrationMode
    });
    assertRollingClassHasAllowedProgramOrThrow(item);
    assertRollingClassConfigAllowed(req, item, activeOrgId);
    assertRollingSessionsWithinCycleWindowOrThrow({
        registrationMode: item.registrationMode,
        cycleStartDate: item.cycleStartDate,
        cycleEndDate: item.cycleEndDate,
        sessions
    });
    if (item.billingMode === 'chargeable') {
        validateChargeablePostingTemplatesOrThrow(item.postingTemplates);
        item.postingTemplates = await resolvePostingPoliciesOrThrow(item.postingTemplates, activeOrgId, req.user);
    } else {
        item.postingTemplates = [];
    }
    item.audit.createUser = req.user?.id;
    item.audit.createDateTime = new Date().toISOString();

    for (let inst of item.instructors) {
        inst.personId = cleanPersonId(inst.personId);
    }

    const createdClass = await schoolDataService.addData('classes', item, req.user);
    
    // Data Service handles the save queue
    await schoolDataService.saveClassSessions(createdClass.id, sessions, req.user);
    await indexService.rebuildIndexesForClass(createdClass.id);

    const payloadOut = { status: 'success', message: 'Class created successfully.' };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect('/school/classes');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

const ROLLING_ENROLLMENT_TABLE_NAME = 'Rolling_Enrollment_Periods_List';
const ROLLING_ENROLLMENT_SEARCHABLE_FIELDS = Object.freeze([
  'studentLabel',
  'studentId',
  'startDate',
  'endDate',
  'status',
  'funderType',
  'funderId',
  'authorizationRef'
]);

function filterPeriodRowsBySearchQuery(rows, query) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
  let q = String(query?.q || '').trim();
  if (q === searchDefaultKeyword) q = '';
  if (!q) return rows;

  const rawType = String(query?.type || 'contains').trim().toLowerCase().replace(/\s+/g, '');
  let matchMode = 'contains';
  if (rawType === 'startswith' || rawType === 'starts_with') matchMode = 'starts_with';
  else if (rawType === 'exactmatch' || rawType === 'exact_match' || rawType === 'exact') matchMode = 'exact';

  const fieldRaw = String(query?.searchFields || query?.searchField || '').trim();
  const field = fieldRaw && fieldRaw.toLowerCase() !== 'all' ? fieldRaw : '';

  const norm = (v) => String(v ?? '').toLowerCase();
  const needle = norm(q);

  const cellText = (row, key) => {
    switch (key) {
      case 'studentLabel': return norm(row.studentLabel || row.studentId || '');
      case 'studentId': return norm(toPublicId(row.studentId));
      case 'startDate': return norm(row.startDate);
      case 'endDate': return norm(row.endDate);
      case 'status': return norm(row.status);
      case 'funderType': return norm(row.funderType);
      case 'funderId': return norm(row.funderId);
      case 'authorizationRef': return norm(row.authorizationRef);
      default: return '';
    }
  };

  const allKeys = ROLLING_ENROLLMENT_SEARCHABLE_FIELDS;

  const matches = (hay) => {
    if (hay == null || hay === '') return false;
    if (matchMode === 'exact') return hay === needle;
    if (matchMode === 'starts_with') return hay.startsWith(needle);
    return hay.includes(needle);
  };

  return rows.filter((row) => {
    if (field && allKeys.includes(field)) {
      return matches(cellText(row, field));
    }
    return allKeys.some((k) => matches(cellText(row, k)));
  });
}

async function attachStudentLabelsToEnrollmentPeriodRows(periodRows, user) {
  const [students, persons] = await Promise.all([
    schoolDataService.fetchData('students', {}, user),
    dataService.fetchData('persons', {}, user, PERSON_QUERY_OPTIONS)
  ]);
  const personNameMap = new Map((Array.isArray(persons) ? persons : []).map((person) => {
    const pid = toPublicId(person?.id);
    const label = `${person?.name?.first || ''} ${person?.name?.last || ''}`.trim() || String(person?.displayName || pid || '').trim();
    return [pid, label || pid];
  }));
  const studentOptions = (Array.isArray(students) ? students : [])
    .map((student) => {
      const studentId = toPublicId(student?.id);
      const personId = toPublicId(student?.personId);
      const label = personNameMap.get(personId) || studentId;
      return {
        id: studentId,
        label: student?.studentNumber ? `${label} (${student.studentNumber})` : label
      };
    })
    .filter((row) => row.id);
  const studentLabelMap = new Map(studentOptions.map((row) => [row.id, row.label]));
  return (Array.isArray(periodRows) ? periodRows : []).map((row) => ({
    ...row,
    studentLabel: studentLabelMap.get(toPublicId(row?.studentId)) || toPublicId(row?.studentId)
  }));
}

async function showRollingEnrollmentPage(req, res) {
  try {
    const { classData } = await getClassByIdWithOrgCheck(req.params.id, req.user);
    assertRollingWorkflowEnabledForClass(req, classData);
    const lifecycleContext = await buildClassLifecycleContext(classData, req.user);

    const [periods, students, persons] = await Promise.all([
      schoolDataService.getClassEnrollmentPeriodsByClassId(classData.id, req.user),
      schoolDataService.fetchData('students', {}, req.user),
      dataService.fetchData('persons', {}, req.user, PERSON_QUERY_OPTIONS)
    ]);

    const personNameMap = new Map((Array.isArray(persons) ? persons : []).map((person) => {
      const pid = toPublicId(person?.id);
      const label = `${person?.name?.first || ''} ${person?.name?.last || ''}`.trim() || String(person?.displayName || pid || '').trim();
      return [pid, label || pid];
    }));
    const studentOptions = (Array.isArray(students) ? students : [])
      .map((student) => {
        const studentId = toPublicId(student?.id);
        const personId = toPublicId(student?.personId);
        const label = personNameMap.get(personId) || studentId;
        return {
          id: studentId,
          personId,
          studentNumber: String(student?.studentNumber || '').trim(),
          label: student?.studentNumber ? `${label} (${student.studentNumber})` : label
        };
      })
      .filter((row) => row.id)
      .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));

    const studentLabelMap = new Map(studentOptions.map((row) => [row.id, row.label]));
    let periodRows = (Array.isArray(periods) ? periods : [])
      .slice()
      .sort((a, b) => String(a?.startDate || '').localeCompare(String(b?.startDate || '')))
      .map((row) => ({
        ...row,
        studentLabel: studentLabelMap.get(toPublicId(row?.studentId)) || toPublicId(row?.studentId)
      }));

    periodRows = filterPeriodRowsBySearchQuery(periodRows, req.query);

    res.render('school/class/rollingEnrollment', {
      title: `Rolling Enrollment: ${classData?.title || classData?.id || ''}`,
      classData,
      lifecycleContext,
      studentOptions,
      periodRows,
      enrollmentProgramChoices: buildRollingEnrollmentProgramChoices(classData),
      tableName: ROLLING_ENROLLMENT_TABLE_NAME,
      searchableFields: [...ROLLING_ENROLLMENT_SEARCHABLE_FIELDS],
      includeModal: true,
      includeModal_Table: true,
      print: true,
      filters: req.query,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

async function showCycleRolloverWizard(req, res) {
  try {
    const { classData } = await getClassByIdWithOrgCheck(req.params.id, req.user);
    assertRollingWorkflowEnabledForClass(req, classData);
    const lifecycleContext = await buildClassLifecycleContext(classData, req.user);
    res.render('school/class/cycleRolloverWizard', {
      title: `Cycle Rollover Wizard: ${classData?.title || classData?.id || ''}`,
      classData,
      lifecycleContext,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

async function previewCycleRollover(req, res) {
  try {
    const classId = toPublicId(req.params.classId || req.body?.classId || '');
    if (!classId) throw new Error('classId is required.');
    const { classData } = await getClassByIdWithOrgCheck(classId, req.user);
    assertRollingWorkflowEnabledForClass(req, classData);

    const preview = await schoolDataService.previewNextClassCycleFromTemplate(classData.id, {
      cycleStartDate: String(req.body?.cycleStartDate || '').trim(),
      cycleEndDate: String(req.body?.cycleEndDate || '').trim(),
      currentCycleEndDate: String(req.body?.currentCycleEndDate || '').trim()
    }, req.user);

    return res.json({
      status: 'success',
      message: 'Cycle rollover preview generated.',
      data: preview
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function editClass(req, res) {
  let guardKey = '';
  try {
    const classId = req.params.id;
    const { classData: existing, activeOrgId } = await getClassByIdWithOrgCheck(classId, req.user);
    guardKey = idempotencyGuardService.createGuardKey([
        'class_edit',
        String(existing?.orgId || activeOrgId || '').trim(),
        String(classId || '').trim(),
        req.body || {}
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
        key: guardKey,
        runningTtlMs: 180000,
        replayTtlMs: 15000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Class update is already in progress. Please wait.')) return;
    const incomingSessionsRaw = req.body.sessions ? JSON.parse(req.body.sessions) : [];
    const sessions = normalizeIncomingSessions(incomingSessionsRaw);
    const fallbackTeacherId = resolveFallbackTeacherIdFromBody(req.body);
    const updateConflicts = await detectSessionConflicts({
        classId,
        sessions,
        activeOrgId: existing?.orgId || activeOrgId,
        reqUser: req.user,
        fallbackTeacherId
    });
    if (updateConflicts.length) {
        throw new Error(buildConflictBlockingMessage(updateConflicts));
    }

    const resolvedDeliveryDepartment = await resolveDeliveryDepartmentFromBody(req.body, req.user);
    req.body.deliveryDepartmentId = resolvedDeliveryDepartment.deliveryDepartmentId;
    req.body.deliveryDepartmentName = resolvedDeliveryDepartment.deliveryDepartmentName;

    const updates = buildClassFromBody(req.body, req.user?.id, false, existing?.orgId || activeOrgId, existing);
    updates.allowedProgramTerms = await resolveAllowedProgramTermsOrThrow(updates.allowedProgramTerms, existing?.orgId || activeOrgId, req.user, {
        registrationMode: updates.registrationMode
    });
    assertRollingClassHasAllowedProgramOrThrow(updates);
    assertRollingClassConfigAllowed(req, updates, existing?.orgId || activeOrgId);
    assertRollingSessionsWithinCycleWindowOrThrow({
        registrationMode: updates.registrationMode,
        cycleStartDate: updates.cycleStartDate,
        cycleEndDate: updates.cycleEndDate,
        sessions
    });
    if (updates.billingMode === 'chargeable') {
        validateChargeablePostingTemplatesOrThrow(updates.postingTemplates);
        updates.postingTemplates = await resolvePostingPoliciesOrThrow(updates.postingTemplates, existing?.orgId || activeOrgId, req.user);
    } else {
        updates.postingTemplates = [];
    }
    updates.audit.createUser = existing.audit.createUser;
    updates.audit.createDateTime = existing.audit.createDateTime;
    updates.statusHistory = existing.statusHistory || [];
    if (updates.status !== existing.status) updates.statusHistory.push({ status: updates.status, date: new Date().toISOString(), updatedBy: req.user?.id, reason: 'Updated via form' });
    updates.enrollment.students = existing.enrollment?.students || [];

    for (let inst of updates.instructors) {
        inst.personId = cleanPersonId(inst.personId);
    }

    await schoolDataService.updateData('classes', classId, updates, req.user);
    
    await schoolDataService.saveClassSessions(classId, sessions, req.user);
    await indexService.rebuildIndexesForClass(classId);

    const payloadOut = { status: 'success', message: 'Class updated.' };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect('/school/classes');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    console.log(error);
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

async function deleteClass(req, res) {
  let guardKey = '';
  try {
    const classId = String(req.params.id || '').trim();
    const { classData, activeOrgId } = await getClassByIdWithOrgCheck(classId, req.user);
    guardKey = idempotencyGuardService.createGuardKey([
        'class_delete',
        String(classData?.orgId || activeOrgId || '').trim(),
        classId
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
        key: guardKey,
        runningTtlMs: 90000,
        replayTtlMs: 12000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Class delete is already in progress. Please wait.')) return;

    await schoolDataService.deleteData('classes', req.params.id, req.user);
    const folderCleanup = await cleanupClassRelatedFolders(classData);
    await indexService.rebuildIndexesForClass(req.params.id); // Fixed ID reference
    const warningCount = Array.isArray(folderCleanup?.failed) ? folderCleanup.failed.length : 0;
    const payloadOut = {
        status: warningCount ? 'warning' : 'success',
        message: warningCount
            ? 'Class deleted. Some related folders could not be removed.'
            : 'Class deleted. Related folders removed.',
        folderCleanup
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect('/school/classes');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

async function checkConflicts(req, res) {
  try {
    const { classId, id, sessions, defaultTeacherId, primaryTeacherId } = req.body;
    const resolvedClassId = String(classId || id || '').trim();
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    let conflictScopeOrgId = activeOrgId;
    let classData = null;
    if (resolvedClassId) {
        const scopedResult = await getClassByIdWithOrgCheck(resolvedClassId, req.user);
        classData = scopedResult.classData;
        conflictScopeOrgId = String(classData?.orgId || activeOrgId || '').trim();
    }
    const parsedSessions = normalizeIncomingSessions(typeof sessions === 'string' ? JSON.parse(sessions) : sessions);
    const requestedMode = String(req.body?.registrationMode || classData?.registrationMode || 'term_based').trim().toLowerCase();
    const requestedCycleStart = String(req.body?.cycleStartDate || classData?.cycleStartDate || '').trim();
    const requestedCycleEnd = String(req.body?.cycleEndDate || classData?.cycleEndDate || '').trim();
    assertRollingSessionsWithinCycleWindowOrThrow({
        registrationMode: requestedMode,
        cycleStartDate: requestedCycleStart,
        cycleEndDate: requestedCycleEnd,
        sessions: parsedSessions
    });
    const fallbackTeacherId = cleanPersonId(defaultTeacherId || primaryTeacherId || resolveFallbackTeacherIdFromBody(req.body));
    const conflicts = await detectSessionConflicts({
        classId: resolvedClassId,
        sessions: parsedSessions,
        activeOrgId: conflictScopeOrgId,
        reqUser: req.user,
        fallbackTeacherId
    });
    const unresolvedTeacherSessions = parsedSessions.reduce((count, row) => {
        const hasSchedulingFields = Boolean(String(row?.date || '').trim() && String(row?.startTime || '').trim() && String(row?.endTime || '').trim());
        if (!hasSchedulingFields) return count;
        const resolvedTeacher = resolveSessionTeacherId(row, fallbackTeacherId);
        return resolvedTeacher ? count : count + 1;
    }, 0);

    const diagnostics = {
        sessionsReceived: parsedSessions.length,
        unresolvedTeacherSessions
    };

    res.json({
        status: 'success',
        conflicts,
        diagnostics
    });
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
}

async function listClassEnrollmentPeriods(req, res) {
  try {
    const classId = toPublicId(req.params.classId || req.query.classId || req.query.id || '');
    if (!classId) throw new Error('classId is required.');
    const { classData } = await getClassByIdWithOrgCheck(classId, req.user);
    assertRollingWorkflowEnabledForClass(req, classData);
    const periods = await schoolDataService.getClassEnrollmentPeriodsByClassId(classData.id, req.user);
    let rows = (Array.isArray(periods) ? periods : [])
      .slice()
      .sort((a, b) => {
        const aStart = String(a?.startDate || '');
        const bStart = String(b?.startDate || '');
        if (aStart !== bStart) return aStart.localeCompare(bStart);
        const aSeq = Number.parseInt(String(a?.sequenceNo || ''), 10);
        const bSeq = Number.parseInt(String(b?.sequenceNo || ''), 10);
        return (Number.isFinite(aSeq) ? aSeq : 0) - (Number.isFinite(bSeq) ? bSeq : 0);
      });

    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    const qRaw = String(req.query.q || '').trim();
    const searchActive = qRaw && qRaw !== searchDefaultKeyword;
    if (searchActive) {
      rows = await attachStudentLabelsToEnrollmentPeriodRows(rows, req.user);
      rows = filterPeriodRowsBySearchQuery(rows, req.query);
    }

    return res.json({
      status: 'success',
      message: 'Class enrollment periods loaded.',
      classId: classData.id,
      count: rows.length,
      items: rows
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

function buildRollingEnrollmentProgramChoices(classData) {
  const rows = Array.isArray(classData?.allowedProgramTerms) ? classData.allowedProgramTerms : [];
  const out = [];
  rows.forEach((row, index) => {
    const programId = toPublicId(row?.programId);
    if (!programId) return;
    const termId = toPublicId(row?.termId);
    const programName = String(row?.programName || '').trim();
    const programCode = String(row?.programCode || '').trim();
    const termName = String(row?.termName || '').trim();
    const termCode = String(row?.termCode || '').trim();
    let label = programName || programId;
    if (programCode) label += ` (${programCode})`;
    label += termId ? ` — ${termName || termCode || termId}` : ' — Any term';
    out.push({
      programId,
      termId: termId || '',
      label,
      order: Number(row?.order) || index + 1
    });
  });
  out.sort((a, b) => a.order - b.order);
  return out;
}

function isApprovedTermRegistrationStatus(status) {
  return String(status || '').trim().toLowerCase() === 'registered';
}

/**
 * Rolling enrollment: program/term come from the student's active program (and when required, term)
 * registrations that intersect the class allowedProgramTerms — not from a free-form program picker.
 * Optional body.programRegistrationId disambiguates when multiple program registrations match.
 */
async function resolveRollingEnrollmentProgramFromStudentRegistrations(req, classData, student, body = {}) {
  const choices = buildRollingEnrollmentProgramChoices(classData);
  if (!choices.length) {
    throw new Error('This class has no allowed programs configured. Add programs on the class Program / terms tab before enrolling.');
  }
  const classOrgId = toPublicId(classData?.orgId);
  const studentId = toPublicId(student?.id);
  if (!studentId || !classOrgId) {
    throw new Error('Student and class organization context are required.');
  }

  const explicitPrId = toPublicId(body?.programRegistrationId);

  const [progRegRows, termRegRows] = await Promise.all([
    schoolDataService.fetchData('studentProgramRegistrations', {
      studentId__eq: studentId,
      page: 1,
      limit: 500
    }, req.user),
    schoolDataService.fetchData('studentTermRegistrations', {
      studentId__eq: studentId,
      page: 1,
      limit: 500
    }, req.user)
  ]);

  const progRegs = (Array.isArray(progRegRows) ? progRegRows : []).filter((r) => idsEqual(r?.orgId, classOrgId)
    && registrationIntegrityService.isApprovedProgramRegistrationStatus(r?.status));

  const termRegs = (Array.isArray(termRegRows) ? termRegRows : []).filter((r) => idsEqual(r?.orgId, classOrgId)
    && isApprovedTermRegistrationStatus(r?.status));

  const allowedProgramIds = new Set(choices.map((c) => c.programId));

  const termRegsByProgram = new Map();
  termRegs.forEach((tr) => {
    const pid = toPublicId(tr?.programId);
    if (!pid) return;
    if (!termRegsByProgram.has(pid)) termRegsByProgram.set(pid, []);
    termRegsByProgram.get(pid).push(tr);
  });
  termRegsByProgram.forEach((list) => {
    list.sort((a, b) => String(b.registrationDate || '').localeCompare(String(a.registrationDate || '')));
  });

  const candidates = [];
  const seen = new Set();

  for (const progReg of progRegs) {
    const pid = toPublicId(progReg?.programId);
    const prId = toPublicId(progReg?.id);
    if (!pid || !allowedProgramIds.has(pid)) continue;
    if (explicitPrId && !idsEqual(prId, explicitPrId)) continue;

    const regDate = String(progReg?.registrationDate || '');
    const programChoices = choices.filter((c) => idsEqual(c.programId, pid));

    for (const ch of programChoices) {
      const choiceTermId = toPublicId(ch.termId);
      if (choiceTermId) {
        const hasTerm = termRegs.some((tr) => idsEqual(tr.programId, pid) && idsEqual(tr.termId, choiceTermId));
        if (!hasTerm) continue;
        const key = `${prId}|${pid}|${choiceTermId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          programId: pid,
          termId: choiceTermId,
          programRegistrationId: prId,
          score: 100,
          regDate
        });
      } else {
        const trList = termRegsByProgram.get(pid) || [];
        let termId = '';
        let score = 40;
        if (trList.length) {
          termId = toPublicId(trList[0].termId);
          score = 80;
        } else {
          const aptRow = (Array.isArray(classData?.allowedProgramTerms) ? classData.allowedProgramTerms : [])
            .find((row) => idsEqual(row?.programId, pid));
          termId = toPublicId(aptRow?.termId) || '';
          if (termId) score = 50;
        }
        const key = `${prId}|${pid}|${termId || '__empty__'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          programId: pid,
          termId,
          programRegistrationId: prId,
          score,
          regDate
        });
      }
    }
  }

  if (explicitPrId && !candidates.length) {
    throw new Error('The selected program registration does not match an allowed program on this class, or the required term registration is missing.');
  }

  if (!candidates.length) {
    throw new Error(
      'This student has no active program registration linked to this class. Register the student in a program listed under this class\'s allowed programs (and in the required term, if the class specifies one), then try again.'
    );
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const cmp = String(b.regDate || '').localeCompare(String(a.regDate || ''));
    if (cmp !== 0) return cmp;
    return String(a.programRegistrationId || '').localeCompare(String(b.programRegistrationId || ''));
  });

  const chosen = candidates[0];
  return {
    programId: chosen.programId,
    termId: chosen.termId,
    programRegistrationId: chosen.programRegistrationId
  };
}

async function applyRollingEnrollmentResolutionFromRegistrations(req, classData, student) {
  const merged = await resolveRollingEnrollmentProgramFromStudentRegistrations(req, classData, student, req.body || {});
  if (!req.body || typeof req.body !== 'object') req.body = {};
  req.body.programId = merged.programId;
  req.body.termId = merged.termId;
  if (merged.programRegistrationId) req.body.programRegistrationId = merged.programRegistrationId;
}

async function buildRollingEnrollmentPrerequisitePreview(req, classData, student, programId, termId, startDate) {
  const pid = toPublicId(programId);
  if (!pid) {
    return {
      status: 'error',
      issues: ['Program could not be resolved for prerequisite validation.'],
      warnings: []
    };
  }
  const effectiveDate = String(startDate || '').trim() || new Date().toISOString().slice(0, 10);

  const program = await schoolDataService.getDataById('programs', pid, req.user);
  if (!program) {
    return {
      status: 'error',
      issues: ['Program could not be loaded for prerequisite validation.'],
      warnings: []
    };
  }

  const rebuiltSnap = await academicSnapshotService.rebuildStudentProgramSnapshot(student.id, pid);
  const snapshot = (rebuiltSnap && typeof rebuiltSnap === 'object' && rebuiltSnap.results)
    ? rebuiltSnap
    : { results: { passedSubjects: [], failedSubjects: [], activeClasses: [] } };

  const subjectsResult = await schoolDataService.fetchData('subjects', {}, req.user);
  const subjectCatalogMap = new Map(
    (Array.isArray(subjectsResult) ? subjectsResult : [])
      .filter((s) => idsEqual(s?.orgId, classData?.orgId))
      .map((s) => [toPublicId(s?.id), s])
  );

  const resolvedDepartmentId = String(program?.departmentId || classData?.deliveryDepartmentId || '').trim();
  const department = resolvedDepartmentId
    ? await schoolDataService.getDataById('departments', resolvedDepartmentId, req.user)
    : null;

  const existingRosterResult = await classEnrollmentReadService.getActiveClassIdsForStudent({
    studentId: student.id,
    classes: [classData],
    reqUser: req.user,
    activeOrgId: toPublicId(classData?.orgId),
    referenceDate: effectiveDate
  });
  const existingRosterClassIds = existingRosterResult.classIds || new Set();

  const enrollmentCountResult = await classEnrollmentReadService.buildClassEnrollmentCountMap({
    classes: [classData],
    reqUser: req.user,
    activeOrgId: toPublicId(classData?.orgId)
  });

  return registrationIntegrityService.buildTermClassPreview({
    classItem: classData,
    program,
    department,
    termId: toPublicId(termId),
    student,
    effectiveDate,
    snapshot,
    subjectCatalogMap,
    selectedSubjectOwners: new Map(),
    existingRosterClassIds,
    classEnrollmentCountsByClassId: enrollmentCountResult.map || new Map()
  });
}

async function assertRollingEnrollmentPrerequisitesOrThrow(req, classData, student, programId, termId, startDate) {
  const classPreview = await buildRollingEnrollmentPrerequisitePreview(req, classData, student, programId, termId, startDate);
  if (classPreview.status === 'error') {
    const msg = (Array.isArray(classPreview.issues) ? classPreview.issues : []).filter(Boolean).join(' ');
    throw new Error(msg || 'Enrollment prerequisites are not satisfied for this class and program.');
  }
}

async function previewRollingEnrollmentEligibility(req, res) {
  try {
    const classId = toPublicId(req.params.classId || '');
    const studentId = toPublicId(req.query.studentId || '');
    const startDate = String(req.query.startDate || '').trim();
    if (!classId) throw new Error('classId is required.');
    if (!studentId) throw new Error('studentId is required.');

    const { classData } = await getClassByIdWithOrgCheck(classId, req.user);
    assertRollingWorkflowEnabledForClass(req, classData);

    const student = await schoolDataService.getDataById('students', studentId, req.user);
    if (!student) throw new Error('Student not found.');
    if (!idsEqual(student?.orgId, classData?.orgId)) {
      throw new Error('Student organization does not match the class organization.');
    }

    const effectiveStart = startDate || new Date().toISOString().slice(0, 10);
    let merged;
    try {
      merged = await resolveRollingEnrollmentProgramFromStudentRegistrations(req, classData, student, {
        programRegistrationId: req.query.programRegistrationId
      });
    } catch (err) {
      return res.json({
        status: 'success',
        eligible: false,
        message: String(err?.message || err || ''),
        resolved: null,
        prerequisite: { status: 'blocked', issues: [String(err?.message || err || '')], warnings: [] }
      });
    }

    const choices = buildRollingEnrollmentProgramChoices(classData);
    const labelRow = choices.find((c) => idsEqual(c.programId, merged.programId)
      && String(c.termId || '') === String(merged.termId || ''))
      || choices.find((c) => idsEqual(c.programId, merged.programId));
    const resolvedLabel = labelRow
      ? labelRow.label
      : [merged.programId, merged.termId].filter(Boolean).join(' — ');

    const prereqPreview = await buildRollingEnrollmentPrerequisitePreview(
      req,
      classData,
      student,
      merged.programId,
      merged.termId,
      effectiveStart
    );

    return res.json({
      status: 'success',
      eligible: prereqPreview.status !== 'error',
      resolved: {
        programId: merged.programId,
        termId: merged.termId,
        programRegistrationId: merged.programRegistrationId,
        label: resolvedLabel
      },
      prerequisite: {
        status: prereqPreview.status,
        issues: Array.isArray(prereqPreview.issues) ? prereqPreview.issues : [],
        warnings: Array.isArray(prereqPreview.warnings) ? prereqPreview.warnings : []
      }
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

function buildClassEnrollmentCreatePayloadFromRequest(classData, req) {
  return {
    orgId: classData.orgId,
    classId: classData.id,
    studentId: toPublicId(req.body?.studentId || ''),
    startDate: String(req.body?.startDate || '').trim(),
    endDate: String(req.body?.endDate || '').trim(),
    status: String(req.body?.status || '').trim(),
    funderType: String(req.body?.funderType || '').trim(),
    funderId: String(req.body?.funderId || '').trim(),
    authorizationRef: String(req.body?.authorizationRef || '').trim(),
    reasonStart: String(req.body?.reasonStart || '').trim(),
    reasonEnd: String(req.body?.reasonEnd || '').trim(),
    sequenceNo: req.body?.sequenceNo,
    personId: toPublicId(req.body?.personId || ''),
    programRegistrationId: toPublicId(req.body?.programRegistrationId || ''),
    programId: toPublicId(req.body?.programId || ''),
    termId: toPublicId(req.body?.termId || ''),
    enrollmentSource: String(req.body?.enrollmentSource || '').trim(),
    feeCategory: String(req.body?.feeCategory || '').trim(),
    pricing: parseData(req.body?.pricing) || {},
    notes: String(req.body?.notes || '').trim(),
    allowOverlap: parseBoolean(req.body?.allowOverlap, false)
  };
}

async function previewClassEnrollmentWithTransactions(req, res) {
  try {
    const classId = toPublicId(req.body?.classId || req.body?.id || req.params?.classId || '');
    if (!classId) throw new Error('classId is required.');
    const studentId = toPublicId(req.body?.studentId || '');
    if (!studentId) throw new Error('studentId is required.');
    const startDate = String(req.body?.startDate || '').trim();
    if (!startDate) throw new Error('startDate is required.');

    const { classData } = await getClassByIdWithOrgCheck(classId, req.user);
    assertRollingWorkflowEnabledForClass(req, classData);

    const student = await schoolDataService.getDataById('students', studentId, req.user);
    if (!student) throw new Error('Student not found.');
    if (!idsEqual(student?.orgId, classData?.orgId)) {
      throw new Error('Student organization does not match the class organization.');
    }

    await applyRollingEnrollmentResolutionFromRegistrations(req, classData, student);
    await assertRollingEnrollmentPrerequisitesOrThrow(req, classData, student, req.body?.programId, req.body?.termId, startDate);
    const postingProgramId = toPublicId(req.body?.programId || '');

    const draft = await buildClassEnrollmentTransactionDraft({
      classData,
      student,
      startDate,
      externalReference: String(req.body?.authorizationRef || '').trim(),
      reqUser: req.user,
      programIdForPosting: postingProgramId
    });

    if (!draft.isChargeable) {
      return res.json({
        status: 'success',
        mode: 'no_charge',
        requiresDraft: false,
        message: 'No-charge class. Enrollment can be saved directly.'
      });
    }

    return res.json({
      status: 'success',
      mode: 'chargeable',
      requiresDraft: true,
      message: 'Chargeable class detected. Review and confirm transaction draft before enrollment.',
      draft: {
        feeCategory: draft.feeCategory,
        totalAmount: draft.totalAmount,
        classFeeRule: draft.classFeeRule,
        draftPreviewRows: draft.draftPreviewRows,
        draftTransactionItems: draft.draftTransactionItems
      }
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function createClassEnrollmentWithTransactions(req, res) {
  let guardKey = '';
  try {
    const classId = toPublicId(req.body?.classId || req.body?.id || req.params?.classId || '');
    if (!classId) throw new Error('classId is required.');
    const { classData } = await getClassByIdWithOrgCheck(classId, req.user);
    assertRollingWorkflowEnabledForClass(req, classData);

    const studentIdEarly = toPublicId(req.body?.studentId || '');
    if (!studentIdEarly) throw new Error('studentId is required.');
    const startDateEarly = String(req.body?.startDate || '').trim();
    if (!startDateEarly) throw new Error('startDate is required.');

    const student = await schoolDataService.getDataById('students', studentIdEarly, req.user);
    if (!student) throw new Error('Student not found.');
    if (!idsEqual(student?.orgId, classData?.orgId)) {
      throw new Error('Student organization does not match the class organization.');
    }

    await applyRollingEnrollmentResolutionFromRegistrations(req, classData, student);
    await assertRollingEnrollmentPrerequisitesOrThrow(req, classData, student, req.body?.programId, req.body?.termId, startDateEarly);

    const enrollmentPayload = buildClassEnrollmentCreatePayloadFromRequest(classData, req);
    if (!enrollmentPayload.studentId) throw new Error('studentId is required.');
    if (!enrollmentPayload.startDate) throw new Error('startDate is required.');

    const billingMode = normalizeClassBillingMode(classData?.billingMode);
    guardKey = idempotencyGuardService.createGuardKey([
      'class_enrollment_period_create_with_transactions',
      String(classData?.orgId || '').trim(),
      String(classData?.id || '').trim(),
      String(enrollmentPayload.studentId || '').trim(),
      String(enrollmentPayload.programId || '').trim(),
      String(enrollmentPayload.termId || '').trim(),
      String(enrollmentPayload.startDate || '').trim(),
      String(enrollmentPayload.endDate || '').trim(),
      String(enrollmentPayload.status || '').trim().toLowerCase()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 20000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Enrollment operation is already in progress. Please wait.')) return;

    if (billingMode === 'no_charge') {
      const result = await schoolDataService.createClassEnrollmentPeriod(enrollmentPayload, req.user);
      const createdPeriod = result?.period || null;
      let academicLedger = null;
      if (createdPeriod) {
        const { classData: classAfterCreate } = await getClassByIdWithOrgCheck(classId, req.user);
        academicLedger = await tryPostAcademicLedgerForRollingClassEnrollment({
          req,
          period: createdPeriod,
          classData: classAfterCreate,
          student,
          effectiveDate: enrollmentPayload.startDate,
          note: enrollmentPayload.notes
        });
      }
      const payloadOut = {
        status: 'success',
        mode: 'no_charge',
        message: 'Enrollment period created (no-charge class).',
        academicLedger,
        data: {
          period: createdPeriod,
          transactionCount: 0,
          transactionTotal: 0
        }
      };
      idempotencyGuardService.completeGuard(guardKey, payloadOut);
      return res.json(payloadOut);
    }

    const feeCategory = String(student?.feeCategory || '').trim();
    if (!feeCategory) throw new Error('Student fee category is required for chargeable enrollment.');

    const draftItemsInput = parseData(req.body?.draftTransactionItems) || [];
    const editedRows = parseData(req.body?.editedRows) || [];
    const addedRows = parseData(req.body?.addedRows) || [];
    const baseDraft = draftItemsInput.length
      ? {
          draftTransactionItems: programRegistrationDraftService.normalizeDraftTransactionItems(draftItemsInput)
        }
      : await buildClassEnrollmentTransactionDraft({
          classData,
          student,
          startDate: enrollmentPayload.startDate,
          externalReference: enrollmentPayload.authorizationRef,
          reqUser: req.user,
          programIdForPosting: toPublicId(enrollmentPayload.programId || '')
        });

    const accountMap = await buildPostableAccountMap(req.user, classData.orgId);
    const finalDraftState = normalizeEnrollmentTransactionDraftState({
      draftTransactionItems: baseDraft.draftTransactionItems,
      editedRows,
      addedRows,
      accountMap,
      classData,
      student,
      feeCategory,
      startDate: enrollmentPayload.startDate,
      externalReference: enrollmentPayload.authorizationRef,
      requestUser: req.user
    });

    const currency = String(finalDraftState.previewRows[0]?.currency || 'CAD').trim().toUpperCase() || 'CAD';
    const pricingRows = finalDraftState.previewRows.map((row) => ({
      memo: String(row?.memo || '').trim(),
      amount: roundMoney(row?.amount),
      currency,
      debitAccountId: toPublicId(row?.debitAccount?.id || ''),
      debitAccountCode: String(row?.debitAccount?.code || '').trim(),
      debitAccountName: String(row?.debitAccount?.name || '').trim(),
      creditAccountId: toPublicId(row?.creditAccount?.id || ''),
      creditAccountCode: String(row?.creditAccount?.code || '').trim(),
      creditAccountName: String(row?.creditAccount?.name || '').trim()
    }));

    const result = await schoolDataService.createClassEnrollmentPeriod({
      ...enrollmentPayload,
      enrollmentSource: enrollmentPayload.enrollmentSource || 'rolling_enrollment',
      feeCategory: feeCategory,
      personId: enrollmentPayload.personId || toPublicId(student?.personId || ''),
      pricing: {
        currency,
        effectiveDate: enrollmentPayload.startDate,
        suggestedTotal: roundMoney(baseDraft.totalAmount || 0),
        finalTotal: roundMoney(finalDraftState.totalAmount || 0),
        breakdown: pricingRows,
        warnings: []
      },
      notes: enrollmentPayload.notes || `Rolling enrollment with finance posting for class ${classData.id}.`
    }, req.user);

    const draftPeriod = result?.period || null;
    const draftPeriodId = toPublicId(draftPeriod?.id || '');
    if (!draftPeriodId) {
      throw new Error('Draft enrollment period was not created.');
    }

    const updatedDraft = await schoolDataService.updateData('classEnrollmentPeriods', draftPeriodId, {
      status: 'draft',
      notes: enrollmentPayload.notes || `Draft rolling enrollment for class ${classData.id}.`,
      transactionSummary: {
        mode: 'chargeable',
        currency,
        totalAmount: roundMoney(finalDraftState.totalAmount || 0),
        transactionCount: finalDraftState.previewRows.length,
        draftTransactionItems: finalDraftState.items,
        draftPreviewRows: finalDraftState.previewRows,
        postedTransactionIds: [],
        draftSavedAt: new Date().toISOString(),
        note: 'Draft generated before posting.'
      }
    }, req.user);

    const payloadOut = {
      status: 'success',
      mode: 'chargeable',
      message: 'Draft enrollment saved. Review and approve to post transactions.',
      data: {
        period: updatedDraft || draftPeriod,
        draft: {
          draftPreviewRows: finalDraftState.previewRows,
          draftTransactionItems: finalDraftState.items,
          totalAmount: roundMoney(finalDraftState.totalAmount || 0)
        }
      }
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function saveClassEnrollmentDraft(req, res) {
  let guardKey = '';
  try {
    const periodId = toPublicId(req.params?.periodId || req.body?.periodId || '');
    if (!periodId) throw new Error('periodId is required.');
    const period = await schoolDataService.getDataById('classEnrollmentPeriods', periodId, req.user);
    if (!period) throw new Error('Enrollment period not found.');

    const { classData } = await getClassByIdWithOrgCheck(period.classId, req.user);
    assertRollingWorkflowEnabledForClass(req, classData);

    const currentStatus = String(period?.status || '').trim().toLowerCase();
    if (!['draft', 'error', 'planned', 'active'].includes(currentStatus)) {
      throw new Error('Only draft-like enrollment periods can be edited here.');
    }

    guardKey = idempotencyGuardService.createGuardKey([
      'class_enrollment_draft_update',
      String(classData?.orgId || '').trim(),
      String(classData?.id || '').trim(),
      periodId
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 20000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Draft save is already in progress. Please wait.')) return;

    const student = await schoolDataService.getDataById('students', period.studentId, req.user);
    if (!student) throw new Error('Student not found for this draft.');

    const baseDraftItems = parseData(req.body?.draftTransactionItems)
      || period?.transactionSummary?.draftTransactionItems
      || [];
    const editedRows = parseData(req.body?.editedRows) || [];
    const addedRows = parseData(req.body?.addedRows) || [];
    const accountMap = await buildPostableAccountMap(req.user, classData.orgId);
    const finalDraftState = normalizeEnrollmentTransactionDraftState({
      draftTransactionItems: baseDraftItems,
      editedRows,
      addedRows,
      accountMap,
      classData,
      student,
      feeCategory: String(student?.feeCategory || '').trim(),
      startDate: String(req.body?.startDate || period?.startDate || '').trim(),
      externalReference: String(req.body?.authorizationRef || period?.authorizationRef || '').trim(),
      requestUser: req.user
    });

    const nextStartDate = String(req.body?.startDate || period?.startDate || '').trim();
    if (!nextStartDate) throw new Error('startDate is required.');
    const nextEndDate = String(req.body?.endDate || period?.endDate || '').trim();
    const nextStatusRaw = String(req.body?.status || 'draft').trim().toLowerCase();
    const nextStatus = ['draft', 'planned', 'active'].includes(nextStatusRaw) ? nextStatusRaw : 'draft';
    const currency = String(finalDraftState.previewRows[0]?.currency || 'CAD').trim().toUpperCase() || 'CAD';

    const updated = await schoolDataService.updateData('classEnrollmentPeriods', periodId, {
      startDate: nextStartDate,
      endDate: nextEndDate,
      status: nextStatus,
      funderType: String(req.body?.funderType || period?.funderType || '').trim(),
      funderId: String(req.body?.funderId || period?.funderId || '').trim(),
      authorizationRef: String(req.body?.authorizationRef || period?.authorizationRef || '').trim(),
      reasonStart: String(req.body?.reasonStart || period?.reasonStart || '').trim(),
      notes: String(req.body?.notes || period?.notes || '').trim(),
      transactionSummary: {
        mode: 'chargeable',
        currency,
        totalAmount: roundMoney(finalDraftState.totalAmount || 0),
        transactionCount: finalDraftState.previewRows.length,
        draftTransactionItems: finalDraftState.items,
        draftPreviewRows: finalDraftState.previewRows,
        postedTransactionIds: Array.isArray(period?.transactionSummary?.postedTransactionIds)
          ? period.transactionSummary.postedTransactionIds
          : [],
        draftSavedAt: new Date().toISOString(),
        postedAt: String(period?.transactionSummary?.postedAt || '').trim(),
        note: String(req.body?.draftNote || '').trim()
      }
    }, req.user);

    const payloadOut = {
      status: 'success',
      message: 'Draft enrollment updated.',
      data: {
        period: updated || null,
        draftPreviewRows: finalDraftState.previewRows,
        totalAmount: roundMoney(finalDraftState.totalAmount || 0)
      }
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

function firstClassCurriculumSubjectId(classData) {
    const subs = classData?.curriculum?.subjects;
    if (!Array.isArray(subs)) return '';
    const row = subs.find((s) => toPublicId(s?.subjectId || s?.id));
    return toPublicId(row?.subjectId || row?.id);
}

function resolveProgramIdFromClassEnrollmentSnapshot(period, classData) {
    const fromPeriod = toPublicId(period?.programId);
    if (fromPeriod) return fromPeriod;
    let pid = toPublicId(classData?.programId);
    if (pid) return pid;
    const apt = Array.isArray(classData?.allowedProgramTerms) ? classData.allowedProgramTerms : [];
    const aptRow = apt.find((row) => toPublicId(row?.programId));
    pid = toPublicId(aptRow?.programId);
    if (pid) return pid;
    const elig = Array.isArray(classData?.eligibility) ? classData.eligibility : [];
    const er = elig.find((e) => toPublicId(e?.programId));
    return toPublicId(er?.programId);
}

function resolveTermIdFromClassEnrollmentSnapshot(period, classData) {
    const fromPeriod = toPublicId(period?.termId);
    if (fromPeriod) return fromPeriod;
    let tid = toPublicId(classData?.termId);
    if (tid) return tid;
    const apt = Array.isArray(classData?.allowedProgramTerms) ? classData.allowedProgramTerms : [];
    const aptRow = apt.find((row) => toPublicId(row?.programId));
    tid = toPublicId(aptRow?.termId);
    if (tid) return tid;
    const elig = Array.isArray(classData?.eligibility) ? classData.eligibility : [];
    const er = elig.find((e) => toPublicId(e?.termId));
    return toPublicId(er?.termId);
}

function isInactiveSchoolRegistrationStatus(status) {
    const normalized = String(status || '').trim().toLowerCase();
    return ['withdrawn', 'cancelled', 'completed', 'rolled_back'].includes(normalized);
}

/**
 * When class/period lack program-term context, infer from the student's registrations in the class org.
 * If the class lists allowed program terms, only registrations for those programs are considered.
 */
async function inferProgramTermGapsFromStudentRegistrations(req, classData, student, programId, termId) {
    const out = { programId: '', termId: '' };
    const classOrgId = toPublicId(classData?.orgId);
    const studentId = toPublicId(student?.id);
    if (!studentId || !classOrgId) return out;

    const allowedProgSet = new Set(
        (Array.isArray(classData?.allowedProgramTerms) ? classData.allowedProgramTerms : [])
            .map((row) => toPublicId(row?.programId))
            .filter(Boolean)
    );

    const inScopeOrg = (row) => idsEqual(row?.orgId, classOrgId) && !isInactiveSchoolRegistrationStatus(row?.status);

    if (!toPublicId(programId)) {
        let progRegs = await schoolDataService.fetchData('studentProgramRegistrations', {
            studentId__eq: studentId,
            page: 1,
            limit: 500
        }, req.user);
        progRegs = (Array.isArray(progRegs) ? progRegs : []).filter(inScopeOrg);
        if (allowedProgSet.size) {
            progRegs = progRegs.filter((r) => allowedProgSet.has(toPublicId(r.programId)));
        }
        progRegs.sort((a, b) => String(b.registrationDate || '').localeCompare(String(a.registrationDate || '')));
        out.programId = toPublicId(progRegs[0]?.programId);
    }

    const resolvedProgram = toPublicId(programId) || out.programId;
    if (!toPublicId(termId) && resolvedProgram) {
        let termRegs = await schoolDataService.fetchData('studentTermRegistrations', {
            studentId__eq: studentId,
            programId__eq: resolvedProgram,
            page: 1,
            limit: 500
        }, req.user);
        termRegs = (Array.isArray(termRegs) ? termRegs : []).filter(inScopeOrg);
        termRegs.sort((a, b) => String(b.registrationDate || '').localeCompare(String(a.registrationDate || '')));
        out.termId = toPublicId(termRegs[0]?.termId);
        if (!out.termId && Array.isArray(classData?.allowedProgramTerms)) {
            const apt = classData.allowedProgramTerms.find((row) => idsEqual(row?.programId, resolvedProgram));
            out.termId = toPublicId(apt?.termId);
        }
    }

    return out;
}

/**
 * Rolling class enrollment (period + finance) did not post academic ledger; term-registration flow did.
 * Creates class_enrolled when a period is activated so Academic Ledger class filter finds these rows.
 * @returns {{ status: string, message?: string, periodId?: string }}
 */
async function tryPostAcademicLedgerForRollingClassEnrollment({
    req,
    period,
    classData,
    student,
    effectiveDate = '',
    note = ''
}) {
    const periodId = String(period?.id || '').trim();
    const base = { periodId };
    if (!period || !classData || !student) {
        return { ...base, status: 'skipped_missing_context', message: 'Missing period, class, or student.' };
    }
    let programId = resolveProgramIdFromClassEnrollmentSnapshot(period, classData);
    let termId = resolveTermIdFromClassEnrollmentSnapshot(period, classData);
    if (!programId || !termId) {
        const gaps = await inferProgramTermGapsFromStudentRegistrations(req, classData, student, programId, termId);
        if (!programId) programId = gaps.programId;
        if (!termId) termId = gaps.termId;
    }
    if (!programId) {
        console.warn('[academicLedger] Skipping class_enrolled: no programId for rolling enrollment', {
            periodId: period?.id,
            classId: classData?.id
        });
        return {
            ...base,
            status: 'skipped_no_program',
            message: 'No program could be resolved. Set Allowed program terms on the class, programId on the period, or register the student in a program for this organization.'
        };
    }
    const program = await schoolDataService.getDataById('programs', programId, req.user);
    if (!program) {
        console.warn('[academicLedger] Skipping class_enrolled: program not found', programId);
        return { ...base, status: 'skipped_program_not_found', message: `Program ${programId} was not found or is not accessible.` };
    }
    const eff = String(effectiveDate || period?.startDate || '').trim();
    const subjectId = firstClassCurriculumSubjectId(classData);
    try {
        await academicLedgerService.postClassEnrollment({
            reqUser: req.user,
            student,
            program,
            termId,
            classItem: {
                id: classData.id,
                title: classData.title,
                code: classData.code
            },
            subjectId,
            subjectType: '',
            creditsAttempted: null,
            effectiveDate: eff,
            note: String(note || '').trim(),
            source: {
                module: 'school_class_enrollment',
                eventId: `CEP-${period.id}-rolling`,
                idempotencyKey: `rolling|cep|${period.id}|class_enrolled`
            }
        });
        return { ...base, status: 'posted', message: 'Class enrollment recorded on the academic ledger.' };
    } catch (err) {
        const msg = String(err?.message || err || '');
        if (/duplicate academic idempotency key/i.test(msg)) {
            return { ...base, status: 'already_synced', message: 'Academic ledger already contains this enrollment.' };
        }
        console.error('[academicLedger] postClassEnrollment failed (rolling class):', msg);
        return { ...base, status: 'error', message: msg || 'Academic ledger post failed.' };
    }
}

/**
 * Backfill academic ledger for a rolling period (e.g. after fixing class program data).
 * Patches period programId/termId when inferable from the class.
 */
async function syncAcademicLedgerForEnrollmentPeriod(req, res) {
    try {
        const periodId = toPublicId(req.params?.periodId || req.body?.periodId || '');
        if (!periodId) throw new Error('periodId is required.');
        const period = await schoolDataService.getDataById('classEnrollmentPeriods', periodId, req.user);
        if (!period) throw new Error('Enrollment period not found.');
        const { classData } = await getClassByIdWithOrgCheck(period.classId, req.user);
        assertRollingWorkflowEnabledForClass(req, classData);

        const postedIds = Array.isArray(period?.transactionSummary?.postedTransactionIds)
            ? period.transactionSummary.postedTransactionIds.filter(Boolean)
            : [];
        const statusLower = String(period?.status || '').trim().toLowerCase();
        const isActive = statusLower === 'active';
        if (!postedIds.length && !isActive) {
            return res.status(400).json({
                status: 'error',
                message: 'Sync applies to active enrollment periods or periods with posted finance transactions.'
            });
        }

        const student = await schoolDataService.getDataById('students', period.studentId, req.user);
        if (!student) throw new Error('Student not found for this period.');

        let inferredProg = resolveProgramIdFromClassEnrollmentSnapshot(period, classData);
        let inferredTerm = resolveTermIdFromClassEnrollmentSnapshot(period, classData);
        if (!inferredProg || !inferredTerm) {
            const gaps = await inferProgramTermGapsFromStudentRegistrations(
                req,
                classData,
                student,
                inferredProg,
                inferredTerm
            );
            if (!inferredProg) inferredProg = gaps.programId;
            if (!inferredTerm) inferredTerm = gaps.termId;
        }
        const hasProgOnPeriod = Boolean(toPublicId(period?.programId));
        const hasTermOnPeriod = Boolean(toPublicId(period?.termId));
        let workingPeriod = period;
        if ((!hasProgOnPeriod && inferredProg) || (!hasTermOnPeriod && inferredTerm)) {
            const patched = await schoolDataService.updateData('classEnrollmentPeriods', periodId, {
                programId: toPublicId(period?.programId) || inferredProg || '',
                termId: toPublicId(period?.termId) || inferredTerm || ''
            }, req.user);
            workingPeriod = patched || {
                ...period,
                programId: toPublicId(period?.programId) || inferredProg || '',
                termId: toPublicId(period?.termId) || inferredTerm || ''
            };
        }

        const ledgerResult = await tryPostAcademicLedgerForRollingClassEnrollment({
            req,
            period: workingPeriod,
            classData,
            student,
            effectiveDate: String(workingPeriod?.startDate || '').trim(),
            note: String(workingPeriod?.notes || '').trim()
        });

        if (ledgerResult.status === 'posted' || ledgerResult.status === 'already_synced') {
            return res.json({
                status: 'success',
                message: ledgerResult.message || 'Academic ledger is up to date.',
                academicLedger: ledgerResult,
                data: { period: workingPeriod }
            });
        }

        return res.status(400).json({
            status: 'error',
            message: ledgerResult.message || 'Could not create academic ledger entry.',
            academicLedger: ledgerResult
        });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
}

async function approveClassEnrollmentDraft(req, res) {
  let guardKey = '';
  try {
    const periodId = toPublicId(req.params?.periodId || req.body?.periodId || '');
    if (!periodId) throw new Error('periodId is required.');
    const period = await schoolDataService.getDataById('classEnrollmentPeriods', periodId, req.user);
    if (!period) throw new Error('Enrollment period not found.');

    const { classData } = await getClassByIdWithOrgCheck(period.classId, req.user);
    assertRollingWorkflowEnabledForClass(req, classData);

    const currentStatus = String(period?.status || '').trim().toLowerCase();
    if (!['draft', 'error', 'planned', 'active'].includes(currentStatus)) {
      throw new Error('Only draft enrollment periods can be approved from this endpoint.');
    }
    const alreadyPostedIds = Array.isArray(period?.transactionSummary?.postedTransactionIds)
      ? period.transactionSummary.postedTransactionIds.filter(Boolean)
      : [];
    if (alreadyPostedIds.length && currentStatus !== 'draft') {
      return res.json({
        status: 'success',
        message: 'Enrollment was already approved and posted.',
        data: { period }
      });
    }

    guardKey = idempotencyGuardService.createGuardKey([
      'class_enrollment_draft_approve',
      String(classData?.orgId || '').trim(),
      String(classData?.id || '').trim(),
      periodId
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 20000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Draft approval is already in progress. Please wait.')) return;

    const student = await schoolDataService.getDataById('students', period.studentId, req.user);
    if (!student) throw new Error('Student not found for this draft.');

    const baseDraftItems = parseData(req.body?.draftTransactionItems)
      || period?.transactionSummary?.draftTransactionItems
      || [];
    const editedRows = parseData(req.body?.editedRows) || [];
    const addedRows = parseData(req.body?.addedRows) || [];
    const accountMap = await buildPostableAccountMap(req.user, classData.orgId);
    const finalDraftState = normalizeEnrollmentTransactionDraftState({
      draftTransactionItems: baseDraftItems,
      editedRows,
      addedRows,
      accountMap,
      classData,
      student,
      feeCategory: String(student?.feeCategory || '').trim(),
      startDate: String(req.body?.startDate || period?.startDate || '').trim(),
      externalReference: String(req.body?.authorizationRef || period?.authorizationRef || '').trim(),
      requestUser: req.user
    });

    const postedTransactions = await schoolDataService.addData('globalTransactions', finalDraftState.items, req.user);
    const postedRows = Array.isArray(postedTransactions) ? postedTransactions : [postedTransactions];
    const postedTransactionIds = postedRows
      .map((row) => toPublicId(row?.id || ''))
      .filter(Boolean);
    const currency = String(finalDraftState.previewRows[0]?.currency || 'CAD').trim().toUpperCase() || 'CAD';

    let inferredLedgerProgramId = resolveProgramIdFromClassEnrollmentSnapshot(period, classData);
    let inferredLedgerTermId = resolveTermIdFromClassEnrollmentSnapshot(period, classData);
    if (!inferredLedgerProgramId || !inferredLedgerTermId) {
        const gaps = await inferProgramTermGapsFromStudentRegistrations(
            req,
            classData,
            student,
            inferredLedgerProgramId,
            inferredLedgerTermId
        );
        if (!inferredLedgerProgramId) inferredLedgerProgramId = gaps.programId;
        if (!inferredLedgerTermId) inferredLedgerTermId = gaps.termId;
    }
    const programIdToStore = toPublicId(period?.programId) || inferredLedgerProgramId || '';
    const termIdToStore = toPublicId(period?.termId) || inferredLedgerTermId || '';

    const updated = await schoolDataService.updateData('classEnrollmentPeriods', periodId, {
      startDate: String(req.body?.startDate || period?.startDate || '').trim(),
      endDate: String(req.body?.endDate || period?.endDate || '').trim(),
      status: String(req.body?.status || 'active').trim().toLowerCase() || 'active',
      programId: programIdToStore,
      termId: termIdToStore,
      funderType: String(req.body?.funderType || period?.funderType || '').trim(),
      funderId: String(req.body?.funderId || period?.funderId || '').trim(),
      authorizationRef: String(req.body?.authorizationRef || period?.authorizationRef || '').trim(),
      reasonStart: String(req.body?.reasonStart || period?.reasonStart || '').trim(),
      notes: String(req.body?.notes || period?.notes || '').trim(),
      transactionSummary: {
        mode: 'chargeable',
        currency,
        totalAmount: roundMoney(finalDraftState.totalAmount || 0),
        transactionCount: finalDraftState.previewRows.length,
        draftTransactionItems: finalDraftState.items,
        draftPreviewRows: finalDraftState.previewRows,
        postedTransactionIds,
        postedAt: new Date().toISOString(),
        draftSavedAt: String(period?.transactionSummary?.draftSavedAt || '').trim(),
        note: String(req.body?.draftNote || '').trim()
      }
    }, req.user);

    const periodForLedger = updated || period;
    const { classData: classAfterApprove } = await getClassByIdWithOrgCheck(period.classId, req.user);
    const academicLedger = await tryPostAcademicLedgerForRollingClassEnrollment({
      req,
      period: periodForLedger,
      classData: classAfterApprove,
      student,
      effectiveDate: String(req.body?.startDate || periodForLedger?.startDate || '').trim(),
      note: String(req.body?.notes || periodForLedger?.notes || '').trim()
    });

    const payloadOut = {
      status: 'success',
      message: 'Draft approved and transactions posted.',
      academicLedger,
      data: {
        period: updated || null,
        transactionCount: postedTransactionIds.length,
        transactionTotal: roundMoney(finalDraftState.totalAmount || 0)
      }
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function editClassEnrollmentPeriod(req, res) {
  let guardKey = '';
  try {
    const periodId = toPublicId(req.params?.periodId || req.body?.periodId || '');
    if (!periodId) throw new Error('periodId is required.');
    const periodRow = await schoolDataService.getDataById('classEnrollmentPeriods', periodId, req.user);
    if (!periodRow) throw new Error('Enrollment period not found.');
    const { classData } = await getClassByIdWithOrgCheck(periodRow.classId, req.user);
    assertRollingWorkflowEnabledForClass(req, classData);

    guardKey = idempotencyGuardService.createGuardKey([
      'class_enrollment_period_edit',
      String(classData?.orgId || '').trim(),
      String(classData?.id || '').trim(),
      periodId
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Enrollment period update is already in progress. Please wait.')) return;

    const startDate = String(req.body?.startDate || periodRow?.startDate || '').trim();
    if (!startDate) throw new Error('startDate is required.');
    const endDate = String(req.body?.endDate || '').trim();
    const statusInput = String(req.body?.status || periodRow?.status || 'active').trim().toLowerCase();
    const status = ['draft', 'planned', 'active', 'completed', 'withdrawn', 'cancelled', 'archived', 'error'].includes(statusInput)
      ? statusInput
      : String(periodRow?.status || 'active').trim().toLowerCase();

    const updated = await schoolDataService.updateData('classEnrollmentPeriods', periodId, {
      startDate,
      endDate,
      status,
      funderType: String(req.body?.funderType || periodRow?.funderType || '').trim(),
      funderId: String(req.body?.funderId || periodRow?.funderId || '').trim(),
      authorizationRef: String(req.body?.authorizationRef || periodRow?.authorizationRef || '').trim(),
      reasonStart: String(req.body?.reasonStart || periodRow?.reasonStart || '').trim()
    }, req.user);

    const payloadOut = {
      status: 'success',
      message: 'Enrollment period updated.',
      data: updated || null
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function removeOrRollbackClassEnrollmentPeriod(req, res) {
  let guardKey = '';
  try {
    const periodId = toPublicId(req.params?.periodId || req.body?.periodId || '');
    if (!periodId) throw new Error('periodId is required.');
    const periodRow = await schoolDataService.getDataById('classEnrollmentPeriods', periodId, req.user);
    if (!periodRow) throw new Error('Enrollment period not found.');
    const { classData } = await getClassByIdWithOrgCheck(periodRow.classId, req.user);
    assertRollingWorkflowEnabledForClass(req, classData);

    guardKey = idempotencyGuardService.createGuardKey([
      'class_enrollment_period_remove_or_rollback',
      String(classData?.orgId || '').trim(),
      String(classData?.id || '').trim(),
      periodId
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Delete/Rollback is already in progress. Please wait.')) return;

    const currentStatus = String(periodRow?.status || '').trim().toLowerCase();
    const postedTransactionIds = Array.isArray(periodRow?.transactionSummary?.postedTransactionIds)
      ? periodRow.transactionSummary.postedTransactionIds.map((id) => toPublicId(id)).filter(Boolean)
      : [];

    // Draft periods should be deletable even if they carry historical transaction references
    // from a previous rollback (for statement traceability).
    if (currentStatus === 'draft' || !postedTransactionIds.length) {
      await schoolDataService.deleteData('classEnrollmentPeriods', periodId, req.user);
      const payloadOut = { status: 'success', message: 'Draft enrollment deleted before posting.' };
      idempotencyGuardService.completeGuard(guardKey, payloadOut);
      return res.json(payloadOut);
    }

    const rollback = await registrationIntegrityService.rollbackRegistrationSideEffects({
      registrationId: periodId,
      transactionIds: postedTransactionIds,
      academicEntryIds: [],
      reqUser: req.user,
      reason: `Class enrollment rollback requested for ${periodId}.`,
      reverseEventPrefix: 'CLSENRREV'
    });
    const rollbackSucceeded = Array.isArray(rollback?.issues) && rollback.issues.length === 0;

    const reversalIds = Array.isArray(rollback?.reversalIds) ? rollback.reversalIds.map((id) => toPublicId(id)).filter(Boolean) : [];
    // Return the enrollment to an editable draft after undoing posting side-effects.
    // Users can then fix mistakes and re-post, or delete the draft.
    const nextStatus = rollbackSucceeded ? 'draft' : 'error';
    const existingReasonEnd = String(periodRow?.reasonEnd || '').trim();
    const rollbackNote = rollbackSucceeded
      ? 'Rolled back posted transactions; returned to draft.'
      : `Rollback issues: ${(rollback?.issues || []).join(' | ')}`;

    const updated = await schoolDataService.updateData('classEnrollmentPeriods', periodId, {
      status: nextStatus,
      // Drafts should be editable; clear endDate so users can adjust.
      endDate: '',
      reasonEnd: [existingReasonEnd, rollbackNote].filter(Boolean).join(' | '),
      transactionSummary: {
        ...(periodRow?.transactionSummary || {}),
        // Keep original posted IDs for audit/statement traceability.
        postedTransactionIds: postedTransactionIds,
        reversalIds: Array.from(new Set([
          ...(Array.isArray(periodRow?.transactionSummary?.reversalIds) ? periodRow.transactionSummary.reversalIds : []),
          ...reversalIds
        ])),
        postedAt: '',
        rollbackAt: new Date().toISOString()
      }
    }, req.user);

    const payloadOut = {
      status: rollbackSucceeded ? 'success' : 'warning',
      message: rollbackSucceeded
        ? 'Posted enrollment was rolled back and returned to draft.'
        : `Rollback completed with issues: ${(rollback?.issues || []).join(' | ')}`,
      data: updated || null
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function createClassEnrollmentPeriod(req, res) {
  let guardKey = '';
  try {
    const classId = toPublicId(req.body?.classId || req.body?.id || req.params?.classId || '');
    if (!classId) throw new Error('classId is required.');
    const { classData } = await getClassByIdWithOrgCheck(classId, req.user);
    assertRollingWorkflowEnabledForClass(req, classData);

    guardKey = idempotencyGuardService.createGuardKey([
        'class_enrollment_period_create',
        String(classData?.orgId || '').trim(),
        String(classData?.id || '').trim(),
        {
            studentId: toPublicId(req.body?.studentId || ''),
            startDate: String(req.body?.startDate || '').trim(),
            endDate: String(req.body?.endDate || '').trim(),
            status: String(req.body?.status || '').trim().toLowerCase()
        }
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
        key: guardKey,
        runningTtlMs: 90000,
        replayTtlMs: 15000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Enrollment period creation is already in progress. Please wait.')) return;

    const studentIdEarly = toPublicId(req.body?.studentId || '');
    if (!studentIdEarly) throw new Error('studentId is required.');
    const studentRow = await schoolDataService.getDataById('students', studentIdEarly, req.user);
    if (!studentRow) throw new Error('Student not found.');
    if (!idsEqual(studentRow?.orgId, classData?.orgId)) {
      throw new Error('Student organization does not match the class organization.');
    }
    await applyRollingEnrollmentResolutionFromRegistrations(req, classData, studentRow);
    const enrollmentPayload = buildClassEnrollmentCreatePayloadFromRequest(classData, req);
    const effDate = String(enrollmentPayload.startDate || '').trim() || new Date().toISOString().slice(0, 10);
    await assertRollingEnrollmentPrerequisitesOrThrow(req, classData, studentRow, req.body?.programId, req.body?.termId, effDate);

    const result = await schoolDataService.createClassEnrollmentPeriod(
      enrollmentPayload,
      req.user
    );
    const createdPeriod = result?.period || null;
    let academicLedger = null;
    if (createdPeriod && String(createdPeriod.status || '').trim().toLowerCase() === 'active') {
      const { classData: classAfterCreate } = await getClassByIdWithOrgCheck(classId, req.user);
      academicLedger = await tryPostAcademicLedgerForRollingClassEnrollment({
        req,
        period: createdPeriod,
        classData: classAfterCreate,
        student: studentRow,
        effectiveDate: enrollmentPayload.startDate,
        note: enrollmentPayload.notes
      });
    }

    const payloadOut = {
      status: 'success',
      message: 'Enrollment period created.',
      academicLedger,
      data: result
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function closeClassEnrollmentPeriod(req, res) {
  let guardKey = '';
  try {
    const periodId = toPublicId(req.params?.periodId || req.body?.periodId || '');
    if (!periodId) throw new Error('periodId is required.');
    const periodRow = await schoolDataService.getDataById('classEnrollmentPeriods', periodId, req.user);
    if (!periodRow) throw new Error('Enrollment period not found.');
    const { classData } = await getClassByIdWithOrgCheck(periodRow.classId, req.user);
    assertRollingWorkflowEnabledForClass(req, classData);

    guardKey = idempotencyGuardService.createGuardKey([
        'class_enrollment_period_close',
        String(classData?.orgId || '').trim(),
        String(classData?.id || '').trim(),
        periodId,
        {
            endDate: String(req.body?.endDate || '').trim(),
            status: String(req.body?.status || '').trim().toLowerCase()
        }
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
        key: guardKey,
        runningTtlMs: 90000,
        replayTtlMs: 12000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Enrollment period close is already in progress. Please wait.')) return;

    const updated = await schoolDataService.closeClassEnrollmentPeriod(periodId, {
      endDate: String(req.body?.endDate || '').trim(),
      status: String(req.body?.status || '').trim(),
      reasonEnd: String(req.body?.reasonEnd || '').trim()
    }, req.user);

    const payloadOut = {
      status: 'success',
      message: 'Enrollment period closed.',
      data: updated
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function reopenClassEnrollmentPeriod(req, res) {
  let guardKey = '';
  try {
    const periodId = toPublicId(req.params?.periodId || req.body?.periodId || '');
    if (!periodId) throw new Error('periodId is required.');
    const periodRow = await schoolDataService.getDataById('classEnrollmentPeriods', periodId, req.user);
    if (!periodRow) throw new Error('Enrollment period not found.');
    const { classData } = await getClassByIdWithOrgCheck(periodRow.classId, req.user);
    assertRollingWorkflowEnabledForClass(req, classData);

    guardKey = idempotencyGuardService.createGuardKey([
        'class_enrollment_period_reopen',
        String(classData?.orgId || '').trim(),
        String(classData?.id || '').trim(),
        periodId,
        {
            startDate: String(req.body?.startDate || '').trim(),
            endDate: String(req.body?.endDate || '').trim(),
            status: String(req.body?.status || '').trim().toLowerCase()
        }
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
        key: guardKey,
        runningTtlMs: 90000,
        replayTtlMs: 12000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Enrollment period reopen is already in progress. Please wait.')) return;

    const result = await schoolDataService.reopenClassEnrollmentPeriodViaNewPeriod(periodId, {
      startDate: String(req.body?.startDate || '').trim(),
      endDate: String(req.body?.endDate || '').trim(),
      status: String(req.body?.status || '').trim(),
      funderType: String(req.body?.funderType || '').trim(),
      funderId: String(req.body?.funderId || '').trim(),
      authorizationRef: String(req.body?.authorizationRef || '').trim(),
      reasonStart: String(req.body?.reasonStart || '').trim(),
      reasonEnd: String(req.body?.reasonEnd || '').trim(),
      closeReason: String(req.body?.closeReason || '').trim(),
      allowOverlap: parseBoolean(req.body?.allowOverlap, false)
    }, req.user);

    const payloadOut = {
      status: 'success',
      message: 'Enrollment period reopened with a new period.',
      data: result
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function checkClassEnrollmentPeriodOverlap(req, res) {
  try {
    const classId = toPublicId(req.body?.classId || req.params?.classId || '');
    if (!classId) throw new Error('classId is required.');
    const { classData } = await getClassByIdWithOrgCheck(classId, req.user);
    assertRollingWorkflowEnabledForClass(req, classData);
    const result = await schoolDataService.checkClassEnrollmentPeriodOverlap({
      classId: classData.id,
      studentId: toPublicId(req.body?.studentId || ''),
      startDate: String(req.body?.startDate || '').trim(),
      endDate: String(req.body?.endDate || '').trim(),
      excludePeriodId: toPublicId(req.body?.excludePeriodId || ''),
      statuses: toArrayOfStrings(req.body?.statuses)
    }, req.user);
    return res.json({
      status: 'success',
      message: 'Overlap check completed.',
      data: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function evaluateClassEnrollmentReentry(req, res) {
  try {
    const classId = toPublicId(req.body?.classId || req.params?.classId || '');
    if (!classId) throw new Error('classId is required.');
    const { classData } = await getClassByIdWithOrgCheck(classId, req.user);
    assertRollingWorkflowEnabledForClass(req, classData);
    const result = await schoolDataService.evaluateClassEnrollmentReentryRules({
      classId: classData.id,
      studentId: toPublicId(req.body?.studentId || ''),
      startDate: String(req.body?.startDate || '').trim(),
      excludePeriodId: toPublicId(req.body?.excludePeriodId || '')
    }, req.user);
    return res.json({
      status: 'success',
      message: 'Re-entry rules evaluated.',
      data: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function closeClassCycle(req, res) {
  let guardKey = '';
  try {
    const classId = toPublicId(req.params?.classId || req.body?.classId || '');
    if (!classId) throw new Error('classId is required.');
    const { classData } = await getClassByIdWithOrgCheck(classId, req.user);
    assertRollingWorkflowEnabledForClass(req, classData);

    guardKey = idempotencyGuardService.createGuardKey([
        'class_cycle_close',
        String(classData?.orgId || '').trim(),
        String(classData?.id || '').trim(),
        {
            cycleEndDate: String(req.body?.cycleEndDate || '').trim(),
            isClosedForNewEnrollment: parseBoolean(req.body?.isClosedForNewEnrollment, true)
        }
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
        key: guardKey,
        runningTtlMs: 90000,
        replayTtlMs: 12000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Class cycle close is already in progress. Please wait.')) return;

    const updated = await schoolDataService.closeClassCycle(classData.id, {
      cycleEndDate: String(req.body?.cycleEndDate || '').trim(),
      isClosedForNewEnrollment: parseBoolean(req.body?.isClosedForNewEnrollment, true)
    }, req.user);

    const payloadOut = {
      status: 'success',
      message: 'Class cycle closed.',
      data: updated
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function createNextClassCycleFromTemplate(req, res) {
  let guardKey = '';
  try {
    const classId = toPublicId(req.params?.classId || req.body?.classId || '');
    if (!classId) throw new Error('classId is required.');
    const { classData } = await getClassByIdWithOrgCheck(classId, req.user);
    assertRollingWorkflowEnabledForClass(req, classData);

    const input = {
      cycleStartDate: String(req.body?.cycleStartDate || '').trim(),
      cycleEndDate: String(req.body?.cycleEndDate || '').trim(),
      currentCycleEndDate: String(req.body?.currentCycleEndDate || '').trim(),
      closeCurrentCycle: parseBoolean(req.body?.closeCurrentCycle, true),
      carryForwardEligibleStudents: parseBoolean(req.body?.carryForwardEligibleStudents, true),
      nextCycleStatus: String(req.body?.nextCycleStatus || '').trim()
    };

    guardKey = idempotencyGuardService.createGuardKey([
        'class_cycle_create_next',
        String(classData?.orgId || '').trim(),
        String(classData?.id || '').trim(),
        input
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
        key: guardKey,
        runningTtlMs: 180000,
        replayTtlMs: 15000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Next cycle creation is already in progress. Please wait.')) return;

    const result = await schoolDataService.createNextClassCycleFromTemplate(classData.id, input, req.user);
    const payloadOut = {
      status: 'success',
      message: 'Next class cycle created.',
      data: result
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function carryForwardClassCycleStudents(req, res) {
  let guardKey = '';
  try {
    const fromClassId = toPublicId(req.body?.fromClassId || '');
    const toClassId = toPublicId(req.body?.toClassId || '');
    if (!fromClassId || !toClassId) throw new Error('fromClassId and toClassId are required.');
    const { classData: fromClass } = await getClassByIdWithOrgCheck(fromClassId, req.user);
    const { classData: toClass } = await getClassByIdWithOrgCheck(toClassId, req.user);
    assertRollingWorkflowEnabledForClass(req, fromClass);
    assertRollingWorkflowEnabledForClass(req, toClass);

    const input = {
      fromClassId: fromClass.id,
      toClassId: toClass.id,
      boundaryDate: String(req.body?.boundaryDate || '').trim()
    };

    guardKey = idempotencyGuardService.createGuardKey([
        'class_cycle_carry_forward',
        String(fromClass?.orgId || '').trim(),
        input
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
        key: guardKey,
        runningTtlMs: 180000,
        replayTtlMs: 15000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Carry-forward operation is already in progress. Please wait.')) return;

    const result = await schoolDataService.carryForwardClassCycleStudents(input, req.user);
    const payloadOut = {
      status: 'success',
      message: 'Carry-forward operation completed.',
      data: result
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function splitClassEnrollmentPeriodsForCycleBoundary(req, res) {
  let guardKey = '';
  try {
    const fromClassId = toPublicId(req.body?.fromClassId || '');
    const toClassId = toPublicId(req.body?.toClassId || '');
    if (!fromClassId || !toClassId) throw new Error('fromClassId and toClassId are required.');
    const { classData: fromClass } = await getClassByIdWithOrgCheck(fromClassId, req.user);
    const { classData: toClass } = await getClassByIdWithOrgCheck(toClassId, req.user);
    assertRollingWorkflowEnabledForClass(req, fromClass);
    assertRollingWorkflowEnabledForClass(req, toClass);

    const input = {
      fromClassId: fromClass.id,
      toClassId: toClass.id,
      boundaryDate: String(req.body?.boundaryDate || '').trim(),
      note: String(req.body?.note || '').trim()
    };

    guardKey = idempotencyGuardService.createGuardKey([
        'class_cycle_split_boundary',
        String(fromClass?.orgId || '').trim(),
        input
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
        key: guardKey,
        runningTtlMs: 180000,
        replayTtlMs: 15000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Boundary split is already in progress. Please wait.')) return;

    const result = await schoolDataService.splitClassEnrollmentPeriodsForCycleBoundary(input, req.user);
    const payloadOut = {
      status: 'success',
      message: 'Boundary split completed.',
      data: result
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

// --- SESSION EXECUTION & ATTENDANCE ---

async function manageSession1(req, res) {
    try {
        const { id: classId, sessionId } = req.params;
        
        // 1. Fetch Core Data
        const classData = await schoolDataService.getDataById('classes', classId, req.user);
        if (!classData) throw new Error('Class not found');
        
        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const session = sessions.find(s => s.sessionId === sessionId);
        if (!session) throw new Error('Session not found');

        // --- NEW: Calculate Previous and Next Sessions for Navigation ---
        const sortedSessions = [...sessions].sort((a, b) => new Date(`${a.date}T${a.startTime}`) - new Date(`${b.date}T${b.startTime}`));
        const currentIndex = sortedSessions.findIndex(s => s.sessionId === sessionId);
        
        const prevSessionId = currentIndex > 0 ? sortedSessions[currentIndex - 1].sessionId : null;
        const nextSessionId = currentIndex < sortedSessions.length - 1 ? sortedSessions[currentIndex + 1].sessionId : null;
        // ----------------------------------------------------------------

        // 2. Resolve Student Names for Attendance
        const [persons, students] = await Promise.all([
            dataService.fetchData('persons', {}, req.user, PERSON_QUERY_OPTIONS),
            schoolDataService.fetchData('students', {}, req.user)
        ]);
        
        if (!session.roster) session.roster = [];
        const rosterResolution = await resolveSessionRosterPersonIds({
            classData,
            session,
            reqUser: req.user,
            students
        });
        const activePersonIds = rosterResolution?.personIds instanceof Set ? rosterResolution.personIds : new Set();

        // For rolling classes, keep roster aligned with canonical enrollment windows for session date.
        if (getClassRegistrationModeKey(classData) === 'rolling') {
            session.roster = (Array.isArray(session.roster) ? session.roster : [])
                .filter((row) => {
                    const pid = cleanPersonId(row?.personId);
                    return pid && activePersonIds.has(pid);
                });
        }
        
        activePersonIds.forEach((pid) => {
            if (!session.roster.find((r) => idsEqual(r.personId, pid))) {
                session.roster.push({ personId: pid, attendance: 'present', notes: '', comments: [] }); 
            }
        });

        const enrichedRoster = session.roster.map(r => {
            const pid = cleanPersonId(r.personId);
            const person = persons.find((p) => idsEqual(p.id, pid));
            const displayName = person ? `${person.name?.first || ''} ${person.name?.last || ''}`.trim() : 'Unknown Student';
            return { ...r, personId: pid, name: displayName };
        });

        mergeGradebookScorePersonsIntoEnrichedRoster(enrichedRoster, session, persons, {
            allowedPersonIds: getClassRegistrationModeKey(classData) === 'rolling'
                ? new Set(Array.from(activePersonIds).map((id) => String(id)))
                : null
        });

        enrichedRoster.sort((a, b) => a.name.localeCompare(b.name));
        session.roster = enrichedRoster;

        // 3. Fetch Curriculum Content
        const allSubjects = await schoolDataService.fetchData('subjects', {}, req.user);
        const classSubjects = (classData.curriculum?.subjects || []).map(subMap => {
            const fullSubject = allSubjects.find((s) => idsEqual(s.id, subMap.subjectId));
            return {
                ...subMap,
                description: fullSubject ? fullSubject.description : 'No description available.',
                modules: fullSubject ? (fullSubject.modules || []) : []
            };
        });

        const orgPolicyLayerSm1 = await attendanceMatrixPolicyModel.getPolicyForOrg(
            classData?.orgId || getActiveOrgIdOrThrow(req.user)
        );
        const attendanceMatrixPolicyResolved = attendanceMatrixMetricsService.resolvePolicy(classData, orgPolicyLayerSm1);

        res.render('school/class/sessionManager', {
            title: `Manage Session: ${session.date}`,
            classData,
            session,
            classSubjects,
            prevSessionId,    // Passed to EJS
            nextSessionId,    // Passed to EJS
            attendanceMatrixPolicyResolved,
            user: req.user
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

async function saveSession1(req, res) {
    try {
        const { id: classId, sessionId } = req.params;
        const { status, notes, room, roster } = req.body; // <--- EXTRACT ROOM 

        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const sessionIndex = sessions.findIndex(s => s.sessionId === sessionId);
        if (sessionIndex === -1) throw new Error('Session not found');

        // Update general session data
        sessions[sessionIndex].status = status || sessions[sessionIndex].status;
        sessions[sessionIndex].notes = notes !== undefined ? notes : sessions[sessionIndex].notes;
        // --- NEW: Save the room update ---
        if (room !== undefined) sessions[sessionIndex].room = room.trim();

        if (roster) {
            const incomingRoster = typeof roster === 'string' ? JSON.parse(roster) : roster;
            const existingRoster = sessions[sessionIndex].roster || [];
            
            // FIX: Merge the new attendance data with the existing records to preserve comments!
            sessions[sessionIndex].roster = incomingRoster.map(incRec => {
                const incomingPersonId = cleanPersonId(incRec.personId);
                const existRec = existingRoster.find((r) => idsEqual(r.personId, incomingPersonId)) || {};
                return {
                    personId: incomingPersonId,
                    attendance: incRec.attendance,
                    lateMinutes: incRec.lateMinutes,
                    earlyLeaveMinutes: incRec.earlyLeaveMinutes,
                    excuseRef: incRec.excuseRef,
                    notes: existRec.notes || '',       // Preserve existing student-specific notes if any
                    comments: existRec.comments || []  // PRESERVE the interactive admin comments!
                };
            });
        }

        // Save back to file via Data Service
        await schoolDataService.saveClassSessions(classId, sessions, req.user);
        
        // Rebuild index in case the session was cancelled
        const indexService = require('../../services/school/schoolIndexService');
        await indexService.rebuildIndexesForClass(classId);

        if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Session data saved successfully.' });
        res.redirect(`/school/classes/sessions/${classId}/${sessionId}`);
    } catch (error) {
        if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
        res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

// --- SESSION EXECUTION & ATTENDANCE ---

async function manageSession(req, res) {
    try {
        const { id: classId, sessionId } = req.params;
        
        // 1. Fetch Core Data
        const { classData } = await getClassByIdWithOrgCheck(classId, req.user);
        const sessionStatusMeta = await getSessionStatusMetaForOrg(classData?.orgId || getActiveOrgIdOrThrow(req.user));
        
        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const session = sessions.find(s => s.sessionId === sessionId);
        if (!session) throw new Error('Session not found');

        // --- Calculate Previous and Next Sessions for Navigation ---
        const sortedSessions = [...sessions].sort((a, b) => new Date(`${a.date}T${a.startTime}`) - new Date(`${b.date}T${b.startTime}`));
        const currentIndex = sortedSessions.findIndex(s => s.sessionId === sessionId);
        
        const prevSessionId = currentIndex > 0 ? sortedSessions[currentIndex - 1].sessionId : null;
        const nextSessionId = currentIndex < sortedSessions.length - 1 ? sortedSessions[currentIndex + 1].sessionId : null;

        // --- Lock Security Check ---
        const isSessionLocked = session.locked === true || String(session.locked) === 'true';
        let canOverride = await adminChekersService.isAdminForRequestAsync(
            req.user,
            SECTIONS.SCHOOL_CLASSES,
            OPERATIONS.UPDATE,
            { section: { id: SECTIONS.SCHOOL_CLASSES } }
        );
        
        const isReadOnly = isSessionLocked && !canOverride;

        // 2. Resolve Student Names for Attendance
        const [persons, students] = await Promise.all([
            dataService.fetchData('persons', {}, req.user, PERSON_QUERY_OPTIONS),
            schoolDataService.fetchData('students', {}, req.user)
        ]);
        
        if (!session.roster) session.roster = [];
        const rosterResolution = await resolveSessionRosterPersonIds({
            classData,
            session,
            reqUser: req.user,
            students
        });
        const activePersonIds = rosterResolution?.personIds instanceof Set ? rosterResolution.personIds : new Set();

        if (getClassRegistrationModeKey(classData) === 'rolling') {
            session.roster = (Array.isArray(session.roster) ? session.roster : [])
                .filter((row) => {
                    const pid = cleanPersonId(row?.personId);
                    return pid && activePersonIds.has(pid);
                });
        }

        activePersonIds.forEach((pid) => {
            if (!session.roster.find((r) => idsEqual(r.personId, pid))) {
                session.roster.push({ personId: pid, attendance: 'present', notes: '', comments: [] }); 
            }
        });

        const enrichedRoster = session.roster.map(r => {
            const pid = cleanPersonId(r.personId);
            const person = persons.find((p) => idsEqual(p.id, pid));
            const displayName = person ? `${person.name?.first || ''} ${person.name?.last || ''}`.trim() : 'Unknown Student';
            return { ...r, personId: pid, name: displayName };
        });

        mergeGradebookScorePersonsIntoEnrichedRoster(enrichedRoster, session, persons, {
            allowedPersonIds: getClassRegistrationModeKey(classData) === 'rolling'
                ? new Set(Array.from(activePersonIds).map((id) => String(id)))
                : null
        });

        enrichedRoster.sort((a, b) => a.name.localeCompare(b.name));
        session.roster = enrichedRoster;

        // 3. Fetch Curriculum Content + Session Content/Exam Stream
        const [allSubjects, examAllocations, examTemplates, examQuestions, examAssignments, studentsForExamStart, reportAssignments, reportTemplates] = await Promise.all([
            schoolDataService.fetchData('subjects', {}, req.user),
            schoolDataService.fetchData('examAllocations', { classId__eq: classId }, req.user),
            schoolDataService.fetchData('examTemplates', {}, req.user),
            schoolDataService.fetchData('examQuestions', {}, req.user),
            schoolDataService.fetchData('examAssignments', { classId__eq: classId }, req.user),
            schoolDataService.fetchData('students', {}, req.user),
            schoolDataService.fetchData('reportAssignments', { classId__eq: classId }, req.user),
            schoolDataService.fetchData('reportTemplates', {}, req.user)
        ]);
        const currentUserPersonId = String(req.user?.personId || '').trim();
        const ownedStudentIdsForExamStart = new Set((Array.isArray(studentsForExamStart) ? studentsForExamStart : [])
            .filter((row) => idsEqual(row?.personId, currentUserPersonId))
            .map((row) => String(row?.id || '').trim())
            .filter(Boolean));
        const isStaffForExamStart = adminChekersService.isAdmin(req.user)
            || isUserInstructorOnClass(classData, req.user?.personId);
        const classSubjects = (classData.curriculum?.subjects || []).map(subMap => {
            const fullSubject = allSubjects.find((s) => idsEqual(s.id, subMap.subjectId));
            return {
                ...subMap,
                description: fullSubject ? fullSubject.description : 'No description available.',
                modules: fullSubject ? (fullSubject.modules || []) : []
            };
        });

        const sessionContentItems = normalizeSessionContentItems(session?.contentItems || []);
        const sessionContentOrder = normalizeSessionContentOrder(session?.contentOrder || []);
        const templateById = new Map((Array.isArray(examTemplates) ? examTemplates : []).map((row) => [String(row?.id || '').trim(), row]));
        const questionsByRevisionId = new Map();
        (Array.isArray(examQuestions) ? examQuestions : []).forEach((row) => {
            const revisionId = String(row?.revisionId || '').trim();
            if (!revisionId) return;
            if (!questionsByRevisionId.has(revisionId)) questionsByRevisionId.set(revisionId, []);
            questionsByRevisionId.get(revisionId).push(row);
        });
        questionsByRevisionId.forEach((rows, key) => {
            rows.sort((a, b) => Number(a?.sequenceNo || 0) - Number(b?.sequenceNo || 0));
            questionsByRevisionId.set(key, rows);
        });
        const assignmentsByAllocationId = new Map();
        (Array.isArray(examAssignments) ? examAssignments : []).forEach((row) => {
            const allocationId = String(row?.allocationId || '').trim();
            if (!allocationId) return;
            if (!assignmentsByAllocationId.has(allocationId)) assignmentsByAllocationId.set(allocationId, []);
            assignmentsByAllocationId.get(allocationId).push(row);
        });

        const sessionExamContentItems = (Array.isArray(examAllocations) ? examAllocations : [])
            .filter((row) => {
                const status = String(row?.status || '').trim().toLowerCase();
                if (['cancelled', 'archived'].includes(status)) return false;
                const sourceSessionId = String(
                    row?.extensions?.sourceSession?.sessionId
                    || row?.extensions?.sourceSession?.id
                    || row?.sourceSessionId
                    || ''
                ).trim();
                if (sourceSessionId) return idsEqual(sourceSessionId, sessionId);
                return resolveSessionExamLinkByDateTime(row, session);
            })
            .map((row) => {
                const allocationId = String(row?.id || '').trim();
                const templateId = String(row?.templateId || '').trim();
                const revisionId = String(row?.revisionId || '').trim();
                const template = templateById.get(templateId) || null;
                const questionRows = questionsByRevisionId.get(revisionId) || [];
                const linkedAssignments = (assignmentsByAllocationId.get(allocationId) || [])
                    .slice()
                    .sort((a, b) => String(b?.audit?.lastUpdateDateTime || b?.audit?.createDateTime || '')
                        .localeCompare(String(a?.audit?.lastUpdateDateTime || a?.audit?.createDateTime || '')));
                const myTakeAssignment = linkedAssignments.find((assignmentRow) => {
                    const st = String(assignmentRow?.status || '').trim().toLowerCase();
                    if (st === 'cancelled') return false;
                    return ownedStudentIdsForExamStart.has(String(assignmentRow?.studentId || '').trim())
                        && idsEqual(assignmentRow?.classId, classId);
                }) || null;
                let startUrl;
                if (myTakeAssignment) {
                    startUrl = `/school/exams/take/${encodeURIComponent(String(myTakeAssignment.id || '').trim())}?autostart=1`;
                } else if (isStaffForExamStart) {
                    const q = new URLSearchParams({ classId: String(classId || '').trim(), sessionId: String(sessionId || '').trim() });
                    startUrl = `/school/exams/allocations/${encodeURIComponent(allocationId)}/simulate?${q.toString()}`;
                } else if (ownedStudentIdsForExamStart.size > 0) {
                    startUrl = `/school/exams/allocations/${encodeURIComponent(allocationId)}`;
                } else {
                    const q = new URLSearchParams({ classId: String(classId || '').trim(), sessionId: String(sessionId || '').trim() });
                    startUrl = `/school/exams/allocations/${encodeURIComponent(allocationId)}/simulate?${q.toString()}`;
                }
                const time = normalizeClockTime(
                    row?.extensions?.sourceSession?.startTime
                    || row?.windowStartLocalTime
                    || row?.scheduling?.windowStartLocalTime
                    || session?.startTime
                );
                return {
                    id: `exam:${allocationId}`,
                    type: 'exam',
                    title: String(row?.allocationName || template?.title || allocationId || 'Exam').trim(),
                    time,
                    allocationId,
                    templateId,
                    revisionId,
                    status: String(row?.status || '').trim().toLowerCase() || 'scheduled',
                    questions: questionRows.map((q) => ({
                        id: String(q?.id || '').trim(),
                        sequenceNo: Number(q?.sequenceNo || 0),
                        questionType: String(q?.questionType || '').trim().toLowerCase(),
                        objectiveMode: String(q?.objectiveMode || '').trim().toLowerCase(),
                        promptText: String(q?.promptText || '').trim(),
                        promptHtml: String(q?.promptHtml || '').trim(),
                        answerOptions: Array.isArray(q?.objectiveOptions) ? q.objectiveOptions.map((opt) => ({
                            id: String(opt?.id || '').trim(),
                            text: String(opt?.text || '').trim(),
                            isCorrect: opt?.isCorrect === true
                        })) : [],
                        acceptedOptionIds: Array.isArray(q?.acceptedOptionIds) ? q.acceptedOptionIds.map((v) => String(v || '').trim()).filter(Boolean) : []
                    })),
                    links: {
                        assignment: `/school/exams/allocations/${encodeURIComponent(allocationId)}`,
                        allocationEdit: `/school/exams/allocations/${encodeURIComponent(allocationId)}/edit`,
                        start: startUrl,
                        review: `/school/exams/teacher-assignments/${encodeURIComponent(allocationId)}`,
                        openAllocation: `/school/exams/allocations/${encodeURIComponent(allocationId)}/open`,
                        teacherQueue: `/school/exams/teacher-assignments/${encodeURIComponent(allocationId)}`,
                        allocation: `/school/exams/allocations/${encodeURIComponent(allocationId)}`,
                        template: templateId ? `/school/exams/templates/${encodeURIComponent(templateId)}` : ''
                    }
                };
            });

        const combinedSessionContent = sortSessionContentItemsByOrder(
            [...sessionContentItems, ...sessionExamContentItems],
            sessionContentOrder
        );

        const reportTemplateById = new Map(
            (Array.isArray(reportTemplates) ? reportTemplates : [])
                .map((row) => [String(row?.id || '').trim(), row])
                .filter(([id]) => Boolean(id))
        );
        const rosterPersonIdsForReports = new Set(
            (Array.isArray(session.roster) ? session.roster : [])
                .map((r) => cleanPersonId(r?.personId))
                .filter(Boolean)
        );
        const ownedStudentPersonIdsForReports = new Set(
            (Array.isArray(studentsForExamStart) ? studentsForExamStart : [])
                .filter((row) => ownedStudentIdsForExamStart.has(String(row?.id || '').trim()))
                .map((row) => String(row?.personId || '').trim())
                .filter(Boolean)
        );
        const isReportAdminViewer = adminChekersService.isAdmin(req.user);
        const sessionReportAssignmentRows = [];
        for (const assignment of (Array.isArray(reportAssignments) ? reportAssignments : [])) {
            if (!idsEqual(assignment?.orgId, classData?.orgId)) continue;
            if (!reportAssignmentSessionUtils.reportAssignmentMatchesSession(assignment, {
                classId,
                sessionId,
                sessionDate: session?.date
            })) continue;

            const templateRow = reportTemplateById.get(String(assignment.templateId || '').trim()) || null;
            const templateTitle = String(templateRow?.title || assignment.templateId || 'Report').trim();
            const scope = reportAssignmentSessionUtils.inferAssignmentReportScope(assignment);
            const targetType = reportAssignmentSessionUtils.inferAssignmentTargetType(assignment);
            const timeLabel = reportAssignmentSessionUtils.formatReportAssignmentTimeWindow(assignment);

            let href = '';
            const actionLabel = 'Open';
            const teacherIds = Array.isArray(assignment.teacherIds) ? assignment.teacherIds : [];
            const isAssignedTeacher = teacherIds.some((tid) => idsEqual(tid, currentUserPersonId));

            if (isReportAdminViewer) {
                const params = new URLSearchParams();
                if (isAssignedTeacher) {
                    params.set('teacherId', String(currentUserPersonId || '').trim());
                } else {
                    const fallbackTeacher = String((assignment.teacherIds || [])[0] || '').trim();
                    if (fallbackTeacher) params.set('teacherId', fallbackTeacher);
                }
                href = `/school/reports/instances/start/${encodeURIComponent(String(assignment.id || '').trim())}?${params.toString()}`;
            } else if (isAssignedTeacher) {
                const params = new URLSearchParams();
                params.set('teacherId', String(currentUserPersonId || '').trim());
                href = `/school/reports/instances/start/${encodeURIComponent(String(assignment.id || '').trim())}?${params.toString()}`;
            } else {
                let studentHit = false;
                if (scope === 'selected_students') {
                    const targets = Array.isArray(assignment.targetStudentIds) ? assignment.targetStudentIds : [];
                    studentHit = [...ownedStudentIdsForExamStart].some((sid) => targets.some((t) => idsEqual(t, sid)));
                } else if (scope === 'each_student') {
                    studentHit = [...ownedStudentPersonIdsForReports].some((pid) => rosterPersonIdsForReports.has(pid));
                }
                if (studentHit) {
                    const params = new URLSearchParams();
                    params.set('studentId', String(currentUserPersonId || '').trim());
                    const fallbackTeacher = String((assignment.teacherIds || [])[0] || '').trim();
                    if (fallbackTeacher) params.set('teacherId', fallbackTeacher);
                    href = `/school/reports/instances/start/${encodeURIComponent(String(assignment.id || '').trim())}?${params.toString()}`;
                }
            }

            if (!href) continue;

            sessionReportAssignmentRows.push({
                id: String(assignment.id || '').trim(),
                title: templateTitle,
                scopeLabel: reportAssignmentSessionUtils.scopeDisplayLabel(scope),
                targetTypeLabel: targetType === 'date' ? 'Date' : 'Session',
                timeLabel,
                href,
                actionLabel
            });
        }
        sessionReportAssignmentRows.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''))
            || String(a.id || '').localeCompare(String(b.id || '')));

        const orgPolicyLayerMs = await attendanceMatrixPolicyModel.getPolicyForOrg(
            classData?.orgId || getActiveOrgIdOrThrow(req.user)
        );
        const attendanceMatrixPolicyResolved = attendanceMatrixMetricsService.resolvePolicy(classData, orgPolicyLayerMs);

        res.render('school/class/sessionManager', {
            title: `Manage Session: ${session.date}`,
            classData,
            session,
            classSubjects,
            sessionContentItems,
            sessionContentOrder,
            sessionExamContentItems,
            combinedSessionContent,
            sessionReportAssignmentRows,
            sessionStatusMeta: getActiveSessionStatusMeta(sessionStatusMeta),
            defaultSessionStatusCode: resolveDefaultSessionStatusCode(sessionStatusMeta),
            prevSessionId,    
            nextSessionId,    
            isSessionLocked, 
            isReadOnly,
            attendanceMatrixPolicyResolved,
            includeModal: true,  
            user: req.user,
            actionStateId: req.actionStateId
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

async function saveSession(req, res) {
    try {
        const { id: classId, sessionId } = req.params;
        const { status, notes, room, roster, contentItems, contentOrder } = req.body; 
        const { classData } = await getClassByIdWithOrgCheck(classId, req.user);
        const statusMap = await sessionStatusPolicyService.getStatusMap(classData?.orgId || getActiveOrgIdOrThrow(req.user), {
            includeInactive: true
        });

        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const sessionIndex = sessions.findIndex(s => s.sessionId === sessionId);
        if (sessionIndex === -1) throw new Error('Session not found');

        // --- Backend Save Protection ---
        const isSessionLocked = sessions[sessionIndex].locked === true || String(sessions[sessionIndex].locked) === 'true';
        let canOverride = await adminChekersService.isAdminForRequestAsync(
            req.user,
            SECTIONS.SCHOOL_CLASSES,
            OPERATIONS.UPDATE,
            { section: { id: SECTIONS.SCHOOL_CLASSES } }
        );

        if (isSessionLocked && !canOverride) {
            throw new Error('This session is locked and cannot be edited. Please contact an administrator.');
        }

        // Validate and normalize payload before persisting.
        const normalizedStatus = sessionStatusPolicyService.normalizeStatusCode(status || sessions[sessionIndex].status || '');
        if (!normalizedStatus || !statusMap.has(normalizedStatus)) {
            throw new Error('Invalid session status.');
        }

        const normalizedNotes = notes !== undefined ? String(notes || '').trim() : sessions[sessionIndex].notes;
        const normalizedRoom = room !== undefined ? String(room || '').trim() : sessions[sessionIndex].room;

        sessions[sessionIndex].status = normalizedStatus;
        sessions[sessionIndex].notes = normalizedNotes;
        sessions[sessionIndex].room = normalizedRoom;
        if (contentItems !== undefined) {
            const parsed = typeof contentItems === 'string' ? JSON.parse(contentItems || '[]') : contentItems;
            sessions[sessionIndex].contentItems = normalizeSessionContentItems(parsed);
        }
        if (contentOrder !== undefined) {
            const parsedOrder = typeof contentOrder === 'string' ? JSON.parse(contentOrder || '[]') : contentOrder;
            sessions[sessionIndex].contentOrder = normalizeSessionContentOrder(parsedOrder);
        }

        if (roster) {
            const incomingRoster = typeof roster === 'string' ? JSON.parse(roster) : roster;
            if (!Array.isArray(incomingRoster)) {
                throw new Error('Invalid roster payload.');
            }
            const existingRoster = sessions[sessionIndex].roster || [];
            const allowedAttendance = new Set(['present', 'late', 'excused', 'absent']);
            const orgPolicyLayerSave = await attendanceMatrixPolicyModel.getPolicyForOrg(
                classData?.orgId || getActiveOrgIdOrThrow(req.user)
            );
            const matrixPolicySave = attendanceMatrixMetricsService.resolvePolicy(classData, orgPolicyLayerSave);

            sessions[sessionIndex].roster = incomingRoster.map((incRec) => {
                const incomingPersonId = cleanPersonId(incRec.personId);
                if (!incomingPersonId) return null;
                const existRec = existingRoster.find((r) => idsEqual(r.personId, incomingPersonId)) || {};
                const normalizedAttendance = String(incRec.attendance || 'absent').trim().toLowerCase();
                const attendance = allowedAttendance.has(normalizedAttendance) ? normalizedAttendance : 'absent';
                const merged = {
                    personId: incomingPersonId,
                    attendance,
                    lateMinutes: incRec.lateMinutes,
                    earlyLeaveMinutes: incRec.earlyLeaveMinutes,
                    excuseRef: incRec.excuseRef,
                    notes: existRec.notes || '',
                    comments: existRec.comments || []
                };
                return attendanceMatrixMetricsService.applyAttendanceMatrixRosterRules(merged, matrixPolicySave);
            }).filter(Boolean);
        }

        await schoolDataService.saveClassSessions(classId, sessions, req.user);
        
        const indexService = require('../../services/school/schoolIndexService');
        await indexService.rebuildIndexesForClass(classId);

        if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Session data saved successfully.' });
        res.redirect(`/school/classes/sessions/${classId}/${sessionId}`);
    } catch (error) {
        if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
        res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

async function saveSessionGradebooks(req, res) {
    try {
        const { id: classId, sessionId } = req.params;
        await getClassByIdWithOrgCheck(classId, req.user);

        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const sessionIndex = sessions.findIndex((s) => s.sessionId === sessionId);
        if (sessionIndex === -1) throw new Error('Session not found');

        const isSessionLocked = sessions[sessionIndex].locked === true || String(sessions[sessionIndex].locked) === 'true';
        let canOverride = await adminChekersService.isAdminForRequestAsync(
            req.user,
            SECTIONS.SCHOOL_CLASSES,
            OPERATIONS.UPDATE,
            { section: { id: SECTIONS.SCHOOL_CLASSES } }
        );

        if (isSessionLocked && !canOverride) {
            throw new Error('This session is locked and cannot be edited.');
        }

        let rawList = req.body?.gradebooks;
        if (typeof rawList === 'string') {
            rawList = JSON.parse(rawList);
        }
        if (!Array.isArray(rawList)) {
            throw new Error('gradebooks must be an array.');
        }

        const roster = sessions[sessionIndex].roster || [];
        const personIds = [...new Set(roster.map((r) => cleanPersonId(r.personId)).filter(Boolean))];
        const attendanceByPerson = new Map();
        roster.forEach((r) => {
            const pid = cleanPersonId(r.personId);
            if (pid) {
                attendanceByPerson.set(pid, String(r.attendance || 'absent').trim().toLowerCase());
            }
        });

        const normalized = [];
        for (const gb of rawList) {
            const totalScore = Number(gb.totalScore);
            if (!Number.isFinite(totalScore) || totalScore <= 0) {
                throw new Error('Each activity must have a positive total score.');
            }
            const name = String(gb.name || '').trim();
            if (!name) {
                throw new Error('Each gradebook activity must have a name.');
            }

            const gbId = String(gb.id || '').trim() || `gb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
            const rawScores = gb.scores && typeof gb.scores === 'object' ? gb.scores : {};
            const scores = {};

            for (const pid of personIds) {
                const att = attendanceByPerson.get(pid) || 'absent';
                const isAbsent = att === 'absent';
                let v = rawScores[pid];
                if (v === undefined) v = rawScores[String(pid)];
                if (v === '' || v === undefined) v = null;
                if (v !== null && v !== undefined) v = Number(v);

                if (isAbsent) {
                    scores[pid] = null;
                } else if (v === null || Number.isNaN(v)) {
                    scores[pid] = null;
                } else if (v < 0 || v > totalScore) {
                    throw new Error(`Scores must be between 0 and ${totalScore} (${name}).`);
                } else {
                    scores[pid] = v;
                }
            }

            normalized.push({
                id: gbId,
                name: name.slice(0, 200),
                skillFocus: String(gb.skillFocus || '').trim().slice(0, 500),
                totalScore,
                activityContent: String(gb.activityContent || ''),
                includeInGradeCalculation: Boolean(gb.includeInGradeCalculation),
                scores
            });
        }

        sessions[sessionIndex].gradebooks = normalized;
        await schoolDataService.saveClassSessions(classId, sessions, req.user);

        const indexService = require('../../services/school/schoolIndexService');
        await indexService.rebuildIndexesForClass(classId);

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'Gradebook activities saved.', gradebooks: normalized });
        }
        res.redirect(`/school/classes/${classId}/sessions/${sessionId}`);
    } catch (error) {
        if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
        res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

async function showFinalGradesPage(req, res) {
    try {
        const classId = toPublicId(req.params.id);
        const { classData } = await getClassByIdWithOrgCheck(classId, req.user);
        if (getClassRegistrationModeKey(classData) === 'rolling') {
            return res.redirect(`/school/classes/${encodeURIComponent(classId)}/enrollment-outcomes`);
        }
        const matrixPayload = await gradesMatrixController.buildGradesMatrixPayload(req, { classId, startDate: '', endDate: '' });
        const rawOfficial = classData.officialFinalGrades && typeof classData.officialFinalGrades === 'object' ? classData.officialFinalGrades : {};
        const official = finalGradesWorkflowService.normalizeOfficialFinalGradesMap(rawOfficial);
        const finalGradesCapabilities = await buildFinalGradeWorkflowCapabilities(req, classData);
        res.render('school/class/finalGrades', {
            title: `Final Grades: ${classData.title || ''}`,
            classData,
            matrixPayload,
            officialFinalGradesWorkflow: official,
            finalGradesCapabilities,
            user: req.user,
            actionStateId: req.actionStateId,
            includeModal: true
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

async function postOfficialFinalGradesWorkflow(req, res) {
    try {
        const classId = toPublicId(req.params.id);
        const { classData } = await getClassByIdWithOrgCheck(classId, req.user);
        if (getClassRegistrationModeKey(classData) === 'rolling') {
            return res.status(400).json({ status: 'error', message: 'Official final grades apply to term-based classes only.' });
        }
        const action = String(req.body?.action || '').trim();
        const personId = toPublicId(req.body?.personId || '');
        if (!personId) throw new Error('personId is required.');
        const scoreRaw = req.body?.score;
        const score = scoreRaw === undefined || scoreRaw === null || scoreRaw === '' ? null : Number(scoreRaw);
        const reason = String(req.body?.reason || '').trim();

        await assertFinalGradeWorkflowAccess(req, classData, action);

        const displayName = await resolveActorDisplayName(req.user);
        const actor = {
            userId: String(req.user?.id || req.user?.username || '').trim(),
            displayName
        };

        const existing = classData.officialFinalGrades && typeof classData.officialFinalGrades === 'object' ? classData.officialFinalGrades : {};
        const nextMap = finalGradesWorkflowService.applyWorkflowAction(existing, {
            action,
            personId,
            score,
            reason,
            actor
        });

        await schoolDataService.updateData('classes', classId, { officialFinalGrades: nextMap }, req.user);
        res.json({ status: 'success', message: 'Final grade workflow updated.', data: { personId, action } });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
}

async function showEnrollmentOutcomesPage(req, res) {
    try {
        const classId = toPublicId(req.params.id);
        const { classData } = await getClassByIdWithOrgCheck(classId, req.user);
        assertRollingWorkflowEnabledForClass(req, classData);
        if (getClassRegistrationModeKey(classData) !== 'rolling') {
            return res.redirect(`/school/classes/${encodeURIComponent(classId)}/final-grades`);
        }
        const matrixPayload = await gradesMatrixController.buildGradesMatrixPayload(req, { classId, startDate: '', endDate: '' });
        const finalByPerson = new Map((matrixPayload.matrix || []).map((row) => [String(row.personId), row.finalPercent]));
        const periods = await schoolDataService.getClassEnrollmentPeriodsByClassId(classData.id, req.user);
        const students = await schoolDataService.fetchData('students', {}, req.user);
        const persons = await dataService.fetchData('persons', {}, req.user, PERSON_QUERY_OPTIONS);
        const studentToPerson = new Map((Array.isArray(students) ? students : []).map((s) => [String(s.id), String(s.personId || '')]));
        const personName = new Map((Array.isArray(persons) ? persons : []).map((p) => [String(p.id), `${p.name?.first || ''} ${p.name?.last || ''}`.trim()]));

        const pendingRows = (Array.isArray(periods) ? periods : [])
            .filter(periodNeedsCompletionDecision)
            .map((p) => {
                const sid = String(p.studentId || '');
                const pid = String(studentToPerson.get(sid) || '');
                return {
                    periodId: p.id,
                    studentId: sid,
                    personId: pid,
                    studentName: personName.get(pid) || sid,
                    startDate: p.startDate,
                    endDate: p.endDate,
                    status: p.status,
                    suggestedFinalPercent: pid ? finalByPerson.get(pid) : null,
                    completionDecision: String(p.completionDecision || ''),
                    completionDecisionNotes: String(p.completionDecisionNotes || '')
                };
            })
            .sort((a, b) => String(a.endDate || a.startDate).localeCompare(String(b.endDate || b.startDate)));

        res.render('school/class/enrollmentOutcomes', {
            title: `Enrollment outcomes: ${classData.title || ''}`,
            classData,
            pendingRows,
            matrixPayloadSummary: {
                evaluation: matrixPayload.evaluation,
                className: matrixPayload.className
            },
            user: req.user,
            actionStateId: req.actionStateId,
            includeModal: true
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

async function saveEnrollmentCompletionDecision(req, res) {
    try {
        const periodId = toPublicId(req.params.periodId);
        if (!periodId) throw new Error('periodId is required.');
        const periodRow = await schoolDataService.getDataById('classEnrollmentPeriods', periodId, req.user);
        if (!periodRow) throw new Error('Enrollment period not found.');
        const { classData } = await getClassByIdWithOrgCheck(periodRow.classId, req.user);
        assertRollingWorkflowEnabledForClass(req, classData);
        if (getClassRegistrationModeKey(classData) !== 'rolling') {
            return res.status(400).json({ status: 'error', message: 'Completion decisions apply to rolling classes only.' });
        }
        const decision = String(req.body?.completionDecision || '').trim().toLowerCase();
        if (!['pass', 'continue', 'withdraw'].includes(decision)) {
            throw new Error('completionDecision must be pass, continue, or withdraw.');
        }
        const notes = String(req.body?.completionDecisionNotes || '').trim().slice(0, 2000);
        const uid = String(req.user?.id || req.user?.username || '').trim();
        await schoolDataService.updateData('classEnrollmentPeriods', periodId, {
            completionDecision: decision,
            completionDecisionNotes: notes,
            updatedBy: uid
        }, req.user);
        res.json({ status: 'success', message: 'Outcome saved.' });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
}

module.exports = {
  listClasses, showAddForm, showAddWizardForm, addClass, showEditForm, showEditWizardForm, editClass, deleteClass,
  showRollingEnrollmentPage,
  showCycleRolloverWizard,
  previewCycleRollover,
  getClassTemplate,
  checkConflicts,
  listClassEnrollmentPeriods,
  previewRollingEnrollmentEligibility,
  previewClassEnrollmentWithTransactions,
  createClassEnrollmentWithTransactions,
  saveClassEnrollmentDraft,
  approveClassEnrollmentDraft,
  syncAcademicLedgerForEnrollmentPeriod,
  editClassEnrollmentPeriod,
  removeOrRollbackClassEnrollmentPeriod,
  createClassEnrollmentPeriod,
  closeClassEnrollmentPeriod,
  reopenClassEnrollmentPeriod,
  checkClassEnrollmentPeriodOverlap,
  evaluateClassEnrollmentReentry,
  closeClassCycle,
  createNextClassCycleFromTemplate,
  carryForwardClassCycleStudents,
  splitClassEnrollmentPeriodsForCycleBoundary,
  saveSession, saveSessionGradebooks, manageSession,
  showFinalGradesPage,
  postOfficialFinalGradesWorkflow,
  showEnrollmentOutcomesPage,
  saveEnrollmentCompletionDecision
};


