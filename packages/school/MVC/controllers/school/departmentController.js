// MVC/controllers/school/departmentController.js
const dataService = require('../../services/school/schoolDataService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { isAjax, buildDataServiceQuery, inferSearchableFields } = requireCoreModule('MVC/utils/generalTools');
const settingService = requireCoreModule('MVC/services/settingService'); // âœ… Use Dynamic Service
const {
    getActiveOrgIdOrThrow: getActiveOrgIdOrThrowShared,
    assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared,
    canCreateOrgScopedItem,
    assertOrgAccess
} = requireCoreModule('MVC/utils/orgContextUtils');

const postingPolicyService = require('../../services/school/postingPolicyService');

function parseJsonSafe(v, fallback) {
    if (v === undefined || v === null || v === '') return fallback;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { return fallback; }
}

function getActiveOrgIdOrThrow(reqUser) {
    return getActiveOrgIdOrThrowShared(reqUser);
}

async function assertCreateOrgContextOrThrow(reqUser) {
    return assertCreateOrgContextOrThrowShared(reqUser, { scopeLabel: 'departments' });
}

function assertDepartmentOrgAccess(department, activeOrgId, reqUser) {
    assertOrgAccess(department, activeOrgId, reqUser, { orgField: 'orgId', allowSystemBypass: true });
}

function sendGuardedResponse(res, guardResult, duplicateMessage, duplicateStatus = 409) {
    if (!guardResult || guardResult.status === 'acquired') return false;
    if (guardResult.status === 'busy') {
        res.status(duplicateStatus).json({
            status: 'warning',
            message: duplicateMessage,
            idempotency: {
                state: 'busy',
                retryAfterMs: Number(guardResult.retryAfterMs || 0)
            }
        });
        return true;
    }
    if (guardResult.status === 'replay') {
        const payload = guardResult.payload && typeof guardResult.payload === 'object'
            ? { ...guardResult.payload }
            : { status: 'success' };
        payload.idempotency = { state: 'replayed' };
        res.json(payload);
        return true;
    }
    return false;
}

exports.listDepartments = async (req, res) => {
    try {
        let query = await buildDataServiceQuery(req.query);
        const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
        if(query.q===searchDefaultKeyword) query={};
        const canCreateDepartments = await canCreateOrgScopedItem(req.user, { scopeLabel: 'departments' });

        // Fetch filtered data
        const allData = await dataService.fetchData('departments', query, req.user);
        const searchableFields = await inferSearchableFields(allData, { exclude: ['audit', 'attachments'] });

        // Paginate
        const { data, pagination } = paginate(allData, query);
        // Or const { data, pagination } = paginate(allData, query);

        res.render('school/department/departmentList', {
            title: 'Department Catalog',
            tableName: 'Department_Management',
            data, searchableFields, 
            newUrl: 'school/departments', 
            newLabel: canCreateDepartments ? 'Add New' : null,
            //
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
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
};

exports.getDepartmentsApi = async (req, res) => {
    try {
        let query = await buildDataServiceQuery(req.query);
        const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
        if(query.q===searchDefaultKeyword) query={};
        const departments = await dataService.fetchData('departments', query, req.user);
        res.json({ status: 'success', data: departments, results: departments });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

async function renderDepartmentFormView(req, res, viewName, titleOverride) {
    try {
        const isEdit = Boolean(req.params.id);
        const activeOrgId = isEdit
            ? getActiveOrgIdOrThrow(req.user)
            : await assertCreateOrgContextOrThrow(req.user);

        let department = {};
        if (isEdit) {
            department = await dataService.getDataById('departments', req.params.id, req.user);
            if (!department) throw new Error('Department not found.');
            assertDepartmentOrgAccess(department, activeOrgId, req.user);
        }

        const transactionDefinitions = await dataService.fetchData('transactionTemplates', {}, req.user);
        const definitionScopeOrgId = toPublicId(department.orgId || activeOrgId);

        res.render(viewName, {
            title: titleOverride || (isEdit ? `Edit Department: ${department.code}` : 'New Department'),
            department,
            transactionDefinitions: transactionDefinitions.filter((definition) => {
                const definitionOrgId = toPublicId(definition.orgId);
                return idsEqual(definitionOrgId, definitionScopeOrgId) || definitionOrgId === 'SYSTEM';
            }),
            includeModal: true,
            user: req.user,
            actionStateId: req.actionStateId
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

exports.showCreateForm = async (req, res) => renderDepartmentFormView(req, res, 'school/department/departmentForm');
exports.showEditForm = async (req, res) => renderDepartmentFormView(req, res, 'school/department/departmentForm');
exports.showCreateWizardForm = async (req, res) => renderDepartmentFormView(req, res, 'school/department/departmentWizardForm', 'Department Setup Wizard');
exports.showEditWizardForm = async (req, res) => renderDepartmentFormView(req, res, 'school/department/departmentWizardForm', 'Department Setup Wizard');

exports.showHelp = async (req, res) => {
    try {
        res.render('school/department/departmentHelp', {
            title: 'Departments Help',
            user: req.user
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
};

exports.saveDepartment = async (req, res) => {
    try {
        const { id } = req.params;
        const activeOrgId = id
            ? getActiveOrgIdOrThrow(req.user)
            : await assertCreateOrgContextOrThrow(req.user);
        let existingDepartment = null;

        if (id) {
            existingDepartment = await dataService.getDataById('departments', id, req.user);
            if (!existingDepartment) throw new Error('Department not found.');
            assertDepartmentOrgAccess(existingDepartment, activeOrgId, req.user);
        }

        const payload = {
            orgId: String(existingDepartment?.orgId || activeOrgId),
            code: req.body.code.trim().toUpperCase(),
            name: req.body.name.trim(),
            status: req.body.status || 'active',
            description: req.body.description || '',
            postingPolicies: await postingPolicyService.resolvePostingPoliciesOrThrow(
                parseJsonSafe(req.body.postingPolicies, []),
                existingDepartment?.orgId || activeOrgId,
                req.user
            )
        };

        if (id) {
            await dataService.updateData('departments', id, payload, req.user);
        } else {
            await dataService.addData('departments', payload, req.user);
        }

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'Department saved successfully.' });
        }
        res.redirect('/school/departments');
    } catch (error) {
        if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
        res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
    }
};

exports.deleteDepartment = async (req, res) => {
    let guardKey = '';
    try {
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        guardKey = idempotencyGuardService.createGuardKey([
            'department_delete',
            String(activeOrgId || '').trim(),
            String(req.params.id || '').trim()
        ]);
        const guardResult = idempotencyGuardService.beginGuard({
            key: guardKey,
            runningTtlMs: 90000,
            replayTtlMs: 12000
        });
        if (sendGuardedResponse(res, guardResult, 'Department delete is already in progress. Please wait.')) return;

        const existingDepartment = await dataService.getDataById('departments', req.params.id, req.user);
        if (!existingDepartment) throw new Error('Department not found.');
        assertDepartmentOrgAccess(existingDepartment, activeOrgId, req.user);
        
        // Here you could add logic to check if subjects are currently using this department before deleting
        await dataService.deleteData('departments', req.params.id, req.user);
        const payloadOut = { status: 'success', message: 'Department deleted successfully.' };
        idempotencyGuardService.completeGuard(guardKey, payloadOut);
        res.json(payloadOut);
    } catch (error) {
        if (guardKey) idempotencyGuardService.failGuard(guardKey);
        res.status(400).json({ status: 'error', message: error.message });
    }
};
