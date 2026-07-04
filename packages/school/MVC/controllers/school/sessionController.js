const sessionExplorerService = require('../../services/school/sessionExplorerService');

function resLocalSchoolDashboard(res) {
    return res?.locals?.schoolSectionDashboardHref || '/dashboard/section-nav/SCHOOL';
}

async function showSessionListPage(req, res) {
    try {
        const sessionExplorerAccess = await sessionExplorerService.buildSessionExplorerViewer(req);
        res.render('school/session/sessionList', {
            title: 'Session Explorer',
            tableName: 'Session_Explorer',
            newUrl: 'school/sessions',
            includeModal: true,
            includeModal_Table: true,
            print: true,
            user: req.user,
            actionStateId: req.actionStateId,
            sessionExplorerAccess,
            schoolSectionDashboardHref: resLocalSchoolDashboard(res),
            searchableFields: [
                'date',
                'startTime',
                'endTime',
                'className',
                'classId',
                'teacherName',
                'status',
                'notes',
                'sessionId'
            ]
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

async function getSessionsApi(req, res) {
    try {
        const result = await sessionExplorerService.listSessions(req, req.query);

        res.json({
            status: 'success',
            data: result.data,
            pagination: result.pagination,
            statusMeta: result.statusMeta
        });

    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
}

module.exports = {
    showSessionListPage,
    getSessionsApi
};
