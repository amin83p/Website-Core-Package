const activeUsersService = require('../services/security/activeUsersService');

async function viewActiveUsers(req, res) {
  try {
    const result = await activeUsersService.listActiveUsers({ query: req.query || {} });

    if (req.headers['x-ajax-request']) {
      return res.json({
        status: 'success',
        results: result.rows,
        pagination: result.pagination,
        summary: result.summary
      });
    }

    return res.render('security/activeUsersList', {
      title: 'Active Users',
      tableName: 'Active_Users',
      newUrl: 'security/active-users',
      newLabel: null,
      includeModal: false,
      includeModal_Table: false,
      print: true,
      user: req.user || null,
      activeUsers: result.rows,
      pagination: result.pagination,
      summary: result.summary,
      filters: req.query || {},
      searchableFields: ['username', 'email', 'displayName', 'userId']
    });
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    return res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
}

async function fetchActiveUsersData(req, res) {
  try {
    const result = await activeUsersService.listActiveUsers({ query: req.query || {} });
    return res.json({
      status: 'success',
      results: result.rows,
      pagination: result.pagination,
      summary: result.summary
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  viewActiveUsers,
  fetchActiveUsersData
};
