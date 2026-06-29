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
    items: rows,
    pagination: payload.pagination || {}
  });
}

function parseAllowedSchoolRoles(reqQuery = {}) {
  const candidates = [
    reqQuery.allowedSchoolRoles,
    reqQuery.allowedRoles,
    reqQuery.role,
    reqQuery.roles
  ];
  const out = [];
  candidates.forEach((value) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        const token = String(entry || '').trim();
        if (token) out.push(token);
      });
      return;
    }
    String(value || '')
      .split(/[\s,;|]+/)
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .forEach((entry) => out.push(entry));
  });
  return [...new Set(out)];
}

async function listSchoolPersons(req, res) {
  try {
    const query = await buildQuery(req);
    const payload = await schoolIdentityLookupService.listSchoolPersons({
      reqUser: req.user,
      q: query.q || req.query.q || '',
      query,
      requireSchoolRole: String(req.query.requireSchoolRole || 'true').toLowerCase() !== 'false',
      allowedSchoolRoles: parseAllowedSchoolRoles(req.query || {})
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
