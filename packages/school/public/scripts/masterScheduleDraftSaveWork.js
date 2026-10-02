(function (global) {
  'use strict';

  function installMasterScheduleDraftSaveWork(deps) {
    if (!deps || typeof deps !== 'object') return null;
    let modalBound = false;

    function clean(value) {
      return String(value || '').trim();
    }

    function escapeHtml(value) {
      if (typeof deps.escapeHtml === 'function') return deps.escapeHtml(value);
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function slugId(value) {
      return clean(value).replace(/[^a-zA-Z0-9_-]+/g, '_') || 'item';
    }

    function formatSessionWeekday(isoDate) {
      const d = isoDate ? new Date(`${isoDate}T12:00:00`) : null;
      if (!d || Number.isNaN(d.getTime())) return '';
      return d.toLocaleDateString(undefined, { weekday: 'short' });
    }

    function formatSessionDisplayDate(isoDate) {
      const d = isoDate ? new Date(`${isoDate}T12:00:00`) : null;
      if (!d || Number.isNaN(d.getTime())) return isoDate || '—';
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function formatTimeRange(start, end) {
      const s = clean(start);
      const e = clean(end);
      if (s && e) return `${s} – ${e}`;
      return s || e || '—';
    }

    function sortSessions(sessions) {
      return (Array.isArray(sessions) ? sessions : []).slice().sort((a, b) => {
        const dateCmp = clean(a?.date).localeCompare(clean(b?.date));
        if (dateCmp !== 0) return dateCmp;
        return clean(a?.start).localeCompare(clean(b?.start));
      });
    }

    function groupClient() {
      return global.RollingEnrollmentGroupClient || {};
    }

    function buildDraftSaveWorkItems(personId) {
      const pid = clean(personId);
      if (!pid) return [];
      const byClass = new Map();
      const drafts = Array.isArray(deps.scheduleState?.draftEventsByPersonId?.[pid])
        ? deps.scheduleState.draftEventsByPersonId[pid]
        : [];
      drafts.forEach((ev) => {
        if (ev?.isDraft !== true) return;
        const classId = clean(ev.classId);
        const sessionId = clean(ev.sessionId || ev.id);
        if (!classId || !sessionId) return;
        if (!byClass.has(classId)) {
          byClass.set(classId, {
            classId,
            classLabel: clean(ev.className || ev.classLabel || classId),
            sessions: [],
            enrollments: []
          });
        }
        const group = byClass.get(classId);
        if (!group.classLabel || group.classLabel === classId) {
          group.classLabel = clean(ev.className || ev.classLabel || group.classLabel);
        }
        group.sessions.push({
          sessionId,
          date: clean(ev.date),
          start: clean(ev.start),
          end: clean(ev.end)
        });
      });

      const pendingMap = deps.scheduleState?.pendingEnrollStudentsByClassId || {};
      Object.entries(pendingMap).forEach(([classId, entries]) => {
        const cid = clean(classId);
        if (!cid || !Array.isArray(entries) || !entries.length) return;
        if (!byClass.has(cid)) {
          const meta = typeof deps.getPendingEnrollMetaForClass === 'function'
            ? deps.getPendingEnrollMetaForClass(cid)
            : null;
          byClass.set(cid, {
            classId: cid,
            classLabel: clean(meta?.className) || cid,
            sessions: [],
            enrollments: []
          });
        }
        const group = byClass.get(cid);
        entries.forEach((entry, index) => {
          const studentId = clean(entry?.students?.[0]?.studentId || entry?.studentId);
          if (!studentId) return;
          group.enrollments.push({
            index,
            studentId,
            studentLabel: clean(entry?.studentLabel) || studentId,
            selectedSessionIds: (Array.isArray(entry?.selectedSessionIds) ? entry.selectedSessionIds : [])
              .map((sid) => clean(sid))
              .filter(Boolean),
            entry
          });
        });
      });

      return Array.from(byClass.values())
        .filter((group) => group.sessions.length || group.enrollments.length)
        .map((group) => ({
          ...group,
          sessions: sortSessions(group.sessions)
        }));
    }

    function canSelectEnrollmentRow(selectedSessionIdSet, enrollmentRow) {
      const ids = Array.isArray(enrollmentRow?.selectedSessionIds) ? enrollmentRow.selectedSessionIds : [];
      if (!ids.length) return false;
      return ids.every((id) => selectedSessionIdSet.has(clean(id)));
    }

    let lastRenderedDraftSaveGroups = [];

    function getAllStagedSessionIdsFromSection(section) {
      return clean(section?.getAttribute('data-staged-session-ids'))
        .split('|')
        .map((id) => clean(id))
        .filter(Boolean);
    }

    function getAllStagedSessionIdSetForSection(section) {
      return new Set(getAllStagedSessionIdsFromSection(section));
    }

    function findClassSectionElement(classId) {
      const cid = clean(classId);
      const sections = document.querySelectorAll('#scheduleSaveDraftWorkModalBody [data-draft-save-class]');
      for (const section of sections) {
        if (clean(section.getAttribute('data-draft-save-class')) === cid) return section;
      }
      return null;
    }

    function syncEnrollmentCheckboxState(classId) {
      const section = findClassSectionElement(classId);
      const stagedSessions = section ? getAllStagedSessionIdSetForSection(section) : new Set();
      document.querySelectorAll('#scheduleSaveDraftWorkModalBody .js-draft-save-enrollment').forEach((input) => {
        if (clean(input.getAttribute('data-draft-save-enrollment')) !== clean(classId)) return;
        const enrollmentRow = {
          selectedSessionIds: clean(input.getAttribute('data-linked-session-ids')).split('|').filter(Boolean)
        };
        const allowed = canSelectEnrollmentRow(stagedSessions, enrollmentRow);
        input.disabled = !allowed;
        if (!allowed) input.checked = false;
        const card = input.closest('.draft-save-enrollment-row');
        if (card) card.classList.toggle('is-disabled', !allowed);
        const hint = card?.querySelector('.draft-save-enrollment-hint');
        if (hint) {
          hint.textContent = allowed
            ? ''
            : 'This enrollment is missing one or more linked staged sessions in this class.';
          hint.classList.toggle('d-none', allowed);
        }
      });
    }

    function enumerateMonthKeysFromSessions(sessions) {
      const keys = new Set();
      (Array.isArray(sessions) ? sessions : []).forEach((session) => {
        const d = clean(session?.date);
        if (d.length >= 7) keys.add(d.slice(0, 7));
      });
      return Array.from(keys).sort();
    }

    function buildSessionsByDate(sessions) {
      const map = new Map();
      (Array.isArray(sessions) ? sessions : []).forEach((session) => {
        const date = clean(session?.date);
        if (!date) return;
        if (!map.has(date)) map.set(date, []);
        map.get(date).push(session);
      });
      map.forEach((rows, date) => {
        rows.sort((a, b) => clean(a?.start).localeCompare(clean(b?.start)));
      });
      return map;
    }

    function buildMonthCalendarHtml(year, monthIndex, sessionsByDate) {
      const monthStart = new Date(year, monthIndex, 1);
      const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
      const leadEmpty = (monthStart.getDay() + 6) % 7;
      const monthTitle = monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const head = weekdays.map((d) => `<div class="draft-save-cal-dow">${d}</div>`).join('');
      let cells = '';
      for (let i = 0; i < leadEmpty; i += 1) {
        cells += '<div class="draft-save-cal-cell is-outside" aria-hidden="true"></div>';
      }
      for (let day = 1; day <= daysInMonth; day += 1) {
        const month = String(monthIndex + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        const iso = `${year}-${month}-${dayStr}`;
        const daySessions = sessionsByDate.get(iso) || [];
        if (!daySessions.length) {
          cells += `<div class="draft-save-cal-cell"><span class="draft-save-cal-day-num">${day}</span></div>`;
          continue;
        }
        const chips = daySessions.map((session) => {
          const timeLabel = formatTimeRange(session.start, session.end);
          const occupant = clean(session?.occupantLabel);
          const title = occupant ? `${timeLabel} — ${occupant}` : timeLabel;
          const occupantHtml = occupant
            ? `<span class="draft-save-cal-session-occupant">${escapeHtml(occupant)}</span>`
            : '';
          return `<span class="draft-save-cal-session-chip" title="${escapeHtml(title)}">${escapeHtml(timeLabel)}${occupantHtml}</span>`;
        }).join('');
        cells += `<div class="draft-save-cal-cell has-sessions">
          <span class="draft-save-cal-day-num">${day}</span>
          <div class="draft-save-cal-session-stack">${chips}</div>
        </div>`;
      }
      const trail = (leadEmpty + daysInMonth) % 7;
      if (trail !== 0) {
        for (let i = trail; i < 7; i += 1) {
          cells += '<div class="draft-save-cal-cell is-outside" aria-hidden="true"></div>';
        }
      }
      return `<div class="draft-save-month-block">
        <div class="draft-save-month-title">${escapeHtml(monthTitle)}</div>
        <div class="draft-save-cal-grid">${head}${cells}</div>
      </div>`;
    }

    function buildStagedSessionsCalendarHtml(group) {
      return buildStagedSessionsCalendarHtmlFromSessions(group?.sessions);
    }

    function buildStagedSessionsCalendarHtmlFromSessions(sessions) {
      const sorted = sortSessions(sessions);
      const sessionsByDate = buildSessionsByDate(sorted);
      const monthKeys = enumerateMonthKeysFromSessions(sorted);
      if (!monthKeys.length) {
        return '<div class="draft-save-cal-empty small text-muted">No staged session dates.</div>';
      }
      return monthKeys.map((key) => {
        const [yearStr, monthStr] = key.split('-');
        const year = Number(yearStr);
        const monthIndex = Number(monthStr) - 1;
        if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return '';
        return buildMonthCalendarHtml(year, monthIndex, sessionsByDate);
      }).join('');
    }

    function buildEnrollmentSummaryLines(row, meta) {
      const entry = row?.entry || {};
      const settings = groupClient().groupEnrollmentSettingsFromEntry?.(entry) || entry;
      const start = clean(settings.startDate) || clean(meta?.startDate);
      const end = clean(settings.endDate) || clean(meta?.endDate);
      const windowLabel = start && end ? `${start} – ${end}` : (start || end || '—');
      const capLabel = settings.sessionCapacityType === 'one_on_one' ? '1-on-1' : 'Group';
      const mode = groupClient().inferGroupEnrollmentMode?.(settings) || '';
      const modeLabel = mode === 'session_cap' ? 'Session cap'
        : (mode === 'hour_cap' ? 'Hour cap' : 'Date window');
      const funderId = clean(settings.funderId);
      const funderLabel = funderId === 'self' || !funderId ? 'Self-funded' : funderId;
      const line1 = [windowLabel, modeLabel, capLabel, clean(settings.status) || 'active', funderLabel].join(' · ');
      const line2Parts = [];
      const targetHours = clean(settings.targetHours || entry?.targetHours);
      if (mode === 'hour_cap' && targetHours) {
        line2Parts.push(`${targetHours} h targeted`);
      } else {
        const target = clean(settings.targetSessionCount);
        if (target) line2Parts.push(`${target} session${target === '1' ? '' : 's'} targeted`);
      }
      const claim = clean(settings.claimNumberId || settings.claimNumber);
      if (claim) line2Parts.push(`Claim ${claim}`);
      const note = clean(settings.reasonStart);
      if (note) {
        const short = note.length > 72 ? `${note.slice(0, 69)}…` : note;
        line2Parts.push(short);
      }
      return { line1, line2: line2Parts.join(' · ') };
    }

    function buildEnrollmentCardsHtml(group, meta) {
      const classId = escapeHtml(group.classId);
      return group.enrollments.map((row) => {
        const linked = row.selectedSessionIds.join('|');
        const inputId = `draftSaveEnroll_${slugId(group.classId)}_${row.index}`;
        const summary = buildEnrollmentSummaryLines(row, meta);
        const line2Html = summary.line2
          ? `<div class="draft-save-enrollment-summary-line2">${escapeHtml(summary.line2)}</div>`
          : '';
        return `<div class="draft-save-enrollment-row" data-enrollment-index="${row.index}">
          <div class="draft-save-enrollment-row-main">
            <input class="form-check-input js-draft-save-enrollment mt-1" type="checkbox" checked
              id="${inputId}"
              data-draft-save-enrollment="${classId}" data-enrollment-index="${row.index}"
              data-linked-session-ids="${escapeHtml(linked)}">
            <label class="draft-save-enrollment-copy" for="${inputId}">
              <span class="draft-save-enrollment-student">${escapeHtml(row.studentLabel)}</span>
              <span class="draft-save-enrollment-summary-line1">${escapeHtml(summary.line1)}</span>
              ${line2Html}
            </label>
          </div>
          <button type="button" class="btn btn-sm btn-link text-danger draft-save-enrollment-remove js-draft-save-enrollment-remove p-0"
            title="Remove draft enrollment"
            data-draft-save-class="${classId}" data-enrollment-index="${row.index}" aria-label="Remove draft enrollment for ${escapeHtml(row.studentLabel)}">
            <i class="bi bi-trash"></i>
          </button>
          <div class="draft-save-enrollment-hint d-none w-100"></div>
        </div>`;
      }).join('');
    }

    function bindSaveDraftWorkModalInteractions(groups) {
      const body = document.getElementById('scheduleSaveDraftWorkModalBody');
      if (!body) return;
      groups.forEach((group) => syncEnrollmentCheckboxState(group.classId));
      body.querySelectorAll('.js-draft-save-enrollment-remove').forEach((btn) => {
        btn.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const classId = clean(btn.getAttribute('data-draft-save-class'));
          const index = Number(btn.getAttribute('data-enrollment-index'));
          if (!classId || !Number.isFinite(index)) return;
          let ok = true;
          if (typeof deps.uiConfirm === 'function') {
            ok = await deps.uiConfirm(
              'Remove this draft enrollment from your staged work? It will not be saved until you enroll again.',
              'Remove draft enrollment',
              { icon: 'warning', cancelText: 'Cancel', confirmText: 'Remove', confirmClass: 'btn-danger btn-md' }
            );
          }
          if (!ok) return;
          if (typeof deps.removePendingEnrollStudentAt === 'function') {
            deps.removePendingEnrollStudentAt(classId, index);
          }
          deps.refreshScheduleViewWithHolidays?.();
          deps.syncPartialModalFromTimelineDrafts?.();
          const person = typeof deps.activeSchedulePerson === 'function' ? deps.activeSchedulePerson() : null;
          const nextGroups = buildDraftSaveWorkItems(person?.id);
          if (!nextGroups.length) {
            deps.hideBootstrapModal?.(document.getElementById('scheduleSaveDraftWorkModal'));
            return;
          }
          renderSaveDraftWorkModal(nextGroups);
        });
      });
    }

    function renderSaveDraftWorkModal(groups) {
      const body = document.getElementById('scheduleSaveDraftWorkModalBody');
      if (!body) return;
      const errorEl = document.getElementById('scheduleSaveDraftWorkModalError');
      if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('d-none');
      }

      lastRenderedDraftSaveGroups = groups;

      body.innerHTML = `<div class="accordion schedule-save-draft-work-accordion" id="draftSaveWorkClassAccordion">
        ${groups.map((group, classIndex) => {
          const classSlug = slugId(group.classId);
          const classId = escapeHtml(group.classId);
          const classLabel = escapeHtml(group.classLabel || group.classId);
          const sessionCount = group.sessions.length;
          const enrollCount = group.enrollments.length;
          const meta = typeof deps.getPendingEnrollMetaForClass === 'function'
            ? deps.getPendingEnrollMetaForClass(group.classId)
            : null;
          const classCollapseId = `draftSaveClass_${classSlug}`;
          const sessionsCollapseId = `draftSaveSessions_${classSlug}`;
          const enrollCollapseId = `draftSaveEnroll_${classSlug}`;
          const stagedSessionIdsAttr = escapeHtml(group.sessions.map((s) => clean(s.sessionId)).filter(Boolean).join('|'));
          const sessionSection = sessionCount ? `
            <div class="accordion-item border-0 draft-save-nested-accordion">
              <h3 class="accordion-header">
                <button class="accordion-button py-2" type="button" data-bs-toggle="collapse"
                  data-bs-target="#${sessionsCollapseId}" aria-expanded="true" aria-controls="${sessionsCollapseId}">
                  <i class="bi bi-calendar3-week me-2 text-primary"></i>Staged sessions
                  <span class="badge rounded-pill text-bg-light border ms-2">${sessionCount}</span>
                </button>
              </h3>
              <div id="${sessionsCollapseId}" class="accordion-collapse collapse show">
                <div class="accordion-body draft-save-section-panel pt-2 pb-2">
                  <p class="small text-muted mb-2">All staged sessions below will be saved for this class.</p>
                  <div class="draft-save-calendar-host">${buildStagedSessionsCalendarHtml(group)}</div>
                </div>
              </div>
            </div>` : '';
          const enrollSection = enrollCount ? `
            <div class="accordion-item border-0 draft-save-nested-accordion">
              <h3 class="accordion-header">
                <button class="accordion-button py-2" type="button" data-bs-toggle="collapse"
                  data-bs-target="#${enrollCollapseId}" aria-expanded="true" aria-controls="${enrollCollapseId}">
                  <i class="bi bi-person-lines-fill me-2 text-info"></i>Draft enrollments
                  <span class="badge rounded-pill text-bg-light border ms-2">${enrollCount}</span>
                </button>
              </h3>
              <div id="${enrollCollapseId}" class="accordion-collapse collapse show">
                <div class="accordion-body draft-save-section-panel pt-2 pb-2">
                  <div class="draft-save-enrollment-list">${buildEnrollmentCardsHtml(group, meta)}</div>
                </div>
              </div>
            </div>` : '';
          return `<div class="accordion-item schedule-save-draft-class" data-draft-save-class="${classId}" data-class-label="${classLabel}" data-staged-session-ids="${stagedSessionIdsAttr}">
            <h2 class="accordion-header">
              <button class="accordion-button ${classIndex === 0 ? '' : 'collapsed'}" type="button" data-bs-toggle="collapse"
                data-bs-target="#${classCollapseId}" aria-expanded="${classIndex === 0 ? 'true' : 'false'}" aria-controls="${classCollapseId}">
                <span class="me-2"><i class="bi bi-mortarboard"></i></span>
                <span class="fw-semibold">${classLabel}</span>
                <span class="draft-save-class-meta ms-2">${sessionCount} session${sessionCount === 1 ? '' : 's'} · ${enrollCount} enrollment${enrollCount === 1 ? '' : 's'}</span>
              </button>
            </h2>
            <div id="${classCollapseId}" class="accordion-collapse collapse ${classIndex === 0 ? 'show' : ''}" data-bs-parent="#draftSaveWorkClassAccordion">
              <div class="accordion-body pt-0">
                <div class="accordion draft-save-nested-accordion" id="draftSaveNested_${classSlug}">
                  ${sessionSection}
                  ${enrollSection}
                </div>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>`;

      bindSaveDraftWorkModalInteractions(groups);
    }

    function readSelectedSaveDraftWork() {
      const classes = [];
      document.querySelectorAll('#scheduleSaveDraftWorkModalBody [data-draft-save-class]').forEach((section) => {
        const classId = clean(section.getAttribute('data-draft-save-class'));
        if (!classId) return;
        const classLabel = clean(section.getAttribute('data-class-label')) || classId;
        const sessionIds = getAllStagedSessionIdsFromSection(section);
        const enrollmentIndexes = [];
        const enrollmentEntries = [];
        section.querySelectorAll('.js-draft-save-enrollment:checked:not(:disabled)').forEach((input) => {
          const idx = Number(input.getAttribute('data-enrollment-index'));
          if (!Number.isFinite(idx)) return;
          enrollmentIndexes.push(idx);
          const rows = deps.getPendingEnrollStudentsForClass?.(classId) || [];
          if (rows[idx]) enrollmentEntries.push(rows[idx]);
        });
        if (sessionIds.length || enrollmentEntries.length) {
          classes.push({
            classId,
            classLabel,
            sessionIds,
            enrollmentIndexes,
            enrollmentEntries
          });
        }
      });
      return { classes };
    }

    function bindSaveDraftWorkModal() {
      if (modalBound) return;
      modalBound = true;
      document.getElementById('btn_scheduleSaveDraftWorkApply')?.addEventListener('click', () => {
        const selection = readSelectedSaveDraftWork();
        const errorEl = document.getElementById('scheduleSaveDraftWorkModalError');
        if (!selection.classes.length) {
          if (errorEl) {
            errorEl.textContent = 'Select at least one staged session or draft enrollment to save.';
            errorEl.classList.remove('d-none');
          }
          return;
        }
        deps.hideBootstrapModal?.(document.getElementById('scheduleSaveDraftWorkModal'));
        if (typeof deps.runSelectedDraftSave === 'function') {
          void deps.runSelectedDraftSave(selection);
        }
      });
    }

    function openSaveDraftWorkModal() {
      bindSaveDraftWorkModal();
      const person = typeof deps.activeSchedulePerson === 'function' ? deps.activeSchedulePerson() : null;
      const groups = buildDraftSaveWorkItems(person?.id);
      if (!groups.length) {
        void deps.uiAlert?.('No staged sessions or draft enrollments are available to save.', 'Save staged work', { icon: 'info' });
        return;
      }
      renderSaveDraftWorkModal(groups);
      deps.showBootstrapModal?.(document.getElementById('scheduleSaveDraftWorkModal'));
    }

    global.MasterScheduleDraftSaveWork.openSaveDraftWorkModal = openSaveDraftWorkModal;
    global.MasterScheduleDraftSaveWork.buildStagedSessionsCalendarHtmlFromSessions = buildStagedSessionsCalendarHtmlFromSessions;

    return {
      openSaveDraftWorkModal,
      buildDraftSaveWorkItems,
      buildStagedSessionsCalendarHtmlFromSessions,
      canSelectEnrollmentRow,
      readSelectedSaveDraftWork
    };
  }

  global.MasterScheduleDraftSaveWork = {
    install: installMasterScheduleDraftSaveWork,
    openSaveDraftWorkModal: null,
    buildStagedSessionsCalendarHtmlFromSessions: null
  };
})(typeof window !== 'undefined' ? window : globalThis);
