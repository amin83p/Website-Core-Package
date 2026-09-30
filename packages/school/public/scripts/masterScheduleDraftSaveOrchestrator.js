(function (global) {
  'use strict';

  const STEP_TITLES = {
    sessionConflicts: 'Session conflict check',
    saveSessions: 'Save staged sessions',
    programRegistration: 'Program registration check',
    classEnrollment: 'Class enrollment check',
    applyEnrollment: 'Apply enrollments'
  };

  function installMasterScheduleDraftSaveOrchestrator(deps) {
    if (!deps || typeof deps !== 'object') return null;

    function clean(value) {
      return String(value || '').trim();
    }

    function setLoadingNote(note, operation) {
      if (typeof global.showLoading === 'function') {
        global.showLoading({
          title: 'Saving staged work',
          note: note || 'Working…',
          operation: operation || 'Save staged work'
        });
      }
    }

    function hideLoading() {
      if (typeof global.hideLoading === 'function') {
        global.hideLoading({ force: true });
      }
    }

    async function postJson(url, body) {
      const res = await deps.fetchWithScheduleTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AJAX-Request': 'true',
          Accept: 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify(body || {})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== 'success') {
        const error = new Error(data.message || `Request failed (${res.status}).`);
        error.step = data.step || 'saveSessions';
        error.remediation = data.remediation || '';
        error.issues = Array.isArray(data.issues) ? data.issues : [];
        throw error;
      }
      return data;
    }

    function formatPipelineError(error) {
      const stepLabel = STEP_TITLES[error?.step] || 'Save staged work';
      const lines = [`<strong>${stepLabel}</strong>`, escapeHtml(error?.message || 'The operation failed.')];
      if (error?.remediation) {
        lines.push(`<span class="text-muted d-block mt-2">${escapeHtml(error.remediation)}</span>`);
      }
      const issues = Array.isArray(error?.issues) ? error.issues : [];
      if (issues.length) {
        lines.push('<ul class="mb-0 mt-2 ps-3">');
        issues.forEach((issue) => {
          const student = issue?.studentLabel || issue?.studentId || 'Student';
          lines.push(`<li><strong>${escapeHtml(student)}:</strong> ${escapeHtml(issue?.message || '')}${issue?.remediation ? ` <span class="text-muted">${escapeHtml(issue.remediation)}</span>` : ''}</li>`);
        });
        lines.push('</ul>');
      }
      return lines.join('');
    }

    function escapeHtml(value) {
      if (typeof deps.escapeHtml === 'function') return deps.escapeHtml(value);
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function draftEventsToStagedSessions(classId, sessionIds, person) {
      const cid = clean(classId);
      const idSet = new Set((sessionIds || []).map((id) => clean(id)).filter(Boolean));
      const pid = clean(person?.id);
      const drafts = Array.isArray(deps.scheduleState?.draftEventsByPersonId?.[pid])
        ? deps.scheduleState.draftEventsByPersonId[pid]
        : [];
      return drafts
        .filter((ev) => ev?.isDraft === true && clean(ev.classId) === cid && idSet.has(clean(ev.sessionId || ev.id)))
        .map((ev) => ({
          sessionId: clean(ev.sessionId || ev.id),
          date: clean(ev.date),
          startTime: clean(ev.start),
          endTime: clean(ev.end),
          delivery: {
            deliveredBy: pid,
            deliveredByName: person?.name || pid
          }
        }))
        .filter((row) => row.sessionId && row.date && row.startTime && row.endTime);
    }

    function removeSavedDraftSessionsForClass(personId, classId, sessionIds) {
      const pid = clean(personId);
      const cid = clean(classId);
      const idSet = new Set((sessionIds || []).map((id) => clean(id)).filter(Boolean));
      if (!pid || !idSet.size) return;
      const drafts = Array.isArray(deps.scheduleState?.draftEventsByPersonId?.[pid])
        ? deps.scheduleState.draftEventsByPersonId[pid]
        : [];
      deps.scheduleState.draftEventsByPersonId[pid] = drafts.filter((ev) => {
        if (clean(ev?.classId) !== cid) return true;
        const sid = clean(ev?.sessionId || ev?.id);
        return !idSet.has(sid);
      });
      idSet.forEach((sid) => deps.getActiveDraftSelectionSet?.().delete(sid));
      if (typeof deps.schedulePersistDraftBackup === 'function') deps.schedulePersistDraftBackup();
    }

    function removeSavedPendingEnrollmentsForClass(classId, enrollmentIndexes) {
      const cid = clean(classId);
      const indexes = new Set((enrollmentIndexes || []).filter((idx) => Number.isFinite(Number(idx))).map(Number));
      if (!cid || !indexes.size) return;
      const rows = typeof deps.getPendingEnrollStudentsForClass === 'function'
        ? deps.getPendingEnrollStudentsForClass(cid)
        : [];
      const next = rows.filter((row, index) => !indexes.has(index));
      if (typeof deps.replacePendingEnrollStudentsForClass === 'function') {
        deps.replacePendingEnrollStudentsForClass(cid, next);
      }
    }

    async function commitSessionsForClass({
      person,
      classId,
      classLabel,
      sessionIds,
      extendCycleEndDate
    }) {
      const pendingStagedSessions = draftEventsToStagedSessions(classId, sessionIds, person);
      if (!pendingStagedSessions.length) return { createdCount: 0 };
      const range = typeof deps.getScheduleRange === 'function' ? deps.getScheduleRange() : {};
      const commitRole = typeof deps.selectedScheduleRole === 'function'
        ? deps.selectedScheduleRole() || person?.selectedRole || ''
        : '';
      const payload = {
        classId,
        personId: person.id,
        pendingStagedSessions,
        extendCycleEndDate: extendCycleEndDate === true,
        startDate: range.startDate,
        endDate: range.endDate,
        role: commitRole
      };
      const result = await postJson(deps.SCHEDULE_COMMIT_STAGED_API, payload);
      const createdCount = Number(result?.data?.createdCount || 0);
      if (createdCount > 0) {
        removeSavedDraftSessionsForClass(person.id, classId, sessionIds);
        deps.appendSavedClassSessionsToState?.(person.id, result?.data?.events || []);
        const fp = clean(result?.data?.fingerprint);
        if (fp && typeof deps.acknowledgeLocalScheduleMutation === 'function') {
          await deps.acknowledgeLocalScheduleMutation(person, fp);
        }
      }
      return { createdCount, data: result?.data || {} };
    }

    async function runSelectedDraftSave(selection) {
      const person = typeof deps.activeSchedulePerson === 'function' ? deps.activeSchedulePerson() : null;
      if (!person?.id) return;
      const classes = Array.isArray(selection?.classes) ? selection.classes : [];
      if (!classes.length) return;

      setLoadingNote('Preparing save…', 'Save staged work');
      try {
        for (const classWork of classes) {
          const classId = clean(classWork.classId);
          const classLabel = clean(classWork.classLabel) || classId;
          const sessionIds = Array.isArray(classWork.sessionIds) ? classWork.sessionIds : [];
          const enrollmentEntries = Array.isArray(classWork.enrollmentEntries) ? classWork.enrollmentEntries : [];
          const enrollmentIndexes = Array.isArray(classWork.enrollmentIndexes) ? classWork.enrollmentIndexes : [];
          const range = typeof deps.getScheduleRange === 'function' ? deps.getScheduleRange() : {};
          const commitRole = typeof deps.selectedScheduleRole === 'function'
            ? deps.selectedScheduleRole() || person?.selectedRole || ''
            : '';

          if (sessionIds.length) {
            const pendingStagedSessions = draftEventsToStagedSessions(classId, sessionIds, person);
            setLoadingNote(`Checking staged session conflicts for ${classLabel}…`, 'Session conflict check');
            await postJson(deps.SCHEDULE_COMMIT_STAGED_PRECHECK_API, {
              classId,
              personId: person.id,
              pendingStagedSessions
            });

            setLoadingNote(`Saving staged sessions for ${classLabel}…`, 'Save staged sessions');
            let extendCycleEndDate = false;
            try {
              await commitSessionsForClass({
                person,
                classId,
                classLabel,
                sessionIds,
                extendCycleEndDate: false
              });
            } catch (commitError) {
              const message = String(commitError?.message || '');
              if (!/cycle extension/i.test(message)) throw commitError;
              hideLoading();
              const extend = await deps.uiConfirm?.(
                `${message}\n\nExtend the class cycle and continue?`,
                'Cycle extension required',
                { icon: 'warning', cancelText: 'Cancel', confirmText: 'Extend and save', confirmClass: 'btn-warning btn-md' }
              );
              if (!extend) return;
              setLoadingNote(`Saving staged sessions for ${classLabel}…`, 'Save staged sessions');
              await commitSessionsForClass({
                person,
                classId,
                classLabel,
                sessionIds,
                extendCycleEndDate: true
              });
            }
          }

          if (enrollmentEntries.length) {
            const baseBody = {
              classId,
              personId: person.id,
              pendingEnrollments: enrollmentEntries,
              startDate: range.startDate,
              endDate: range.endDate,
              role: commitRole
            };
            setLoadingNote(`Checking program registrations for ${classLabel}…`, 'Program registration check');
            await postJson(deps.SCHEDULE_VALIDATE_PENDING_ENROLL_API, {
              ...baseBody,
              phase: 'programRegistration'
            });
            setLoadingNote(`Checking class enrollment for ${classLabel}…`, 'Class enrollment check');
            await postJson(deps.SCHEDULE_VALIDATE_PENDING_ENROLL_API, {
              ...baseBody,
              phase: 'classEnrollment'
            });
            setLoadingNote(`Applying enrollments for ${classLabel}…`, 'Apply enrollments');
            await postJson(deps.SCHEDULE_EXECUTE_PENDING_ENROLL_API, baseBody);
            removeSavedPendingEnrollmentsForClass(classId, enrollmentIndexes);
          }
        }

        hideLoading();
        if (typeof deps.clearScheduleDraftBackup === 'function' && deps.countAllPendingDraftSessions?.() <= 0) {
          deps.clearScheduleDraftBackup();
        }
        global.location.reload();
      } catch (error) {
        hideLoading();
        await deps.uiAlert?.(formatPipelineError(error), 'Save staged work failed', { icon: 'error', html: true });
      }
    }

    return { runSelectedDraftSave };
  }

  global.MasterScheduleDraftSaveOrchestrator = {
    install: installMasterScheduleDraftSaveOrchestrator,
    runSelectedDraftSave: null
  };
})(typeof window !== 'undefined' ? window : globalThis);
