const schoolIdentityLookupService = require('../../services/school/schoolIdentityLookupService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');

const { buildDataServiceQuery } = requireCoreModule('MVC/utils/generalTools');

async function buildQuery(req) {
  return buildDataServiceQuery(req.query || {});
}

function sendPickerRows(res, payload = {}) {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  return res.json({
    status: 'success',
    data: rows,
    results: rows,
    pagination: payload.pagination || {}
  });
}

async function listSchoolPersons(req, res) {
  try {
    const query = await buildQuery(req);
    const payload = await schoolIdentityLookupService.listSchoolPersons({
      reqUser: req.user,
      q: query.q || req.query.q || '',
      query,
      requireSchoolRole: String(req.query.requireSchoolRole || 'true').toLowerCase() !== 'false'
    });
    return sendPickerRows(res, payload);
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function listSchoolUsers(req, res) {
  try {
    const query = await buildQuery(req);
    const payload = await schoolIdentityLookupService.listSchoolUsers({
      reqUser: req.user,
      q: query.q || req.query.q || '',
      query,
      requireSchoolPerson: String(req.query.requireSchoolPerson || 'true').toLowerCase() !== 'false'
    });
    return sendPickerRows(res, payload);
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function listTaggableUsers(req, res) {
  try {
    const query = await buildQuery(req);
    const payload = await schoolIdentityLookupService.listTaggableUsers({
      reqUser: req.user,
      q: query.q || req.query.q || '',
      query
    });
    return sendPickerRows(res, payload);
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  listSchoolPersons,
  listSchoolUsers,
  listTaggableUsers
};
