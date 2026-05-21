// MVC/controllers/sessionController.js
const sessionService = require('../services/SessionService');const { idsEqual } = require('../utils/idAdapter');
const { buildDataServiceQuery } = require('../utils/generalTools');

const dataService = require('../services/dataService');
const { SYSTEM_CONTEXT } = require('../../config/constants');
const adminChekersService = require('../services/adminChekersService');
const SESSION_LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'userId', 'status', 'currentOrgId'],
  allowedSearchFields: ['id', 'userId', 'deviceFingerprint.ip', 'username', 'userEmail', 'status'],
  defaultSearchFields: ['id', 'userId', 'deviceFingerprint.ip', 'status'],
  allowMetaKeys: true
});
const MY_SESSION_LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'status', 'currentOrgId'],
  allowedSearchFields: ['id', 'deviceFingerprint.ip', 'status', 'currentOrgId'],
  defaultSearchFields: ['id', 'deviceFingerprint.ip', 'status', 'currentOrgId'],
  allowMetaKeys: true
});

/* ---------------- CONTROLLERS ---------------- */

// 1. ADMIN: View All Sessions
async function listSessions(req, res) {
    try {
        const query = await buildDataServiceQuery(req.query, SESSION_LIST_QUERY_OPTIONS);
        const page = Number.parseInt(req.query?.page, 10) || Number.parseInt(query?.page, 10) || 1;
        const limit = Number.parseInt(req.query?.limit, 10) || Number.parseInt(query?.limit, 10) || undefined;

        const pagedSessions = await dataService.fetchDataPaged('sessions', {
          ...query,
          page,
          limit
        }, SYSTEM_CONTEXT);
        const pageSessions = Array.isArray(pagedSessions?.rows) ? pagedSessions.rows : [];

        const userIds = Array.from(new Set(pageSessions
          .map((row) => String(row?.userId || '').trim())
          .filter(Boolean)));
        const userRows = await Promise.all(userIds.map((userId) => dataService.getDataById('users', userId, SYSTEM_CONTEXT)));
        const userMap = new Map();
        userRows.forEach((user) => {
          if (!user?.id) return;
          userMap.set(String(user.id), user);
        });
        const data = pageSessions.map((session) => {
          const user = userMap.get(String(session?.userId || '').trim());
          return {
            ...session,
            username: user ? user.username : 'Unknown',
            userEmail: user ? user.email : 'Unknown'
          };
        });
        const pagination = pagedSessions?.pagination || null;

        // AJAX Response
        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', results: data, pagination });
        }

        // View Render
        res.render('session/sessions', {
            title: 'System Sessions',
            tableName: 'System_Sessions',
            newLabel: null, // No "Add" button
            newUrl: 'sessions',
            includeModal: true,
            includeModal_Table: true,
            print: true,
            sessions: data,
            pagination,
            searchableFields: SESSION_LIST_QUERY_OPTIONS.defaultSearchFields,
            filters: req.query,
            user: req.user || null
        });

        
    } catch (error) {
        if (req.headers['x-ajax-request']) {
            return res.status(500).json({ status: 'error', error, message: error.message });
        }
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
}

// 2. USER: View My Sessions
async function listMySessions(req, res) {
    try {
        const userId = req.user.id;

        // 1. Run Cleanup
        await sessionService.cleanupExpiredSessions(userId);

        // 2. Fetch User's Sessions
        const query = await buildDataServiceQuery(req.query, MY_SESSION_LIST_QUERY_OPTIONS);
        const page = Number.parseInt(req.query?.page, 10) || Number.parseInt(query?.page, 10) || 1;
        const limit = Number.parseInt(req.query?.limit, 10) || Number.parseInt(query?.limit, 10) || 10;
        const paged = await dataService.fetchDataPaged('sessions', {
          ...query,
          userId__eq: userId,
          page,
          limit
        }, SYSTEM_CONTEXT);
        const data = Array.isArray(paged?.rows) ? paged.rows : [];
        const pagination = paged?.pagination || null;

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', results: data, pagination });
        }

        // Determine Current Session ID (if available in session/cookie)
        const currentSessionId = req.userSession?.id || null;

        res.render('session/mySessions', {
            title: 'My Active Sessions',
            tableName: 'My_Sessions',
            newLabel: null,
            newUrl: 'sessions',
            includeModal: true,
            includeModal_Table: true,
            print: true,
            sessions: data,
            pagination,
            searchableFields: MY_SESSION_LIST_QUERY_OPTIONS.defaultSearchFields,
            filters: req.query,
            user: req.user || null,
            currentSessionId,
            actionStateId: req?.actionStateId || null
        });

    } catch (error) {
        if (req.headers['x-ajax-request']) {
            return res.status(500).json({ status: 'error', error, message: error.message });
        }
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
}

// 3. ACTION: Terminate Session
async function terminateSession(req, res) {
    try {
        const { id } = req.params;
        const requestingUser = req.user;
        console.log(requestingUser);
        // Fetch target to verify ownership
        const targetSession = await dataService.getDataById('sessions', id, SYSTEM_CONTEXT);

        if (!targetSession) {
             return res.status(404).json({ status: 'error', message: 'Session not found.' });
        }

        // Security: Owner OR Super Admin
        const isOwner = idsEqual(targetSession.userId, requestingUser.id);
        const isAdmin = adminChekersService.isSuperAdmin(requestingUser);

        if (!isOwner && !isAdmin) {
             return res.status(403).json({ status: 'error', message: 'Unauthorized action.' });
        }

        // Perform Delete
        await sessionService.terminateSession(id);

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'Session terminated successfully.' });
        }
        
        // Fallback Redirect
        res.redirect('/sessions');

    } catch (error) {
        if (req.headers['x-ajax-request']) {
            return res.status(500).json({ status: 'error', error, message: error.message });
        }
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
}

async function getSessionDetails(req, res) {
    try {
        const { id } = req.params;
        const session = await dataService.getDataById('sessions', id, SYSTEM_CONTEXT);

        if (!session) {
            return res.status(404).json({ status: 'error', message: 'Session not found' });
        }
        if (!adminChekersService.isSuperAdmin(req.user) && req.user.id !== session.userId) {
             return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        // Enrich with User info
        const user = await dataService.getDataById('users', session.userId, SYSTEM_CONTEXT);
        
        const details = {
            ...session,
            username: user ? user.username : 'Unknown',
            userEmail: user ? user.email : 'Unknown',
            // Format timestamps for display
            formattedCreated: new Date(session.createdAt).toLocaleString(),
            formattedLastActive: new Date(session.lastActivityAt).toLocaleString(),
            formattedExpiry: new Date(session.absoluteExpiry).toLocaleString()
        };

        res.json({ status: 'success', session: details });

    } catch (error) {
        console.error('Get Details Error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
}

module.exports = { listSessions, listMySessions, terminateSession, getSessionDetails };
