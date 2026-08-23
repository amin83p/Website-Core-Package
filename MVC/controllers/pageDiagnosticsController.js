const activeUsersService = require('../services/security/activeUsersService');
const { sanitizeCurrentPath } = require('../utils/pagePathUtils');

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

module.exports = {
  fetchPagePresence
};
