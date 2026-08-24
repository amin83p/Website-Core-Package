const activeUsersService = require('../services/security/activeUsersService');
const userSettingsService = require('../services/userSettingsService');
const { invalidateAuthContextForUser } = require('../services/cache/authContextCacheService');
const { sanitizeCurrentPath } = require('../utils/pagePathUtils');
const { updateSessionCurrentPath } = require('../middleware/sessionEnforcement');

async function fetchPagePresence(req, res) {
  try {
    const currentPath = sanitizeCurrentPath(req.query?.path || req.query?.currentPath || '');
    if (!currentPath) {
      return res.json({
        status: 'success',
        results: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 1,
          hasNext: false,
          hasPrev: false
        },
        summary: {
          activeUserCount: 0,
          activeSessionCount: 0,
          avgSessionsPerUser: 0,
          avgMinutesSinceLastActivity: 0,
          multiSessionUsers: 0,
          avgDailyActiveUsers: 0,
          sampledDays: 0,
          lookbackDays: 7,
          staleMinutes: activeUsersService.getActiveUserStaleMinutes(),
          currentPath: ''
        }
      });
    }
    const result = await activeUsersService.listActiveUsers({
      query: {
        preview: '1',
        limit: req.query?.limit || '20',
        currentPath
      }
    });

    return res.json({
      status: 'success',
      results: result.rows,
      pagination: result.pagination,
      summary: result.summary
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to load page diagnostics.'
    });
  }
}

async function updatePreference(req, res) {
  try {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        status: 'error',
        message: 'The enabled value must be a boolean.'
      });
    }

    const userId = String(req.user?.id || '').trim();
    if (!userId) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required.'
      });
    }

    await userSettingsService.setSetting(
      userId,
      'pageDiagnostics.enabled',
      enabled,
      req.user || userId
    );

    invalidateAuthContextForUser(userId);
    if (req.user) {
      req.user.pageDiagnosticsEnabled = enabled;
      req.user.userSettings = {
        ...((req.user.userSettings && typeof req.user.userSettings === 'object') ? req.user.userSettings : {}),
        pageDiagnostics: {
          ...((req.user.userSettings?.pageDiagnostics && typeof req.user.userSettings.pageDiagnostics === 'object')
            ? req.user.userSettings.pageDiagnostics
            : {}),
          enabled
        }
      };
    }

    return res.json({
      status: 'success',
      enabled
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to update page diagnostics preference.'
    });
  }
}

async function pingPagePresence(req, res) {
  try {
    const currentPath = sanitizeCurrentPath(
      req.body?.path || req.query?.path || req.body?.currentPath || req.query?.currentPath || ''
    );
    if (!currentPath) {
      return res.json({
        status: 'success',
        updated: false,
        currentPath: ''
      });
    }

    const updated = await updateSessionCurrentPath(req, currentPath);
    return res.json({
      status: 'success',
      updated,
      currentPath
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to update page presence.'
    });
  }
}

module.exports = {
  fetchPagePresence,
  pingPagePresence,
  updatePreference
};
