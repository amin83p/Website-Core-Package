// MVC/controllers/school/schoolDashboardController.js
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const accessService = requireCoreModule('MVC/services/security');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const { getDashboardSection } = requireCoreModule('MVC/controllers/dashboardController');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const DASHBOARD_ACCESS_RULES = Object.freeze([
    { pattern: /^\/school\/programs\/term-registrations(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_TERM_REGISTRATIONS },
    { pattern: /^\/school\/programs\/registrations(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS },
    { pattern: /^\/school\/programs(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_PROGRAMS },
    { pattern: /^\/school\/departments(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_DEPARTMENTS },
    { pattern: /^\/school\/subjects(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_SUBJECTS },
    { pattern: /^\/school\/terms(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_TERMS },
    { pattern: /^\/school\/classes(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_CLASSES },
    { pattern: /^\/school\/transactionTemplates(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_TRANSACTION_TEMPLATES },
    { pattern: /^\/school\/accounts(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_ACCOUNTS },
    { pattern: /^\/school\/transactions(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_TRANSACTIONS },
    { pattern: /^\/school\/academic-ledger(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_ACADEMIC_LEDGER },
    { pattern: /^\/school\/sample-data(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_SAMPLE_DATA },
    { pattern: /^\/school\/students(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_STUDENTS },
    { pattern: /^\/school\/teachers(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_TEACHERS },
    { pattern: /^\/school\/staff(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_STAFF },
    { pattern: /^\/school\/reports(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_REPORTS },
    { pattern: /^\/school\/calendar(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_CALENDAR },
    { pattern: /^\/school\/schedules(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_SCHEDULES },
    { pattern: /^\/school\/sessions(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_SESSIONS },
    { pattern: /^\/school\/attendances(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_ATTENDANCES },
    { pattern: /^\/school\/grades-matrix(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_GRADEBOOK },
    { pattern: /^\/school\/leave-requests(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_LEAVE_REQUESTS },
    { pattern: /^\/school\/tasks(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_TASKS },
    { pattern: /^\/school\/holidays(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_HOLIDAYS },
    { pattern: /^\/school\/payRates(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_PAY_RATES },
    { pattern: /^\/school\/session-statuses(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_SESSION_STATUSES },
    { pattern: /^\/school\/timesheetPeriods(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_TIMESHEET_PERIODS },
    { pattern: /^\/school\/timesheets\/manage(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT },
    { pattern: /^\/school\/timesheets(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_TIMESHEETS },
    { pattern: /^\/school\/withdrawal(?:\/|$)/i, sectionId: SECTIONS.SCHOOL_WITHDRAWAL }
]);

const DASHBOARD_VISIBLE_OPERATION_IDS = Object.freeze([
    OPERATIONS.READ_ALL,
    OPERATIONS.READ,
    OPERATIONS.CREATE,
    OPERATIONS.UPDATE,
    OPERATIONS.DELETE,
    OPERATIONS.EXPORT,
    OPERATIONS.IMPORT
]);

function inferDashboardSectionId(href) {
    const normalizedHref = String(href || '').trim();
    if (!normalizedHref) return '';
    const match = DASHBOARD_ACCESS_RULES.find((rule) => rule.pattern.test(normalizedHref));
    return String(match?.sectionId || '').trim();
}

async function canAccessDashboardSection(user, sectionId, ipAddress) {
    if (!user || !sectionId) return false;
    if (await adminAuthorityService.isAdminForRequestAsync(user, sectionId, OPERATIONS.READ_ALL, { section: { id: sectionId } })) return true;

    for (const operationId of DASHBOARD_VISIBLE_OPERATION_IDS) {
        try {
            const evaluation = await accessService.evaluateAccess({
                user,
                sectionId,
                operationId,
                ipAddress
            });
            if (evaluation?.allowed) return true;
            if (String(evaluation?.reason || '').includes('does not exist')) return false;
        } catch (_) {
            return false;
        }
    }
    return false;
}

async function filterAccessibleDashboardSections(user, sections, ipAddress) {
    const rows = Array.isArray(sections) ? sections : [];
    const accessCache = new Map();
    const allowed = [];

    for (const row of rows) {
        const sectionId = String(row?.sectionId || inferDashboardSectionId(row?.href)).trim();
        if (!sectionId) continue;

        if (!accessCache.has(sectionId)) {
            accessCache.set(sectionId, await canAccessDashboardSection(user, sectionId, ipAddress));
        }

        if (accessCache.get(sectionId)) {
            allowed.push({ ...row, sectionId });
        }
    }

    return allowed;
}

async function showDashboard(req, res) {
    try {
        const dashboardSections = [
            // Foundation / Setup
            {
                priority: 70,
                title: 'Departments',
                description: 'Define academic departments that act as the foundation for curriculum structure.',
                href: '/school/departments',
                buttonLabel: 'Manage Departments',
                icon: 'bi-diagram-3-fill',
                subtleClass: 'bg-primary-subtle text-primary',
                buttonClass: 'btn btn-primary'
            },
            {
                priority: 60,
                title: 'Subjects Curriculum',
                description: 'Define subjects, credits, and baseline teaching configuration.',
                href: '/school/subjects',
                buttonLabel: 'Manage Subjects',
                icon: 'bi-book-half',
                subtleClass: 'bg-success-subtle text-success',
                buttonClass: 'btn btn-success'
            },
            {
                priority: 50,
                title: 'Terms & Semesters',
                description: 'Define academic terms with status, date range, and lifecycle used by programs and class eligibility.',
                href: '/school/terms',
                buttonLabel: 'Manage Terms',
                icon: 'bi-calendar3-range-fill',
                subtleClass: 'bg-warning-subtle text-warning',
                buttonClass: 'btn btn-warning text-dark'
            },
            {
                priority: 40,
                title: 'Program Catalog',
                description: 'Build programs with transactions by category, ordered subjects, and prerequisites.',
                href: '/school/programs',
                buttonLabel: 'Manage Programs',
                icon: 'bi-journal-text',
                subtleClass: 'bg-info-subtle text-info',
                buttonClass: 'btn btn-info text-white'
            },
            {
                priority: 10,
                title: 'Program Registration',
                description: 'Register students into programs, review registration records, and handle rollbacks from one workflow.',
                href: '/school/programs/registrations',
                buttonLabel: 'Open Program Registrations',
                icon: 'bi-person-plus-fill',
                subtleClass: 'bg-primary-subtle text-primary',
                buttonClass: 'btn btn-primary'
            },
            {
                priority: 20,
                title: 'Term Registration',
                description: 'Build a student term with registered programs, class basket validation, prerequisite checks, and live fee preview.',
                href: '/school/programs/term-registrations',
                buttonLabel: 'Open Term Registrations',
                icon: 'bi-stars',
                subtleClass: 'bg-warning-subtle text-warning',
                buttonClass: 'btn btn-warning text-dark'
            },
            {
                priority: 90,
                title: 'Transaction Templates',
                description: 'Maintain reusable transaction templates used by programs, enrollment, and finance ledgers.',
                href: '/school/transactionTemplates',
                buttonLabel: 'Manage Transaction Templates',
                icon: 'bi-receipt-cutoff',
                subtleClass: 'bg-success-subtle text-success',
                buttonClass: 'btn btn-success'
            },
            {
                priority: 100,
                title: 'School Accounts',
                description: 'Maintain chart of accounts with hierarchy for double-entry posting templates.',
                href: '/school/accounts',
                buttonLabel: 'Manage Accounts',
                icon: 'bi-diagram-2-fill',
                subtleClass: 'bg-info-subtle text-info',
                buttonClass: 'btn btn-info text-white'
            },
            {
                priority: 110,
                title: 'Transactions Manager',
                description: 'Create manual double-entry journals, save drafts, and post only balanced transactions.',
                href: '/school/transactions',
                buttonLabel: 'Manage Transactions',
                icon: 'bi-arrow-left-right',
                subtleClass: 'bg-success-subtle text-success',
                buttonClass: 'btn btn-success'
            },
            {
                priority: 80,
                title: 'Academic Ledger',
                description: 'Track academic registrations, enrollments, scores, credits, and student progression events in one timeline.',
                href: '/school/academic-ledger',
                buttonLabel: 'View Academic Ledger',
                icon: 'bi-journal-medical',
                subtleClass: 'bg-danger-subtle text-danger',
                buttonClass: 'btn btn-danger'
            },
            {
                priority: 999,
                title: 'Sample Data Generator',
                description: 'Generate sample students, teachers, and staff for the active organization.',
                href: '/school/sample-data',
                buttonLabel: 'Generate Sample Data',
                icon: 'bi-magic',
                subtleClass: 'bg-warning-subtle text-warning',
                buttonClass: 'btn btn-warning text-dark'
            },
            // Core Academic Records
            {
                priority: 115,
                title: 'Student Directory',
                description: 'Admit and maintain student profiles with fee category and academic status.',
                href: '/school/students',
                buttonLabel: 'Manage Students',
                icon: 'bi-person-vcard-fill',
                subtleClass: 'bg-warning-subtle text-warning',
                buttonClass: 'btn btn-warning text-dark'
            },
            {
                priority: 120,
                title: 'Teacher Directory',
                description: 'Register teachers, assign employment details, and maintain instructional profiles.',
                href: '/school/teachers',
                buttonLabel: 'Manage Teachers',
                icon: 'bi-person-workspace',
                subtleClass: 'bg-primary-subtle text-primary',
                buttonClass: 'btn btn-primary'
            },
            {
                priority: 130,
                title: 'Staff Directory',
                description: 'Maintain administrative and support staff records, roles, and departments.',
                href: '/school/staff',
                buttonLabel: 'Manage Staff',
                icon: 'bi-people-fill',
                subtleClass: 'bg-info-subtle text-info',
                buttonClass: 'btn btn-info text-white'
            },
            {
                priority: 30,
                title: 'Class Management',
                description: 'Create classes, assign teachers, build schedules, and manage enrollments through term registration.',
                href: '/school/classes',
                buttonLabel: 'Manage Classes',
                icon: 'bi-easel2-fill',
                subtleClass: 'bg-danger-subtle text-danger',
                buttonClass: 'btn btn-danger'
            },
            {
                priority: 135,
                title: 'Reports',
                description: 'Design report templates, assign reports to class sessions, and collect teacher submissions.',
                href: '/school/reports',
                buttonLabel: 'Open Reports',
                icon: 'bi-file-earmark-richtext-fill',
                subtleClass: 'bg-secondary-subtle text-secondary',
                buttonClass: 'btn btn-secondary'
            },
            // Operations & Monitoring
            {
                priority: 138,
                title: 'School Calendar',
                description: 'View school days off, professional development, and personal schedule layers in a month or day-ribbon calendar.',
                href: '/school/calendar',
                buttonLabel: 'Open Calendar',
                icon: 'bi-calendar4-week',
                subtleClass: 'bg-primary-subtle text-primary',
                buttonClass: 'btn btn-primary'
            },
            {
                priority: 140,
                title: 'Master Schedule',
                description: 'View detailed schedules for a person (teacher/student) across dates.',
                href: '/school/schedules',
                buttonLabel: 'View Schedule',
                icon: 'bi-person-lines-fill',
                subtleClass: 'bg-primary-subtle text-primary',
                buttonClass: 'btn btn-primary'
            },
            {
                priority: 145,
                title: 'My Schedule Overview',
                description: 'See personal schedules by day/week/month/season/year with workload totals and session status summary.',
                href: '/school/schedules/my',
                buttonLabel: 'Open My Schedule',
                icon: 'bi-calendar2-check-fill',
                subtleClass: 'bg-info-subtle text-info',
                buttonClass: 'btn btn-info text-white'
            },
            {
                priority: 150,
                title: 'Global Comparison',
                description: 'Compare multiple schedules to detect overlaps and availability gaps.',
                href: '/school/schedules/global',
                buttonLabel: 'Compare Schedules',
                icon: 'bi-layers-fill',
                subtleClass: '',
                iconStyle: 'background-color: #e0cffc; color: #6f42c1;',
                buttonClass: 'btn',
                buttonStyle: 'background-color: #6f42c1; color: white;'
            },
            {
                priority: 160,
                title: 'Session Explorer',
                description: 'Search and review class sessions across the school.',
                href: '/school/sessions',
                buttonLabel: 'Explore Sessions',
                icon: 'bi-search',
                subtleClass: '',
                iconStyle: 'background-color: #e2e3e5; color: #495057;',
                buttonClass: 'btn btn-secondary'
            },
            {
                priority: 170,
                title: 'Attendance Matrix',
                description: 'Review attendance, tardiness, and session-level comments.',
                href: '/school/attendances',
                buttonLabel: 'View Attendance',
                icon: 'bi-clipboard2-check-fill',
                subtleClass: 'bg-warning-subtle text-warning',
                buttonClass: 'btn btn-warning text-dark'
            },
            {
                priority: 175,
                title: 'School Gradebook',
                description: 'Grades matrix: session activities, weighted final scores, and evaluation rules by class.',
                href: '/school/grades-matrix',
                buttonLabel: 'Open gradebook',
                icon: 'bi-journal-bookmark-fill',
                subtleClass: 'bg-success-subtle text-success',
                buttonClass: 'btn btn-success'
            },
            {
                priority: 180,
                title: 'Holidays & Off Days',
                description: 'Maintain institution-wide holiday dates used by scheduling logic.',
                href: '/school/holidays',
                buttonLabel: 'Manage Holidays',
                icon: 'bi-calendar-x-fill',
                subtleClass: 'bg-danger-subtle text-danger',
                buttonClass: 'btn btn-danger'
            },
            {
                priority: 185,
                title: 'Leave Requests',
                description: 'Submit and review student, teacher, and staff leave requests with schedule blocking after approval.',
                href: '/school/leave-requests',
                buttonLabel: 'Open Leave Requests',
                icon: 'bi-calendar-x',
                subtleClass: 'bg-danger-subtle text-danger',
                buttonClass: 'btn btn-danger'
            },
            {
                priority: 187,
                title: 'Task Center',
                description: 'Review school tasks and manage embedded follow-up assignments.',
                href: '/school/tasks',
                buttonLabel: 'Open Tasks',
                icon: 'bi-bell-fill',
                subtleClass: 'bg-warning-subtle text-warning',
                buttonClass: 'btn btn-warning'
            },
            // Payroll / Faculty Admin
            {
                priority: 190,
                title: 'Pay Rates',
                description: 'Manage compensation rates used for instructional workloads and payroll flows.',
                href: '/school/payRates',
                buttonLabel: 'Manage Pay Rates',
                icon: 'bi-cash-coin',
                subtleClass: 'bg-success-subtle text-success',
                buttonClass: 'btn btn-success'
            },
            {
                priority: 195,
                title: 'Session Status Rules',
                description: 'Define session statuses, visual tags, and timesheet formulas used across schedules, attendance, and payroll.',
                href: '/school/session-statuses',
                buttonLabel: 'Manage Session Statuses',
                icon: 'bi-sliders',
                subtleClass: 'bg-primary-subtle text-primary',
                buttonClass: 'btn btn-primary'
            },
            {
                priority: 200,
                title: 'Timesheet Periods',
                description: 'Define open/closed payroll periods for timesheet submissions.',
                href: '/school/timesheetPeriods',
                buttonLabel: 'Manage Periods',
                icon: 'bi-calendar-range-fill',
                subtleClass: 'bg-info-subtle text-info',
                buttonClass: 'btn btn-info text-white'
            },
            {
                priority: 210,
                title: 'Timesheets',
                description: 'View and submit instructor timesheets for configured periods.',
                href: '/school/timesheets/my-timesheets',
                buttonLabel: 'Open Timesheets',
                icon: 'bi-clock-history',
                subtleClass: 'bg-primary-subtle text-primary',
                buttonClass: 'btn btn-primary'
            },
            {
                priority: 25,
                title: 'Withdrawal Management',
                description: 'Process student withdrawals from classes, terms, and programs with automated refund calculations.',
                href: '/school/withdrawal',
                buttonLabel: 'Manage Withdrawals',
                icon: 'bi-box-arrow-left',
                subtleClass: 'bg-danger-subtle text-danger',
                buttonClass: 'btn btn-danger'
            }
        ];

        const accessibleDashboardSections = await filterAccessibleDashboardSections(req.user, dashboardSections, req.ip);

        const sortedDashboardSections = accessibleDashboardSections
          .map((s, idx) => {
              const p = Number(s?.priority);
              return { ...s, priority: Number.isFinite(p) ? p : 9999, __idx: idx };
          })
          .sort((a, b) => (a.priority - b.priority) || (a.__idx - b.__idx))
          .map(({ __idx, ...s }) => s);

        const dashboardSection = await getDashboardSection('/school', req.user);
        res.render('school/dashboard', {
            title: 'School Management Dashboard',
            dashboardSections: sortedDashboardSections,
            dashboardSection,
            includeModal: true,
            user: req.user
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

module.exports = {
    showDashboard
};
