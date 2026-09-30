/* eslint-disable */
(function (global) {
  'use strict';

  function installMasterScheduleStaging(deps) {
        const SCHEDULE_STAGE_DURATION_CHIPS = [0.5, 1, 1.5, 2, 2.5, 3];
        const SCHEDULE_STAGE_DEFAULT_WEEKDAYS = [1, 2, 3, 4];
        const SCHEDULE_STAGE_COUNT_MIN = 1;
        const SCHEDULE_STAGE_COUNT_MAX = 72;
        let scheduleStageModalBound = false;
        let scheduleStageContext = null;
        let scheduleStageClassContext = null;
        let scheduleClassPickerModalInstance = null;
    
        function nearestScheduleStageDurationChip(hours) {
            const value = Number(hours || 0);
            let best = SCHEDULE_STAGE_DURATION_CHIPS[0];
            let bestDiff = Infinity;
            SCHEDULE_STAGE_DURATION_CHIPS.forEach((chip) => {
                const diff = Math.abs(chip - value);
                if (diff < bestDiff) {
                    bestDiff = diff;
                    best = chip;
                }
            });
            return best;
        }
    
        function getScheduleStageModalEl() {
            const visible = document.querySelector('#sessionEnrollmentStageModal.show');
            if (visible) return visible;
            const calendarModal = document.getElementById('sessionEnrollmentCalendarModal');
            return calendarModal?.querySelector('#sessionEnrollmentStageModal')
                || document.getElementById('sessionEnrollmentStageModal');
        }
    
        function hideScheduleStageModal() {
            document.body.classList.remove('schedule-stage-overlay-open');
            const modalEl = getScheduleStageModalEl();
            scheduleStageContext = null;
            if (!modalEl) return;
            modalEl.classList.add('d-none');
            modalEl.classList.remove('show');
            modalEl.style.display = 'none';
            modalEl.setAttribute('aria-hidden', 'true');
            const createBtn = modalEl.querySelector('#btn_sessionEnrollmentStageCreate');
            if (createBtn) {
                createBtn.disabled = false;
                createBtn.textContent = 'Create staged sessions';
                createBtn.removeAttribute('title');
            }
        }
    
        function showScheduleStageModal() {
            const modalEl = getScheduleStageModalEl();
            if (!modalEl) return;
            document.body.classList.add('schedule-stage-overlay-open');
            modalEl.classList.add('session-enrollment-stage-standalone');
            if (modalEl.parentElement !== document.body) {
                document.body.appendChild(modalEl);
            }
            modalEl.classList.remove('d-none');
            modalEl.classList.add('show');
            modalEl.style.display = 'flex';
            modalEl.setAttribute('aria-hidden', 'false');
            const createBtn = modalEl.querySelector('#btn_sessionEnrollmentStageCreate');
            if (createBtn) {
                createBtn.disabled = false;
                createBtn.removeAttribute('title');
            }
            const countDisplay = modalEl.querySelector('#sessionEnrollmentStageCountDisplay');
            if (countDisplay && typeof countDisplay.focus === 'function') {
                countDisplay.focus();
            }
        }
    
        function readScheduleStageSessionCount() {
            const modalEl = getScheduleStageModalEl();
            const display = modalEl?.querySelector('#sessionEnrollmentStageCountDisplay');
            const raw = display && 'value' in display ? display.value : display?.textContent;
            const value = Number(raw || 4);
            if (!Number.isFinite(value)) return 4;
            return Math.max(SCHEDULE_STAGE_COUNT_MIN, Math.min(SCHEDULE_STAGE_COUNT_MAX, Math.round(value)));
        }
    
        function syncScheduleStageCountDisplay(count) {
            const modalEl = getScheduleStageModalEl();
            const normalized = Math.max(SCHEDULE_STAGE_COUNT_MIN, Math.min(SCHEDULE_STAGE_COUNT_MAX, Math.round(Number(count) || 4)));
            const display = modalEl?.querySelector('#sessionEnrollmentStageCountDisplay');
            if (display) {
                if ('value' in display) display.value = String(normalized);
                else display.textContent = String(normalized);
            }
            modalEl?.querySelectorAll('[data-stage-count]').forEach((btn) => {
                const chip = Number(btn.getAttribute('data-stage-count'));
                btn.classList.toggle('active', chip === normalized);
            });
        }
    
        function formatScheduleClassPickerMode(mode) {
            const raw = String(mode || '').trim().toLowerCase();
            if (!raw) return '';
            if (raw === 'rolling') return 'Rolling enrollment';
            if (raw === 'term') return 'Term registration';
            return raw.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
        }
    
        function renderScheduleClassPickerItem(item) {
            const title = deps.escapeHtml(item.title || item.id);
            const code = String(item.code || '').trim();
            const program = String(item.programName || '').trim();
            const term = String(item.termLabel || '').trim();
            const dept = String(item.departmentName || '').trim();
            const mode = formatScheduleClassPickerMode(item.registrationMode);
            const metaBits = [program, term, dept].filter(Boolean);
            const metaLine = metaBits.join(' · ');
            const searchBits = [item.title, item.code, item.id, program, term, dept, mode]
                .map((value) => String(value || '').trim())
                .filter(Boolean);
            const chips = [];
            if (code) chips.push(`<span class="schedule-class-picker-chip">${deps.escapeHtml(code)}</span>`);
            if (mode) chips.push(`<span class="schedule-class-picker-chip">${deps.escapeHtml(mode)}</span>`);
            return `<button type="button" class="schedule-class-picker-item" role="option"
              data-class-id="${deps.escapeHtml(item.id)}"
              data-class-title="${title}"
              data-search="${deps.escapeHtml(searchBits.join(' ').toLowerCase())}">
              <span class="schedule-class-picker-item-icon" aria-hidden="true"><i class="bi bi-easel-fill"></i></span>
              <span class="schedule-class-picker-item-main">
                <span class="schedule-class-picker-item-title d-block">${title}</span>
                ${metaLine ? `<span class="schedule-class-picker-item-meta d-block">${deps.escapeHtml(metaLine)}</span>` : ''}
                <span class="schedule-class-picker-item-foot">
                  ${chips.join('')}
                  <span class="schedule-class-picker-id">#${deps.escapeHtml(item.id)}</span>
                </span>
              </span>
              <i class="bi bi-chevron-right schedule-class-picker-item-chevron" aria-hidden="true"></i>
            </button>`;
        }
    
        async function fetchInstructorClassesForPerson(personId) {
            const url = `/school/schedules/api/instructor-classes?personId=${encodeURIComponent(personId)}`;
            const res = await fetch(url, { headers: { Accept: 'application/json', 'X-AJAX-Request': 'true' } });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.status !== 'success') {
                throw new Error(data.message || 'Unable to load instructor classes.');
            }
            return Array.isArray(data.items) ? data.items : [];
        }
    
        function getScheduleClassPickerModal() {
            const el = document.getElementById('scheduleClassPickerModal');
            if (!el || !window.bootstrap?.Modal) return null;
            if (!scheduleClassPickerModalInstance) {
                scheduleClassPickerModalInstance = window.bootstrap.Modal.getOrCreateInstance(el);
            }
            return scheduleClassPickerModalInstance;
        }
    
        function bindScheduleClassPickerList() {
            const listEl = document.getElementById('scheduleClassPickerList');
            const searchEl = document.getElementById('scheduleClassPickerSearch');
            if (!listEl || listEl.dataset.bound === '1') return;
            listEl.dataset.bound = '1';
            listEl.addEventListener('click', (event) => {
                const item = event.target.closest('.schedule-class-picker-item');
                if (!item) return;
                scheduleStageClassContext = {
                    classId: String(item.getAttribute('data-class-id') || '').trim(),
                    classLabel: String(item.getAttribute('data-class-title') || '').trim()
                };
                getScheduleClassPickerModal()?.hide();
                openScheduleStageModal(scheduleStageContext);
            });
            searchEl?.addEventListener('input', () => {
                const q = String(searchEl.value || '').trim().toLowerCase();
                listEl.querySelectorAll('.schedule-class-picker-item').forEach((item) => {
                    const hay = String(item.getAttribute('data-search') || item.textContent || '').trim().toLowerCase();
                    item.classList.toggle('d-none', Boolean(q) && !hay.includes(q));
                });
            });
        }
    
        function resolveScheduleStageClassFromActiveFilter() {
            const filterId = String(deps.scheduleState.activeClassFilterId || '').trim();
            if (!filterId) return null;
            const match = (deps.scheduleState.activeClasses || []).find((row) => String(row?.id || '').trim() === filterId);
            if (!match) return null;
            return {
                classId: filterId,
                classLabel: String(match.title || match.id || filterId).trim()
            };
        }
    
        async function openScheduleClassPickerModal(dragContext) {
            const person = deps.activeSchedulePerson();
            if (!person?.id) {
                if (typeof deps.uiAlert === 'function') deps.uiAlert('Load a teacher schedule before creating sessions.', 'Stage Sessions', { icon: 'info' });
                return;
            }
            if (!deps.scheduleState.loadedPersonIds.has(person.id)) {
                if (typeof deps.uiAlert === 'function') deps.uiAlert('Load the schedule first, then create staged sessions.', 'Stage Sessions', { icon: 'info' });
                return;
            }
            scheduleStageContext = dragContext;
            const filteredClass = resolveScheduleStageClassFromActiveFilter();
            if (filteredClass) {
                scheduleStageClassContext = filteredClass;
                openScheduleStageModal(dragContext);
                return;
            }
            scheduleStageClassContext = null;
            bindScheduleClassPickerList();
            const listEl = document.getElementById('scheduleClassPickerList');
            const emptyEl = document.getElementById('scheduleClassPickerEmpty');
            const searchEl = document.getElementById('scheduleClassPickerSearch');
            const subtitleEl = document.getElementById('scheduleClassPickerSubtitle');
            if (!listEl) return;
            listEl.innerHTML = '<div class="schedule-class-picker-loading text-center text-muted"><div class="spinner-border spinner-border-sm text-primary mb-2" role="status" aria-hidden="true"></div><div class="small">Loading classes...</div></div>';
            if (emptyEl) emptyEl.classList.add('d-none');
            if (searchEl) searchEl.value = '';
            if (subtitleEl) {
                const teacherName = String(person.name || person.id || '').trim();
                subtitleEl.textContent = teacherName
                    ? `Active classes where ${teacherName} is an instructor.`
                    : 'Choose a class to stage sessions for.';
            }
            try {
                const items = await fetchInstructorClassesForPerson(person.id);
                if (!items.length) {
                    listEl.innerHTML = '';
                    if (emptyEl) emptyEl.classList.remove('d-none');
                } else {
                    if (emptyEl) emptyEl.classList.add('d-none');
                    listEl.innerHTML = items.map((item) => renderScheduleClassPickerItem(item)).join('');
                }
                getScheduleClassPickerModal()?.show();
            } catch (err) {
                if (typeof deps.uiAlert === 'function') deps.uiAlert(err.message || 'Unable to load classes.', 'Stage Sessions', { icon: 'error' });
            }
        }
    
        function readScheduleStageFormValues() {
            const modalEl = getScheduleStageModalEl();
            const durationBtn = modalEl?.querySelector('[data-stage-duration].active');
            const durationHours = Number(durationBtn?.getAttribute('data-stage-duration') || 1);
            const weekdays = [];
            modalEl?.querySelectorAll('[data-stage-weekday].active').forEach((btn) => {
                const dow = Number(btn.getAttribute('data-stage-weekday'));
                if (Number.isFinite(dow)) weekdays.push(dow);
            });
            const count = readScheduleStageSessionCount();
            const skipHolidays = Boolean(modalEl?.querySelector('#sessionEnrollmentStageSkipHolidays')?.checked);
            return {
                durationHours,
                weekdays: deps.scheduleCalendarCore?.normalizeWeekdays ? deps.scheduleCalendarCore.normalizeWeekdays(weekdays) : weekdays,
                count,
                skipHolidays
            };
        }
    
        function mapStagedSessionsToScheduleEvents(sessions, classMeta = {}, attemptId = '') {
            const classId = String(classMeta.classId || '').trim();
            const className = String(classMeta.classLabel || classMeta.className || classId || 'Class').trim();
            const person = deps.activeSchedulePerson();
            const role = deps.selectedScheduleRole() || 'teacher';
            const roleLabel = role === 'staff' ? 'Staff' : (role === 'student' ? 'Student' : 'Teacher');
            const resolvedAttemptId = String(attemptId || '').trim();
            return (Array.isArray(sessions) ? sessions : []).map((row, index) => {
                const sessionId = String(row?.sessionId || '').trim() || `DRAFT_${Date.now()}_${index + 1}`;
                const date = String(row?.date || '').trim();
                const start = String(row?.startTime || row?.start || '').trim();
                const end = String(row?.endTime || row?.end || '').trim();
                return {
                    id: sessionId,
                    sessionId,
                    eventType: 'class_session',
                    targetType: 'session',
                    personId: person?.id || '',
                    date,
                    start,
                    end,
                    classId,
                    className,
                    duration: Number(row?.durationHours || 0),
                    scheduledDuration: Number(row?.durationHours || 0),
                    status: 'scheduled',
                    roles: [roleLabel],
                    roleLabel,
                    role: roleLabel,
                    hasOverlap: false,
                    isDraft: true,
                    stagingAttemptId: String(row?.stagingAttemptId || resolvedAttemptId || '').trim(),
                    detailsUrl: '',
                    countsTowardHours: true,
                    blocksConflicts: true
                };
            });
        }
    
        function createStagingAttemptId() {
            return `STAGE_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }
    
        function createDraftBatch({ attemptId, classId, classLabel, stageParams, sessionIds } = {}) {
            return {
                attemptId: String(attemptId || createStagingAttemptId()).trim(),
                classId: String(classId || '').trim(),
                classLabel: String(classLabel || classId || 'Class').trim(),
                createdAt: new Date().toISOString(),
                stageParams: (stageParams && typeof stageParams === 'object') ? { ...stageParams } : {},
                sessionIds: Array.isArray(sessionIds) ? sessionIds.map((id) => String(id || '').trim()).filter(Boolean) : []
            };
        }
    
        function getDraftBatchesForPerson(personId, classId = '') {
            const batches = Array.isArray(deps.scheduleState.draftBatchesByPersonId?.[personId])
                ? deps.scheduleState.draftBatchesByPersonId[personId]
                : [];
            const filterClassId = String(classId || '').trim();
            if (!filterClassId) return batches.slice();
            return batches.filter((batch) => String(batch?.classId || '').trim() === filterClassId);
        }
    
        function formatStagingAttemptLabel(batch, drafts = []) {
            const classLabel = String(batch?.classLabel || batch?.classId || 'Class').trim();
            const sessionIds = Array.isArray(batch?.sessionIds) ? batch.sessionIds : [];
            const batchDrafts = (Array.isArray(drafts) ? drafts : []).filter((row) => sessionIds.includes(String(row?.sessionId || row?.id || '').trim()));
            const dates = batchDrafts.map((row) => String(row?.date || '').trim()).filter(Boolean).sort();
            const span = dates.length >= 2
                ? `${deps.scheduleCalendarCore?.formatDayHeaderShort ? deps.scheduleCalendarCore.formatDayHeaderShort(dates[0]) : dates[0]}–${deps.scheduleCalendarCore?.formatDayHeaderShort ? deps.scheduleCalendarCore.formatDayHeaderShort(dates[dates.length - 1]) : dates[dates.length - 1]}`
                : (dates[0] ? (deps.scheduleCalendarCore?.formatDayHeaderShort ? deps.scheduleCalendarCore.formatDayHeaderShort(dates[0]) : dates[0]) : '');
            const duration = Number(batch?.stageParams?.durationHours || 1);
            const durationLabel = duration === 1 ? '1 hr' : `${duration} hrs`;
            return `${classLabel} · ${sessionIds.length} session${sessionIds.length === 1 ? '' : 's'}${span ? ` · ${span}` : ''} · ${durationLabel}`;
        }
    
        function doesScheduleEventBlockConflicts(event) {
            return event?.scheduleDisplayOnly !== true && event?.blocksConflicts !== false;
        }
    
        function collectScheduleConflictSessionsForPerson(personId, excludeSessionId = '') {
            const saved = Array.isArray(deps.scheduleState.eventsByPersonId[personId]) ? deps.scheduleState.eventsByPersonId[personId] : [];
            const drafts = Array.isArray(deps.scheduleState.draftEventsByPersonId?.[personId]) ? deps.scheduleState.draftEventsByPersonId[personId] : [];
            const excluded = String(excludeSessionId || '').trim();
            return [...saved.filter((ev) => ev?.isDraft !== true), ...drafts]
                .filter((ev) => doesScheduleEventBlockConflicts(ev))
                .filter((ev) => {
                    const id = String(ev?.sessionId || ev?.id || '').trim();
                    return !excluded || id !== excluded;
                });
        }
    
        function recomputeDraftOverlaps(personId) {
            if (!personId || !deps.scheduleCalendarCore?.checkScheduleTimeConflict) return;
            const drafts = Array.isArray(deps.scheduleState.draftEventsByPersonId?.[personId]) ? deps.scheduleState.draftEventsByPersonId[personId] : [];
            if (!drafts.length) return;
            const conflicts = collectScheduleConflictSessionsForPerson(personId);
            deps.scheduleState.draftEventsByPersonId[personId] = drafts.map((ev) => {
                const sessionId = String(ev?.sessionId || ev?.id || '').trim();
                const hasOverlap = deps.scheduleCalendarCore.checkScheduleTimeConflict({
                    date: ev.date,
                    startTime: ev.start,
                    endTime: ev.end,
                    sessions: conflicts,
                    excludeSessionId: sessionId
                });
                return { ...ev, hasOverlap: hasOverlap === true };
            });
        }
    
        function removeDraftBatchSessions(personId, attemptId) {
            const id = String(attemptId || '').trim();
            if (!personId || !id) return;
            const drafts = Array.isArray(deps.scheduleState.draftEventsByPersonId?.[personId]) ? deps.scheduleState.draftEventsByPersonId[personId] : [];
            deps.scheduleState.draftEventsByPersonId[personId] = drafts.filter((ev) => String(ev?.stagingAttemptId || '') !== id);
            const batches = Array.isArray(deps.scheduleState.draftBatchesByPersonId?.[personId]) ? deps.scheduleState.draftBatchesByPersonId[personId] : [];
            deps.scheduleState.draftBatchesByPersonId[personId] = batches.filter((batch) => String(batch?.attemptId || '') !== id);
        }
    
        function deleteDraftSession(sessionId, options = {}) {
            const suppressRefresh = options?.suppressRefresh === true;
            const person = deps.activeSchedulePerson();
            if (!person?.id || !sessionId) return;
            const id = String(sessionId).trim();
            const drafts = Array.isArray(deps.scheduleState.draftEventsByPersonId?.[person.id]) ? deps.scheduleState.draftEventsByPersonId[person.id] : [];
            const removed = drafts.find((ev) => String(ev?.sessionId || '') === id);
            deps.scheduleState.draftEventsByPersonId[person.id] = drafts.filter((ev) => String(ev?.sessionId || '') !== id);
            deps.getActiveDraftSelectionSet().delete(id);
            const batches = Array.isArray(deps.scheduleState.draftBatchesByPersonId?.[person.id]) ? deps.scheduleState.draftBatchesByPersonId[person.id] : [];
            deps.scheduleState.draftBatchesByPersonId[person.id] = batches.map((batch) => ({
                ...batch,
                sessionIds: (batch.sessionIds || []).filter((sid) => String(sid) !== id)
            })).filter((batch) => (batch.sessionIds || []).length > 0);
            if (removed?.stagingAttemptId) {
                const attemptId = String(removed.stagingAttemptId).trim();
                const stillHasAttempt = (deps.scheduleState.draftEventsByPersonId[person.id] || []).some((ev) => String(ev?.stagingAttemptId || '') === attemptId);
                if (!stillHasAttempt) {
                    deps.scheduleState.draftBatchesByPersonId[person.id] = (deps.scheduleState.draftBatchesByPersonId[person.id] || [])
                        .filter((batch) => String(batch?.attemptId || '') !== attemptId);
                }
            }
            if (suppressRefresh) {
                if (removed?.classId && typeof deps.prunePendingEnrollmentsForClass === 'function') {
                    deps.prunePendingEnrollmentsForClass(String(removed.classId).trim());
                }
                return;
            }
            if (removed?.classId && typeof deps.prunePendingEnrollmentsForClass === 'function') {
                deps.prunePendingEnrollmentsForClass(String(removed.classId).trim());
            }
            recomputeDraftOverlaps(person.id);
            deps.scheduleState.remoteUpdatePending = true;
            deps.refreshScheduleActiveView();
            syncPartialModalFromTimelineDrafts();
        }
    
        function applyDraftSessionMove(update = {}) {
            const person = deps.activeSchedulePerson();
            if (!person?.id || !update?.sessionId) return false;
            const id = String(update.sessionId).trim();
            const conflictSessions = collectScheduleConflictSessionsForPerson(person.id, id);
            const hasConflict = deps.scheduleCalendarCore?.checkScheduleTimeConflict?.({
                date: update.date,
                startTime: update.startTime,
                endTime: update.endTime,
                sessions: conflictSessions,
                excludeSessionId: id
            });
            if (hasConflict) {
                if (typeof deps.uiAlert === 'function') deps.uiAlert('That time slot conflicts with another session.', 'Move staged session', { icon: 'warning' });
                return false;
            }
            const drafts = Array.isArray(deps.scheduleState.draftEventsByPersonId?.[person.id]) ? deps.scheduleState.draftEventsByPersonId[person.id] : [];
            deps.scheduleState.draftEventsByPersonId[person.id] = drafts.map((ev) => {
                if (String(ev?.sessionId || '') !== id) return ev;
                return {
                    ...ev,
                    date: update.date,
                    start: update.startTime,
                    end: update.endTime,
                    duration: update.durationHours,
                    scheduledDuration: update.durationHours
                };
            });
            recomputeDraftOverlaps(person.id);
            deps.scheduleState.remoteUpdatePending = true;
            deps.refreshScheduleActiveView();
            syncPartialModalFromTimelineDrafts();
            return true;
        }
    
        function applyDraftSessionResize(update = {}) {
            const person = deps.activeSchedulePerson();
            if (!person?.id || !update?.sessionId) return false;
            const id = String(update.sessionId).trim();
            const conflictSessions = collectScheduleConflictSessionsForPerson(person.id, id);
            const hasConflict = deps.scheduleCalendarCore?.checkScheduleTimeConflict?.({
                date: update.date,
                startTime: update.startTime,
                endTime: update.endTime,
                sessions: conflictSessions,
                excludeSessionId: id
            });
            if (hasConflict) {
                if (typeof deps.uiAlert === 'function') deps.uiAlert('That time slot conflicts with another session.', 'Resize staged session', { icon: 'warning' });
                return false;
            }
            const drafts = Array.isArray(deps.scheduleState.draftEventsByPersonId?.[person.id]) ? deps.scheduleState.draftEventsByPersonId[person.id] : [];
            deps.scheduleState.draftEventsByPersonId[person.id] = drafts.map((ev) => {
                if (String(ev?.sessionId || '') !== id) return ev;
                return {
                    ...ev,
                    date: update.date,
                    start: update.startTime,
                    end: update.endTime,
                    duration: update.durationHours,
                    scheduledDuration: update.durationHours
                };
            });
            recomputeDraftOverlaps(person.id);
            deps.scheduleState.remoteUpdatePending = true;
            deps.refreshScheduleActiveView();
            syncPartialModalFromTimelineDrafts();
            return true;
        }
    
        function applyDraftSessionEdit(sessionId, values = {}) {
            const person = deps.activeSchedulePerson();
            if (!person?.id || !sessionId) return false;
            const id = String(sessionId).trim();
            const date = String(values.date || '').trim();
            const startTime = String(values.startTime || '').trim();
            const durationHours = Number(values.durationHours || 0);
            const endTime = deps.scheduleCalendarCore?.addDurationToTime
                ? deps.scheduleCalendarCore.addDurationToTime(startTime, durationHours)
                : startTime;
            const conflictSessions = collectScheduleConflictSessionsForPerson(person.id, id);
            const hasConflict = deps.scheduleCalendarCore?.checkScheduleTimeConflict?.({
                date,
                startTime,
                endTime,
                sessions: conflictSessions,
                excludeSessionId: id
            });
            if (hasConflict) {
                if (typeof deps.uiAlert === 'function') deps.uiAlert('That time slot conflicts with another session.', 'Edit staged session', { icon: 'warning' });
                return false;
            }
            const drafts = Array.isArray(deps.scheduleState.draftEventsByPersonId?.[person.id]) ? deps.scheduleState.draftEventsByPersonId[person.id] : [];
            deps.scheduleState.draftEventsByPersonId[person.id] = drafts.map((ev) => {
                if (String(ev?.sessionId || '') !== id) return ev;
                return {
                    ...ev,
                    date,
                    start: startTime,
                    end: endTime,
                    duration: durationHours,
                    scheduledDuration: durationHours
                };
            });
            recomputeDraftOverlaps(person.id);
            deps.scheduleState.remoteUpdatePending = true;
            deps.refreshScheduleActiveView();
            syncPartialModalFromTimelineDrafts();
            return true;
        }
    
        function deleteDraftAttempt(attemptId) {
            const person = deps.activeSchedulePerson();
            const id = String(attemptId || '').trim();
            if (!person?.id || !id) return;
            const drafts = Array.isArray(deps.scheduleState.draftEventsByPersonId?.[person.id])
                ? deps.scheduleState.draftEventsByPersonId[person.id]
                : [];
            const classIds = new Set(
                drafts
                    .filter((ev) => String(ev?.stagingAttemptId || '') === id)
                    .map((ev) => String(ev?.classId || '').trim())
                    .filter(Boolean)
            );
            removeDraftBatchSessions(person.id, id);
            classIds.forEach((cid) => {
                if (typeof deps.prunePendingEnrollmentsForClass === 'function') deps.prunePendingEnrollmentsForClass(cid);
            });
            recomputeDraftOverlaps(person.id);
            deps.scheduleState.remoteUpdatePending = true;
            deps.refreshScheduleActiveView();
            syncPartialModalFromTimelineDrafts();
        }
    
        function syncPartialModalFromTimelineDrafts() {
            if (!window.SessionEnrollmentCalendarModal?.syncFromParentDrafts) return;
            const person = deps.activeSchedulePerson();
            if (!person?.id) return;
            const drafts = Array.isArray(deps.scheduleState.draftEventsByPersonId?.[person.id]) ? deps.scheduleState.draftEventsByPersonId[person.id] : [];
            const batches = Array.isArray(deps.scheduleState.draftBatchesByPersonId?.[person.id]) ? deps.scheduleState.draftBatchesByPersonId[person.id] : [];
            window.SessionEnrollmentCalendarModal.syncFromParentDrafts({
                sessionsToCreate: drafts.map((ev) => ({
                    sessionId: ev.sessionId,
                    date: ev.date,
                    startTime: ev.start,
                    endTime: ev.end,
                    durationHours: ev.duration || ev.scheduledDuration || 0,
                    stagingAttemptId: ev.stagingAttemptId,
                    isStaged: true
                })),
                stagingAttempts: batches
            });
        }
    
        function syncTimelineFromPartialModalDrafts(payload = {}) {
            applyDraftStagedSessionsToSchedule(payload);
        }
    
        function applyDraftStagedSessionsToSchedule(payload = {}) {
            const person = deps.activeSchedulePerson();
            if (!person?.id || !scheduleStageClassContext?.classId) return;
            const sessions = Array.isArray(payload.sessionsToCreate) ? payload.sessionsToCreate : [];
            const stagingAttempts = Array.isArray(payload.stagingAttempts) ? payload.stagingAttempts : [];
            const classId = scheduleStageClassContext.classId;
            const defaultAttemptId = String(stagingAttempts[0]?.attemptId || sessions[0]?.stagingAttemptId || createStagingAttemptId()).trim();
            const draftEvents = mapStagedSessionsToScheduleEvents(sessions, scheduleStageClassContext, defaultAttemptId);
            const payloadAttemptIds = new Set();
            stagingAttempts.forEach((batch) => {
                const attemptId = String(batch?.attemptId || '').trim();
                if (attemptId) payloadAttemptIds.add(attemptId);
            });
            draftEvents.forEach((ev) => {
                const attemptId = String(ev?.stagingAttemptId || '').trim();
                if (attemptId) payloadAttemptIds.add(attemptId);
            });
            if (!deps.scheduleState.draftEventsByPersonId) deps.scheduleState.draftEventsByPersonId = {};
            const existingDrafts = Array.isArray(deps.scheduleState.draftEventsByPersonId[person.id])
                ? deps.scheduleState.draftEventsByPersonId[person.id]
                : [];
            const incomingSessionIds = new Set(draftEvents.map((ev) => String(ev?.sessionId || '').trim()).filter(Boolean));
            const keptDrafts = existingDrafts.filter((ev) => {
                if (String(ev?.classId || '') !== classId) return true;
                const attemptId = String(ev?.stagingAttemptId || '').trim();
                if (attemptId) return !payloadAttemptIds.has(attemptId);
                const sessionId = String(ev?.sessionId || ev?.id || '').trim();
                return !incomingSessionIds.has(sessionId);
            });
            deps.scheduleState.draftEventsByPersonId[person.id] = [...keptDrafts, ...draftEvents];
            if (!deps.scheduleState.draftBatchesByPersonId) deps.scheduleState.draftBatchesByPersonId = {};
            const existingBatches = Array.isArray(deps.scheduleState.draftBatchesByPersonId[person.id])
                ? deps.scheduleState.draftBatchesByPersonId[person.id]
                : [];
            const nextBatches = stagingAttempts.length
                ? stagingAttempts.slice()
                : [createDraftBatch({
                    attemptId: defaultAttemptId,
                    classId,
                    classLabel: scheduleStageClassContext.classLabel,
                    stageParams: scheduleStageClassContext.lastStageParams || {},
                    sessionIds: draftEvents.map((ev) => ev.sessionId)
                })];
            const payloadBatchById = new Map(
                nextBatches.map((batch) => [String(batch?.attemptId || '').trim(), batch]).filter(([id]) => id)
            );
            const keptBatches = existingBatches.filter((batch) => {
                if (String(batch?.classId || '') !== classId) return true;
                return !payloadBatchById.has(String(batch?.attemptId || '').trim());
            });
            deps.scheduleState.draftBatchesByPersonId[person.id] = [...keptBatches, ...Array.from(payloadBatchById.values())];
            recomputeDraftOverlaps(person.id);
            const stagedPaddingOptions = typeof deps.getStagedViewPaddingRangeOptions === 'function'
                ? deps.getStagedViewPaddingRangeOptions()
                : {};
            const viewRange = sessions.length
                ? deps.scheduleCalendarCore.computeStagedSessionsViewRange(sessions, {
                    ...(payload.viewRange || {}),
                    ...stagedPaddingOptions
                })
                : (payload.viewRange || {});
            const start = String(viewRange.startDate || '').trim();
            const end = String(viewRange.endDate || '').trim();
            if (start && end) {
                deps.setDateRangeFromIso(start, end);
                deps.setActiveRangeChip('');
            }
            const stagedDates = sessions
                .map((row) => deps.scheduleCalendarCore?.normalizeDateOnly?.(row?.date) || String(row?.date || '').trim())
                .filter(Boolean)
                .sort();
            deps.scheduleState.pendingStagedScrollDate = stagedDates[0] || deps.scheduleState.pendingStagedScrollDate || '';
            deps.scheduleState.focusStagedSessionOnNextLayout = true;
            deps.scheduleState.remoteUpdatePending = true;
            deps.syncScheduleActiveClassChipAfterStaging(person.id, {
                id: classId,
                classId,
                title: scheduleStageClassContext.classLabel,
                classLabel: scheduleStageClassContext.classLabel
            });
            deps.refreshScheduleViewWithHolidays();
        }
    
        function draftEventToStagedSession(ev, person) {
            return {
                sessionId: String(ev?.sessionId || ev?.id || '').trim(),
                date: String(ev?.date || '').trim(),
                startTime: String(ev?.start || ev?.startTime || '').trim(),
                endTime: String(ev?.end || ev?.endTime || '').trim(),
                delivery: {
                    deliveredBy: person?.id || '',
                    deliveredByName: person?.name || person?.id || ''
                }
            };
        }
    
        function removeDraftSessionsForClass(personId, classId) {
            const pid = String(personId || '').trim();
            const cid = String(classId || '').trim();
            if (!pid || !cid) return;
            const drafts = Array.isArray(deps.scheduleState.draftEventsByPersonId?.[pid])
                ? deps.scheduleState.draftEventsByPersonId[pid]
                : [];
            deps.scheduleState.draftEventsByPersonId[pid] = drafts.filter((ev) => String(ev?.classId || '') !== cid);
            const batches = Array.isArray(deps.scheduleState.draftBatchesByPersonId?.[pid])
                ? deps.scheduleState.draftBatchesByPersonId[pid]
                : [];
            deps.scheduleState.draftBatchesByPersonId[pid] = batches.filter((batch) => String(batch?.classId || '') !== cid);
            deps.scheduleState.selectedDraftSessionIdsByPersonId[pid] = new Set();
            if (typeof deps.clearPendingEnrollStudentsForClass === 'function') {
                deps.clearPendingEnrollStudentsForClass(cid);
            }
            deps.schedulePersistDraftBackup();
        }
    
        async function commitScheduleDraftSessions(options = {}) {
            const person = deps.activeSchedulePerson();
            if (!person?.id) return;
            const drafts = Array.isArray(deps.scheduleState.draftEventsByPersonId?.[person.id])
                ? deps.scheduleState.draftEventsByPersonId[person.id]
                : [];
            if (!drafts.length) return;
    
            const byClass = new Map();
            drafts.forEach((ev) => {
                const classId = String(ev?.classId || '').trim();
                if (!classId) return;
                if (!byClass.has(classId)) byClass.set(classId, []);
                byClass.get(classId).push(ev);
            });
            if (!byClass.size) {
                if (typeof deps.uiAlert === 'function') await deps.uiAlert('Staged sessions are missing class information.', 'Save changes', { icon: 'warning' });
                return;
            }
    
            if (!options.skipConfirm) {
                const confirmed = await deps.uiConfirm(
                    `Save ${drafts.length} staged session(s) to ${byClass.size} class schedule(s)?`,
                    'Save changes?',
                    { icon: 'warning', cancelText: 'Cancel', confirmText: 'Save', confirmClass: 'btn-success btn-md' }
                );
                if (!confirmed) return;
            }
    
            let totalCreated = 0;
            let totalAppended = 0;
            let lastCommitFingerprint = '';
            const extendCycleEndDate = options.extendCycleEndDate === true;
            let loadingShown = false;
            const range = deps.getScheduleRange();
            const commitRole = deps.selectedScheduleRole() || person.selectedRole || '';
            try {
                if (typeof window.showLoading === 'function') {
                    window.showLoading('Saving staged sessions...');
                    loadingShown = true;
                }
                for (const [classId, classDrafts] of byClass.entries()) {
                    const pendingStagedSessions = classDrafts
                        .map((ev) => draftEventToStagedSession(ev, person))
                        .filter((row) => row.sessionId && row.date && row.startTime && row.endTime);
                    if (!pendingStagedSessions.length) continue;
                    const pendingEnrollments = typeof deps.getPendingEnrollStudentsForClass === 'function'
                        ? deps.getPendingEnrollStudentsForClass(classId)
                        : [];
                    const res = await deps.fetchWithScheduleTimeout(deps.SCHEDULE_COMMIT_STAGED_API, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-AJAX-Request': 'true',
                            Accept: 'application/json'
                        },
                        credentials: 'same-origin',
                        body: JSON.stringify({
                            classId,
                            personId: person.id,
                            pendingStagedSessions,
                            pendingEnrollments,
                            extendCycleEndDate,
                            startDate: range.startDate,
                            endDate: range.endDate,
                            role: commitRole
                        })
                    });
                    const result = await res.json().catch(() => ({}));
                    if (!res.ok || result.status !== 'success') {
                        const message = String(result.message || 'Unable to save staged sessions.');
                        if (!extendCycleEndDate && /cycle extension/i.test(message)) {
                            if (loadingShown && typeof window.hideLoading === 'function') {
                                window.hideLoading({ force: true });
                                loadingShown = false;
                            }
                            const extend = await deps.uiConfirm(`${message}\n\nExtend the class cycle and continue?`, 'Cycle extension required', {
                                icon: 'warning',
                                cancelText: 'Cancel',
                                confirmText: 'Extend and save',
                                confirmClass: 'btn-warning btn-md'
                            });
                            if (extend) {
                                await commitScheduleDraftSessions({ skipConfirm: true, extendCycleEndDate: true });
                            }
                            return;
                        }
                        throw new Error(message);
                    }
                    const createdCount = Number(result?.data?.createdCount || 0);
                    totalCreated += createdCount;
                    if (createdCount > 0) {
                        removeDraftSessionsForClass(person.id, classId);
                        totalAppended += Number(deps.appendSavedClassSessionsToState(person.id, result?.data?.events || []) || 0);
                        const fp = String(result?.data?.fingerprint || '').trim();
                        if (fp) lastCommitFingerprint = fp;
                        if (typeof deps.clearPendingEnrollStudentsForClass === 'function') {
                            deps.clearPendingEnrollStudentsForClass(classId);
                        }
                    }
                }
                if (loadingShown && typeof window.hideLoading === 'function') {
                    window.hideLoading({ force: true });
                    loadingShown = false;
                }
                if (totalCreated > 0) {
                    await deps.acknowledgeLocalScheduleMutation(person, lastCommitFingerprint);
                    if (totalAppended <= 0 && typeof deps.loadSchedulePerson === 'function') {
                        await deps.loadSchedulePerson(person, { silent: true });
                    } else {
                        deps.refreshScheduleViewWithHolidays();
                    }
                    if (deps.countAllPendingDraftSessions() <= 0) deps.clearScheduleDraftBackup();
                    await deps.uiAlert(`${totalCreated} session(s) saved to class schedule(s).`, 'Sessions Saved', { icon: 'success' });
                } else {
                    deps.refreshScheduleViewWithHolidays();
                    await deps.uiAlert(
                        'No new sessions were saved. Staged sessions were kept.',
                        'Nothing Saved',
                        { icon: 'warning' }
                    );
                }
            } catch (error) {
                if (loadingShown && typeof window.hideLoading === 'function') {
                    window.hideLoading({ force: true });
                    loadingShown = false;
                }
                await deps.uiAlert(error.message || 'Unable to save staged sessions.', 'Save Failed', { icon: 'error' });
            } finally {
                if (loadingShown && typeof window.hideLoading === 'function') window.hideLoading({ force: true });
            }
        }
    
        let scheduleStageEditAttemptId = '';
    
        async function commitScheduleStageCreate() {
            if (!scheduleStageContext || !scheduleStageClassContext?.classId) return;
            const form = readScheduleStageFormValues();
            if (!form.weekdays.length) {
                if (typeof deps.uiAlert === 'function') deps.uiAlert('Select at least one weekday.', 'Stage Sessions', { icon: 'info' });
                return;
            }
            const editAttemptId = String(scheduleStageEditAttemptId || '').trim();
            if (editAttemptId) {
                const person = deps.activeSchedulePerson();
                if (person?.id) removeDraftBatchSessions(person.id, editAttemptId);
            }
            const createBtn = getScheduleStageModalEl()?.querySelector('#btn_sessionEnrollmentStageCreate');
            if (createBtn) {
                createBtn.disabled = true;
                createBtn.textContent = 'Creating...';
            }
            try {
                const count = readScheduleStageSessionCount();
                const projectedEnd = deps.scheduleCalendarCore.addDaysIso(
                    scheduleStageContext.date,
                    Math.max(2, Math.ceil(count / 2) + 1) * 7 + 14
                );
                let blockedDates = [];
                if (form.skipHolidays && window.SessionEnrollmentCalendarModal?.collectHolidayDatesForRange) {
                    blockedDates = await window.SessionEnrollmentCalendarModal.collectHolidayDatesForRange(
                        scheduleStageContext.date,
                        projectedEnd
                    );
                }
                const person = deps.activeSchedulePerson();
                const result = deps.scheduleCalendarCore.generateRotatingWeekdaySessions({
                    anchorDate: scheduleStageContext.date,
                    startTime: scheduleStageContext.startTime24,
                    durationHours: form.durationHours,
                    weekdays: form.weekdays,
                    count,
                    enrollmentStart: scheduleStageContext.date,
                    enrollmentEnd: projectedEnd,
                    blockedDates,
                    existingSessions: collectScheduleConflictSessionsForPerson(person?.id || ''),
                    scheduleDefaults: {
                        teacherId: person?.id || '',
                        teacherName: person?.name || ''
                    }
                });
                if (!result.sessions.length) {
                    if (typeof deps.uiAlert === 'function') {
                        deps.uiAlert('No sessions could be generated. Adjust weekdays, count, or holiday settings.', 'Stage Sessions', { icon: 'warning' });
                    }
                    return;
                }
                const stagedPaddingOptions = typeof deps.getStagedViewPaddingRangeOptions === 'function'
                    ? deps.getStagedViewPaddingRangeOptions()
                    : {};
                const paddedRange = deps.scheduleCalendarCore.computeStagedSessionsViewRange(result.sessions, {
                    anchorDate: scheduleStageContext.date,
                    ...stagedPaddingOptions
                });
                const startDate = paddedRange.startDate;
                const endDate = paddedRange.endDate;
                const stageParams = {
                    durationHours: form.durationHours,
                    weekdays: form.weekdays,
                    count,
                    skipHolidays: form.skipHolidays,
                    anchorDate: scheduleStageContext.date,
                    startTime: scheduleStageContext.startTime24
                };
                scheduleStageClassContext.lastStageParams = stageParams;
                const attemptId = editAttemptId || createStagingAttemptId();
                const sessionsWithAttempt = result.sessions.map((row) => ({ ...row, stagingAttemptId: attemptId }));
                const stagingAttempts = [createDraftBatch({
                    attemptId,
                    classId: scheduleStageClassContext.classId,
                    classLabel: scheduleStageClassContext.classLabel,
                    stageParams,
                    sessionIds: result.sessions.map((row) => row.sessionId)
                })];
                scheduleStageEditAttemptId = '';
                hideScheduleStageModal();
                if (!window.SessionEnrollmentCalendarModal?.buildPartialPickerData) {
                    if (typeof deps.uiAlert === 'function') deps.uiAlert('Calendar modal is not available on this page.', 'Stage Sessions', { icon: 'warning' });
                    return;
                }
                applyDraftStagedSessionsToSchedule({
                    sessionsToCreate: sessionsWithAttempt,
                    stagingAttempts,
                    viewRange: paddedRange
                });
                const existingEvents = deps.getScheduleEventsForPerson(person?.id || '')
                    .filter((ev) => String(ev?.classId || '') === scheduleStageClassContext.classId)
                    .filter((ev) => ev?.isDraft !== true);
                const conflictScheduleEvents = collectScheduleConflictSessionsForPerson(person?.id || '');
                const prefetchedPickerData = window.SessionEnrollmentCalendarModal.buildPartialPickerData({
                    classId: scheduleStageClassContext.classId,
                    classLabel: scheduleStageClassContext.classLabel,
                    sessionsToCreate: result.sessions,
                    existingEvents,
                    startDate,
                    endDate,
                    ...stagedPaddingOptions
                });
                window.SessionEnrollmentCalendarModal.open({
                    mode: 'partial',
                    classId: scheduleStageClassContext.classId,
                    classLabel: scheduleStageClassContext.classLabel,
                    startDate,
                    endDate,
                    ...stagedPaddingOptions,
                    sessionsToCreate: sessionsWithAttempt,
                    stagingAttempts,
                    existingEvents,
                    conflictScheduleEvents,
                    prefetchedPickerData,
                    onSave: (payload) => applyDraftStagedSessionsToSchedule(payload),
                    onStagedSessionsChange: syncTimelineFromPartialModalDrafts,
                    onClose: (firstStagedDate) => deps.focusScheduleTimelineOnFirstStagedSession(firstStagedDate)
                });
            } finally {
                if (createBtn) {
                    createBtn.disabled = false;
                    createBtn.textContent = 'Create staged sessions';
                }
            }
        }
    
        function openScheduleStageModal(context) {
            if (!context) return;
            scheduleStageContext = context;
            initScheduleStageModal();
            const modalEl = getScheduleStageModalEl();
            const contextEl = modalEl?.querySelector('#sessionEnrollmentStageContext');
            if (contextEl && deps.scheduleCalendarCore) {
                const dateLabel = deps.scheduleCalendarCore.formatDayHeaderLong(context.date);
                const timeLabel = String(context.startTimeLabel || context.startTime24 || '').trim();
                const classLabel = String(scheduleStageClassContext?.classLabel || '').trim();
                contextEl.textContent = classLabel
                    ? `${classLabel} · ${dateLabel} · Start ${timeLabel}`
                    : `${dateLabel} · Start ${timeLabel}`;
            }
            const durationHours = nearestScheduleStageDurationChip(context.durationHours);
            modalEl?.querySelectorAll('[data-stage-duration]').forEach((btn) => {
                const hours = Number(btn.getAttribute('data-stage-duration'));
                btn.classList.toggle('active', hours === durationHours);
            });
            modalEl?.querySelectorAll('[data-stage-weekday]').forEach((btn) => {
                const dow = Number(btn.getAttribute('data-stage-weekday'));
                btn.classList.toggle('active', SCHEDULE_STAGE_DEFAULT_WEEKDAYS.includes(dow));
            });
            syncScheduleStageCountDisplay(4);
            const skipEl = modalEl?.querySelector('#sessionEnrollmentStageSkipHolidays');
            if (skipEl) skipEl.checked = true;
            const holidayHint = modalEl?.querySelector('#sessionEnrollmentStageHolidayHint');
            if (holidayHint) {
                holidayHint.classList.add('d-none');
                holidayHint.textContent = '';
            }
            const warningEl = modalEl?.querySelector('#sessionEnrollmentStageCapacityWarning');
            if (warningEl) {
                warningEl.classList.add('d-none');
                warningEl.textContent = '';
            }
            showScheduleStageModal();
        }
    
        function initScheduleStageModal() {
            if (scheduleStageModalBound) return;
            scheduleStageModalBound = true;
            const modalEl = getScheduleStageModalEl();
            if (!modalEl) return;
    
            modalEl.addEventListener('click', (event) => {
                if (event.target.closest('#btn_sessionEnrollmentStageCreate')) {
                    event.preventDefault();
                    commitScheduleStageCreate().catch((err) => {
                        console.error(err);
                        if (typeof deps.uiAlert === 'function') deps.uiAlert(err.message || 'Unable to create staged sessions.', 'Stage Sessions', { icon: 'error' });
                    });
                    return;
                }
                if (event.target.closest('[data-stage-dismiss]')) {
                    hideScheduleStageModal();
                    return;
                }
                if (!event.target.closest('.session-enrollment-stage-panel')) {
                    event.stopPropagation();
                }
            });
    
            modalEl.querySelectorAll('[data-stage-duration]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    modalEl.querySelectorAll('[data-stage-duration]').forEach((row) => row.classList.remove('active'));
                    btn.classList.add('active');
                });
            });
    
            modalEl.querySelectorAll('[data-stage-weekday]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    btn.classList.toggle('active');
                    if (!modalEl.querySelectorAll('[data-stage-weekday].active').length) btn.classList.add('active');
                });
            });
    
            modalEl.querySelector('#btn_sessionEnrollmentStageCountDown')?.addEventListener('click', () => {
                syncScheduleStageCountDisplay(readScheduleStageSessionCount() - 1);
            });
    
            modalEl.querySelector('#btn_sessionEnrollmentStageCountUp')?.addEventListener('click', () => {
                syncScheduleStageCountDisplay(readScheduleStageSessionCount() + 1);
            });
    
            modalEl.querySelectorAll('[data-stage-count]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    syncScheduleStageCountDisplay(Number(btn.getAttribute('data-stage-count') || 1));
                });
            });
    
            modalEl.querySelector('#sessionEnrollmentStageCountDisplay')?.addEventListener('change', () => {
                syncScheduleStageCountDisplay(readScheduleStageSessionCount());
            });
            modalEl.querySelector('#sessionEnrollmentStageCountDisplay')?.addEventListener('input', () => {
                const display = modalEl.querySelector('#sessionEnrollmentStageCountDisplay');
                if (!display || !('value' in display)) return;
                const parsed = Number(display.value);
                if (!Number.isFinite(parsed)) return;
                modalEl.querySelectorAll('[data-stage-count]').forEach((btn) => {
                    const chip = Number(btn.getAttribute('data-stage-count'));
                    btn.classList.toggle('active', chip === Math.round(parsed));
                });
            });
        }
    
        function isScheduleSavedSessionBlock(block) {
            return String(block?.getAttribute?.('data-event-type') || '').trim() === 'class_session'
                && block?.getAttribute?.('data-schedule-editable') === '1';
        }
    
        function handleScheduleBlockMoveComplete(update = {}) {
            const sessionId = String(update?.sessionId || '').trim();
            if (!sessionId) return;
            const block = document.querySelector(`[data-session-id="${sessionId}"][data-event-type="class_session"][data-schedule-editable="1"]`);
            if (block) {
                const event = deps.resolveScheduleContextEventFromTarget(block);
                if (event) {
                    const originalDate = String(event.date || '').trim();
                    const nextDate = String(update.date || '').trim();
                    const dateChanged = Boolean(nextDate && originalDate && nextDate !== originalDate);
                    if (dateChanged && !deps.canScheduleSessionChangeDate(event)) {
                        if (typeof deps.uiAlert === 'function') {
                            deps.uiAlert(deps.formatSessionManagementBlockerMessage(event, 'This session cannot be moved to another date.'), 'Move session', { icon: 'warning' });
                        }
                        deps.refreshScheduleActiveView();
                        return;
                    }
                    if (!deps.canScheduleSessionChangeTime(event)) {
                        if (typeof deps.uiAlert === 'function') {
                            deps.uiAlert(deps.formatSessionManagementBlockerMessage(event, 'This session time cannot be changed.'), 'Move session', { icon: 'warning' });
                        }
                        deps.refreshScheduleActiveView();
                        return;
                    }
                    commitSavedSessionScheduleUpdate(event, {
                        date: update.date,
                        startTime: update.startTime,
                        endTime: update.endTime,
                        durationHours: update.durationHours
                    });
                    return;
                }
            }
            applyDraftSessionMove(update);
        }
    
        function handleScheduleBlockResizeComplete(update = {}) {
            const sessionId = String(update?.sessionId || '').trim();
            if (!sessionId) return;
            const block = document.querySelector(`[data-session-id="${sessionId}"][data-event-type="class_session"][data-schedule-editable="1"]`);
            if (block) {
                const event = deps.resolveScheduleContextEventFromTarget(block);
                if (event) {
                    if (!deps.canScheduleSessionChangeTime(event)) {
                        if (typeof deps.uiAlert === 'function') {
                            deps.uiAlert(deps.formatSessionManagementBlockerMessage(event, 'This session duration cannot be changed.'), 'Resize session', { icon: 'warning' });
                        }
                        deps.refreshScheduleActiveView();
                        return;
                    }
                    commitSavedSessionScheduleUpdate(event, {
                        date: update.date,
                        startTime: update.startTime,
                        endTime: update.endTime,
                        durationHours: update.durationHours
                    });
                    return;
                }
            }
            applyDraftSessionResize(update);
        }
    
        function bindScheduleDragCreate(container, mode) {
            if (!container || !deps.scheduleCalendarCore?.bindCalendarDragCreate) return;
            deps.scheduleCalendarCore.bindCalendarDragCreate(container, {
                enabled: mode === 'verticalTimeline' && deps.canDragCreateSessions === true,
                onDragComplete: openScheduleClassPickerModal,
                setSuppressGridClick: (value) => { deps.scheduleState.suppressGridClick = value === true; }
            });
            if (deps.scheduleCalendarCore.bindCalendarDragMove) {
                deps.scheduleCalendarCore.bindCalendarDragMove(container, {
                    enabled: mode === 'verticalTimeline' && deps.canDragCreateSessions === true,
                    blockSelector: deps.SCHEDULE_DRAGGABLE_BLOCK_SELECTOR,
                    canStartMove: (sessionId, block) => {
                        if (block?.closest?.('.session-cal-draft-resize-handle')) return false;
                        const ev = deps.resolveScheduleContextEventFromTarget(block) || resolveScheduleDraftEventFromTarget(block);
                        if (ev && !deps.isScheduleEventMutableUnderClassFocus(ev)) return false;
                        return true;
                    },
                    getConflictSessions: () => {
                        const person = deps.activeSchedulePerson();
                        return person?.id ? collectScheduleConflictSessionsForPerson(person.id) : [];
                    },
                    onMoveConflict: () => {
                        if (typeof deps.uiAlert === 'function') deps.uiAlert('That time slot conflicts with another session.', 'Move session', { icon: 'warning' });
                    },
                    onMoveComplete: (update) => { handleScheduleBlockMoveComplete(update); }
                });
            }
            if (deps.scheduleCalendarCore.bindCalendarDragResize) {
                deps.scheduleCalendarCore.bindCalendarDragResize(container, {
                    enabled: mode === 'verticalTimeline' && deps.canDragCreateSessions === true,
                    canStartResize: (sessionId, block) => {
                        const ev = deps.resolveScheduleContextEventFromTarget(block) || resolveScheduleDraftEventFromTarget(block);
                        if (ev && !deps.isScheduleEventMutableUnderClassFocus(ev)) return false;
                        return true;
                    },
                    getConflictSessions: () => {
                        const person = deps.activeSchedulePerson();
                        return person?.id ? collectScheduleConflictSessionsForPerson(person.id) : [];
                    },
                    onResizeConflict: () => {
                        if (typeof deps.uiAlert === 'function') deps.uiAlert('That time slot conflicts with another session.', 'Resize session', { icon: 'warning' });
                    },
                    onResizeComplete: (update) => { handleScheduleBlockResizeComplete(update); }
                });
            }
        }
    
        let scheduleDraftContextEvent = null;
        let scheduleDraftContextSource = 'timeline';
        let scheduleDraftContextMenuSuppressDismissUntil = 0;
        let scheduleDraftAttemptPickerAction = null;
        let scheduleDraftAttemptPickerClassId = '';
        let scheduleDraftAttemptPickerSource = 'timeline';
        let scheduleDraftAttemptPickerModalInstance = null;
        let scheduleDraftEditSessionId = '';
        let scheduleDraftEditSource = 'timeline';
        let scheduleDraftMoveSessionId = '';
        let scheduleDraftMoveSource = 'timeline';
        let scheduleDraftMoveDurationHours = 0;
        let scheduleSessionEditOverlayMode = 'draft';
        let scheduleSavedSessionEditEvent = null;
        let scheduleDraftMenuBound = false;
        const scheduleSessionMutationTokens = new Map();
    
        function isScheduleSavedSessionWorkActive() {
            if (scheduleSessionEditOverlayMode !== 'saved') return false;
            const editOverlay = document.getElementById('scheduleDraftEditOverlay');
            const moveOverlay = document.getElementById('scheduleDraftMoveOverlay');
            return Boolean(
                (editOverlay && !editOverlay.classList.contains('d-none'))
                || (moveOverlay && !moveOverlay.classList.contains('d-none'))
                || document.body.classList.contains('is-schedule-draft-moving')
                || document.body.classList.contains('is-schedule-draft-resizing')
            );
        }
    
        function beginScheduleSessionMutation(sessionId) {
            const id = String(sessionId || '').trim();
            if (!id) return 0;
            const next = (scheduleSessionMutationTokens.get(id) || 0) + 1;
            scheduleSessionMutationTokens.set(id, next);
            return next;
        }
    
        function isLatestScheduleSessionMutation(sessionId, mutationToken) {
            const id = String(sessionId || '').trim();
            if (!id || mutationToken == null) return true;
            return scheduleSessionMutationTokens.get(id) === mutationToken;
        }
    
        function commitSavedSessionScheduleUpdate(event, {
            date,
            startTime,
            endTime,
            durationHours
        } = {}) {
            if (!event) return;
            const sessionId = String(event.sessionId || '').trim();
            if (!sessionId) return;
            const mutationToken = beginScheduleSessionMutation(sessionId);
            const lookupSessionDate = String(event.date || '').trim();
            const resolvedEnd = endTime || (deps.scheduleCalendarCore?.addDurationToTime
                ? deps.scheduleCalendarCore.addDurationToTime(startTime, durationHours || event.duration || 1)
                : startTime);
            deps.patchSavedClassSessionEventInState(
                { ...event, date: lookupSessionDate },
                {
                    date,
                    start: startTime,
                    end: resolvedEnd,
                    duration: durationHours
                }
            );
            deps.refreshScheduleActiveView();
            void deps.applySavedSessionScheduleUpdate({
                event,
                lookupSessionDate,
                date,
                startTime,
                endTime: resolvedEnd,
                durationHours,
                mutationToken
            });
        }
    
        function buildScheduleDraftResizeHandlesHtml() {
            return '<span class="session-cal-draft-resize-handle session-cal-draft-resize-handle-top" data-resize-edge="top" aria-hidden="true"></span>'
                + '<span class="session-cal-draft-resize-handle session-cal-draft-resize-handle-bottom" data-resize-edge="bottom" aria-hidden="true"></span>';
        }
    
        function resolveScheduleDraftEventFromTarget(target) {
            const block = target?.closest?.('[data-event-type="schedule_draft"][data-session-id]');
            if (!block) return null;
            const person = deps.activeSchedulePerson();
            if (!person?.id) return null;
            const sessionId = String(block.getAttribute('data-session-id') || '').trim();
            const events = deps.getScheduleEventsForPerson(person.id);
            return events.find((row) => row?.isDraft === true && String(row?.sessionId || row?.id || '').trim() === sessionId) || null;
        }
    
        function openScheduleDraftEditFromTarget(target, source = 'timeline') {
            const draftEvent = resolveScheduleDraftEventFromTarget(target);
            if (!draftEvent) return false;
            openScheduleDraftEditOverlay(draftEvent, source);
            return true;
        }
    
        function isScheduleDraftEditInteractionTarget(target) {
            return Boolean(
                target?.closest?.('.schedule-draft-select, [data-schedule-draft-select], .session-cal-draft-resize-handle')
            );
        }
    
        function hideScheduleDraftSessionContextMenu() {
            const menu = document.getElementById('scheduleDraftSessionContextMenu');
            if (!menu) return;
            menu.classList.add('d-none');
            menu.classList.remove('show');
            menu.setAttribute('aria-hidden', 'true');
            scheduleDraftContextEvent = null;
            scheduleDraftContextSource = 'timeline';
        }
    
        function renderScheduleDraftSessionContextMenuHeader(event) {
            const header = document.getElementById('scheduleDraftSessionContextMenuHeader');
            if (!header || !event) return;
            const title = deps.escapeHtml(deps.getEventTitle(event));
            const meta = [
                deps.escapeHtml(String(event?.date || '').trim()),
                deps.escapeHtml(deps.formatScheduleClockRange(event?.start, event?.end)),
                'Draft'
            ].filter((part) => part && part !== '—').join(' · ');
            header.innerHTML = `<div class="schedule-session-context-menu-title">${title}</div>${meta ? `<div class="schedule-session-context-menu-meta">${meta}</div>` : ''}`;
        }
    
        function setDraftManagePendingEnrollmentsVisibility(event, selectedIds, showManage) {
            const manageBtn = document.getElementById('btn_scheduleDraftContextManagePendingEnrollments');
            const manageBulkBtn = document.getElementById('btn_scheduleDraftContextManagePendingEnrollmentsBulk');
            [manageBtn, manageBulkBtn].forEach((btn) => {
                if (!btn) return;
                btn.classList.toggle('d-none', !showManage);
                btn.disabled = !showManage;
            });
        }

        function showScheduleDraftSessionContextMenu(event, mouseEvent, source = 'timeline') {
            const menu = document.getElementById('scheduleDraftSessionContextMenu');
            if (!menu || !event || event.isDraft !== true) return;
            scheduleDraftContextEvent = event;
            scheduleDraftContextSource = source === 'partialModal' ? 'partialModal' : 'timeline';
            const sessionId = String(event.sessionId || event.id || '').trim();
            const selectedIds = deps.getActiveDraftSelectionSet();
            const isBulkContext = selectedIds.size >= 2 && selectedIds.has(sessionId);
            const bulkSection = document.getElementById('scheduleDraftSessionContextMenuBulk');
            const bulkDivider = document.getElementById('scheduleDraftSessionContextMenuBulkDivider');
            const singleSection = document.getElementById('scheduleDraftSessionContextMenuSingle');
            const batchSection = document.getElementById('scheduleDraftSessionContextMenuBatch');
            const showManagePending = typeof deps.canManagePendingEnrollmentsForDraftContext === 'function'
                && deps.canManagePendingEnrollmentsForDraftContext(event, selectedIds);
            if (isBulkContext) {
                const header = document.getElementById('scheduleDraftSessionContextMenuHeader');
                if (header) {
                    header.innerHTML = `<div class="schedule-session-context-menu-title">${deps.escapeHtml(String(selectedIds.size))} staged sessions selected</div><div class="schedule-session-context-menu-meta">Edit or delete all selected staged sessions</div>`;
                }
                bulkSection?.classList.remove('d-none');
                bulkDivider?.classList.remove('d-none');
                singleSection?.classList.add('d-none');
                batchSection?.classList.add('d-none');
                setDraftManagePendingEnrollmentsVisibility(event, selectedIds, showManagePending);
            } else {
                renderScheduleDraftSessionContextMenuHeader(event);
                bulkSection?.classList.add('d-none');
                bulkDivider?.classList.add('d-none');
                singleSection?.classList.remove('d-none');
                batchSection?.classList.remove('d-none');
                const passIds = deps.resolveStagingPassSessionIds(event, scheduleDraftContextSource);
                const passLabel = document.getElementById('scheduleDraftContextSelectPassLabel');
                const passBtn = document.getElementById('btn_scheduleDraftContextSelectPass');
                const passCount = passIds.length;
                if (passLabel) {
                    passLabel.textContent = passCount > 1
                        ? `Select this staging pass (${passCount})`
                        : 'Select this staging pass';
                }
                if (passBtn) {
                    passBtn.disabled = passCount === 0;
                    passBtn.classList.toggle('disabled', passCount === 0);
                    passBtn.setAttribute('aria-disabled', passCount === 0 ? 'true' : 'false');
                }
                setDraftManagePendingEnrollmentsVisibility(event, selectedIds, showManagePending);
            }
            const menuWidth = 280;
            const menuHeight = isBulkContext
                ? (showManagePending ? 160 : 120)
                : (showManagePending ? 260 : 220);
            const left = Math.min(mouseEvent.clientX, window.innerWidth - menuWidth - 8);
            const top = Math.min(mouseEvent.clientY, window.innerHeight - menuHeight - 8);
            if (menu.parentElement !== document.body) document.body.appendChild(menu);
            menu.style.position = 'fixed';
            menu.style.left = `${Math.max(8, left)}px`;
            menu.style.top = `${Math.max(8, top)}px`;
            menu.style.zIndex = '2200';
            menu.classList.remove('d-none');
            menu.classList.add('show');
            menu.setAttribute('aria-hidden', 'false');
            scheduleDraftContextMenuSuppressDismissUntil = Date.now() + 250;
        }
    
        function getScheduleDraftAttemptPickerModal() {
            const modalEl = document.getElementById('scheduleDraftAttemptPickerModal');
            if (!modalEl || !window.bootstrap?.Modal) return null;
            if (!scheduleDraftAttemptPickerModalInstance) {
                scheduleDraftAttemptPickerModalInstance = window.bootstrap.Modal.getOrCreateInstance(modalEl);
            }
            return scheduleDraftAttemptPickerModalInstance;
        }
    
        function synthesizeDraftBatchesFromEvents(personId, classId = '') {
            const drafts = Array.isArray(deps.scheduleState.draftEventsByPersonId?.[personId])
                ? deps.scheduleState.draftEventsByPersonId[personId]
                : [];
            const filterClassId = String(classId || '').trim();
            const classDrafts = drafts.filter((ev) => {
                if (ev?.isDraft !== true) return false;
                if (!filterClassId) return true;
                return String(ev?.classId || '').trim() === filterClassId;
            });
            if (!classDrafts.length) return [];
            const grouped = new Map();
            classDrafts.forEach((ev) => {
                const attemptKey = String(ev?.stagingAttemptId || ev?.classId || 'default').trim();
                if (!grouped.has(attemptKey)) grouped.set(attemptKey, []);
                grouped.get(attemptKey).push(ev);
            });
            return Array.from(grouped.entries()).map(([attemptKey, rows]) => {
                const first = rows[0] || {};
                const sessionIds = rows.map((row) => String(row?.sessionId || row?.id || '').trim()).filter(Boolean);
                const durationHours = Number(first?.duration || first?.scheduledDuration || 1);
                return createDraftBatch({
                    attemptId: attemptKey.startsWith('STAGE_') ? attemptKey : createStagingAttemptId(),
                    classId: String(first?.classId || filterClassId || '').trim(),
                    classLabel: String(first?.className || first?.classId || filterClassId || 'Class').trim(),
                    stageParams: {
                        durationHours,
                        anchorDate: String(first?.date || '').trim(),
                        startTime: String(first?.start || '').trim(),
                        count: sessionIds.length
                    },
                    sessionIds
                });
            });
        }
    
        function openScheduleDraftAttemptPicker(action, attempts, subtitle, classId = '', source = 'timeline') {
            const listEl = document.getElementById('scheduleDraftAttemptPickerList');
            const subtitleEl = document.getElementById('scheduleDraftAttemptPickerSubtitle');
            if (!listEl) return;
            scheduleDraftAttemptPickerAction = action;
            scheduleDraftAttemptPickerClassId = String(classId || '').trim();
            scheduleDraftAttemptPickerSource = source === 'partialModal' ? 'partialModal' : 'timeline';
            if (subtitleEl) subtitleEl.textContent = subtitle || 'Choose which staged session batch to update.';
            const person = deps.activeSchedulePerson();
            const drafts = Array.isArray(deps.scheduleState.draftEventsByPersonId?.[person?.id || ''])
                ? deps.scheduleState.draftEventsByPersonId[person.id]
                : [];
            listEl.innerHTML = attempts.map((batch) => {
                const attemptId = deps.escapeHtml(String(batch?.attemptId || '').trim());
                const label = deps.escapeHtml(formatStagingAttemptLabel(batch, drafts));
                return `<button type="button" class="list-group-item list-group-item-action" data-draft-attempt-id="${attemptId}">${label}</button>`;
            }).join('');
            getScheduleDraftAttemptPickerModal()?.show();
        }
    
        function resolveDraftAttemptsForContext(classId = '', source = scheduleDraftContextSource) {
            const person = deps.activeSchedulePerson();
            if (!person?.id) return [];
            const filterClassId = String(classId || '').trim();
            if (source === 'partialModal' && window.SessionEnrollmentCalendarModal?.getStagingAttempts) {
                const attempts = window.SessionEnrollmentCalendarModal.getStagingAttempts(filterClassId);
                if (attempts.length) return attempts;
            }
            const batches = getDraftBatchesForPerson(person.id, filterClassId);
            if (batches.length) return batches;
            return synthesizeDraftBatchesFromEvents(person.id, filterClassId);
        }
    
        function confirmDeleteDraftAttempt(attemptId, source = scheduleDraftContextSource) {
            if (source === 'partialModal' && window.SessionEnrollmentCalendarModal?.deleteStagedAttempt) {
                window.SessionEnrollmentCalendarModal.deleteStagedAttempt(attemptId);
                return;
            }
            deleteDraftAttempt(attemptId);
        }
    
        async function promptDeleteDraftAttempt(attemptId, source = scheduleDraftContextSource) {
            const id = String(attemptId || '').trim();
            if (!id) return;
            const ok = await deps.uiConfirm('Delete all staged sessions in this batch?', 'Delete all staged', {
                icon: 'warning',
                cancelText: 'Cancel',
                confirmText: 'Delete',
                confirmClass: 'btn-danger btn-md'
            });
            if (ok) confirmDeleteDraftAttempt(id, source);
        }
    
        function openScheduleStageModalForBatchEdit(batch) {
            if (!batch?.stageParams) return;
            const params = batch.stageParams;
            scheduleStageEditAttemptId = String(batch.attemptId || '').trim();
            scheduleStageClassContext = scheduleStageClassContext || {};
            openScheduleStageModal({
                date: String(params.anchorDate || '').trim(),
                startTime24: String(params.startTime || '').trim(),
                startTimeLabel: deps.scheduleCalendarCore?.formatClockTime
                    ? deps.scheduleCalendarCore.formatClockTime(params.startTime)
                    : String(params.startTime || '').trim(),
                durationHours: nearestScheduleStageDurationChip(params.durationHours)
            });
            const modalEl = getScheduleStageModalEl();
            modalEl?.querySelectorAll('[data-stage-duration]').forEach((btn) => {
                const hours = Number(btn.getAttribute('data-stage-duration'));
                btn.classList.toggle('active', hours === nearestScheduleStageDurationChip(params.durationHours));
            });
            modalEl?.querySelectorAll('[data-stage-weekday]').forEach((btn) => {
                const dow = Number(btn.getAttribute('data-stage-weekday'));
                btn.classList.toggle('active', (params.weekdays || []).includes(dow));
            });
            syncScheduleStageCountDisplay(Number(params.count || 4));
            const skipEl = modalEl?.querySelector('#sessionEnrollmentStageSkipHolidays');
            if (skipEl) skipEl.checked = params.skipHolidays === true;
        }
    
        function runScheduleDraftDeleteAll(event, source = 'timeline') {
            if (!event) return;
            const classId = String(event.classId || scheduleStageClassContext?.classId || '').trim();
            const attempts = resolveDraftAttemptsForContext(classId, source);
            if (!attempts.length) return;
            if (attempts.length === 1) {
                void promptDeleteDraftAttempt(attempts[0].attemptId, source);
                return;
            }
            openScheduleDraftAttemptPicker('delete', attempts, 'Choose which staged session batch to delete.', classId, source);
        }
    
        function runScheduleDraftEditAll(event, source = 'timeline') {
            if (!event) return;
            const classId = String(event.classId || scheduleStageClassContext?.classId || '').trim();
            const attempts = resolveDraftAttemptsForContext(classId, source);
            if (!attempts.length) return;
            if (attempts.length === 1) {
                if (source === 'partialModal' && window.SessionEnrollmentCalendarModal?.editStagedAttempt) {
                    window.SessionEnrollmentCalendarModal.editStagedAttempt(attempts[0].attemptId);
                } else {
                    openScheduleStageModalForBatchEdit(attempts[0]);
                }
                return;
            }
            openScheduleDraftAttemptPicker('edit', attempts, 'Choose which staged session batch to edit.', classId, source);
        }
    
        function hideScheduleDraftEditOverlay() {
            const overlay = document.getElementById('scheduleDraftEditOverlay');
            scheduleDraftEditSessionId = '';
            scheduleDraftEditSource = 'timeline';
            scheduleSessionEditOverlayMode = 'draft';
            scheduleSavedSessionEditEvent = null;
            if (!overlay) return;
            overlay.classList.remove('session-enrollment-stage-standalone');
            overlay.classList.add('d-none');
            overlay.classList.remove('show');
            overlay.style.display = 'none';
            overlay.setAttribute('aria-hidden', 'true');
            const errorEl = document.getElementById('scheduleDraftEditError');
            if (errorEl) {
                errorEl.classList.add('d-none');
                errorEl.textContent = '';
            }
        }
    
        function hideScheduleDraftMoveOverlay() {
            const overlay = document.getElementById('scheduleDraftMoveOverlay');
            scheduleDraftMoveSessionId = '';
            scheduleDraftMoveSource = 'timeline';
            scheduleDraftMoveDurationHours = 0;
            scheduleSessionEditOverlayMode = 'draft';
            scheduleSavedSessionEditEvent = null;
            if (!overlay) return;
            overlay.classList.remove('session-enrollment-stage-standalone');
            overlay.classList.add('d-none');
            overlay.classList.remove('show');
            overlay.style.display = 'none';
            overlay.setAttribute('aria-hidden', 'true');
            const errorEl = document.getElementById('scheduleDraftMoveError');
            if (errorEl) {
                errorEl.classList.add('d-none');
                errorEl.textContent = '';
            }
        }
    
        function openScheduleSavedSessionEditOverlay(event) {
            if (!event || !deps.isScheduledClassSessionForQuickEdit(event)) return;
            scheduleSessionEditOverlayMode = 'saved';
            scheduleSavedSessionEditEvent = event;
            openScheduleDraftEditOverlay(event, 'timeline');
        }
    
        function openScheduleSavedSessionMoveOverlay(event) {
            if (!event || !deps.isScheduledClassSessionForQuickEdit(event)) return;
            scheduleSessionEditOverlayMode = 'saved';
            scheduleSavedSessionEditEvent = event;
            openScheduleDraftMoveOverlay(event, 'timeline');
        }
    
        function openScheduleDraftEditOverlay(event, source = 'timeline') {
            if (!event) return;
            const overlay = document.getElementById('scheduleDraftEditOverlay');
            if (!overlay) return;
            if (scheduleSessionEditOverlayMode !== 'saved') {
                scheduleSessionEditOverlayMode = 'draft';
                scheduleSavedSessionEditEvent = null;
            }
            scheduleDraftEditSessionId = String(event.sessionId || event.id || '').trim();
            scheduleDraftEditSource = source === 'partialModal' ? 'partialModal' : 'timeline';
            const contextEl = document.getElementById('scheduleDraftEditOverlayContext');
            if (contextEl) {
                contextEl.textContent = `${deps.getEventTitle(event)} · ${String(event.date || '').trim()}`;
            }
            const dateEl = document.getElementById('scheduleDraftEditDate');
            const startEl = document.getElementById('scheduleDraftEditStartTime');
            if (dateEl) {
                dateEl.value = String(event.date || '').trim();
                const canChangeDate = scheduleSessionEditOverlayMode !== 'saved' || deps.canScheduleSessionChangeDate(event);
                dateEl.disabled = !canChangeDate;
                dateEl.readOnly = !canChangeDate;
                dateEl.title = canChangeDate ? '' : 'This session cannot be moved to another date.';
            }
            if (startEl) {
                startEl.value = String(event.start || '').trim();
                const canChangeTime = scheduleSessionEditOverlayMode !== 'saved' || deps.canScheduleSessionChangeTime(event);
                startEl.disabled = !canChangeTime;
                startEl.readOnly = !canChangeTime;
                startEl.title = canChangeTime ? '' : 'This session time cannot be changed.';
            }
            const durationHours = nearestScheduleStageDurationChip(event.duration || event.scheduledDuration || 1);
            overlay.querySelectorAll('[data-draft-edit-duration]').forEach((btn) => {
                const hours = Number(btn.getAttribute('data-draft-edit-duration'));
                btn.classList.toggle('active', hours === durationHours);
            });
            overlay.classList.add('session-enrollment-stage-standalone');
            if (overlay.parentElement !== document.body) {
                document.body.appendChild(overlay);
            }
            overlay.classList.remove('d-none');
            overlay.classList.add('show');
            overlay.style.display = 'flex';
            overlay.setAttribute('aria-hidden', 'false');
        }
    
        function openScheduleDraftMoveOverlay(event, source = 'timeline') {
            if (!event) return;
            const overlay = document.getElementById('scheduleDraftMoveOverlay');
            if (!overlay) return;
            if (scheduleSessionEditOverlayMode !== 'saved') {
                scheduleSessionEditOverlayMode = 'draft';
                scheduleSavedSessionEditEvent = null;
            }
            scheduleDraftMoveSessionId = String(event.sessionId || event.id || '').trim();
            scheduleDraftMoveSource = source === 'partialModal' ? 'partialModal' : 'timeline';
            scheduleDraftMoveDurationHours = Number(event.duration || event.scheduledDuration || event.durationHours || 0);
            const contextEl = document.getElementById('scheduleDraftMoveOverlayContext');
            if (contextEl) {
                contextEl.textContent = `${deps.getEventTitle(event)} · ${String(event.date || '').trim()}`;
            }
            const dateEl = document.getElementById('scheduleDraftMoveDate');
            const startEl = document.getElementById('scheduleDraftMoveStartTime');
            if (dateEl) {
                dateEl.value = String(event.date || '').trim();
                const canChangeDate = scheduleSessionEditOverlayMode !== 'saved' || deps.canScheduleSessionChangeDate(event);
                dateEl.disabled = !canChangeDate;
                dateEl.readOnly = !canChangeDate;
                dateEl.title = canChangeDate ? '' : 'This session cannot be moved to another date.';
            }
            if (startEl) {
                startEl.value = String(event.start || event.startTime || '').trim();
                const canChangeTime = scheduleSessionEditOverlayMode !== 'saved' || deps.canScheduleSessionChangeTime(event);
                startEl.disabled = !canChangeTime;
                startEl.readOnly = !canChangeTime;
                startEl.title = canChangeTime ? '' : 'This session time cannot be changed.';
            }
            const errorEl = document.getElementById('scheduleDraftMoveError');
            if (errorEl) {
                errorEl.classList.add('d-none');
                errorEl.textContent = '';
            }
            overlay.classList.add('session-enrollment-stage-standalone');
            if (overlay.parentElement !== document.body) {
                document.body.appendChild(overlay);
            }
            overlay.classList.remove('d-none');
            overlay.classList.add('show');
            overlay.style.display = 'flex';
            overlay.setAttribute('aria-hidden', 'false');
        }
    
        function readScheduleDraftMoveFormValues() {
            return {
                date: String(document.getElementById('scheduleDraftMoveDate')?.value || '').trim(),
                startTime: String(document.getElementById('scheduleDraftMoveStartTime')?.value || '').trim()
            };
        }
    
        function applyScheduleDraftMoveOverlay() {
            const sessionId = String(scheduleDraftMoveSessionId || '').trim();
            if (!sessionId) return;
            const values = readScheduleDraftMoveFormValues();
            const errorEl = document.getElementById('scheduleDraftMoveError');
            if (!values.date || !values.startTime) {
                if (errorEl) {
                    errorEl.textContent = 'Date and start time are required.';
                    errorEl.classList.remove('d-none');
                }
                return;
            }
            const durationHours = Number(scheduleDraftMoveDurationHours || 0) || nearestScheduleStageDurationChip(1);
            const endTime = deps.scheduleCalendarCore?.addDurationToTime
                ? deps.scheduleCalendarCore.addDurationToTime(values.startTime, durationHours)
                : values.startTime;
            const movePayload = {
                sessionId,
                date: values.date,
                startTime: values.startTime,
                endTime,
                durationHours
            };
            if (scheduleSessionEditOverlayMode === 'saved' && scheduleSavedSessionEditEvent) {
                const originalDate = String(scheduleSavedSessionEditEvent.date || '').trim();
                if (values.date !== originalDate && !deps.canScheduleSessionChangeDate(scheduleSavedSessionEditEvent)) {
                    if (errorEl) {
                        errorEl.textContent = deps.formatSessionManagementBlockerMessage(scheduleSavedSessionEditEvent, 'This session cannot be moved to another date.');
                        errorEl.classList.remove('d-none');
                    }
                    return;
                }
                if (!deps.canScheduleSessionChangeTime(scheduleSavedSessionEditEvent)) {
                    if (errorEl) {
                        errorEl.textContent = deps.formatSessionManagementBlockerMessage(scheduleSavedSessionEditEvent, 'This session time cannot be changed.');
                        errorEl.classList.remove('d-none');
                    }
                    return;
                }
                commitSavedSessionScheduleUpdate(scheduleSavedSessionEditEvent, {
                    date: values.date,
                    startTime: values.startTime,
                    endTime,
                    durationHours
                });
                return;
            }
            let ok = false;
            if (scheduleDraftMoveSource === 'partialModal' && window.SessionEnrollmentCalendarModal?.moveStagedSession) {
                ok = window.SessionEnrollmentCalendarModal.moveStagedSession(sessionId, movePayload) !== false;
            } else {
                ok = applyDraftSessionMove(movePayload);
            }
            if (ok) {
                hideScheduleDraftMoveOverlay();
                return;
            }
            if (errorEl) {
                errorEl.textContent = 'That time slot conflicts with another session.';
                errorEl.classList.remove('d-none');
            }
        }
    
        function readScheduleDraftEditFormValues() {
            const overlay = document.getElementById('scheduleDraftEditOverlay');
            const durationBtn = overlay?.querySelector('[data-draft-edit-duration].active');
            return {
                date: String(document.getElementById('scheduleDraftEditDate')?.value || '').trim(),
                startTime: String(document.getElementById('scheduleDraftEditStartTime')?.value || '').trim(),
                durationHours: Number(durationBtn?.getAttribute('data-draft-edit-duration') || 1)
            };
        }
    
        function applyScheduleDraftEditOverlay() {
            const sessionId = String(scheduleDraftEditSessionId || '').trim();
            if (!sessionId) return;
            const values = readScheduleDraftEditFormValues();
            const errorEl = document.getElementById('scheduleDraftEditError');
            if (!values.date || !values.startTime) {
                if (errorEl) {
                    errorEl.textContent = 'Date and start time are required.';
                    errorEl.classList.remove('d-none');
                }
                return;
            }
            if (scheduleSessionEditOverlayMode === 'saved' && scheduleSavedSessionEditEvent) {
                const originalDate = String(scheduleSavedSessionEditEvent.date || '').trim();
                if (values.date !== originalDate && !deps.canScheduleSessionChangeDate(scheduleSavedSessionEditEvent)) {
                    if (errorEl) {
                        errorEl.textContent = deps.formatSessionManagementBlockerMessage(scheduleSavedSessionEditEvent, 'This session cannot be moved to another date.');
                        errorEl.classList.remove('d-none');
                    }
                    return;
                }
                if (!deps.canScheduleSessionChangeTime(scheduleSavedSessionEditEvent)) {
                    if (errorEl) {
                        errorEl.textContent = deps.formatSessionManagementBlockerMessage(scheduleSavedSessionEditEvent, 'This session time cannot be changed.');
                        errorEl.classList.remove('d-none');
                    }
                    return;
                }
                const endTime = deps.scheduleCalendarCore?.addDurationToTime
                    ? deps.scheduleCalendarCore.addDurationToTime(values.startTime, values.durationHours)
                    : values.startTime;
                commitSavedSessionScheduleUpdate(scheduleSavedSessionEditEvent, {
                    date: values.date,
                    startTime: values.startTime,
                    endTime,
                    durationHours: values.durationHours
                });
                return;
            }
            let ok = false;
            if (scheduleDraftEditSource === 'partialModal' && window.SessionEnrollmentCalendarModal?.editStagedSession) {
                ok = window.SessionEnrollmentCalendarModal.editStagedSession(sessionId, values) !== false;
            } else {
                ok = applyDraftSessionEdit(sessionId, values);
            }
            if (ok) hideScheduleDraftEditOverlay();
        }
    
        let scheduleDraftBulkEditSource = 'timeline';
    
        function hideScheduleDraftBulkEditOverlay() {
            const overlay = document.getElementById('scheduleDraftBulkEditOverlay');
            scheduleDraftBulkEditSource = 'timeline';
            if (!overlay) return;
            overlay.classList.remove('session-enrollment-stage-standalone');
            overlay.classList.add('d-none');
            overlay.classList.remove('show');
            overlay.style.display = 'none';
            overlay.setAttribute('aria-hidden', 'true');
            const errorEl = document.getElementById('scheduleDraftBulkEditError');
            if (errorEl) {
                errorEl.classList.add('d-none');
                errorEl.textContent = '';
            }
        }
    
        function openScheduleDraftBulkEditOverlay(source = 'timeline') {
            const selectedEvents = deps.getSelectedDraftEvents();
            if (selectedEvents.length < 2) return;
            const overlay = document.getElementById('scheduleDraftBulkEditOverlay');
            if (!overlay) return;
            scheduleDraftBulkEditSource = source === 'partialModal' ? 'partialModal' : 'timeline';
            const contextEl = document.getElementById('scheduleDraftBulkEditOverlayContext');
            if (contextEl) {
                contextEl.textContent = `${selectedEvents.length} staged session(s) selected`;
            }
            const first = selectedEvents[0] || {};
            const startEl = document.getElementById('scheduleDraftBulkEditStartTime');
            const endEl = document.getElementById('scheduleDraftBulkEditEndTime');
            if (startEl) startEl.value = String(first.start || first.startTime || '').trim();
            if (endEl) endEl.value = String(first.end || first.endTime || '').trim();
            const errorEl = document.getElementById('scheduleDraftBulkEditError');
            if (errorEl) {
                errorEl.classList.add('d-none');
                errorEl.textContent = '';
            }
            overlay.classList.add('session-enrollment-stage-standalone');
            if (overlay.parentElement !== document.body) {
                document.body.appendChild(overlay);
            }
            overlay.classList.remove('d-none');
            overlay.classList.add('show');
            overlay.style.display = 'flex';
            overlay.setAttribute('aria-hidden', 'false');
        }
    
        function readScheduleDraftBulkEditFormValues() {
            return {
                startTime: String(document.getElementById('scheduleDraftBulkEditStartTime')?.value || '').trim(),
                endTime: String(document.getElementById('scheduleDraftBulkEditEndTime')?.value || '').trim()
            };
        }
    
        function validateBulkDraftSessionTimes(selectedEvents, values = {}) {
            const startTime = String(values.startTime || '').trim();
            const endTime = String(values.endTime || '').trim();
            if (!startTime || !endTime) {
                return { ok: false, message: 'Start time and end time are required.' };
            }
            const startMin = deps.timeToMinutes(startTime);
            const endMin = deps.timeToMinutes(endTime);
            if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) {
                return { ok: false, message: 'End time must be after start time.' };
            }
            const excludeIds = new Set(selectedEvents.map((ev) => String(ev?.sessionId || ev?.id || '').trim()).filter(Boolean));
            const person = deps.activeSchedulePerson();
            if (!person?.id) return { ok: false, message: 'No active schedule person.' };
            const allConflicts = collectScheduleConflictSessionsForPerson(person.id);
            const conflictSessions = allConflicts.filter((row) => {
                const rowId = String(row?.sessionId || row?.id || '').trim();
                return !excludeIds.has(rowId);
            });
            for (const ev of selectedEvents) {
                const sessionId = String(ev?.sessionId || ev?.id || '').trim();
                const hasConflict = deps.scheduleCalendarCore?.checkScheduleTimeConflict?.({
                    date: ev.date,
                    startTime,
                    endTime,
                    sessions: conflictSessions,
                    excludeSessionId: sessionId
                });
                if (hasConflict) {
                    const title = deps.getEventTitle(ev);
                    const dateLabel = String(ev?.date || '').trim();
                    return {
                        ok: false,
                        message: `Conflict for ${title}${dateLabel ? ` on ${dateLabel}` : ''}. No changes were applied.`
                    };
                }
            }
            const durationHours = deps.scheduleCalendarCore?.computeDurationHoursFromTimes
                ? deps.scheduleCalendarCore.computeDurationHoursFromTimes(startTime, endTime)
                : Math.round(((endMin - startMin) / 60) * 100) / 100;
            return { ok: true, startTime, endTime, durationHours };
        }
    
        function applyBulkDraftSessionTimes(selectedEvents, values = {}, source = 'timeline') {
            const validation = validateBulkDraftSessionTimes(selectedEvents, values);
            if (!validation.ok) {
                if (typeof deps.uiAlert === 'function') deps.uiAlert(validation.message, 'Edit selected staged sessions', { icon: 'warning' });
                return false;
            }
            const { startTime, endTime, durationHours } = validation;
            if (source === 'partialModal' && window.SessionEnrollmentCalendarModal?.applyBulkStagedSessionTimes) {
                const ok = window.SessionEnrollmentCalendarModal.applyBulkStagedSessionTimes(
                    selectedEvents.map((ev) => String(ev?.sessionId || ev?.id || '').trim()).filter(Boolean),
                    { startTime, endTime, durationHours }
                );
                if (ok) {
                    hideScheduleDraftBulkEditOverlay();
                    const person = deps.activeSchedulePerson();
                    if (person?.id) deps.scheduleState.selectedDraftSessionIdsByPersonId[person.id] = new Set();
                    deps.updateScheduleDraftSelectedControls();
                }
                return ok;
            }
            const person = deps.activeSchedulePerson();
            if (!person?.id) return false;
            const selectedIds = new Set(selectedEvents.map((ev) => String(ev?.sessionId || ev?.id || '').trim()).filter(Boolean));
            const drafts = Array.isArray(deps.scheduleState.draftEventsByPersonId?.[person.id])
                ? deps.scheduleState.draftEventsByPersonId[person.id]
                : [];
            deps.scheduleState.draftEventsByPersonId[person.id] = drafts.map((ev) => {
                const id = String(ev?.sessionId || ev?.id || '').trim();
                if (!selectedIds.has(id)) return ev;
                return {
                    ...ev,
                    start: startTime,
                    end: endTime,
                    duration: durationHours,
                    scheduledDuration: durationHours
                };
            });
            recomputeDraftOverlaps(person.id);
            deps.scheduleState.remoteUpdatePending = true;
            if (person?.id) deps.scheduleState.selectedDraftSessionIdsByPersonId[person.id] = new Set();
            hideScheduleDraftBulkEditOverlay();
            deps.refreshScheduleActiveView();
            syncPartialModalFromTimelineDrafts();
            return true;
        }
    
        function applyScheduleDraftBulkEditOverlay() {
            const selectedEvents = deps.getSelectedDraftEvents();
            if (selectedEvents.length < 2) return;
            const values = readScheduleDraftBulkEditFormValues();
            const errorEl = document.getElementById('scheduleDraftBulkEditError');
            const validation = validateBulkDraftSessionTimes(selectedEvents, values);
            if (!validation.ok) {
                if (errorEl) {
                    errorEl.textContent = validation.message;
                    errorEl.classList.remove('d-none');
                }
                return;
            }
            applyBulkDraftSessionTimes(selectedEvents, values, scheduleDraftBulkEditSource);
        }
    
        async function promptDeleteSelectedDraftSessions(source = 'timeline') {
            const selectedIds = Array.from(deps.getActiveDraftSelectionSet());
            if (!selectedIds.length) return;
            const ok = await deps.uiConfirm(`Delete ${selectedIds.length} selected staged session(s)?`, 'Delete All', {
                icon: 'warning',
                cancelText: 'Cancel',
                confirmText: 'Delete',
                confirmClass: 'btn-danger btn-md'
            });
            if (!ok) return;
            if (source === 'partialModal' && window.SessionEnrollmentCalendarModal?.deleteSelectedStagedSessions) {
                window.SessionEnrollmentCalendarModal.deleteSelectedStagedSessions(selectedIds);
                const person = deps.activeSchedulePerson();
                if (person?.id) deps.scheduleState.selectedDraftSessionIdsByPersonId[person.id] = new Set();
                deps.updateScheduleDraftSelectedControls();
                return;
            }
            const person = deps.activeSchedulePerson();
            const classIds = new Set();
            if (person?.id) {
                selectedIds.forEach((sessionId) => {
                    const sid = String(sessionId || '').trim();
                    const match = (deps.scheduleState.draftEventsByPersonId?.[person.id] || [])
                        .find((ev) => String(ev?.sessionId || ev?.id || '').trim() === sid);
                    if (match?.classId) classIds.add(String(match.classId).trim());
                });
            }
            selectedIds.forEach((sessionId) => {
                deleteDraftSession(sessionId, { suppressRefresh: true });
            });
            if (person?.id) {
                deps.scheduleState.selectedDraftSessionIdsByPersonId[person.id] = new Set();
                recomputeDraftOverlaps(person.id);
                deps.scheduleState.remoteUpdatePending = true;
            }
            classIds.forEach((cid) => {
                if (typeof deps.prunePendingEnrollmentsForClass === 'function') deps.prunePendingEnrollmentsForClass(cid);
            });
            deps.refreshScheduleActiveView();
            syncPartialModalFromTimelineDrafts();
        }
    
        function bindScheduleDraftSessionContextMenu() {
            if (scheduleDraftMenuBound) return;
            scheduleDraftMenuBound = true;
    
            document.getElementById('btn_scheduleDraftContextDelete')?.addEventListener('click', (clickEvent) => {
                clickEvent.preventDefault();
                const event = scheduleDraftContextEvent;
                const source = scheduleDraftContextSource;
                hideScheduleDraftSessionContextMenu();
                if (!event) return;
                const sessionId = String(event.sessionId || event.id || '').trim();
                if (source === 'partialModal' && window.SessionEnrollmentCalendarModal?.deleteStagedSession) {
                    window.SessionEnrollmentCalendarModal.deleteStagedSession(sessionId);
                } else {
                    deleteDraftSession(sessionId);
                }
            });
    
            document.getElementById('btn_scheduleDraftContextMoveSession')?.addEventListener('click', (clickEvent) => {
                clickEvent.preventDefault();
                const event = scheduleDraftContextEvent;
                const source = scheduleDraftContextSource;
                hideScheduleDraftSessionContextMenu();
                if (event) openScheduleDraftMoveOverlay(event, source);
            });
    
            document.getElementById('btn_scheduleDraftContextEdit')?.addEventListener('click', (clickEvent) => {
                clickEvent.preventDefault();
                const event = scheduleDraftContextEvent;
                const source = scheduleDraftContextSource;
                hideScheduleDraftSessionContextMenu();
                if (event) openScheduleDraftEditOverlay(event, source);
            });
    
            document.getElementById('btn_scheduleDraftContextSelect')?.addEventListener('click', (clickEvent) => {
                clickEvent.preventDefault();
                const event = scheduleDraftContextEvent;
                const source = scheduleDraftContextSource;
                hideScheduleDraftSessionContextMenu();
                if (event && typeof deps.openScheduleSessionBulkSelectModal === 'function') {
                    deps.openScheduleSessionBulkSelectModal(event, { mode: 'draft', source });
                }
            });

            document.getElementById('btn_scheduleDraftContextSelectPass')?.addEventListener('click', (clickEvent) => {
                clickEvent.preventDefault();
                const event = scheduleDraftContextEvent;
                const source = scheduleDraftContextSource;
                hideScheduleDraftSessionContextMenu();
                if (event) deps.selectDraftSessionsInStagingPass(event, source);
            });

            function openManagePendingEnrollmentsFromDraftMenu(clickEvent) {
                clickEvent.preventDefault();
                const event = scheduleDraftContextEvent;
                hideScheduleDraftSessionContextMenu();
                const classId = String(event?.classId || '').trim();
                if (!classId) return;
                if (typeof deps.openPendingEnrollmentManageModal === 'function') {
                    deps.openPendingEnrollmentManageModal(classId);
                }
            }

            document.getElementById('btn_scheduleDraftContextManagePendingEnrollments')?.addEventListener('click', openManagePendingEnrollmentsFromDraftMenu);
            document.getElementById('btn_scheduleDraftContextManagePendingEnrollmentsBulk')?.addEventListener('click', openManagePendingEnrollmentsFromDraftMenu);
    
            document.getElementById('btn_scheduleDraftContextDeleteAll')?.addEventListener('click', (clickEvent) => {
                clickEvent.preventDefault();
                const event = scheduleDraftContextEvent;
                const source = scheduleDraftContextSource;
                hideScheduleDraftSessionContextMenu();
                runScheduleDraftDeleteAll(event, source);
            });
    
            document.getElementById('btn_scheduleDraftContextEditAll')?.addEventListener('click', (clickEvent) => {
                clickEvent.preventDefault();
                const event = scheduleDraftContextEvent;
                const source = scheduleDraftContextSource;
                hideScheduleDraftSessionContextMenu();
                runScheduleDraftEditAll(event, source);
            });
    
            document.getElementById('btn_scheduleDraftContextEditAllSelected')?.addEventListener('click', (clickEvent) => {
                clickEvent.preventDefault();
                const source = scheduleDraftContextSource;
                hideScheduleDraftSessionContextMenu();
                openScheduleDraftBulkEditOverlay(source);
            });
    
            document.getElementById('btn_scheduleDraftContextDeleteAllSelected')?.addEventListener('click', (clickEvent) => {
                clickEvent.preventDefault();
                const source = scheduleDraftContextSource;
                hideScheduleDraftSessionContextMenu();
                void promptDeleteSelectedDraftSessions(source);
            });
    
            document.getElementById('scheduleDraftAttemptPickerList')?.addEventListener('click', (clickEvent) => {
                const btn = clickEvent.target.closest('[data-draft-attempt-id]');
                if (!btn) return;
                clickEvent.preventDefault();
                const attemptId = String(btn.getAttribute('data-draft-attempt-id') || '').trim();
                const action = scheduleDraftAttemptPickerAction;
                const pickerClassId = scheduleDraftAttemptPickerClassId;
                const pickerSource = scheduleDraftAttemptPickerSource;
                getScheduleDraftAttemptPickerModal()?.hide();
                scheduleDraftAttemptPickerAction = null;
                scheduleDraftAttemptPickerClassId = '';
                scheduleDraftAttemptPickerSource = 'timeline';
                if (!attemptId || !action) return;
                if (action === 'delete') {
                    void promptDeleteDraftAttempt(attemptId, pickerSource);
                    return;
                }
                const attempts = resolveDraftAttemptsForContext(pickerClassId, pickerSource);
                const batch = attempts.find((row) => String(row?.attemptId || '') === attemptId);
                if (!batch) return;
                if (pickerSource === 'partialModal' && window.SessionEnrollmentCalendarModal?.editStagedAttempt) {
                    window.SessionEnrollmentCalendarModal.editStagedAttempt(attemptId);
                } else {
                    openScheduleStageModalForBatchEdit(batch);
                }
            });
    
            document.getElementById('scheduleDraftMoveOverlay')?.addEventListener('click', (clickEvent) => {
                if (clickEvent.target.closest('[data-draft-move-dismiss]')) {
                    hideScheduleDraftMoveOverlay();
                    return;
                }
                if (clickEvent.target.closest('#btn_scheduleDraftMoveApply')) {
                    clickEvent.preventDefault();
                    applyScheduleDraftMoveOverlay();
                }
            });
    
            document.getElementById('btn_scheduleDraftMoveApply')?.addEventListener('click', (clickEvent) => {
                clickEvent.preventDefault();
                applyScheduleDraftMoveOverlay();
            });
    
            document.getElementById('scheduleDraftEditOverlay')?.addEventListener('click', (clickEvent) => {
                if (clickEvent.target.closest('[data-draft-edit-dismiss]')) {
                    hideScheduleDraftEditOverlay();
                    return;
                }
                if (clickEvent.target.closest('#btn_scheduleDraftEditApply')) {
                    clickEvent.preventDefault();
                    applyScheduleDraftEditOverlay();
                    return;
                }
                const durationBtn = clickEvent.target.closest('[data-draft-edit-duration]');
                if (durationBtn) {
                    document.querySelectorAll('#scheduleDraftEditDurationGroup [data-draft-edit-duration]').forEach((btn) => {
                        btn.classList.toggle('active', btn === durationBtn);
                    });
                }
            });
    
            document.getElementById('btn_scheduleDraftEditApply')?.addEventListener('click', (clickEvent) => {
                clickEvent.preventDefault();
                applyScheduleDraftEditOverlay();
            });
    
            document.getElementById('scheduleDraftBulkEditOverlay')?.addEventListener('click', (clickEvent) => {
                if (clickEvent.target.closest('[data-draft-bulk-edit-dismiss]')) {
                    hideScheduleDraftBulkEditOverlay();
                    return;
                }
                if (clickEvent.target.closest('#btn_scheduleDraftBulkEditApply')) {
                    clickEvent.preventDefault();
                    applyScheduleDraftBulkEditOverlay();
                }
            });
    
            document.getElementById('btn_scheduleDraftBulkEditApply')?.addEventListener('click', (clickEvent) => {
                clickEvent.preventDefault();
                applyScheduleDraftBulkEditOverlay();
            });
    
            document.addEventListener('click', (clickEvent) => {
                if (Date.now() < scheduleDraftContextMenuSuppressDismissUntil) return;
                const menu = document.getElementById('scheduleDraftSessionContextMenu');
                if (!menu || menu.classList.contains('d-none')) return;
                if (clickEvent.target.closest('#scheduleDraftSessionContextMenu')) return;
                hideScheduleDraftSessionContextMenu();
            });
            document.addEventListener('scroll', hideScheduleDraftSessionContextMenu, true);
            document.addEventListener('keydown', (keyEvent) => {
                if (keyEvent.key === 'Escape') {
                    hideScheduleDraftSessionContextMenu();
                    hideScheduleDraftEditOverlay();
                    hideScheduleDraftMoveOverlay();
                    hideScheduleDraftBulkEditOverlay();
                }
            });
        }
    
        window.ScheduleDraftSessionMenu = {
            show: showScheduleDraftSessionContextMenu,
            hide: hideScheduleDraftSessionContextMenu,
            openEditOverlay: openScheduleDraftEditOverlay,
            openMoveOverlay: openScheduleDraftMoveOverlay,
            openBulkEditOverlay: openScheduleDraftBulkEditOverlay,
            formatAttemptLabel: formatStagingAttemptLabel,
            buildDraftSelectHtml: deps.scheduleDraftSelectHtml,
            toggleDraftSelection: deps.toggleDraftSessionSelection,
            isDraftSelected: deps.isDraftSessionSelected,
            getSelectedDraftIds: () => Array.from(deps.getActiveDraftSelectionSet()),
            clearDraftSelection: deps.clearActiveDraftSessionSelection,
            hasPendingDraftWork: deps.hasPendingDraftWorkForPerson,
            buildScheduleDraftEnrollmentBadge: deps.buildScheduleDraftEnrollmentBadge
        };
    
    return {
      bindScheduleDragCreate,
      resolveScheduleDraftEventFromTarget,
      bindScheduleDraftSessionContextMenu,
      commitScheduleDraftSessions,
      getScheduleStageModalEl,
      getDraftBatchesForPerson,
      syncPartialModalFromTimelineDrafts,
      isScheduleSavedSessionWorkActive,
      isLatestScheduleSessionMutation,
      buildScheduleDraftResizeHandlesHtml,
      openScheduleDraftEditFromTarget,
      isScheduleDraftEditInteractionTarget,
      showScheduleDraftSessionContextMenu,
      hideScheduleDraftEditOverlay,
      hideScheduleDraftMoveOverlay,
      openScheduleSavedSessionEditOverlay,
      openScheduleSavedSessionMoveOverlay
    };
  }

  global.MasterScheduleViewerStaging = { install: installMasterScheduleStaging };
})(typeof window !== 'undefined' ? window : globalThis);
