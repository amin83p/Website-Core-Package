(function (global) {
  'use strict';

  function installMasterScheduleAssignReport(deps) {
    let assignmentClient = null;

    function clean(value) {
      return String(value || '').trim();
    }

    function resolveContextFromScheduleEvent(event) {
      const classId = clean(event?.classId);
      const sessionId = clean(event?.sessionId);
      const sessionDate = clean(event?.date);
      const startTime = clean(event?.start || event?.startTime);
      const endTime = clean(event?.end || event?.endTime);
      const teacherId = clean(event?.teacherId || event?.deliveredBy);
      const teacherName = clean(event?.teacherName || event?.deliveredByName || event?.personName);
      const classTitle = clean(event?.className || event?.title || classId);
      const embeddedReports = Array.isArray(event?.embeddedReports) ? event.embeddedReports : [];
      return {
        classId,
        sessionId,
        sessionDate,
        startTime,
        endTime,
        teacherId,
        teacherName,
        classTitle,
        embeddedReports,
        scheduleEvent: event
      };
    }

    function ensureAssignmentClient() {
      if (assignmentClient) return assignmentClient;
      if (typeof global.installSessionReportAssignmentClient !== 'function') return null;
      assignmentClient = global.installSessionReportAssignmentClient({
        escapeHtml: deps.escapeHtml,
        showMessage: (title, message, icon) => {
          if (typeof deps.uiAlert === 'function') {
            return deps.uiAlert(message, title, { icon: icon || 'info' });
          }
          window.alert(`${title}: ${message}`);
        },
        showLoading: (message) => {
          if (typeof window.showLoading === 'function') window.showLoading(message);
        },
        hideLoading: (options) => {
          if (typeof window.hideLoading === 'function') window.hideLoading(options);
        },
        onSuccess: async (_result, openCtx) => {
          if (typeof deps.applyScheduleSessionChangesInView !== 'function') return;
          await deps.applyScheduleSessionChangesInView({
            upsertRefs: [{
              classId: openCtx.classId,
              sessionId: openCtx.sessionId,
              date: openCtx.sessionDate
            }],
            showProgress: true
          });
        }
      });
      return assignmentClient;
    }

    function openAssignReportForScheduleEvent(event) {
      const ctx = resolveContextFromScheduleEvent(event);
      if (!ctx.classId || !ctx.sessionId) {
        deps.uiAlert?.('This session is missing class or session identifiers.', 'Assign report', { icon: 'warning' });
        return;
      }
      const client = ensureAssignmentClient();
      if (!client) {
        deps.uiAlert?.('Report assignment is not available on this page.', 'Assign report', { icon: 'warning' });
        return;
      }
      client.open(ctx);
    }

    document.getElementById('btn_scheduleSessionContextAssignReport')?.addEventListener('click', (clickEvent) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      const event = typeof deps.getScheduleSessionContextEvent === 'function'
        ? deps.getScheduleSessionContextEvent()
        : null;
      deps.hideScheduleSessionContextMenu?.();
      if (!event) return;
      openAssignReportForScheduleEvent(event);
    });

    return { openAssignReportForScheduleEvent };
  }

  global.installMasterScheduleAssignReport = installMasterScheduleAssignReport;
})(typeof window !== 'undefined' ? window : global);
