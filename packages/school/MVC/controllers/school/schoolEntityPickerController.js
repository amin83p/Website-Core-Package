const schoolDataService = require('../../services/school/schoolDataService');
const schoolEntityPickerService = require('../../services/school/schoolEntityPickerService');

function getStatusCode(error) {
  const status = Number(error?.statusCode || error?.status || 0);
  if (Number.isFinite(status) && status >= 400 && status < 600) return status;
  return 500;
}

function getErrorCode(error) {
  return String(error?.code || '').trim() || 'SCHOOL_ENTITY_PICKER_ERROR';
}

exports.getOptions = async (req, res) => {
  try {
    const payload = await schoolEntityPickerService.listOptions({
      query: req.query || {},
      reqUser: req.user,
      accessContext: schoolDataService.buildRouteAccessContext(req)
    });
    return res.json(payload);
  } catch (error) {
    const statusCode = getStatusCode(error);
    return res.status(statusCode).json({
      status: 'error',
      code: getErrorCode(error),
      message: error.message || 'Unable to load picker options.'
    });
  }
};
