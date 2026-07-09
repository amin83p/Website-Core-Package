const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const { isAjax } = requireCoreModule('MVC/utils/generalTools');

const DELETE_BLOCKED_CODE = 'DELETE_BLOCKED';

function isDeleteBlockedError(error) {
  return Boolean(error && error.code === DELETE_BLOCKED_CODE && error.preview);
}

function respondSchoolDeleteError(req, res, error, { user, fallbackStatus = 400 } = {}) {
  if (isDeleteBlockedError(error)) {
    if (isAjax(req)) {
      return res.status(409).json({
        status: 'error',
        code: DELETE_BLOCKED_CODE,
        message: error.message,
        preview: error.preview,
        details: error.preview,
        data: error.preview
      });
    }
    return res.status(409).render('error', {
      title: 'Delete blocked',
      statusCode: 409,
      code: DELETE_BLOCKED_CODE,
      message: error.message,
      preview: error.preview,
      details: error.preview,
      error,
      user
    });
  }

  const message = String(error?.message || 'Delete failed.');
  if (isAjax(req)) {
    return res.status(fallbackStatus).json({ status: 'error', message });
  }
  return res.status(fallbackStatus).render('error', {
    title: 'Error',
    statusCode: fallbackStatus,
    message,
    error,
    user
  });
}

module.exports = {
  DELETE_BLOCKED_CODE,
  isDeleteBlockedError,
  respondSchoolDeleteError
};
