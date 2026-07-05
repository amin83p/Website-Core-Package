const leaveRequestService = require('../../services/school/leaveRequestService');
const leaveRequestModel = require('../../models/school/leaveRequestModel');
const leaveSessionResolutionService = require('../../services/school/leaveSessionResolutionService');

function getStatusCode(error, fallback = 500) {
  const status = Number(error?.statusCode || error?.status || fallback);
  return Number.isFinite(status) && status >= 400 && status < 600 ? status : fallback;
}

function wantsJson(req) {
  return Boolean(req.xhr || req.headers['x-ajax-request'] || String(req.headers.accept || '').includes('application/json'));
}

function sendError(req, res, error, fallback = 500) {
  const status = getStatusCode(error, fallback);
  if (wantsJson(req)) {
    return res.status(status).json({
      status: 'error',
      message: error?.message || 'Request failed.',
      code: error?.code || undefined,
      data: error?.data || undefined
    });
  }
  return res.status(status).render('error', {
    title: 'Error',
    message: error?.message || 'Request failed.',
    error,
    user: req.user
  });
}

function buildFormPayload(body = {}) {
  const payload = {
    requesterPersonId: body.requesterPersonId,
    requesterRecordId: body.requesterRecordId,
    requesterName: body.requesterName,
    requesterRole: body.requesterRole,
    startDate: body.startDate,
    endDate: body.endDate,
    allDay: body.allDay,
    startTime: body.startTime,
    endTime: body.endTime,
    reason: body.reason,
    details: body.details,
    adminNote: body.adminNote,
    confirmReapproval: body.confirmReapproval,
    changeNote: body.changeNote
  };

  if (payload.allDay === undefined) payload.allDay = false;
  return payload;
}

function buildCreateTaskPayload(body = {}) {
  return {
    assignedPersonId: body.assignedPersonId,
    assignedPersonName: body.assignedPersonName,
    assignedRole: body.assignedRole,
    title: body.title,
    description: body.description || body.details,
    dueDate: body.dueDate,
    severity: body.severity,
    note: body.note
  };
}

function buildAccessContext(req) {
  return { scopeId: req?.accessScope || '' };
}

async function baseViewModel(req, res, extra = {}) {
  const requesterRoleOptions = leaveRequestService.getRequesterRoleOptions(req.user);
  return {
    user: req.user,
    includeModal: true,
    actionStateId: req.actionStateId,
    statuses: leaveRequestModel.LEAVE_REQUEST_STATUSES,
    reasons: leaveRequestModel.LEAVE_REQUEST_REASON_LABELS,
    requesterRoles: leaveRequestModel.REQUESTER_ROLES,
    requesterRoleOptions,
    selfRequester: await leaveRequestService.getSelfRequesterContext(req.user),
    canManageAll: leaveRequestService.isAdminViewer(req.user),
    canCreateRequest: leaveRequestService.canCreateRequest(req.user),
    schoolSectionDashboardHref: resLocalSchoolDashboard(res),
    ...extra
  };
}

function resLocalSchoolDashboard(res) {
  return res?.locals?.schoolSectionDashboardHref || '/dashboard/section-nav/SCHOOL';
}

