// MVC/controllers/school/classController.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const schoolDataService = require('../../services/school/schoolDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const dataService = requireCoreModule('MVC/services/dataService'); 
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const indexService = require('../../services/school/schoolIndexService');
const { isAjax, buildDataServiceQuery, inferSearchableFields } = requireCoreModule('MVC/utils/generalTools');
const settingService = requireCoreModule('MVC/services/settingService'); // أ¢إ“â€¦ Use Dynamic Service
const fileAssetStorage = requireCoreModule('MVC/services/fileAssetStorageService');
const uploadFolderSettingsService = requireCoreModule('MVC/services/uploadFolderSettingsService');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
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
const sessionDeliveryTeamService = require('../../services/school/sessionDeliveryTeamService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const registrationIntegrityService = require('../../services/school/registrationIntegrityService');
const schoolDependencyService = require('../../services/school/schoolDependencyService');
const schoolDeletionGuardService = require('../../services/school/schoolDeletionGuardService');
const { respondSchoolDeleteError } = require('../../utils/schoolDeleteErrorResponse');
const academicLedgerService = require('../../services/school/academicLedgerService');
const academicSnapshotService = require('../../services/school/academicSnapshotService');
const classEnrollmentReadService = require('../../services/school/classEnrollmentReadService');
const classEnrollmentSessionApplicabilityService = require('../../services/school/classEnrollmentSessionApplicabilityService');
const gradesMatrixController = require('./gradesMatrixController');
const accessService = requireCoreModule('MVC/services/security/index');
const finalGradesWorkflowService = require('../../services/school/finalGradesWorkflowService');
const leaveRequestService = require('../../services/school/leaveRequestService');
const activityService = require('../../services/school/activityService');
const sessionStudentCaseService = require('../../services/school/sessionStudentCaseService');
const { getPresetConfig } = require('../../services/school/sessionStudentCasePresetService');
const sessionReportAssignmentService = require('../../services/school/sessionReportAssignmentService');
const sessionConductService = require('../../services/school/sessionConductService');
const schoolFileService = require('../../services/school/schoolFileService');
const schoolIdentityLookupService = require('../../services/school/schoolIdentityLookupService');
const schoolRepositories = require('../../repositories/school');
const classCycleLinkResolutionService = require('../../services/school/classCycleLinkResolutionService');
const classDeletePreparationService = require('../../services/school/classDeletePreparationService');
const classDeleteCascadeService = require('../../services/school/classDeleteCascadeService');
const classStorageIntegrityService = require('../../services/school/classStorageIntegrityService');
const classFolderPaths = require('../../services/school/classFolderPaths');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const { isRollingClassWorkflowEnabledForClass } = require('../../services/school/phase2FeatureFlagService');
const {
    getActiveOrgIdOrThrow: getActiveOrgIdOrThrowShared,
    assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared,
    canCreateOrgScopedItem,
    assertOrgAccess
} = requireCoreModule('MVC/utils/orgContextUtils');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { resolveOrgTodayFromRequest, resolveOrgTodayFromContext } = requireCoreModule('MVC/utils/timezoneUtils');
const reportAssignmentSessionUtils = requireCoreModule('MVC/utils/reportAssignmentSessionUtils');
const sessionReportInstanceService = require('../../services/school/sessionReportInstanceService');
const schoolRecordAccessService = require('../../services/school/schoolRecordAccessService');
const attendanceMatrixPolicyModel = require('../../models/school/attendanceMatrixPolicyModel');
const conductRatingScalePolicyModel = require('../../models/school/conductRatingScalePolicyModel');
const attendanceMatrixMetricsService = require('../../services/school/attendanceMatrixMetricsService');
const schoolStudentProfileLinkService = require('../../services/school/schoolStudentProfileLinkService');
const gradebookSkillCatalogService = require('../../services/school/gradebookSkillCatalogService');
const sessionConflictDetectionService = require('../../services/school/sessionConflictDetectionService');

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
    return classFolderPaths.deleteClassFolderTargets(classData);
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

function parsePositiveAttendanceMinute(value) {
    const n = Number(String(value ?? '').trim());
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function createLateMinutesRequiredError(personId = '') {
    const suffix = personId ? ` for ${personId}` : '';
    const error = new Error(`Late attendance${suffix} requires Late Arrival minutes or Left Early minutes.`);
    error.code = 'LATE_MINUTES_REQUIRED';
    error.statusCode = 400;
    return error;
}

function assertLateAttendanceMinutesPresent(record = {}) {
    const attendance = attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(
        record.attendance,
        attendanceMatrixMetricsService.ATTENDANCE_STATUS.ABSENT
    );
    if (attendance !== attendanceMatrixMetricsService.ATTENDANCE_STATUS.LATE) return;
    const late = parsePositiveAttendanceMinute(record.lateMinutes);
    const early = parsePositiveAttendanceMinute(record.earlyLeaveMinutes);
    if (late <= 0 && early <= 0) {
        throw createLateMinutesRequiredError(toPublicId(record.personId || ''));
    }
}

function normalizeSessionRatingPercent(value, fallback = 100) {
    const fallbackNumber = Number(fallback);
    const safeFallback = Number.isFinite(fallbackNumber) ? fallbackNumber : 100;
    const n = Number(value);
    if (!Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(safeFallback * 100) / 100));
    return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
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
 * Rolling classes: final grade uses only attendance + assignments (sessionsأ¢â‚¬â„¢ gradebooks,
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

function isSchoolRequestAdmin(reqUser, sectionId, operationId = OPERATIONS.READ_ALL) {
    return adminChekersService.isAdminForRequest(reqUser, sectionId, operationId, {
        orgId: reqUser?.activeOrgId,
        section: { id: sectionId, category: 'SCHOOL' }
    });
}

/**
 * Rolling enrollment periods that have ended (or are closed) but have no Pass/Continue/Withdraw decision yet.
 * Excludes draft/planned/cancelled/archived/error rows.
 */
function periodNeedsCompletionDecision(period, today = '') {
    const day = String(today || '').trim() || resolveOrgTodayFromContext({ orgToday: today });
    const d = String(period.completionDecision || '').trim().toLowerCase();
    if (d === 'pass' || d === 'continue' || d === 'withdraw') return false;
    const status = String(period.status || '').trim().toLowerCase();
    if (['cancelled', 'archived', 'error', 'draft', 'planned', 'to_be_confirmed', 'waiting_list'].includes(status)) return false;
    if (status === 'completed' || status === 'withdrawn') return true;
    const end = String(period.endDate || '').trim();
    if (end && end <= day) return true;
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
        const payload = await schoolIdentityLookupService.listSchoolPersonRecords({
            reqUser,
            q: String(pid || '').trim(),
            query: { q: String(pid || '').trim(), limit: 200 },
            requireSchoolRole: false
        });
        const persons = payload?.allRows || payload?.rows || [];
        const person = persons.find((row) => idsEqual(row?.id, pid)) || null;
        if (person?.name) {
            const label = `${person.name.first || ''} ${person.name.last || ''}`.trim();
            if (label) return label.slice(0, 160);
        }
    } catch (e) { /* ignore */ }
    return String(reqUser?.username || pid).slice(0, 160);
}

async function buildFinalGradeWorkflowCapabilities(req, classData) {
    const ip = req.ip;
    const isSuper = isSchoolRequestAdmin(req.user, SECTIONS.SCHOOL_GRADEBOOK, OPERATIONS.UPDATE);
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
    if (isSchoolRequestAdmin(req.user, SECTIONS.SCHOOL_GRADEBOOK, OPERATIONS.UPDATE)) return;
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
            name: displayName,
            studentRecordId: schoolStudentProfileLinkService.resolveStudentRecordId({
                personId: pid,
                personToStudentMap: options?.personToStudentMap
            })
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

function buildRouteAccessContext(req) {
    return schoolRecordAccessService.buildRouteAccessContext(req);
}

function assertSessionScopeForRequest(req, classData, session, context = 'manageSession') {
    schoolRecordAccessService.assertSessionAccessible({
        classRow: classData,
        session,
        access: schoolRecordAccessService.resolveAccessFromRequest(req),
        context
    });
}

async function getClassByIdWithOrgCheck(classId, reqUser, accessContext = {}) {
    const activeOrgId = getActiveOrgIdOrThrow(reqUser);
    const classData = await schoolDataService.getDataById('classes', classId, reqUser, accessContext);
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

function isActivePeriodOnDate(row, referenceDate = '', orgToday = '') {
    const status = String(row?.status || '').trim().toLowerCase();
    if (!['active', 'planned'].includes(status)) return false;
    const day = normalizeDateOnlyValue(referenceDate) || normalizeDateOnlyValue(orgToday) || resolveOrgTodayFromContext({ orgToday });
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
            file: type === 'file' && row.file && typeof row.file === 'object' ? schoolFileService.normalizeExistingAttachment(row.file) : null,
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
    const rosterStatuses = getClassRegistrationModeKey(classData) === 'rolling'
        ? classEnrollmentReadService.HISTORICAL_ROLLING_ROSTER_STATUSES
        : ['active'];
    const studentRows = Array.isArray(students) ? students : [];
    const studentToPersonMap = new Map(
        studentRows
            .map((row) => [toPublicId(row?.id), cleanPersonId(row?.personId)])
            .filter(([studentId, personId]) => Boolean(studentId && personId))
    );

    if (getClassRegistrationModeKey(classData) === 'rolling') {
        const [periodRows, allSessions] = await Promise.all([
            schoolDataService.getClassEnrollmentPeriodsByClassId(classData?.id, reqUser),
            schoolDataService.getClassSessions(classData?.id, reqUser)
        ]);
        const effectiveSessions = Array.isArray(allSessions) && allSessions.length ? allSessions : [session];
        const statusMapForApplicability = await sessionStatusPolicyService.getStatusMap(classData?.orgId || activeOrgId, { includeInactive: true });
        const applicability = await classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentApplicabilityWithLeaves({
            sessions: effectiveSessions,
            periodRows,
            studentToPersonMap,
            activeOrgId,
            orgId: classData?.orgId || activeOrgId,
            reqUser,
            allowedStatuses: classEnrollmentSessionApplicabilityService.OPEN_OR_HISTORICAL_STATUSES,
            forceNotApplicableSessionKeys: sessionStatusPolicyService.buildForceNotApplicableAttendanceSessionKeys(statusMapForApplicability, effectiveSessions)
        });
        const personIds = new Set();
        const applicabilityByPersonId = new Map();
        applicability.personIds.forEach((personId) => {
            const state = classEnrollmentSessionApplicabilityService.getApplicabilityState(
                applicability.stateByKey,
                personId,
                session,
                session?.sessionId || session?.id
            );
            if (!state) return;
            if (state.expected || state.reason === 'approved_leave' || state.reason === 'manual_not_applicable' || state.reason === 'makeup_required') {
                const normalizedPersonId = cleanPersonId(personId);
                personIds.add(normalizedPersonId);
                applicabilityByPersonId.set(normalizedPersonId, state);
            }
        });
        return {
            personIds,
            source: 'canonical_session_applicability',
            applicabilityByPersonId
        };
    }

    const enrollmentSnapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
        classId: classData?.id,
        classItem: classData,
        reqUser,
        activeOrgId,
        sessionDates: sessionDate ? [sessionDate] : [],
        startDate: sessionDate,
        endDate: sessionDate,
        canonicalStatuses: rosterStatuses
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
        source: String(enrollmentSnapshot?.source || 'canonical'),
        applicabilityByPersonId: new Map()
    };
}

async function assertSessionRosterEnrollmentWindows({ classData, session, incomingRoster, reqUser }) {
    if (getClassRegistrationModeKey(classData) !== 'rolling') return;
    const rows = Array.isArray(incomingRoster) ? incomingRoster : [];
    if (!rows.length) return;

    const [periodRows, students] = await Promise.all([
        schoolDataService.getClassEnrollmentPeriodsByClassId(classData?.id, reqUser),
        schoolDataService.fetchData('students', {}, reqUser)
    ]);
    const studentToPersonMap = new Map(
        (Array.isArray(students) ? students : [])
            .map((row) => [toPublicId(row?.id), cleanPersonId(row?.personId)])
            .filter(([studentId, personId]) => Boolean(studentId && personId))
    );
    const activeOrgId = String(classData?.orgId || reqUser?.activeOrgId || '').trim();
    const outsideWindow = rows.find((row) => {
        const personId = cleanPersonId(row?.personId);
        if (!personId) return false;
        const enrollmentWindow = classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentWindowForPerson({
            periodRows: Array.isArray(periodRows) ? periodRows : [],
            studentToPersonMap,
            personId,
            session,
            activeOrgId,
            allowedStatuses: classEnrollmentSessionApplicabilityService.OPEN_OR_HISTORICAL_STATUSES
        });
        return enrollmentWindow.withinEnrollmentWindow !== true;
    });
    if (!outsideWindow) return;

    const sessionDate = normalizeDateOnlyValue(session?.date) || 'this session date';
    throw new Error(`Attendance cannot be updated because a roster student was not enrolled in the class on ${sessionDate}.`);
}

function findSessionInList(sessions, sessionId) {
    const list = Array.isArray(sessions) ? sessions : [];
    const index = list.findIndex((row) => idsEqual(row?.sessionId || row?.id, sessionId));
    return { index, session: index >= 0 ? list[index] : null };
}

/**
 * Same effective roster Manage Session shows (enrollment + persisted roster + gradebook scores).
 */
async function buildEnrichedSessionRosterForMutation({ classData, session, reqUser }) {
    const [persons, students] = await Promise.all([
        schoolIdentityLookupService.listSchoolPersonRecords({
            reqUser,
            requireSchoolRole: false,
            query: { limit: 2000 }
        }).then((payload) => payload.allRows || payload.rows || []),
        schoolDataService.fetchData('students', {}, reqUser)
    ]);

    const workingSession = {
        ...session,
        roster: Array.isArray(session?.roster) ? session.roster.map((row) => ({ ...row })) : []
    };

    const rosterResolution = await resolveSessionRosterPersonIds({
        classData,
        session: workingSession,
        reqUser,
        students
    });
    const activePersonIds = rosterResolution?.personIds instanceof Set ? rosterResolution.personIds : new Set();
    const activeApplicabilityByPersonId = rosterResolution?.applicabilityByPersonId instanceof Map ? rosterResolution.applicabilityByPersonId : new Map();

    if (getClassRegistrationModeKey(classData) === 'rolling') {
        workingSession.roster = workingSession.roster.filter((row) => {
            const pid = cleanPersonId(row?.personId);
            return pid && activePersonIds.has(pid);
        });
    }
    const statusMapForSession = await sessionStatusPolicyService.getStatusMap(classData?.orgId || reqUser?.activeOrgId || '', { includeInactive: true });
    const forceSessionNotApplicable = sessionStatusPolicyService.shouldForceNotApplicableAttendanceByMap(statusMapForSession, {
        status: workingSession?.status,
        notes: workingSession?.notes
    });
    const getApplicabilityForPerson = (pid) => activeApplicabilityByPersonId.get(cleanPersonId(pid)) || null;
    const hasApprovedLeaveFor = (pid) => getApplicabilityForPerson(pid)?.reason === 'approved_leave';

    activePersonIds.forEach((pid) => {
        if (!workingSession.roster.find((r) => idsEqual(r.personId, pid))) {
            workingSession.roster.push({
                personId: pid,
                attendance: (forceSessionNotApplicable || hasApprovedLeaveFor(pid)) ? attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE : 'present',
                notes: '',
                comments: [],
                classEffortPercent: 100,
                classParticipationPercent: 100,
                respectsTeachersPercent: 100,
                respectsStudentsPercent: 100
            });
        }
    });

    workingSession.roster = workingSession.roster.map((row) => {
        const pid = cleanPersonId(row?.personId);
        if (!pid) return row;
        if (forceSessionNotApplicable) {
            return { ...row, attendance: attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE, lateMinutes: 0, earlyLeaveMinutes: 0 };
        }
        if (!hasApprovedLeaveFor(pid)) return row;
        const normalized = attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(row?.attendance, attendanceMatrixMetricsService.ATTENDANCE_STATUS.ABSENT);
        if (!attendanceMatrixMetricsService.isAbsentLikeStatus(normalized)
            && normalized !== attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE) {
            return row;
        }
        return { ...row, attendance: attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE, lateMinutes: 0, earlyLeaveMinutes: 0 };
    });

    const personToStudentMap = schoolStudentProfileLinkService.buildPersonIdToStudentRecordIdMap(
        students,
        classData?.orgId || reqUser?.activeOrgId || ''
    );

    const enrichedRoster = workingSession.roster.map((r) => {
        const pid = cleanPersonId(r.personId);
        const person = persons.find((p) => idsEqual(p.id, pid));
        const displayName = person ? `${person.name?.first || ''} ${person.name?.last || ''}`.trim() : 'Unknown Student';
        return {
            ...r,
            personId: pid,
            name: displayName,
            studentRecordId: schoolStudentProfileLinkService.resolveStudentRecordId({
                personId: pid,
                personToStudentMap
            }),
            classEffortPercent: normalizeSessionRatingPercent(r.classEffortPercent),
            classParticipationPercent: normalizeSessionRatingPercent(r.classParticipationPercent),
            respectsTeachersPercent: normalizeSessionRatingPercent(r.respectsTeachersPercent),
            respectsStudentsPercent: normalizeSessionRatingPercent(r.respectsStudentsPercent)
        };
    });

    mergeGradebookScorePersonsIntoEnrichedRoster(enrichedRoster, workingSession, persons, {
        allowedPersonIds: getClassRegistrationModeKey(classData) === 'rolling'
            ? new Set(Array.from(activePersonIds).map((id) => String(id)))
            : null,
        personToStudentMap
    });

    enrichedRoster.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return enrichedRoster;
}

async function buildClassEnrollmentPeriodMetrics(reqUser, classIds = [], orgToday = '') {
    const idSet = new Set((Array.isArray(classIds) ? classIds : []).map((id) => toPublicId(id)).filter(Boolean));
    const rows = await schoolDataService.getAccessibleClassEnrollmentPeriods(reqUser);
    const periodRows = Array.isArray(rows) ? rows : [];
    const today = String(orgToday || '').trim() || resolveOrgTodayFromContext({ orgToday });
    const map = new Map();

    periodRows.forEach((row) => {
        const classId = toPublicId(row?.classId);
        if (!classId) return;
        if (idSet.size && !idSet.has(classId)) return;
        const status = String(row?.status || '').trim().toLowerCase();
        const metrics = map.get(classId) || { openPeriodCount: 0, activePeriodCount: 0, totalPeriodCount: 0 };
        metrics.totalPeriodCount += 1;
        if (['draft', 'planned', 'to_be_confirmed', 'waiting_list', 'active'].includes(status)) metrics.openPeriodCount += 1;
        if (isActivePeriodOnDate(row, today)) metrics.activePeriodCount += 1;
        map.set(classId, metrics);
    });

    return map;
}

async function buildClassLifecycleContext(classData, reqUser, orgToday = '') {
    const classId = toPublicId(classData?.id);
    const metricsMap = await buildClassEnrollmentPeriodMetrics(reqUser, [classId], orgToday);
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
        normalized.delivery.coTeachers = sessionDeliveryTeamService.normalizeSessionCoTeachers(
            normalized.delivery?.coTeachers || normalized.coTeachers,
            { mainTeacherId: resolvedDeliveredBy || '' }
        );
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

async function normalizeSessionMetadataTeacherInput(body = {}, { activeOrgId = '', reqUser } = {}) {
    if (body?.teacherId === undefined) return body;
    const teacherIdentityLookup = await sessionConflictDetectionService.buildTeacherIdentityLookup({ activeOrgId, reqUser });
    return {
        ...body,
        teacherId: sessionConflictDetectionService.resolveTeacherPersonId(body.teacherId, teacherIdentityLookup) || cleanPersonId(body.teacherId)
    };
}

function detectSessionConflicts(options = {}) {
    return sessionConflictDetectionService.detectSessionConflicts(options);
}

function normalizeTeacherAssignmentTarget(value, fallback = '') {
    const raw = String(value || '').trim();
    if (raw === 'all') return 'all';
    return sessionStatusPolicyService.normalizeStatusCode(raw) || sessionStatusPolicyService.normalizeStatusCode(fallback) || 'scheduled';
}

function sessionMatchesTeacherAssignmentCriteria(session = {}, criteria = {}) {
    const oldTeacherId = cleanPersonId(criteria.oldTeacherId || criteria.oldTeacher || '');
    const oldTeacherName = String(criteria.oldTeacherName || criteria.oldTeacher || '').trim();
    const currentTeacherId = cleanPersonId(session?.delivery?.deliveredBy || '');
    const currentTeacherName = String(session?.delivery?.deliveredByName || '').trim();
    const selectedSessionIds = new Set((Array.isArray(criteria.sessionIds) ? criteria.sessionIds : [])
        .map((id) => toPublicId(id))
        .filter(Boolean));

    if (selectedSessionIds.size) {
        const sid = toPublicId(session?.sessionId || session?.id);
        if (!sid || !selectedSessionIds.has(sid)) return false;
    } else {
        const teacherMatches = (oldTeacherId && currentTeacherId && idsEqual(currentTeacherId, oldTeacherId))
            || (oldTeacherName && currentTeacherName === oldTeacherName)
            || (!currentTeacherId && oldTeacherName && currentTeacherName === oldTeacherName);
        if (!teacherMatches) return false;
    }

    const target = normalizeTeacherAssignmentTarget(criteria.targetStatus, 'scheduled');
    const sessionStatus = sessionStatusPolicyService.normalizeStatusCode(session?.status) || sessionStatusPolicyService.normalizeStatusCode('scheduled');
    if (target !== 'all' && sessionStatus !== target) return false;
    if (!parseBoolean(criteria.includeLocked, false) && (session?.locked === true || String(session?.locked) === 'true')) return false;
    return true;
}

function summarizeImpactRows(rows = [], label = 'item', limit = 5, mapper = null) {
    const list = Array.isArray(rows) ? rows : [];
    return {
        label,
        count: list.length,
        samples: list.slice(0, limit).map((row) => (typeof mapper === 'function' ? mapper(row) : {
            id: toPublicId(row?.id || row?._id || row?.sessionId || ''),
            title: String(row?.title || row?.name || row?.status || '').trim()
        }))
    };
}

function rowReferencesAnySession(row = {}, refs = []) {
    if (!row || typeof row !== 'object') return false;
    const text = JSON.stringify(row);
    return refs.some((ref) => {
        const classId = String(ref?.classId || '').trim();
        const sessionId = String(ref?.sessionId || '').trim();
        if (!classId || !sessionId) return false;
        return text.includes(classId) && text.includes(sessionId);
    });
}

async function listImpactRows(entityType, repositoryName, reqUser) {
    try {
        const rows = await schoolDataService.fetchData(entityType, {}, reqUser);
        if (Array.isArray(rows)) return rows;
    } catch (_) { /* fallback below */ }
    try {
        const repo = schoolRepositories?.[repositoryName];
        if (repo && typeof repo.list === 'function') {
            const rows = await repo.list({ query: {}, scope: { canViewAll: true } });
            if (Array.isArray(rows)) return rows;
        }
    } catch (_) { /* no-op */ }
    return [];
}

async function previewTeacherAssignmentImpact(req, res) {
    try {
        const classId = toPublicId(req.params.classId || req.body.classId || '');
        if (!classId) throw new Error('Class id is required.');
        const { classData, activeOrgId } = await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const criteria = {
            oldTeacher: req.body.oldTeacher || '',
            oldTeacherId: req.body.oldTeacherId || req.body.oldTeacher || '',
            oldTeacherName: req.body.oldTeacherName || '',
            newTeacherId: req.body.newTeacherId || '',
            newTeacherName: req.body.newTeacherName || '',
            targetStatus: req.body.targetStatus || 'scheduled',
            includeLocked: req.body.includeLocked,
            sessionIds: parseData(req.body.sessionIds) || []
        };

        const affectedSessions = (Array.isArray(sessions) ? sessions : [])
            .filter((session) => sessionMatchesTeacherAssignmentCriteria(session, criteria))
            .map((session) => ({
                classId,
                sessionId: toPublicId(session?.sessionId || session?.id),
                date: String(session?.date || '').trim(),
                startTime: String(session?.startTime || '').trim(),
                endTime: String(session?.endTime || '').trim(),
                status: sessionStatusPolicyService.normalizeStatusCode(session?.status) || String(session?.status || '').trim(),
                locked: session?.locked === true || String(session?.locked) === 'true',
                rosterCount: Array.isArray(session?.roster) ? session.roster.length : 0,
                gradebookCount: Array.isArray(session?.gradebook) ? session.gradebook.length : 0,
                coTeacherCount: sessionDeliveryTeamService.getSessionCoTeachers(session).length,
                hasAttendanceOrGradebook: Array.isArray(session?.roster) && session.roster.some((row) => (
                    String(row?.attendanceStatus || row?.attendance || row?.comment || row?.notes || '').trim()
                    || row?.classEffortPercent !== undefined
                    || row?.classParticipationPercent !== undefined
                ))
            }));

        const oldTeacherId = cleanPersonId(criteria.oldTeacherId || criteria.oldTeacher || '');
        const coTeacherMembershipSessions = (Array.isArray(sessions) ? sessions : [])
            .filter((session) => {
                if (!oldTeacherId) return false;
                if (sessionDeliveryTeamService.isPersonSessionMainTeacher(session, oldTeacherId)) return false;
                return sessionDeliveryTeamService.isPersonOnSessionDelivery(session, oldTeacherId);
            })
            .map((session) => ({
                classId,
                sessionId: toPublicId(session?.sessionId || session?.id),
                date: String(session?.date || '').trim(),
                startTime: String(session?.startTime || '').trim(),
                endTime: String(session?.endTime || '').trim(),
                roleLabel: sessionDeliveryTeamService.findCoTeacherEntry(session, oldTeacherId)?.roleLabel || 'Co-Teacher'
            }));

        const refs = affectedSessions.map((session) => ({ classId, sessionId: session.sessionId })).filter((ref) => ref.sessionId);
        const [timesheets, reportAssignments, reportInstances, cases, tasks] = await Promise.all([
            listImpactRows('timesheets', 'timesheets', req.user),
            listImpactRows('reportAssignments', 'reportAssignments', req.user),
            listImpactRows('reportInstances', 'reportInstances', req.user),
            listImpactRows('sessionStudentCases', 'sessionStudentCases', req.user),
            listImpactRows('tasks', 'tasks', req.user)
        ]);

        const newTeacherId = cleanPersonId(criteria.newTeacherId);
        const impactedAssignments = (Array.isArray(reportAssignments) ? reportAssignments : []).filter((row) => {
            if (activeOrgId && row?.orgId && !idsEqual(row.orgId, activeOrgId)) return false;
            const teacherIds = Array.isArray(row?.teacherIds) ? row.teacherIds.map((id) => cleanPersonId(id)).filter(Boolean) : [];
            const teacherMatch = oldTeacherId && teacherIds.some((id) => idsEqual(id, oldTeacherId));
            const sessionMatch = affectedSessions.some((session) => reportAssignmentSessionUtils.reportAssignmentMatchesSession(row, {
                classId,
                sessionId: session.sessionId,
                sessionDate: session.date
            }));
            return teacherMatch || sessionMatch;
        });
        const impactedCases = (Array.isArray(cases) ? cases : []).filter((row) => refs.some((ref) => idsEqual(row?.classId, ref.classId) && idsEqual(row?.sessionId, ref.sessionId)));
        const impactedTimesheets = (Array.isArray(timesheets) ? timesheets : []).filter((row) => {
            if (activeOrgId && row?.orgId && !idsEqual(row.orgId, activeOrgId)) return false;
            const teacherId = cleanPersonId(row?.teacherId || row?.personId || row?.ownerPersonId || '');
            const teacherMatch = oldTeacherId && (!teacherId || idsEqual(teacherId, oldTeacherId));
            return teacherMatch && rowReferencesAnySession(row, refs);
        });
        const impactedInstances = (Array.isArray(reportInstances) ? reportInstances : []).filter((row) => rowReferencesAnySession(row, refs)
            || impactedAssignments.some((assignment) => idsEqual(row?.assignmentId, assignment?.id)));
        const impactedTasks = (Array.isArray(tasks) ? tasks : []).filter((row) => rowReferencesAnySession(row, refs)
            || impactedCases.some((caseRow) => idsEqual(row?.sourceId, caseRow?.id)));
        const sessionsWithAttendanceOrGradebook = affectedSessions.filter((session) => session.hasAttendanceOrGradebook || session.rosterCount || session.gradebookCount);

        let leaveConflicts = [];
        if (newTeacherId && affectedSessions.length) {
            leaveConflicts = await leaveRequestService.findApprovedLeaveConflicts({
                orgId: activeOrgId || classData?.orgId || '',
                windows: affectedSessions
                    .filter((session) => session.date && session.startTime && session.endTime)
                    .map((session, index) => ({
                        sessionIndex: index,
                        personId: newTeacherId,
                        personName: String(criteria.newTeacherName || newTeacherId),
                        date: session.date,
                        startTime: session.startTime,
                        endTime: session.endTime
                    })),
                reqUser: req.user
            });
        }

        return res.json({
            status: 'success',
            message: 'Teacher assignment impact preview is ready.',
            impact: {
                classId,
                classTitle: String(classData?.title || classId).trim(),
                oldTeacherId,
                oldTeacherName: String(criteria.oldTeacherName || criteria.oldTeacher || oldTeacherId).trim(),
                newTeacherId,
                newTeacherName: String(criteria.newTeacherName || newTeacherId).trim(),
                affectedSessions,
                coTeacherMembershipSessions,
                summaries: {
                    timesheets: summarizeImpactRows(impactedTimesheets, 'timesheet', 5, (row) => ({
                        id: toPublicId(row?.id),
                        title: [row?.periodName || row?.periodId, row?.status].filter(Boolean).join(' | ')
                    })),
                    coTeacherMembership: summarizeImpactRows(coTeacherMembershipSessions, 'co-teacher session', 5, (row) => ({
                        id: toPublicId(row?.sessionId),
                        title: [row?.date, row?.startTime && row?.endTime ? `${row.startTime}-${row.endTime}` : '', row?.roleLabel].filter(Boolean).join(' | ')
                    })),
                    reportAssignments: summarizeImpactRows(impactedAssignments, 'report assignment', 5, (row) => ({
                        id: toPublicId(row?.id),
                        title: [row?.title || row?.templateId || 'Report assignment', row?.status].filter(Boolean).join(' | ')
                    })),
                    reportInstances: summarizeImpactRows(impactedInstances, 'report instance', 5, (row) => ({
                        id: toPublicId(row?.id),
                        title: [row?.title || row?.assignmentId || 'Report instance', row?.status].filter(Boolean).join(' | ')
                    })),
                    sessionCases: summarizeImpactRows(impactedCases, 'student case', 5, (row) => ({
                        id: toPublicId(row?.id),
                        title: [row?.summary || row?.category || 'Student case', row?.status].filter(Boolean).join(' | ')
                    })),
                    tasks: summarizeImpactRows(impactedTasks, 'task', 5, (row) => ({
                        id: toPublicId(row?.id),
                        title: [row?.title || row?.sourceType || 'Task', row?.status].filter(Boolean).join(' | ')
                    })),
                    attendanceGradebook: summarizeImpactRows(sessionsWithAttendanceOrGradebook, 'session with attendance/gradebook', 5, (row) => ({
                        id: row.sessionId,
                        title: `${row.date || ''} ${row.startTime || ''}-${row.endTime || ''}`.trim()
                    })),
                    newTeacherLeaveConflicts: summarizeImpactRows(leaveConflicts, 'approved leave conflict', 5, (row) => ({
                        id: toPublicId(row?.leaveRequestId),
                        title: `${row.date || ''} ${row.leaveLabel || ''}`.trim()
                    }))
                }
            }
        });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
}

function buildConflictBlockingMessage(conflicts = []) {
    return sessionConflictDetectionService.buildConflictBlockingMessage(conflicts);
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

function resolveTermInstructionWindow(term = {}) {
    const start = normalizeDateOnlyValue(term?.classesStartDate) || normalizeDateOnlyValue(term?.startDate);
    const end = normalizeDateOnlyValue(term?.classesEndDate) || normalizeDateOnlyValue(term?.endDate);
    return {
        start,
        end,
        label: [term?.code || term?.termCode || term?.id, term?.name || term?.termName].filter(Boolean).join(' - ') || String(term?.id || 'Term')
    };
}

async function resolveTermBasedSessionWindowOrThrow(classData = {}, reqUser) {
    const allowedRows = Array.isArray(classData?.allowedProgramTerms) ? classData.allowedProgramTerms : [];
    const termIds = [...new Set(allowedRows.map((row) => toPublicId(row?.termId)).filter(Boolean))];
    if (!termIds.length) {
        throw new Error('Term-based classes require at least one allowed program-term row before sessions can be scheduled.');
    }

    const activeOrgId = toPublicId(classData?.orgId || getActiveOrgIdOrThrow(reqUser));
    const terms = await schoolDataService.fetchData('terms', {}, reqUser);
    const termMap = new Map((Array.isArray(terms) ? terms : []).map((term) => [toPublicId(term?.id), term]));
    const windows = termIds.map((termId) => {
        const term = termMap.get(termId);
        if (!term) throw new Error(`Selected term ${termId} is not accessible for session date validation.`);
        if (activeOrgId && term?.orgId && !idsEqual(term.orgId, activeOrgId)) {
            throw new Error(`Selected term ${termId} belongs to another organization.`);
        }
        const window = resolveTermInstructionWindow(term);
        if (!window.start || !window.end) {
            throw new Error(`Term ${window.label} needs start and end dates before sessions can be scheduled.`);
        }
        return { ...window, termId };
    });

    const startToken = windows.reduce((max, row) => (!max || row.start > max ? row.start : max), '');
    const endToken = windows.reduce((min, row) => (!min || row.end < min ? row.end : min), '');
    if (startToken && endToken && startToken > endToken) {
        throw new Error('Term-based class session window has no overlap across the selected allowed terms. Review the Program / terms tab.');
    }

    return {
        mode: 'term_based',
        startToken,
        endToken,
        termCount: windows.length
    };
}

async function assertClassSessionsWithinDateWindowOrThrow(classData = {}, sessions = [], reqUser) {
    const rows = Array.isArray(sessions) ? sessions : [];
    const hasSessionDates = rows.some((row) => String(row?.date || '').trim());
    const mode = String(classData?.registrationMode || 'term_based').trim().toLowerCase() === 'rolling' ? 'rolling' : 'term_based';

    if (mode === 'rolling') {
        assertRollingSessionsWithinCycleWindowOrThrow({
            registrationMode: classData?.registrationMode || 'term_based',
            cycleStartDate: classData?.cycleStartDate || '',
            cycleEndDate: classData?.cycleEndDate || '',
            sessions: rows
        });
        return;
    }

    if (!hasSessionDates) return;

    const window = await resolveTermBasedSessionWindowOrThrow(classData, reqUser);
    const violations = [];
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
        if (normalizedDate < window.startToken || normalizedDate > window.endToken) {
            violations.push({
                type: 'out_of_term_window',
                index,
                date: normalizedDate,
                sessionId: String(row?.sessionId || '').trim()
            });
        }
    });

    if (!violations.length) return;

    const invalidDateCount = violations.filter((row) => row.type === 'invalid_session_date').length;
    const outsideRows = violations.filter((row) => row.type === 'out_of_term_window');
    const outsideSample = outsideRows.slice(0, 5).map((row) => {
        const sid = String(row?.sessionId || '').trim();
        return sid ? `${row.date} (${sid})` : row.date;
    }).join(', ');
    const outsideSuffix = outsideRows.length > 5 ? ` (+${outsideRows.length - 5} more)` : '';
    const parts = [
        `Term-based class sessions must stay within the selected term instructional window (${window.startToken} to ${window.endToken}).`
    ];
    if (invalidDateCount > 0) {
        parts.push(`${invalidDateCount} session(s) have invalid date format.`);
    }
    if (outsideRows.length > 0) {
        parts.push(`Out-of-window session date(s): ${outsideSample}${outsideSuffix}.`);
    }
    throw new Error(parts.join(' '));
}

async function assertSessionManagerSessionWithinClassWindowOrThrow(classData = {}, session = {}, reqUser) {
    await assertClassSessionsWithinDateWindowOrThrow(classData, [session], reqUser);
}

function assertSessionManagerSessionWithinCycleWindowOrThrow(classData = {}, session = {}) {
    assertRollingSessionsWithinCycleWindowOrThrow({
        registrationMode: classData?.registrationMode || 'term_based',
        cycleStartDate: classData?.cycleStartDate || '',
        cycleEndDate: classData?.cycleEndDate || '',
        sessions: [session]
    });
}

function calculateSessionDurationHours(startTime = '', endTime = '', fallback = 0) {
    const start = normalizeClockTime(startTime);
    const end = normalizeClockTime(endTime);
    if (!start || !end || start >= end) {
        const fallbackNumber = Number(fallback);
        return Number.isFinite(fallbackNumber) && fallbackNumber > 0 ? Number(fallbackNumber.toFixed(2)) : 0;
    }
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const minutes = ((eh * 60) + em) - ((sh * 60) + sm);
    return minutes > 0 ? Number((minutes / 60).toFixed(2)) : 0;
}

function sessionMetadataFieldsPresentInBody(body = {}) {
    return ['date', 'startTime', 'endTime', 'teacherId', 'teacherName', 'coTeachers'].some((key) => body[key] !== undefined);
}

function applyAdminSessionMetadataUpdate(session = {}, body = {}, canOverrideOrOptions = false) {
    const options = (canOverrideOrOptions && typeof canOverrideOrOptions === 'object')
        ? canOverrideOrOptions
        : { canOverride: canOverrideOrOptions === true };
    const canOverride = options.canOverride === true;
    const canManageCoTeachers = options.canManageCoTeachers === true || canOverride;
    const canToggleCoTeacherEdit = options.canToggleCoTeacherEdit === true || canManageCoTeachers;
    if (!sessionMetadataFieldsPresentInBody(body)) {
        return { changed: false };
    }
    const hasScheduleFields = ['date', 'startTime', 'endTime', 'teacherId', 'teacherName']
        .some((key) => body[key] !== undefined);
    if (hasScheduleFields && !canOverride) {
        return { changed: false };
    }
    const mayUpdateCoTeachers = body.coTeachers !== undefined && (canManageCoTeachers || canToggleCoTeacherEdit);
    if (!canOverride && !mayUpdateCoTeachers) {
        return { changed: false };
    }

    const priorDate = normalizeDateOnlyValue(session.date);
    const priorStart = normalizeClockTime(session.startTime);
    const priorEnd = normalizeClockTime(session.endTime);
    const priorTeacherId = cleanPersonId(session?.delivery?.deliveredBy);
    const priorTeacherName = String(session?.delivery?.deliveredByName || '').trim();
    const priorCoTeachers = sessionDeliveryTeamService.getSessionCoTeachers(session);
    const priorCoTeachersJson = JSON.stringify(priorCoTeachers);

    let date = priorDate;
    let startTime = priorStart;
    let endTime = priorEnd;
    let teacherId = priorTeacherId;
    let teacherName = priorTeacherName || priorTeacherId || '';

    if (canOverride) {
        date = body.date !== undefined ? normalizeDateOnlyValue(body.date) : priorDate;
        startTime = body.startTime !== undefined ? normalizeClockTime(body.startTime) : priorStart;
        endTime = body.endTime !== undefined ? normalizeClockTime(body.endTime) : priorEnd;
        if (!date) throw new Error('Session date is required.');
        if (!startTime || !endTime || startTime >= endTime) {
            throw new Error('Session start time must be before end time.');
        }

        teacherId = body.teacherId !== undefined
            ? cleanPersonId(body.teacherId)
            : priorTeacherId;
        teacherName = body.teacherName !== undefined
            ? String(body.teacherName || teacherId || '').trim().slice(0, 180)
            : (priorTeacherName || teacherId || '');

        session.date = date;
        session.startTime = startTime;
        session.endTime = endTime;
        session.durationHours = calculateSessionDurationHours(startTime, endTime, session.durationHours);
        if (!session.delivery || typeof session.delivery !== 'object') session.delivery = {};
        session.delivery.deliveredBy = teacherId;
        session.delivery.deliveredByName = teacherName;
    } else if (!session.delivery || typeof session.delivery !== 'object') {
        session.delivery = {};
    }

    const mainTeacherId = teacherId || cleanPersonId(session?.delivery?.deliveredBy) || '';
    if (canManageCoTeachers && body.coTeachers !== undefined) {
        const parsedCoTeachers = typeof body.coTeachers === 'string'
            ? (() => { try { return JSON.parse(body.coTeachers); } catch (_error) { return []; } })()
            : body.coTeachers;
        session.delivery.coTeachers = sessionDeliveryTeamService.normalizeSessionCoTeachers(parsedCoTeachers, {
            mainTeacherId
        });
    } else if (canToggleCoTeacherEdit && body.coTeachers !== undefined) {
        const parsedCoTeachers = typeof body.coTeachers === 'string'
            ? (() => { try { return JSON.parse(body.coTeachers); } catch (_error) { return []; } })()
            : body.coTeachers;
        const incomingById = new Map();
        (Array.isArray(parsedCoTeachers) ? parsedCoTeachers : []).forEach((row) => {
            const personId = cleanPersonId(row?.personId || row?.teacherId || row?.id);
            if (!personId) return;
            incomingById.set(personId, row?.canEdit === true);
        });
        session.delivery.coTeachers = sessionDeliveryTeamService.normalizeSessionCoTeachers(
            priorCoTeachers.map((row) => ({
                ...row,
                canEdit: incomingById.has(row.personId) ? incomingById.get(row.personId) === true : row.canEdit === true
            })),
            { mainTeacherId }
        );
    } else {
        session.delivery.coTeachers = sessionDeliveryTeamService.normalizeSessionCoTeachers(
            session.delivery.coTeachers,
            { mainTeacherId }
        );
    }

    const nextCoTeachersJson = JSON.stringify(sessionDeliveryTeamService.getSessionCoTeachers(session));
    const changed = date !== priorDate
        || startTime !== priorStart
        || endTime !== priorEnd
        || !idsEqual(teacherId, priorTeacherId)
        || teacherName !== priorTeacherName
        || nextCoTeachersJson !== priorCoTeachersJson;

    return { changed };
}

function generateMakeupSessionId(existingSessions = []) {
    const used = new Set((Array.isArray(existingSessions) ? existingSessions : [])
        .map((row) => toPublicId(row?.sessionId || row?.id))
        .filter(Boolean));
    let id = '';
    do {
        id = `SES_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    } while (used.has(id));
    return id;
}

function resetRosterForMakeup(roster = []) {
    return (Array.isArray(roster) ? roster : [])
        .map((row) => {
            const personId = cleanPersonId(row?.personId);
            if (!personId) return null;
            return {
                personId,
                attendance: 'present',
                lateMinutes: null,
                earlyLeaveMinutes: null,
                excuseRef: '',
                excuseAttachment: null,
                notes: '',
                comments: [],
                classEffortPercent: 100,
                classParticipationPercent: 100,
                respectsTeachersPercent: 100,
                respectsStudentsPercent: 100
            };
        })
        .filter(Boolean);
}

function resetGradebooksForMakeup(gradebooks = []) {
    return (Array.isArray(gradebooks) ? gradebooks : []).map((row, index) => {
        const { skills, skillFocus } = gradebookSkillCatalogService.normalizeGradebookActivitySkills(row);
        return {
            id: String(row?.id || `GB_${Date.now()}_${index}`).trim(),
            name: String(row?.name || '').trim(),
            skills,
            skillFocus,
            totalScore: Number(row?.totalScore || 0),
            activityContent: String(row?.activityContent || ''),
            includeInGradeCalculation: Boolean(row?.includeInGradeCalculation),
            scores: {}
        };
    });
}

async function assertCanCreateMakeupSession(req, classData, originalSession) {
    assertSessionScopeForRequest(req, classData, originalSession, 'manageSession');
}

function buildMakeupSession({ originalSession, classId, input, reqUser, defaultStatus, statusDefinition = null }) {
    const now = new Date().toISOString();
    const date = normalizeDateOnlyValue(input?.date);
    const startTime = normalizeClockTime(input?.startTime || originalSession?.startTime);
    const originalDurationHours = calculateSessionDurationHours(
        originalSession?.startTime,
        originalSession?.endTime,
        originalSession?.durationHours
    );
    const makeupDurationPercent = sessionStatusPolicyService.normalizeMakeupDurationPercent(
        input?.makeupDurationPercent ?? statusDefinition?.makeupDurationPercent,
        statusDefinition?.makeupDurationPercent ?? 100
    );
    const makeupDurationHours = sessionStatusPolicyService.calculateMakeupSessionDurationHours(
        originalDurationHours,
        makeupDurationPercent
    );
    const computedEndTime = sessionStatusPolicyService.addMinutesToClockTime(
        startTime,
        Math.round(makeupDurationHours * 60)
    );
    const endTime = normalizeClockTime(input?.endTime || computedEndTime || originalSession?.endTime);
    if (!date) throw new Error('Make-up session date is required.');
    if (!startTime || !endTime || startTime >= endTime) throw new Error('Make-up session start time must be before end time.');

    const teacherId = cleanPersonId(input?.teacherId || originalSession?.delivery?.deliveredBy || '');
    const teacherName = String(input?.teacherName || originalSession?.delivery?.deliveredByName || teacherId || '').trim().slice(0, 180);
    const originalSessionId = toPublicId(originalSession?.sessionId || originalSession?.id);
    const newSession = {
        sessionId: '',
        date,
        startTime,
        endTime,
        durationHours: calculateSessionDurationHours(startTime, endTime, makeupDurationHours || originalDurationHours),
        status: String(defaultStatus || 'scheduled').trim() || 'scheduled',
        notes: String(input?.notes || '').trim().slice(0, 2000),
        room: String(input?.room || originalSession?.room || '').trim().slice(0, 200),
        delivery: {
            ...(originalSession?.delivery && typeof originalSession.delivery === 'object' ? originalSession.delivery : {}),
            deliveredBy: teacherId,
            deliveredByName: teacherName,
            coTeachers: sessionDeliveryTeamService.normalizeSessionCoTeachers(
                originalSession?.delivery?.coTeachers,
                { mainTeacherId: teacherId || '' }
            )
        },
        roster: resetRosterForMakeup(originalSession?.roster),
        contentItems: normalizeSessionContentItems(originalSession?.contentItems || []),
        contentOrder: normalizeSessionContentOrder(originalSession?.contentOrder || []),
        gradebooks: resetGradebooksForMakeup(originalSession?.gradebooks || []),
        locked: false,
        makeup: {
            isMakeup: true,
            originalClassId: toPublicId(classId),
            originalSessionId,
            originalStatus: sessionStatusPolicyService.normalizeSessionStatus(originalSession?.status, originalSession?.notes),
            originalDurationHours,
            durationPercent: makeupDurationPercent,
            makeupDurationHours,
            remainingDurationHours: Number(Math.max(0, originalDurationHours - makeupDurationHours).toFixed(4)),
            createdAt: now,
            createdBy: toPublicId(reqUser?.id || reqUser?.username || ''),
            createdByPersonId: cleanPersonId(reqUser?.personId),
            reason: String(input?.reason || '').trim().slice(0, 1000)
        },
        audit: {
            createUser: toPublicId(reqUser?.id || reqUser?.username || ''),
            createDateTime: now,
            lastUpdateUser: toPublicId(reqUser?.id || reqUser?.username || ''),
            lastUpdateDateTime: now
        }
    };
    if (!newSession.notes) newSession.notes = `Make-up for session ${originalSessionId}`;
    return newSession;
}

function isMakeUpRequiredSessionByMap(statusMap, session = {}) {
    const resolved = sessionStatusPolicyService.resolveStatusDefinition(statusMap, {
        status: session?.status,
        notes: session?.notes
    });
    return resolved?.definition?.makeUpRequired === true;
}

async function assertSessionInstructionalActiveForRequest(classId, sessionId, req) {
    const reqUser = req?.user || req;
    const accessContext = req?.user ? buildRouteAccessContext(req) : {};
    const { classData } = await getClassByIdWithOrgCheck(classId, reqUser, accessContext);
    const sessions = await schoolDataService.getClassSessions(classId, reqUser);
    const sessionIndex = (Array.isArray(sessions) ? sessions : [])
        .findIndex((row) => idsEqual(row?.sessionId || row?.id, sessionId));
    if (sessionIndex < 0) throw new Error('Session not found.');
    const session = sessions[sessionIndex];
    if (req?.user) {
        assertSessionScopeForRequest(req, classData, session, 'manageSession');
    }
    const statusMap = await sessionStatusPolicyService.getStatusMap(classData?.orgId || getActiveOrgIdOrThrow(reqUser), {
        includeInactive: true
    });
    if (isMakeUpRequiredSessionByMap(statusMap, session)) {
        throw new Error('This original session is inactive because its status requires a make-up session. Attendance, gradebook, content, cases, and files are not available for this session. Create or open the make-up session instead.');
    }
    return { classData, sessions, sessionIndex, session, statusMap };
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
  const enabledAttendanceStatuses = attendanceMatrixMetricsService.normalizeEnabledAttendanceStatuses(
      parseData(body.enabledAttendanceStatuses) != null
          ? parseData(body.enabledAttendanceStatuses)
          : (hasBodyField('enabledAttendanceStatuses')
              ? body.enabledAttendanceStatuses
              : (existingRecord?.enabledAttendanceStatuses || null))
  );
  const cycleGroupId = String(fromBodyOrExisting('cycleGroupId', '') || '').trim();
  const cycleStartDate = normalizeDateOnlyOrEmpty(fromBodyOrExisting('cycleStartDate', ''));
  const cycleEndDate = normalizeDateOnlyOrEmpty(fromBodyOrExisting('cycleEndDate', ''));
  if (cycleStartDate && cycleEndDate && cycleEndDate < cycleStartDate) {
    throw new Error('Cycle end date cannot be before cycle start date.');
  }
  const rawIsClosedForNewEnrollment = fromBodyOrExisting('isClosedForNewEnrollment', false);
  const isClosedForNewEnrollment = rawIsClosedForNewEnrollment === true || String(rawIsClosedForNewEnrollment).trim().toLowerCase() === 'true';
  const previousEnforceEnrollmentSessionCount = existingRecord?.enforceEnrollmentSessionCount === true
    || String(existingRecord?.enforceEnrollmentSessionCount || '').trim().toLowerCase() === 'true';
  const enforceEnrollmentSessionCount = isNew ? false : previousEnforceEnrollmentSessionCount;
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
    enforceEnrollmentSessionCount,
    previousClassId,
    nextClassId,
    cycleNo,
    billingMode,
    credits: normalizeCredits(body.credits),
    allowedProgramTerms,
    statusHistory: isNew ? [{ status: (body.status || 'active'), date: now, updatedBy: reqUserId, reason: 'Initial creation' }] : [],
    curriculum, pricing, postingTemplates, schedule, instructors, enrollment, evaluation,
    enabledAttendanceStatuses,
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
            startDate: String(term.startDate || row?.startDate || '').trim(),
            endDate: String(term.endDate || row?.endDate || '').trim(),
            classesStartDate: String(term.classesStartDate || row?.classesStartDate || '').trim(),
            classesEndDate: String(term.classesEndDate || row?.classesEndDate || '').trim(),
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
        throw new Error('Rolling classes require at least one program on the Program Terms tab. Add a program without a term, or a full programأ¢â‚¬â€œterm pair. This is required for academic ledger and enrollment defaults.');
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

    const classes = await schoolDataService.fetchData('classes', query, req.user, buildRouteAccessContext(req));
    const orgs = await dataService.fetchData('organizations', {}, req.user);
    const classIds = (Array.isArray(classes) ? classes : []).map((row) => toPublicId(row?.id)).filter(Boolean);
    const periodMetricsMap = await buildClassEnrollmentPeriodMetrics(req.user, classIds, resolveOrgTodayFromRequest(req));
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
      orgToday: resolveOrgTodayFromRequest(req),
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
    const { classData } = await getClassByIdWithOrgCheck(req.params.id, req.user, buildRouteAccessContext(req));
    const lifecycleContext = await buildClassLifecycleContext(classData, req.user, resolveOrgTodayFromRequest(req));
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
            if (s.delivery) {
                s.delivery.coTeachers = sessionDeliveryTeamService.normalizeSessionCoTeachers(
                    s.delivery.coTeachers,
                    { mainTeacherId: s.delivery.deliveredBy || '' }
                );
            }
        });
    }

    res.render('school/class/classForm', {
      title: 'Edit Class', 
      classData, 
      lifecycleContext,
      orgToday: resolveOrgTodayFromRequest(req),
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
    const { classData } = await getClassByIdWithOrgCheck(req.params.id, req.user, buildRouteAccessContext(req));
    const lifecycleContext = await buildClassLifecycleContext(classData, req.user, resolveOrgTodayFromRequest(req));
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
            if (s.delivery) {
                s.delivery.coTeachers = sessionDeliveryTeamService.normalizeSessionCoTeachers(
                    s.delivery.coTeachers,
                    { mainTeacherId: s.delivery.deliveredBy || '' }
                );
            }
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

    const { classData } = await getClassByIdWithOrgCheck(sourceClassId, req.user, buildRouteAccessContext(req));

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
      enabledAttendanceStatuses: attendanceMatrixMetricsService.resolveEnabledAttendanceStatuses(classData),
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
    await assertClassSessionsWithinDateWindowOrThrow(item, sessions, req.user);
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

async function editClass(req, res) {
  let guardKey = '';
  try {
    const classId = req.params.id;
    const { classData: existing, activeOrgId } = await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
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
    await assertClassSessionsWithinDateWindowOrThrow(updates, sessions, req.user);
    const existingSessions = await schoolDataService.getClassSessions(classId, req.user);
    await schoolDependencyService.assertClassSessionLedgerPreservesTimesheetLocks({
      classId,
      orgId: existing?.orgId || activeOrgId,
      existingSessions,
      incomingSessions: sessions,
      reqUser: req.user,
      label: 'This class session ledger'
    });
    if (updates.billingMode === 'chargeable') {
        validateChargeablePostingTemplatesOrThrow(updates.postingTemplates);
        updates.postingTemplates = await resolvePostingPoliciesOrThrow(updates.postingTemplates, existing?.orgId || activeOrgId, req.user);
    } else {
        updates.postingTemplates = [];
    }
    const existingAudit = existing?.audit && typeof existing.audit === 'object' ? existing.audit : {};
    updates.audit.createUser = existingAudit.createUser || existing?.createUser || req.user?.id || '';
    updates.audit.createDateTime = existingAudit.createDateTime || existing?.createDateTime || new Date().toISOString();
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

async function showResolveCycleLinksPage(req, res) {
  try {
    const classId = String(req.params.id || '').trim();
    await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
    const returnTo = String(req.query?.returnTo || 'delete').trim();
    const focusClassId = toPublicId(req.query?.highlight || req.query?.focus || '');
    const href = classDeletePreparationService.buildDeletePreparationHref(classId, focusClassId, returnTo);
    return res.redirect(href);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

async function showDeletePreparationPage(req, res) {
  try {
    const classId = String(req.params.id || '').trim();
    await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
    const plan = await classDeletePreparationService.buildDeletePreparationPlan(classId, req.user);
    const returnTo = String(req.query?.returnTo || 'delete').trim();
    const focusClassId = toPublicId(req.query?.focus || '');

    res.render('school/class/classDeletePreparation', {
      title: `Delete Preparation: ${plan.targetClass?.title || classId}`,
      plan,
      returnTo,
      focusClassId,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

async function getDeletePreparationApi(req, res) {
  try {
    const classId = String(req.params.id || req.params.classId || '').trim();
    await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
    const plan = await classDeletePreparationService.buildDeletePreparationPlan(classId, req.user);
    return res.json({ status: 'success', data: plan });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function showClassStorageIntegrityPage(req, res) {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    res.render('school/class/classStorageIntegrity', {
      title: 'Class Storage & Integrity',
      scan: null,
      orgId: activeOrgId,
      user: req.user,
      actionStateId: req.actionStateId,
      includeModal: true
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

async function getClassStorageIntegrityScanApi(req, res) {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const scan = await classStorageIntegrityService.scanClassStorageIntegrity(activeOrgId, req.user);
    return res.json({ status: 'success', data: scan });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function postClassStorageIntegrityApplyApi(req, res) {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const mode = String(req.body?.mode || '').trim();
    const selected = req.body?.selected && typeof req.body.selected === 'object' ? req.body.selected : {};

    guardKey = idempotencyGuardService.createGuardKey([
      'class_storage_integrity_apply',
      activeOrgId,
      mode,
      selected
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Storage integrity apply is already in progress. Please wait.')) return;

    const result = await classStorageIntegrityService.applyClassStorageIntegrity({
      orgId: activeOrgId,
      reqUser: req.user,
      mode,
      selected
    });
    const scan = await classStorageIntegrityService.scanClassStorageIntegrity(activeOrgId, req.user);
    const applyErrors = Array.isArray(result?.errors) ? result.errors : [];
    const deletedCount = Object.values(result?.deleted || {}).reduce((sum, count) => sum + Number(count || 0), 0);
    const skippedCount = Object.values(result?.skipped || {}).reduce((sum, count) => sum + Number(count || 0), 0);
    const payloadOut = {
      status: applyErrors.length && !deletedCount ? 'error' : 'success',
      message: mode === 'safe_fixes'
        ? 'Safe fixes applied.'
        : (applyErrors.length
          ? `Processed with ${applyErrors.length} issue(s). Deleted ${deletedCount}, skipped ${skippedCount}.`
          : `Deleted ${deletedCount} selected record(s).`),
      data: result,
      scan
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function getCycleLinkBlockersApi(req, res) {
  try {
    const classId = String(req.params.id || req.params.classId || '').trim();
    await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
    const snapshot = await classCycleLinkResolutionService.collectCycleLinkBlockers(classId, req.user);
    return res.json({ status: 'success', data: snapshot });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function unlinkCycleLinkApi(req, res) {
  try {
    const classId = String(req.params.id || req.params.classId || '').trim();
    await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
    const referencingClassId = toPublicId(req.body?.referencingClassId || req.body?.referencingClass || '');
    const linkType = String(req.body?.linkType || '').trim();
    const result = await classCycleLinkResolutionService.unlinkCycleReference({
      targetClassId: classId,
      referencingClassId,
      linkType,
      reqUser: req.user
    });
    return res.json({
      status: 'success',
      message: 'Cycle link removed.',
      data: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function unlinkAllCycleLinksApi(req, res) {
  try {
    const classId = String(req.params.id || req.params.classId || '').trim();
    await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
    const result = await classCycleLinkResolutionService.unlinkAllCycleReferences(classId, req.user);
    const hasIssues = Array.isArray(result?.issues) && result.issues.length > 0;
    return res.json({
      status: hasIssues ? 'warning' : 'success',
      message: hasIssues
        ? `Unlinked ${result.unlinked.length} reference(s) with ${result.issues.length} issue(s).`
        : `Unlinked ${result.unlinked.length} reference(s).`,
      data: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function deleteClass(req, res) {
  let guardKey = '';
  try {
    const classId = String(req.params.id || '').trim();
    const { classData, activeOrgId } = await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
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

    try {
      await classDeletePreparationService.assertClassDeleteAllowed(classId, req.user);
    } catch (prepError) {
      if (prepError?.name === 'ClassDeleteNotAllowedError') {
        const message = String(prepError.message || 'Class cannot be deleted yet.');
        const preparationHref = String(prepError.preparationHref || classDeletePreparationService.buildDeletePreparationHref(classId)).trim();
        if (isAjax(req)) {
          return res.status(409).json({
            status: 'error',
            code: 'DELETE_BLOCKED',
            message,
            preparationHref,
            blockers: prepError.blockers || []
          });
        }
        return res.status(409).render('error', {
          title: 'Delete blocked',
          statusCode: 409,
          message,
          preparationHref,
          error: prepError,
          user: req.user
        });
      }
      throw prepError;
    }

    await schoolDataService.deleteData('classes', req.params.id, req.user);
    await indexService.rebuildIndexesForClass(req.params.id);
    const payloadOut = {
        status: 'success',
        operation: 'void',
        previousStatus: String(classData?.status || 'active'),
        newStatus: 'void',
        message: 'Class voided. Its stored workspace and history were preserved.'
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect('/school/classes');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return respondSchoolDeleteError(req, res, error, { user: req.user });
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
        const scopedResult = await getClassByIdWithOrgCheck(resolvedClassId, req.user, buildRouteAccessContext(req));
        classData = scopedResult.classData;
        conflictScopeOrgId = String(classData?.orgId || activeOrgId || '').trim();
    }
    const parsedSessions = normalizeIncomingSessions(typeof sessions === 'string' ? JSON.parse(sessions) : sessions);
    const requestedMode = String(req.body?.registrationMode || classData?.registrationMode || 'term_based').trim().toLowerCase();
    const requestedCycleStart = String(req.body?.cycleStartDate || classData?.cycleStartDate || '').trim();
    const requestedCycleEnd = String(req.body?.cycleEndDate || classData?.cycleEndDate || '').trim();
    const requestedAllowedProgramTerms = parseData(req.body?.allowedProgramTerms) || classData?.allowedProgramTerms || [];
    await assertClassSessionsWithinDateWindowOrThrow({
        ...(classData || {}),
        registrationMode: requestedMode,
        cycleStartDate: requestedCycleStart,
        cycleEndDate: requestedCycleEnd,
        orgId: classData?.orgId || activeOrgId,
        allowedProgramTerms: requestedAllowedProgramTerms
    }, parsedSessions, req.user);
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
            schoolIdentityLookupService.listSchoolPersonRecords({
                reqUser: req.user,
                requireSchoolRole: false,
                query: { limit: 2000 }
            }).then((payload) => payload.allRows || payload.rows || []),
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
                session.roster.push({
                    personId: pid,
                    attendance: 'present',
                    notes: '',
                    comments: [],
                    classEffortPercent: 100,
                    classParticipationPercent: 100,
                    respectsTeachersPercent: 100,
                    respectsStudentsPercent: 100
                }); 
            }
        });

        const personToStudentMap = schoolStudentProfileLinkService.buildPersonIdToStudentRecordIdMap(
            students,
            classData?.orgId || getActiveOrgIdOrThrow(req.user)
        );

        const enrichedRoster = session.roster.map(r => {
            const pid = cleanPersonId(r.personId);
            const person = persons.find((p) => idsEqual(p.id, pid));
            const displayName = person ? `${person.name?.first || ''} ${person.name?.last || ''}`.trim() : 'Unknown Student';
            return {
                ...r,
                personId: pid,
                name: displayName,
                studentRecordId: schoolStudentProfileLinkService.resolveStudentRecordId({
                    personId: pid,
                    personToStudentMap
                }),
                classEffortPercent: normalizeSessionRatingPercent(r.classEffortPercent),
                classParticipationPercent: normalizeSessionRatingPercent(r.classParticipationPercent),
                respectsTeachersPercent: normalizeSessionRatingPercent(r.respectsTeachersPercent),
                respectsStudentsPercent: normalizeSessionRatingPercent(r.respectsStudentsPercent)
            };
        });

        mergeGradebookScorePersonsIntoEnrichedRoster(enrichedRoster, session, persons, {
            allowedPersonIds: getClassRegistrationModeKey(classData) === 'rolling'
                ? new Set(Array.from(activePersonIds).map((id) => String(id)))
                : null,
            personToStudentMap
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
        const enabledAttendanceStatuses = attendanceMatrixMetricsService.resolveEnabledAttendanceStatuses(classData);

        res.render('school/class/sessionManager', {
            title: `Manage Session: ${session.date}`,
            classData,
            session,
            classSubjects,
            prevSessionId,    // Passed to EJS
            nextSessionId,    // Passed to EJS
            attendanceMatrixPolicyResolved,
            enabledAttendanceStatuses,
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

        const { classData } = await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const sessionIndex = sessions.findIndex(s => s.sessionId === sessionId);
        if (sessionIndex === -1) throw new Error('Session not found');
        await assertSessionManagerSessionWithinClassWindowOrThrow(classData, sessions[sessionIndex], req.user);

        // Update general session data
        sessions[sessionIndex].status = status || sessions[sessionIndex].status;
        sessions[sessionIndex].notes = notes !== undefined ? notes : sessions[sessionIndex].notes;
        // --- NEW: Save the room update ---
        if (room !== undefined) sessions[sessionIndex].room = room.trim();

        if (roster) {
            const incomingRoster = typeof roster === 'string' ? JSON.parse(roster) : roster;
            const existingRoster = sessions[sessionIndex].roster || [];
            
            // FIX: Merge the new attendance data with the existing records to preserve comments!
            const enabledAttendanceStatuses = attendanceMatrixMetricsService.resolveEnabledAttendanceStatuses(classData);
            sessions[sessionIndex].roster = incomingRoster.map(incRec => {
                const incomingPersonId = cleanPersonId(incRec.personId);
                const existRec = existingRoster.find((r) => idsEqual(r.personId, incomingPersonId)) || {};
                const attendance = attendanceMatrixMetricsService.assertAttendanceStatusAllowedForSave({
                    status: incRec.attendance,
                    enabledStatuses: enabledAttendanceStatuses,
                    previousStatus: existRec.attendance,
                    allowSystemNotApplicable: true
                });
                assertLateAttendanceMinutesPresent({
                    ...incRec,
                    personId: incomingPersonId,
                    attendance
                });
                const existingClassEffort = normalizeSessionRatingPercent(existRec.classEffortPercent);
                const existingClassParticipation = normalizeSessionRatingPercent(existRec.classParticipationPercent);
                const existingRespectsTeachers = normalizeSessionRatingPercent(existRec.respectsTeachersPercent);
                const existingRespectsStudents = normalizeSessionRatingPercent(existRec.respectsStudentsPercent);
                return {
                    personId: incomingPersonId,
                    attendance,
                    lateMinutes: incRec.lateMinutes,
                    earlyLeaveMinutes: incRec.earlyLeaveMinutes,
                    excuseRef: incRec.excuseRef,
                    excuseAttachment: incRec.excuseAttachment === undefined ? (existRec.excuseAttachment || null) : (incRec.excuseAttachment || null),
                    classEffortPercent: incRec.classEffortPercent === undefined
                        ? existingClassEffort
                        : normalizeSessionRatingPercent(incRec.classEffortPercent, existingClassEffort),
                    classParticipationPercent: incRec.classParticipationPercent === undefined
                        ? existingClassParticipation
                        : normalizeSessionRatingPercent(incRec.classParticipationPercent, existingClassParticipation),
                    respectsTeachersPercent: incRec.respectsTeachersPercent === undefined
                        ? existingRespectsTeachers
                        : normalizeSessionRatingPercent(incRec.respectsTeachersPercent, existingRespectsTeachers),
                    respectsStudentsPercent: incRec.respectsStudentsPercent === undefined
                        ? existingRespectsStudents
                        : normalizeSessionRatingPercent(incRec.respectsStudentsPercent, existingRespectsStudents),
                    notes: existRec.notes || '',       // Preserve existing student-specific notes if any
                    comments: existRec.comments || []  // PRESERVE the interactive admin comments!
                };
            });
        }

        // Save back to file via Data Service
        await schoolDataService.saveClassSessions(classId, sessions, req.user);
        await classEnrollmentSessionApplicabilityService.recomputeSessionCappedEnrollmentCompletionsForClass({
            classData,
            sessions,
            reqUser: req.user,
            activeOrgId: classData?.orgId || getActiveOrgIdOrThrow(req.user)
        });
        
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
        const { classData } = await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
        const sessionStatusMeta = await getSessionStatusMetaForOrg(classData?.orgId || getActiveOrgIdOrThrow(req.user));
        
        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const { session } = findSessionInList(sessions, sessionId);
        if (!session) throw new Error('Session not found');
        const sessionAccess = schoolRecordAccessService.resolveAccessFromRequest(req);
        let canEditSession = true;
        try {
            schoolRecordAccessService.assertSessionAccessible({
                classRow: classData,
                session,
                access: sessionAccess,
                context: 'manageSession'
            });
        } catch (manageError) {
            schoolRecordAccessService.assertSessionAccessible({
                classRow: classData,
                session,
                access: sessionAccess,
                context: 'viewSession'
            });
            canEditSession = false;
        }
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
        const canDeleteStudentCases = await adminChekersService.isAdminForRequestAsync(
            req.user,
            SECTIONS.SCHOOL_SESSIONS,
            OPERATIONS.DELETE,
            { section: { id: SECTIONS.SCHOOL_SESSIONS } }
        );
        
        const isReadOnly = !canEditSession || (isSessionLocked && !canOverride);

        // 2. Resolve effective session roster (same rules as Manage Session display)
        session.roster = await buildEnrichedSessionRosterForMutation({
            classData,
            session,
            reqUser: req.user
        });

        // 3. Fetch Curriculum Content + Session Content/Exam Stream
        const [allSubjects, examAllocations, examTemplates, examQuestions, examAssignments, studentsForExamStart] = await Promise.all([
            schoolDataService.fetchData('subjects', {}, req.user),
            schoolDataService.fetchData('examAllocations', { classId__eq: classId }, req.user),
            schoolDataService.fetchData('examTemplates', {}, req.user),
            schoolDataService.fetchData('examQuestions', {}, req.user),
            schoolDataService.fetchData('examAssignments', { classId__eq: classId }, req.user),
            schoolDataService.fetchData('students', {}, req.user)
        ]);
        const currentUserPersonId = String(req.user?.personId || '').trim();
        const ownedStudentIdsForExamStart = new Set((Array.isArray(studentsForExamStart) ? studentsForExamStart : [])
            .filter((row) => idsEqual(row?.personId, currentUserPersonId))
            .map((row) => String(row?.id || '').trim())
            .filter(Boolean));
        const isStaffForExamStart = isSchoolRequestAdmin(req.user, SECTIONS.SCHOOL_EXAMS_TAKING, OPERATIONS.START)
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

        const isReportAdminViewer = isSchoolRequestAdmin(req.user, SECTIONS.SCHOOL_REPORTS_INSTANCES, OPERATIONS.READ_ALL);
        const sessionReportViewerContext = await sessionReportInstanceService.buildSessionReportViewerContext({
            classId,
            sessionRoster: session.roster,
            reqUser: req.user,
            isReportAdminViewer
        });
        const sessionReportInstanceRows = await sessionReportInstanceService.buildSessionReportInstanceRows({
            classId,
            sessionId,
            sessionDate: session?.date,
            reqUser: req.user,
            viewerContext: sessionReportViewerContext,
            sessionRoster: session.roster
        });
        const reportAssignmentCreateAccess = await accessService.evaluateAccess({
            user: req.user,
            sectionId: SECTIONS.SCHOOL_REPORTS_ASSIGNMENT,
            operationId: OPERATIONS.CREATE,
            ipAddress: req.ip
        }).catch(() => null);


        const orgPolicyLayerMs = await attendanceMatrixPolicyModel.getPolicyForOrg(
            classData?.orgId || getActiveOrgIdOrThrow(req.user)
        );
        const attendanceMatrixPolicyResolved = attendanceMatrixMetricsService.resolvePolicy(classData, orgPolicyLayerMs);
        const enabledAttendanceStatuses = attendanceMatrixMetricsService.resolveEnabledAttendanceStatuses(classData);
        const conductRatingScaleResolved = await conductRatingScalePolicyModel.getPolicyForOrg(
            classData?.orgId || getActiveOrgIdOrThrow(req.user)
        );
        const sessionStudentCases = await sessionStudentCaseService.listCasesForSession({
            classId,
            sessionId,
            reqUser: req.user
        });

        const sessionCoTeachers = sessionDeliveryTeamService.getSessionCoTeachers(session);
        const viewerPersonId = String(req.user?.personId || '').trim();
        const canManageCoTeachers = Boolean(canOverride);
        const canToggleCoTeacherEdit = Boolean(
            canOverride
            || (canEditSession && sessionDeliveryTeamService.isPersonSessionMainTeacher(session, viewerPersonId))
        );

        res.render('school/class/sessionManager', {
            title: `Manage Session: ${session.date}`,
            classData,
            session,
            classSubjects,
            sessionContentItems,
            sessionContentOrder,
            sessionExamContentItems,
            combinedSessionContent,
            sessionReportInstanceRows,
            canAssignSessionReports: Boolean(reportAssignmentCreateAccess?.allowed),
            sessionStatusMeta: getActiveSessionStatusMeta(sessionStatusMeta),
            defaultSessionStatusCode: resolveDefaultSessionStatusCode(sessionStatusMeta),
            prevSessionId,    
            nextSessionId,    
            isSessionLocked, 
            isReadOnly,
            canEditSessionMetadata: canOverride,
            canManageConductRatingScale: canOverride,
            canDeleteStudentCases,
            sessionCoTeachers,
            canManageCoTeachers,
            canToggleCoTeacherEdit,
            attendanceMatrixPolicyResolved,
            enabledAttendanceStatuses,
            conductRatingScaleResolved,
            sessionStudentCases,
            studentCaseDetailPresets: getPresetConfig(),
            gradebookSkills: gradebookSkillCatalogService.listGradebookSkills(),
            includeModal: true,  
            user: req.user,
            actionStateId: req.actionStateId
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

async function assignReportToSession(req, res) {
    try {
        const { id: classId, sessionId } = req.params;
        const { classData } = await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const { session } = findSessionInList(sessions, sessionId);
        if (!session) throw new Error('Session not found.');
        assertSessionScopeForRequest(req, classData, session);

        const enrichedRoster = await buildEnrichedSessionRosterForMutation({
            classData,
            session,
            reqUser: req.user
        });

        const result = await sessionReportAssignmentService.createAssignmentForSession({
            classData,
            session,
            sessionRoster: enrichedRoster,
            input: req.body || {},
            reqUser: req.user
        });

        const viewerContext = await sessionReportInstanceService.buildSessionReportViewerContext({
            classId,
            sessionRoster: enrichedRoster,
            reqUser: req.user,
            isReportAdminViewer: true
        });
        const rows = await sessionReportInstanceService.buildSessionReportInstanceRows({
            classId,
            sessionId,
            sessionDate: session?.date,
            reqUser: req.user,
            viewerContext,
            sessionRoster: enrichedRoster
        });

        return res.json({
            status: 'success',
            message: result.message || 'Report assigned to this session.',
            assignmentId: result.assignment?.id || '',
            rows,
            actionStateId: req.actionStateId
        });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
}
async function listSessionReportInstances(req, res) {
    try {
        const { id: classId, sessionId } = req.params;
        const { classData } = await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const { index: sessionIndex, session } = findSessionInList(sessions, sessionId);
        if (!session) throw new Error('Session not found.');

        assertSessionScopeForRequest(req, classData, session);

        const enrichedRoster = await buildEnrichedSessionRosterForMutation({
            classData,
            session,
            reqUser: req.user
        });

        const isReportAdminViewer = isSchoolRequestAdmin(req.user, SECTIONS.SCHOOL_REPORTS_INSTANCES, OPERATIONS.READ_ALL);
        const viewerContext = await sessionReportInstanceService.buildSessionReportViewerContext({
            classId,
            sessionRoster: enrichedRoster,
            reqUser: req.user,
            isReportAdminViewer
        });
        const rows = await sessionReportInstanceService.buildSessionReportInstanceRows({
            classId,
            sessionId,
            sessionDate: session?.date,
            reqUser: req.user,
            viewerContext,
            sessionRoster: enrichedRoster
        });
        return res.json({
            status: 'success',
            rows,
            refreshedAt: new Date().toISOString()
        });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
}

async function listSessionStudentCases(req, res) {
    try {
        const { id: classId, sessionId } = req.params;
        await assertSessionInstructionalActiveForRequest(classId, sessionId, req);
        const cases = await sessionStudentCaseService.listCasesForSession({ classId, sessionId, reqUser: req.user });
        return res.json({ status: 'success', cases });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
}

async function saveSessionStudentCase(req, res) {
    try {
        const { id: classId, sessionId, caseId = '' } = req.params;
        await assertSessionInstructionalActiveForRequest(classId, sessionId, req);
        const saved = await sessionStudentCaseService.saveCase({
            classId,
            sessionId,
            caseId,
            input: req.body || {},
            reqUser: req.user
        });
        const message = String(saved?.status || '').toLowerCase() === 'resolved'
            ? 'Student case saved and resolved.'
            : 'Student case saved.';
        return res.json({ status: 'success', message, case: saved });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
}

async function updateSessionStudentCaseStatus(req, res) {
    try {
        const { id: classId, sessionId, caseId } = req.params;
        await assertSessionInstructionalActiveForRequest(classId, sessionId, req);
        const saved = await sessionStudentCaseService.updateStatus({
            classId,
            sessionId,
            caseId,
            status: req.body?.status,
            note: req.body?.note || '',
            reqUser: req.user
        });
        return res.json({ status: 'success', message: 'Student case updated.', case: saved });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
}

async function deleteSessionStudentCase(req, res) {
    try {
        const { id: classId, sessionId, caseId } = req.params;
        const isAdmin = await adminChekersService.isAdminForRequestAsync(
            req.user,
            SECTIONS.SCHOOL_SESSIONS,
            OPERATIONS.DELETE,
            { section: { id: SECTIONS.SCHOOL_SESSIONS } }
        );
        if (!isAdmin) {
            return res.status(403).json({ status: 'error', message: 'Only administrators can delete student cases.' });
        }
        await assertSessionInstructionalActiveForRequest(classId, sessionId, req);
        const deleted = await sessionStudentCaseService.deleteCase({
            classId,
            sessionId,
            caseId,
            reqUser: req.user
        });
        return res.json({ status: 'success', message: 'Student case deleted.', deleted });
    } catch (error) {
        return res.status(error.statusCode || 400).json({ status: 'error', message: error.message });
    }
}

async function deleteClassSession(req, res) {
  try {
    const classId = toPublicId(req.params.id);
    const sessionId = toPublicId(req.params.sessionId);
    const { classData } = await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
    const sessions = await schoolDataService.getClassSessions(classId, req.user);
    const target = (Array.isArray(sessions) ? sessions : []).find((row) => idsEqual(row?.sessionId || row?.id, sessionId));
    if (!target) throw new Error('Session not found.');

    const preview = await schoolDeletionGuardService.previewDelete({
      entityKey: 'session', id: sessionId, orgId: classData.orgId, reqUser: req.user, context: { classId }
    });
    const cascadeCodes = new Set(['REPORT_INSTANCE', 'REPORT_ASSIGNMENT', 'SESSION_CASE']);
    const protectedBlockers = (preview.blockers || []).filter((row) => !cascadeCodes.has(row.code));
    if (protectedBlockers.length) {
      throw new schoolDeletionGuardService.DeleteBlockedError({ ...preview, blockers: protectedBlockers, canDelete: false });
    }

    const [cases, instances, assignments] = await Promise.all([
      schoolDataService.fetchData('sessionStudentCases', { classId__eq: classId, sessionId__eq: sessionId, page: 1, limit: 10000 }, req.user),
      schoolDataService.fetchData('reportInstances', { classId__eq: classId, sessionId__eq: sessionId, page: 1, limit: 10000 }, req.user),
      schoolDataService.fetchData('reportAssignments', { classId__eq: classId, sessionId__eq: sessionId, page: 1, limit: 10000 }, req.user)
    ]);
    for (const row of [...(cases || []), ...(instances || [])]) {
      const entityType = (cases || []).includes(row) ? 'sessionStudentCases' : 'reportInstances';
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.deleteData(entityType, row.id, req.user, { skipDeletionGuard: true });
    }
    for (const row of (assignments || [])) {
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.deleteData('reportAssignments', row.id, req.user, { skipDeletionGuard: true });
    }
    const remaining = sessions.filter((row) => !idsEqual(row?.sessionId || row?.id, sessionId));
    await schoolDataService.saveClassSessions(classId, remaining, req.user);
    return res.json({
      status: 'success', operation: 'physical-delete', entityType: 'classSession', id: sessionId,
      deletedCounts: { classSessions: 1, sessionStudentCases: cases.length, reportInstances: instances.length, reportAssignments: assignments.length }
    });
  } catch (error) {
    return schoolDeletionGuardService.handleDeleteError(req, res, error);
  }
}

async function uploadSessionFile(req, res) {
    try {
        const { id: classId, sessionId } = req.params;
        const studentPersonId = String(req.body?.studentPersonId || req.body?.personId || '').trim();
        const kind = String(req.body?.kind || 'file').trim() || 'file';
        if (!classId || !sessionId) throw new Error('classId and sessionId are required.');
        if (!req.file) throw new Error('No file was uploaded.');

        const { classData, session } = await assertSessionInstructionalActiveForRequest(classId, sessionId, req);
        await assertSessionManagerSessionWithinClassWindowOrThrow(classData, session, req.user);

        const file = schoolFileService.normalizeUploadedFile(req.file, {
            kind,
            classId,
            sessionId,
            studentPersonId,
            uploadedBy: req.user?.id
        });

        return res.json({ status: 'success', message: 'File uploaded.', file });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
}

async function createMakeupSession(req, res) {
    try {
        const { id: classId, sessionId } = req.params;
        const { classData } = await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const originalIndex = (Array.isArray(sessions) ? sessions : [])
            .findIndex((row) => idsEqual(row?.sessionId || row?.id, sessionId));
        if (originalIndex < 0) throw new Error('Original session not found.');

        const originalSession = sessions[originalIndex];
        await assertCanCreateMakeupSession(req, classData, originalSession);

        const statusMap = await sessionStatusPolicyService.getStatusMap(classData?.orgId || getActiveOrgIdOrThrow(req.user), {
            includeInactive: true
        });
        const resolvedStatus = sessionStatusPolicyService.resolveStatusDefinition(statusMap, {
            status: originalSession?.status,
            notes: originalSession?.notes
        });
        const statusDefinition = resolvedStatus.definition || null;
        if (statusDefinition?.makeUpRequired !== true) {
            throw new Error(`Session status "${statusDefinition?.label || resolvedStatus.normalized || 'Unknown'}" does not allow a make-up session.`);
        }

        const statusMeta = await getSessionStatusMetaForOrg(classData?.orgId || getActiveOrgIdOrThrow(req.user));
        const makeupSession = buildMakeupSession({
            originalSession,
            classId,
            input: req.body || {},
            reqUser: req.user,
            defaultStatus: resolveDefaultSessionStatusCode(statusMeta),
            statusDefinition
        });
        makeupSession.sessionId = generateMakeupSessionId(sessions);
        await assertSessionManagerSessionWithinClassWindowOrThrow(classData, makeupSession, req.user);

        if (!isSchoolRequestAdmin(req.user, SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE)) {
            const currentPersonId = cleanPersonId(req.user?.personId);
            const targetTeacherId = cleanPersonId(makeupSession?.delivery?.deliveredBy);
            if (targetTeacherId && currentPersonId && !idsEqual(targetTeacherId, currentPersonId)) {
                throw new Error('Teachers can create make-up sessions only for themselves. Ask an administrator to assign another teacher.');
            }
        }

        const warnings = [];
        const existingMakeups = (Array.isArray(sessions) ? sessions : []).filter((row) => (
            row?.makeup?.isMakeup === true
            && idsEqual(row?.makeup?.originalClassId, classId)
            && idsEqual(row?.makeup?.originalSessionId, sessionId)
        ));
        if (existingMakeups.length) {
            warnings.push(`${existingMakeups.length} make-up session(s) already exist for this original session.`);
        }
        try {
            const conflicts = await detectSessionConflicts({
                classId,
                sessions: [makeupSession],
                activeOrgId: classData?.orgId || getActiveOrgIdOrThrow(req.user),
                reqUser: req.user,
                fallbackTeacherId: cleanPersonId(makeupSession?.delivery?.deliveredBy)
            });
            if (Array.isArray(conflicts) && conflicts.length) {
                warnings.push(...conflicts.slice(0, 6).map((row) => `${row.teacherName || 'Teacher'} has a conflict on ${row.date || makeupSession.date}: ${row.conflictClass || 'schedule conflict'} ${row.existTime ? `(${row.existTime})` : ''}`.trim()));
                if (conflicts.length > 6) warnings.push(`${conflicts.length - 6} more conflict warning(s) were detected.`);
            }
        } catch (warningError) {
            warnings.push(`Conflict preview was not available: ${warningError.message}`);
        }

        if (warnings.length && !parseBoolean(req.body?.force, false)) {
            return res.status(409).json({
                status: 'warning',
                code: 'MAKEUP_SESSION_WARNINGS',
                message: 'Review make-up session warnings before creating this session.',
                data: {
                    requiresConfirmation: true,
                    warnings
                }
            });
        }

        const historyRow = {
            makeupSessionId: makeupSession.sessionId,
            makeupDate: makeupSession.date,
            makeupStartTime: makeupSession.startTime,
            makeupEndTime: makeupSession.endTime,
            makeupDurationPercent: makeupSession.makeup?.durationPercent || null,
            makeupDurationHours: makeupSession.makeup?.makeupDurationHours || makeupSession.durationHours || null,
            teacherId: makeupSession.delivery?.deliveredBy || '',
            teacherName: makeupSession.delivery?.deliveredByName || '',
            createdAt: makeupSession.makeup.createdAt,
            createdBy: makeupSession.makeup.createdBy,
            reason: makeupSession.makeup.reason
        };
        originalSession.makeupScheduling = {
            durationPercent: makeupSession.makeup?.durationPercent || statusDefinition?.makeupDurationPercent || 100,
            configuredAt: makeupSession.makeup.createdAt
        };
        originalSession.makeupHistory = Array.isArray(originalSession.makeupHistory)
            ? [...originalSession.makeupHistory, historyRow]
            : [historyRow];
        originalSession.audit = {
            ...(originalSession.audit || {}),
            lastUpdateUser: toPublicId(req.user?.id || req.user?.username || ''),
            lastUpdateDateTime: new Date().toISOString()
        };

        sessions.push(makeupSession);
        await schoolDataService.saveClassSessions(classId, sessions, req.user);
        await indexService.rebuildIndexesForClass(classId);

        return res.json({
            status: 'success',
            message: 'Make-up session created.',
            data: {
                classId: toPublicId(classId),
                originalSessionId: toPublicId(sessionId),
                makeupSession,
                makeupHistory: originalSession.makeupHistory,
                warnings
            }
        });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
}

async function saveSession(req, res) {
    try {
        const { id: classId, sessionId } = req.params;
        const { status, notes, room, roster, contentItems, contentOrder, skillsCovered } = req.body; 
        const forceRemoveMakeups = parseBoolean(req.body?.forceRemoveMakeups, false);
        const forceMetadataConflicts = parseBoolean(req.body?.force, false);
        const { classData } = await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const { index: sessionIndex } = findSessionInList(sessions, sessionId);
        if (sessionIndex === -1) throw new Error('Session not found');
        assertSessionScopeForRequest(req, classData, sessions[sessionIndex]);
        const originalSession = sessions[sessionIndex];

        const statusMap = await sessionStatusPolicyService.getStatusMap(classData?.orgId || getActiveOrgIdOrThrow(req.user), {
            includeInactive: true
        });

        // --- Backend Save Protection ---
        const isSessionLocked = sessions[sessionIndex].locked === true || String(sessions[sessionIndex].locked) === 'true';
        schoolDependencyService.assertSessionNotTimesheetLocked(sessions[sessionIndex], 'This session');
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
        const normalizedStatus = sessionStatusPolicyService.normalizeStatusCode(status || originalSession.status || '');
        if (!normalizedStatus || !statusMap.has(normalizedStatus)) {
            throw new Error('Invalid session status.');
        }
        const wasCompletion = sessionStatusPolicyService.isSessionCompletionStatusByMap(statusMap, originalSession);
        const willBeCompletion = sessionStatusPolicyService.isSessionCompletionStatusByMap(statusMap, {
            ...originalSession,
            status: normalizedStatus
        });
        if (!wasCompletion && willBeCompletion) {
            const enrichedRosterForReports = await buildEnrichedSessionRosterForMutation({
                classData,
                session: originalSession,
                reqUser: req.user
            });
            const pendingReports = await sessionReportInstanceService.listUnsubmittedSessionReports({
                classId,
                sessionId,
                sessionDate: originalSession?.date,
                reqUser: req.user,
                sessionRoster: enrichedRosterForReports
            });
            if (pendingReports.length) {
                const blockMessage = 'This session cannot be marked completed until all assigned reports are submitted.';
                if (req.headers['x-ajax-request']) {
                    return res.status(400).json({
                        status: 'error',
                        code: 'PENDING_REPORTS_BLOCK_COMPLETION',
                        message: blockMessage,
                        data: { pendingReports }
                    });
                }
                throw new Error(blockMessage);
            }
        }
        const currentMakeupInactive = isMakeUpRequiredSessionByMap(statusMap, originalSession);
        const nextMakeupInactive = isMakeUpRequiredSessionByMap(statusMap, {
            ...originalSession,
            status: normalizedStatus
        });
        const removingMakeupRequirement = currentMakeupInactive && !nextMakeupInactive;
        const linkedMakeupSessions = removingMakeupRequirement
            ? sessions.filter((row, idx) => idx !== sessionIndex
                && row?.makeup?.isMakeup === true
                && idsEqual(row?.makeup?.originalClassId, classId)
                && idsEqual(row?.makeup?.originalSessionId, sessionId))
            : [];
        const linkedMakeupRows = linkedMakeupSessions.map((row) => ({
            sessionId: toPublicId(row?.sessionId || row?.id),
            date: normalizeDateOnlyValue(row?.date),
            startTime: normalizeClockTime(row?.startTime),
            endTime: normalizeClockTime(row?.endTime),
            teacherId: cleanPersonId(row?.delivery?.deliveredBy),
            teacherName: String(row?.delivery?.deliveredByName || '').trim(),
            room: String(row?.room || '').trim(),
            status: sessionStatusPolicyService.normalizeSessionStatus(row?.status, row?.notes)
        }));
        if (linkedMakeupRows.length && !forceRemoveMakeups) {
            const warningMessage = 'You already have make-up sessions scheduled for this original session. Changing to a status that does not require make-up is not allowed until all linked make-up sessions are removed.';
            if (req.headers['x-ajax-request']) {
                return res.status(409).json({
                    status: 'warning',
                    code: 'MAKEUP_SESSIONS_EXIST',
                    message: warningMessage,
                    data: {
                        requiresConfirmation: true,
                        originalSessionId: toPublicId(sessionId),
                        makeupSessions: linkedMakeupRows
                    }
                });
            }
            throw new Error(warningMessage);
        }
        let removedMakeupCount = 0;
        if (linkedMakeupRows.length && forceRemoveMakeups) {
            const removedIds = new Set(linkedMakeupRows.map((row) => toPublicId(row.sessionId)).filter(Boolean));
            const activeOrgId = getActiveOrgIdOrThrow(req.user);
            for (let idx = sessions.length - 1; idx >= 0; idx -= 1) {
                const row = sessions[idx];
                if (idx === sessionIndex) continue;
                if (row?.makeup?.isMakeup !== true) continue;
                if (!idsEqual(row?.makeup?.originalClassId, classId)) continue;
                if (!idsEqual(row?.makeup?.originalSessionId, sessionId)) continue;
                const makeupSessionId = toPublicId(row?.sessionId || row?.id);
                if (makeupSessionId) {
                    // eslint-disable-next-line no-await-in-loop
                    await schoolDeletionGuardService.assertCanDelete({
                        entityKey: 'session',
                        id: makeupSessionId,
                        orgId: activeOrgId,
                        reqUser: req.user,
                        context: { classId }
                    });
                }
                sessions.splice(idx, 1);
                removedMakeupCount += 1;
            }
            if (Array.isArray(originalSession.makeupHistory)) {
                originalSession.makeupHistory = originalSession.makeupHistory.filter((row) => {
                    const linkedId = toPublicId(row?.makeupSessionId || row?.sessionId || '');
                    return !linkedId || !removedIds.has(linkedId);
                });
            } else {
                originalSession.makeupHistory = [];
            }
            originalSession.audit = {
                ...(originalSession.audit || {}),
                lastUpdateUser: toPublicId(req.user?.id || req.user?.username || ''),
                lastUpdateDateTime: new Date().toISOString()
            };
        }
        const shouldSkipInstructionalPayload = currentMakeupInactive || nextMakeupInactive;

        const normalizedNotes = notes !== undefined ? String(notes || '').trim() : originalSession.notes;
        const normalizedRoom = room !== undefined ? String(room || '').trim() : originalSession.room;

        originalSession.status = normalizedStatus;
        originalSession.notes = normalizedNotes;
        originalSession.room = normalizedRoom;
        if (!shouldSkipInstructionalPayload && contentItems !== undefined) {
            const parsed = typeof contentItems === 'string' ? JSON.parse(contentItems || '[]') : contentItems;
            originalSession.contentItems = normalizeSessionContentItems(parsed);
        }
        if (!shouldSkipInstructionalPayload && contentOrder !== undefined) {
            const parsedOrder = typeof contentOrder === 'string' ? JSON.parse(contentOrder || '[]') : contentOrder;
            originalSession.contentOrder = normalizeSessionContentOrder(parsedOrder);
        }
        if (!shouldSkipInstructionalPayload && skillsCovered !== undefined) {
            originalSession.skillsCovered = gradebookSkillCatalogService.normalizeSessionSkillsCovered(skillsCovered);
        }

        if (!shouldSkipInstructionalPayload && roster !== undefined) {
            const incomingRoster = typeof roster === 'string' ? JSON.parse(roster) : roster;
            if (!Array.isArray(incomingRoster)) {
                throw new Error('Invalid roster payload.');
            }
            const sessionForAttendanceWindow = {
                ...originalSession,
                date: canOverride && req.body?.date !== undefined
                    ? normalizeDateOnlyValue(req.body.date)
                    : originalSession.date
            };
            await assertSessionRosterEnrollmentWindows({
                classData,
                session: sessionForAttendanceWindow,
                incomingRoster,
                reqUser: req.user
            });
            const existingRoster = originalSession.roster || [];
            const orgPolicyLayerSave = await attendanceMatrixPolicyModel.getPolicyForOrg(
                classData?.orgId || getActiveOrgIdOrThrow(req.user)
            );
            const matrixPolicySave = attendanceMatrixMetricsService.resolvePolicy(classData, orgPolicyLayerSave);
            const enabledAttendanceStatuses = attendanceMatrixMetricsService.resolveEnabledAttendanceStatuses(classData);

            originalSession.roster = incomingRoster.map((incRec) => {
                const incomingPersonId = cleanPersonId(incRec.personId);
                if (!incomingPersonId) return null;
                const existRec = existingRoster.find((r) => idsEqual(r.personId, incomingPersonId)) || {};
                const attendance = attendanceMatrixMetricsService.assertAttendanceStatusAllowedForSave({
                    status: incRec.attendance,
                    enabledStatuses: enabledAttendanceStatuses,
                    previousStatus: existRec.attendance,
                    allowSystemNotApplicable: true
                });
                assertLateAttendanceMinutesPresent({
                    ...incRec,
                    personId: incomingPersonId,
                    attendance
                });
                const existingClassEffort = normalizeSessionRatingPercent(existRec.classEffortPercent);
                const existingClassParticipation = normalizeSessionRatingPercent(existRec.classParticipationPercent);
                const existingRespectsTeachers = normalizeSessionRatingPercent(existRec.respectsTeachersPercent);
                const existingRespectsStudents = normalizeSessionRatingPercent(existRec.respectsStudentsPercent);
                const merged = {
                    personId: incomingPersonId,
                    attendance,
                    lateMinutes: incRec.lateMinutes,
                    earlyLeaveMinutes: incRec.earlyLeaveMinutes,
                    excuseRef: incRec.excuseRef,
                    excuseAttachment: incRec.excuseAttachment === undefined ? (existRec.excuseAttachment || null) : (incRec.excuseAttachment || null),
                    classEffortPercent: incRec.classEffortPercent === undefined
                        ? existingClassEffort
                        : normalizeSessionRatingPercent(incRec.classEffortPercent, existingClassEffort),
                    classParticipationPercent: incRec.classParticipationPercent === undefined
                        ? existingClassParticipation
                        : normalizeSessionRatingPercent(incRec.classParticipationPercent, existingClassParticipation),
                    respectsTeachersPercent: incRec.respectsTeachersPercent === undefined
                        ? existingRespectsTeachers
                        : normalizeSessionRatingPercent(incRec.respectsTeachersPercent, existingRespectsTeachers),
                    respectsStudentsPercent: incRec.respectsStudentsPercent === undefined
                        ? existingRespectsStudents
                        : normalizeSessionRatingPercent(incRec.respectsStudentsPercent, existingRespectsStudents),
                    notes: existRec.notes || '',
                    comments: existRec.comments || []
                };
                const ruled = attendanceMatrixMetricsService.applyAttendanceMatrixRosterRules(merged, matrixPolicySave);
                return {
                    ...ruled,
                    attendance: attendanceMatrixMetricsService.coerceAttendanceStatusToEnabled(
                        ruled.attendance,
                        enabledAttendanceStatuses
                    )
                };
            }).filter(Boolean);
        }

        const normalizedMetadataBody = await normalizeSessionMetadataTeacherInput(req.body || {}, {
            activeOrgId: classData?.orgId || getActiveOrgIdOrThrow(req.user),
            reqUser: req.user
        });
        const viewerPersonId = String(req.user?.personId || '').trim();
        const canManageCoTeachers = Boolean(canOverride);
        const canToggleCoTeacherEdit = Boolean(
            canOverride
            || sessionDeliveryTeamService.isPersonSessionMainTeacher(originalSession, viewerPersonId)
        );
        const { changed: metadataChanged } = applyAdminSessionMetadataUpdate(
            originalSession,
            normalizedMetadataBody,
            { canOverride, canManageCoTeachers, canToggleCoTeacherEdit }
        );
        await assertSessionManagerSessionWithinClassWindowOrThrow(classData, originalSession, req.user);
        if (metadataChanged) {
            assertSessionManagerSessionWithinCycleWindowOrThrow(classData, originalSession);

            const mergedSessions = sessions.map((row, idx) => (idx === sessionIndex ? originalSession : row));
            const conflicts = await detectSessionConflicts({
                classId,
                sessions: mergedSessions,
                activeOrgId: classData?.orgId || getActiveOrgIdOrThrow(req.user),
                reqUser: req.user,
                fallbackTeacherId: resolveSessionTeacherId(originalSession),
                includeExternalScheduleConflicts: true,
                externalFocusSessionIds: [sessionId]
            });
            if (Array.isArray(conflicts) && conflicts.length && !forceMetadataConflicts) {
                const warningMessage = 'Schedule conflicts were detected for the updated session date, time, or teacher.';
                if (req.headers['x-ajax-request']) {
                    return res.status(409).json({
                        status: 'warning',
                        code: 'SESSION_METADATA_CONFLICTS',
                        message: warningMessage,
                        data: {
                            requiresConfirmation: true,
                            conflicts: conflicts.slice(0, 12).map((row) => ({
                                date: row?.date || originalSession.date,
                                teacherName: row?.teacherName || '',
                                conflictClass: row?.conflictClass || 'schedule conflict',
                                existTime: row?.existTime || ''
                            }))
                        }
                    });
                }
                throw new Error(warningMessage);
            }
            originalSession.audit = {
                ...(originalSession.audit || {}),
                lastUpdateUser: toPublicId(req.user?.id || req.user?.username || ''),
                lastUpdateDateTime: new Date().toISOString()
            };
        }

        await schoolDataService.saveClassSessions(classId, sessions, req.user);
        await classEnrollmentSessionApplicabilityService.recomputeSessionCappedEnrollmentCompletionsForClass({
            classData,
            sessions,
            reqUser: req.user,
            activeOrgId: classData?.orgId || getActiveOrgIdOrThrow(req.user)
        });
        
        const indexService = require('../../services/school/schoolIndexService');
        await indexService.rebuildIndexesForClass(classId);

        if (req.headers['x-ajax-request']) {
            const message = removedMakeupCount > 0
                ? `Removed ${removedMakeupCount} linked make-up session(s) and saved session data successfully.`
                : 'Session data saved successfully.';
            return res.json({ status: 'success', message });
        }
        res.redirect(`/school/classes/sessions/${classId}/${sessionId}`);
    } catch (error) {
        if (req.headers['x-ajax-request']) {
            const payload = { status: 'error', message: error.message };
            if (error.code) payload.code = error.code;
            return res.status(error.statusCode || 400).json(payload);
        }
        res.status(error.statusCode || 400).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

async function saveSessionGradebooks(req, res) {
    try {
        const { id: classId, sessionId } = req.params;
        const { classData } = await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));

        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const { index: sessionIndex } = findSessionInList(sessions, sessionId);
        if (sessionIndex === -1) throw new Error('Session not found');
        assertSessionScopeForRequest(req, classData, sessions[sessionIndex]);
        await assertSessionManagerSessionWithinClassWindowOrThrow(classData, sessions[sessionIndex], req.user);

        const statusMap = await sessionStatusPolicyService.getStatusMap(classData?.orgId || getActiveOrgIdOrThrow(req.user), {
            includeInactive: true
        });
        if (isMakeUpRequiredSessionByMap(statusMap, sessions[sessionIndex])) {
            throw new Error('This original session is inactive because its status requires a make-up session. Gradebook is not available for this session. Create or open the make-up session instead.');
        }

        const isSessionLocked = sessions[sessionIndex].locked === true || String(sessions[sessionIndex].locked) === 'true';
        schoolDependencyService.assertSessionNotTimesheetLocked(sessions[sessionIndex], 'This session');
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

        const enrichedRoster = await buildEnrichedSessionRosterForMutation({
            classData,
            session: sessions[sessionIndex],
            reqUser: req.user
        });
        const personIds = [...new Set(enrichedRoster.map((r) => cleanPersonId(r.personId)).filter(Boolean))];
        const attendanceByPerson = new Map();
        enrichedRoster.forEach((r) => {
            const pid = cleanPersonId(r.personId);
            if (pid) {
                attendanceByPerson.set(pid, attendanceMatrixMetricsService.normalizeStatus(r.attendance, attendanceMatrixMetricsService.ATTENDANCE_STATUS.ABSENT));
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
                const isAbsent = attendanceMatrixMetricsService.isAbsentLikeStatus(att)
                    || att === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE;
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

            const { skills, skillFocus } = gradebookSkillCatalogService.normalizeGradebookActivitySkills(gb);
            normalized.push({
                id: gbId,
                name: name.slice(0, 200),
                skills,
                skillFocus,
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
        const { classData } = await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
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
        const { classData } = await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
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

async function saveConductRatingScaleSettings(req, res) {
    try {
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        const policy = await conductRatingScalePolicyModel.savePolicyForOrg(activeOrgId, req.body, req.user?.id);
        return res.json({ status: 'success', policy });
    } catch (error) {
        const validationErrors = Array.isArray(error?.validationErrors) ? error.validationErrors : [];
        const message = validationErrors.length
            ? validationErrors.join(' ')
            : (error?.message || 'Failed to save conduct rating scale settings.');
        return res.status(validationErrors.length ? 400 : 500).json({ status: 'error', message, validationErrors });
    }
}

async function saveSessionConduct(req, res) {
    try {
        const { id: classId, sessionId } = req.params;
        const { classData } = await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const { index: sessionIndex } = findSessionInList(sessions, sessionId);
        if (sessionIndex === -1) {
            return res.status(404).json({ status: 'error', message: 'Session not found.' });
        }

        const session = sessions[sessionIndex];
        assertSessionScopeForRequest(req, classData, session, 'manageSession');
        await assertSessionManagerSessionWithinClassWindowOrThrow(classData, session, req.user);

        const isLocked = session.locked === true || String(session.locked) === 'true';
        const canOverride = await adminChekersService.isAdminForRequestAsync(
            req.user,
            SECTIONS.SCHOOL_CLASSES,
            OPERATIONS.UPDATE,
            { section: { id: SECTIONS.SCHOOL_CLASSES } }
        );
        if (isLocked && !canOverride) {
            return res.status(403).json({ status: 'error', message: 'This session is locked. Class conduct cannot be changed.' });
        }

        let incomingRoster = req.body?.roster;
        if (typeof incomingRoster === 'string') {
            try {
                incomingRoster = JSON.parse(incomingRoster);
            } catch (_) {
                throw new Error('Invalid conduct roster payload.');
            }
        }
        if (!Array.isArray(incomingRoster)) {
            throw new Error('Conduct roster is required.');
        }

        sessionConductService.applyConductRosterToSession(session, incomingRoster, {
            ready: true,
            userId: req.user?.id
        });
        sessions[sessionIndex] = session;
        await schoolDataService.saveClassSessions(classId, sessions, req.user);

        return res.json({
            status: 'success',
            message: 'Class conduct saved. You can now fill reports for this session.',
            conductReadyForReports: true,
            conductReadyAt: session.conductReadyAt || null
        });
    } catch (error) {
        const statusCode = Number(error?.statusCode) || 400;
        return res.status(statusCode).json({ status: 'error', message: error.message || 'Failed to save class conduct.' });
    }
}

async function setSessionLock(req, res) {
    try {
        const { id: classId, sessionId } = req.params;
        const locked = parseBoolean(req.body?.locked, null);
        if (locked === null) {
            return res.status(400).json({ status: 'error', message: 'locked is required (true or false).' });
        }

        const canOverride = await adminChekersService.isAdminForRequestAsync(
            req.user,
            SECTIONS.SCHOOL_CLASSES,
            OPERATIONS.UPDATE,
            { section: { id: SECTIONS.SCHOOL_CLASSES } }
        );
        if (!canOverride) {
            return res.status(403).json({ status: 'error', message: 'You do not have permission to lock or unlock sessions.' });
        }

        const { classData } = await getClassByIdWithOrgCheck(classId, req.user, buildRouteAccessContext(req));
        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const { index: sessionIndex } = findSessionInList(sessions, sessionId);
        if (sessionIndex === -1) {
            return res.status(404).json({ status: 'error', message: 'Session not found.' });
        }
        assertSessionScopeForRequest(req, classData, sessions[sessionIndex]);

        schoolDependencyService.applySessionAdminLock(sessions[sessionIndex], locked, req.user);
        await schoolDataService.saveClassSessions(classId, sessions, req.user);

        const updated = sessions[sessionIndex];
        return res.json({
            status: 'success',
            message: locked ? 'Session locked.' : 'Session unlocked.',
            locked: updated.locked === true || String(updated.locked) === 'true',
            lockReason: String(updated.lockReason || '')
        });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
}

module.exports = {
  listClasses, showAddForm, showAddWizardForm, addClass, showEditForm, showEditWizardForm, editClass, deleteClass,
  showResolveCycleLinksPage, showDeletePreparationPage, getDeletePreparationApi,
  showClassStorageIntegrityPage, getClassStorageIntegrityScanApi, postClassStorageIntegrityApplyApi,
  getCycleLinkBlockersApi, unlinkCycleLinkApi, unlinkAllCycleLinksApi,
  getClassTemplate,
  checkConflicts,
  previewTeacherAssignmentImpact,
  saveSession, saveSessionGradebooks, manageSession, uploadSessionFile, createMakeupSession, assignReportToSession, listSessionReportInstances, listSessionStudentCases, saveSessionStudentCase, updateSessionStudentCaseStatus, deleteSessionStudentCase, deleteClassSession,
  saveConductRatingScaleSettings,
  saveSessionConduct,
  setSessionLock,
  showFinalGradesPage,
  postOfficialFinalGradesWorkflow
};




