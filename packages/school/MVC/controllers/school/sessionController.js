const sessionExplorerService = require('../../services/school/sessionExplorerService');

async function showSessionListPage(req, res) {
    try {
        res.render('school/session/sessionList', {
            title: 'Global Session Explorer',
            includeModal: true,
            user: req.user,
            actionStateId: req.actionStateId
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