async function showList(req, res) {
  try {
    const leaveRequests = await leaveRequestService.listVisibleRequests(req.user, req.query, buildAccessContext(req));
    return res.render('school/leaveRequest/list', await baseViewModel(req, res, {
      title: 'Leave Requests',
      leaveRequests,
      filters: req.query || {}
    }));
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function showNewForm(req, res) {
  try {
    leaveRequestService.assertCreateAllowed(req.user);
    return res.render('school/leaveRequest/form', await baseViewModel(req, res, {
      title: 'New Leave Request',
      mode: 'create',
      request: null,
      formAction: '/school/leave-requests/new'
    }));
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function createRequest(req, res) {
  try {
    const created = await leaveRequestService.createRequest(req.user, buildFormPayload(req.body || {}));
    return res.redirect(`/school/leave-requests/detail/${encodeURIComponent(created.id)}`);
  } catch (error) {
    return sendError(req, res, error, 400);
  }
}

async function showEditForm(req, res) {
  try {
    const request = await leaveRequestService.getRequestById(req.params.id, req.user, {
      accessContext: buildAccessContext(req)
    });
    return res.render('school/leaveRequest/form', await baseViewModel(req, res, {
      title: 'Edit Leave Request',
      mode: 'edit',
      request,
      formAction: `/school/leave-requests/edit/${encodeURIComponent(req.params.id)}`
    }));
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function updateRequest(req, res) {
  try {
    const updated = await leaveRequestService.updateRequest(
      req.user,
      req.params.id,
      buildFormPayload(req.body || {}),
      {
        confirmReapproval: req.body?.confirmReapproval === 'true' || req.body?.confirmReapproval === true,
        accessContext: buildAccessContext(req)
      }
    );
    return res.redirect(`/school/leave-requests/detail/${encodeURIComponent(updated.id)}`);
  } catch (error) {
    return sendError(req, res, error, getStatusCode(error, 400));
  }
}

async function showDetail(req, res) {
  try {
    const request = await leaveRequestService.getRequestById(req.params.id, req.user, {
      accessContext: buildAccessContext(req)
    });
    return res.render('school/leaveRequest/detail', await baseViewModel(req, res, {
      title: 'Leave Request Detail',
      request,
      canApprove: leaveRequestService.isAdminViewer(req.user)
    }));
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function approveRequest(req, res) {
  try {
    const row = await leaveRequestService.approveRequest(req.user, req.params.id, req.body?.note || req.body?.adminNote || '');
    return res.json({ status: 'success', message: 'Leave request approved.', request: row });
  } catch (error) {
    if (wantsJson(req) && error?.code === 'LEAVE_SESSIONS_UNRESOLVED') {
      const resolveSessionsUrl = error?.data?.resolveSessionsUrl
        || `/school/leave-requests/resolve-sessions/${encodeURIComponent(req.params.id)}`;
      return res.status(getStatusCode(error, 409)).json({
        status: 'error',
        code: error.code,
        message: error.message,
        data: {
            ...(error.data || {}),
            resolveSessionsUrl
        }
      });
    }
    return sendError(req, res, error, getStatusCode(error, 400));
  }
}

async function rejectRequest(req, res) {
  try {
    const row = await leaveRequestService.rejectRequest(req.user, req.params.id, req.body?.note || req.body?.adminNote || '');
    return res.json({ status: 'success', message: 'Leave request rejected.', request: row });
  } catch (error) {
    return sendError(req, res, error, 400);
  }
}

async function cancelRequest(req, res) {
  try {
    const row = await leaveRequestService.cancelRequest(
      req.user,
      req.params.id,
      req.body?.note || req.body?.adminNote || '',
      { accessContext: buildAccessContext(req) }
    );
    return res.json({ status: 'success', message: 'Leave request cancelled.', request: row });
  } catch (error) {
    return sendError(req, res, error, 400);
  }
}

async function deleteRequest(req, res) {
  try {
    const row = await leaveRequestService.deleteRequest(req.user, req.params.id);
    return res.json({ status: 'success', message: 'Leave request deleted.', request: row });
  } catch (error) {
    return sendError(req, res, error, 400);
  }
}

async function createTask(req, res) {
  try {
    const task = await leaveRequestService.createTaskForRequest(
      req.user,
      req.params.id,
      buildCreateTaskPayload(req.body || {}),
      { accessContext: buildAccessContext(req) }
    );
    return res.json({
      status: 'success',
      message: 'School Task created for this leave request.',
      task
    });
  } catch (error) {
    return sendError(req, res, error, 400);
  }
}

async function getSessionConflicts(req, res) {
  try {
    if (!leaveRequestService.isAdminViewer(req.user)) {
      const error = new Error('Only school administrators can review session conflicts.');
      error.statusCode = 403;
      throw error;
    }
    const request = await leaveRequestService.getRequestById(req.params.id, req.user, {
      accessContext: buildAccessContext(req)
    });
    const state = await leaveSessionResolutionService.getResolutionState(request, req.user);
    return res.json({
      status: 'success',
      data: state
    });
  } catch (error) {
    return sendError(req, res, error, getStatusCode(error, 400));
  }
}

async function applySessionResolutions(req, res) {
  try {
    const resolutions = Array.isArray(req.body?.resolutions) ? req.body.resolutions : [];
    const result = await leaveSessionResolutionService.applySessionResolutions({
      requestId: req.params.id,
      resolutions,
      reqUser: req.user
    });
    return res.json({
      status: 'success',
      message: `Saved ${result.appliedCount} session resolution(s).`,
      data: result
    });
  } catch (error) {
    return sendError(req, res, error, getStatusCode(error, 400));
  }
}

async function showResolveSessions(req, res) {
  try {
    if (!leaveRequestService.isAdminViewer(req.user)) {
      const error = new Error('Only school administrators can resolve leave session conflicts.');
      error.statusCode = 403;
      throw error;
    }
    const request = await leaveRequestService.getRequestById(req.params.id, req.user, {
      accessContext: buildAccessContext(req)
    });
    const state = await leaveSessionResolutionService.getResolutionState(request, req.user);
    if (!state.requiresResolution) {
      return res.redirect(`/school/leave-requests/detail/${encodeURIComponent(req.params.id)}`);
    }
    return res.render('school/leaveRequest/resolveSessions', await baseViewModel(req, res, {
      title: 'Resolve Leave Sessions',
      request,
      resolutionState: state,
      resolveSessionsUrl: `/school/leave-requests/resolve-sessions/${encodeURIComponent(req.params.id)}`,
      detailUrl: `/school/leave-requests/detail/${encodeURIComponent(req.params.id)}`
    }));
  } catch (error) {
    return sendError(req, res, error);
  }
}

module.exports = {
  showList,
  showNewForm,
  createRequest,
  showEditForm,
  updateRequest,
  showDetail,
  approveRequest,
  rejectRequest,
  cancelRequest,
  deleteRequest,
  createTask,
  getSessionConflicts,
  applySessionResolutions,
  showResolveSessions
};
