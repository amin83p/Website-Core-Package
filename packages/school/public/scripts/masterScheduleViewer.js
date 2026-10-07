/* eslint-disable */
(function (global) {
  'use strict';

  function readMasterScheduleViewerConfig() {
    const el = document.getElementById('masterScheduleViewerConfig');
    if (!el) return {};
    try {
      return JSON.parse(el.textContent || '{}');
    } catch (_) {
      return {};
    }
  }

  document.addEventListener('DOMContentLoaded', () => {

    const cfg = readMasterScheduleViewerConfig();
    const canSelectAnyPerson = cfg.canSelectAnyPerson === true;
    const canDragCreateSessions = cfg.canDragCreateSessions === true;
    const canLoadAllSchedules = cfg.canLoadAllSchedules === true;
    const canDeleteClassSessions = cfg.canDeleteClassSessions === true;
    const canOpenRollingEnrollment = cfg.canOpenRollingEnrollment === true;
    const initialScheduleRoles = Array.isArray(cfg.initialScheduleRoles) ? cfg.initialScheduleRoles : [];
    const initialDefaultRole = String(cfg.initialDefaultRole || '');
    const initialLockedPersonId = String(cfg.initialLockedPersonId || '');
    const initialLockedPersonName = String(cfg.initialLockedPersonName || '');
    const initialScheduleViewerPrefs = cfg.initialScheduleViewerPrefs && typeof cfg.initialScheduleViewerPrefs === 'object'
      ? cfg.initialScheduleViewerPrefs
      : {};
    const SCHEDULE_VIEWER_PREFS_API = String(cfg.api?.viewerPreferences || '/school/schedules/api/viewer-preferences');
    const SCHEDULE_COMMIT_STAGED_API = String(cfg.api?.commitStagedSessions || '/school/schedules/api/commit-staged-sessions');
    const SCHEDULE_COMMIT_STAGED_PRECHECK_API = String(cfg.api?.commitStagedSessionsPrecheck || '/school/schedules/api/commit-staged-sessions/precheck');
    const SCHEDULE_VALIDATE_PENDING_ENROLL_API = String(cfg.api?.validatePendingEnrollmentsCommit || '/school/schedules/api/enroll-students/validate-pending-commit');
    const SCHEDULE_EXECUTE_PENDING_ENROLL_API = String(cfg.api?.executePendingEnrollmentsCommit || '/school/schedules/api/enroll-students/execute-pending-commit');
    const SCHEDULE_COMMIT_TIMEOUT_MS = Number(cfg.constants?.commitTimeoutMs) || 120000;
    const SCHEDULE_DRAFT_BACKUP_KEY = String(cfg.constants?.draftBackupKey || 'schoolMasterViewer.scheduleDraftBackup');
    const SCHEDULE_UPDATE_CLASS_SESSION_SCHEDULE_API = String(cfg.api?.updateClassSessionSchedule || '/school/schedules/api/update-class-session-schedule');
    const SCHEDULE_SESSION_MANAGEMENT_POLICY_API = String(cfg.api?.sessionManagementPolicy || '/school/schedules/api/session-management-policy');
    const SCHEDULE_UPDATE_CLASS_SESSION_STATUS_API = String(cfg.api?.updateClassSessionStatus || '/school/schedules/api/update-class-session-status');
    const SCHEDULE_UPDATE_WORK_SESSION_SCHEDULE_API = String(cfg.api?.updateWorkSessionSchedule || '/school/schedules/api/update-work-session-schedule');
    const SCHEDULE_BULK_DELETE_SESSIONS_PREVIEW_API = String(cfg.api?.bulkDeleteSessionsPreview || '/school/schedules/api/bulk-delete-sessions/preview');
    const SCHEDULE_BULK_DELETE_SESSIONS_API = String(cfg.api?.bulkDeleteSessions || '/school/schedules/api/bulk-delete-sessions');
    const SCHEDULE_REFRESH_SESSIONS_API = String(cfg.api?.refreshScheduleSessions || '/school/schedules/api/schedule-viewer/refresh-sessions');
    const SCHEDULE_DRAGGABLE_BLOCK_SELECTOR = String(cfg.constants?.draggableBlockSelector || '[data-event-type="schedule_draft"], .is-schedule-draft[data-session-id], [data-event-type="class_session"][data-schedule-editable="1"]');
    const scheduleCalendarCore = window.SessionCalendarCore;
    const TIMELINE_START_HOUR = scheduleCalendarCore?.TIMELINE_START_HOUR ?? 7;
    const TIMELINE_END_HOUR = scheduleCalendarCore?.TIMELINE_END_HOUR ?? 22;
    const TOTAL_MINUTES = (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * 60;
    const DEFAULT_STAGED_VIEW_PADDING_WEEKS_BEFORE = 2;
    const DEFAULT_STAGED_VIEW_PADDING_WEEKS_AFTER = 2;
    const MAX_STAGED_VIEW_PADDING_WEEKS = 12;

    function timeToMinutes(timeStr) {
        if (scheduleCalendarCore) return scheduleCalendarCore.timeToMinutes(timeStr);
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return (h * 60) + m;
    }

    function calculatePosition(startStr, endStr) {
        if (scheduleCalendarCore) return scheduleCalendarCore.calculatePosition(startStr, endStr);
        let startMin = timeToMinutes(startStr);
        let endMin = timeToMinutes(endStr);
        const timelineStartMin = TIMELINE_START_HOUR * 60;
        const timelineEndMin = TIMELINE_END_HOUR * 60;
        if (startMin < timelineStartMin) startMin = timelineStartMin;
        if (endMin > timelineEndMin) endMin = timelineEndMin;
        if (endMin <= startMin) endMin = startMin + 30;
        const leftPercent = ((startMin - timelineStartMin) / TOTAL_MINUTES) * 100;
        const widthPercent = ((endMin - startMin) / TOTAL_MINUTES) * 100;
        return { left: leftPercent, width: widthPercent, startMin, endMin };
    }

    function bindCollapseToggle(options = {}) {
        const collapseEl = document.getElementById(String(options.collapseId || ''));
        const buttonEl = document.getElementById(String(options.buttonId || ''));
        const iconEl = document.getElementById(String(options.iconId || ''));
        const titleEl = document.getElementById(String(options.titleId || ''));
        const cardEl = document.getElementById(String(options.cardId || ''));
        if (!collapseEl || !buttonEl || !iconEl) return;

        const collapseInstance = window.bootstrap?.Collapse
            ? window.bootstrap.Collapse.getOrCreateInstance(collapseEl, { toggle: false })
            : null;

        const setState = (open) => {
            iconEl.className = open ? 'bi bi-chevron-up' : 'bi bi-chevron-down';
            buttonEl.setAttribute('aria-expanded', open ? 'true' : 'false');
            buttonEl.setAttribute('aria-label', open ? 'Close filters' : 'Open filters');
            if (titleEl) titleEl.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (cardEl) cardEl.classList.toggle('is-expanded', open);
        };

        const toggleCollapse = () => {
            if (collapseInstance) collapseInstance.toggle();
            else buttonEl.click();
        };

        setState(collapseEl.classList.contains('show'));
        collapseEl.addEventListener('shown.bs.collapse', () => setState(true));
        collapseEl.addEventListener('hidden.bs.collapse', () => setState(false));

        if (titleEl) {
            titleEl.addEventListener('click', (event) => {
                if (event.target.closest('button, input, select, a, label')) return;
                toggleCollapse();
            });
            titleEl.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                toggleCollapse();
            });
        }
    }
    bindCollapseToggle({
        collapseId: 'scheduleFilterCollapse',
        buttonId: 'scheduleFilterToggleBtn',
        iconId: 'scheduleFilterToggleIcon',
        titleId: 'scheduleFilterTitleToggle',
        cardId: 'scheduleFilterCard'
    });

    function setActiveRangeChip(range) {
        document.querySelectorAll('.btn-range.range-chip, .schedule-range-chip').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-range') === range);
        });
    }

    const setDateRange = (start, end) => {
        document.getElementById('sch_startDate').value = start.toISOString().split('T')[0];
        document.getElementById('sch_endDate').value = end.toISOString().split('T')[0];
    };

    function setDateRangeFromIso(startDate, endDate) {
        const startEl = document.getElementById('sch_startDate');
        const endEl = document.getElementById('sch_endDate');
        const prevKey = scheduleHolidayRangeKey(startEl?.value || '', endEl?.value || '');
        const start = String(startDate || '').trim();
        const end = String(endDate || '').trim();
        if (startEl) startEl.value = start;
        if (endEl) endEl.value = end;
        const nextKey = scheduleHolidayRangeKey(start, end);
        if (nextKey && nextKey !== prevKey) {
            scheduleState.holidayRangeKey = '';
        }
    }

    function applyDefaultWeekRange() {
        const today = new Date();
        const day = today.getDay() || 7;
        const start = new Date(today);
        start.setHours(-24 * (day - 1));
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        setDateRange(start, end);
        setActiveRangeChip('week');
    }

    const normalizeSessionStatus = (status) => String(status || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'scheduled';
    let sessionStatusMetaMap = new Map();
    function getStatusMeta(status) {
        const normalized = normalizeSessionStatus(status);
        return sessionStatusMetaMap.get(normalized) || null;
    }
    function getStatusTagStyle(status) {
        const normalized = normalizeSessionStatus(status);
        if (normalized === 'approved_leave' || normalized === 'approved_leave_snapshot') {
            return 'background:#fff3cd;color:#7a4d00;border-color:#f59f00;';
        }
        const meta = getStatusMeta(status);
        if (!meta) return 'background:#e2e3e5;color:#41464b;border-color:#c6c8ca;';
        return `background:${meta.colorBg || '#e2e3e5'};color:${meta.colorText || '#41464b'};border-color:${meta.colorBorder || '#c6c8ca'};`;
    }
    function formatStatusLabel(status) {
        const normalized = normalizeSessionStatus(status);
        if (normalized === 'approved_leave' || normalized === 'approved_leave_snapshot') return 'Approved Leave';
        const meta = getStatusMeta(status);
        if (meta?.label) return meta.label;
        return normalized.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function buildSessionCaseBadgeHtml(caseSummary) {
        if (!caseSummary || !caseSummary.hasCases) return '';
        const tone = String(caseSummary.badgeTone || 'muted').trim().toLowerCase();
        const classMap = {
            danger: 'bg-danger-subtle text-danger-emphasis border-danger-subtle',
            warning: 'bg-warning-subtle text-warning-emphasis border-warning-subtle',
            info: 'bg-info-subtle text-info-emphasis border-info-subtle',
            muted: 'bg-secondary-subtle text-secondary-emphasis border-secondary-subtle'
        };
        const label = caseSummary.badgeLabel || `${caseSummary.totalCount || 0} case(s)`;
        const title = [
            `Cases: ${caseSummary.totalCount || 0}`,
            `Active: ${caseSummary.activeCount || 0}`,
            `Urgent: ${caseSummary.urgentCount || 0}`,
            `Warning: ${caseSummary.warningCount || 0}`,
            `Info: ${caseSummary.infoCount || 0}`,
            `Resolved/closed: ${caseSummary.resolvedCount || 0}`
        ].join(' | ');
        return `<span class="badge border ms-1 ${classMap[tone] || classMap.muted}" title="${escapeHtml(title)}"><i class="bi bi-exclamation-diamond-fill me-1"></i>${escapeHtml(label)}</span>`;
    }
    function buildScheduleCoTeacherBadgesHtml(event, { inline = false } = {}) {
        if (String(event?.eventType || '').trim().toLowerCase() !== 'class_session') return '';
        if (event?.hasCoTeachers !== true) return '';
        const viewerIsCoTeacher = event.viewerIsSessionCoTeacher === true;
        const coTeacherTitle = viewerIsCoTeacher ? 'You are a co-teacher on this session' : 'Co-teacher on this session';
        const coTeacherIconClass = viewerIsCoTeacher ? 'text-primary' : 'text-secondary';
        const coTeacherIcon = `<span class="schedule-co-teacher-badge ${coTeacherIconClass}" title="${escapeHtml(coTeacherTitle)}" aria-label="${escapeHtml(coTeacherTitle)}"><i class="bi bi-people-fill" aria-hidden="true"></i></span>`;
        let paymentIcon = '';
        if (viewerIsCoTeacher) {
            const paid = event.viewerCoTeacherPaid !== false;
            const payTitle = paid ? 'Paid co-teacher' : 'Unpaid co-teacher';
            const payClass = paid ? 'text-success' : 'text-warning-emphasis';
            const payBi = paid ? 'bi-cash-coin' : 'bi-cash-stack';
            paymentIcon = `<span class="schedule-co-teacher-badge ${payClass}" title="${escapeHtml(payTitle)}" aria-label="${escapeHtml(payTitle)}"><i class="bi ${payBi}" aria-hidden="true"></i></span>`;
        }
        const layoutClass = inline ? 'schedule-co-teacher-badges schedule-co-teacher-badges--inline' : 'schedule-co-teacher-badges';
        return `<span class="${layoutClass}">${coTeacherIcon}${paymentIcon}</span>`;
    }

    function prefsHaveSavedWorkspace(prefs) {
        if (!prefs || typeof prefs !== 'object') return false;
        return Boolean(
            (Array.isArray(prefs.persons) && prefs.persons.length)
            || (prefs.startDate && prefs.endDate)
        );
    }

    function clampStagedViewPaddingWeeks(value, fallback) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(0, Math.min(MAX_STAGED_VIEW_PADDING_WEEKS, Math.floor(parsed)));
    }

    function readStagedViewPaddingFromPrefs(prefs = initialScheduleViewerPrefs) {
        const source = prefs && typeof prefs === 'object' ? prefs : {};
        return {
            paddingWeeksBefore: clampStagedViewPaddingWeeks(
                source.stagedViewPaddingWeeksBefore,
                DEFAULT_STAGED_VIEW_PADDING_WEEKS_BEFORE
            ),
            paddingWeeksAfter: clampStagedViewPaddingWeeks(
                source.stagedViewPaddingWeeksAfter,
                DEFAULT_STAGED_VIEW_PADDING_WEEKS_AFTER
            )
        };
    }

    function formatStagedViewPaddingLabel(padding = {}) {
        const before = clampStagedViewPaddingWeeks(
            padding.paddingWeeksBefore,
            DEFAULT_STAGED_VIEW_PADDING_WEEKS_BEFORE
        );
        const after = clampStagedViewPaddingWeeks(
            padding.paddingWeeksAfter,
            DEFAULT_STAGED_VIEW_PADDING_WEEKS_AFTER
        );
        return `${before} wk before · ${after} wk after`;
    }

    function getStagedViewPaddingRangeOptions(prefs = initialScheduleViewerPrefs) {
        return readStagedViewPaddingFromPrefs(prefs);
    }
    function isLeaveEvent(event) {
        const candidates = [
            event?.eventType,
            event?.targetType,
            event?.status,
            event?.role,
            event?.roleLabel
        ].map((value) => String(value || '').trim().toLowerCase());
        return candidates.some((value) => value === 'leave_request' || value === 'approved_leave' || value === 'approved_leave_snapshot' || value === 'leave');
    }
    function isReportScheduleEvent(event) {
        return String(event?.eventType || '').trim().toLowerCase() === 'report_task'
            || Boolean(String(event?.assignmentId || '').trim());
    }
    function isReadableScheduleReportTitle(value) {
        const text = String(value || '').trim();
        return Boolean(text) && !/^\d+$/.test(text);
    }
    function getScheduleReportClassLabel(event) {
        const className = String(event?.className || '').trim();
        const prefix = className.split('|')[0].trim();
        if (isReadableScheduleReportTitle(prefix)) return prefix;
        return '';
    }
    function getScheduleReportTitle(event) {
        const explicit = String(event?.reportTemplateTitle || event?.reportTitle || '').trim();
        if (isReadableScheduleReportTitle(explicit)) return explicit;
        const className = String(event?.className || '').trim();
        const match = className.match(/\|\s*Report:\s*(.+)$/i);
        if (match) {
            const candidate = String(match[1] || '').trim();
            if (isReadableScheduleReportTitle(candidate)) return candidate;
        }
        return 'Report';
    }
    function buildReportPriorityMarker(event) {
        if (!isReportScheduleEvent(event)) return '';
        const reportTitle = getScheduleReportTitle(event);
        return `<span class="report-priority-marker" role="img" aria-label="${escapeHtml(reportTitle)}" title="${escapeHtml(reportTitle)}"><i class="bi bi-stars" aria-hidden="true"></i></span>`;
    }
    function prepareEventsByDateForTimelineGrid(eventsByDate) {
        if (window.ScheduleEmbeddedReportUtils?.prepareEventsByDateForTimelineGrid) {
            return window.ScheduleEmbeddedReportUtils.prepareEventsByDateForTimelineGrid(eventsByDate);
        }
        return eventsByDate;
    }
    function buildEmbeddedReportBadgesHtml(reports) {
        const list = Array.isArray(reports) ? reports : [];
        if (!list.length) return '';
        const badges = list.map((report) => {
            const title = getScheduleReportTitle(report);
            const time = formatScheduleClockRange(report?.start, report?.end);
            const tip = time && time !== '-' ? `${title} (${time})` : title;
            const detailsUrl = String(report?.detailsUrl || '').trim();
            const inner = `<i class="bi bi-stars" aria-hidden="true"></i><span class="schedule-embedded-report-badge-label">${escapeHtml(title)}</span>`;
            if (detailsUrl) {
                return `<a class="schedule-embedded-report-badge" href="${escapeHtml(detailsUrl)}" target="_blank" rel="noopener" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">${inner}</a>`;
            }
            return `<span class="schedule-embedded-report-badge" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">${inner}</span>`;
        }).join('');
        return `<div class="schedule-embedded-reports">${badges}</div>`;
    }
    function getEmbeddedReportTooltipLine(event) {
        const reports = Array.isArray(event?.embeddedReports) ? event.embeddedReports : [];
        if (!reports.length) return '';
        return reports.map((report) => getScheduleReportTitle(report)).filter(Boolean).join(', ');
    }
    function buildScheduleEmbeddedReportsClass(event) {
        const reports = Array.isArray(event?.embeddedReports) ? event.embeddedReports : [];
        return reports.length ? ' has-embedded-reports' : '';
    }
    function getEventTitle(event) {
        const soloName = normalizeScheduleTooltipValue(event?.soloStudentName || event?.singleStudentName);
        const soloStudentId = String(event?.soloStudentId || '').trim();
        const soloPersonId = String(event?.soloStudentPersonId || '').trim();
        const readableSoloName = soloName && !isScheduleOpaqueLabel(soloName, soloStudentId, soloPersonId) ? soloName : '';
        const suppressSoloForPendingDraftEnrollment = event?.isDraft === true && stagedSessionHasPendingEnrollment(event);
        if (!suppressSoloForPendingDraftEnrollment && readableSoloName && (event?.isOneOnOneClass || event?.soloStudentId)) return readableSoloName;
        if (isReportScheduleEvent(event)) {
            const reportTitle = getScheduleReportTitle(event);
            const classLabel = getScheduleReportClassLabel(event);
            return classLabel ? `${classLabel} | ${reportTitle}` : reportTitle;
        }
        return String(event?.className || event?.title || event?.label || event?.classId || 'Schedule Item').trim();
    }

    function mapScheduleSliderToTrackStep(sliderValue) {
        const width = Math.max(SCHEDULE_MIN_DAY_WIDTH, Math.min(SCHEDULE_MAX_DAY_WIDTH, Math.round(Number(sliderValue) || SCHEDULE_DEFAULT_DAY_WIDTH)));
        const ratio = (width - SCHEDULE_MIN_DAY_WIDTH) / (SCHEDULE_MAX_DAY_WIDTH - SCHEDULE_MIN_DAY_WIDTH);
        return Math.round(72 + ratio * (132 - 72));
    }

    function readScheduleTrackStepFromSlider(widthOverride, mode = normalizedScheduleViewMode()) {
        const width = Number.isFinite(Number(widthOverride))
            ? Number(widthOverride)
            : readScheduleSliderValueForMode(mode);
        return mapScheduleSliderToTrackStep(width);
    }

    function applyHorizontalTimelineTrackLayout(container, trackStep) {
        if (!container) return false;
        const step = Math.max(60, Math.min(140, Math.round(Number(trackStep) || 76)));
        container.style.setProperty('--session-timeline-track-step', `${step}px`);
        const tracks = container.querySelectorAll('.session-cal-timeline-track');
        if (!tracks.length) return false;
        tracks.forEach((track) => {
            const blocks = track.querySelectorAll('.session-cal-positioned-horizontal');
            let maxTrackIndex = 0;
            blocks.forEach((block) => {
                const idx = Number(block.getAttribute('data-track-index'));
                const trackIndex = Number.isFinite(idx) ? idx : 0;
                maxTrackIndex = Math.max(maxTrackIndex, trackIndex);
                const blockHeight = Math.max(48, step - 8);
                block.style.top = `${(trackIndex * step) + 4}px`;
                block.style.height = `${blockHeight}px`;
                block.style.minHeight = `${blockHeight}px`;
            });
            const trackCount = Math.max(1, maxTrackIndex + 1);
            track.style.height = `${Math.max(72, trackCount * step + 12)}px`;
        });
        return true;
    }
    function getEventDetailsUrl(event) {
        return String(event?.detailsUrl || '').trim() || (
            event?.sessionId && event?.classId
                ? `/school/classes/${encodeURIComponent(event.classId)}/sessions/${encodeURIComponent(event.sessionId)}`
                : ''
        );
    }

    function shouldOpenSessionOnClick(event) {
        if (!event || event.isDraft || canDragCreateSessions) return false;
        return Boolean(getEventDetailsUrl(event));
    }

    function buildScheduleSessionBlockClickHandler(event) {
        // Non-admin session open is handled by the visualArea click listener.
        if (!shouldOpenSessionOnClick(event)) return '';
        return '';
    }
    function mergeScheduleBlockLayoutStyle(layoutStyle, scan) {
        const scd = window.ScheduleCompletionDisplay;
        if (!scd || !scan) return layoutStyle;
        const statusStyle = scd.buildScheduleBlockStyle(scan);
        return statusStyle ? `${layoutStyle};${statusStyle}` : layoutStyle;
    }

    function scheduleEventRoleClass(event) {
        if (isLeaveEvent(event)) return 'event-leave';
        const roleText = String(event?.role || event?.roleLabel || event?.roles?.[0] || '').trim().toLowerCase();
        if (roleText.includes('staff')) return 'role-staff';
        if (roleText.includes('teacher')) return 'role-teacher';
        return 'role-student';
    }
    function scheduleStatusChip(event, statusMap, scan) {
        const resolvedScan = scan || (window.ScheduleCompletionDisplay ? window.ScheduleCompletionDisplay.resolveScheduleCompletionScan(event, statusMap) : null);
        const leaveEvent = isLeaveEvent(event);
        const label = resolvedScan?.scanLabel || formatStatusLabel(event?.status);
        const normalizedLabel = String(label || '').trim().toLowerCase();
        const shortLabel = event?.hasOverlap
            ? 'Overlap'
            : (leaveEvent ? 'Leave' : (resolvedScan?.isComplete ? 'Done' : (normalizedLabel.includes('cancel') ? 'Cancel' : 'Pending')));
        const statusClass = event?.hasOverlap
            ? 'status-overlap'
            : (leaveEvent ? 'status-leave' : (resolvedScan?.isComplete ? 'status-complete' : 'status-pending'));
        const icon = event?.hasOverlap
            ? 'bi-exclamation-triangle-fill'
            : (leaveEvent ? 'bi-airplane-fill' : (resolvedScan?.isComplete ? 'bi-check-circle-fill' : 'bi-clock-history'));
        return `<span class="schedule-status-chip ${statusClass}" aria-label="${escapeHtml(label)}"><i class="bi ${escapeHtml(icon)}" aria-hidden="true"></i><span class="schedule-status-chip-label">${escapeHtml(shortLabel)}</span></span>`;
    }
    function normalizeScheduleTooltipValue(value) {
        const text = String(value ?? '').trim();
        if (!text || text === '[object Object]') return '';
        return text;
    }
    function scheduleSoloStudentHtml(event) {
        if (event?.isDraft === true && stagedSessionHasPendingEnrollment(event)) return '';
        const rawName = normalizeScheduleTooltipValue(event?.soloStudentName || event?.singleStudentName);
        const name = rawName && !isScheduleOpaqueLabel(rawName, event?.soloStudentId, event?.soloStudentPersonId) ? rawName : '';
        if (!name) return '';
        return `<div class="schedule-event-student"><i class="bi bi-person-check-fill" aria-hidden="true"></i><span>${escapeHtml(name)}</span></div>`;
    }
    function scheduleSessionSelectHtml(event) {
        if (!canSelectAnyPerson) return '';
        const key = scheduleSessionSelectionKey(event);
        if (!key) return '';
        const selectionSet = getActiveScheduleSelectionSet();
        const checked = selectionSet.has(key);
        const disabled = !checked && !canSelectScheduleSession(event);
        const icon = checked ? 'bi-check-lg' : (disabled ? 'bi-x-lg' : 'bi-plus-lg');
        const stateClass = checked ? ' is-selected' : (disabled ? ' is-disabled' : '');
        const title = checked ? 'Selected session' : (disabled ? 'Only sessions from the selected class can be selected' : 'Select session');
        return `<label class="schedule-session-select${stateClass}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"><input type="checkbox" class="form-check-input" data-schedule-session-select data-session-key="${escapeHtml(key)}" data-session-class-id="${escapeHtml(event?.classId || '')}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="schedule-session-select-icon"><i class="bi ${escapeHtml(icon)}" aria-hidden="true"></i></span></label>`;
    }
    function scheduleDraftSelectHtml(event) {
        if (!canDragCreateSessions) return '';
        if (event?.isDraft !== true && event?.isStaged !== true) return '';
        const sessionId = String(event?.sessionId || event?.id || '').trim();
        if (!sessionId) return '';
        const checked = getActiveDraftSelectionSet().has(sessionId);
        const icon = checked ? 'bi-check-lg' : 'bi-plus-lg';
        const stateClass = checked ? ' is-selected' : '';
        const title = checked ? 'Selected staged session' : 'Select staged session';
        return `<label class="schedule-session-select schedule-draft-select${stateClass}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"><input type="checkbox" class="form-check-input" data-schedule-draft-select data-draft-session-id="${escapeHtml(sessionId)}" ${checked ? 'checked' : ''}><span class="schedule-session-select-icon"><i class="bi ${escapeHtml(icon)}" aria-hidden="true"></i></span></label>`;
    }
    function buildScheduleSelectionControlHtml(event) {
        if (event?.isDraft === true || event?.isStaged === true) return scheduleDraftSelectHtml(event);
        return scheduleSessionSelectHtml(event);
    }
    function buildScheduleSessionSelectedClass(event) {
        if (event?.isDraft === true || event?.isStaged === true) {
            if (!canDragCreateSessions) return '';
            return isDraftSessionSelected(event) ? ' is-session-selected is-draft-selected' : '';
        }
        if (!canSelectAnyPerson) return '';
        const selectionKey = scheduleSessionSelectionKey(event);
        return selectionKey && getActiveScheduleSelectionSet().has(selectionKey) ? ' is-session-selected' : '';
    }
    function buildScheduleSessionUnselectableClass(event) {
        if (!canSelectAnyPerson) return '';
        if (event?.isDraft === true) return '';
        const selectionKey = scheduleSessionSelectionKey(event);
        return selectionKey && !canSelectScheduleSession(event) ? ' is-session-unselectable' : '';
    }
    function formatScheduleClockTime(timeStr) {
        if (scheduleCalendarCore?.formatClockTime) return scheduleCalendarCore.formatClockTime(timeStr);
        return String(timeStr || '').trim() || '-';
    }

    function formatScheduleClockRange(startStr, endStr) {
        if (scheduleCalendarCore?.formatClockTimeRange) return scheduleCalendarCore.formatClockTimeRange(startStr, endStr);
        const start = String(startStr || '').trim();
        const end = String(endStr || '').trim();
        if (!start && !end) return '-';
        if (!start) return end;
        if (!end) return start;
        return `${start} – ${end}`;
    }

    function formatScheduleDateLabel(dateStr) {
        const raw = normalizeScheduleTooltipValue(dateStr);
        if (!raw) return '';
        if (scheduleCalendarCore?.formatDayHeaderLong) return scheduleCalendarCore.formatDayHeaderLong(raw);
        const dateObj = new Date(raw + 'T00:00:00');
        if (Number.isNaN(dateObj.getTime())) return raw;
        return dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }

    function formatScheduleDayCardDateHtml(dateStr) {
        const raw = normalizeScheduleTooltipValue(dateStr);
        if (!raw) return '';
        const parts = scheduleCalendarCore?.formatDayHeaderParts
            ? scheduleCalendarCore.formatDayHeaderParts(raw)
            : null;
        if (!parts || !parts.weekdayLong) {
            return escapeHtml(formatScheduleDateLabel(raw));
        }
        return `
            <span class="schedule-day-card-date">
                <span class="schedule-day-card-weekday">${escapeHtml(parts.weekdayLong)}</span>
                <span class="schedule-day-card-date-line">${escapeHtml(parts.monthShort)} ${escapeHtml(parts.dayNum)}, ${escapeHtml(parts.year)}</span>
            </span>
        `;
    }
    function buildScheduleEventTooltip(event, statusMap, scan) {
        const detailParts = [];
        const addDetail = (label, value) => {
            const cleaned = normalizeScheduleTooltipValue(value);
            if (cleaned) detailParts.push(`${label}: ${cleaned}`);
        };
        const role = isLeaveEvent(event) ? 'Approved Leave' : (event?.roleLabel || event?.role || event?.roles?.[0] || '');
        const time = formatScheduleClockRange(event?.start, event?.end);
        const caseSummary = event?.caseSummary && typeof event.caseSummary === 'object'
            ? [
                event.caseSummary.hasCases === true ? 'Has cases' : '',
                event.caseSummary.openCount != null ? `Open: ${event.caseSummary.openCount}` : '',
                event.caseSummary.totalCount != null ? `Total: ${event.caseSummary.totalCount}` : ''
            ].filter(Boolean).join(' | ')
            : '';
        const isActivityEvent = String(event?.eventType || '').trim() === 'school_activity'
            || String(event?.targetType || '').trim() === 'activity';
        const hoursValue = isActivityEvent
            ? Number(event?.paidHours ?? event?.duration ?? 0)
            : Number(event?.duration ?? 0);
        if (isReportScheduleEvent(event)) {
            addDetail('Report', getScheduleReportTitle(event));
            const classLabel = getScheduleReportClassLabel(event);
            if (classLabel) addDetail('Class', classLabel);
        } else {
            addDetail('Session', getEventTitle(event));
            const embeddedReports = getEmbeddedReportTooltipLine(event);
            if (embeddedReports) addDetail('Reports', embeddedReports);
        }
        addDetail('Date', formatScheduleDateLabel(event?.date));
        addDetail('Time', time);
        if (Number.isFinite(hoursValue) && hoursValue > 0) {
            addDetail(isActivityEvent ? 'Paid hours' : 'Duration', `${hoursValue.toFixed(2)} h`);
        }
        addDetail('Status', scan?.scanLabel || formatStatusLabel(event?.status));
        addDetail('Role', role);
        addDetail('Person', event?.personName || event?.teacherName || event?.studentName);
        addDetail('Student', event?.soloStudentName || event?.singleStudentName);
        addDetail('Room', event?.room || event?.roomName || event?.location);
        addDetail('Cases', caseSummary);
        if (event?.hasOverlap) addDetail('Conflict', 'Overlaps another scheduled item');
        if (window.ScheduleCompletionDisplay && window.ScheduleCompletionDisplay.isMakeupRequiredDisplayEvent(event)) {
            addDetail('Make-up', window.ScheduleCompletionDisplay.MAKEUP_DISPLAY_TEXT);
        }
        if (event?.hasCoTeachers === true) {
            addDetail('Co-teachers', 'Yes');
            if (event.viewerIsSessionCoTeacher === true) {
                addDetail('Your co-teacher pay', event.viewerCoTeacherPaid !== false ? 'Paid' : 'Unpaid');
            }
        }
        return detailParts.join('\n');
    }
    function scheduleStatusTipStyle(event, statusMap) {
        if (isLeaveEvent(event)) return { bg: '#ffd43b', fg: '#4d3200', border: '#f59f00' };
        const meta = statusMap.get(normalizeSessionStatus(event?.status));
        return {
            bg: String(meta?.colorBg || '#0f172a').trim() || '#0f172a',
            fg: String(meta?.colorText || '#ffffff').trim() || '#ffffff',
            border: String(meta?.colorBorder || meta?.colorBg || '#0f172a').trim() || '#0f172a'
        };
    }
    function getEventCategoryLabels(event) {
        if (Array.isArray(event?.hourCategoryLabels) && event.hourCategoryLabels.length) {
            return event.hourCategoryLabels;
        }
        if (isLeaveEvent(event)) return ['Approved Leave'];

        const schoolRoles = new Set();
        const roleSources = [
            ...(Array.isArray(event?.roles) ? event.roles : []),
            event?.role,
            event?.roleLabel
        ];
        roleSources.forEach((value) => {
            String(value || '')
                .split('/')
                .map((part) => part.trim())
                .filter(Boolean)
                .forEach((part) => {
                    const normalized = String(part || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
                    const label = normalized === 'teacher' || normalized.includes('school_teacher')
                        ? 'Teacher'
                        : (normalized === 'student' || normalized.includes('school_student')
                            ? 'Student'
                            : (normalized === 'staff' || normalized.includes('school_staff') ? 'Staff' : ''));
                    if (label) schoolRoles.add(label);
                });
        });
        if (schoolRoles.size) return [...schoolRoles];

        const labels = [];
        [event?.roleLabel, event?.role].forEach((role) => {
            String(role || '')
                .split('/')
                .map((part) => part.trim())
                .filter(Boolean)
                .forEach((label) => {
                    if (label && !labels.includes(label)) labels.push(label);
                });
        });
        return labels.length ? labels : ['Schedule'];
    }
    function renderCategoryHourTotals(events) {
        const totals = new Map();
        (Array.isArray(events) ? events : []).forEach((event) => {
            if (event?.countsTowardHours === false) return;
            const duration = Number(event?.duration || 0);
            if (!Number.isFinite(duration) || duration <= 0) return;
            getEventCategoryLabels(event).forEach((label) => {
                totals.set(label, (totals.get(label) || 0) + duration);
            });
        });
        if (!totals.size) return '';
        const getCategoryClass = (label) => {
            const normalized = String(label || '').trim().toLowerCase();
            if (normalized.includes('leave')) return 'hours-category-leave';
            if (normalized.includes('teacher')) return 'hours-category-teacher';
            if (normalized.includes('student')) return 'hours-category-student';
            if (normalized.includes('staff')) return 'hours-category-staff';
            return 'hours-category-default';
        };
        return Array.from(totals.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([label, hours]) => `
                <span class="schedule-hours-chip ${getCategoryClass(label)}">
                    <span class="schedule-hours-dot"></span>
                    <span>${escapeHtml(label)}: ${hours.toFixed(2)} h</span>
                </span>
            `)
            .join(' ');
    }
    function resolvePersonPickerName(item) {
        const preferred = String(item?.preferredName || item?.name?.preferred || '').trim();
        if (preferred) return preferred;
        const nameValue = item?.displayName || item?.fullName || item?.label || item?.name || '';
        if (nameValue && typeof nameValue === 'object') {
            const objectName = `${nameValue.first || ''} ${nameValue.middle || ''} ${nameValue.last || ''}`.replace(/\s+/g, ' ').trim();
            if (objectName) return objectName;
        }
        const direct = String(nameValue || '').trim();
        if (direct && direct !== '[object Object]') return direct;
        const fromParts = `${item?.firstName || ''} ${item?.middleName || ''} ${item?.lastName || ''}`.replace(/\s+/g, ' ').trim();
        return fromParts || String(item?.personId || item?.id || '').trim();
    }
    function updateAdminRoleOptions(availableRoles, selectedRole) {
        if (!canSelectAnyPerson) return;
        const roleEl = document.getElementById('sch_role');
        if (!roleEl) return;
        const currentValue = String(selectedRole || roleEl.value || '').trim();
        const roles = Array.isArray(availableRoles) ? availableRoles : [];
        roleEl.innerHTML = '<option value="">All Roles</option>';
        roles.forEach((role) => {
            const key = String(role?.key || '').trim();
            if (!key) return;
            const option = document.createElement('option');
            option.value = key;
            option.textContent = role?.label || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            roleEl.appendChild(option);
        });
        if (currentValue && Array.from(roleEl.options).some((option) => option.value === currentValue)) {
            roleEl.value = currentValue;
        } else {
            roleEl.value = '';
        }
        roleEl.disabled = false;
    }

    function buildLifecycleInline(event) {
        const lifecycle = event?.classLifecycle || {};
        const mode = String(lifecycle.registrationMode || 'term_based').trim().toLowerCase() === 'rolling' ? 'rolling' : 'term_based';
        if (mode !== 'rolling') return '<span class="badge bg-light text-dark border">Term-Based</span>';
        const cycleNo = Number.isFinite(Number(lifecycle.cycleNo)) && Number(lifecycle.cycleNo) > 0 ? Number(lifecycle.cycleNo) : 1;
        const range = `${String(lifecycle.cycleStartDate || '').trim() || '?'} -> ${String(lifecycle.cycleEndDate || '').trim() || 'Open'}`;
        const closed = lifecycle.isClosedForNewEnrollment
            ? '<span class="badge bg-danger-subtle text-danger border border-danger-subtle ms-1">Closed Enrollment</span>'
            : '';
        return ''
            + '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle me-1">Rolling</span>'
            + '<span class="badge bg-light text-dark border me-1">Cycle #' + escapeHtml(cycleNo) + '</span>'
            + closed
            + '<span class="small text-muted ms-1">Cycle Window: ' + escapeHtml(range) + '</span>';
    }

    // --- Modal-friendly messaging helpers ---
    function inferScheduleAlertIcon(message = '', title = '', options = {}) {
        const explicit = String(options.icon || options.type || '').trim();
        if (explicit) return explicit;
        const titleLower = String(title || '').toLowerCase();
        const messageLower = String(message || '').toLowerCase();
        const combined = `${titleLower} ${messageLower}`;
        if (/fail|error|unable to|popup blocked/.test(combined)) return 'error';
        if (/saved|deleted|success/.test(titleLower)) return 'success';
        if (/conflict|warning|blocked|nothing saved|overlap|cannot/.test(combined)) return 'warning';
        return 'info';
    }

    const uiAlert = async (message, title = 'Notice', options = {}) => {
        const icon = inferScheduleAlertIcon(message, title, options);
        const html = options.html === true || (/<[^>]+>/.test(String(message || '')) && options.html !== false);
        const okClassByIcon = {
            error: 'btn-danger',
            warning: 'btn-warning',
            success: 'btn-success',
            info: 'btn-primary'
        };
        const okClass = String(options.okClass || okClassByIcon[icon] || 'btn-primary').trim();
        const body = html ? String(message || '') : escapeHtml(String(message || ''));
        if (typeof window.showMessageModal === 'function') {
            await window.showMessageModal({
                title,
                message: body,
                icon,
                size: options.size || 'md',
                buttons: [{ text: options.okText || 'OK', class: okClass }]
            });
            return;
        }
        console.error('showMessageModal is not available on Master Schedule.');
        const plain = String(message || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (typeof window.alert === 'function') window.alert(plain || title);
    };

    const uiConfirm = async (message, title = 'Confirm', options = {}) => {
        const icon = String(options.icon || 'warning').trim() || 'warning';
        const cancelText = String(options.cancelText || options.noText || 'No').trim() || 'No';
        const confirmText = String(options.confirmText || options.yesText || 'Yes').trim() || 'Yes';
        const cancelClass = String(options.cancelClass || 'btn-secondary btn-md').trim();
        const confirmClass = String(options.confirmClass || (icon === 'warning' ? 'btn-warning btn-md' : 'btn-primary btn-md')).trim();
        const body = options.html === true ? String(message || '') : escapeHtml(String(message || ''));
        if (typeof window.showMessageModal === 'function') {
            const res = await window.showMessageModal({
                title,
                icon,
                message: body,
                size: options.size || 'md',
                buttons: [
                    { text: cancelText, class: cancelClass },
                    { text: confirmText, class: confirmClass }
                ]
            });
            return res === confirmText;
        }
        console.error('showMessageModal is not available on Master Schedule.');
        return false;
    };

    async function confirmDiscardPendingDraftsIfNeeded(actionLabel = 'Reload the schedule') {
        if (countAllPendingDraftSessions() <= 0) return true;
        return await uiConfirm(
            `You have staged sessions that are not saved to class schedules. ${actionLabel} anyway? Staged sessions will stay in this browser until you save or delete them.`,
            'Unsaved staged sessions',
            {
                icon: 'warning',
                cancelText: 'Stay',
                confirmText: 'Continue',
                confirmClass: 'btn-warning btn-md'
            }
        );
    }

    const SCHEDULE_DAY_WIDTH_STORAGE_KEY = 'schoolMasterViewer.scheduleDayWidth';
    const SCHEDULE_VERTICAL_DAY_WIDTH_KEY = 'schoolMasterViewer.scheduleVerticalDayWidth';
    const SCHEDULE_HORIZONTAL_SLIDER_KEY = 'schoolMasterViewer.scheduleHorizontalSliderWidth';
    const SCHEDULE_DAY_WIDTH_USER_KEY = 'schoolMasterViewer.scheduleDayWidthUserAdjusted';
    const SCHEDULE_VERTICAL_DAY_WIDTH_USER_KEY = 'schoolMasterViewer.scheduleVerticalDayWidthUserAdjusted';
    const SCHEDULE_HORIZONTAL_SLIDER_USER_KEY = 'schoolMasterViewer.scheduleHorizontalSliderUserAdjusted';
    const SCHEDULE_HIDE_EMPTY_DAYS_KEY = 'schoolMasterViewer.scheduleHideEmptyDays';
    const SCHEDULE_VIEW_MODE_STORAGE_KEY = 'schoolMasterViewer.scheduleViewMode';
    const SCHEDULE_WEEK_TIMELINE_OVERRIDES_KEY = 'schoolMasterViewer.weekTimelineOverrides';
    const SCHEDULE_DEFAULT_TIMELINE_START_HOUR = 7;
    const SCHEDULE_DEFAULT_TIMELINE_END_HOUR = 22;
    const SCHEDULE_DEFAULT_DAY_WIDTH = 320;
    const SCHEDULE_MIN_DAY_WIDTH = 72;
    const SCHEDULE_MAX_DAY_WIDTH = 520;
    const SCHEDULE_DEFAULT_HOUR_SLOTS = SCHEDULE_DEFAULT_TIMELINE_END_HOUR - SCHEDULE_DEFAULT_TIMELINE_START_HOUR;
    const SCHEDULE_GRID_MIN_HEIGHT = 680;
    const SCHEDULE_GRID_SINGLE_WEEK_MAX = 1280;
    const SCHEDULE_GRID_WEEK_OVERHEAD = 112;
    const SCHEDULE_GRID_TARGET_HOUR_HEIGHT = 48;
    const SCHEDULE_GRID_PER_WEEK_HEIGHT = SCHEDULE_GRID_WEEK_OVERHEAD + (SCHEDULE_DEFAULT_HOUR_SLOTS * SCHEDULE_GRID_TARGET_HOUR_HEIGHT);
    let scheduleGridResizeObserver = null;

    function readTimelinePresetFromPrefs(prefs = {}) {
        const core = scheduleCalendarCore;
        if (core?.resolveTimelineBounds) {
            return core.resolveTimelineBounds({
                timelineStartHour: prefs?.timelineStartHour,
                timelineEndHour: prefs?.timelineEndHour
            });
        }
        return {
            startHour: SCHEDULE_DEFAULT_TIMELINE_START_HOUR,
            endHour: SCHEDULE_DEFAULT_TIMELINE_END_HOUR,
            slotCount: SCHEDULE_DEFAULT_HOUR_SLOTS,
            totalMinutes: SCHEDULE_DEFAULT_HOUR_SLOTS * 60
        };
    }

    function readWeekTimelineOverrides() {
        try {
            if (!window.localStorage) return {};
            const raw = window.localStorage.getItem(SCHEDULE_WEEK_TIMELINE_OVERRIDES_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
            return parsed;
        } catch (error) {
            return {};
        }
    }

    function saveWeekTimelineOverrides(overrides = {}) {
        try {
            if (!window.localStorage) return;
            const keys = Object.keys(overrides || {});
            if (!keys.length) {
                window.localStorage.removeItem(SCHEDULE_WEEK_TIMELINE_OVERRIDES_KEY);
                return;
            }
            window.localStorage.setItem(SCHEDULE_WEEK_TIMELINE_OVERRIDES_KEY, JSON.stringify(overrides));
        } catch (error) { /* storage can be unavailable */ }
    }

    function getScheduleTimelinePresetBounds() {
        return scheduleState.timelinePreset || readTimelinePresetFromPrefs(initialScheduleViewerPrefs);
    }

    function getScheduleHourSlotsForBounds(bounds = {}) {
        const resolved = scheduleCalendarCore?.resolveTimelineBounds
            ? scheduleCalendarCore.resolveTimelineBounds(bounds)
            : getScheduleTimelinePresetBounds();
        return Math.max(2, Number(resolved.slotCount || SCHEDULE_DEFAULT_HOUR_SLOTS));
    }

    function getScheduleMaxHourSlotsForLayout() {
        const preset = getScheduleTimelinePresetBounds();
        let maxSlots = getScheduleHourSlotsForBounds(preset);
        const overrides = scheduleState.weekTimelineOverrides || {};
        Object.values(overrides).forEach((entry) => {
            maxSlots = Math.max(maxSlots, getScheduleHourSlotsForBounds(entry));
        });
        return maxSlots;
    }

    function timelineHourToTimeInputValue(hour) {
        const h = Math.max(0, Math.min(23, Math.floor(Number(hour) || 0)));
        return `${String(h).padStart(2, '0')}:00`;
    }

    function parseTimelineTimeInputValue(value) {
        const raw = String(value || '').trim();
        const match = raw.match(/^(\d{1,2}):(\d{2})$/);
        if (!match) return null;
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;
        return hour + (minute >= 30 ? 1 : 0);
    }

    function formatScheduleTimelinePresetLabel(bounds = {}) {
        const resolved = scheduleCalendarCore?.resolveTimelineBounds
            ? scheduleCalendarCore.resolveTimelineBounds(bounds)
            : getScheduleTimelinePresetBounds();
        const startLabel = scheduleCalendarCore?.formatClockTime
            ? scheduleCalendarCore.formatClockTime(timelineHourToTimeInputValue(resolved.startHour))
            : `${resolved.startHour}:00`;
        const endLabel = scheduleCalendarCore?.formatClockTime
            ? scheduleCalendarCore.formatClockTime(timelineHourToTimeInputValue(resolved.endHour))
            : `${resolved.endHour}:00`;
        return `${startLabel} – ${endLabel}`;
    }

    function collectWeekScheduleEvents(weekDays, eventsByDate) {
        const events = [];
        (Array.isArray(weekDays) ? weekDays : []).forEach((day) => {
            if (!day?.inRange) return;
            const dayEvents = eventsByDate?.[day.date] || [];
            dayEvents.forEach((ev) => events.push(ev));
        });
        return events;
    }

    function resolveScheduleWeekTimelineBounds(weekStart, weekDays, eventsByDate) {
        const override = scheduleState.weekTimelineOverrides?.[weekStart];
        if (override && scheduleCalendarCore?.resolveTimelineBounds) {
            return scheduleCalendarCore.resolveTimelineBounds(override);
        }
        return getScheduleTimelinePresetBounds();
    }

    function buildScheduleWeekTimelineActionHtml(weekStart, weekDays, eventsByDate, effectiveBounds) {
        const preset = getScheduleTimelinePresetBounds();
        const hasOverride = Boolean(scheduleState.weekTimelineOverrides?.[weekStart]);
        if (hasOverride) {
            return `<button type="button" class="btn btn-sm btn-outline-secondary schedule-week-time-btn" data-schedule-week-reset-time data-week-start="${escapeHtml(weekStart)}" title="Use preset display hours for this week" aria-label="Use preset display hours for this week">Use preset hours</button>`;
        }
        const weekEvents = collectWeekScheduleEvents(weekDays, eventsByDate);
        const outside = scheduleCalendarCore?.sessionsOutsideTimelineBounds
            ? scheduleCalendarCore.sessionsOutsideTimelineBounds(weekEvents, effectiveBounds || preset)
            : false;
        if (!outside) return '';
        return `<button type="button" class="btn btn-sm btn-outline-primary schedule-week-time-btn" data-schedule-week-expand-time data-week-start="${escapeHtml(weekStart)}" title="Expand display hours for this week" aria-label="Expand display hours for this week"><i class="bi bi-arrows-expand" aria-hidden="true"></i> Expand hours</button>`;
    }

    function pruneScheduleWeekTimelineOverrides() {
        const preset = getScheduleTimelinePresetBounds();
        const next = { ...(scheduleState.weekTimelineOverrides || {}) };
        let changed = false;
        Object.keys(next).forEach((weekStart) => {
            const entry = next[weekStart];
            if (!entry) {
                delete next[weekStart];
                changed = true;
                return;
            }
            const resolved = scheduleCalendarCore?.resolveTimelineBounds
                ? scheduleCalendarCore.resolveTimelineBounds(entry)
                : null;
            if (!resolved) {
                delete next[weekStart];
                changed = true;
                return;
            }
            if (resolved.startHour <= preset.startHour && resolved.endHour >= preset.endHour) {
                delete next[weekStart];
                changed = true;
            }
        });
        if (changed) {
            scheduleState.weekTimelineOverrides = next;
            saveWeekTimelineOverrides(next);
        }
    }

    function expandScheduleWeekTimelineOverride(weekStart) {
        const person = activeSchedulePerson();
        if (!person) return;
        const grouped = groupEventsByDate(getScheduleEventsForPerson(person.id));
        const range = getScheduleRange();
        const viewRange = {
            startDate: range.startDate,
            endDate: range.endDate,
            preset: 'custom',
            anchorDate: range.startDate
        };
        const weekBlocks = scheduleCalendarCore?.buildWeekBlocks
            ? scheduleCalendarCore.buildWeekBlocks(viewRange)
            : [];
        const week = weekBlocks.find((block) => block.weekStart === weekStart);
        if (!week) return;
        const weekEvents = collectWeekScheduleEvents(week.days, grouped);
        const preset = getScheduleTimelinePresetBounds();
        const expanded = scheduleCalendarCore?.expandTimelineBoundsToFitSessions
            ? scheduleCalendarCore.expandTimelineBoundsToFitSessions(preset, weekEvents, 0)
            : preset;
        if (expanded.startHour <= preset.startHour && expanded.endHour >= preset.endHour) return;
        scheduleState.weekTimelineOverrides = {
            ...(scheduleState.weekTimelineOverrides || {}),
            [weekStart]: {
                timelineStartHour: expanded.startHour,
                timelineEndHour: expanded.endHour
            }
        };
        saveWeekTimelineOverrides(scheduleState.weekTimelineOverrides);
        refreshScheduleActiveView();
    }

    function resetScheduleWeekTimelineOverride(weekStart) {
        const next = { ...(scheduleState.weekTimelineOverrides || {}) };
        if (!next[weekStart]) return;
        delete next[weekStart];
        scheduleState.weekTimelineOverrides = next;
        saveWeekTimelineOverrides(next);
        refreshScheduleActiveView();
    }

    function applyScheduleTimelinePreset(startHour, endHour) {
        const bounds = scheduleCalendarCore?.resolveTimelineBounds
            ? scheduleCalendarCore.resolveTimelineBounds({ timelineStartHour: startHour, timelineEndHour: endHour })
            : readTimelinePresetFromPrefs({ timelineStartHour: startHour, timelineEndHour: endHour });
        scheduleState.timelinePreset = bounds;
        void persistScheduleViewerPreferencesPartial({
            timelineStartHour: bounds.startHour,
            timelineEndHour: bounds.endHour
        }, { silent: true });
        pruneScheduleWeekTimelineOverrides();
        refreshScheduleActiveView();
    }

    function isScheduleOpaqueLabel(label, ...candidateIds) {
        const cleaned = String(label || '').trim();
        if (!cleaned) return true;
        if (/^[0-9]+$/.test(cleaned)) return true;
        return candidateIds.some((id) => {
            const candidate = String(id || '').trim();
            return candidate && cleaned === candidate;
        });
    }

    function readScheduleViewMode() {
        try {
            const stored = window.localStorage ? String(window.localStorage.getItem(SCHEDULE_VIEW_MODE_STORAGE_KEY) || '').trim() : '';
            if (stored === 'calendar' || stored === 'timeline' || stored === 'verticalTimeline') return stored;
        } catch (error) { /* storage can be unavailable */ }
        return 'verticalTimeline';
    }

    function resolveScheduleViewMode(mode = 'verticalTimeline') {
        if (mode === 'calendar' || mode === 'timeline' || mode === 'verticalTimeline') return mode;
        return 'verticalTimeline';
    }

    const scheduleState = {
        persons: [],
        activePersonId: '',
        eventsByPersonId: {},
        draftEventsByPersonId: {},
        draftBatchesByPersonId: {},
        statusMetaByPersonId: {},
        errorByPersonId: {},
        loadedPersonIds: new Set(),
        loadingPersonId: '',
        selectedSessionKeysByPersonId: {},
        selectedDraftSessionIdsByPersonId: {},
        pendingEnrollStudentsByClassId: {},
        pendingEnrollMetaByClassId: {},
        lastLoadedAtByPersonId: {},
        scheduleFingerprintByPersonId: {},
        staleAfterHidden: false,
        schedulePollTimerId: null,
        schedulePollIntervalMs: 60000,
        schedulePollInFlight: false,
        remoteUpdatePending: false,
        remoteUpdateFingerprint: '',
        remoteUpdateModalDismissed: false,
        remoteUpdateModalOpen: false,
        localMutationGraceUntil: 0,
        focusStagedSessionOnNextLayout: false,
        pendingStagedScrollDate: '',
        viewMode: readScheduleViewMode(),
        hideEmptyDays: false,
        isAdminViewer: canSelectAnyPerson,
        canDragCreateSessions,
        verticalDayWidthUserAdjusted: false,
        horizontalSliderUserAdjusted: false,
        suppressGridClick: false,
        autoChangeDetectorEnabled: readScheduleAutoChangeDetector(),
        serverWorkspaceSaved: prefsHaveSavedWorkspace(initialScheduleViewerPrefs),
        suppressWorkspaceAutoPersist: 0,
        timelinePreset: readTimelinePresetFromPrefs(initialScheduleViewerPrefs),
        weekTimelineOverrides: readWeekTimelineOverrides(),
        holidayDateSet: new Set(),
        holidayRangeKey: '',
        activeClasses: [],
        activeClassesByPersonId: {},
        activeClassFilterId: ''
    };

    let scheduleHolidayFetchToken = 0;

    function scheduleHolidayRangeKey(startDate, endDate) {
        const start = scheduleCalendarCore?.normalizeDateOnly?.(startDate) || String(startDate || '').trim();
        const end = scheduleCalendarCore?.normalizeDateOnly?.(endDate) || String(endDate || '').trim();
        return start && end ? `${start}|${end}` : '';
    }

    function getScheduleHolidayDatesForRender() {
        const set = scheduleState.holidayDateSet;
        return set && set.size ? set : null;
    }

    function isScheduleHolidayDate(dateStr) {
        const date = scheduleCalendarCore?.normalizeDateOnly?.(dateStr) || String(dateStr || '').trim();
        if (!date || !scheduleState.holidayDateSet?.size) return false;
        return scheduleState.holidayDateSet.has(date);
    }

    async function fetchScheduleHolidayDatesForRange(startDate, endDate) {
        const collector = window.SessionEnrollmentCalendarModal?.collectHolidayDatesForRange;
        if (typeof collector === 'function') {
            return collector(startDate, endDate);
        }
        const start = scheduleCalendarCore?.normalizeDateOnly?.(startDate) || String(startDate || '').trim();
        const end = scheduleCalendarCore?.normalizeDateOnly?.(endDate) || String(endDate || '').trim();
        if (!start || !end) return [];
        try {
            const resp = await fetch(
                `/school/schedules/api/holiday-dates?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
                { headers: { Accept: 'application/json', 'X-AJAX-Request': 'true' }, credentials: 'same-origin' }
            );
            const data = await resp.json().catch(() => ({}));
            const holidays = Array.isArray(data?.holidays) ? data.holidays : [];
            return holidays
                .map((row) => scheduleCalendarCore?.normalizeDateOnly?.(row?.date) || String(row?.date || '').trim())
                .filter(Boolean);
        } catch (err) {
            console.warn('Schedule viewer holiday lookup failed', err);
            return [];
        }
    }

    async function syncScheduleHolidayDates() {
        const range = getScheduleRange();
        const key = scheduleHolidayRangeKey(range.startDate, range.endDate);
        if (!key) {
            scheduleState.holidayDateSet = new Set();
            scheduleState.holidayRangeKey = '';
            return;
        }
        const cached = scheduleState.holidayDateSet;
        if (key === scheduleState.holidayRangeKey && cached && cached.size > 0) return;
        const token = ++scheduleHolidayFetchToken;
        const dates = await fetchScheduleHolidayDatesForRange(range.startDate, range.endDate);
        if (token !== scheduleHolidayFetchToken) return;
        scheduleState.holidayRangeKey = key;
        scheduleState.holidayDateSet = new Set((Array.isArray(dates) ? dates : []).filter(Boolean));
    }

    function refreshScheduleViewWithHolidays() {
        void syncScheduleHolidayDates().then(() => refreshScheduleActiveView());
    }

    function readScheduleAutoChangeDetector() {
        if (typeof initialScheduleViewerPrefs?.autoChangeDetector === 'boolean') {
            return initialScheduleViewerPrefs.autoChangeDetector;
        }
        return true;
    }

    let scheduleViewerPrefsSaveTimer = null;

    async function persistScheduleViewerPreferencesPartial(partial = {}, options = {}) {
        const silent = options.silent === true;
        try {
            const res = await fetch(SCHEDULE_VIEWER_PREFS_API, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-AJAX-Request': 'true',
                    Accept: 'application/json'
                },
                credentials: 'same-origin',
                body: JSON.stringify(partial)
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || result.status !== 'success') {
                if (!silent) throw new Error(result.message || 'Unable to save preferences.');
                return false;
            }
            if (initialScheduleViewerPrefs && typeof initialScheduleViewerPrefs === 'object' && partial && typeof partial === 'object') {
                Object.assign(initialScheduleViewerPrefs, partial);
            }
            if (partial.timelineStartHour != null || partial.timelineEndHour != null) {
                scheduleState.timelinePreset = readTimelinePresetFromPrefs({
                    ...(initialScheduleViewerPrefs || {}),
                    ...partial
                });
            }
            return true;
        } catch (error) {
            if (!silent) {
                await uiAlert(error.message || 'Unable to save preferences.', 'Schedule', { icon: 'error' });
            }
            return false;
        }
    }

    function applyScheduleAutoChangeDetector(enabled, options = {}) {
        scheduleState.autoChangeDetectorEnabled = enabled === true;
        if (options.persist === true) {
            if (scheduleState.serverWorkspaceSaved === true) {
                queueScheduleWorkspaceAutoPersist();
                return;
            }
            if (scheduleViewerPrefsSaveTimer) window.clearTimeout(scheduleViewerPrefsSaveTimer);
            scheduleViewerPrefsSaveTimer = window.setTimeout(() => {
                void persistScheduleViewerPreferencesPartial({ autoChangeDetector: enabled === true }, { silent: true });
            }, 250);
        }
    }

    function saveScheduleAutoChangeDetector(enabled) {
        applyScheduleAutoChangeDetector(enabled, { persist: true });
    }

    function migrateScheduleAutoChangeDetectorFromLocalStorage() {
        try {
            if (!window.localStorage) return;
            const legacyKey = 'schoolMasterViewer.scheduleAutoChangeDetector';
            const stored = window.localStorage.getItem(legacyKey);
            if (stored === null) return;
            if (typeof initialScheduleViewerPrefs?.autoChangeDetector !== 'boolean') {
                void persistScheduleViewerPreferencesPartial({ autoChangeDetector: stored !== '0' }, { silent: true });
            }
            window.localStorage.removeItem(legacyKey);
        } catch (error) { /* storage can be unavailable */ }
    }

    function isScheduleAutoChangeDetectorEnabled() {
        return scheduleState.autoChangeDetectorEnabled !== false;
    }

    function countAllPendingDraftSessions() {
        return Object.values(scheduleState.draftEventsByPersonId || {})
            .reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
    }

    async function fetchWithScheduleTimeout(url, options = {}, timeoutMs = SCHEDULE_COMMIT_TIMEOUT_MS) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, { ...options, signal: controller.signal });
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw new Error('Save timed out. The server took too long to respond. Your staged sessions were kept — try again.');
            }
            throw error;
        } finally {
            window.clearTimeout(timeoutId);
        }
    }

    function persistScheduleDraftBackup() {
        if (!canDragCreateSessions || !window.localStorage) return;
        try {
            const hasDrafts = countAllPendingDraftSessions() > 0
                || Object.values(scheduleState.draftBatchesByPersonId || {}).some((rows) => Array.isArray(rows) && rows.length)
                || Object.values(scheduleState.pendingEnrollStudentsByClassId || {}).some((rows) => Array.isArray(rows) && rows.length);
            if (!hasDrafts) {
                window.localStorage.removeItem(SCHEDULE_DRAFT_BACKUP_KEY);
                return;
            }
            window.localStorage.setItem(SCHEDULE_DRAFT_BACKUP_KEY, JSON.stringify({
                draftEventsByPersonId: scheduleState.draftEventsByPersonId || {},
                draftBatchesByPersonId: scheduleState.draftBatchesByPersonId || {},
                pendingEnrollStudentsByClassId: scheduleState.pendingEnrollStudentsByClassId || {},
                pendingEnrollMetaByClassId: scheduleState.pendingEnrollMetaByClassId || {},
                savedAt: new Date().toISOString()
            }));
        } catch (_) { /* storage unavailable */ }
    }

    let scheduleDraftBackupTimer = null;
    function schedulePersistDraftBackup() {
        if (!canDragCreateSessions) return;
        if (scheduleDraftBackupTimer) window.clearTimeout(scheduleDraftBackupTimer);
        scheduleDraftBackupTimer = window.setTimeout(() => {
            scheduleDraftBackupTimer = null;
            persistScheduleDraftBackup();
        }, 300);
    }

    function clearScheduleDraftBackup() {
        try {
            if (window.localStorage) window.localStorage.removeItem(SCHEDULE_DRAFT_BACKUP_KEY);
        } catch (_) { /* storage unavailable */ }
    }

    function restoreScheduleDraftBackup() {
        if (!canDragCreateSessions || !window.localStorage) return;
        try {
            const raw = window.localStorage.getItem(SCHEDULE_DRAFT_BACKUP_KEY);
            if (!raw) return;
            const payload = JSON.parse(raw);
            if (!payload || typeof payload !== 'object') return;
            Object.entries(payload.draftEventsByPersonId || {}).forEach(([personId, rows]) => {
                if (!Array.isArray(rows) || !rows.length) return;
                const existing = Array.isArray(scheduleState.draftEventsByPersonId[personId])
                    ? scheduleState.draftEventsByPersonId[personId]
                    : [];
                if (existing.length) return;
                scheduleState.draftEventsByPersonId[personId] = rows;
            });
            Object.entries(payload.draftBatchesByPersonId || {}).forEach(([personId, rows]) => {
                if (!Array.isArray(rows) || !rows.length) return;
                if (Array.isArray(scheduleState.draftBatchesByPersonId[personId]) && scheduleState.draftBatchesByPersonId[personId].length) return;
                scheduleState.draftBatchesByPersonId[personId] = rows;
            });
            if (!Object.keys(scheduleState.pendingEnrollStudentsByClassId || {}).length) {
                scheduleState.pendingEnrollStudentsByClassId = payload.pendingEnrollStudentsByClassId && typeof payload.pendingEnrollStudentsByClassId === 'object'
                    ? payload.pendingEnrollStudentsByClassId
                    : {};
            }
            if (!Object.keys(scheduleState.pendingEnrollMetaByClassId || {}).length) {
                scheduleState.pendingEnrollMetaByClassId = payload.pendingEnrollMetaByClassId && typeof payload.pendingEnrollMetaByClassId === 'object'
                    ? payload.pendingEnrollMetaByClassId
                    : {};
            }
            stripAllDraftSessionSoloDisplayForPendingEnrollments();
        } catch (_) { /* storage unavailable */ }
    }

    function bindScheduleDraftUnloadGuard() {
        // Draft safety uses localStorage backup/restore; in-app actions use uiConfirm modals.
    }

    function getScheduleEventsForPerson(personId) {
        const base = Array.isArray(scheduleState.eventsByPersonId[personId]) ? scheduleState.eventsByPersonId[personId] : [];
        const drafts = Array.isArray(scheduleState.draftEventsByPersonId?.[personId]) ? scheduleState.draftEventsByPersonId[personId] : [];
        if (!drafts.length) return base;
        const withoutDrafts = base.filter((ev) => ev?.isDraft !== true);
        return [...withoutDrafts, ...drafts];
    }

    function activePersonHasDraftStagedSessions() {
        const person = activeSchedulePerson();
        const drafts = scheduleState.draftEventsByPersonId?.[person?.id];
        return Array.isArray(drafts) && drafts.some((ev) => ev?.isDraft === true);
    }

    function getFirstDraftStagedSessionDate(personId) {
        const drafts = Array.isArray(scheduleState.draftEventsByPersonId?.[personId])
            ? scheduleState.draftEventsByPersonId[personId]
            : [];
        const dates = drafts
            .filter((ev) => ev?.isDraft === true)
            .map((ev) => scheduleCalendarCore?.normalizeDateOnly?.(ev?.date) || String(ev?.date || '').trim())
            .filter(Boolean)
            .sort();
        return dates[0] || '';
    }

    function getSchedulePageScrollOffset() {
        const header = document.getElementById('main-header');
        const headerBottom = header ? header.getBoundingClientRect().bottom : 80;
        return Math.max(16, Math.round(headerBottom + 8));
    }

    function isScheduleElementVerticallyScrollable(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const overflowY = style.overflowY;
        if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') return false;
        return el.scrollHeight > el.clientHeight + 1;
    }

    function findScheduleWeekRowForDate(container, date) {
        if (!container || !date) return null;
        const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(date) : date.replace(/"/g, '\\"');
        const cell = container.querySelector(`[data-cal-date="${escaped}"]`);
        if (cell) return cell.closest('.session-cal-week-row');
        const rows = container.querySelectorAll('.session-cal-week-row');
        for (const row of rows) {
            if (row.querySelector(`[data-cal-date="${escaped}"]`)) return row;
        }
        return null;
    }

    function scrollSchedulePageToWeekRow(weekRow) {
        if (!weekRow) return false;
        const offset = getSchedulePageScrollOffset();
        const targetTop = Math.max(0, window.pageYOffset + weekRow.getBoundingClientRect().top - offset);
        window.scrollTo({ top: targetTop, left: 0, behavior: 'auto' });
        document.documentElement.scrollTop = targetTop;
        document.body.scrollTop = targetTop;
        return true;
    }

    function scrollScheduleTimelineToStagedDate(dateStr) {
        const date = scheduleCalendarCore?.normalizeDateOnly?.(dateStr) || String(dateStr || '').trim();
        if (!date) return false;
        const container = document.getElementById('visualDisplayArea');
        if (!container || !container.classList.contains('schedule-week-grid-host')) return false;
        const weekRow = findScheduleWeekRowForDate(container, date);
        if (!weekRow) return false;
        const cell = container.querySelector(`[data-cal-date="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(date) : date}"]`);
        const scrollEl = container.querySelector('.session-cal-vertical-scroll');

        if (isScheduleElementVerticallyScrollable(scrollEl)) {
            const scrollRect = scrollEl.getBoundingClientRect();
            const rowRect = weekRow.getBoundingClientRect();
            scrollEl.scrollTop += rowRect.top - scrollRect.top - 8;
            return true;
        }

        const timelineShell = weekRow.querySelector('.session-cal-timeline-hover-shell');
        if (isScheduleElementVerticallyScrollable(timelineShell)) {
            const shellRect = timelineShell.getBoundingClientRect();
            const targetRect = (cell || weekRow).getBoundingClientRect();
            timelineShell.scrollTop += targetRect.top - shellRect.top - 8;
            return true;
        }

        return scrollSchedulePageToWeekRow(weekRow);
    }

    function focusScheduleTimelineOnFirstStagedSession(firstStagedDate) {
        const person = activeSchedulePerson();
        const date = scheduleCalendarCore?.normalizeDateOnly?.(firstStagedDate)
            || scheduleCalendarCore?.normalizeDateOnly?.(scheduleState.pendingStagedScrollDate)
            || getFirstDraftStagedSessionDate(person?.id)
            || '';
        if (!date) return;
        scheduleState.pendingStagedScrollDate = date;
        const attemptScroll = () => scrollScheduleTimelineToStagedDate(date);
        const scheduleAttempts = (extraDelay = 0) => {
            [0, 120, 350, 650, 1000].forEach((delay) => {
                setTimeout(attemptScroll, extraDelay + delay);
            });
        };
        scheduleAttempts(0);
        if (document.body.classList.contains('modal-open')) {
            const observer = new MutationObserver(() => {
                if (!document.body.classList.contains('modal-open')) {
                    observer.disconnect();
                    scheduleAttempts(80);
                }
            });
            observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        }
    }

    function buildScheduleDraftBadge(event) {
        if (event?.isDraft !== true) return '';
        return '<span class="badge bg-warning text-dark schedule-draft-badge mb-1">Draft</span>';
    }

    function buildScheduleDraftEnrollmentBadge(event) {
        if (!stagedSessionHasPendingEnrollment(event)) return '';
        return '<span class="badge bg-info-subtle text-info-emphasis border schedule-draft-enrollment-badge mb-1">Draft enrollment</span>';
    }


    let bindScheduleDragCreate = function bindScheduleDragCreate() {};
    let resolveScheduleDraftEventFromTarget = function resolveScheduleDraftEventFromTarget() { return null; };
    let bindScheduleDraftSessionContextMenu = function bindScheduleDraftSessionContextMenu() {};
    let commitScheduleDraftSessions = async function commitScheduleDraftSessions() {};
    let getScheduleStageModalEl = function getScheduleStageModalEl() { return null; };
    let getDraftBatchesForPerson = function getDraftBatchesForPerson() { return []; };
    let syncPartialModalFromTimelineDrafts = function syncPartialModalFromTimelineDrafts() {};
    let isScheduleSavedSessionWorkActive = function isScheduleSavedSessionWorkActive() { return false; };
    let isLatestScheduleSessionMutation = function isLatestScheduleSessionMutation() { return true; };
    let buildScheduleDraftResizeHandlesHtml = function buildScheduleDraftResizeHandlesHtml() { return ''; };
    let openScheduleDraftEditFromTarget = function openScheduleDraftEditFromTarget() {};
    let isScheduleDraftEditInteractionTarget = function isScheduleDraftEditInteractionTarget() { return false; };
    let showScheduleDraftSessionContextMenu = function showScheduleDraftSessionContextMenu() {};
    let hideScheduleDraftEditOverlay = function hideScheduleDraftEditOverlay() {};
    let hideScheduleDraftMoveOverlay = function hideScheduleDraftMoveOverlay() {};
    let openScheduleSavedSessionEditOverlay = function openScheduleSavedSessionEditOverlay() {};
    let openScheduleSavedSessionMoveOverlay = function openScheduleSavedSessionMoveOverlay() {};
    let scheduleAdminUi = null;

    if (canDragCreateSessions && global.MasterScheduleViewerStaging && typeof global.MasterScheduleViewerStaging.install === 'function') {
      const stagingDeps = {
        escapeHtml, scheduleState, uiAlert, uiConfirm, scheduleCalendarCore,
        setDateRangeFromIso, setActiveRangeChip, schedulePersistDraftBackup,
        fetchWithScheduleTimeout, SCHEDULE_COMMIT_STAGED_API, countAllPendingDraftSessions,
        clearScheduleDraftBackup, getScheduleEventsForPerson, focusScheduleTimelineOnFirstStagedSession,
        canDragCreateSessions, SCHEDULE_DRAGGABLE_BLOCK_SELECTOR, getEventTitle,
        formatScheduleClockRange, timeToMinutes, calculatePosition, normalizeSessionStatus,
        sessionStatusMetaMap, getStatusMeta, activeSchedulePerson, refreshScheduleActiveView,
        loadActiveSchedulePerson, acknowledgeLocalScheduleMutation, getScheduleHolidayDatesForRender,
        refreshScheduleViewWithHolidays, loadSchedulePerson,
        buildSessionCaseBadgeHtml, TIMELINE_START_HOUR, TIMELINE_END_HOUR, TOTAL_MINUTES,
        scheduleDraftSelectHtml, toggleDraftSessionSelection, isDraftSessionSelected,
        getActiveDraftSelectionSet, clearActiveDraftSessionSelection, hasPendingDraftWorkForPerson,
        resolveScheduleContextEventFromTarget, isScheduledClassSessionForQuickEdit,
        canScheduleSessionChangeDate, canScheduleSessionChangeTime, formatSessionManagementBlockerMessage,
        isScheduleEventMutableUnderClassFocus, selectedScheduleRole, syncScheduleActiveClassChipAfterStaging,
        getScheduleRange, appendSavedClassSessionsToState, patchSavedClassSessionEventInState,
        applySavedSessionScheduleUpdate, resolveStagingPassSessionIds, getSelectedDraftEvents,
        updateScheduleDraftSelectedControls, selectDraftSessionsInStagingPass,
        getStagedViewPaddingRangeOptions,
        openScheduleSessionBulkSelectModal,
        getPendingEnrollStudentsForClass,
        clearPendingEnrollStudentsForClass,
        getPendingEnrollMetaForClass,
        setPendingEnrollMetaForClass,
        classHasPendingEnrollments,
        canManagePendingEnrollmentsForDraftContext,
        stagedSessionHasPendingEnrollment,
        replacePendingEnrollStudentsForClass,
        removePendingEnrollStudentAt,
        prunePendingEnrollmentsForClass,
        buildScheduleDraftEnrollmentBadge,
        openPendingEnrollmentManageModal: (classId) => {
            if (typeof global.MasterScheduleEnrollStudents?.openPendingEnrollmentManageModal === 'function') {
                global.MasterScheduleEnrollStudents.openPendingEnrollmentManageModal(classId);
            }
        }
      };
      const stagingExports = global.MasterScheduleViewerStaging.install(stagingDeps);
      if (stagingExports && typeof stagingExports === 'object') {
        if (typeof stagingExports.bindScheduleDragCreate === 'function') bindScheduleDragCreate = stagingExports.bindScheduleDragCreate;
        if (typeof stagingExports.resolveScheduleDraftEventFromTarget === 'function') resolveScheduleDraftEventFromTarget = stagingExports.resolveScheduleDraftEventFromTarget;
        if (typeof stagingExports.bindScheduleDraftSessionContextMenu === 'function') bindScheduleDraftSessionContextMenu = stagingExports.bindScheduleDraftSessionContextMenu;
        if (typeof stagingExports.commitScheduleDraftSessions === 'function') commitScheduleDraftSessions = stagingExports.commitScheduleDraftSessions;
        if (typeof stagingExports.getScheduleStageModalEl === 'function') getScheduleStageModalEl = stagingExports.getScheduleStageModalEl;
        if (typeof stagingExports.getDraftBatchesForPerson === 'function') getDraftBatchesForPerson = stagingExports.getDraftBatchesForPerson;
        if (typeof stagingExports.syncPartialModalFromTimelineDrafts === 'function') syncPartialModalFromTimelineDrafts = stagingExports.syncPartialModalFromTimelineDrafts;
        if (typeof stagingExports.isScheduleSavedSessionWorkActive === 'function') isScheduleSavedSessionWorkActive = stagingExports.isScheduleSavedSessionWorkActive;
        if (typeof stagingExports.isLatestScheduleSessionMutation === 'function') isLatestScheduleSessionMutation = stagingExports.isLatestScheduleSessionMutation;
        if (typeof stagingExports.buildScheduleDraftResizeHandlesHtml === 'function') buildScheduleDraftResizeHandlesHtml = stagingExports.buildScheduleDraftResizeHandlesHtml;
        if (typeof stagingExports.openScheduleDraftEditFromTarget === 'function') openScheduleDraftEditFromTarget = stagingExports.openScheduleDraftEditFromTarget;
        if (typeof stagingExports.isScheduleDraftEditInteractionTarget === 'function') isScheduleDraftEditInteractionTarget = stagingExports.isScheduleDraftEditInteractionTarget;
        if (typeof stagingExports.showScheduleDraftSessionContextMenu === 'function') showScheduleDraftSessionContextMenu = stagingExports.showScheduleDraftSessionContextMenu;
        if (typeof stagingExports.hideScheduleDraftEditOverlay === 'function') hideScheduleDraftEditOverlay = stagingExports.hideScheduleDraftEditOverlay;
        if (typeof stagingExports.hideScheduleDraftMoveOverlay === 'function') hideScheduleDraftMoveOverlay = stagingExports.hideScheduleDraftMoveOverlay;
        if (typeof stagingExports.openScheduleSavedSessionEditOverlay === 'function') openScheduleSavedSessionEditOverlay = stagingExports.openScheduleSavedSessionEditOverlay;
        if (typeof stagingExports.openScheduleSavedSessionMoveOverlay === 'function') openScheduleSavedSessionMoveOverlay = stagingExports.openScheduleSavedSessionMoveOverlay;
      }
    }

    if (canSelectAnyPerson && global.MasterScheduleViewerAdmin && typeof global.MasterScheduleViewerAdmin.install === 'function') {
      scheduleAdminUi = global.MasterScheduleViewerAdmin.install({
        escapeHtml,
        scheduleState,
        persistScheduleViewerPreferencesPartial,
        renderSchedulePersonTabs,
        mapSchedulePersonsForPreferences,
        closeOtherSchedulePopovers: () => {
          closeScheduleTimeRangePopover();
          closeScheduleStagedPaddingPopover();
          closeScheduleDaySizePopover();
          closeScheduleActiveClassPopover();
        }
      });
    }

    function countActivePersonDraftSessions() {
        if (!canDragCreateSessions) return 0;
        const person = activeSchedulePerson();
        if (!person?.id) return 0;
        const drafts = scheduleState.draftEventsByPersonId?.[person.id];
        return Array.isArray(drafts) ? drafts.length : 0;
    }

    function buildScheduleSaveDraftsButtonHtml() {
        if (!canDragCreateSessions) return '';
        const count = countActivePersonDraftSessions();
        if (!count) return '';
        const label = count === 1 ? 'Save changes' : `Save changes (${count})`;
        return `<button type="button" class="btn btn-success btn-sm schedule-save-drafts-btn" data-schedule-save-drafts title="Save staged sessions to class schedules" aria-label="${escapeHtml(label)}"><i class="bi bi-check2-circle" aria-hidden="true"></i><span>${escapeHtml(label)}</span></button>`;
    }

    function saveScheduleViewMode(mode) {
        const normalized = resolveScheduleViewMode(mode);
        scheduleState.viewMode = normalized;
        try {
            if (window.localStorage) window.localStorage.setItem(SCHEDULE_VIEW_MODE_STORAGE_KEY, normalized);
        } catch (error) { /* storage can be unavailable */ }
    }

    function resolveSchedulePersonId(item) {
        return String(item?.personId || item?.id || item?._id || '').trim();
    }

    function selectedScheduleRole() {
        return String(document.getElementById('sch_role')?.value || '').trim();
    }

    function activeSchedulePerson() {
        return scheduleState.persons.find((person) => person.id === scheduleState.activePersonId) || null;
    }

    function scheduleSessionSelectionKey(event) {
        if (isLeaveEvent(event) || String(event?.eventType || event?.targetType || '').trim().toLowerCase() === 'report_task') return '';
        const classId = String(event?.classId || '').trim();
        const sessionId = String(event?.sessionId || event?.sourceSessionId || event?.id || '').trim();
        const date = String(event?.date || '').trim();
        if (!classId || !sessionId || !date) return '';
        return `${classId}::${sessionId}::${date}`;
    }

    function isClassSessionScheduleEvent(event) {
        if (!event || event.isDraft) return false;
        const eventType = String(event?.eventType || event?.targetType || '').trim().toLowerCase();
        if (eventType && eventType !== 'class_session' && eventType !== 'session') return false;
        if (isLeaveEvent(event) || isReportScheduleEvent(event)) return false;
        if (String(event?.activityId || '').trim()) return false;
        return Boolean(String(event?.classId || '').trim() && String(event?.sessionId || '').trim() && String(event?.date || '').trim());
    }

    function readSessionManagementPolicy(event) {
        const policy = event?.sessionManagement;
        if (!policy || typeof policy !== 'object') {
            return {
                canDelete: true,
                canChangeDate: true,
                canChangeTime: true,
                canChangeStatus: true
            };
        }
        return {
            canDelete: policy.canDelete !== false,
            canChangeDate: policy.canChangeDate !== false,
            canChangeTime: policy.canChangeTime !== false,
            canChangeStatus: policy.canChangeStatus !== false,
            blockers: Array.isArray(policy.blockers) ? policy.blockers : []
        };
    }

    function formatSessionManagementBlockerMessage(event, fallback = 'This session change is not allowed.') {
        const blockers = readSessionManagementPolicy(event).blockers || [];
        if (!blockers.length) return fallback;
        const labels = blockers.map((row) => String(row?.label || row?.code || '').trim()).filter(Boolean);
        return labels.length ? `${fallback}\n\nBlocked by: ${labels.join(', ')}` : fallback;
    }

    function resetScheduleActiveClassFilter() {
        scheduleState.activeClassFilterId = '';
    }

    function normalizeScheduleActiveClassItem(classMeta = {}) {
        const id = String(classMeta?.id || classMeta?.classId || '').trim();
        if (!id) return null;
        return {
            id,
            title: String(classMeta?.title || classMeta?.classLabel || classMeta?.className || id).trim(),
            code: String(classMeta?.code || '').trim(),
            status: String(classMeta?.status || 'active').trim(),
            programName: String(classMeta?.programName || '').trim(),
            termLabel: String(classMeta?.termLabel || '').trim(),
            departmentName: String(classMeta?.departmentName || '').trim(),
            registrationMode: String(classMeta?.registrationMode || '').trim()
        };
    }

    function upsertScheduleActiveClassForPerson(personId, classMeta = {}) {
        const pid = String(personId || '').trim();
        const item = normalizeScheduleActiveClassItem(classMeta);
        if (!pid || !item) return;
        if (!scheduleState.activeClassesByPersonId) scheduleState.activeClassesByPersonId = {};
        const list = Array.isArray(scheduleState.activeClassesByPersonId[pid])
            ? scheduleState.activeClassesByPersonId[pid].slice()
            : [];
        const index = list.findIndex((row) => String(row?.id || '').trim() === item.id);
        if (index >= 0) list[index] = { ...list[index], ...item };
        else list.push(item);
        list.sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id), undefined, { sensitivity: 'base' }));
        scheduleState.activeClassesByPersonId[pid] = list;
        if (String(scheduleState.activePersonId || '').trim() === pid) {
            scheduleState.activeClasses = list;
        }
    }

    function applyScheduleActiveClassFilterAfterStaging(personId, classId) {
        const pid = String(personId || '').trim();
        const cid = String(classId || '').trim();
        if (!pid || !cid || String(scheduleState.activePersonId || '').trim() !== pid) return;
        scheduleState.activeClassFilterId = cid;
    }

    function syncScheduleActiveClassChipAfterStaging(personId, classMeta = {}) {
        const pid = String(personId || '').trim();
        const classId = String(classMeta?.classId || classMeta?.id || '').trim();
        if (!pid || !classId) return;
        upsertScheduleActiveClassForPerson(pid, classMeta);
        applyScheduleActiveClassFilterAfterStaging(pid, classId);
    }

    function syncScheduleActiveClassesForActivePerson() {
        const personId = String(activeSchedulePerson()?.id || '').trim();
        scheduleState.activeClasses = personId && Array.isArray(scheduleState.activeClassesByPersonId[personId])
            ? scheduleState.activeClassesByPersonId[personId]
            : [];
        const filterId = String(scheduleState.activeClassFilterId || '').trim();
        if (!filterId) return;
        const stillValid = scheduleState.activeClasses.some((row) => String(row?.id || '').trim() === filterId);
        if (!stillValid) scheduleState.activeClassFilterId = '';
    }

    function isScheduleEventInActiveClassFocus(event) {
        const filterId = String(scheduleState.activeClassFilterId || '').trim();
        if (!filterId) return true;
        if (isClassSessionScheduleEvent(event)) return String(event?.classId || '').trim() === filterId;
        if (event?.isDraft === true) return String(event?.classId || '').trim() === filterId;
        return false;
    }

    function isScheduleEventMutableUnderClassFocus(event) {
        return isScheduleEventInActiveClassFocus(event);
    }

    function buildScheduleClassFilterMutedClass(event) {
        return isScheduleEventInActiveClassFocus(event) ? '' : ' is-schedule-class-filter-muted';
    }

    function getScheduleActiveClassFilterLabel() {
        const filterId = String(scheduleState.activeClassFilterId || '').trim();
        if (!filterId) return 'All Active Classes';
        const match = (scheduleState.activeClasses || []).find((row) => String(row?.id || '').trim() === filterId);
        return String(match?.title || match?.id || filterId).trim() || 'Class';
    }

    function canScheduleSessionChangeDate(event) {
        if (!isScheduleEventMutableUnderClassFocus(event)) return false;
        return isScheduledClassSessionForQuickEdit(event) && readSessionManagementPolicy(event).canChangeDate === true;
    }

    function canScheduleSessionChangeTime(event) {
        if (!isScheduleEventMutableUnderClassFocus(event)) return false;
        return isScheduledClassSessionForQuickEdit(event) && readSessionManagementPolicy(event).canChangeTime === true;
    }

    function canScheduleSessionChangeStatus(event) {
        if (!isScheduleEventMutableUnderClassFocus(event)) return false;
        return isScheduledClassSessionForQuickEdit(event) && readSessionManagementPolicy(event).canChangeStatus === true;
    }

    function isScheduledClassSessionForQuickEdit(event) {
        return isClassSessionScheduleEvent(event)
            && normalizeSessionStatus(event?.status) === 'scheduled'
            && event?.locked !== true
            && event?.scheduleDisplayOnly !== true;
    }

    function isScheduledClassSessionScheduleEditable(event) {
        return isScheduleEventMutableUnderClassFocus(event)
            && isScheduledClassSessionForQuickEdit(event)
            && (canScheduleSessionChangeDate(event) || canScheduleSessionChangeTime(event));
    }

    function isWorkSessionScheduleEvent(event) {
        return String(event?.eventType || '').trim() === 'school_activity'
            && String(event?.activityEntryId || '').trim();
    }

    function buildScheduleSessionContextDataAttrs(event) {
        const selectionKey = escapeHtml(scheduleSessionSelectionKey(event));
        const keyAttr = selectionKey ? `data-schedule-session-key="${selectionKey}"` : '';
        if (event?.isDraft === true) {
            const classId = escapeHtml(String(event.classId || '').trim());
            const sessionId = escapeHtml(String(event.sessionId || event.id || '').trim());
            const sessionDate = escapeHtml(String(event.date || '').trim());
            const attemptId = escapeHtml(String(event.stagingAttemptId || '').trim());
            const attemptAttr = attemptId ? ` data-staging-attempt-id="${attemptId}"` : '';
            return `${keyAttr} data-class-id="${classId}" data-session-id="${sessionId}" data-session-date="${sessionDate}" data-event-type="schedule_draft"${attemptAttr}`;
        }
        if (isWorkSessionScheduleEvent(event)) {
            const activityId = escapeHtml(String(event.activityId || '').trim());
            const entryId = escapeHtml(String(event.activityEntryId || '').trim());
            return `${keyAttr} data-event-type="school_activity" data-activity-id="${activityId}" data-activity-entry-id="${entryId}"`;
        }
        if (!isClassSessionScheduleEvent(event)) return keyAttr;
        const classId = escapeHtml(String(event.classId || '').trim());
        const sessionId = escapeHtml(String(event.sessionId || '').trim());
        const sessionDate = escapeHtml(String(event.date || '').trim());
        const editableAttr = (canDragCreateSessions && isScheduledClassSessionScheduleEditable(event)) ? ' data-schedule-editable="1"' : '';
        return `${keyAttr} data-class-id="${classId}" data-session-id="${sessionId}" data-session-date="${sessionDate}" data-event-type="class_session"${editableAttr}`;
    }

    function resolveWorkSessionEventFromTarget(target) {
        const block = target?.closest?.('[data-event-type="school_activity"][data-activity-entry-id]');
        if (!block) return null;
        const person = activeSchedulePerson();
        if (!person?.id) return null;
        const activityId = String(block.getAttribute('data-activity-id') || '').trim();
        const entryId = String(block.getAttribute('data-activity-entry-id') || '').trim();
        const events = getScheduleEventsForPerson(person.id);
        return events.find((row) => String(row?.activityId || '').trim() === activityId
            && String(row?.activityEntryId || '').trim() === entryId) || null;
    }

    function resolveScheduleContextEventFromTarget(target) {
        const block = target?.closest?.('[data-event-type="class_session"][data-session-id][data-class-id]');
        if (!block) return null;
        const key = String(block.getAttribute('data-schedule-session-key') || '').trim();
        const person = activeSchedulePerson();
        if (!person?.id) return null;
        const events = getScheduleEventsForPerson(person.id);
        if (key) {
            const matched = events.find((row) => scheduleSessionSelectionKey(row) === key);
            if (matched) return matched;
        }
        const classId = String(block.getAttribute('data-class-id') || '').trim();
        const sessionId = String(block.getAttribute('data-session-id') || '').trim();
        const sessionDate = String(block.getAttribute('data-session-date') || '').trim();
        return events.find((row) => String(row?.classId || '').trim() === classId
            && String(row?.sessionId || '').trim() === sessionId
            && String(row?.date || '').trim() === sessionDate) || null;
    }

    function normalizeScheduleStatusAccessType(value) {
        return String(value || 'all').trim().toLowerCase();
    }

    function scheduleStatusMatchesCapacityMode(meta, capacityMode) {
        const mode = String(capacityMode || '').trim().toLowerCase();
        if (!mode || mode === 'both') return true;
        const capacity = String(meta?.classCapacity || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
        const normalizedCapacity = !capacity || capacity === 'all'
            ? 'both'
            : (capacity === 'one_on_one' || capacity === '1_on_1' || capacity === 'oneonone' ? 'one_on_one' : (capacity === 'group' ? 'group' : 'both'));
        if (normalizedCapacity === 'both') return true;
        return normalizedCapacity === mode;
    }

    function buildScheduleSessionStatusMenuItems(event) {
        const person = activeSchedulePerson();
        const statusMeta = Array.isArray(scheduleState.statusMetaByPersonId[person?.id || ''])
            ? scheduleState.statusMetaByPersonId[person.id]
            : [];
        const allowAdminStatuses = canSelectAnyPerson === true;
        const capacityMode = event?.isOneOnOneClass ? 'one_on_one' : 'group';
        const currentStatus = normalizeSessionStatus(event?.status);
        return statusMeta
            .filter((row) => row?.active !== false)
            .filter((row) => allowAdminStatuses || normalizeScheduleStatusAccessType(row?.accessType) !== 'admins')
            .filter((row) => scheduleStatusMatchesCapacityMode(row, capacityMode))
            .sort((a, b) => Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0))
            .map((row) => ({
                code: normalizeSessionStatus(row?.code),
                label: String(row?.label || row?.code || '').trim(),
                colorBg: row?.colorBg || '#e2e3e5',
                colorText: row?.colorText || '#41464b',
                colorBorder: row?.colorBorder || '#c6c8ca',
                isCurrent: normalizeSessionStatus(row?.code) === currentStatus,
                makeUpRequired: row?.makeUpRequired === true,
                mergedSessionRequired: row?.mergedSessionRequired === true,
                requiresManageSession: row?.makeUpRequired === true || row?.mergedSessionRequired === true
            }));
    }

    function buildWorkSessionStatusMenuItems(event) {
        const evaluationType = String(event?.evaluationType || '').trim().toLowerCase();
        if (evaluationType === 'completion') {
            const current = String(event?.completionStatus || event?.status || '').trim().toLowerCase();
            const isCompleted = current === 'completed';
            return [
                {
                    code: 'pending_completion',
                    label: 'Pending completion',
                    completionStatus: 'pending',
                    isCurrent: !isCompleted,
                    requiresManageSession: false
                },
                {
                    code: 'completed',
                    label: 'Completed',
                    completionStatus: 'completed',
                    isCurrent: isCompleted,
                    requiresManageSession: false
                }
            ];
        }
        const current = String(event?.status || 'attended').trim().toLowerCase();
        return [
            { code: 'attended', label: 'Attended', assigneeStatus: 'attended', isCurrent: current === 'attended', requiresManageSession: false },
            { code: 'absent', label: 'Absent', assigneeStatus: 'absent', isCurrent: current === 'absent', requiresManageSession: false },
            { code: 'excused', label: 'Excused', assigneeStatus: 'excused', isCurrent: current === 'excused', requiresManageSession: false }
        ];
    }

    function scheduleAttendanceFlagIsTrue(value) {
        return value === true || value === 1 || ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
    }

    function scheduleAttendanceIsAbsentLike(status) {
        const att = String(status || '').trim().toLowerCase();
        return att === 'absent' || att === 'acf';
    }

    function scheduleBuildLateTimingIcon(rec) {
        const late = Number(rec?.lateMinutes) || 0;
        const early = Number(rec?.earlyLeaveMinutes) || 0;
        const markAppearance = window.AttendanceMarkAppearance;
        const innerIcon = markAppearance?.buildMarkIconHtml
            ? markAppearance.buildMarkIconHtml('late')
            : '<i class="bi bi-clock-fill status-late"></i>';
        const ringClass = (late > 0 && scheduleAttendanceFlagIsTrue(rec?.lateExcused))
            || (early > 0 && scheduleAttendanceFlagIsTrue(rec?.earlyLeaveExcused))
            ? 'attendance-timing-excuse-partial'
            : '';
        if (markAppearance?.buildTimingExcuseIcon) {
            return markAppearance.buildTimingExcuseIcon(innerIcon, ringClass);
        }
        return innerIcon;
    }

    function scheduleBuildAttendanceTooltip(rec) {
        const markAppearance = window.AttendanceMarkAppearance;
        const status = String(rec?.attendance || rec?.status || '').trim().toLowerCase();
        let tooltip = 'Not marked yet';
        if (status === 'present') tooltip = markAppearance?.getMark('present')?.label || 'Present';
        else if (status === 'late') tooltip = markAppearance?.getMark('late')?.label || 'Late';
        else if (status === 'excused' || (status === 'absent' && scheduleAttendanceFlagIsTrue(rec?.absenceExcused))) {
            tooltip = markAppearance?.getMark('excused_absence')?.label || 'Excused absence';
        } else if (status === 'absent') tooltip = markAppearance?.getMark('absent')?.label || 'Absent';
        else if (status === 'acf' && scheduleAttendanceFlagIsTrue(rec?.absenceExcused)) {
            tooltip = markAppearance?.getMark('excused_absence')?.label || 'Excused ACF';
        } else if (status === 'acf') tooltip = markAppearance?.getMark('acf')?.label || 'Absent Camera Off';
        else if (status === 'not_applicable') tooltip = markAppearance?.getMark('not_applicable')?.label || 'N/A';

        const late = Number(rec?.lateMinutes) || 0;
        const early = Number(rec?.earlyLeaveMinutes) || 0;
        const parts = [tooltip];
        if (late > 0) parts.push(`Late ${late} min${scheduleAttendanceFlagIsTrue(rec?.lateExcused) ? ' (excused)' : ''}`);
        if (early > 0) parts.push(`Early leave ${early} min${scheduleAttendanceFlagIsTrue(rec?.earlyLeaveExcused) ? ' (excused)' : ''}`);
        if (scheduleAttendanceIsAbsentLike(status) && scheduleAttendanceFlagIsTrue(rec?.absenceExcused)) parts.push('Absence excused');
        if (rec?.notesPreview) parts.push(rec.notesPreview);
        return parts.join(' · ');
    }

    function scheduleBuildAttendanceMarkHtml(rec) {
        const markAppearance = window.AttendanceMarkAppearance;
        const buildIcon = (key, ringClass) => {
            if (markAppearance?.buildMarkIconHtml) {
                return ringClass
                    ? markAppearance.buildMarkIconHtml(key, { ringClass })
                    : markAppearance.buildMarkIconHtml(key);
            }
            return '';
        };
        const status = String(rec?.attendance || rec?.status || '').trim().toLowerCase();
        let icon = buildIcon('unmarked') || '<i class="bi bi-dash text-muted"></i>';
        if (status === 'present') icon = buildIcon('present');
        else if (status === 'late') icon = scheduleBuildLateTimingIcon(rec);
        else if (status === 'excused' || (status === 'absent' && scheduleAttendanceFlagIsTrue(rec?.absenceExcused))) {
            icon = buildIcon('excused_absence', 'attendance-timing-excuse-full');
        } else if (status === 'absent') icon = buildIcon('absent');
        else if (status === 'acf' && scheduleAttendanceFlagIsTrue(rec?.absenceExcused)) {
            icon = buildIcon('excused_absence', 'attendance-timing-excuse-full');
        } else if (status === 'acf') icon = buildIcon('acf');
        else if (status === 'not_applicable') icon = buildIcon('not_applicable');

        const notesIcon = rec?.hasNotes
            ? (buildIcon('notes') || '<i class="bi bi-chat-dots-fill status-notes"></i>')
            : '';
        const tooltip = escapeHtml(scheduleBuildAttendanceTooltip(rec));
        return `<div class="schedule-session-attendance-mark" title="${tooltip}">
            <span class="schedule-session-attendance-icon">${icon}</span>
            ${notesIcon ? `<span class="schedule-session-attendance-notes">${notesIcon}</span>` : ''}
            <span class="schedule-session-attendance-detail small text-muted">${tooltip}</span>
        </div>`;
    }

    function formatScheduleDateLabel(ymd) {
        const raw = String(ymd || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw || '—';
        const d = new Date(`${raw}T00:00:00`);
        if (Number.isNaN(d.getTime())) return raw;
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function formatScheduleEnrollmentDateRange(row) {
        const start = formatScheduleDateLabel(row?.enrollmentStartDate);
        const end = formatScheduleDateLabel(row?.enrollmentEndDate);
        if (start !== '—' && end !== '—') return `${start} – ${end}`;
        if (start !== '—') return `From ${start}`;
        if (end !== '—') return `Until ${end}`;
        return '—';
    }

    function buildAttendanceMatrixUrlForSession(event) {
        const classId = String(event?.classId || '').trim();
        const sessionId = String(event?.sessionId || '').trim();
        const sessionDate = String(event?.date || '').trim();
        const url = new URL(`${window.location.origin}/school/attendances`);
        if (classId) url.searchParams.set('classId', classId);
        if (sessionDate) {
            url.searchParams.set('startDate', sessionDate);
            url.searchParams.set('endDate', sessionDate);
        }
        if (sessionId) url.searchParams.set('sessionIds', sessionId);
        return url.pathname + url.search;
    }

    function patchScheduleEventInState(event, updates = {}) {
        const person = activeSchedulePerson();
        if (!person?.id || !event) return null;
        const events = Array.isArray(scheduleState.eventsByPersonId[person.id]) ? scheduleState.eventsByPersonId[person.id] : [];
        let patched = null;
        scheduleState.eventsByPersonId[person.id] = events.map((ev) => {
            if (isWorkSessionScheduleEvent(event)) {
                if (String(ev?.activityEntryId || '').trim() !== String(event.activityEntryId || '').trim()) return ev;
                if (String(ev?.activityId || '').trim() !== String(event.activityId || '').trim()) return ev;
            } else {
                if (String(ev?.classId || '').trim() !== String(event.classId || '').trim()
                    || String(ev?.sessionId || '').trim() !== String(event.sessionId || '').trim()
                    || String(ev?.date || '').trim() !== String(event.date || '').trim()) return ev;
            }
            const next = { ...ev };
            if (updates.date) next.date = updates.date;
            if (updates.start) next.start = updates.start;
            if (updates.end) next.end = updates.end;
            if (updates.duration !== undefined) next.duration = updates.duration;
            if (updates.status) next.status = updates.status;
            if (updates.completionStatus) next.completionStatus = updates.completionStatus;
            if (updates.statusLabel) next.statusLabel = updates.statusLabel;
            patched = next;
            return next;
        });
        return patched;
    }

    function buildClassSessionCoTeacherEventFields(personId, coTeachers = []) {
        const pid = String(personId || '').trim();
        const rows = Array.isArray(coTeachers) ? coTeachers : [];
        const entry = rows.find((row) => String(row?.personId || '').trim() === pid);
        return {
            hasCoTeachers: rows.length > 0,
            coTeacherCount: rows.length,
            coTeachers: rows.map((row) => ({
                personId: String(row?.personId || ''),
                name: String(row?.name || ''),
                roleLabel: String(row?.roleLabel || ''),
                canEdit: row?.canEdit === true,
                paid: row?.paid !== false,
                paidHours: row?.paid === false ? 0 : (row?.paidHours ?? null)
            })),
            viewerIsSessionCoTeacher: Boolean(entry),
            viewerCoTeacherPaid: entry ? entry.paid !== false : null
        };
    }

    function patchClassSessionCoTeachersInState(sessionUpdates = [], { action = 'upsert', teacherId = '' } = {}) {
        const removedTeacherId = String(teacherId || '').trim();
        const isRemove = String(action || '').trim().toLowerCase() === 'remove';
        const updates = Array.isArray(sessionUpdates) ? sessionUpdates : [];
        const touchedPersonIds = new Set();
        const updateKeys = new Set(
            updates.map((row) => `${String(row?.classId || '').trim()}::${String(row?.sessionId || '').trim()}`)
        );

        Object.keys(scheduleState.eventsByPersonId || {}).forEach((personKey) => {
            const events = scheduleState.eventsByPersonId[personKey];
            if (!Array.isArray(events)) return;
            let changed = false;
            const next = [];
            events.forEach((ev) => {
                if (String(ev?.eventType || '').trim().toLowerCase() !== 'class_session') {
                    next.push(ev);
                    return;
                }
                const sessionKey = `${String(ev?.classId || '').trim()}::${String(ev?.sessionId || '').trim()}`;
                if (!updateKeys.has(sessionKey)) {
                    next.push(ev);
                    return;
                }
                const match = updates.find((row) => (
                    String(row?.classId || '').trim() === String(ev?.classId || '').trim()
                    && String(row?.sessionId || '').trim() === String(ev?.sessionId || '').trim()
                ));
                const coTeachers = Array.isArray(match?.coTeachers) ? match.coTeachers : [];
                const viewerPersonId = String(ev?.personId || personKey || '').trim();
                if (
                    isRemove
                    && removedTeacherId
                    && viewerPersonId === removedTeacherId
                    && ev.viewerIsSessionCoTeacher === true
                    && !coTeachers.some((row) => String(row?.personId || '').trim() === removedTeacherId)
                ) {
                    changed = true;
                    touchedPersonIds.add(personKey);
                    return;
                }
                next.push({
                    ...ev,
                    ...buildClassSessionCoTeacherEventFields(viewerPersonId, coTeachers)
                });
                changed = true;
                touchedPersonIds.add(personKey);
            });
            if (changed) scheduleState.eventsByPersonId[personKey] = next;
        });
        return touchedPersonIds;
    }

    function refreshClassSessionCoTeacherBlocksInView(sessionUpdates = []) {
        const person = activeSchedulePerson();
        if (!person?.id) return;
        const updates = Array.isArray(sessionUpdates) ? sessionUpdates : [];
        const updateKeys = new Set(
            updates.map((row) => `${String(row?.classId || '').trim()}::${String(row?.sessionId || '').trim()}`)
        );
        const events = getScheduleEventsForPerson(person.id).filter((ev) => (
            String(ev?.eventType || '').trim().toLowerCase() === 'class_session'
            && updateKeys.has(`${String(ev?.classId || '').trim()}::${String(ev?.sessionId || '').trim()}`)
        ));
        if (!events.length) {
            refreshScheduleActiveView();
            return;
        }
        if (events.length > 12) {
            refreshScheduleActiveView();
            return;
        }
        let failed = false;
        events.forEach((ev) => {
            if (!rerenderScheduleSessionBlockFromState(ev)) failed = true;
        });
        if (failed) refreshScheduleActiveView();
    }

    async function applyClassSessionCoTeacherChangesInView({ sessions = [], action = 'upsert', teacherId = '' } = {}) {
        const touchedPersonIds = patchClassSessionCoTeachersInState(sessions, { action, teacherId });
        refreshClassSessionCoTeacherBlocksInView(sessions);
        const tasks = [...touchedPersonIds].map((personId) => acknowledgeLocalScheduleMutation({ id: personId }));
        await Promise.all(tasks);
    }

    function normalizeScheduleSessionRefRow(row = {}) {
        return {
            classId: String(row?.classId || '').trim(),
            sessionId: String(row?.sessionId || row?.id || '').trim(),
            date: String(row?.date || row?.sessionDate || '').trim()
        };
    }

    function listLoadedSchedulePersonIds() {
        const ids = new Set();
        scheduleState.persons.forEach((person) => {
            if (person?.id && scheduleState.loadedPersonIds.has(person.id)) ids.add(person.id);
        });
        Object.keys(scheduleState.eventsByPersonId || {}).forEach((personId) => {
            if (scheduleState.loadedPersonIds.has(personId)) ids.add(personId);
        });
        return Array.from(ids);
    }

    function removeClassSessionsAcrossLoadedPersons(removedRows = []) {
        const rows = (Array.isArray(removedRows) ? removedRows : [])
            .map(normalizeScheduleSessionRefRow)
            .filter((row) => row.classId && row.sessionId);
        const touched = new Set();
        if (!rows.length) return touched;
        const personIds = listLoadedSchedulePersonIds();
        personIds.forEach((personId) => {
            const events = Array.isArray(scheduleState.eventsByPersonId[personId])
                ? scheduleState.eventsByPersonId[personId]
                : [];
            const next = events.filter((ev) => {
                if (String(ev?.eventType || '').trim().toLowerCase() !== 'class_session') return true;
                const classId = String(ev?.classId || '').trim();
                const sessionId = String(ev?.sessionId || '').trim();
                const remove = rows.some((row) => {
                    if (row.classId !== classId || row.sessionId !== sessionId) return false;
                    if (!row.date) return true;
                    return String(ev?.date || '').trim() === row.date;
                });
                return !remove;
            });
            if (next.length !== events.length) {
                scheduleState.eventsByPersonId[personId] = next;
                touched.add(personId);
            }
        });
        return touched;
    }

    function upsertClassSessionEventsInState(personId, events = []) {
        const pid = String(personId || '').trim();
        if (!pid) return false;
        const incoming = (Array.isArray(events) ? events : []).filter((ev) => (
            String(ev?.eventType || '').trim().toLowerCase() === 'class_session'
        ));
        if (!incoming.length) return false;
        const existing = Array.isArray(scheduleState.eventsByPersonId[pid]) ? scheduleState.eventsByPersonId[pid] : [];
        const keyOf = (ev) => buildSavedClassSessionStateKey(ev?.classId, ev?.sessionId, ev?.date);
        const incomingByKey = new Map();
        incoming.forEach((ev) => {
            const key = keyOf(ev);
            if (key && !key.endsWith('::')) incomingByKey.set(key, ev);
        });
        if (!incomingByKey.size) return false;
        const consumed = new Set();
        const next = existing.map((ev) => {
            const key = keyOf(ev);
            if (incomingByKey.has(key)) {
                consumed.add(key);
                return incomingByKey.get(key);
            }
            return ev;
        });
        incomingByKey.forEach((ev, key) => {
            if (!consumed.has(key)) next.push(ev);
        });
        scheduleState.eventsByPersonId[pid] = next;
        return true;
    }

    function refreshClassSessionBlocksInViewForRefs(sessionRefs = []) {
        const person = activeSchedulePerson();
        if (!person?.id) return;
        const refs = (Array.isArray(sessionRefs) ? sessionRefs : [])
            .map(normalizeScheduleSessionRefRow)
            .filter((row) => row.classId && row.sessionId);
        const updateKeys = new Set(refs.map((row) => `${row.classId}::${row.sessionId}`));
        const events = getScheduleEventsForPerson(person.id).filter((ev) => (
            String(ev?.eventType || '').trim().toLowerCase() === 'class_session'
            && updateKeys.has(`${String(ev?.classId || '').trim()}::${String(ev?.sessionId || '').trim()}`)
        ));
        if (!events.length) {
            refreshScheduleActiveView();
            return;
        }
        if (events.length > 12) {
            refreshScheduleActiveView();
            return;
        }
        let failed = false;
        events.forEach((ev) => {
            if (!rerenderScheduleSessionBlockFromState(ev)) failed = true;
        });
        if (failed) refreshScheduleActiveView();
    }

    async function fetchScheduleViewerSessionRefresh({ personIds = [], sessionRefs = [] } = {}) {
        const ids = (Array.isArray(personIds) ? personIds : []).map((id) => String(id || '').trim()).filter(Boolean);
        const refs = (Array.isArray(sessionRefs) ? sessionRefs : [])
            .map(normalizeScheduleSessionRefRow)
            .filter((row) => row.classId && row.sessionId);
        if (!ids.length || !refs.length) return { updates: [] };
        const range = getScheduleRange();
        const rolesByPersonId = {};
        scheduleState.persons.forEach((person) => {
            if (!person?.id || !ids.includes(person.id)) return;
            rolesByPersonId[person.id] = String(person.selectedRole || selectedScheduleRole() || '').trim();
        });
        const res = await fetch(SCHEDULE_REFRESH_SESSIONS_API, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-AJAX-Request': 'true'
            },
            body: JSON.stringify({
                personIds: ids,
                startDate: range.startDate,
                endDate: range.endDate,
                sessionRefs: refs,
                rolesByPersonId
            })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.status !== 'success') {
            throw new Error(data.message || `Request failed (${res.status}).`);
        }
        return data.data || { updates: [] };
    }

    async function reloadLoadedSchedulePersons(options = {}) {
        const silent = options.silent !== false;
        const personIds = listLoadedSchedulePersonIds();
        if (!personIds.length) return;
        await syncScheduleHolidayDates();
        await Promise.all(personIds.map(async (personId) => {
            const person = scheduleState.persons.find((row) => row.id === personId)
                || { id: personId, name: personId };
            await loadSchedulePerson(person, { silent });
        }));
    }

    async function applyScheduleSessionChangesInView({ removed = [], upsertRefs = [], showProgress = false } = {}) {
        let loadingToken = null;
        if (showProgress === true && typeof window.showLoading === 'function') {
            loadingToken = window.showLoading('Updating schedule view...');
        }
        try {
            const removedRows = (Array.isArray(removed) ? removed : [])
                .map(normalizeScheduleSessionRefRow)
                .filter((row) => row.classId && row.sessionId);
            const upsertRows = (Array.isArray(upsertRefs) ? upsertRefs : [])
                .map(normalizeScheduleSessionRefRow)
                .filter((row) => row.classId && row.sessionId);
            const personIds = listLoadedSchedulePersonIds();
            const touched = removeClassSessionsAcrossLoadedPersons(removedRows);
            let mergedEventCount = 0;
            if (removedRows.length > 0 && personIds.length > 0) {
                refreshScheduleActiveView();
                await reloadLoadedSchedulePersons({ silent: true });
                personIds.forEach((personId) => touched.add(personId));
            } else if (upsertRows.length && personIds.length) {
                try {
                    const refresh = await fetchScheduleViewerSessionRefresh({ personIds, sessionRefs: upsertRows });
                    const updates = Array.isArray(refresh.updates) ? refresh.updates : [];
                    updates.forEach((row) => {
                        const pid = String(row?.personId || '').trim();
                        if (!pid) return;
                        const events = Array.isArray(row.events) ? row.events : [];
                        mergedEventCount += events.length;
                        if (upsertClassSessionEventsInState(pid, events)) touched.add(pid);
                        const fp = String(row?.fingerprint || '').trim();
                        if (fp) scheduleState.scheduleFingerprintByPersonId[pid] = fp;
                    });
                } catch (_) { /* fall through to reload when patch refresh fails */ }
                if (mergedEventCount === 0) {
                    await reloadLoadedSchedulePersons({ silent: true });
                    personIds.forEach((personId) => touched.add(personId));
                }
            }
            if (removedRows.length || upsertRows.length || touched.size) {
                refreshScheduleActiveView();
            }
            const tasks = [...touched].map((personId) => acknowledgeLocalScheduleMutation({ id: personId }));
            await Promise.all(tasks);
        } finally {
            if (loadingToken != null && typeof window.hideLoading === 'function') {
                window.hideLoading(loadingToken);
            }
        }
    }

    function buildSavedClassSessionStateKey(classId, sessionId, date) {
        return `${String(classId || '').trim()}::${String(sessionId || '').trim()}::${String(date || '').trim()}`;
    }

    function removeSavedClassSessionsFromState(personId, classId, rows = []) {
        const pid = String(personId || '').trim();
        const cid = String(classId || '').trim();
        if (!pid) return;
        const removeKeys = new Set(
            (Array.isArray(rows) ? rows : []).map((row) => buildSavedClassSessionStateKey(
                cid || row?.classId,
                row?.sessionId,
                row?.date || row?.sessionDate
            )).filter((key) => key && !key.endsWith('::'))
        );
        if (!removeKeys.size) return;
        const events = Array.isArray(scheduleState.eventsByPersonId[pid]) ? scheduleState.eventsByPersonId[pid] : [];
        scheduleState.eventsByPersonId[pid] = events.filter((ev) => {
            if (String(ev?.eventType || '').trim().toLowerCase() !== 'class_session') return true;
            const key = buildSavedClassSessionStateKey(ev?.classId, ev?.sessionId, ev?.date);
            return !removeKeys.has(key);
        });
    }

    function appendSavedClassSessionsToState(personId, events = []) {
        const pid = String(personId || '').trim();
        if (!pid) return 0;
        const existing = Array.isArray(scheduleState.eventsByPersonId[pid]) ? scheduleState.eventsByPersonId[pid] : [];
        const existingKeys = new Set(
            existing
                .filter((ev) => String(ev?.eventType || '').trim().toLowerCase() === 'class_session')
                .map((ev) => buildSavedClassSessionStateKey(ev?.classId, ev?.sessionId, ev?.date))
        );
        const toAdd = (Array.isArray(events) ? events : []).filter((ev) => {
            const key = buildSavedClassSessionStateKey(ev?.classId, ev?.sessionId, ev?.date);
            return key && !key.endsWith('::') && !existingKeys.has(key);
        });
        if (!toAdd.length) return 0;
        scheduleState.eventsByPersonId[pid] = [...existing, ...toAdd];
        return toAdd.length;
    }

    function revertSavedSessionScheduleInState(event, lookupSessionDate) {
        if (!event) return;
        patchSavedClassSessionEventInState(
            { ...event, date: lookupSessionDate },
            {
                date: lookupSessionDate,
                start: event.start || event.startTime,
                end: event.end || event.endTime,
                duration: event.duration
            }
        );
        refreshScheduleActiveView();
    }

    function findScheduleEventInState(event, previousKey = '') {
        const person = activeSchedulePerson();
        const events = getScheduleEventsForPerson(person?.id);
        const prevKey = String(previousKey || scheduleSessionSelectionKey(event) || '').trim();
        if (prevKey) {
            const matched = events.find((row) => scheduleSessionSelectionKey(row) === prevKey);
            if (matched) return matched;
        }
        if (isWorkSessionScheduleEvent(event)) {
            return events.find((row) => String(row?.activityEntryId || '').trim() === String(event.activityEntryId || '').trim()
                && String(row?.activityId || '').trim() === String(event.activityId || '').trim()) || null;
        }
        return null;
    }

    function findScheduleSessionBlockElement(event, previousKey = '') {
        const prevKey = String(previousKey || scheduleSessionSelectionKey(event) || '').trim();
        if (prevKey) {
            const byKey = document.querySelector(`[data-schedule-session-key="${prevKey}"]`);
            if (byKey) return byKey;
        }
        if (isWorkSessionScheduleEvent(event)) {
            const entryId = String(event.activityEntryId || '').trim();
            const activityId = String(event.activityId || '').trim();
            if (!entryId) return null;
            if (activityId) {
                const scoped = document.querySelector(`[data-event-type="school_activity"][data-activity-entry-id="${entryId}"][data-activity-id="${activityId}"]`);
                if (scoped) return scoped;
            }
            return document.querySelector(`[data-event-type="school_activity"][data-activity-entry-id="${entryId}"]`);
        }
        return null;
    }

    function rerenderScheduleSessionBlockFromState(event, { previousKey } = {}) {
        const prevKey = String(previousKey || scheduleSessionSelectionKey(event) || '').trim();
        const updated = findScheduleEventInState(event, prevKey);
        const block = findScheduleSessionBlockElement(event, prevKey);
        if (!updated || !block) return false;
        const mode = normalizedScheduleViewMode();
        const html = mode === 'timeline'
            ? buildScheduleHorizontalBlockInner(updated)
            : buildScheduleVerticalBlockInner(updated);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html.trim();
        const next = wrapper.firstElementChild;
        if (!next) return false;
        block.replaceWith(next);
        return true;
    }

    function patchSavedClassSessionEventInState(event, updates = {}) {
        return patchScheduleEventInState(event, updates);
    }

    async function applySavedSessionScheduleUpdate({
        event,
        lookupSessionDate,
        date,
        startTime,
        endTime,
        durationHours,
        forceConflicts = false,
        mutationToken = null,
        deferPostUpdate = false,
        skipLoading = false,
        errorElementId = ''
    } = {}) {
        if (!canDragCreateSessions || !event) return false;
        const sessionId = String(event.sessionId || '').trim();
        const sessionLookupDate = String(lookupSessionDate || event.date || '').trim();
        const resolvedEnd = endTime || (scheduleCalendarCore?.addDurationToTime
            ? scheduleCalendarCore.addDurationToTime(startTime, durationHours || event.duration || 1)
            : startTime);
        const errorEl = (errorElementId && document.getElementById(errorElementId))
            || document.getElementById('scheduleDraftEditError')
            || document.getElementById('scheduleDraftMoveError');
        let loadingShown = false;
        try {
            if (!skipLoading && typeof window.showLoading === 'function') {
                window.showLoading(forceConflicts === true ? 'Saving session schedule...' : 'Updating session schedule...');
                loadingShown = true;
            }
            const res = await fetch(SCHEDULE_UPDATE_CLASS_SESSION_SCHEDULE_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-AJAX-Request': 'true' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    classId: event.classId,
                    sessionId: event.sessionId,
                    sessionDate: sessionLookupDate,
                    date,
                    startTime,
                    endTime: resolvedEnd,
                    forceConflicts: forceConflicts === true
                })
            });
            const result = await res.json();
            if (res.status === 409 && result.code === 'SESSION_METADATA_CONFLICTS' && forceConflicts !== true) {
                if (loadingShown && typeof window.hideLoading === 'function') window.hideLoading({ force: true });
                loadingShown = false;
                if (deferPostUpdate) {
                    const message = result.message || 'Schedule conflicts were detected. No changes were applied.';
                    if (errorEl) {
                        errorEl.textContent = message;
                        errorEl.classList.remove('d-none');
                    } else if (typeof uiAlert === 'function') {
                        uiAlert(message, 'Schedule conflict', { icon: 'warning' });
                    }
                    revertSavedSessionScheduleInState(event, sessionLookupDate);
                    return false;
                }
                const conflicts = Array.isArray(result.data?.conflicts) ? result.data.conflicts : [];
                const lines = conflicts.slice(0, 5).map((row) => {
                    const parts = [row?.date, row?.existTime, row?.teacherName, row?.conflictClass].filter(Boolean);
                    return parts.join(' · ');
                }).join('\n');
                const confirmed = typeof uiConfirm === 'function'
                    ? await uiConfirm(`${result.message || 'Schedule conflicts were detected.'}${lines ? `\n\n${lines}` : ''}\n\nSave anyway?`, 'Schedule conflict', {
                        icon: 'warning',
                        cancelText: 'Cancel',
                        confirmText: 'Save anyway',
                        confirmClass: 'btn-warning btn-md'
                    })
                    : false;
                if (confirmed) {
                    return applySavedSessionScheduleUpdate({
                        event,
                        lookupSessionDate: sessionLookupDate,
                        date,
                        startTime,
                        endTime: resolvedEnd,
                        durationHours,
                        forceConflicts: true,
                        mutationToken,
                        deferPostUpdate,
                        skipLoading,
                        errorElementId
                    });
                }
                revertSavedSessionScheduleInState(event, sessionLookupDate);
                return false;
            }
            if (!res.ok || result.status !== 'success') {
                const message = result.message
                    || (result.code === 'SESSION_DATE_MOVE_BLOCKED' ? 'This session cannot be moved to another date.'
                        : result.code === 'SESSION_TIME_CHANGE_BLOCKED' ? 'This session time cannot be changed.'
                            : 'Unable to update session schedule.');
                if (errorEl) {
                    errorEl.textContent = message;
                    errorEl.classList.remove('d-none');
                } else if (typeof uiAlert === 'function') {
                    uiAlert(message, 'Update session', { icon: 'error' });
                }
                revertSavedSessionScheduleInState(event, sessionLookupDate);
                return false;
            }
            if (!isLatestScheduleSessionMutation(sessionId, mutationToken)) {
                return false;
            }
            const session = result.session || {};
            patchSavedClassSessionEventInState(
                { ...event, date: sessionLookupDate },
                {
                    date: session.date || date,
                    start: session.startTime || startTime,
                    end: session.endTime || resolvedEnd,
                    duration: session.durationHours || durationHours
                }
            );
            if (!deferPostUpdate) {
                hideScheduleDraftEditOverlay();
                hideScheduleDraftMoveOverlay();
                refreshScheduleActiveView();
                const person = activeSchedulePerson();
                if (person?.id) await acknowledgeLocalScheduleMutation(person);
            }
            return true;
        } catch (error) {
            const message = error.message || 'Unable to update session schedule.';
            if (errorEl) {
                errorEl.textContent = message;
                errorEl.classList.remove('d-none');
            } else if (typeof uiAlert === 'function') {
                uiAlert(message, 'Update session', { icon: 'error' });
            }
            revertSavedSessionScheduleInState(event, sessionLookupDate);
            return false;
        } finally {
            if (loadingShown && typeof window.hideLoading === 'function') window.hideLoading({ force: true });
        }
    }

    async function applyClassSessionStatusUpdate(event, status) {
        if (!canDragCreateSessions || !event || !status) return false;
        if (!canScheduleSessionChangeStatus(event)) {
            if (typeof uiAlert === 'function') {
                uiAlert(formatSessionManagementBlockerMessage(event, 'This session status cannot be changed from Master Schedule.'), 'Session status', { icon: 'warning' });
            }
            return false;
        }
        const previousKey = scheduleSessionSelectionKey(event);
        if (typeof window.showLoading === 'function') window.showLoading('Updating session status...');
        try {
            const res = await fetch(SCHEDULE_UPDATE_CLASS_SESSION_STATUS_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-AJAX-Request': 'true' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    classId: event.classId,
                    sessionId: event.sessionId,
                    sessionDate: event.date,
                    status
                })
            });
            const result = await res.json();
            if (result.code === 'MANAGE_SESSION_REQUIRED') {
                window.open(buildSessionManagerUrlForEvent(event), '_blank', 'noopener');
                return false;
            }
            if (!res.ok || result.status !== 'success') {
                if (typeof uiAlert === 'function') uiAlert(result.message || 'Unable to update session status.', 'Session status', { icon: 'error' });
                return false;
            }
            const session = result.session || {};
            patchScheduleEventInState(event, { status: session.status || status });
            hideScheduleSessionContextMenu();
            if (!rerenderScheduleSessionBlockFromState(event, { previousKey })) {
                refreshScheduleActiveView();
            }
            const person = activeSchedulePerson();
            if (person?.id) await acknowledgeLocalScheduleMutation(person);
            return true;
        } catch (error) {
            if (typeof uiAlert === 'function') uiAlert(error.message || 'Unable to update session status.', 'Session status', { icon: 'error' });
            return false;
        } finally {
            if (typeof window.hideLoading === 'function') window.hideLoading({ force: true });
        }
    }

    async function applyWorkSessionStatusUpdate(event, item) {
        if (!canDragCreateSessions || !event || !item) return false;
        const person = activeSchedulePerson();
        if (!person?.id) return false;
        const previousKey = scheduleSessionSelectionKey(event);
        const completionStatus = String(item.getAttribute('data-work-completion-status') || '').trim();
        const assigneeStatus = String(item.getAttribute('data-work-assignee-status') || '').trim();
        const body = {
            activityId: event.activityId,
            entryId: event.activityEntryId,
            personId: person.id
        };
        if (completionStatus) body.completionStatus = completionStatus;
        if (assigneeStatus) body.status = assigneeStatus;
        if (typeof window.showLoading === 'function') window.showLoading('Updating work session status...');
        try {
            const res = await fetch(SCHEDULE_UPDATE_WORK_SESSION_SCHEDULE_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-AJAX-Request': 'true' },
                credentials: 'same-origin',
                body: JSON.stringify(body)
            });
            const result = await res.json();
            if (!res.ok || result.status !== 'success') {
                if (typeof uiAlert === 'function') uiAlert(result.message || 'Unable to update work session.', 'Work session', { icon: 'error' });
                return false;
            }
            const entry = result.data?.entry || {};
            const nextStatus = completionStatus === 'completed'
                ? 'completed'
                : (completionStatus === 'pending' ? 'pending_completion' : (assigneeStatus || event.status));
            patchScheduleEventInState(event, {
                status: nextStatus,
                completionStatus: completionStatus || event.completionStatus,
                statusLabel: entry.statusLabel || event.statusLabel
            });
            hideScheduleSessionContextMenu();
            if (!rerenderScheduleSessionBlockFromState(event, { previousKey })) {
                refreshScheduleActiveView();
            }
            const person = activeSchedulePerson();
            if (person?.id) await acknowledgeLocalScheduleMutation(person);
            return true;
        } catch (error) {
            if (typeof uiAlert === 'function') uiAlert(error.message || 'Unable to update work session.', 'Work session', { icon: 'error' });
            return false;
        } finally {
            if (typeof window.hideLoading === 'function') window.hideLoading({ force: true });
        }
    }

    function buildSessionManagerUrlForEvent(event) {
        const detailsUrl = String(getEventDetailsUrl(event) || '').trim();
        if (detailsUrl) return detailsUrl;
        const classId = encodeURIComponent(String(event?.classId || '').trim());
        const sessionId = encodeURIComponent(String(event?.sessionId || '').trim());
        return `/school/classes/${classId}/sessions/${sessionId}`;
    }

    function buildRollingEnrollmentUrlForClass(classId) {
        const id = String(classId || '').trim();
        if (!id) return '';
        return `/school/classes/${encodeURIComponent(id)}/rolling-enrollment`;
    }

    function renderScheduleSessionListModalTable(rows, columns) {
        const list = Array.isArray(rows) ? rows : [];
        if (!list.length) {
            return '<div class="p-4 text-center text-muted">No students found for this session.</div>';
        }
        const head = columns.map((col) => `<th>${escapeHtml(col.label)}</th>`).join('');
        const body = list.map((row) => {
            const cells = columns.map((col) => `<td>${col.render(row)}</td>`).join('');
            return `<tr>${cells}</tr>`;
        }).join('');
        return `<div class="table-responsive"><table class="table table-sm table-hover align-middle mb-0 schedule-session-context-table"><thead class="table-light"><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    }

    function buildScheduleSessionModalSubtitle(session) {
        const parts = [];
        if (session?.className) parts.push(session.className);
        if (session?.date) parts.push(session.date);
        const time = formatScheduleClockRange(session?.start, session?.end);
        if (time && time !== '—') parts.push(time);
        if (session?.status) parts.push(formatStatusLabel(session.status));
        return parts.join(' · ');
    }

    let scheduleSessionContextEvent = null;
    let scheduleSessionContextMenuSuppressDismissUntil = 0;
    let scheduleSessionAttendanceModalInstance = null;
    let scheduleSessionEnrollmentModalInstance = null;
    let scheduleSessionEnrollmentModalEvent = null;
    let scheduleSessionEnrollmentUseCurrentDate = false;

    function closeScheduleSessionContextStatusPicker() {
        document.getElementById('scheduleSessionContextStatusPicker')?.classList.add('d-none');
        document.getElementById('scheduleSessionContextMenu')?.classList.remove('is-status-picker-open');
        const chipBtn = document.getElementById('scheduleSessionContextStatusChip');
        if (chipBtn) chipBtn.setAttribute('aria-expanded', 'false');
    }

    function isScheduleSessionContextStatusItemActionable(event, item) {
        if (!item || item.isCurrent) return false;
        if (!canDragCreateSessions || !isScheduleEventMutableUnderClassFocus(event)) return false;
        if (isWorkSessionScheduleEvent(event)) return true;
        return canScheduleSessionChangeStatus(event);
    }

    function buildScheduleSessionContextStatusPickerItemHtml(event, item) {
        const attrs = [
            `data-schedule-session-status="${escapeHtml(item.code)}"`,
            item.requiresManageSession ? 'data-requires-manage-session="1"' : '',
            item.completionStatus ? `data-work-completion-status="${escapeHtml(item.completionStatus)}"` : '',
            item.assigneeStatus ? `data-work-assignee-status="${escapeHtml(item.assigneeStatus)}"` : ''
        ].filter(Boolean).join(' ');
        const chipStyle = isWorkSessionScheduleEvent(event)
            ? ''
            : `style="background:${escapeHtml(item.colorBg)};color:${escapeHtml(item.colorText)};border-color:${escapeHtml(item.colorBorder)};"`;
        return `<button type="button" class="schedule-session-context-status-picker-item" role="menuitem" ${attrs}><span class="schedule-session-context-status-chip" ${chipStyle}>${escapeHtml(item.label)}</span></button>`;
    }

    function hideScheduleSessionContextMenu() {
        const menu = document.getElementById('scheduleSessionContextMenu');
        if (!menu) return;
        closeScheduleSessionContextStatusPicker();
        menu.classList.add('d-none');
        menu.classList.remove('show');
        menu.setAttribute('aria-hidden', 'true');
        scheduleSessionContextEvent = null;
    }

    function renderScheduleSessionContextStatusList(event) {
        const container = document.getElementById('scheduleSessionContextStatusList');
        if (!container) return;
        const items = isWorkSessionScheduleEvent(event)
            ? buildWorkSessionStatusMenuItems(event)
            : buildScheduleSessionStatusMenuItems(event);
        if (!items.length) {
            container.innerHTML = '<div class="schedule-session-context-status-empty">No statuses available</div>';
            return;
        }
        const current = items.find((item) => item.isCurrent) || items[0];
        const changeableItems = items.filter((item) => isScheduleSessionContextStatusItemActionable(event, item));
        const canChangeStatus = changeableItems.length > 0;
        const chipBtnStyle = isWorkSessionScheduleEvent(event)
            ? ''
            : `style="background:${escapeHtml(current.colorBg)};color:${escapeHtml(current.colorText)};border-color:${escapeHtml(current.colorBorder)};"`;
        const pickerHtml = changeableItems.map((item) => buildScheduleSessionContextStatusPickerItemHtml(event, item)).join('');
        const chevron = canChangeStatus
            ? '<i class="bi bi-chevron-down schedule-session-context-status-chip-toggle-chevron" aria-hidden="true"></i>'
            : '';
        container.innerHTML = `
            <div class="schedule-session-context-status-host">
                <button type="button" id="scheduleSessionContextStatusChip" class="schedule-session-context-status-chip-toggle"
                    ${chipBtnStyle}
                    ${canChangeStatus ? 'aria-haspopup="true" aria-expanded="false"' : 'disabled'}
                    title="${canChangeStatus ? 'Change session status' : 'Session status'}">
                    <span class="schedule-session-context-status-chip-label">${escapeHtml(current.label)}</span>
                    ${chevron}
                </button>
                <div id="scheduleSessionContextStatusPicker" class="schedule-session-context-status-picker d-none" role="menu">
                    ${pickerHtml}
                </div>
            </div>
        `;
    }

    function renderScheduleSessionContextMenuHeader(event) {
        const titleEl = document.getElementById('scheduleSessionContextMenuTitle');
        const metaEl = document.getElementById('scheduleSessionContextMenuMeta');
        if (!titleEl || !metaEl || !event) return;
        const classLabel = String(event?.className || '').trim();
        const displayedTitle = (isClassSessionScheduleEvent(event) && classLabel)
            ? classLabel
            : getEventTitle(event);
        titleEl.textContent = displayedTitle;
        const classId = String(event?.classId || '').trim();
        const canOpenClassForm = Boolean(classId) && isClassSessionScheduleEvent(event);
        titleEl.classList.toggle('is-navigable', canOpenClassForm);
        titleEl.disabled = !canOpenClassForm;
        titleEl.title = canOpenClassForm ? 'Open class form (opens in new tab)' : '';
        const meta = [
            String(event?.date || '').trim(),
            formatScheduleClockRange(event?.start, event?.end),
            formatStatusLabel(event?.status)
        ].filter((part) => part && part !== '—').join(' · ');
        metaEl.textContent = meta;
        metaEl.classList.toggle('d-none', !meta);
    }

    function appendScheduleSessionInfoRow(rows, label, value) {
        const cleaned = normalizeScheduleTooltipValue(value);
        if (!cleaned) return;
        rows.push(
            '<div class="schedule-session-info-row"><dt>'
            + escapeHtml(label)
            + '</dt><dd>'
            + escapeHtml(cleaned)
            + '</dd></div>'
        );
    }

    function formatScheduleRegistrationMode(mode) {
        const token = String(mode || '').trim().toLowerCase();
        if (token === 'rolling') return 'Rolling';
        if (token === 'term_based') return 'Term-based';
        return '';
    }

    function buildScheduleSessionContextInfoHtml(event) {
        const lifecycle = event?.classLifecycle && typeof event.classLifecycle === 'object' ? event.classLifecycle : {};
        const classRows = [];
        appendScheduleSessionInfoRow(classRows, 'Name', event?.className);
        appendScheduleSessionInfoRow(classRows, 'Registration', formatScheduleRegistrationMode(lifecycle.registrationMode));
        const cycleStart = String(lifecycle.cycleStartDate || '').trim();
        const cycleEnd = String(lifecycle.cycleEndDate || '').trim();
        if (cycleStart || cycleEnd) {
            const cycleLabel = [formatScheduleDateLabel(cycleStart), formatScheduleDateLabel(cycleEnd)].filter(Boolean).join(' – ');
            appendScheduleSessionInfoRow(classRows, 'Cycle', cycleLabel);
        }
        if (Number(lifecycle.cycleNo) > 0) {
            appendScheduleSessionInfoRow(classRows, 'Cycle number', String(lifecycle.cycleNo));
        }
        appendScheduleSessionInfoRow(classRows, 'Student', event?.soloStudentName || event?.singleStudentName);

        const sessionRows = [];
        appendScheduleSessionInfoRow(sessionRows, 'Date', formatScheduleDateLabel(event?.date));
        const timeLabel = formatScheduleClockRange(event?.start, event?.end);
        if (timeLabel && timeLabel !== '-') appendScheduleSessionInfoRow(sessionRows, 'Time', timeLabel);
        const hours = Number(event?.duration);
        if (Number.isFinite(hours) && hours > 0) {
            appendScheduleSessionInfoRow(sessionRows, 'Duration', `${hours.toFixed(2)} h`);
        }
        appendScheduleSessionInfoRow(sessionRows, 'Status', formatStatusLabel(event?.status));
        appendScheduleSessionInfoRow(sessionRows, 'Role', event?.roleLabel);
        if (window.ScheduleCompletionDisplay && window.ScheduleCompletionDisplay.isMakeupRequiredDisplayEvent(event)) {
            appendScheduleSessionInfoRow(sessionRows, 'Make-up', window.ScheduleCompletionDisplay.MAKEUP_DISPLAY_TEXT);
        }
        if (event?.locked === true) appendScheduleSessionInfoRow(sessionRows, 'Locked', 'Yes');

        const section = (title, rows) => {
            if (!rows.length) return '';
            return '<section class="schedule-session-info-section"><h6>'
                + escapeHtml(title)
                + '</h6><dl>'
                + rows.join('')
                + '</dl></section>';
        };
        return section('Class', classRows) + section('Session', sessionRows) + buildScheduleSessionCoTeacherInfoHtml(event);
    }

    function buildScheduleSessionCoTeacherInfoHtml(event) {
        const rows = Array.isArray(event?.coTeachers) ? event.coTeachers : [];
        const mainTeacherId = String(event?.mainTeacherId || '').trim();
        const mainTeacherName = String(event?.mainTeacherName || '').trim();
        const blocks = [];
        if (mainTeacherName) {
            const mainLines = [];
            appendScheduleSessionInfoRow(mainLines, 'Name', mainTeacherName);
            appendScheduleSessionInfoRow(mainLines, 'Role', 'Main teacher');
            blocks.push('<div class="schedule-session-info-coteacher"><dl>' + mainLines.join('') + '</dl></div>');
        }
        if (!blocks.length && !rows.length) return '';
        blocks.push(...rows.filter((row) => {
            const personId = String(row?.personId || '').trim();
            return !personId || !mainTeacherId || personId !== mainTeacherId;
        }).map((row) => {
            const lines = [];
            appendScheduleSessionInfoRow(lines, 'Name', row?.name);
            appendScheduleSessionInfoRow(lines, 'Role', row?.roleLabel);
            appendScheduleSessionInfoRow(lines, 'Can edit', row?.canEdit === true ? 'Yes' : 'No');
            appendScheduleSessionInfoRow(lines, 'Pay', row?.paid === false ? 'Unpaid' : 'Paid');
            if (row?.paid !== false && row?.paidHours != null && row?.paidHours !== '') {
                const hours = Number(row.paidHours);
                if (Number.isFinite(hours)) appendScheduleSessionInfoRow(lines, 'Paid hours', `${hours.toFixed(2)} h`);
            }
            return '<div class="schedule-session-info-coteacher"><dl>' + lines.join('') + '</dl></div>';
        }));
        return '<section class="schedule-session-info-section"><h6>Teachers</h6>' + blocks.join('') + '</section>';
    }

    function openScheduleSessionContextInfoModal(event) {
        const modalEl = document.getElementById('scheduleSessionContextInfoModal');
        const body = document.getElementById('scheduleSessionContextInfoModalBody');
        const subtitle = document.getElementById('scheduleSessionContextInfoModalSubtitle');
        if (!modalEl || !body || !event || !window.bootstrap?.Modal) return;
        if (subtitle) subtitle.textContent = String(event.className || event.title || '').trim();
        body.innerHTML = buildScheduleSessionContextInfoHtml(event) || '<p class="text-muted mb-0">No details are available for this item.</p>';
        window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }

    function showScheduleSessionContextMenu(event, mouseEvent) {
        const menu = document.getElementById('scheduleSessionContextMenu');
        const isClass = isClassSessionScheduleEvent(event);
        const isWork = isWorkSessionScheduleEvent(event);
        if (!menu || (!isClass && !isWork)) return;
        scheduleSessionContextEvent = event;
        const isBulkSavedContext = isSavedSessionMultiSelectContextMenu(event);
        const bulkSection = document.getElementById('scheduleSessionContextMenuBulk');
        const bulkDivider = document.getElementById('scheduleSessionContextMenuBulkDivider');
        if (isBulkSavedContext) {
            const selectedCount = countActiveScheduleSelectedSessions();
            const titleEl = document.getElementById('scheduleSessionContextMenuTitle');
            const metaEl = document.getElementById('scheduleSessionContextMenuMeta');
            if (titleEl) titleEl.textContent = `${String(selectedCount)} sessions selected`;
            if (metaEl) {
                metaEl.textContent = 'Edit or delete selected sessions';
                metaEl.classList.remove('d-none');
            }
            const filterId = String(scheduleState.activeClassFilterId || '').trim();
            const selectedClassId = activeScheduleSelectedClassId();
            const bulkClassActionAllowed = !filterId || (selectedClassId && selectedClassId === filterId);
            const bulkEditBtn = document.getElementById('btn_scheduleSessionContextEditSelected');
            if (bulkEditBtn) {
                bulkEditBtn.disabled = !bulkClassActionAllowed;
                bulkEditBtn.classList.toggle('disabled', !bulkClassActionAllowed);
                bulkEditBtn.setAttribute('aria-disabled', bulkClassActionAllowed ? 'false' : 'true');
            }
            const bulkDeleteBtn = document.getElementById('btn_scheduleSessionContextDeleteSelected');
            if (bulkDeleteBtn) {
                bulkDeleteBtn.disabled = !bulkClassActionAllowed;
                bulkDeleteBtn.classList.toggle('disabled', !bulkClassActionAllowed);
                bulkDeleteBtn.setAttribute('aria-disabled', bulkClassActionAllowed ? 'false' : 'true');
            }
            bulkSection?.classList.remove('d-none');
            bulkDivider?.classList.remove('d-none');
            document.getElementById('btn_scheduleSessionContextEdit')?.classList.add('d-none');
            document.getElementById('btn_scheduleSessionContextMove')?.classList.add('d-none');
            document.getElementById('btn_scheduleSessionContextAttendance')?.classList.add('d-none');
            document.getElementById('btn_scheduleSessionContextEnrollment')?.classList.add('d-none');
            document.getElementById('btn_scheduleSessionContextOpenSession')?.classList.add('d-none');
            document.getElementById('btn_scheduleSessionContextRollingEnrollment')?.classList.add('d-none');
            document.querySelectorAll('#scheduleSessionContextMenu .schedule-session-context-menu-divider').forEach((el) => {
                if (el.id === 'scheduleSessionContextMenuBulkDivider') return;
                el.classList.add('d-none');
            });
            document.querySelector('#scheduleSessionContextMenu .schedule-session-context-menu-section-label')?.classList.add('d-none');
            document.getElementById('btn_scheduleSessionContextInfo')?.classList.add('d-none');
            document.getElementById('scheduleSessionContextStatusList')?.classList.add('d-none');
            document.getElementById('btn_scheduleSessionContextSelect')?.classList.add('d-none');
        } else {
            renderScheduleSessionContextMenuHeader(event);
            renderScheduleSessionContextStatusList(event);
            bulkSection?.classList.add('d-none');
            bulkDivider?.classList.add('d-none');
            document.getElementById('btn_scheduleSessionContextSelect')?.classList.toggle('d-none', !isClass);
            const quickEdit = isClass && isScheduledClassSessionScheduleEditable(event);
            const canMoveDate = isClass && canScheduleSessionChangeDate(event);
            document.getElementById('btn_scheduleSessionContextEdit')?.classList.toggle('d-none', !quickEdit);
            document.getElementById('btn_scheduleSessionContextMove')?.classList.toggle('d-none', !(quickEdit && canMoveDate));
            document.getElementById('btn_scheduleSessionContextAttendance')?.classList.toggle('d-none', !isClass);
            document.getElementById('btn_scheduleSessionContextEnrollment')?.classList.toggle('d-none', !isClass);
            const manageUrl = buildSessionManagerUrlForEvent(event);
            document.getElementById('btn_scheduleSessionContextOpenSession')?.classList.toggle('d-none', !manageUrl);
            const classId = String(event?.classId || '').trim();
            const rollingEnrollmentUrl = buildRollingEnrollmentUrlForClass(classId);
            document.getElementById('btn_scheduleSessionContextRollingEnrollment')?.classList.toggle(
                'd-none',
                !(canOpenRollingEnrollment && isClass && rollingEnrollmentUrl)
            );
            document.querySelectorAll('#scheduleSessionContextMenu .schedule-session-context-menu-divider').forEach((el) => {
                if (el.id === 'scheduleSessionContextMenuBulkDivider') return;
                el.classList.remove('d-none');
            });
            document.querySelector('#scheduleSessionContextMenu .schedule-session-context-menu-section-label')?.classList.remove('d-none');
            document.getElementById('btn_scheduleSessionContextInfo')?.classList.remove('d-none');
            document.getElementById('scheduleSessionContextStatusList')?.classList.remove('d-none');
            const mutable = isScheduleEventMutableUnderClassFocus(event);
            ['btn_scheduleSessionContextEdit', 'btn_scheduleSessionContextMove'].forEach((btnId) => {
                const btn = document.getElementById(btnId);
                if (!btn || btn.classList.contains('d-none')) return;
                btn.disabled = !mutable;
                btn.classList.toggle('disabled', !mutable);
                btn.setAttribute('aria-disabled', mutable ? 'false' : 'true');
            });
        }
        const menuWidth = 280;
        const menuHeight = Math.min(window.innerHeight - 16, 420);
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
        scheduleSessionContextMenuSuppressDismissUntil = Date.now() + 250;
    }

    async function loadScheduleSessionAttendanceModal(event) {
        const bodyEl = document.getElementById('scheduleSessionAttendanceModalBody');
        const subtitleEl = document.getElementById('scheduleSessionAttendanceModalSubtitle');
        if (!bodyEl || !event) return;
        bodyEl.innerHTML = '<div class="p-4 text-center text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading attendance list...</div>';
        if (subtitleEl) subtitleEl.textContent = buildScheduleSessionModalSubtitle({ className: event.className, date: event.date, start: event.start, end: event.end, status: event.status });
        const params = new URLSearchParams({
            classId: String(event.classId || '').trim(),
            sessionId: String(event.sessionId || '').trim()
        });
        const res = await fetch(`/school/schedules/api/session-attendance-list?${params.toString()}`, {
            headers: { 'X-AJAX-Request': 'true' },
            cache: 'no-store'
        });
        const result = await res.json();
        if (!res.ok || result.status !== 'success') throw new Error(result.message || 'Unable to load attendance list.');
        if (subtitleEl) subtitleEl.textContent = buildScheduleSessionModalSubtitle(result.session || {});
        bodyEl.innerHTML = renderScheduleSessionListModalTable(result.students, [
            { label: 'Student', render: (row) => `<div class="fw-semibold">${escapeHtml(row.name || row.personId || '')}</div>` },
            { label: 'Attendance', render: (row) => scheduleBuildAttendanceMarkHtml(row) },
            { label: 'Applicability', render: (row) => `<span class="small text-muted">${escapeHtml(row.applicability || '')}</span>` }
        ]);
    }

    async function openScheduleSessionAttendanceModal(event) {
        const modalEl = document.getElementById('scheduleSessionAttendanceModal');
        const openSessionEl = document.getElementById('btn_scheduleSessionAttendanceOpenSession');
        const openMatrixEl = document.getElementById('btn_scheduleSessionAttendanceOpenMatrix');
        if (!modalEl || !event) return;
        if (!scheduleSessionAttendanceModalInstance && window.bootstrap?.Modal) {
            scheduleSessionAttendanceModalInstance = window.bootstrap.Modal.getOrCreateInstance(modalEl);
        }
        if (openSessionEl) openSessionEl.href = buildSessionManagerUrlForEvent(event);
        if (openMatrixEl) openMatrixEl.href = buildAttendanceMatrixUrlForSession(event);
        scheduleSessionAttendanceModalInstance?.show();
        try {
            await loadScheduleSessionAttendanceModal(event);
        } catch (error) {
            const bodyEl = document.getElementById('scheduleSessionAttendanceModalBody');
            if (bodyEl) bodyEl.innerHTML = `<div class="p-4 text-danger">${escapeHtml(error.message || 'Unable to load attendance list.')}</div>`;
        }
    }

    function renderScheduleEnrollmentAsOfNote(result) {
        const noteEl = document.getElementById('scheduleSessionEnrollmentAsOfNote');
        if (!noteEl) return;
        const sessionDate = String(result?.session?.date || '').trim();
        const asOfDate = String(result?.asOfDate || '').trim();
        if (!asOfDate || asOfDate === sessionDate) {
            noteEl.textContent = `Usage shown as of session date (${formatScheduleDateLabel(sessionDate)}).`;
            return;
        }
        noteEl.textContent = `Usage shown as of today (${formatScheduleDateLabel(asOfDate)}).`;
    }

    async function loadScheduleSessionEnrollmentModal(event, { useCurrentDate = false } = {}) {
        const bodyEl = document.getElementById('scheduleSessionEnrollmentModalBody');
        const subtitleEl = document.getElementById('scheduleSessionEnrollmentModalSubtitle');
        const refreshBtn = document.getElementById('btn_scheduleSessionEnrollmentRefreshCurrent');
        if (!bodyEl || !event) return;
        scheduleSessionEnrollmentUseCurrentDate = useCurrentDate === true;
        bodyEl.innerHTML = '<div class="p-4 text-center text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading enrollment list...</div>';
        if (subtitleEl) subtitleEl.textContent = buildScheduleSessionModalSubtitle({ className: event.className, date: event.date, start: event.start, end: event.end, status: event.status });
        const params = new URLSearchParams({
            classId: String(event.classId || '').trim(),
            sessionId: String(event.sessionId || '').trim()
        });
        if (useCurrentDate) params.set('useCurrentDate', '1');
        const res = await fetch(`/school/schedules/api/session-enrollment-list?${params.toString()}`, {
            headers: { 'X-AJAX-Request': 'true' },
            cache: 'no-store'
        });
        const result = await res.json();
        if (!res.ok || result.status !== 'success') throw new Error(result.message || 'Unable to load enrollment list.');
        if (subtitleEl) subtitleEl.textContent = buildScheduleSessionModalSubtitle(result.session || {});
        renderScheduleEnrollmentAsOfNote(result);
        if (refreshBtn) {
            refreshBtn.disabled = result.asOfMode === 'current';
            refreshBtn.textContent = result.asOfMode === 'current' ? 'Showing today' : 'Update to today';
        }
        bodyEl.innerHTML = renderScheduleSessionListModalTable(result.students, [
            { label: 'Student', render: (row) => `<div class="fw-semibold">${escapeHtml(row.name || row.personId || '')}</div>` },
            { label: 'Enrollment window', render: (row) => `<span class="small">${escapeHtml(formatScheduleEnrollmentDateRange(row))}</span>` },
            { label: 'Target', render: (row) => `<span class="small text-muted">${escapeHtml(row.capLabel || '—')}</span>` },
            { label: 'Consumed', render: (row) => `<span class="small">${escapeHtml(row.consumedLabel || '—')}</span>` },
            { label: 'Remaining', render: (row) => `<span class="small">${escapeHtml(row.remainingLabel || '—')}</span>` }
        ]);
    }

    async function openScheduleSessionEnrollmentModal(event) {
        const modalEl = document.getElementById('scheduleSessionEnrollmentModal');
        const openSessionEl = document.getElementById('btn_scheduleSessionEnrollmentOpenSession');
        if (!modalEl || !event) return;
        scheduleSessionEnrollmentModalEvent = event;
        if (!scheduleSessionEnrollmentModalInstance && window.bootstrap?.Modal) {
            scheduleSessionEnrollmentModalInstance = window.bootstrap.Modal.getOrCreateInstance(modalEl);
        }
        if (openSessionEl) openSessionEl.href = buildSessionManagerUrlForEvent(event);
        scheduleSessionEnrollmentModalInstance?.show();
        try {
            await loadScheduleSessionEnrollmentModal(event, { useCurrentDate: false });
        } catch (error) {
            const bodyEl = document.getElementById('scheduleSessionEnrollmentModalBody');
            if (bodyEl) bodyEl.innerHTML = `<div class="p-4 text-danger">${escapeHtml(error.message || 'Unable to load enrollment list.')}</div>`;
        }
    }

    function bindScheduleSessionContextMenu() {
        const menu = document.getElementById('scheduleSessionContextMenu');
        const visualArea = document.getElementById('visualDisplayArea');
        if (!menu || !visualArea) return;

        bindScheduleSessionBulkSelectModal();

        visualArea.addEventListener('contextmenu', (mouseEvent) => {
            if (mouseEvent.target.closest('[data-schedule-session-select], .schedule-session-select')) return;
            const draftEvent = resolveScheduleDraftEventFromTarget(mouseEvent.target);
            if (draftEvent) {
                mouseEvent.preventDefault();
                mouseEvent.stopPropagation();
                showScheduleDraftSessionContextMenu(draftEvent, mouseEvent, 'timeline');
                return;
            }
            const event = resolveScheduleContextEventFromTarget(mouseEvent.target);
            if (!event) {
                const workEvent = resolveWorkSessionEventFromTarget(mouseEvent.target);
                if (!workEvent) return;
                mouseEvent.preventDefault();
                mouseEvent.stopPropagation();
                showScheduleSessionContextMenu(workEvent, mouseEvent);
                return;
            }
            mouseEvent.preventDefault();
            mouseEvent.stopPropagation();
            showScheduleSessionContextMenu(event, mouseEvent);
        });

        visualArea.addEventListener('dblclick', (mouseEvent) => {
            if (isScheduleDraftEditInteractionTarget(mouseEvent.target)) return;
            if (canDragCreateSessions) {
                if (openScheduleDraftEditFromTarget(mouseEvent.target, 'timeline')) {
                    mouseEvent.preventDefault();
                    mouseEvent.stopPropagation();
                    return;
                }
                const savedEvent = resolveScheduleContextEventFromTarget(mouseEvent.target);
                if (savedEvent && isScheduledClassSessionForQuickEdit(savedEvent)) {
                    mouseEvent.preventDefault();
                    mouseEvent.stopPropagation();
                    openScheduleSavedSessionEditOverlay(savedEvent);
                }
                return;
            }
            const savedEvent = resolveScheduleContextEventFromTarget(mouseEvent.target)
                || resolveWorkSessionEventFromTarget(mouseEvent.target);
            if (!savedEvent) return;
            const manageUrl = buildSessionManagerUrlForEvent(savedEvent);
            if (!manageUrl) return;
            mouseEvent.preventDefault();
            mouseEvent.stopPropagation();
            window.open(manageUrl, '_blank', 'noopener');
        });

        document.getElementById('btn_scheduleSessionContextOpenSession')?.addEventListener('click', (clickEvent) => {
            clickEvent.preventDefault();
            const event = scheduleSessionContextEvent;
            hideScheduleSessionContextMenu();
            if (!event) return;
        document.getElementById('scheduleSessionContextMenuTitle')?.addEventListener('click', (clickEvent) => {
            const titleEl = clickEvent.currentTarget;
            if (!titleEl || titleEl.disabled || !titleEl.classList.contains('is-navigable')) return;
            clickEvent.preventDefault();
            const event = scheduleSessionContextEvent;
            hideScheduleSessionContextMenu();
            const classId = String(event?.classId || '').trim();
            if (!classId) return;
            window.open(`/school/classes/edit/${encodeURIComponent(classId)}`, '_blank', 'noopener');
        });

            const manageUrl = buildSessionManagerUrlForEvent(event);
            if (manageUrl) window.open(manageUrl, '_blank', 'noopener');
        });
        document.getElementById('btn_scheduleSessionContextRollingEnrollment')?.addEventListener('click', (clickEvent) => {
            clickEvent.preventDefault();
            const event = scheduleSessionContextEvent;
            hideScheduleSessionContextMenu();
            if (!event) return;
            const rollingUrl = buildRollingEnrollmentUrlForClass(event?.classId);
            if (rollingUrl) window.open(rollingUrl, '_blank', 'noopener');
        });
        document.getElementById('btn_scheduleSessionContextDeleteSelected')?.addEventListener('click', (clickEvent) => {
            clickEvent.preventDefault();
            hideScheduleSessionContextMenu();
            void openScheduleBulkSessionDeleteModal();
        });
        document.getElementById('btn_scheduleSessionContextInfo')?.addEventListener('click', (clickEvent) => {
            clickEvent.preventDefault();
            const event = scheduleSessionContextEvent;
            hideScheduleSessionContextMenu();
            if (!event) return;
            openScheduleSessionContextInfoModal(event);
        });
        document.getElementById('btn_scheduleSessionContextEditSelected')?.addEventListener('click', (clickEvent) => {
            clickEvent.preventDefault();
            hideScheduleSessionContextMenu();
            openScheduleSavedBulkEditOverlay();
        });

        document.getElementById('scheduleSavedBulkEditOverlay')?.addEventListener('click', (clickEvent) => {
            if (clickEvent.target.closest('[data-saved-bulk-edit-dismiss]')) {
                hideScheduleSavedBulkEditOverlay();
                return;
            }
            if (clickEvent.target.closest('#btn_scheduleSavedBulkEditApply')) {
                clickEvent.preventDefault();
                void applyScheduleSavedBulkEditOverlay();
                return;
            }
            const durationBtn = clickEvent.target.closest('[data-saved-bulk-edit-duration]');
            if (durationBtn) {
                document.querySelectorAll('#scheduleSavedBulkEditDurationGroup [data-saved-bulk-edit-duration]').forEach((btn) => {
                    btn.classList.toggle('active', btn === durationBtn);
                });
            }
        });
        document.getElementById('btn_scheduleSavedBulkEditApply')?.addEventListener('click', (clickEvent) => {
            clickEvent.preventDefault();
            void applyScheduleSavedBulkEditOverlay();
        });

        document.getElementById('btn_scheduleSessionContextEdit')?.addEventListener('click', (clickEvent) => {
            clickEvent.preventDefault();
            const event = scheduleSessionContextEvent;
            hideScheduleSessionContextMenu();
            if (event) openScheduleSavedSessionEditOverlay(event);
        });
        document.getElementById('btn_scheduleSessionContextMove')?.addEventListener('click', (clickEvent) => {
            clickEvent.preventDefault();
            const event = scheduleSessionContextEvent;
            hideScheduleSessionContextMenu();
            if (event) openScheduleSavedSessionMoveOverlay(event);
        });
        document.getElementById('scheduleSessionContextStatusList')?.addEventListener('click', async (clickEvent) => {
            const chipBtn = clickEvent.target.closest('#scheduleSessionContextStatusChip');
            if (chipBtn && !chipBtn.disabled) {
                clickEvent.preventDefault();
                clickEvent.stopPropagation();
                const picker = document.getElementById('scheduleSessionContextStatusPicker');
                if (!picker) return;
                const willOpen = picker.classList.contains('d-none');
                closeScheduleSessionContextStatusPicker();
                if (willOpen) {
                    document.getElementById('scheduleSessionContextMenu')?.classList.add('is-status-picker-open');
                    picker.classList.remove('d-none');
                    chipBtn.setAttribute('aria-expanded', 'true');
                    scheduleSessionContextMenuSuppressDismissUntil = Date.now() + 250;
                }
                return;
            }
            if (!canDragCreateSessions) return;
            const item = clickEvent.target.closest('[data-schedule-session-status]');
            if (!item) return;
            const event = scheduleSessionContextEvent;
            if (!event) return;
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
            closeScheduleSessionContextStatusPicker();
            if (item.getAttribute('data-requires-manage-session') === '1') {
                hideScheduleSessionContextMenu();
                const manageUrl = isWorkSessionScheduleEvent(event)
                    ? String(event.detailsUrl || '').trim()
                    : buildSessionManagerUrlForEvent(event);
                if (manageUrl) window.open(manageUrl, '_blank', 'noopener');
                return;
            }
            if (isWorkSessionScheduleEvent(event)) {
                await applyWorkSessionStatusUpdate(event, item);
                return;
            }
            await applyClassSessionStatusUpdate(event, item.getAttribute('data-schedule-session-status'));
        });

        document.getElementById('btn_scheduleSessionContextAttendance')?.addEventListener('click', async (clickEvent) => {
            clickEvent.preventDefault();
            const event = scheduleSessionContextEvent;
            hideScheduleSessionContextMenu();
            if (event) await openScheduleSessionAttendanceModal(event);
        });
        document.getElementById('btn_scheduleSessionContextEnrollment')?.addEventListener('click', async (clickEvent) => {
            clickEvent.preventDefault();
            const event = scheduleSessionContextEvent;
            hideScheduleSessionContextMenu();
            if (event) await openScheduleSessionEnrollmentModal(event);
        });
        document.getElementById('btn_scheduleSessionContextSelect')?.addEventListener('click', (clickEvent) => {
            clickEvent.preventDefault();
            const event = scheduleSessionContextEvent;
            hideScheduleSessionContextMenu();
            if (event) openScheduleSessionBulkSelectModal(event, { mode: 'saved', source: 'timeline' });
        });
        document.getElementById('btn_scheduleSessionEnrollmentRefreshCurrent')?.addEventListener('click', async (clickEvent) => {
            clickEvent.preventDefault();
            const event = scheduleSessionEnrollmentModalEvent;
            if (!event) return;
            try {
                await loadScheduleSessionEnrollmentModal(event, { useCurrentDate: true });
            } catch (error) {
                const bodyEl = document.getElementById('scheduleSessionEnrollmentModalBody');
                if (bodyEl) bodyEl.innerHTML = `<div class="p-4 text-danger">${escapeHtml(error.message || 'Unable to load enrollment list.')}</div>`;
            }
        });

        document.addEventListener('click', (clickEvent) => {
            if (Date.now() < scheduleSessionContextMenuSuppressDismissUntil) return;
            if (!menu || menu.classList.contains('d-none')) return;
            if (clickEvent.target.closest('#scheduleSessionContextMenu')) return;
            hideScheduleSessionContextMenu();
        });
        document.addEventListener('scroll', hideScheduleSessionContextMenu, true);
        document.addEventListener('keydown', (keyEvent) => {
            if (keyEvent.key === 'Escape') {
                hideScheduleSessionContextMenu();
                hideScheduleSavedBulkEditOverlay();
            }
        });
    }

    function scheduleSessionClassIdFromKey(key) {
        return String(key || '').split('::')[0] || '';
    }

    function getActiveScheduleSelectionSet() {
        const person = activeSchedulePerson();
        if (!person?.id) return new Set();
        if (!(scheduleState.selectedSessionKeysByPersonId[person.id] instanceof Set)) {
            scheduleState.selectedSessionKeysByPersonId[person.id] = new Set();
        }
        return scheduleState.selectedSessionKeysByPersonId[person.id];
    }

    function getActiveDraftSelectionSet() {
        if (!canDragCreateSessions) return new Set();
        const person = activeSchedulePerson();
        if (!person?.id) return new Set();
        if (!(scheduleState.selectedDraftSessionIdsByPersonId[person.id] instanceof Set)) {
            scheduleState.selectedDraftSessionIdsByPersonId[person.id] = new Set();
        }
        return scheduleState.selectedDraftSessionIdsByPersonId[person.id];
    }

    function countActiveDraftSelectedSessions() {
        return getActiveDraftSelectionSet().size;
    }

    function isDraftSessionSelected(event) {
        const sessionId = String(event?.sessionId || event?.id || '').trim();
        if (!sessionId) return false;
        return getActiveDraftSelectionSet().has(sessionId);
    }

    function getSelectedDraftEvents() {
        const person = activeSchedulePerson();
        if (!person?.id) return [];
        const selectedIds = getActiveDraftSelectionSet();
        if (!selectedIds.size) return [];
        const drafts = Array.isArray(scheduleState.draftEventsByPersonId?.[person.id])
            ? scheduleState.draftEventsByPersonId[person.id]
            : [];
        return drafts.filter((ev) => {
            const id = String(ev?.sessionId || ev?.id || '').trim();
            return id && selectedIds.has(id);
        });
    }

    function hasPendingDraftWorkForPerson(personId) {
        const id = String(personId || '').trim();
        if (!id) return false;
        const drafts = scheduleState.draftEventsByPersonId?.[id];
        return Array.isArray(drafts) && drafts.length > 0;
    }

    function toggleDraftSessionSelection(sessionId) {
        const id = String(sessionId || '').trim();
        if (!id || !canDragCreateSessions) return;
        if (countActiveScheduleSelectedSessions() > 0) {
            if (typeof uiAlert === 'function') {
                uiAlert('Clear saved session selections before selecting staged sessions.', 'Staged session selection', { icon: 'info' });
            }
            return;
        }
        const selectionSet = getActiveDraftSelectionSet();
        if (selectionSet.has(id)) selectionSet.delete(id);
        else selectionSet.add(id);
        refreshScheduleActiveView();
    }

    function resolveStagingPassSessionIds(event, source = 'timeline') {
        const sessionId = String(event?.sessionId || event?.id || '').trim();
        const attemptId = String(event?.stagingAttemptId || '').trim();
        const classId = String(event?.classId || '').trim();
        if (source === 'partialModal' && window.SessionEnrollmentCalendarModal?.getStagedSessionIdsForAttempt) {
            return window.SessionEnrollmentCalendarModal.getStagedSessionIdsForAttempt(attemptId, sessionId, classId);
        }
        const person = activeSchedulePerson();
        if (!person?.id) return [];
        const drafts = (scheduleState.draftEventsByPersonId[person.id] || []).filter((ev) => ev?.isDraft === true);
        if (attemptId) {
            return drafts
                .filter((ev) => String(ev?.stagingAttemptId || '').trim() === attemptId)
                .map((ev) => String(ev?.sessionId || ev?.id || '').trim())
                .filter(Boolean);
        }
        const batches = getDraftBatchesForPerson(person.id, classId);
        const batch = batches.find((row) => (row?.sessionIds || []).some((sid) => String(sid || '').trim() === sessionId));
        if (batch) {
            const idSet = new Set((batch.sessionIds || []).map((sid) => String(sid || '').trim()).filter(Boolean));
            return drafts
                .map((ev) => String(ev?.sessionId || ev?.id || '').trim())
                .filter((id) => id && idSet.has(id));
        }
        return sessionId ? [sessionId] : [];
    }

    function selectDraftSessionsInStagingPass(event, source = 'timeline') {
        if (!canDragCreateSessions || !event) return;
        if (countActiveScheduleSelectedSessions() > 0) {
            if (typeof uiAlert === 'function') {
                uiAlert('Clear saved session selections before selecting staged sessions.', 'Staged session selection', { icon: 'info' });
            }
            return;
        }
        const ids = resolveStagingPassSessionIds(event, source);
        if (!ids.length) return;
        const selectionSet = getActiveDraftSelectionSet();
        selectionSet.clear();
        ids.forEach((id) => selectionSet.add(id));
        refreshScheduleActiveView();
        if (source === 'partialModal' && window.SessionEnrollmentCalendarModal?.refreshPartialPickerFromState) {
            window.SessionEnrollmentCalendarModal.refreshPartialPickerFromState();
        } else {
            syncPartialModalFromTimelineDrafts();
        }
    }

    function clearActiveDraftSessionSelection() {
        const person = activeSchedulePerson();
        if (person?.id) scheduleState.selectedDraftSessionIdsByPersonId[person.id] = new Set();
        refreshScheduleActiveView();
    }

    let scheduleBulkSelectAnchor = null;
    let scheduleBulkSelectMode = '';
    let scheduleBulkSelectSource = 'timeline';
    let scheduleSessionBulkSelectModalInstance = null;

    function normalizeBulkSelectIsoDate(value) {
        const cleaned = scheduleCalendarCore?.normalizeDateOnly?.(value) || String(value || '').trim();
        return cleaned;
    }

    function compareBulkSelectIsoDates(a, b) {
        const left = normalizeBulkSelectIsoDate(a);
        const right = normalizeBulkSelectIsoDate(b);
        if (!left || !right) return 0;
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
    }

    function unionIsoDateRange(current, extraStart, extraEnd) {
        const curStart = normalizeBulkSelectIsoDate(current?.startDate);
        const curEnd = normalizeBulkSelectIsoDate(current?.endDate);
        const extStart = normalizeBulkSelectIsoDate(extraStart);
        const extEnd = normalizeBulkSelectIsoDate(extraEnd);
        if (!curStart || !curEnd) {
            if (!extStart || !extEnd) return { startDate: '', endDate: '', changed: false };
            return { startDate: extStart, endDate: extEnd, changed: true };
        }
        let startDate = curStart;
        let endDate = curEnd;
        if (extStart && compareBulkSelectIsoDates(extStart, startDate) < 0) startDate = extStart;
        if (extEnd && compareBulkSelectIsoDates(extEnd, endDate) > 0) endDate = extEnd;
        const changed = startDate !== curStart || endDate !== curEnd;
        return { startDate, endDate, changed };
    }

    function dateExtentsFromEvents(events) {
        const list = Array.isArray(events) ? events : [];
        let minDate = '';
        let maxDate = '';
        list.forEach((ev) => {
            const date = normalizeBulkSelectIsoDate(ev?.date);
            if (!date) return;
            if (!minDate || compareBulkSelectIsoDates(date, minDate) < 0) minDate = date;
            if (!maxDate || compareBulkSelectIsoDates(date, maxDate) > 0) maxDate = date;
        });
        if (!minDate || !maxDate) return { minDate: null, maxDate: null };
        return { minDate, maxDate };
    }

    function defaultBulkSelectStopDate(anchorDate) {
        const anchor = normalizeBulkSelectIsoDate(anchorDate);
        const rangeEnd = normalizeBulkSelectIsoDate(getScheduleRange().endDate);
        const anchorPlusThreeMonths = anchor && scheduleCalendarCore?.addDaysIso
            ? scheduleCalendarCore.addDaysIso(anchor, 90)
            : rangeEnd;
        if (rangeEnd && anchorPlusThreeMonths) {
            return rangeEnd < anchorPlusThreeMonths ? rangeEnd : anchorPlusThreeMonths;
        }
        return rangeEnd || anchorPlusThreeMonths || anchor;
    }

    function listBulkSelectCandidateEvents(personId, mode) {
        const pid = String(personId || '').trim();
        if (!pid) return [];
        if (mode === 'draft') {
            return (scheduleState.draftEventsByPersonId?.[pid] || []).filter((ev) => ev?.isDraft === true);
        }
        const base = Array.isArray(scheduleState.eventsByPersonId[pid]) ? scheduleState.eventsByPersonId[pid] : [];
        return base.filter((ev) => isClassSessionScheduleEvent(ev));
    }

    function bulkSelectIsoWeekday(dateStr) {
        const date = normalizeBulkSelectIsoDate(dateStr);
        if (!date) return null;
        const dow = new Date(`${date}T12:00:00`).getDay();
        return Number.isFinite(dow) ? dow : null;
    }

    function normalizeBulkSelectWeekdays(weekdays) {
        if (!Array.isArray(weekdays)) return null;
        const set = new Set();
        weekdays.forEach((value) => {
            const n = Number(value);
            if (Number.isFinite(n) && n >= 0 && n <= 6) set.add(n);
        });
        return Array.from(set);
    }

    function readBulkSelectWeekdays() {
        const selected = [];
        document.querySelectorAll('[data-bulk-select-weekday]:checked').forEach((input) => {
            const n = Number(input.getAttribute('data-bulk-select-weekday'));
            if (Number.isFinite(n) && n >= 0 && n <= 6) selected.push(n);
        });
        return normalizeBulkSelectWeekdays(selected) || [];
    }

    function setBulkSelectWeekdayChecks(selectedWeekdays) {
        const selected = new Set(normalizeBulkSelectWeekdays(selectedWeekdays) || [0, 1, 2, 3, 4, 5, 6]);
        document.querySelectorAll('[data-bulk-select-weekday]').forEach((input) => {
            const dow = Number(input.getAttribute('data-bulk-select-weekday'));
            input.checked = selected.has(dow);
        });
    }

    function readBulkSelectModalSelectionMode() {
        const checked = document.querySelector('input[name="scheduleSessionBulkSelectMode"]:checked');
        return String(checked?.value || 'count').trim() === 'date' ? 'date' : 'count';
    }

    function syncBulkSelectModalModeUi() {
        const selectionMode = readBulkSelectModalSelectionMode();
        const stopInput = document.getElementById('scheduleSessionBulkSelectStopDate');
        const countInput = document.getElementById('scheduleSessionBulkSelectCount');
        const isDateMode = selectionMode === 'date';
        if (stopInput) stopInput.disabled = !isDateMode;
        if (countInput) countInput.disabled = isDateMode;
    }

    function bulkSelectCountModeHorizonEnd(anchorDate) {
        const anchor = normalizeBulkSelectIsoDate(anchorDate);
        const rangeEnd = normalizeBulkSelectIsoDate(getScheduleRange().endDate);
        const twoYearsOut = anchor && scheduleCalendarCore?.addDaysIso
            ? scheduleCalendarCore.addDaysIso(anchor, 730)
            : rangeEnd;
        let end = rangeEnd || twoYearsOut || anchor;
        if (twoYearsOut && compareBulkSelectIsoDates(twoYearsOut, end) > 0) end = twoYearsOut;
        return end || anchor;
    }

    function collectMatchingSessionsForBulkSelect(anchorEvent, options = {}) {
        const anchor = anchorEvent && typeof anchorEvent === 'object' ? anchorEvent : null;
        const mode = String(options.mode || 'saved').trim() === 'draft' ? 'draft' : 'saved';
        const selectionMode = String(options.selectionMode || 'count').trim() === 'date' ? 'date' : 'count';
        const stopDate = selectionMode === 'date' ? normalizeBulkSelectIsoDate(options.stopDate) : '';
        const maxCount = selectionMode === 'count'
            ? Math.max(0, Math.floor(Number(options.maxCount) || 0))
            : 0;
        const weekdayFilter = normalizeBulkSelectWeekdays(options.weekdays);
        const weekdaySet = weekdayFilter ? new Set(weekdayFilter) : null;
        const person = activeSchedulePerson();
        if (!anchor || !person?.id) return [];
        if (selectionMode === 'date' && !stopDate) return [];
        if (selectionMode === 'count' && !maxCount) return [];
        if (weekdayFilter && !weekdayFilter.length) return [];
        const anchorDate = normalizeBulkSelectIsoDate(anchor.date);
        const classId = String(anchor.classId || '').trim();
        const anchorStartMin = timeToMinutes(anchor.start);
        const anchorEndMin = timeToMinutes(anchor.end);
        if (!anchorDate || !classId || anchorEndMin <= anchorStartMin) return [];
        if (selectionMode === 'date' && compareBulkSelectIsoDates(stopDate, anchorDate) < 0) return [];
        const candidates = listBulkSelectCandidateEvents(person.id, mode)
            .filter((ev) => String(ev?.classId || '').trim() === classId)
            .filter((ev) => {
                const date = normalizeBulkSelectIsoDate(ev?.date);
                if (!date) return false;
                if (compareBulkSelectIsoDates(date, anchorDate) < 0) return false;
                if (selectionMode === 'date' && compareBulkSelectIsoDates(date, stopDate) > 0) return false;
                if (weekdaySet) {
                    const dow = bulkSelectIsoWeekday(date);
                    if (dow == null || !weekdaySet.has(dow)) return false;
                }
                const startMin = timeToMinutes(ev?.start);
                return startMin >= anchorStartMin && startMin <= anchorEndMin;
            })
            .sort((a, b) => {
                const dateCmp = compareBulkSelectIsoDates(a?.date, b?.date);
                if (dateCmp !== 0) return dateCmp;
                return timeToMinutes(a?.start) - timeToMinutes(b?.start);
            });
        if (selectionMode === 'count') return candidates.slice(0, maxCount);
        return candidates;
    }

    function buildBulkSelectCollectOptions(anchorEvent, criteria) {
        const anchorDate = normalizeBulkSelectIsoDate(anchorEvent?.date);
        const selectionMode = criteria.selectionMode === 'date' ? 'date' : 'count';
        return {
            mode: criteria.mode,
            selectionMode,
            stopDate: selectionMode === 'date' ? criteria.stopDate : '',
            maxCount: selectionMode === 'count' ? criteria.maxCount : 0,
            weekdays: Array.isArray(criteria.weekdays) ? criteria.weekdays.slice() : undefined
        };
    }

    function bulkSelectRangeEndForProvisionalLoad(anchorDate, criteria) {
        if (criteria.selectionMode === 'date') return normalizeBulkSelectIsoDate(criteria.stopDate);
        return bulkSelectCountModeHorizonEnd(anchorDate);
    }

    function applyBulkSessionSelection(matches = [], options = {}) {
        const mode = String(options.mode || 'saved').trim() === 'draft' ? 'draft' : 'saved';
        const source = options.source === 'partialModal' ? 'partialModal' : 'timeline';
        const list = Array.isArray(matches) ? matches : [];
        if (!list.length) return 0;
        if (mode === 'draft') {
            if (countActiveScheduleSelectedSessions() > 0) {
                if (typeof uiAlert === 'function') {
                    uiAlert('Clear saved session selections before selecting staged sessions.', 'Staged session selection', { icon: 'info' });
                }
                return 0;
            }
            const selectionSet = getActiveDraftSelectionSet();
            selectionSet.clear();
            list.forEach((ev) => {
                const id = String(ev?.sessionId || ev?.id || '').trim();
                if (id) selectionSet.add(id);
            });
            refreshScheduleActiveView();
            if (source === 'partialModal' && window.SessionEnrollmentCalendarModal?.refreshPartialPickerFromState) {
                window.SessionEnrollmentCalendarModal.refreshPartialPickerFromState();
            } else {
                syncPartialModalFromTimelineDrafts();
            }
            return list.length;
        }
        if (countActiveDraftSelectedSessions() > 0) {
            if (typeof uiAlert === 'function') {
                uiAlert('Clear staged session selections before selecting saved sessions.', 'Saved session selection', { icon: 'info' });
            }
            return 0;
        }
        const selectionSet = getActiveScheduleSelectionSet();
        selectionSet.clear();
        let added = 0;
        const anchorClassId = String(options.anchorClassId || '').trim();
        list.forEach((ev) => {
            const key = scheduleSessionSelectionKey(ev);
            if (!key) return;
            const classId = String(ev?.classId || '').trim();
            const allowed = anchorClassId && classId === anchorClassId
                ? isClassSessionScheduleEvent(ev) && countActiveDraftSelectedSessions() === 0
                : canSelectScheduleSession(ev);
            if (!allowed) return;
            selectionSet.add(key);
            added += 1;
        });
        refreshScheduleActiveView();
        return added;
    }

    function canOpenScheduleSessionBulkSelectModal(anchorEvent, mode = 'saved') {
        if (!anchorEvent) return false;
        if (mode === 'draft') {
            if (!canDragCreateSessions || anchorEvent.isDraft !== true) return false;
            return countActiveScheduleSelectedSessions() === 0;
        }
        if (!canSelectAnyPerson || !isClassSessionScheduleEvent(anchorEvent)) return false;
        return countActiveDraftSelectedSessions() === 0;
    }

    function openScheduleSessionBulkSelectModal(anchorEvent, options = {}) {
        const mode = String(options.mode || 'saved').trim() === 'draft' ? 'draft' : 'saved';
        const source = options.source === 'partialModal' ? 'partialModal' : 'timeline';
        if (!canOpenScheduleSessionBulkSelectModal(anchorEvent, mode)) {
            if (mode === 'draft' && countActiveScheduleSelectedSessions() > 0) {
                if (typeof uiAlert === 'function') {
                    uiAlert('Clear saved session selections before selecting staged sessions.', 'Staged session selection', { icon: 'info' });
                }
            } else if (mode === 'saved' && countActiveDraftSelectedSessions() > 0) {
                if (typeof uiAlert === 'function') {
                    uiAlert('Clear staged session selections before selecting saved sessions.', 'Saved session selection', { icon: 'info' });
                }
            }
            return;
        }
        const modalEl = document.getElementById('scheduleSessionBulkSelectModal');
        if (!modalEl || !anchorEvent) return;
        scheduleBulkSelectAnchor = anchorEvent;
        scheduleBulkSelectMode = mode;
        scheduleBulkSelectSource = source;
        const hintEl = document.getElementById('scheduleSessionBulkSelectHint');
        const stopInput = document.getElementById('scheduleSessionBulkSelectStopDate');
        const countInput = document.getElementById('scheduleSessionBulkSelectCount');
        const modeCountRadio = document.getElementById('scheduleSessionBulkSelectModeCount');
        const anchorDate = normalizeBulkSelectIsoDate(anchorEvent.date);
        const defaultStop = defaultBulkSelectStopDate(anchorDate);
        if (modeCountRadio) modeCountRadio.checked = true;
        setBulkSelectWeekdayChecks([0, 1, 2, 3, 4, 5, 6]);
        syncBulkSelectModalModeUi();
        if (stopInput) {
            stopInput.min = anchorDate || '';
            stopInput.value = defaultStop || anchorDate || '';
        }
        const previewDateMatches = collectMatchingSessionsForBulkSelect(anchorEvent, {
            mode,
            selectionMode: 'date',
            stopDate: stopInput?.value || defaultStop,
            maxCount: 0,
            weekdays: readBulkSelectWeekdays()
        });
        const defaultCount = Math.min(10, Math.max(1, previewDateMatches.length || 1));
        if (countInput) countInput.value = String(defaultCount);
        if (hintEl) {
            const classLabel = getEventTitle(anchorEvent);
            const timeLabel = formatScheduleClockRange(anchorEvent.start, anchorEvent.end);
            hintEl.textContent = `Anchor: ${classLabel} · ${anchorDate || '—'} · ${timeLabel}. Choose session count or an end date (one at a time).`;
        }
        if (!scheduleSessionBulkSelectModalInstance && window.bootstrap?.Modal) {
            scheduleSessionBulkSelectModalInstance = window.bootstrap.Modal.getOrCreateInstance(modalEl);
        }
        scheduleSessionBulkSelectModalInstance?.show();
    }

    async function applyScheduleSessionBulkSelectModal() {
        const anchor = scheduleBulkSelectAnchor;
        const mode = scheduleBulkSelectMode;
        const source = scheduleBulkSelectSource;
        const stopInput = document.getElementById('scheduleSessionBulkSelectStopDate');
        const countInput = document.getElementById('scheduleSessionBulkSelectCount');
        const selectionMode = readBulkSelectModalSelectionMode();
        const stopDate = normalizeBulkSelectIsoDate(stopInput?.value);
        const maxCount = Math.floor(Number(countInput?.value) || 0);
        const weekdays = readBulkSelectWeekdays();
        const anchorDate = normalizeBulkSelectIsoDate(anchor?.date);
        const criteria = { mode, selectionMode, stopDate, maxCount, weekdays };
        if (!anchor) return;
        if (!weekdays.length) {
            await uiAlert('Select at least one weekday.', 'Select sessions', { icon: 'info' });
            return;
        }
        if (selectionMode === 'count' && maxCount < 1) {
            await uiAlert('Enter how many sessions to select (at least 1).', 'Select sessions', { icon: 'info' });
            return;
        }
        if (selectionMode === 'date' && !stopDate) {
            await uiAlert('Choose an end date for selection.', 'Select sessions', { icon: 'info' });
            return;
        }
        if (selectionMode === 'date' && compareBulkSelectIsoDates(stopDate, anchorDate) < 0) {
            await uiAlert('End date must be on or after the selected session date.', 'Select sessions', { icon: 'info' });
            return;
        }
        const anchorStartMin = timeToMinutes(anchor.start);
        const anchorEndMin = timeToMinutes(anchor.end);
        if (anchorEndMin <= anchorStartMin) {
            await uiAlert('The selected session must have a valid start and end time.', 'Select sessions', { icon: 'info' });
            return;
        }
        const collectOpts = buildBulkSelectCollectOptions(anchor, criteria);
        const provisionalEnd = bulkSelectRangeEndForProvisionalLoad(anchorDate, criteria);
        let rangeReloaded = false;
        const provisional = await ensureScheduleViewRangeForBulkSelect({
            startDate: anchorDate,
            endDate: provisionalEnd,
            mode
        });
        if (provisional.reloaded) rangeReloaded = true;
        let matches = collectMatchingSessionsForBulkSelect(anchor, collectOpts);
        if (!matches.length) {
            await uiAlert('No sessions match the selected weekdays, time window, and date range.', 'Select sessions', { icon: 'info' });
            return;
        }
        const extents = dateExtentsFromEvents(matches);
        if (extents.minDate && extents.maxDate) {
            const finalRange = await ensureScheduleViewRangeForBulkSelect({
                startDate: extents.minDate,
                endDate: extents.maxDate,
                mode
            });
            if (finalRange.reloaded) rangeReloaded = true;
        }
        if (rangeReloaded) {
            matches = collectMatchingSessionsForBulkSelect(anchor, collectOpts);
            if (!matches.length) {
                await uiAlert('No sessions match the selected weekdays, time window, and date range.', 'Select sessions', { icon: 'info' });
                return;
            }
        }
        const added = applyBulkSessionSelection(matches, {
            mode,
            source,
            anchorClassId: String(anchor?.classId || '').trim()
        });
        if (!added) return;
        const firstMatchDate = normalizeBulkSelectIsoDate(matches[0]?.date);
        if (firstMatchDate) {
            scheduleState.pendingStagedScrollDate = firstMatchDate;
            focusScheduleTimelineOnFirstStagedSession(firstMatchDate);
        }
        scheduleSessionBulkSelectModalInstance?.hide();
        scheduleBulkSelectAnchor = null;
    }

    function bindScheduleSessionBulkSelectModal() {
        if (bindScheduleSessionBulkSelectModal.bound) return;
        bindScheduleSessionBulkSelectModal.bound = true;
        document.querySelectorAll('input[name="scheduleSessionBulkSelectMode"]').forEach((input) => {
            input.addEventListener('change', () => syncBulkSelectModalModeUi());
        });
        document.getElementById('btn_scheduleSessionBulkSelectApply')?.addEventListener('click', (clickEvent) => {
            clickEvent.preventDefault();
            void applyScheduleSessionBulkSelectModal();
        });
    }

    function activeScheduleSelectedClassId() {
        const firstKey = Array.from(getActiveScheduleSelectionSet())[0] || '';
        return scheduleSessionClassIdFromKey(firstKey);
    }

    function canSelectScheduleSession(event) {
        if (event?.isDraft === true) return false;
        if (countActiveDraftSelectedSessions() > 0) return false;
        if (!isScheduleEventInActiveClassFocus(event)) return false;
        const key = scheduleSessionSelectionKey(event);
        if (!key) return false;
        const classId = String(event?.classId || '').trim();
        const selectedClassId = activeScheduleSelectedClassId();
        return !selectedClassId || selectedClassId === classId || getActiveScheduleSelectionSet().has(key);
    }

    function countActiveScheduleSelectedSessions() {
        return getActiveScheduleSelectionSet().size;
    }

    function countTotalScheduleSelectedSessions() {
        return countActiveScheduleSelectedSessions() + countActiveDraftSelectedSessions();
    }

    function formatScheduleSelectionChipLabel() {
        const savedCount = countActiveScheduleSelectedSessions();
        const draftCount = countActiveDraftSelectedSessions();
        if (draftCount > 0) return `${draftCount} staged selected`;
        if (savedCount > 0) return `${savedCount} selected`;
        return '0 selected';
    }

    function scheduleSessionPartsFromKey(key) {
        const parts = String(key || '').split('::');
        return {
            classId: parts[0] || '',
            sessionId: parts[1] || '',
            sessionDate: parts[2] || ''
        };
    }

    function buildSelectedSavedSessionDeletePayload() {
        const keys = Array.from(getActiveScheduleSelectionSet());
        if (!keys.length) return null;
        const classId = activeScheduleSelectedClassId();
        const sessions = keys.map((key) => {
            const parts = scheduleSessionPartsFromKey(key);
            return { sessionId: parts.sessionId, sessionDate: parts.sessionDate };
        }).filter((row) => row.sessionId);
        if (!classId || !sessions.length) return null;
        return { classId, sessions };
    }

    function buildScheduleSelectionChipHtml() {
        const total = countTotalScheduleSelectedSessions();
        const label = formatScheduleSelectionChipLabel();
        const title = total ? 'Clear all selections' : 'No sessions selected';
        return `<button type="button" class="schedule-selected-count-pill ${total ? '' : 'is-empty'}" data-schedule-clear-all-selected title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" ${total ? '' : 'disabled'}><i class="bi bi-check2-square" aria-hidden="true"></i><span data-schedule-selected-count>${escapeHtml(label)}</span></button>`;
    }

    function buildScheduleActiveClassChipHtml() {
        const person = activeSchedulePerson();
        const classes = Array.isArray(scheduleState.activeClasses) ? scheduleState.activeClasses : [];
        if (!person?.id || !scheduleState.loadedPersonIds.has(person.id)) return '';
        const filterId = String(scheduleState.activeClassFilterId || '').trim();
        const label = escapeHtml(getScheduleActiveClassFilterLabel());
        const menuItems = [
            `<button type="button" class="schedule-active-class-option${filterId ? '' : ' is-selected'}" data-schedule-active-class="" role="menuitem"><span>All Active Classes</span>${filterId ? '' : '<i class="bi bi-check-lg ms-auto" aria-hidden="true"></i>'}</button>`
        ].concat(classes.map((row) => {
            const id = escapeHtml(String(row.id || '').trim());
            const title = escapeHtml(String(row.title || row.id || 'Class').trim());
            const selected = filterId === String(row.id || '').trim();
            return `<button type="button" class="schedule-active-class-option${selected ? ' is-selected' : ''}" data-schedule-active-class="${id}" role="menuitem"><span>${title}</span>${selected ? '<i class="bi bi-check-lg ms-auto" aria-hidden="true"></i>' : ''}</button>`;
        }));
        return `
            <div class="schedule-active-class-popover-host schedule-active-class-popover-host--title-row">
                <button type="button" class="schedule-active-class-chip" data-schedule-active-class-toggle aria-expanded="false" aria-haspopup="true" title="Filter by active class">
                    <i class="bi bi-mortarboard" aria-hidden="true"></i>
                    <span class="schedule-active-class-chip-label">${label}</span>
                    <i class="bi bi-chevron-down schedule-active-class-chip-chevron" aria-hidden="true"></i>
                </button>
                <div class="schedule-active-class-popover" role="menu" aria-label="Active classes">
                    ${menuItems.join('')}
                </div>
            </div>
        `;
    }

    function closeScheduleActiveClassPopover() {
        const host = document.querySelector('.schedule-active-class-popover-host');
        if (!host) return;
        host.querySelector('.schedule-active-class-popover')?.classList.remove('is-open');
        const toggle = host.querySelector('[data-schedule-active-class-toggle]');
        toggle?.setAttribute('aria-expanded', 'false');
        toggle?.classList.remove('active');
    }

    function openScheduleActiveClassPopover() {
        scheduleAdminUi?.closePersonChipColorPopover?.();
        closeScheduleTimeRangePopover();
        closeScheduleDaySizePopover();
        closeScheduleStagedPaddingPopover();
        const host = document.querySelector('.schedule-active-class-popover-host');
        if (!host) return;
        host.querySelector('.schedule-active-class-popover')?.classList.add('is-open');
        const toggle = host.querySelector('[data-schedule-active-class-toggle]');
        toggle?.setAttribute('aria-expanded', 'true');
        toggle?.classList.add('active');
    }

    function toggleScheduleActiveClassPopover() {
        const popover = document.querySelector('.schedule-active-class-popover.is-open');
        if (popover) closeScheduleActiveClassPopover();
        else openScheduleActiveClassPopover();
    }

    function setScheduleActiveClassFilter(classId) {
        scheduleState.activeClassFilterId = String(classId || '').trim();
        closeScheduleActiveClassPopover();
        refreshScheduleActiveView();
    }

    function bindScheduleActiveClassPopoverDismiss() {
        if (bindScheduleActiveClassPopoverDismiss.bound) return;
        bindScheduleActiveClassPopoverDismiss.bound = true;
        document.addEventListener('click', (event) => {
            const host = document.querySelector('.schedule-active-class-popover-host');
            if (!host) return;
            const popover = host.querySelector('.schedule-active-class-popover');
            if (!popover?.classList.contains('is-open')) return;
            if (host.contains(event.target)) return;
            closeScheduleActiveClassPopover();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            closeScheduleActiveClassPopover();
        });
    }

    function renderBulkSessionDeletePreviewHtml(plan) {
        const deletable = Array.isArray(plan?.deletable) ? plan.deletable : [];
        const blocked = Array.isArray(plan?.blocked) ? plan.blocked : [];
        const deletableHtml = deletable.length
            ? '<div class="small fw-semibold text-uppercase text-muted mb-2">Will be deleted</div>'
                + '<ul class="list-group list-group-flush mb-3">'
                + deletable.map((row) => {
                    const datePart = row.date ? ` <span class="text-muted small">(${escapeHtml(row.date)})</span>` : '';
                    return `<li class="list-group-item px-0 py-2"><strong>${escapeHtml(row.label || row.sessionId || 'Session')}</strong>${datePart}</li>`;
                }).join('')
                + '</ul>'
            : '<p class="text-muted small mb-3">No selected sessions can be deleted.</p>';
        const blockedHtml = blocked.length
            ? '<div class="small fw-semibold text-uppercase text-muted mb-2">Cannot be deleted</div>'
                + blocked.map((row) => {
                    const blockers = Array.isArray(row.blockers) ? row.blockers : [];
                    const blockerList = blockers.map((blocker) => {
                        const detail = blocker.detail ? ` <span class="text-muted">(${escapeHtml(blocker.detail)})</span>` : '';
                        return `<li>${escapeHtml(blocker.label || blocker.code || 'Blocked')}${detail}</li>`;
                    }).join('');
                    const datePart = row.date ? ` <span class="text-muted small">(${escapeHtml(row.date)})</span>` : '';
                    return `<div class="border rounded p-3 mb-2 bg-light-subtle"><div class="fw-semibold mb-1">${escapeHtml(row.label || row.sessionId || 'Session')}${datePart}</div><ul class="small mb-0">${blockerList}</ul></div>`;
                }).join('')
            : '';
        const intro = deletable.length
            ? '<p class="text-danger small mb-3">Deleted sessions cannot be undone.</p>'
            : '';
        return intro + deletableHtml + blockedHtml;
    }

    function removeDeletedSessionsFromSelection(deleted = []) {
        const person = activeSchedulePerson();
        if (!person?.id) return;
        const selectionSet = getActiveScheduleSelectionSet();
        (Array.isArray(deleted) ? deleted : []).forEach((row) => {
            const classId = activeScheduleSelectedClassId();
            const sessionId = String(row?.sessionId || '').trim();
            const sessionDate = String(row?.date || row?.sessionDate || '').trim();
            if (!classId || !sessionId) return;
            selectionSet.delete(`${classId}::${sessionId}::${sessionDate}`);
        });
    }

    async function openScheduleBulkSessionDeleteModal(options = {}) {
        if (!canDeleteClassSessions) return;
        const payload = options.payload || buildSelectedSavedSessionDeletePayload();
        if (!payload?.classId || !payload.sessions?.length) {
            if (typeof uiAlert === 'function') await uiAlert('Select one or more saved class sessions to delete.', 'Delete sessions', { icon: 'info' });
            return;
        }

        const modalEl = document.getElementById('scheduleBulkSessionDeleteModal');
        const bodyEl = document.getElementById('scheduleBulkSessionDeleteModalBody');
        const confirmBtn = document.getElementById('btn_scheduleBulkSessionDeleteConfirm');
        if (!modalEl || !bodyEl || !confirmBtn) return;

        bodyEl.innerHTML = '<div class="p-4 text-center text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Checking selected sessions...</div>';
        confirmBtn.classList.add('d-none');
        confirmBtn.disabled = true;
        confirmBtn.onclick = null;

        const bsModal = window.bootstrap?.Modal ? window.bootstrap.Modal.getOrCreateInstance(modalEl) : null;
        bsModal?.show();

        let previewPayload = null;
        let actionStateId = '';
        try {
            const res = await fetch(SCHEDULE_BULK_DELETE_SESSIONS_PREVIEW_API, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-AJAX-Request': 'true',
                    Accept: 'application/json'
                },
                credentials: 'same-origin',
                body: JSON.stringify(payload)
            });
            previewPayload = await res.json().catch(() => ({}));
            if (!res.ok || previewPayload.status !== 'success') {
                throw new Error(previewPayload.message || 'Unable to preview session delete.');
            }
            actionStateId = String(previewPayload.actionStateId || '').trim();
            const plan = previewPayload.data || {};
            bodyEl.innerHTML = renderBulkSessionDeletePreviewHtml(plan);
            const deletableCount = Array.isArray(plan.deletable) ? plan.deletable.length : 0;
            if (deletableCount > 0) {
                confirmBtn.classList.remove('d-none');
                confirmBtn.innerHTML = `<i class="bi bi-trash me-1"></i>Delete ${deletableCount} session${deletableCount === 1 ? '' : 's'}`;
                confirmBtn.disabled = false;
                confirmBtn.onclick = async () => {
                    if (!actionStateId) {
                        if (typeof uiAlert === 'function') await uiAlert('Delete token is missing. Close this dialog and try again.', 'Delete Failed', { icon: 'error' });
                        return;
                    }
                    confirmBtn.disabled = true;
                    let loadingToken = typeof window.showLoading === 'function'
                        ? window.showLoading({ title: 'Deleting Sessions', note: 'Removing selected sessions...', operation: 'Delete sessions' })
                        : null;
                    try {
                        const deleteRes = await fetch(SCHEDULE_BULK_DELETE_SESSIONS_API, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-AJAX-Request': 'true',
                                Accept: 'application/json'
                            },
                            credentials: 'same-origin',
                            body: JSON.stringify({ ...payload, actionStateId })
                        });
                        const deletePayload = await deleteRes.json().catch(() => ({}));
                        if (!deleteRes.ok || deletePayload.status !== 'success') {
                            const err = new Error(deletePayload.message || 'Unable to delete selected sessions.');
                            err.html = /<[^>]+>/.test(String(deletePayload.message || ''));
                            throw err;
                        }
                        const result = deletePayload.data || {};
                        removeDeletedSessionsFromSelection(result.deleted || []);
                        const person = activeSchedulePerson();
                        if (person?.id) {
                            removeSavedClassSessionsFromState(person.id, payload.classId, result.deleted || []);
                            await acknowledgeLocalScheduleMutation(person);
                            refreshScheduleActiveView();
                        }
                        bsModal?.hide();
                        const summaryMessage = String(deletePayload.message || 'Selected sessions deleted.');
                        const blocked = Array.isArray(result.blocked) ? result.blocked : [];
                        if (typeof uiAlert === 'function') {
                            const alertIcon = blocked.length ? 'warning' : 'success';
                            const alertTitle = blocked.length ? 'Sessions Partially Deleted' : 'Sessions Deleted';
                            await uiAlert(summaryMessage, alertTitle, { icon: alertIcon });
                        }
                        if (blocked.length) {
                            const blockedPlan = {
                                deletable: [],
                                blocked
                            };
                            bodyEl.innerHTML = renderBulkSessionDeletePreviewHtml(blockedPlan);
                            confirmBtn.classList.add('d-none');
                            confirmBtn.disabled = true;
                            bsModal?.show();
                        } else {
                            refreshScheduleActiveView();
                        }
                    } catch (error) {
                        if (typeof uiAlert === 'function') {
                            await uiAlert(
                                error.message || 'Unable to delete selected sessions.',
                                'Delete Failed',
                                { icon: 'error', html: error.html === true }
                            );
                        }
                        confirmBtn.disabled = false;
                    } finally {
                        if (loadingToken && typeof window.hideLoading === 'function') window.hideLoading(loadingToken);
                    }
                };
            }
        } catch (error) {
            bodyEl.innerHTML = `<div class="alert alert-danger mb-0">${escapeHtml(error.message || 'Unable to preview session delete.')}</div>`;
        }
    }

    const SCHEDULE_SAVED_BULK_DURATION_CHIPS = [0.5, 1, 1.5, 2, 2.5, 3];

    function nearestScheduleDurationChip(hours) {
        const value = Number(hours || 0);
        let best = SCHEDULE_SAVED_BULK_DURATION_CHIPS[0];
        let bestDiff = Infinity;
        SCHEDULE_SAVED_BULK_DURATION_CHIPS.forEach((chip) => {
            const diff = Math.abs(chip - value);
            if (diff < bestDiff) {
                bestDiff = diff;
                best = chip;
            }
        });
        return best;
    }

    function doesScheduleEventBlockConflicts(event) {
        return event?.scheduleDisplayOnly !== true && event?.blocksConflicts !== false;
    }

    function collectScheduleConflictSessionsForPerson(personId, excludeSessionId = '') {
        const saved = Array.isArray(scheduleState.eventsByPersonId[personId]) ? scheduleState.eventsByPersonId[personId] : [];
        const drafts = Array.isArray(scheduleState.draftEventsByPersonId?.[personId]) ? scheduleState.draftEventsByPersonId[personId] : [];
        const excluded = String(excludeSessionId || '').trim();
        return [...saved.filter((ev) => ev?.isDraft !== true), ...drafts]
            .filter((ev) => doesScheduleEventBlockConflicts(ev))
            .filter((ev) => {
                const id = String(ev?.sessionId || ev?.id || '').trim();
                return !excluded || id !== excluded;
            });
    }

    function getSelectedSavedClassSessionEvents() {
        const person = activeSchedulePerson();
        if (!person?.id) return [];
        const keys = Array.from(getActiveScheduleSelectionSet());
        if (keys.length < 1) return [];
        const classId = activeScheduleSelectedClassId();
        if (!classId) return [];
        const events = getScheduleEventsForPerson(person.id);
        return keys.map((key) => {
            const parts = scheduleSessionPartsFromKey(key);
            if (String(parts.classId || '').trim() !== classId) return null;
            if (key) {
                const matched = events.find((row) => scheduleSessionSelectionKey(row) === key);
                if (matched) return matched;
            }
            return events.find((row) => String(row?.classId || '').trim() === parts.classId
                && String(row?.sessionId || '').trim() === parts.sessionId
                && String(row?.date || '').trim() === parts.sessionDate) || null;
        }).filter((row) => row && isClassSessionScheduleEvent(row));
    }

    function getPendingEnrollMetaForClass(classId) {
        const id = String(classId || '').trim();
        const meta = scheduleState.pendingEnrollMetaByClassId?.[id];
        return meta && typeof meta === 'object' ? { ...meta } : null;
    }

    function setPendingEnrollMetaForClass(classId, meta) {
        const id = String(classId || '').trim();
        if (!id || !meta || typeof meta !== 'object') return;
        if (!scheduleState.pendingEnrollMetaByClassId) scheduleState.pendingEnrollMetaByClassId = {};
        scheduleState.pendingEnrollMetaByClassId[id] = { ...meta };
        if (canDragCreateSessions) schedulePersistDraftBackup();
    }

    function classHasPendingEnrollments(classId) {
        const id = String(classId || '').trim();
        const rows = scheduleState.pendingEnrollStudentsByClassId?.[id];
        return Array.isArray(rows) && rows.length > 0;
    }

    function pendingEnrollmentStudentSignatureForSession(classId, sessionId) {
        const cid = String(classId || '').trim();
        const sid = String(sessionId || '').trim();
        if (!cid || !sid) return '';
        const entries = scheduleState.pendingEnrollStudentsByClassId?.[cid];
        if (!Array.isArray(entries) || !entries.length) return '';
        const studentIds = entries
            .filter((entry) => (Array.isArray(entry?.selectedSessionIds) ? entry.selectedSessionIds : [])
                .some((linkedId) => String(linkedId || '').trim() === sid))
            .map((entry) => String(entry?.students?.[0]?.studentId || entry?.studentId || '').trim())
            .filter(Boolean)
            .sort();
        return studentIds.join('\u0001');
    }

    function draftSessionsShareSamePendingEnrollments(classId, sessionIds) {
        const cid = String(classId || '').trim();
        const ids = (Array.isArray(sessionIds) ? sessionIds : [])
            .map((row) => String(row || '').trim())
            .filter(Boolean);
        if (!cid || !ids.length || !classHasPendingEnrollments(cid)) return false;
        const signatures = ids.map((sessionId) => pendingEnrollmentStudentSignatureForSession(cid, sessionId));
        const first = signatures[0];
        if (!first) return false;
        return signatures.every((signature) => signature === first);
    }

    function canManagePendingEnrollmentsForDraftContext(event, selectedIdsSet) {
        const classId = String(event?.classId || '').trim();
        const sessionId = String(event?.sessionId || event?.id || '').trim();
        if (!classId || !sessionId) return false;
        const selectedIds = selectedIdsSet && typeof selectedIdsSet.has === 'function' ? selectedIdsSet : new Set();
        const contextSessionIds = selectedIds.size >= 2 && selectedIds.has(sessionId)
            ? Array.from(selectedIds)
            : [sessionId];
        return draftSessionsShareSamePendingEnrollments(classId, contextSessionIds);
    }

    function stagedSessionHasPendingEnrollment(event) {
        if (event?.isDraft !== true) return false;
        const classId = String(event?.classId || '').trim();
        const sessionId = String(event?.sessionId || event?.id || '').trim();
        if (!classId || !sessionId) return false;
        const entries = scheduleState.pendingEnrollStudentsByClassId?.[classId];
        if (!Array.isArray(entries) || !entries.length) return false;
        return entries.some((entry) => (Array.isArray(entry?.selectedSessionIds) ? entry.selectedSessionIds : [])
            .some((sid) => String(sid || '').trim() === sessionId));
    }

    function stripDraftSessionSoloDisplayForPendingEnrollments(classId) {
        const cid = String(classId || '').trim();
        if (!cid || !classHasPendingEnrollments(cid)) return 0;
        const linkedSessionIds = new Set();
        getPendingEnrollStudentsForClass(cid).forEach((entry) => {
            (Array.isArray(entry?.selectedSessionIds) ? entry.selectedSessionIds : []).forEach((sid) => {
                const id = String(sid || '').trim();
                if (id) linkedSessionIds.add(id);
            });
        });
        if (!linkedSessionIds.size) return 0;
        let cleared = 0;
        Object.values(scheduleState.draftEventsByPersonId || {}).forEach((rows) => {
            (Array.isArray(rows) ? rows : []).forEach((ev) => {
                if (ev?.isDraft !== true) return;
                if (String(ev?.classId || '').trim() !== cid) return;
                const sid = String(ev?.sessionId || ev?.id || '').trim();
                if (!linkedSessionIds.has(sid)) return;
                if (ev.soloStudentName || ev.singleStudentName || ev.soloStudentId || ev.soloStudentPersonId) {
                    delete ev.soloStudentName;
                    delete ev.singleStudentName;
                    delete ev.soloStudentId;
                    delete ev.soloStudentPersonId;
                    cleared += 1;
                }
            });
        });
        return cleared;
    }

    function stripAllDraftSessionSoloDisplayForPendingEnrollments() {
        Object.keys(scheduleState.pendingEnrollStudentsByClassId || {}).forEach((classId) => {
            stripDraftSessionSoloDisplayForPendingEnrollments(classId);
        });
    }

    function replacePendingEnrollStudentsForClass(classId, entries) {
        const id = String(classId || '').trim();
        if (!id) return;
        if (!scheduleState.pendingEnrollStudentsByClassId) scheduleState.pendingEnrollStudentsByClassId = {};
        const rows = Array.isArray(entries) ? entries.map((row) => ({ ...(row || {}) })) : [];
        if (!rows.length) {
            clearPendingEnrollStudentsForClass(id);
            return;
        }
        scheduleState.pendingEnrollStudentsByClassId[id] = rows;
        stripDraftSessionSoloDisplayForPendingEnrollments(id);
        if (canDragCreateSessions) schedulePersistDraftBackup();
    }

    function removePendingEnrollStudentAt(classId, index) {
        const id = String(classId || '').trim();
        const rows = scheduleState.pendingEnrollStudentsByClassId?.[id];
        if (!id || !Array.isArray(rows)) return;
        const idx = Number(index);
        if (!Number.isFinite(idx) || idx < 0 || idx >= rows.length) return;
        rows.splice(idx, 1);
        if (!rows.length) clearPendingEnrollStudentsForClass(id);
        else if (canDragCreateSessions) schedulePersistDraftBackup();
    }

    function collectStagedSessionIdsForClass(classId) {
        const cid = String(classId || '').trim();
        const ids = new Set();
        Object.values(scheduleState.draftEventsByPersonId || {}).forEach((rows) => {
            (Array.isArray(rows) ? rows : []).forEach((ev) => {
                if (ev?.isDraft !== true) return;
                if (String(ev?.classId || '').trim() !== cid) return;
                const sid = String(ev?.sessionId || ev?.id || '').trim();
                if (sid) ids.add(sid);
            });
        });
        return ids;
    }

    function prunePendingEnrollmentsForClass(classId) {
        const cid = String(classId || '').trim();
        if (!cid || !classHasPendingEnrollments(cid)) return;
        const liveIds = collectStagedSessionIdsForClass(cid);
        const entries = getPendingEnrollStudentsForClass(cid);
        const next = entries.map((entry) => ({
            ...entry,
            selectedSessionIds: (Array.isArray(entry?.selectedSessionIds) ? entry.selectedSessionIds : [])
                .map((sid) => String(sid || '').trim())
                .filter((sid) => liveIds.has(sid))
        })).filter((entry) => entry.selectedSessionIds.length > 0);
        if (!next.length) clearPendingEnrollStudentsForClass(cid);
        else replacePendingEnrollStudentsForClass(cid, next);
    }

    function getPendingEnrollStudentsForClass(classId) {
        const id = String(classId || '').trim();
        const rows = scheduleState.pendingEnrollStudentsByClassId?.[id];
        return Array.isArray(rows) ? rows.slice() : [];
    }

    function pendingEnrollEntryStudentId(entry) {
        return String(entry?.students?.[0]?.studentId || entry?.studentId || '').trim();
    }

    function appendPendingEnrollStudentForClass(classId, entry) {
        const id = String(classId || '').trim();
        if (!id || !entry || typeof entry !== 'object') return;
        const studentId = pendingEnrollEntryStudentId(entry);
        if (!scheduleState.pendingEnrollStudentsByClassId) scheduleState.pendingEnrollStudentsByClassId = {};
        if (!Array.isArray(scheduleState.pendingEnrollStudentsByClassId[id])) {
            scheduleState.pendingEnrollStudentsByClassId[id] = [];
        }
        if (studentId && scheduleState.pendingEnrollStudentsByClassId[id].some((row) => pendingEnrollEntryStudentId(row) === studentId)) {
            return;
        }
        scheduleState.pendingEnrollStudentsByClassId[id].push({ ...entry });
        stripDraftSessionSoloDisplayForPendingEnrollments(id);
        if (canDragCreateSessions) schedulePersistDraftBackup();
    }

    function clearPendingEnrollStudentsForClass(classId) {
        const id = String(classId || '').trim();
        if (scheduleState.pendingEnrollStudentsByClassId && id) {
            delete scheduleState.pendingEnrollStudentsByClassId[id];
        }
        if (scheduleState.pendingEnrollMetaByClassId && id) {
            delete scheduleState.pendingEnrollMetaByClassId[id];
        }
        if (canDragCreateSessions) schedulePersistDraftBackup();
    }

    let enrollStudentsRailHandler = null;
    function bindEnrollStudentsRail(handler) {
        enrollStudentsRailHandler = typeof handler === 'function' ? handler : null;
    }

    let moveSessionsRailHandler = null;
    function bindMoveSessionsRail(handler) {
        moveSessionsRailHandler = typeof handler === 'function' ? handler : null;
    }

    let mergeSessionsRailHandler = null;
    function bindMergeSessionsRail(handler) {
        mergeSessionsRailHandler = typeof handler === 'function' ? handler : null;
    }

    let takeOverSessionsRailHandler = null;
    function bindTakeOverSessionsRail(handler) {
        takeOverSessionsRailHandler = typeof handler === 'function' ? handler : null;
    }

    let addCoTeacherRailHandler = null;
    function bindAddCoTeacherRail(handler) {
        addCoTeacherRailHandler = typeof handler === 'function' ? handler : null;
    }

    let claimNumbersRailHandler = null;
    function bindClaimNumbersRail(handler) {
        claimNumbersRailHandler = typeof handler === 'function' ? handler : null;
    }

    let personScheduleNoteRailHandler = null;
    function bindPersonScheduleNoteRail(handler) {
        personScheduleNoteRailHandler = typeof handler === 'function' ? handler : null;
    }

    const activeSchedulePersonChangeListeners = new Set();
    function bindActiveSchedulePersonChangeListener(handler) {
        if (typeof handler !== 'function') return;
        activeSchedulePersonChangeListeners.add(handler);
    }

    function notifyActiveSchedulePersonChanged() {
        activeSchedulePersonChangeListeners.forEach((handler) => {
            try {
                void handler();
            } catch (_error) {
                // ignore listener errors
            }
        });
    }

    function showScheduleBootstrapModal(modalEl) {
        if (!modalEl || !window.bootstrap?.Modal) return;
        window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }

    function hideScheduleBootstrapModal(modalEl) {
        if (!modalEl || !window.bootstrap?.Modal) return;
        window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    }

    function isSavedSessionMultiSelectContextMenu(event) {
        if (!isClassSessionScheduleEvent(event)) return false;
        if (countActiveScheduleSelectedSessions() < 2) return false;
        const key = scheduleSessionSelectionKey(event);
        if (!key || !getActiveScheduleSelectionSet().has(key)) return false;
        return canDragCreateSessions || canDeleteClassSessions;
    }

    function readScheduleSavedBulkEditFormValues() {
        const activeChip = document.querySelector('#scheduleSavedBulkEditDurationGroup [data-saved-bulk-edit-duration].active');
        const durationHours = Number(activeChip?.getAttribute('data-saved-bulk-edit-duration') || 0);
        return {
            startTime: String(document.getElementById('scheduleSavedBulkEditStartTime')?.value || '').trim(),
            durationHours
        };
    }

    function validateBulkSavedSessionScheduleChange(selectedEvents, values = {}) {
        const startTime = String(values.startTime || '').trim();
        const durationHours = Number(values.durationHours || 0);
        if (!startTime) {
            return { ok: false, message: 'Start time is required.' };
        }
        if (!durationHours || durationHours <= 0) {
            return { ok: false, message: 'Duration is required.' };
        }
        if (!scheduleCalendarCore?.addDurationToTime) {
            return { ok: false, message: 'Schedule calendar is unavailable.' };
        }
        const endTime = scheduleCalendarCore.addDurationToTime(startTime, durationHours);
        for (const ev of selectedEvents) {
            if (!isScheduledClassSessionForQuickEdit(ev)) {
                const title = getEventTitle(ev);
                return { ok: false, message: `${title} cannot be edited from Master Schedule.` };
            }
            if (!canScheduleSessionChangeTime(ev)) {
                return {
                    ok: false,
                    message: formatSessionManagementBlockerMessage(ev, 'This session time cannot be changed.')
                };
            }
        }
        const excludeIds = new Set(selectedEvents.map((ev) => String(ev?.sessionId || ev?.id || '').trim()).filter(Boolean));
        const person = activeSchedulePerson();
        if (!person?.id) return { ok: false, message: 'No active schedule person.' };
        const allConflicts = collectScheduleConflictSessionsForPerson(person.id);
        const conflictSessions = allConflicts.filter((row) => {
            const rowId = String(row?.sessionId || row?.id || '').trim();
            return !excludeIds.has(rowId);
        });
        for (const ev of selectedEvents) {
            const sessionId = String(ev?.sessionId || ev?.id || '').trim();
            const hasConflict = scheduleCalendarCore?.checkScheduleTimeConflict?.({
                date: ev.date,
                startTime,
                endTime,
                sessions: conflictSessions,
                excludeSessionId: sessionId
            });
            if (hasConflict) {
                const title = getEventTitle(ev);
                const dateLabel = String(ev?.date || '').trim();
                return {
                    ok: false,
                    message: `Conflict for ${title}${dateLabel ? ` on ${dateLabel}` : ''}. No changes were applied.`
                };
            }
        }
        return { ok: true, startTime, endTime, durationHours };
    }

    function hideScheduleSavedBulkEditOverlay() {
        const overlay = document.getElementById('scheduleSavedBulkEditOverlay');
        if (!overlay) return;
        overlay.classList.remove('session-enrollment-stage-standalone');
        overlay.classList.add('d-none');
        overlay.classList.remove('show');
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('schedule-stage-overlay-open');
        const errorEl = document.getElementById('scheduleSavedBulkEditError');
        if (errorEl) {
            errorEl.classList.add('d-none');
            errorEl.textContent = '';
        }
    }

    function openScheduleSavedBulkEditOverlay() {
        if (!canDragCreateSessions) return;
        const selectedEvents = getSelectedSavedClassSessionEvents();
        if (selectedEvents.length < 2) {
            if (typeof uiAlert === 'function') {
                void uiAlert('Select two or more saved class sessions from the same class to edit.', 'Edit sessions', { icon: 'info' });
            }
            return;
        }
        const overlay = document.getElementById('scheduleSavedBulkEditOverlay');
        if (!overlay) return;
        const contextEl = document.getElementById('scheduleSavedBulkEditOverlayContext');
        if (contextEl) {
            contextEl.textContent = `${selectedEvents.length} session(s) selected`;
        }
        const first = selectedEvents[0] || {};
        const dateEl = document.getElementById('scheduleSavedBulkEditDate');
        if (dateEl) dateEl.value = String(first.date || '').trim();
        const startEl = document.getElementById('scheduleSavedBulkEditStartTime');
        if (startEl) startEl.value = String(first.start || first.startTime || '').trim();
        const durationHours = nearestScheduleDurationChip(first.duration || first.scheduledDuration || 1);
        document.querySelectorAll('#scheduleSavedBulkEditDurationGroup [data-saved-bulk-edit-duration]').forEach((btn) => {
            const chip = Number(btn.getAttribute('data-saved-bulk-edit-duration') || 0);
            btn.classList.toggle('active', chip === durationHours);
        });
        const errorEl = document.getElementById('scheduleSavedBulkEditError');
        if (errorEl) {
            errorEl.classList.add('d-none');
            errorEl.textContent = '';
        }
        document.body.classList.add('schedule-stage-overlay-open');
        overlay.classList.add('session-enrollment-stage-standalone');
        if (overlay.parentElement !== document.body) {
            document.body.appendChild(overlay);
        }
        overlay.classList.remove('d-none');
        overlay.classList.add('show');
        overlay.style.display = 'flex';
        overlay.setAttribute('aria-hidden', 'false');
    }

    async function applyScheduleSavedBulkEditOverlay() {
        const selectedEvents = getSelectedSavedClassSessionEvents();
        if (selectedEvents.length < 2) return;
        const values = readScheduleSavedBulkEditFormValues();
        const errorEl = document.getElementById('scheduleSavedBulkEditError');
        const validation = validateBulkSavedSessionScheduleChange(selectedEvents, values);
        if (!validation.ok) {
            if (errorEl) {
                errorEl.textContent = validation.message;
                errorEl.classList.remove('d-none');
            }
            return;
        }
        if (errorEl) {
            errorEl.classList.add('d-none');
            errorEl.textContent = '';
        }
        let loadingToken = typeof window.showLoading === 'function'
            ? window.showLoading('Updating selected sessions...')
            : null;
        let updatedCount = 0;
        try {
            for (const event of selectedEvents) {
                const sessionDate = String(event.date || '').trim();
                const ok = await applySavedSessionScheduleUpdate({
                    event,
                    lookupSessionDate: sessionDate,
                    date: sessionDate,
                    startTime: validation.startTime,
                    endTime: validation.endTime,
                    durationHours: validation.durationHours,
                    deferPostUpdate: true,
                    skipLoading: true,
                    errorElementId: 'scheduleSavedBulkEditError'
                });
                if (!ok) {
                    if (updatedCount > 0) {
                        refreshScheduleViewWithHolidays();
                        const person = activeSchedulePerson();
                        if (person?.id) await acknowledgeLocalScheduleMutation(person);
                    }
                    return;
                }
                updatedCount += 1;
            }
            hideScheduleSavedBulkEditOverlay();
            refreshScheduleViewWithHolidays();
            const person = activeSchedulePerson();
            if (person?.id) await acknowledgeLocalScheduleMutation(person);
            if (typeof uiAlert === 'function') {
                await uiAlert(
                    `Updated ${updatedCount} session${updatedCount === 1 ? '' : 's'}.`,
                    'Sessions updated',
                    { icon: 'success' }
                );
            }
        } finally {
            if (loadingToken && typeof window.hideLoading === 'function') window.hideLoading(loadingToken);
        }
    }

    function isSavedSessionBulkContextMenu(event) {
        return isSavedSessionMultiSelectContextMenu(event);
    }

    function hasScheduleWorkspaceToSave() {
        const range = getScheduleRange();
        if (canSelectAnyPerson) return scheduleState.persons.length > 0;
        return Boolean(range.startDate && range.endDate);
    }

    function mapSchedulePersonsForPreferences() {
        return scheduleState.persons.map((person) => {
            const row = {
                id: person.id,
                name: person.name || person.id,
                selectedRole: String(person.selectedRole || '').trim()
            };
            if (person.chipBgColor) row.chipBgColor = String(person.chipBgColor).trim();
            if (person.chipTextColor) row.chipTextColor = String(person.chipTextColor).trim();
            return row;
        });
    }

    function buildScheduleWorkspacePayload() {
        const range = getScheduleRange();
        return {
            startDate: range.startDate,
            endDate: range.endDate,
            activePersonId: scheduleState.activePersonId || '',
            persons: mapSchedulePersonsForPreferences(),
            autoChangeDetector: isScheduleAutoChangeDetectorEnabled()
        };
    }

    function hasServerSavedWorkspace() {
        return scheduleState.serverWorkspaceSaved === true;
    }

    function markServerWorkspaceSaved(saved) {
        scheduleState.serverWorkspaceSaved = saved === true;
        if (!saved && initialScheduleViewerPrefs && typeof initialScheduleViewerPrefs === 'object') {
            initialScheduleViewerPrefs.startDate = '';
            initialScheduleViewerPrefs.endDate = '';
            initialScheduleViewerPrefs.activePersonId = '';
            initialScheduleViewerPrefs.persons = [];
        }
    }

    function buildScheduleWorkspaceSaveChipHtml() {
        return `<button type="button" class="schedule-workspace-save-chip" data-schedule-save-workspace title="Save selected people and date range" aria-label="Save workspace"><i class="bi bi-bookmark" aria-hidden="true"></i><span>Save</span></button>`;
    }

    function buildScheduleWorkspaceClearChipHtml() {
        return `<button type="button" class="schedule-workspace-clear-chip" data-schedule-clear-workspace title="Clear saved people and date range for future visits" aria-label="Clear saved workspace"><i class="bi bi-bookmark-x" aria-hidden="true"></i><span>Clear</span></button>`;
    }

    function buildScheduleWorkspaceActionsHtml() {
        const parts = [];
        if (hasScheduleWorkspaceToSave() && !hasServerSavedWorkspace()) {
            parts.push(buildScheduleWorkspaceSaveChipHtml());
        }
        if (hasServerSavedWorkspace()) parts.push(buildScheduleWorkspaceClearChipHtml());
        return parts.join('');
    }

    let scheduleWorkspaceAutoPersistTimer = null;

    function beginSuppressWorkspaceAutoPersist() {
        scheduleState.suppressWorkspaceAutoPersist += 1;
    }

    function endSuppressWorkspaceAutoPersist() {
        scheduleState.suppressWorkspaceAutoPersist = Math.max(0, scheduleState.suppressWorkspaceAutoPersist - 1);
    }

    async function putScheduleWorkspacePreferences(payload, options = {}) {
        const silent = options.silent === true;
        try {
            const res = await fetch(SCHEDULE_VIEWER_PREFS_API, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-AJAX-Request': 'true',
                    Accept: 'application/json'
                },
                credentials: 'same-origin',
                body: JSON.stringify(payload)
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || result.status !== 'success') {
                throw new Error(result.message || 'Unable to save workspace.');
            }
            markServerWorkspaceSaved(true);
            if (initialScheduleViewerPrefs && typeof initialScheduleViewerPrefs === 'object') {
                Object.assign(initialScheduleViewerPrefs, payload);
            }
            if (silent) renderSchedulePersonTabs();
            return true;
        } catch (error) {
            if (!silent) {
                await uiAlert(error.message || 'Unable to save workspace.', 'Save workspace', { icon: 'error' });
            }
            return false;
        }
    }

    function queueScheduleWorkspaceAutoPersist() {
        if (scheduleState.suppressWorkspaceAutoPersist > 0) return;
        if (!hasServerSavedWorkspace() || !hasScheduleWorkspaceToSave()) return;
        if (scheduleWorkspaceAutoPersistTimer) window.clearTimeout(scheduleWorkspaceAutoPersistTimer);
        scheduleWorkspaceAutoPersistTimer = window.setTimeout(() => {
            scheduleWorkspaceAutoPersistTimer = null;
            void putScheduleWorkspacePreferences(buildScheduleWorkspacePayload(), { silent: true });
        }, 250);
    }

    function buildScheduleWorkspaceActionsContainerHtml() {
        const actions = buildScheduleWorkspaceActionsHtml();
        if (!actions) return '';
        return `<span class="schedule-workspace-actions" data-schedule-workspace-actions>${actions}</span>`;
    }

    async function saveScheduleWorkspace() {
        if (!hasScheduleWorkspaceToSave()) {
            await uiAlert('Select at least one person and a date range before saving.', 'Save workspace?', { icon: 'info' });
            return;
        }
        const confirmed = await uiConfirm(
            'This saves your selected people and date range only. Staged sessions, selections, and other unsaved changes are not saved. Continue?',
            'Save workspace?',
            { icon: 'warning', cancelText: 'Cancel', confirmText: 'Save', confirmClass: 'btn-primary btn-md' }
        );
        if (!confirmed) return;
        const payload = buildScheduleWorkspacePayload();
        const saved = await putScheduleWorkspacePreferences(payload, { silent: false });
        if (!saved) return;
        renderSchedulePersonTabs();
        await uiAlert('Workspace saved.', 'Save workspace', { icon: 'success' });
    }

    async function clearScheduleWorkspace() {
        if (!hasServerSavedWorkspace()) return;
        const confirmed = await uiConfirm(
            'This removes your saved people and date range. The current screen will stay as-is, but the page will not preload them next time. Continue?',
            'Clear saved workspace?',
            { icon: 'warning', cancelText: 'Cancel', confirmText: 'Clear', confirmClass: 'btn-danger btn-md' }
        );
        if (!confirmed) return;
        try {
            const res = await fetch(SCHEDULE_VIEWER_PREFS_API, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-AJAX-Request': 'true',
                    Accept: 'application/json'
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    startDate: '',
                    endDate: '',
                    activePersonId: '',
                    persons: []
                })
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || result.status !== 'success') {
                throw new Error(result.message || 'Unable to clear saved workspace.');
            }
            markServerWorkspaceSaved(false);
            renderSchedulePersonTabs();
            await uiAlert('Saved workspace cleared.', 'Clear workspace', { icon: 'success' });
        } catch (error) {
            await uiAlert(error.message || 'Unable to clear saved workspace.', 'Clear workspace', { icon: 'error' });
        }
    }

    async function loadAllSavedSchedulePersons() {
        if (!scheduleState.persons.length) return;
        for (const person of scheduleState.persons) {
            // eslint-disable-next-line no-await-in-loop
            await loadSchedulePerson(person);
        }
    }

    function updateScheduleSelectionControls() {
        const total = countTotalScheduleSelectedSessions();
        const label = formatScheduleSelectionChipLabel();
        document.querySelectorAll('[data-schedule-selected-count]').forEach((el) => {
            el.textContent = label;
        });
        document.querySelectorAll('[data-schedule-clear-all-selected]').forEach((btn) => {
            btn.classList.toggle('is-empty', total === 0);
            btn.disabled = total === 0;
            const title = total ? 'Clear all selections' : 'No sessions selected';
            btn.title = title;
            btn.setAttribute('aria-label', title);
        });
    }

    function updateScheduleSelectedSessionControls() {
        updateScheduleSelectionControls();
    }

    function updateScheduleDraftSelectedControls() {
        updateScheduleSelectionControls();
    }

    function clearAllScheduleSelections() {
        const person = activeSchedulePerson();
        if (!person?.id) return;
        scheduleState.selectedSessionKeysByPersonId[person.id] = new Set();
        scheduleState.selectedDraftSessionIdsByPersonId[person.id] = new Set();
        refreshScheduleActiveView();
    }

    function clearActiveScheduleSessionSelection() {
        const person = activeSchedulePerson();
        if (person?.id) scheduleState.selectedSessionKeysByPersonId[person.id] = new Set();
        refreshScheduleActiveView();
    }

    function sortSchedulePersons() {
        scheduleState.persons.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), undefined, { sensitivity: 'base' }));
    }

    function syncActivePersonInputs() {
        const person = activeSchedulePerson();
        const idEl = document.getElementById('sch_personId');
        const nameEl = document.getElementById('sch_personName');
        if (idEl) idEl.value = person?.id || '';
        if (nameEl) nameEl.value = scheduleState.persons.length
            ? `${scheduleState.persons.length} selected - ${person?.name || person?.id || ''}`
            : '';
    }

    function renderSchedulePersonTabs() {
        const host = document.getElementById('schedulePersonTabs');
        if (!host) return;
        sortSchedulePersons();
        const actionsHtml = buildScheduleWorkspaceActionsContainerHtml();
        if (!scheduleState.persons.length) {
            host.innerHTML = actionsHtml;
            syncActivePersonInputs();
            return;
        }
        const lastIndex = scheduleState.persons.length - 1;
        host.innerHTML = scheduleState.persons.map((person, index) => {
            const active = person.id === scheduleState.activePersonId;
            const closeButton = canSelectAnyPerson
                ? `<button type="button" class="schedule-person-tab-close" data-schedule-remove-person="${escapeHtml(person.id)}" aria-label="Close tab" title="Close tab">&times;</button>`
                : '';
            const roleCount = (Array.isArray(person.availableRoles) && person.availableRoles.length) ? person.availableRoles.length : 'All';
            const tabDecoration = scheduleAdminUi?.personTabDecoration?.(person) || { extraClass: '', extraStyle: '' };
            const tabExtraClass = tabDecoration.extraClass ? ` ${tabDecoration.extraClass}` : '';
            const tabExtraStyle = tabDecoration.extraStyle ? ` style="${escapeHtml(tabDecoration.extraStyle)}"` : '';
            const tabWrap = `
                <div class="schedule-person-tab-wrap">
                    <button type="button" class="btn btn-sm schedule-person-tab ${active ? 'active' : ''}${tabExtraClass}" data-schedule-person-tab="${escapeHtml(person.id)}"${tabExtraStyle}>
                        <i class="bi bi-person-circle"></i>
                        <span class="text-truncate">${escapeHtml(person.name || person.id)}</span>
                        <span class="badge text-bg-light border">${escapeHtml(roleCount)}</span>
                    </button>
                    ${closeButton}
                </div>
            `;
            if (index === lastIndex) {
                return `<div class="schedule-person-tab-group schedule-person-tab-group--with-actions">${tabWrap}${actionsHtml}</div>`;
            }
            return tabWrap;
        }).join('');
        syncActivePersonInputs();
    }

    function updateRoleOptionsForActivePerson() {
        const person = activeSchedulePerson();
        const roleEl = document.getElementById('sch_role');
        if (!roleEl || roleEl.tagName !== 'SELECT') return;
        if (canSelectAnyPerson) return;
        const roles = Array.isArray(person?.availableRoles) ? person.availableRoles : [];
        if (!roles.length) {
            return;
        } else {
            roleEl.innerHTML = roles.length > 1 ? '<option value="">All Roles</option>' : '';
        }
        roles.forEach((role) => {
            const key = String(role?.key || '').trim();
            if (!key) return;
            const option = document.createElement('option');
            option.value = key;
            option.textContent = role?.label || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            roleEl.appendChild(option);
        });
        const current = String(person?.selectedRole || '').trim();
        if (current && Array.from(roleEl.options).some((option) => option.value === current)) roleEl.value = current;
        else roleEl.value = '';
        roleEl.disabled = !canSelectAnyPerson && roles.length <= 1;
    }

    function addSchedulePerson(item, options = {}) {
        const id = resolveSchedulePersonId(item);
        if (!id) return null;
        let person = scheduleState.persons.find((row) => row.id === id);
        let addedNewPerson = false;
        if (!person) {
            addedNewPerson = true;
            person = {
                id,
                name: resolvePersonPickerName(item) || String(item?.displayName || item?.name || id).trim() || id,
                availableRoles: Array.isArray(item?.availableRoles) ? item.availableRoles : [],
                selectedRole: String(options.selectedRole || item?.selectedRole || selectedScheduleRole() || '').trim()
            };
            if (item?.chipBgColor) person.chipBgColor = String(item.chipBgColor).trim();
            if (item?.chipTextColor) person.chipTextColor = String(item.chipTextColor).trim();
            scheduleState.persons.push(person);
        } else {
            person.name = resolvePersonPickerName(item) || person.name || id;
            if (Array.isArray(item?.availableRoles)) person.availableRoles = item.availableRoles;
            person.selectedRole = String(options.selectedRole || item?.selectedRole || selectedScheduleRole() || person.selectedRole || '').trim();
            if (item?.chipBgColor) person.chipBgColor = String(item.chipBgColor).trim();
            if (item?.chipTextColor) person.chipTextColor = String(item.chipTextColor).trim();
        }
        sortSchedulePersons();
        if (!scheduleState.activePersonId || options.activate) scheduleState.activePersonId = id;
        if (addedNewPerson && !options.suppressWorkspaceAutoPersist) {
            queueScheduleWorkspaceAutoPersist();
        }
        return person;
    }

    function removeSchedulePerson(id) {
        scheduleState.persons = scheduleState.persons.filter((person) => person.id !== id);
        delete scheduleState.eventsByPersonId[id];
        delete scheduleState.statusMetaByPersonId[id];
        delete scheduleState.errorByPersonId[id];
        delete scheduleState.selectedSessionKeysByPersonId[id];
        delete scheduleState.selectedDraftSessionIdsByPersonId[id];
        delete scheduleState.lastLoadedAtByPersonId[id];
        delete scheduleState.scheduleFingerprintByPersonId[id];
        scheduleState.loadedPersonIds.delete(id);
        if (scheduleState.activePersonId === id) {
            scheduleState.activePersonId = scheduleState.persons[0]?.id || '';
            clearRemoteUpdatePending();
        }
        queueScheduleWorkspaceAutoPersist();
        refreshScheduleActiveView();
    }

    function clearLoadedSchedules() {
        scheduleState.eventsByPersonId = {};
        scheduleState.statusMetaByPersonId = {};
        scheduleState.errorByPersonId = {};
        scheduleState.selectedSessionKeysByPersonId = {};
        scheduleState.selectedDraftSessionIdsByPersonId = {};
        scheduleState.lastLoadedAtByPersonId = {};
        scheduleState.scheduleFingerprintByPersonId = {};
        scheduleState.staleAfterHidden = false;
        scheduleState.remoteUpdatePending = false;
        scheduleState.remoteUpdateFingerprint = '';
        scheduleState.remoteUpdateModalDismissed = false;
        scheduleState.remoteUpdateModalOpen = false;
        stopScheduleAutoRefresh();
        scheduleState.loadedPersonIds.clear();
        scheduleState.activeClasses = [];
        scheduleState.activeClassesByPersonId = {};
        resetScheduleActiveClassFilter();
    }

    function isScheduleStageModalOpen() {
        const modalEl = getScheduleStageModalEl();
        return Boolean(modalEl && !modalEl.classList.contains('d-none'));
    }

    function hasScheduleLocalWork() {
        if (countActiveScheduleSelectedSessions() > 0) return true;
        if (countActiveDraftSelectedSessions() > 0) return true;
        if (isScheduleStageModalOpen()) return true;
        const person = activeSchedulePerson();
        if (person?.id) {
            const drafts = scheduleState.draftEventsByPersonId?.[person.id];
            if (Array.isArray(drafts) && drafts.length > 0) return true;
        }
        return false;
    }

    function isScheduleDraftWorkActive() {
        if (isScheduleStageModalOpen()) return true;
        const person = activeSchedulePerson();
        if (person?.id) {
            const drafts = scheduleState.draftEventsByPersonId?.[person.id];
            if (Array.isArray(drafts) && drafts.length > 0) return true;
        }
        if (window.SessionEnrollmentCalendarModal?.isOpen?.()) return true;
        const editOverlay = document.getElementById('scheduleDraftEditOverlay');
        if (editOverlay && !editOverlay.classList.contains('d-none')) return true;
        const moveOverlay = document.getElementById('scheduleDraftMoveOverlay');
        if (moveOverlay && !moveOverlay.classList.contains('d-none')) return true;
        if (document.body.classList.contains('is-schedule-draft-moving')) return true;
        if (document.body.classList.contains('is-schedule-draft-resizing')) return true;
        const bulkOverlay = document.getElementById('scheduleDraftBulkEditOverlay');
        if (bulkOverlay && !bulkOverlay.classList.contains('d-none')) return true;
        const savedBulkOverlay = document.getElementById('scheduleSavedBulkEditOverlay');
        if (savedBulkOverlay && !savedBulkOverlay.classList.contains('d-none')) return true;
        if (typeof isScheduleSavedSessionWorkActive === 'function' && isScheduleSavedSessionWorkActive()) return true;
        return false;
    }

    function clearRemoteUpdatePending() {
        scheduleState.remoteUpdatePending = false;
        scheduleState.remoteUpdateFingerprint = '';
        scheduleState.remoteUpdateModalDismissed = false;
        scheduleState.remoteUpdateModalOpen = false;
    }

    async function acknowledgeLocalScheduleMutation(person, fingerprintOverride = '') {
        if (!person?.id) return;
        const override = String(fingerprintOverride || '').trim();
        if (override) {
            scheduleState.scheduleFingerprintByPersonId[person.id] = override;
            clearRemoteUpdatePending();
            scheduleState.localMutationGraceUntil = Date.now() + 15000;
            return;
        }
        const range = getScheduleRange();
        if (!range.startDate || !range.endDate) return;
        try {
            const params = buildScheduleVersionQuery(person);
            const res = await fetch(`/school/schedules/api/person-schedule-version?${params.toString()}`, {
                headers: { 'X-AJAX-Request': 'true', Accept: 'application/json' },
                credentials: 'same-origin'
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || result.status !== 'success') return;
            const nextFingerprint = String(result.fingerprint || '').trim();
            if (nextFingerprint) {
                scheduleState.scheduleFingerprintByPersonId[person.id] = nextFingerprint;
            }
            clearRemoteUpdatePending();
            scheduleState.localMutationGraceUntil = Date.now() + 15000;
        } catch (error) {
            console.warn('Schedule fingerprint sync failed', error);
        }
    }

    function markRemoteUpdatePending(nextFingerprint) {
        const fingerprint = String(nextFingerprint || '').trim();
        if (!fingerprint) return;
        if (scheduleState.remoteUpdatePending && scheduleState.remoteUpdateFingerprint === fingerprint) return;
        scheduleState.remoteUpdatePending = true;
        scheduleState.remoteUpdateFingerprint = fingerprint;
        scheduleState.remoteUpdateModalDismissed = false;
        refreshScheduleActiveView();
        void promptScheduleRemoteUpdateIfNeeded();
    }

    async function promptScheduleRemoteUpdateIfNeeded() {
        const person = activeSchedulePerson();
        if (!person || !scheduleState.loadedPersonIds.has(person.id)) return;
        if (!scheduleState.remoteUpdatePending) return;
        if (!isScheduleAutoChangeDetectorEnabled()) return;
        if (isScheduleDraftWorkActive()) return;
        if (scheduleState.remoteUpdateModalDismissed) return;
        if (scheduleState.remoteUpdateModalOpen) return;
        if (document.visibilityState !== 'visible') return;
        if (scheduleState.loadingPersonId) return;

        scheduleState.remoteUpdateModalOpen = true;
        try {
            const message = 'Schedule data has changed. Refresh to see the latest sessions.';
            const title = 'Schedule update available';
            let result = 'Dismiss';
            if (typeof window.showMessageModal === 'function') {
                result = await window.showMessageModal({
                    title,
                    icon: 'warning',
                    message,
                    buttons: [
                        { text: 'Dismiss', class: 'btn-secondary' },
                        { text: 'Refresh now', class: 'btn-warning' }
                    ]
                });
            } else {
                const confirmed = await uiConfirm(message, title, {
                    icon: 'warning',
                    cancelText: 'Dismiss',
                    confirmText: 'Refresh now',
                    confirmClass: 'btn-warning btn-md'
                });
                result = confirmed ? 'Refresh now' : 'Dismiss';
            }
            if (!scheduleState.remoteUpdatePending) return;
            if (result === 'Refresh now') {
                await requestScheduleRefresh();
            } else {
                scheduleState.remoteUpdateModalDismissed = true;
            }
        } finally {
            scheduleState.remoteUpdateModalOpen = false;
        }
    }

    async function requestScheduleRefresh() {
        const person = activeSchedulePerson();
        if (!person) return;
        if (hasScheduleLocalWork()) {
            const confirmed = await uiConfirm(
                'Refreshing will reload the schedule and clear your current selection. Continue?',
                'Refresh schedule?',
                { icon: 'warning', cancelText: 'Cancel', confirmText: 'Refresh', confirmClass: 'btn-warning btn-md' }
            );
            if (!confirmed) return;
        }
        await loadSchedulePerson(person, { silent: true });
    }

    function buildScheduleVersionQuery(person) {
        const range = getScheduleRange();
        const role = person.id === scheduleState.activePersonId
            ? String(selectedScheduleRole() || person.selectedRole || '').trim()
            : String(person.selectedRole || '').trim();
        const params = new URLSearchParams({
            personId: person.id,
            startDate: range.startDate,
            endDate: range.endDate
        });
        if (role) params.set('role', role);
        if (hasCasesOnly()) params.set('hasCases', '1');
        return params;
    }

    function stopScheduleAutoRefresh() {
        if (scheduleState.schedulePollTimerId) {
            window.clearInterval(scheduleState.schedulePollTimerId);
            scheduleState.schedulePollTimerId = null;
        }
    }

    function startScheduleAutoRefresh() {
        stopScheduleAutoRefresh();
        if (document.visibilityState !== 'visible') return;
        scheduleState.schedulePollTimerId = window.setInterval(() => {
            pollScheduleVersionForActivePerson();
        }, scheduleState.schedulePollIntervalMs);
    }

    async function pollScheduleVersionForActivePerson() {
        if (document.visibilityState !== 'visible') return;
        if (scheduleState.schedulePollInFlight) return;
        if (scheduleState.loadingPersonId) return;
        if (isScheduleStageModalOpen()) return;
        if (!isScheduleAutoChangeDetectorEnabled()) return;
        const person = activeSchedulePerson();
        if (!person) return;
        const range = getScheduleRange();
        if (!range.startDate || !range.endDate) return;
        if (!scheduleState.loadedPersonIds.has(person.id)) return;
        if (scheduleState.errorByPersonId[person.id]) return;

        scheduleState.schedulePollInFlight = true;
        try {
            const params = buildScheduleVersionQuery(person);
            const res = await fetch(`/school/schedules/api/person-schedule-version?${params.toString()}`, {
                headers: { 'X-AJAX-Request': 'true', Accept: 'application/json' },
                credentials: 'same-origin'
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || result.status !== 'success') return;
            const nextFingerprint = String(result.fingerprint || '').trim();
            if (!nextFingerprint) return;
            const currentFingerprint = String(scheduleState.scheduleFingerprintByPersonId[person.id] || '').trim();
            if (!currentFingerprint) {
                scheduleState.scheduleFingerprintByPersonId[person.id] = nextFingerprint;
                return;
            }
            if (nextFingerprint === currentFingerprint) return;
            if (isScheduleDraftWorkActive()) {
                scheduleState.scheduleFingerprintByPersonId[person.id] = nextFingerprint;
                return;
            }
            if (Number(scheduleState.localMutationGraceUntil || 0) > Date.now()) {
                scheduleState.scheduleFingerprintByPersonId[person.id] = nextFingerprint;
                return;
            }
            markRemoteUpdatePending(nextFingerprint);
        } catch (error) {
            console.warn('Schedule version poll failed', error);
        } finally {
            scheduleState.schedulePollInFlight = false;
        }
    }

    function getScheduleRange() {
        return {
            startDate: document.getElementById('sch_startDate')?.value || '',
            endDate: document.getElementById('sch_endDate')?.value || ''
        };
    }

    function hasCasesOnly() {
        return document.getElementById('sch_hasCases')?.checked === true;
    }

    function readScheduleHideEmptyDays() {
        try {
            if (window.localStorage) return window.localStorage.getItem(SCHEDULE_HIDE_EMPTY_DAYS_KEY) === '1';
        } catch (error) { /* storage can be unavailable */ }
        return false;
    }

    function saveScheduleHideEmptyDays(enabled) {
        try {
            if (window.localStorage) window.localStorage.setItem(SCHEDULE_HIDE_EMPTY_DAYS_KEY, enabled ? '1' : '0');
        } catch (error) { /* storage can be unavailable */ }
    }

    scheduleState.hideEmptyDays = readScheduleHideEmptyDays();

    function clampScheduleSliderValue(value, fallback = SCHEDULE_DEFAULT_DAY_WIDTH) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(SCHEDULE_MIN_DAY_WIDTH, Math.min(SCHEDULE_MAX_DAY_WIDTH, Math.round(parsed)));
    }

    function isScheduleWeekGridMode(mode = normalizedScheduleViewMode()) {
        return mode === 'verticalTimeline' || mode === 'timeline';
    }

    function readScheduleVerticalDayWidthUserAdjusted() {
        try {
            if (window.localStorage) {
                const stored = window.localStorage.getItem(SCHEDULE_VERTICAL_DAY_WIDTH_USER_KEY);
                if (stored === '1') return true;
                if (stored === '0') return false;
                return window.localStorage.getItem(SCHEDULE_DAY_WIDTH_USER_KEY) === '1';
            }
        } catch (error) { /* storage can be unavailable */ }
        return false;
    }

    function readScheduleHorizontalSliderUserAdjusted() {
        try {
            if (window.localStorage) return window.localStorage.getItem(SCHEDULE_HORIZONTAL_SLIDER_USER_KEY) === '1';
        } catch (error) { /* storage can be unavailable */ }
        return false;
    }

    function saveScheduleVerticalDayWidthUserAdjusted(adjusted) {
        scheduleState.verticalDayWidthUserAdjusted = adjusted === true;
        try {
            if (window.localStorage) window.localStorage.setItem(SCHEDULE_VERTICAL_DAY_WIDTH_USER_KEY, adjusted ? '1' : '0');
        } catch (error) { /* storage can be unavailable */ }
    }

    function saveScheduleHorizontalSliderUserAdjusted(adjusted) {
        scheduleState.horizontalSliderUserAdjusted = adjusted === true;
        try {
            if (window.localStorage) window.localStorage.setItem(SCHEDULE_HORIZONTAL_SLIDER_USER_KEY, adjusted ? '1' : '0');
        } catch (error) { /* storage can be unavailable */ }
    }

    function resetScheduleWeekGridUserSizing() {
        saveScheduleVerticalDayWidthUserAdjusted(false);
        saveScheduleHorizontalSliderUserAdjusted(false);
        const container = document.getElementById('visualDisplayArea');
        if (container) {
            container.classList.add('session-cal-auto-day-width');
            container.classList.remove('schedule-week-grid-manual-day-width');
            container.classList.remove('schedule-week-grid-manual-track-height');
        }
    }

    function readScheduleVerticalDayWidth() {
        try {
            if (window.localStorage) {
                const stored = Number(window.localStorage.getItem(SCHEDULE_VERTICAL_DAY_WIDTH_KEY));
                if (Number.isFinite(stored)) return clampScheduleSliderValue(stored);
                const legacy = Number(window.localStorage.getItem(SCHEDULE_DAY_WIDTH_STORAGE_KEY));
                if (Number.isFinite(legacy)) return clampScheduleSliderValue(legacy);
            }
        } catch (error) { /* storage can be unavailable */ }
        return SCHEDULE_DEFAULT_DAY_WIDTH;
    }

    function readScheduleHorizontalSliderWidth() {
        try {
            const stored = window.localStorage ? Number(window.localStorage.getItem(SCHEDULE_HORIZONTAL_SLIDER_KEY)) : NaN;
            if (Number.isFinite(stored)) return clampScheduleSliderValue(stored);
        } catch (error) { /* storage can be unavailable */ }
        return SCHEDULE_DEFAULT_DAY_WIDTH;
    }

    function readScheduleSliderValueForMode(mode = normalizedScheduleViewMode()) {
        return mode === 'timeline' ? readScheduleHorizontalSliderWidth() : readScheduleVerticalDayWidth();
    }

    function saveScheduleSliderValueForMode(mode, width) {
        const resolved = clampScheduleSliderValue(width);
        try {
            if (!window.localStorage) return resolved;
            if (mode === 'timeline') {
                window.localStorage.setItem(SCHEDULE_HORIZONTAL_SLIDER_KEY, String(resolved));
            } else if (mode === 'verticalTimeline') {
                window.localStorage.setItem(SCHEDULE_VERTICAL_DAY_WIDTH_KEY, String(resolved));
                window.localStorage.setItem(SCHEDULE_DAY_WIDTH_STORAGE_KEY, String(resolved));
            }
        } catch (error) { /* storage can be unavailable */ }
        return resolved;
    }

    scheduleState.verticalDayWidthUserAdjusted = readScheduleVerticalDayWidthUserAdjusted();
    scheduleState.horizontalSliderUserAdjusted = readScheduleHorizontalSliderUserAdjusted();
    if (scheduleState.verticalDayWidthUserAdjusted && isScheduleWeekGridMode(scheduleState.viewMode) && scheduleState.viewMode !== 'timeline') {
        applyScheduleDayWidth(readScheduleVerticalDayWidth(), { mode: 'verticalTimeline' });
    }
    if (scheduleState.horizontalSliderUserAdjusted && scheduleState.viewMode === 'timeline') {
        applyScheduleDayWidth(readScheduleHorizontalSliderWidth(), { mode: 'timeline' });
    }

    function readScheduleDayWidth() {
        return readScheduleSliderValueForMode();
    }

    function saveScheduleDayWidth(width) {
        return saveScheduleSliderValueForMode(normalizedScheduleViewMode(), width);
    }

    function applyScheduleDayWidth(width, options = {}) {
        const userInitiated = options.userInitiated === true;
        const mode = resolveScheduleViewMode(options.mode || normalizedScheduleViewMode());
        const resolved = clampScheduleSliderValue(width);
        if (userInitiated) {
            saveScheduleSliderValueForMode(mode, resolved);
            if (mode === 'timeline') {
                saveScheduleHorizontalSliderUserAdjusted(true);
                const container = document.getElementById('visualDisplayArea');
                container?.classList.add('schedule-week-grid-manual-track-height');
            } else if (mode === 'verticalTimeline') {
                saveScheduleVerticalDayWidthUserAdjusted(true);
                const container = document.getElementById('visualDisplayArea');
                container?.classList.remove('session-cal-auto-day-width');
                container?.classList.add('schedule-week-grid-manual-day-width');
            }
        }
        if (mode === 'verticalTimeline') {
        document.querySelector('.schedule-shell')?.style.setProperty('--schedule-day-width', `${resolved}px`);
            const container = document.getElementById('visualDisplayArea');
            if (container) container.style.setProperty('--session-day-width', `${resolved}px`);
        }
        if (mode === 'timeline') {
            const container = document.getElementById('visualDisplayArea');
            applyHorizontalTimelineTrackLayout(container, readScheduleTrackStepFromSlider(resolved, 'timeline'));
        }
        syncScheduleWidthControlDisplay(resolved, mode);
        return resolved;
    }

    function syncScheduleWidthControlDisplay(widthOverride, modeOverride) {
        const input = document.getElementById('scheduleDayWidth');
        const value = document.getElementById('scheduleDayWidthValue');
        if (!input || !value) return;
        const mode = resolveScheduleViewMode(modeOverride || normalizedScheduleViewMode());
        const container = document.getElementById('visualDisplayArea');
        let width = Number(widthOverride);
        if (!Number.isFinite(width)) {
            if (mode === 'timeline') {
                width = readScheduleHorizontalSliderWidth();
            } else if (mode === 'verticalTimeline') {
                const cssWidth = Number(String(container?.style.getPropertyValue('--session-day-width') || '').replace('px', '').trim());
                width = Number.isFinite(cssWidth) && cssWidth > 0
                    ? cssWidth
                    : (scheduleState.verticalDayWidthUserAdjusted ? readScheduleVerticalDayWidth() : SCHEDULE_DEFAULT_DAY_WIDTH);
            } else {
                width = readScheduleSliderValueForMode(mode);
            }
        }
        const resolved = clampScheduleSliderValue(width);
        input.value = String(resolved);
        if (mode === 'timeline') {
            value.textContent = `${readScheduleTrackStepFromSlider(resolved, 'timeline')}px`;
        } else {
            value.textContent = `${resolved}px`;
        }
    }

    function estimateScheduleWeekCountForRange() {
        if (!scheduleCalendarCore?.buildWeekBlocks) return 1;
        const range = getScheduleRange();
        if (!range.startDate || !range.endDate) return 1;
        const blocks = scheduleCalendarCore.buildWeekBlocks({
            startDate: range.startDate,
            endDate: range.endDate,
            preset: 'custom',
            anchorDate: range.startDate
        });
        return Math.max(1, blocks.length || 1);
    }

    function computeScheduleGridViewportHeight(container, weekCount = 1) {
        const el = container || document.getElementById('visualDisplayArea');
        if (!el) return SCHEDULE_GRID_MIN_HEIGHT;
        const top = el.getBoundingClientRect().top || 0;
        const weeks = Math.max(1, Number(weekCount) || 1);
        const viewportRemainder = Math.max(SCHEDULE_GRID_MIN_HEIGHT, window.innerHeight - top - 16);
        const singleWeekHeight = Math.min(viewportRemainder, SCHEDULE_GRID_SINGLE_WEEK_MAX);
        if (weeks <= 1) {
            return singleWeekHeight;
        }
        const stackedHeight = (weeks * SCHEDULE_GRID_PER_WEEK_HEIGHT) + 32;
        return Math.max(stackedHeight, singleWeekHeight);
    }

    function syncScheduleMonthViewLayout(container) {
        const calendarBody = document.querySelector('.schedule-calendar-card-body');
        if (calendarBody) {
            calendarBody.classList.add('is-month-view');
            calendarBody.classList.remove('schedule-calendar-card-body-multi-week');
            calendarBody.style.removeProperty('min-height');
        }
        if (!container) return;
        container.classList.remove('schedule-week-grid-host');
        container.classList.add('schedule-month-view-host');
        container.style.removeProperty('height');
        container.style.removeProperty('min-height');
    }

    function clearScheduleMonthViewLayout(container) {
        const calendarBody = document.querySelector('.schedule-calendar-card-body');
        calendarBody?.classList.remove('is-month-view');
        container?.classList.remove('schedule-month-view-host');
    }

    function syncScheduleCalendarCardBody(weekCount, gridHeight) {
        const body = document.querySelector('.schedule-calendar-card-body');
        if (!body) return;
        const weeks = Math.max(1, Number(weekCount) || 1);
        const minBody = Math.max(SCHEDULE_GRID_MIN_HEIGHT, Number(gridHeight) || 0) + 16;
        body.style.minHeight = `${minBody}px`;
        body.classList.toggle('schedule-calendar-card-body-multi-week', weeks > 1);
    }

    function applyScheduleWeekGridHostSize(container, weekCountOverride) {
        const weekCount = Math.max(1, Number(weekCountOverride) || estimateScheduleWeekCountForRange());
        const height = computeScheduleGridViewportHeight(container, weekCount);
        container.style.height = `${height}px`;
        container.style.minHeight = `${height}px`;
        syncScheduleCalendarCardBody(weekCount, height);
        return height;
    }

    function computeScheduleWeekGridLayout(mode, container, options = {}) {
        const el = container || document.getElementById('visualDisplayArea');
        const isVertical = mode === 'verticalTimeline';
        const autoFit = isVertical && !scheduleState.verticalDayWidthUserAdjusted;
        const scrollEl = el?.querySelector('.session-cal-vertical-scroll');
        const weekRows = scrollEl ? scrollEl.querySelectorAll('.session-cal-week-row') : [];
        const weekCount = options.weekCountOverride || weekRows.length || estimateScheduleWeekCountForRange();
        const gridHeight = applyScheduleWeekGridHostSize(el, weekCount);
        const dayCount = Math.max(1, Number(el?.dataset?.sessionVisibleDayCount || options.dayCountOverride || 7));

        let dayWidth;
        if (autoFit && scheduleCalendarCore?.computeAutoDayWidth) {
            dayWidth = scheduleCalendarCore.computeAutoDayWidth(el, {
                gutterWidth: 64,
                dayCount,
                min: SCHEDULE_MIN_DAY_WIDTH,
                max: 280,
                padding: 24,
                fallback: 120
            });
        } else {
            dayWidth = readScheduleVerticalDayWidth();
        }

        const scrollHeight = scrollEl?.clientHeight || Math.max(320, gridHeight - 12);
        const overheadPerWeek = SCHEDULE_GRID_WEEK_OVERHEAD;
        const availableForGrid = Math.max(220, scrollHeight - weekCount * overheadPerWeek);
        const hourSlots = getScheduleMaxHourSlotsForLayout();
        const hourHeight = Math.max(34, Math.min(72, Math.floor(availableForGrid / (hourSlots * weekCount))));
        let trackStep = Math.max(76, Math.min(132, Math.round(hourHeight * 2.35)));
        if (mode === 'timeline' && scheduleState.horizontalSliderUserAdjusted) {
            trackStep = readScheduleTrackStepFromSlider(undefined, 'timeline');
        }

        return { dayWidth, hourHeight, trackStep, autoFit, gridHeight, dayCount, weekCount };
    }

    function applyScheduleWeekGridLayout(mode) {
        const container = document.getElementById('visualDisplayArea');
        if (!container || !container.classList.contains('schedule-week-grid-host')) return null;
        const isVertical = mode === 'verticalTimeline';
        container.classList.toggle('session-cal-auto-day-width', isVertical && !scheduleState.verticalDayWidthUserAdjusted);
        container.classList.toggle('schedule-cal-horizontal-mode', mode === 'timeline');
        container.classList.toggle('schedule-week-grid-manual-day-width', isVertical && scheduleState.verticalDayWidthUserAdjusted);
        container.classList.toggle('schedule-week-grid-manual-track-height', mode === 'timeline' && scheduleState.horizontalSliderUserAdjusted);
        const layout = computeScheduleWeekGridLayout(mode, container);
        container.style.setProperty('--session-day-width', `${layout.dayWidth}px`);
        container.style.setProperty('--session-hour-height', `${layout.hourHeight}px`);
        container.style.setProperty('--session-hour-slot-count', String(getScheduleMaxHourSlotsForLayout()));
        container.style.setProperty('--session-timeline-track-step', `${layout.trackStep}px`);
        if (mode === 'timeline') {
            applyHorizontalTimelineTrackLayout(container, layout.trackStep);
        }
        if (mode === 'timeline' && scheduleState.horizontalSliderUserAdjusted) {
            applyScheduleDayWidth(readScheduleHorizontalSliderWidth(), { mode: 'timeline' });
        } else if (isVertical && scheduleState.verticalDayWidthUserAdjusted) {
            applyScheduleDayWidth(readScheduleVerticalDayWidth(), { mode: 'verticalTimeline' });
        }
        syncScheduleWidthControlDisplay(readScheduleSliderValueForMode(mode), mode);
        return layout;
    }

    function scheduleWeekGridLayoutAfterRender(mode) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                applyScheduleWeekGridLayout(mode);
                syncScheduleAdminWeekRailVisibility();
                if (!scheduleState.focusStagedSessionOnNextLayout || !activePersonHasDraftStagedSessions()) return;
                scheduleState.focusStagedSessionOnNextLayout = false;
                const person = activeSchedulePerson();
                const date = scheduleState.pendingStagedScrollDate || getFirstDraftStagedSessionDate(person?.id);
                if (date) focusScheduleTimelineOnFirstStagedSession(date);
            });
        });
    }

    function syncScheduleAdminWeekRailVisibility() {
        if (!canSelectAnyPerson) return;
        const rail = document.getElementById('scheduleAdminWeekRail');
        if (!rail) return;
        const scheduleContainer = document.getElementById('scheduleContainer');
        const container = document.getElementById('visualDisplayArea');
        const mode = normalizedScheduleViewMode();
        const weekGridMode = mode === 'verticalTimeline' || mode === 'timeline';
        const show = Boolean(
            scheduleContainer
            && !scheduleContainer.classList.contains('d-none')
            && container
            && container.classList.contains('schedule-week-grid-host')
            && weekGridMode
        );
        rail.classList.toggle('d-none', !show);
        if (show) syncScheduleAdminWeekRailStickyTop();
    }

    function syncScheduleAdminWeekRailStickyTop() {
        if (!canSelectAnyPerson) return;
        const railInner = document.querySelector('#scheduleAdminWeekRail .schedule-admin-week-rail-inner');
        if (!railInner || railInner.closest('.d-none')) return;
        const viewbarTopRaw = getComputedStyle(document.documentElement).getPropertyValue('--schedule-viewbar-sticky-top').trim();
        const viewbarTop = Number.parseFloat(viewbarTopRaw) || 110;
        const railHeight = railInner.offsetHeight || 140;
        const minTop = viewbarTop + 8;
        const maxTop = Math.max(minTop, window.innerHeight - railHeight - 8);
        const centeredTop = (window.innerHeight - railHeight) / 2;
        const stickyTop = Math.min(maxTop, Math.max(minTop, centeredTop));
        document.documentElement.style.setProperty('--schedule-admin-rail-sticky-top', `${stickyTop.toFixed(2)}px`);
    }

    function bindScheduleAdminWeekRail() {
        if (!canSelectAnyPerson || bindScheduleAdminWeekRail.bound) return;
        bindScheduleAdminWeekRail.bound = true;
        const rail = document.getElementById('scheduleAdminWeekRail');
        if (!rail) return;
        // Enrollment action handlers (enroll-students wired via masterScheduleEnrollStudents.js).
        rail.addEventListener('click', (clickEvent) => {
            const actionEl = clickEvent.target.closest('[data-schedule-admin-action]');
            if (!actionEl) return;
            clickEvent.preventDefault();
            const action = String(actionEl.getAttribute('data-schedule-admin-action') || '').trim();
            if (action === 'enroll-students' && typeof enrollStudentsRailHandler === 'function') {
                void enrollStudentsRailHandler();
            }
            if (action === 'move-enrollments' && typeof moveSessionsRailHandler === 'function') {
                void moveSessionsRailHandler();
            }
            if (action === 'merge-sessions' && typeof mergeSessionsRailHandler === 'function') {
                void mergeSessionsRailHandler();
            }
            if (action === 'take-over-sessions' && typeof takeOverSessionsRailHandler === 'function') {
                void takeOverSessionsRailHandler();
            }
            if (action === 'add-co-teacher' && typeof addCoTeacherRailHandler === 'function') {
                void addCoTeacherRailHandler();
            }
            if (action === 'claim-numbers' && typeof claimNumbersRailHandler === 'function') {
                void claimNumbersRailHandler();
            }
            if (action === 'person-schedule-note' && typeof personScheduleNoteRailHandler === 'function') {
                void personScheduleNoteRailHandler();
            }
        });
    }

    function bindScheduleGridResizeObserver() {
        const container = document.getElementById('visualDisplayArea');
        if (!container || scheduleGridResizeObserver) return;
        scheduleGridResizeObserver = new ResizeObserver(() => {
            const mode = normalizedScheduleViewMode();
            if (mode === 'calendar' || !container.classList.contains('schedule-week-grid-host')) return;
            applyScheduleWeekGridLayout(mode);
        });
        scheduleGridResizeObserver.observe(container);
        window.addEventListener('resize', () => {
            const mode = normalizedScheduleViewMode();
            if (mode === 'calendar' || !container.classList.contains('schedule-week-grid-host')) return;
            applyScheduleWeekGridLayout(mode);
        });
    }

    function scheduleHideEmptyDaysButtonHtml() {
        const active = scheduleState.hideEmptyDays ? ' active' : '';
        const pressed = scheduleState.hideEmptyDays ? 'true' : 'false';
        return `<button type="button" class="btn btn-sm btn-outline-secondary schedule-view-icon-btn schedule-hide-empty-btn${active}" data-schedule-hide-empty-days aria-label="Hide days without sessions" title="Hide days without sessions" aria-pressed="${pressed}"><i class="bi bi-calendar2-x" aria-hidden="true"></i></button>`;
    }

    function scheduleTimeRangePopoverHostHtml() {
        const preset = getScheduleTimelinePresetBounds();
        const startValue = timelineHourToTimeInputValue(preset.startHour);
        const endValue = timelineHourToTimeInputValue(preset.endHour);
        const label = formatScheduleTimelinePresetLabel(preset);
        return `
            <div class="schedule-time-range-popover-host">
                <button type="button" class="btn btn-sm btn-outline-secondary schedule-view-icon-btn" data-schedule-time-range-toggle aria-label="Adjust display hours" title="Adjust display hours" aria-expanded="false" aria-controls="scheduleTimeRangePopover">
                    <i class="bi bi-clock" aria-hidden="true"></i>
                </button>
                <div class="schedule-time-range-popover" id="scheduleTimeRangePopover" role="dialog" aria-label="Display hours">
                    <div class="schedule-day-size-popover-label">Display hours</div>
                    <div class="schedule-time-range-fields">
                        <label class="schedule-time-range-field">
                            <span class="schedule-time-range-field-label">Start</span>
                            <input type="time" class="form-control form-control-sm" id="scheduleTimelineStartInput" value="${escapeHtml(startValue)}" step="3600" aria-label="Display start time">
                        </label>
                        <label class="schedule-time-range-field">
                            <span class="schedule-time-range-field-label">End</span>
                            <input type="time" class="form-control form-control-sm" id="scheduleTimelineEndInput" value="${escapeHtml(endValue)}" step="3600" aria-label="Display end time">
                        </label>
                    </div>
                    <div class="schedule-time-range-summary">
                        <span class="badge text-bg-light border" id="scheduleTimelineRangeBadge">${escapeHtml(label)}</span>
                    </div>
                    <div class="schedule-time-range-actions">
                        <button type="button" class="btn btn-sm btn-primary" data-schedule-time-range-apply>Apply</button>
                        <button type="button" class="btn btn-sm btn-outline-secondary" data-schedule-time-range-reset>Default</button>
                    </div>
                </div>
            </div>
        `;
    }

    function closeScheduleTimeRangePopover() {
        const host = document.querySelector('.schedule-time-range-popover-host');
        if (!host) return;
        host.querySelector('.schedule-time-range-popover')?.classList.remove('is-open');
        const toggle = host.querySelector('[data-schedule-time-range-toggle]');
        toggle?.setAttribute('aria-expanded', 'false');
        toggle?.classList.remove('active');
    }

    function openScheduleTimeRangePopover() {
        scheduleAdminUi?.closePersonChipColorPopover?.();
        closeScheduleDaySizePopover();
        closeScheduleStagedPaddingPopover();
        closeScheduleActiveClassPopover();
        const host = document.querySelector('.schedule-time-range-popover-host');
        if (!host) return;
        const preset = getScheduleTimelinePresetBounds();
        const startInput = host.querySelector('#scheduleTimelineStartInput');
        const endInput = host.querySelector('#scheduleTimelineEndInput');
        const badge = host.querySelector('#scheduleTimelineRangeBadge');
        if (startInput) startInput.value = timelineHourToTimeInputValue(preset.startHour);
        if (endInput) endInput.value = timelineHourToTimeInputValue(preset.endHour);
        if (badge) badge.textContent = formatScheduleTimelinePresetLabel(preset);
        host.querySelector('.schedule-time-range-popover')?.classList.add('is-open');
        const toggle = host.querySelector('[data-schedule-time-range-toggle]');
        toggle?.setAttribute('aria-expanded', 'true');
        toggle?.classList.add('active');
    }

    function toggleScheduleTimeRangePopover() {
        const popover = document.querySelector('.schedule-time-range-popover.is-open');
        if (popover) closeScheduleTimeRangePopover();
        else openScheduleTimeRangePopover();
    }

    function syncScheduleTimeRangePopoverPreview() {
        const host = document.querySelector('.schedule-time-range-popover-host');
        if (!host) return;
        const startHour = parseTimelineTimeInputValue(host.querySelector('#scheduleTimelineStartInput')?.value);
        const endHour = parseTimelineTimeInputValue(host.querySelector('#scheduleTimelineEndInput')?.value);
        const badge = host.querySelector('#scheduleTimelineRangeBadge');
        if (!badge || startHour === null || endHour === null) return;
        badge.textContent = formatScheduleTimelinePresetLabel({
            timelineStartHour: startHour,
            timelineEndHour: endHour
        });
    }

    function applyScheduleTimeRangeFromPopover() {
        const host = document.querySelector('.schedule-time-range-popover-host');
        if (!host) return;
        const startHour = parseTimelineTimeInputValue(host.querySelector('#scheduleTimelineStartInput')?.value);
        const endHour = parseTimelineTimeInputValue(host.querySelector('#scheduleTimelineEndInput')?.value);
        if (startHour === null || endHour === null) {
            void uiAlert('Please choose a valid start and end time.', 'Display hours', { icon: 'info' });
            return;
        }
        if (endHour - startHour < 2) {
            void uiAlert('Display hours must span at least 2 hours.', 'Display hours', { icon: 'info' });
            return;
        }
        applyScheduleTimelinePreset(startHour, endHour);
        closeScheduleTimeRangePopover();
    }

    function resetScheduleTimeRangeToDefault() {
        applyScheduleTimelinePreset(SCHEDULE_DEFAULT_TIMELINE_START_HOUR, SCHEDULE_DEFAULT_TIMELINE_END_HOUR);
        closeScheduleTimeRangePopover();
    }

    function scheduleStagedPaddingPopoverHostHtml() {
        const padding = readStagedViewPaddingFromPrefs();
        const label = formatStagedViewPaddingLabel(padding);
        return `
            <div class="schedule-staged-padding-popover-host">
                <button type="button" class="btn btn-sm btn-outline-secondary schedule-view-icon-btn" data-schedule-staged-padding-toggle aria-label="Adjust staged session view padding" title="Adjust staged session view padding" aria-expanded="false" aria-controls="scheduleStagedPaddingPopover">
                    <i class="bi bi-calendar-range" aria-hidden="true"></i>
                </button>
                <div class="schedule-staged-padding-popover" id="scheduleStagedPaddingPopover" role="dialog" aria-label="Staged session view padding">
                    <div class="schedule-day-size-popover-label">Staged session padding</div>
                    <div class="schedule-staged-padding-fields">
                        <label class="schedule-staged-padding-field">
                            <span class="schedule-staged-padding-field-label">Weeks before</span>
                            <input type="number" class="form-control form-control-sm" id="scheduleStagedPaddingWeeksBeforeInput" value="${escapeHtml(String(padding.paddingWeeksBefore))}" min="0" max="${MAX_STAGED_VIEW_PADDING_WEEKS}" step="1" aria-label="Weeks before first staged session">
                        </label>
                        <label class="schedule-staged-padding-field">
                            <span class="schedule-staged-padding-field-label">Weeks after</span>
                            <input type="number" class="form-control form-control-sm" id="scheduleStagedPaddingWeeksAfterInput" value="${escapeHtml(String(padding.paddingWeeksAfter))}" min="0" max="${MAX_STAGED_VIEW_PADDING_WEEKS}" step="1" aria-label="Weeks after last staged session">
                        </label>
                    </div>
                    <div class="schedule-staged-padding-summary">
                        <span class="badge text-bg-light border" id="scheduleStagedPaddingBadge">${escapeHtml(label)}</span>
                    </div>
                    <div class="schedule-staged-padding-actions">
                        <button type="button" class="btn btn-sm btn-primary" data-schedule-staged-padding-apply>Apply</button>
                        <button type="button" class="btn btn-sm btn-outline-secondary" data-schedule-staged-padding-reset>Default</button>
                    </div>
                </div>
            </div>
        `;
    }

    function closeScheduleStagedPaddingPopover() {
        const host = document.querySelector('.schedule-staged-padding-popover-host');
        if (!host) return;
        host.querySelector('.schedule-staged-padding-popover')?.classList.remove('is-open');
        const toggle = host.querySelector('[data-schedule-staged-padding-toggle]');
        toggle?.setAttribute('aria-expanded', 'false');
        toggle?.classList.remove('active');
    }

    function openScheduleStagedPaddingPopover() {
        scheduleAdminUi?.closePersonChipColorPopover?.();
        closeScheduleDaySizePopover();
        closeScheduleTimeRangePopover();
        closeScheduleActiveClassPopover();
        const host = document.querySelector('.schedule-staged-padding-popover-host');
        if (!host) return;
        const padding = readStagedViewPaddingFromPrefs();
        const beforeInput = host.querySelector('#scheduleStagedPaddingWeeksBeforeInput');
        const afterInput = host.querySelector('#scheduleStagedPaddingWeeksAfterInput');
        const badge = host.querySelector('#scheduleStagedPaddingBadge');
        if (beforeInput) beforeInput.value = String(padding.paddingWeeksBefore);
        if (afterInput) afterInput.value = String(padding.paddingWeeksAfter);
        if (badge) badge.textContent = formatStagedViewPaddingLabel(padding);
        host.querySelector('.schedule-staged-padding-popover')?.classList.add('is-open');
        const toggle = host.querySelector('[data-schedule-staged-padding-toggle]');
        toggle?.setAttribute('aria-expanded', 'true');
        toggle?.classList.add('active');
    }

    function toggleScheduleStagedPaddingPopover() {
        const popover = document.querySelector('.schedule-staged-padding-popover.is-open');
        if (popover) closeScheduleStagedPaddingPopover();
        else openScheduleStagedPaddingPopover();
    }

    function readStagedViewPaddingFromPopoverInputs(host) {
        if (!host) return null;
        const beforeRaw = host.querySelector('#scheduleStagedPaddingWeeksBeforeInput')?.value;
        const afterRaw = host.querySelector('#scheduleStagedPaddingWeeksAfterInput')?.value;
        return {
            paddingWeeksBefore: clampStagedViewPaddingWeeks(
                beforeRaw,
                DEFAULT_STAGED_VIEW_PADDING_WEEKS_BEFORE
            ),
            paddingWeeksAfter: clampStagedViewPaddingWeeks(
                afterRaw,
                DEFAULT_STAGED_VIEW_PADDING_WEEKS_AFTER
            )
        };
    }

    function syncScheduleStagedPaddingPopoverPreview() {
        const host = document.querySelector('.schedule-staged-padding-popover-host');
        if (!host) return;
        const padding = readStagedViewPaddingFromPopoverInputs(host);
        if (!padding) return;
        const badge = host.querySelector('#scheduleStagedPaddingBadge');
        if (badge) badge.textContent = formatStagedViewPaddingLabel(padding);
    }

    async function applyScheduleStagedPaddingFromPopover() {
        const host = document.querySelector('.schedule-staged-padding-popover-host');
        const padding = readStagedViewPaddingFromPopoverInputs(host);
        if (!padding) return;
        const saved = await persistScheduleViewerPreferencesPartial({
            stagedViewPaddingWeeksBefore: padding.paddingWeeksBefore,
            stagedViewPaddingWeeksAfter: padding.paddingWeeksAfter
        });
        if (!saved) return;
        closeScheduleStagedPaddingPopover();
    }

    async function resetScheduleStagedPaddingToDefault() {
        const saved = await persistScheduleViewerPreferencesPartial({
            stagedViewPaddingWeeksBefore: DEFAULT_STAGED_VIEW_PADDING_WEEKS_BEFORE,
            stagedViewPaddingWeeksAfter: DEFAULT_STAGED_VIEW_PADDING_WEEKS_AFTER
        });
        if (!saved) return;
        closeScheduleStagedPaddingPopover();
    }

    function bindScheduleStagedPaddingPopoverDismiss() {
        if (bindScheduleStagedPaddingPopoverDismiss.bound) return;
        bindScheduleStagedPaddingPopoverDismiss.bound = true;
        document.addEventListener('click', (event) => {
            const host = document.querySelector('.schedule-staged-padding-popover-host');
            if (!host) return;
            const popover = host.querySelector('.schedule-staged-padding-popover');
            if (!popover?.classList.contains('is-open')) return;
            if (host.contains(event.target)) return;
            closeScheduleStagedPaddingPopover();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            closeScheduleStagedPaddingPopover();
        });
        document.addEventListener('input', (event) => {
            if (!event.target?.closest?.('.schedule-staged-padding-popover-host')) return;
            syncScheduleStagedPaddingPopoverPreview();
        });
    }

    function bindScheduleTimeRangePopoverDismiss() {
        if (bindScheduleTimeRangePopoverDismiss.bound) return;
        bindScheduleTimeRangePopoverDismiss.bound = true;
        document.addEventListener('click', (event) => {
            const host = document.querySelector('.schedule-time-range-popover-host');
            if (!host) return;
            const popover = host.querySelector('.schedule-time-range-popover');
            if (!popover?.classList.contains('is-open')) return;
            if (host.contains(event.target)) return;
            closeScheduleTimeRangePopover();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            closeScheduleTimeRangePopover();
        });
    }

    function scheduleWidthControlHtml() {
        const mode = normalizedScheduleViewMode();
        const width = readScheduleSliderValueForMode(mode);
        const ariaLabel = mode === 'timeline' ? 'Row height' : 'Day width';
        return `
            <div class="schedule-width-control">
                <input type="range" class="form-range" id="scheduleDayWidth" min="${SCHEDULE_MIN_DAY_WIDTH}" max="${SCHEDULE_MAX_DAY_WIDTH}" step="10" value="${escapeHtml(width)}" aria-label="${escapeHtml(ariaLabel)}">
                <span class="badge text-bg-light border schedule-width-value" id="scheduleDayWidthValue">${escapeHtml(mode === 'timeline' ? `${readScheduleTrackStepFromSlider(width, 'timeline')}px` : `${width}px`)}</span>
            </div>
        `;
    }

    function scheduleDaySizePopoverHostHtml(mode) {
        const label = mode === 'timeline' ? 'Row height' : 'Day width';
        const title = mode === 'timeline' ? 'Adjust row height' : 'Adjust day width';
        return `
            <div class="schedule-day-size-popover-host">
                <button type="button" class="btn btn-sm btn-outline-secondary schedule-view-icon-btn" data-schedule-day-size-toggle aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}" aria-expanded="false" aria-controls="scheduleDaySizePopover">
                    <i class="bi bi-sliders" aria-hidden="true"></i>
                </button>
                <div class="schedule-day-size-popover" id="scheduleDaySizePopover" role="dialog" aria-label="${escapeHtml(label)}">
                    <div class="schedule-day-size-popover-label">${escapeHtml(label)}</div>
                    ${scheduleWidthControlHtml()}
                </div>
            </div>
        `;
    }

    function closeScheduleDaySizePopover() {
        const host = document.querySelector('.schedule-day-size-popover-host');
        if (!host) return;
        host.querySelector('.schedule-day-size-popover')?.classList.remove('is-open');
        const toggle = host.querySelector('[data-schedule-day-size-toggle]');
        toggle?.setAttribute('aria-expanded', 'false');
        toggle?.classList.remove('active');
    }

    function openScheduleDaySizePopover() {
        scheduleAdminUi?.closePersonChipColorPopover?.();
        closeScheduleTimeRangePopover();
        closeScheduleStagedPaddingPopover();
        const host = document.querySelector('.schedule-day-size-popover-host');
        if (!host) return;
        host.querySelector('.schedule-day-size-popover')?.classList.add('is-open');
        const toggle = host.querySelector('[data-schedule-day-size-toggle]');
        toggle?.setAttribute('aria-expanded', 'true');
        toggle?.classList.add('active');
        syncScheduleWidthControlDisplay();
    }

    function toggleScheduleDaySizePopover() {
        const popover = document.querySelector('.schedule-day-size-popover.is-open');
        if (popover) closeScheduleDaySizePopover();
        else openScheduleDaySizePopover();
    }

    function bindScheduleDaySizePopoverDismiss() {
        if (bindScheduleDaySizePopoverDismiss.bound) return;
        bindScheduleDaySizePopoverDismiss.bound = true;
        document.addEventListener('click', (event) => {
            const host = document.querySelector('.schedule-day-size-popover-host');
            if (!host) return;
            const popover = host.querySelector('.schedule-day-size-popover');
            if (!popover?.classList.contains('is-open')) return;
            if (host.contains(event.target)) return;
            closeScheduleDaySizePopover();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            closeScheduleDaySizePopover();
        });
    }

    function scheduleGridToolbarControlsHtml() {
        return buildScheduleSaveDraftsButtonHtml();
    }

    function scheduleLegendItemsForMode(mode) {
        if (mode === 'calendar') {
            return [
                '<span class="schedule-legend-item text-muted small">Month cells show compact start times; click a day for vertical day view</span>',
                '<span class="schedule-legend-item text-success fw-bold"><i class="bi bi-check-circle-fill small"></i> Completed session</span>',
                '<span class="schedule-legend-item text-warning fw-bold"><i class="bi bi-clock-history small"></i> Pending session</span>',
                '<span class="schedule-legend-item text-warning-emphasis fw-bold"><i class="bi bi-calendar-plus"></i> M = Make-up required</span>',
                '<span class="schedule-legend-item text-danger fw-bold"><i class="bi bi-exclamation-circle-fill"></i> Conflict Day</span>',
                '<span class="schedule-legend-item text-danger fw-bold"><i class="bi bi-stars me-1"></i> Important report</span>',
                '<span class="schedule-legend-item text-warning fw-bold"><i class="bi bi-circle-fill small"></i> Leave Day</span>'
            ];
        }
        return [
            '<span class="schedule-legend-item"><span class="d-inline-block rounded-circle" style="width:12px;height:12px;background:#0dcaf0;"></span> Teacher/Staff</span>',
            '<span class="schedule-legend-item"><span class="d-inline-block rounded-circle" style="width:12px;height:12px;background:#8ec5ff;"></span> Student</span>',
            '<span class="schedule-legend-item"><span class="d-inline-block rounded-circle" style="width:12px;height:12px;background:#ffd43b;"></span> Approved Leave</span>',
            '<span class="schedule-legend-item text-success fw-bold"><i class="bi bi-check-circle-fill"></i> Complete</span>',
            '<span class="schedule-legend-item text-warning fw-bold"><i class="bi bi-clock-history"></i> Pending</span>',
            '<span class="schedule-legend-item text-warning-emphasis fw-bold"><i class="bi bi-calendar-plus"></i> Make-up required (partial credit, non-blocking)</span>',
            '<span class="schedule-legend-item text-danger fw-bold"><span class="d-inline-block rounded-circle" style="width:12px;height:12px;background:#dc3545;"></span> Overlap</span>',
            '<span class="schedule-legend-item text-danger fw-bold"><i class="bi bi-stars me-1"></i> Important report</span>'
        ];
    }

    function scheduleViewName(mode) {
        if (mode === 'calendar') return 'Month view';
        if (mode === 'timeline') return 'Horizontal day view';
        return 'Vertical day view';
    }

    function normalizedScheduleViewMode(mode = scheduleState.viewMode) {
        return resolveScheduleViewMode(mode);
    }

    function buildScheduleLoadedAtChipHtml() {
        const person = activeSchedulePerson();
        if (!person) return '';
        if (scheduleState.loadingPersonId === person.id) return '';
        if (!scheduleState.loadedPersonIds.has(person.id)) return '';
        if (scheduleState.errorByPersonId[person.id]) return '';
        const loadedAt = scheduleState.lastLoadedAtByPersonId[person.id];
        if (!loadedAt && !scheduleState.remoteUpdatePending) return '';
        const staleClass = (scheduleState.staleAfterHidden || scheduleState.remoteUpdatePending) ? ' is-stale' : '';
        const label = scheduleState.remoteUpdatePending
            ? 'Update available'
            : `Updated ${formatSchoolInstant(loadedAt)}`;
        const title = scheduleState.remoteUpdatePending
            ? 'New schedule data is available. Click to refresh.'
            : 'Click to refresh schedule data';
        const autoDetectOn = isScheduleAutoChangeDetectorEnabled();
        const toggleClass = autoDetectOn ? 'is-on' : 'is-off';
        const toggleLabel = autoDetectOn ? 'ON' : 'OFF';
        const toggleTitle = autoDetectOn
            ? 'Auto-detect schedule changes is on. Click to turn off.'
            : 'Auto-detect schedule changes is off. Click to turn on.';
        return `<div class="schedule-loaded-at-wrap"><div class="schedule-loaded-at-chip-shell"><button type="button" class="schedule-loaded-at-chip${staleClass}" data-schedule-refresh-loaded title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i><span>${escapeHtml(label)}</span></button><button type="button" class="schedule-auto-detect-toggle ${toggleClass}" data-schedule-auto-detect-toggle aria-pressed="${autoDetectOn ? 'true' : 'false'}" title="${escapeHtml(toggleTitle)}" aria-label="${escapeHtml(toggleTitle)}">Auto ${escapeHtml(toggleLabel)}</button></div></div>`;
    }

    function markScheduleDataStaleAfterReturn() {
        const person = activeSchedulePerson();
        if (!person || !scheduleState.lastLoadedAtByPersonId[person.id]) return;
        if (scheduleState.staleAfterHidden) return;
        scheduleState.staleAfterHidden = true;
        refreshScheduleActiveView();
    }

    function renderScheduleControls(mode) {
        const legend = document.getElementById('legendContainer');
        const modalBody = document.getElementById('scheduleLegendModalBody');
        if (modalBody) modalBody.innerHTML = `<div class="schedule-legend-items">${scheduleLegendItemsForMode(mode).join('')}</div>`;
        if (!legend) return;
        let switchButtons = '';
        if (mode === 'calendar') {
            switchButtons = '<button type="button" class="btn btn-sm btn-outline-primary schedule-view-icon-btn" data-schedule-view-vertical aria-label="Switch to vertical day view" title="Switch to vertical day view"><i class="bi bi-columns-gap" aria-hidden="true"></i></button>';
        } else {
            switchButtons = [
                mode === 'verticalTimeline'
                    ? '<button type="button" class="btn btn-sm btn-outline-primary schedule-view-icon-btn" data-schedule-view-timeline aria-label="Switch to horizontal day view" title="Switch to horizontal day view"><i class="bi bi-layout-three-columns" aria-hidden="true"></i></button>'
                    : '<button type="button" class="btn btn-sm btn-outline-primary schedule-view-icon-btn" data-schedule-view-vertical aria-label="Switch to vertical day view" title="Switch to vertical day view"><i class="bi bi-columns-gap" aria-hidden="true"></i></button>',
                '<button type="button" class="btn btn-sm btn-outline-primary schedule-view-icon-btn" data-schedule-view-month aria-label="Switch to month view" title="Switch to month view"><i class="bi bi-calendar3" aria-hidden="true"></i></button>'
            ].join('');
        }
        const showWeekGridControls = mode === 'verticalTimeline' || mode === 'timeline';
        const daySizeControl = showWeekGridControls ? scheduleDaySizePopoverHostHtml(mode) : '';
        const timeRangeControl = showWeekGridControls ? scheduleTimeRangePopoverHostHtml() : '';
        const stagedPaddingControl = (canSelectAnyPerson && showWeekGridControls)
            ? scheduleStagedPaddingPopoverHostHtml()
            : '';
        const hideEmptyDaysButton = showWeekGridControls ? scheduleHideEmptyDaysButtonHtml() : '';
        const row2RightControls = showWeekGridControls
            ? `<div class="schedule-viewbar-grid-controls">${scheduleGridToolbarControlsHtml()}</div>`
            : '';
        const loadedAtChip = buildScheduleLoadedAtChipHtml();
        legend.innerHTML = `
            <div class="schedule-viewbar">
                <div class="schedule-viewbar-row">
                    <div class="schedule-viewbar-row-left schedule-viewbar-title-group">
                        <span class="schedule-view-name"><i class="bi bi-calendar-day me-1"></i>${escapeHtml(scheduleViewName(mode))}</span>
                        ${buildScheduleActiveClassChipHtml()}
                    </div>
                    <div class="schedule-viewbar-row-right schedule-viewbar-actions">
                    ${timeRangeControl}
                    ${stagedPaddingControl}
                    ${daySizeControl}
                    ${switchButtons}
                        ${hideEmptyDaysButton}
                        <button type="button" class="btn btn-sm btn-outline-secondary schedule-view-icon-btn" data-schedule-open-legend aria-label="Legend" title="Legend"><i class="bi bi-info-circle" aria-hidden="true"></i></button>
                    </div>
                </div>
                <div class="schedule-viewbar-row">
                    <div class="schedule-viewbar-row-left schedule-viewbar-chips">
                        ${buildScheduleSelectionChipHtml()}
                        <div id="lbl_totalHours" class="schedule-toolbar-hours"></div>
                        ${loadedAtChip}
                    </div>
                    <div class="schedule-viewbar-row-right is-controls-row">
                        ${row2RightControls}
                    </div>
                </div>
            </div>
        `;
        syncScheduleWidthControlDisplay();
        updateScheduleSelectionControls();
    }

    function groupEventsByDate(events) {
        if (scheduleCalendarCore) {
            const grouped = scheduleCalendarCore.groupEventsByDate(events);
            Object.keys(grouped).forEach((date) => {
                grouped[date].sort((a, b) => {
                    const aStart = timeToMinutes(a?.start);
                    const bStart = timeToMinutes(b?.start);
                    if (aStart !== bStart) return aStart - bStart;
                    return getEventTitle(a).localeCompare(getEventTitle(b));
                });
            });
            return grouped;
        }
        const grouped = {};
        (Array.isArray(events) ? events : []).forEach((ev) => {
            if (!ev?.date) return;
            if (!grouped[ev.date]) grouped[ev.date] = [];
            grouped[ev.date].push(ev);
        });
        Object.keys(grouped).forEach((date) => {
            grouped[date].sort((a, b) => {
                const aStart = timeToMinutes(a?.start);
                const bStart = timeToMinutes(b?.start);
                if (aStart !== bStart) return aStart - bStart;
                return getEventTitle(a).localeCompare(getEventTitle(b));
            });
        });
        return grouped;
    }

    function formatSchoolInstant(value) {
        if (window.AppOrgDateTime && typeof window.AppOrgDateTime.formatSchoolInstant === 'function') {
            return window.AppOrgDateTime.formatSchoolInstant(value);
        }
        const dateObj = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(dateObj.getTime())) return String(value || '');
        return dateObj.toLocaleString();
    }

    function schPrintFormatDateShort(ymd) {
        const raw = String(ymd || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw || '—';
        const d = new Date(`${raw}T00:00:00`);
        if (Number.isNaN(d.getTime())) return raw;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function schPrintFormatWeekday(ymd) {
        const raw = String(ymd || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
        const d = new Date(`${raw}T00:00:00`);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleDateString('en-US', { weekday: 'short' });
    }

    function schPrintFormatRangeLabel(startDate, endDate) {
        const start = String(startDate || '').trim();
        const end = String(endDate || '').trim();
        if (!start && !end) return 'All dates';
        if (start && end) return `${schPrintFormatDateShort(start)} – ${schPrintFormatDateShort(end)}`;
        if (start) return `From ${schPrintFormatDateShort(start)}`;
        return `Through ${schPrintFormatDateShort(end)}`;
    }

    function setSchedulePrintEnabled(enabled) {
        const printBtn = document.getElementById('btn_printSchedule');
        if (!printBtn) return;
        printBtn.disabled = !enabled;
        printBtn.title = enabled ? 'Print the loaded schedule' : 'Load a schedule first';
    }

    function collectSchedulePrintData() {
        const person = activeSchedulePerson();
        if (!person || !scheduleState.loadedPersonIds.has(person.id) || scheduleState.errorByPersonId[person.id]) {
            return null;
        }
        const events = getScheduleEventsForPerson(person.id);
        events.sort((a, b) => {
            const dateCmp = String(a?.date || '').localeCompare(String(b?.date || ''));
            if (dateCmp !== 0) return dateCmp;
            const aStart = timeToMinutes(a?.start);
            const bStart = timeToMinutes(b?.start);
            if (aStart !== bStart) return aStart - bStart;
            return getEventTitle(a).localeCompare(getEventTitle(b));
        });
        const statusMeta = scheduleState.statusMetaByPersonId[person.id] || [];
        const statusMap = new Map(
            statusMeta
                .map((row) => [normalizeSessionStatus(row?.code), row])
                .filter(([code]) => Boolean(code))
        );
        const range = getScheduleRange();
        const role = String(person.selectedRole || selectedScheduleRole() || '').trim();
        return {
            personName: String(person.name || person.id || 'Schedule').trim() || 'Schedule',
            role,
            viewMode: normalizedScheduleViewMode(),
            startDate: range.startDate,
            endDate: range.endDate,
            events,
            statusMap
        };
    }

    function schPrintBuildSummary(events) {
        const list = Array.isArray(events) ? events : [];
        let totalHours = 0;
        const categoryTotals = new Map();
        list.forEach((event) => {
            if (event?.countsTowardHours === false) return;
            const duration = Number(event?.duration || 0);
            if (!Number.isFinite(duration) || duration <= 0) return;
            totalHours += duration;
            getEventCategoryLabels(event).forEach((label) => {
                categoryTotals.set(label, (categoryTotals.get(label) || 0) + duration);
            });
        });
        const statParts = [
            `<span class="stat"><b>${list.length}</b> items</span>`,
            `<span class="stat">Total <b>${totalHours.toFixed(2)}</b> h</span>`
        ];
        Array.from(categoryTotals.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .forEach(([label, hours]) => {
                statParts.push(`<span class="stat">${escapeHtml(label)} <b>${hours.toFixed(2)}</b> h</span>`);
            });
        return statParts;
    }

    function schPrintBuildLegend() {
        return 'Columns: # · Date · Time · Session · Role · Status · Hours · Student · Room · Notes';
    }

    function buildSchedulePrintDocument(data, meta = {}) {
        const payload = data && typeof data === 'object' ? data : {};
        const events = Array.isArray(payload.events) ? payload.events : [];
        const statusMap = payload.statusMap instanceof Map ? payload.statusMap : new Map();
        const personName = String(payload.personName || meta.personName || 'Schedule').trim() || 'Schedule';
        const roleLabel = String(payload.role || meta.role || '').trim();
        const viewModeLabel = scheduleViewName(payload.viewMode || meta.viewMode || 'verticalTimeline');
        const orgName = String(meta.orgName || '').trim();
        const rangeLabel = schPrintFormatRangeLabel(meta.startDate || payload.startDate, meta.endDate || payload.endDate);
        const printedAt = meta.printedAt instanceof Date ? meta.printedAt : new Date();
        const printedAtLabel = formatSchoolInstant(printedAt);
        const fallbackSettings = {
            includeOrg: true,
            orgName,
            includeHeaderNote: false,
            headerNote: '',
            orientation: 'landscape',
            density: 'compact',
            requestedByLabel: '',
            logoUrl: ''
        };
        const settings = window.AppPrintManager?.normalizeSettings
            ? window.AppPrintManager.normalizeSettings({ ...fallbackSettings, ...(meta.printSettings || {}) })
            : fallbackSettings;
        const displayOrgName = settings.includeOrg ? String(settings.orgName || orgName || '').trim() : '';
        const logoUrl = String(settings.logoUrl || '').trim();
        const logoHtml = logoUrl
            ? `<img class="print-logo" src="${escapeHtml(logoUrl)}" alt="Organization logo" onerror="this.style.display='none'">`
            : '';
        const pageCss = window.PrintDocumentBuilder?.buildPageCss
            ? window.PrintDocumentBuilder.buildPageCss(settings.orientation)
            : `@page { margin: 10mm; size: ${settings.orientation === 'portrait' ? 'portrait' : 'landscape'}; }`;
        const previewControlsHtml = window.AppPrintManager?.buildPreviewControlsHtml
            ? window.AppPrintManager.buildPreviewControlsHtml(settings)
            : '<div class="screen-actions no-print"><button type="button" onclick="window.print()">Print</button><button type="button" onclick="window.close()">Close</button></div>';
        const printNoteHtml = window.AppPrintManager?.buildPrintNoteHtml
            ? window.AppPrintManager.buildPrintNoteHtml(settings)
            : '';
        const orientationScript = window.PrintDocumentBuilder?.buildPreviewOrientationScript
            ? window.PrintDocumentBuilder.buildPreviewOrientationScript({ orientation: settings.orientation, sourcePath: location.pathname, mode: 'master-schedule' })
            : '';

        const bodyRows = events.map((event, index) => {
            const scan = window.ScheduleCompletionDisplay
                ? window.ScheduleCompletionDisplay.resolveScheduleCompletionScan(event, statusMap)
                : null;
            const statusLabel = scan?.scanLabel || formatStatusLabel(event?.status);
            const soloName = normalizeScheduleTooltipValue(event?.soloStudentName || event?.singleStudentName);
            const student = soloName && !isScheduleOpaqueLabel(soloName, event?.soloStudentId, event?.soloStudentPersonId)
                ? soloName
                : '';
            const room = normalizeScheduleTooltipValue(event?.room || event?.roomName || event?.location);
            const role = isLeaveEvent(event)
                ? 'Approved Leave'
                : String(event?.roleLabel || event?.role || event?.roles?.[0] || '').trim();
            const duration = Number.isFinite(Number(event?.duration)) ? `${Number(event.duration).toFixed(2)} h` : '';
            const caseSummary = event?.caseSummary?.hasCases
                ? String(event.caseSummary.badgeLabel || `${event.caseSummary.totalCount || 0} case(s)`)
                : '';
            const conflict = event?.hasOverlap ? 'Overlap' : '';
            const notes = [caseSummary, conflict].filter(Boolean).join(' · ');
            const shortDate = schPrintFormatDateShort(event?.date);
            const weekday = schPrintFormatWeekday(event?.date);
            return `
                <tr>
                    <td class="num-col">${index + 1}</td>
                    <td class="date-col"><div class="day-date">${escapeHtml(shortDate)}</div>${weekday ? `<div class="day-wd">${escapeHtml(weekday)}</div>` : ''}</td>
                    <td class="time-col">${escapeHtml(formatScheduleClockRange(event?.start, event?.end))}</td>
                    <td class="session-col">${escapeHtml(getEventTitle(event))}</td>
                    <td class="role-col">${escapeHtml(role || '—')}</td>
                    <td class="status-col">${escapeHtml(statusLabel || '—')}</td>
                    <td class="dur-col">${escapeHtml(duration || '—')}</td>
                    <td class="student-col">${escapeHtml(student || '—')}</td>
                    <td class="room-col">${escapeHtml(room || '—')}</td>
                    <td class="notes-col">${escapeHtml(notes || '—')}</td>
                </tr>
            `;
        }).join('');

        const emptyRow = `<tr><td colspan="10" class="empty-msg">No schedule items found in this date range.</td></tr>`;
        const printStatParts = schPrintBuildSummary(events);
        const printLegend = schPrintBuildLegend();

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(`Master Schedule — ${personName}`)}</title>
  <style id="print-page-orientation-css">${pageCss}</style>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 10px;
      color: #111;
      line-height: 1.25;
    }
    body.print-density-normal { font-size: 11px; line-height: 1.35; }
    .sheet { padding: 0; }
    .identity-block { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 8px; }
    .identity-copy { min-width: 0; flex: 1 1 auto; }
    .print-logo { display: block; flex: 0 0 auto; width: auto; height: 58px; max-width: 180px; object-fit: contain; object-position: right top; }
    .doc-header { margin-bottom: 8px; }
    .doc-header h1 {
      margin: 0 0 2px 0;
      font-size: 16px;
      font-weight: 700;
    }
    .org-name {
      font-size: 13px;
      font-weight: 700;
      margin: 0 0 4px 0;
    }
    .print-note {
      margin: 0 0 8px;
      border: 1px solid #cfd7e3;
      background: #f4f7fb;
      padding: 6px 8px;
      color: #333;
      white-space: pre-wrap;
    }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 18px;
      color: #333;
      margin-bottom: 6px;
    }
    .meta-row span strong { font-weight: 600; }
    .summary {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 14px;
      border: 1px solid #ccc;
      background: #f8f9fa;
      padding: 6px 8px;
      margin-bottom: 8px;
      border-radius: 2px;
    }
    .summary .stat { white-space: nowrap; }
    .summary .stat b { font-weight: 700; }
    .legend {
      margin: 0 0 8px 0;
      color: #444;
      font-size: 9.5px;
    }
    table.matrix {
      width: 100%;
      border-collapse: collapse;
      table-layout: auto;
    }
    table.matrix th,
    table.matrix td {
      border: 1px solid #bbb;
      padding: 3px 4px;
      vertical-align: middle;
    }
    table.matrix thead th {
      background: #eef1f4;
      font-weight: 700;
      text-align: center;
    }
    table.matrix thead { display: table-header-group; }
    table.matrix tbody tr { page-break-inside: avoid; }
    .num-col { width: 28px; text-align: center; color: #555; }
    .date-col { text-align: center; min-width: 52px; white-space: nowrap; }
    .day-date { font-size: 9.5px; }
    .day-wd { font-size: 8px; color: #666; font-weight: 500; }
    .time-col { text-align: center; min-width: 72px; white-space: nowrap; }
    .session-col { text-align: left; min-width: 110px; font-weight: 600; }
    .role-col, .status-col, .student-col, .room-col, .notes-col { text-align: left; }
    .dur-col { text-align: center; min-width: 44px; white-space: nowrap; font-weight: 600; }
    .empty-msg { text-align: center; color: #666; padding: 16px !important; }
    .doc-footer {
      margin-top: 10px;
      padding-top: 4px;
      border-top: 1px solid #ddd;
      color: #666;
      font-size: 9px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
    @media print {
      body { margin: 0; }
      .no-print { display: none !important; }
      a { color: inherit; text-decoration: none; }
    }
    @media screen {
      body { background: #e9ecef; padding: 16px; }
      .sheet {
        background: #fff;
        padding: 14px 16px;
        box-shadow: 0 1px 6px rgba(0,0,0,0.12);
        max-width: 100%;
      }
      .screen-actions {
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
      }
      .screen-actions-label { color: #333; font-weight: 600; }
      .screen-actions button {
        font: inherit;
        padding: 6px 12px;
        cursor: pointer;
        border: 1px solid #adb5bd;
        background: #fff;
        border-radius: 4px;
      }
      .screen-actions button.is-active { background: #174ea6; border-color: #174ea6; color: #fff; }
      .screen-actions-hint { margin: -4px 0 10px; color: #555; font-size: 11px; }
    }
  </style>
</head>
<body class="print-density-${settings.density}" data-print-orientation="${settings.orientation}">
  ${previewControlsHtml}
  <div class="sheet">
    <div class="identity-block">
      <div class="identity-copy">
        <header class="doc-header">
          ${displayOrgName ? `<div class="org-name">${escapeHtml(displayOrgName)}</div>` : ''}
          <h1>Master Schedule</h1>
          <div class="meta-row">
            <span><strong>Person:</strong> ${escapeHtml(personName)}</span>
            ${roleLabel ? `<span><strong>Role:</strong> ${escapeHtml(roleLabel)}</span>` : ''}
            <span><strong>Range:</strong> ${escapeHtml(rangeLabel)}</span>
            <span><strong>View:</strong> ${escapeHtml(viewModeLabel)}</span>
            <span><strong>Printed:</strong> ${escapeHtml(printedAtLabel)}</span>
            ${settings.requestedByLabel ? `<span><strong>Requested by:</strong> ${escapeHtml(settings.requestedByLabel)}</span>` : ''}
          </div>
        </header>
      </div>
      ${logoHtml}
    </div>
    ${printNoteHtml}

    <div class="summary">
      ${printStatParts.join('\n      ')}
    </div>
    <div class="legend">${escapeHtml(printLegend)}</div>

    <table class="matrix">
      <thead>
        <tr>
          <th class="num-col">#</th>
          <th class="date-col">Date</th>
          <th class="time-col">Time</th>
          <th class="session-col">Session</th>
          <th class="role-col">Role</th>
          <th class="status-col">Status</th>
          <th class="dur-col">Hours</th>
          <th class="student-col">Student</th>
          <th class="room-col">Room</th>
          <th class="notes-col">Notes</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows || emptyRow}
      </tbody>
    </table>

    <footer class="doc-footer">
      <span>Generated from Master Schedule Viewer</span>
      <span>${escapeHtml(personName)} · ${escapeHtml(rangeLabel)}</span>
    </footer>
  </div>
  ${orientationScript}
</body>
</html>`;
    }

    function openSchedulePrint() {
        const printData = collectSchedulePrintData();
        if (!printData) {
            uiAlert('Load a schedule for the active person first.', 'Nothing to print', { icon: 'info' });
            return;
        }

        const orgName = String(document.getElementById('activeOrgNameRef')?.getAttribute('data-name') || '').trim();
        const defaults = { orgName, orientation: 'landscape', density: 'compact' };
        const openPreview = (settings = defaults) => {
            const html = buildSchedulePrintDocument(printData, {
                orgName,
                startDate: printData.startDate,
                endDate: printData.endDate,
                personName: printData.personName,
                role: printData.role,
                viewMode: printData.viewMode,
                printedAt: new Date(),
                printSettings: settings
            });
            const printWindow = window.AppPrintManager?.openHtmlPreview
                ? window.AppPrintManager.openHtmlPreview({
                    title: 'Master Schedule',
                    html,
                    settings,
                    sourcePath: location.pathname,
                    view: 'master-schedule'
                })
                : null;
            if (!printWindow) {
                uiAlert('Allow pop-ups for this site to open the print page.', 'Popup blocked', { icon: 'warning' });
            }
        };

        if (window.AppPrintManager?.openSettings) {
            window.AppPrintManager.openSettings({
                mode: 'master-schedule',
                defaults,
                onConfirm: openPreview
            });
        } else {
            openPreview(defaults);
        }
    }

    function refreshScheduleSummary(events) {
        const lblHours = document.getElementById('lbl_totalHours');
        if (lblHours) lblHours.innerHTML = renderCategoryHourTotals(events || []);
    }

    function refreshScheduleActiveView() {
        renderSchedulePersonTabs();
        const person = activeSchedulePerson();
        updateRoleOptionsForActivePerson();
        const container = document.getElementById('visualDisplayArea');
        if (!container) return;
        if (!person) {
            document.getElementById('scheduleContainer')?.classList.add('d-none');
            document.getElementById('legendContainer').innerHTML = '';
            refreshScheduleSummary([]);
            setSchedulePrintEnabled(false);
            syncScheduleAdminWeekRailVisibility();
            return;
        }
        document.getElementById('scheduleContainer')?.classList.remove('d-none');
        if (scheduleState.loadingPersonId === person.id) {
            renderScheduleControls(normalizedScheduleViewMode());
            refreshScheduleSummary([]);
            setSchedulePrintEnabled(false);
            container.innerHTML = `<div class="text-center py-5"><div class="spinner-border text-primary"></div><div class="mt-2 text-muted small">Loading schedule for ${escapeHtml(person.name || person.id)}...</div></div>`;
            syncScheduleAdminWeekRailVisibility();
            return;
        }
        if (!scheduleState.loadedPersonIds.has(person.id)) {
            renderScheduleControls(normalizedScheduleViewMode());
            refreshScheduleSummary([]);
            setSchedulePrintEnabled(false);
            container.innerHTML = `<div class="alert alert-light text-center border py-5 text-muted"><i class="bi bi-arrow-clockwise fs-1 d-block mb-2"></i>Schedule is ready to load for ${escapeHtml(person.name || person.id)}.</div>`;
            syncScheduleAdminWeekRailVisibility();
            return;
        }
        if (scheduleState.errorByPersonId[person.id]) {
            renderScheduleControls(normalizedScheduleViewMode());
            refreshScheduleSummary([]);
            setSchedulePrintEnabled(false);
            container.innerHTML = `<div class="alert alert-danger text-center"><i class="bi bi-x-circle me-2"></i>${escapeHtml(scheduleState.errorByPersonId[person.id])}</div>`;
            syncScheduleAdminWeekRailVisibility();
            return;
        }
        const events = getScheduleEventsForPerson(person.id);
        sessionStatusMetaMap = new Map(
            (scheduleState.statusMetaByPersonId[person.id] || [])
                .map((row) => [normalizeSessionStatus(row?.code), row])
                .filter(([code]) => Boolean(code))
        );
        const grouped = groupEventsByDate(events);
        const mode = normalizedScheduleViewMode();
        renderScheduleControls(mode);
        refreshScheduleSummary(events);
        if (mode === 'calendar') {
            const range = getScheduleRange();
            syncScheduleMonthViewLayout(container);
            renderCalendarView(grouped, range.startDate, range.endDate, container);
            setSchedulePrintEnabled(true);
            syncScheduleAdminWeekRailVisibility();
            return;
        }
        clearScheduleMonthViewLayout(container);
        container.classList.add('schedule-week-grid-host');
        if (!events.length && scheduleState.hideEmptyDays) {
            container.innerHTML = `<div class="alert alert-light text-center border py-5 text-muted"><i class="bi bi-calendar-x fs-1 d-block mb-2"></i>No schedule items found in this date range.</div>`;
            setSchedulePrintEnabled(true);
            syncScheduleAdminWeekRailVisibility();
            return;
        }
        const rendered = mode === 'timeline'
            ? renderTimelineView(grouped, container)
            : renderVerticalTimelineView(grouped, container);
        if (!rendered) {
            container.innerHTML = `<div class="alert alert-light text-center border py-5 text-muted"><i class="bi bi-calendar-x fs-1 d-block mb-2"></i>No schedule items found in this date range.</div>`;
        } else {
            scheduleWeekGridLayoutAfterRender(mode);
            bindScheduleDragCreate(container, mode);
        }
        setSchedulePrintEnabled(true);
        if (typeof schedulePersistDraftBackup === 'function') schedulePersistDraftBackup();
        syncScheduleAdminWeekRailVisibility();
    }

    async function loadSchedulePerson(person, options = {}) {
        if (!person) return false;
        const silent = options.silent === true;
        const range = getScheduleRange();
        if (!range.startDate || !range.endDate) { await uiAlert('Please select a start and end date.', 'Load schedule', { icon: 'info' }); return false; }
        const role = person.id === scheduleState.activePersonId ? String(selectedScheduleRole() || person.selectedRole || '').trim() : String(person.selectedRole || '').trim();
        person.selectedRole = role;
        scheduleState.loadingPersonId = person.id;
        resetScheduleActiveClassFilter();
        refreshScheduleActiveView();
        if (!silent && typeof window.showLoading === 'function') window.showLoading(`Loading schedule for ${person.name || person.id}...`);
        try {
            await syncScheduleHolidayDates();
            const params = new URLSearchParams({ personId: person.id, startDate: range.startDate, endDate: range.endDate });
            if (role) params.set('role', role);
            if (hasCasesOnly()) params.set('hasCases', '1');
            const res = await fetch(`/school/schedules/api/person-schedule?${params.toString()}`, {
                headers: { 'X-AJAX-Request': 'true', Accept: 'application/json' },
                credentials: 'same-origin'
            });
            const result = await res.json();
            const guarded = typeof window.applyGuardedApiResult === 'function'
                ? await window.applyGuardedApiResult(result, { busyTitle: 'Schedule Load In Progress', replayTitle: 'Schedule Already Loaded' })
                : { stop: false };
            if (guarded.stop) return false;
            if (!res.ok || result.status !== 'success') throw new Error(result.message || 'Unable to load schedule.');
            if (Array.isArray(result.availableRoles)) person.availableRoles = result.availableRoles;
            person.selectedRole = result.selectedRole || role;
            scheduleState.eventsByPersonId[person.id] = Array.isArray(result.events) ? result.events : [];
            scheduleState.statusMetaByPersonId[person.id] = Array.isArray(result.statusMeta) ? result.statusMeta : [];
            scheduleState.activeClassesByPersonId[person.id] = Array.isArray(result.activeClasses) ? result.activeClasses : [];
            if (person.id === scheduleState.activePersonId) {
                scheduleState.activeClasses = scheduleState.activeClassesByPersonId[person.id];
                resetScheduleActiveClassFilter();
            }
            delete scheduleState.errorByPersonId[person.id];
            scheduleState.loadedPersonIds.add(person.id);
            scheduleState.lastLoadedAtByPersonId[person.id] = new Date().toISOString();
            scheduleState.staleAfterHidden = false;
            const fingerprint = String(result.fingerprint || '').trim();
            if (fingerprint) scheduleState.scheduleFingerprintByPersonId[person.id] = fingerprint;
            clearRemoteUpdatePending();
            if (person.id === scheduleState.activePersonId) startScheduleAutoRefresh();
            return true;
        } catch (error) {
            scheduleState.eventsByPersonId[person.id] = [];
            scheduleState.statusMetaByPersonId[person.id] = [];
            scheduleState.errorByPersonId[person.id] = error.message || 'Unable to load schedule.';
            scheduleState.loadedPersonIds.add(person.id);
            if (person.id === scheduleState.activePersonId) stopScheduleAutoRefresh();
            return false;
        } finally {
            scheduleState.loadingPersonId = '';
            if (!silent && typeof window.hideLoading === 'function') window.hideLoading({ force: true });
            refreshScheduleActiveView();
            if (scheduleState.remoteUpdatePending) void promptScheduleRemoteUpdateIfNeeded();
        }
    }

    async function reloadActiveScheduleForViewRange(options = {}) {
        const person = activeSchedulePerson();
        if (!person?.id) return false;
        scheduleState.loadedPersonIds.delete(person.id);
        return await loadSchedulePerson(person, { silent: options.silent !== false });
    }

    async function ensureScheduleViewRangeForBulkSelect({ startDate, endDate, mode } = {}) {
        const extraStart = normalizeBulkSelectIsoDate(startDate);
        const extraEnd = normalizeBulkSelectIsoDate(endDate);
        if (!extraStart && !extraEnd) return { changed: false, reloaded: false };
        const union = unionIsoDateRange(getScheduleRange(), extraStart, extraEnd);
        if (!union.changed || !union.startDate || !union.endDate) {
            return { changed: false, reloaded: false };
        }
        setDateRangeFromIso(union.startDate, union.endDate);
        setActiveRangeChip('');
        queueScheduleWorkspaceAutoPersist();
        if (String(mode || '').trim() === 'draft') {
            refreshScheduleViewWithHolidays();
            return { changed: true, reloaded: false };
        }
        const reloaded = await reloadActiveScheduleForViewRange({ silent: true });
        return { changed: true, reloaded: reloaded === true };
    }

    async function loadActiveSchedulePerson() {
        const person = activeSchedulePerson();
        if (!person) {
            await uiAlert('Please select a person first.', 'Load schedule', { icon: 'info' });
            return;
        }
        if (!(await confirmDiscardPendingDraftsIfNeeded('Reload the schedule'))) return;
        await loadSchedulePerson(person);
    }

    async function fetchSchedulePeopleForRole(role) {
        const normalizedRole = String(role || '').trim();
        if (!normalizedRole) return [];
        const items = [];
        let page = 1;
        let totalPages = 1;
        do {
            const params = new URLSearchParams({ page: String(page), pageSize: '100' });
            params.set('role', normalizedRole);
            const res = await fetch(`/school/schedules/api/school-person-picker?${params.toString()}`, {
                headers: { 'X-AJAX-Request': 'true', Accept: 'application/json' },
                credentials: 'same-origin'
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || result.status !== 'success') throw new Error(result.message || 'Unable to load people for the selected role.');
            const pageItems = Array.isArray(result.items)
                ? result.items
                : (Array.isArray(result.data) ? result.data : (Array.isArray(result.results) ? result.results : []));
            pageItems.forEach((item) => items.push(item));
            const pagination = result.pagination || {};
            totalPages = Number(pagination.totalPages || result.totalPages || totalPages || 1) || 1;
            page += 1;
        } while (page <= totalPages);
        return items;
    }

    async function loadAllSchedulePeople() {
        if (canSelectAnyPerson && selectedScheduleRole()) {
            const role = selectedScheduleRole();
            if (typeof window.showLoading === 'function') window.showLoading(`Loading ${role} people...`);
            try {
                const rolePeople = await fetchSchedulePeopleForRole(role);
                if (!rolePeople.length) {
                    await uiAlert(`No people were found for the selected ${role} role.`, 'Load people', { icon: 'info' });
                    return;
                }
                scheduleState.persons = [];
                scheduleState.activePersonId = '';
                clearLoadedSchedules();
                rolePeople.forEach((item) => addSchedulePerson(item, { selectedRole: role }));
                sortSchedulePersons();
                scheduleState.activePersonId = scheduleState.persons[0]?.id || '';
                renderSchedulePersonTabs();
                refreshScheduleActiveView();
            } catch (error) {
                await uiAlert(error.message || 'Unable to load people for the selected role.', 'Schedule', { icon: 'error' });
                return;
            } finally {
                if (typeof window.hideLoading === 'function') window.hideLoading({ force: true });
            }
        }
        if (!scheduleState.persons.length) { await uiAlert('Please select at least one person first.', 'Load schedules', { icon: 'info' }); return; }
        for (const person of scheduleState.persons) {
            // eslint-disable-next-line no-await-in-loop
            await loadSchedulePerson(person);
        }
    }

    function applyScheduleRange(range) {
        setActiveRangeChip(range);
        const today = new Date();
        let start = new Date(today);
        let end = new Date(today);
        if (range === 'week') {
            const day = today.getDay() || 7;
            if (day !== 1) start.setHours(-24 * (day - 1));
            end.setTime(start.getTime() + (6 * 24 * 60 * 60 * 1000));
        } else if (range === 'first15') {
            start = new Date(today.getFullYear(), today.getMonth(), 1);
            end = new Date(today.getFullYear(), today.getMonth(), 15);
        } else if (range === 'second15') {
            start = new Date(today.getFullYear(), today.getMonth(), 16);
            end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        } else if (range === 'month') {
            start = new Date(today.getFullYear(), today.getMonth(), 1);
            end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        } else if (range === 'season') {
            end.setMonth(start.getMonth() + 3);
        } else if (range === 'year') {
            start = new Date(today.getFullYear(), 0, 1);
            end = new Date(today.getFullYear(), 11, 31);
        }
        setDateRange(start, end);
        resetScheduleActiveClassFilter();
        clearLoadedSchedules();
        refreshScheduleViewWithHolidays();
    }

    // --- 1. Control Logic & Event Listeners ---
    document.querySelectorAll('.btn-range').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            applyScheduleRange(e.currentTarget.getAttribute('data-range') || 'week');
        });
    });

if (canSelectAnyPerson) {
    const btnPicker = document.getElementById('btn_openPersonPicker');
    if (btnPicker) {
        btnPicker.addEventListener('click', () => {
            const pickerRole = selectedScheduleRole();
            const pickerParams = new URLSearchParams();
            if (pickerRole) pickerParams.set('role', pickerRole);
            const pickerEndpoint = '/school/schedules/api/school-person-picker' + (pickerParams.toString() ? `?${pickerParams.toString()}` : '');
            GenericPicker.open(GenericPickerPresets.normalizeConfig({
                title: 'Select School People',
                icon: 'bi-person-badge',
                apiEndpoint: pickerEndpoint,
                placeholder: 'Search school people...',
                multiselect: true,
                selectedItems: scheduleState.persons.map((person) => ({
                    id: person.id,
                    personId: person.id,
                    displayName: person.name,
                    availableRoles: person.availableRoles
                })),
                context: GenericPickerContexts.activeOrganizationScope({ label: 'Active Organization' }),
                renderer: (item) => {
                    const displayName = escapeHtml(resolvePersonPickerName(item) || 'School Person');
                    const personId = escapeHtml(resolveSchedulePersonId(item));
                    const email = escapeHtml(item?.email || '');
                    const roleBadges = (Array.isArray(item?.availableRoles) ? item.availableRoles : [])
                        .map((role) => `<span class="badge bg-primary-subtle text-primary border">${escapeHtml(role?.label || role?.key || '')}</span>`)
                        .join(' ');
                    return `
                        <div class="d-flex justify-content-between align-items-center w-100 gap-3">
                            <div class="d-flex align-items-center gap-3">
                                <div class="rounded-circle bg-primary text-white d-flex align-items-center justify-content-center shadow-sm fw-bold" style="width:40px;height:40px;">
                                    ${displayName.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <div class="fw-bold text-dark">${displayName}</div>
                                    <div class="text-muted small">${email || 'School-linked person'}</div>
                                    <div class="mt-1 d-flex flex-wrap gap-1">${roleBadges || '<span class="badge bg-light text-muted border">School Role</span>'}</div>
                                </div>
                            </div>
                            <span class="badge bg-light text-secondary border font-monospace">${personId}</span>
                        </div>
                    `;
                },
                onSelect: (items) => {
                    (Array.isArray(items) ? items : [items]).forEach((item) => addSchedulePerson(item, { selectedRole: pickerRole }));
                    if (!scheduleState.activePersonId && scheduleState.persons.length) scheduleState.activePersonId = scheduleState.persons[0].id;
                    refreshScheduleActiveView();
                }
            }));
        });
    }

    document.getElementById('btn_clearPerson')?.addEventListener('click', () => {
        scheduleState.persons = [];
        scheduleState.activePersonId = '';
        clearLoadedSchedules();
        const roleEl = document.getElementById('sch_role');
        if (roleEl) {
            roleEl.value = 'teacher';
        }
        refreshScheduleActiveView();
    });

    document.getElementById('btn_resetScheduleFilters')?.addEventListener('click', () => {
        scheduleState.persons = [];
        scheduleState.activePersonId = '';
        const roleEl = document.getElementById('sch_role');
        if (roleEl) roleEl.value = 'teacher';
        clearLoadedSchedules();
        const hasCasesEl = document.getElementById('sch_hasCases');
        if (hasCasesEl) hasCasesEl.checked = false;
        scheduleState.viewMode = 'verticalTimeline';
        try {
            if (window.localStorage) window.localStorage.setItem(SCHEDULE_VIEW_MODE_STORAGE_KEY, 'verticalTimeline');
        } catch (error) { /* storage can be unavailable */ }
        applyDefaultWeekRange();
        refreshScheduleActiveView();
    });
}

    document.getElementById('btn_loadSchedule')?.addEventListener('click', loadActiveSchedulePerson);
if (canLoadAllSchedules) {
    document.getElementById('btn_loadAllSchedules')?.addEventListener('click', loadAllSchedulePeople);
}
    document.getElementById('btn_printSchedule')?.addEventListener('click', () => openSchedulePrint());

    document.getElementById('sch_role')?.addEventListener('change', () => {
        const person = activeSchedulePerson();
        if (canSelectAnyPerson) {
            scheduleState.persons = [];
            scheduleState.activePersonId = '';
            clearLoadedSchedules();
            refreshScheduleActiveView();
            return;
        }
        if (!person) return;
        person.selectedRole = selectedScheduleRole();
        delete scheduleState.eventsByPersonId[person.id];
        delete scheduleState.statusMetaByPersonId[person.id];
        delete scheduleState.errorByPersonId[person.id];
        delete scheduleState.lastLoadedAtByPersonId[person.id];
        delete scheduleState.scheduleFingerprintByPersonId[person.id];
        scheduleState.loadedPersonIds.delete(person.id);
        refreshScheduleActiveView();
    });

    document.getElementById('sch_hasCases')?.addEventListener('change', () => {
        clearLoadedSchedules();
        refreshScheduleActiveView();
    });
    document.getElementById('sch_startDate')?.addEventListener('change', () => {
        resetScheduleActiveClassFilter();
        clearLoadedSchedules();
        queueScheduleWorkspaceAutoPersist();
        refreshScheduleViewWithHolidays();
    });
    document.getElementById('sch_endDate')?.addEventListener('change', () => {
        resetScheduleActiveClassFilter();
        clearLoadedSchedules();
        queueScheduleWorkspaceAutoPersist();
        refreshScheduleViewWithHolidays();
    });

    document.getElementById('schedulePersonTabs')?.addEventListener('click', (event) => {
        const saveWorkspaceButton = event.target.closest('[data-schedule-save-workspace]');
        if (saveWorkspaceButton) {
            event.preventDefault();
            event.stopPropagation();
            void saveScheduleWorkspace();
            return;
        }
        const clearWorkspaceButton = event.target.closest('[data-schedule-clear-workspace]');
        if (clearWorkspaceButton) {
            event.preventDefault();
            event.stopPropagation();
            void clearScheduleWorkspace();
            return;
        }
        const closeButton = event.target.closest('[data-schedule-remove-person]');
        if (closeButton) {
            event.preventDefault();
            event.stopPropagation();
            removeSchedulePerson(closeButton.getAttribute('data-schedule-remove-person') || '');
            return;
        }
        const tab = event.target.closest('[data-schedule-person-tab]');
        if (!tab) return;
        const personId = tab.getAttribute('data-schedule-person-tab') || '';
        if (scheduleAdminUi?.handlePersonTabClick?.({
            event,
            tab,
            personId,
            isActive: personId === scheduleState.activePersonId
        })) {
            return;
        }
        const previousActivePersonId = scheduleState.activePersonId;
        scheduleState.activePersonId = personId || scheduleState.activePersonId;
        if (previousActivePersonId !== scheduleState.activePersonId) {
            queueScheduleWorkspaceAutoPersist();
            notifyActiveSchedulePersonChanged();
        }
        resetScheduleActiveClassFilter();
        syncScheduleActiveClassesForActivePerson();
        refreshScheduleActiveView();
    });

    bindScheduleDaySizePopoverDismiss();
    bindScheduleTimeRangePopoverDismiss();
    bindScheduleStagedPaddingPopoverDismiss();
    bindScheduleActiveClassPopoverDismiss();

    document.getElementById('legendContainer')?.addEventListener('input', (event) => {
        const timeStart = event.target.closest('#scheduleTimelineStartInput');
        const timeEnd = event.target.closest('#scheduleTimelineEndInput');
        if (timeStart || timeEnd) {
            syncScheduleTimeRangePopoverPreview();
            return;
        }
        const slider = event.target.closest('#scheduleDayWidth');
        if (slider) {
            applyScheduleDayWidth(slider.value, { userInitiated: true });
            const mode = normalizedScheduleViewMode();
            if (mode === 'verticalTimeline' || mode === 'timeline') applyScheduleWeekGridLayout(mode);
        }
    });
    document.getElementById('legendContainer')?.addEventListener('change', (event) => {
        const slider = event.target.closest('#scheduleDayWidth');
        if (slider) {
            saveScheduleDayWidth(slider.value);
            if (normalizedScheduleViewMode() === 'timeline') {
                const container = document.getElementById('visualDisplayArea');
                if (!applyHorizontalTimelineTrackLayout(container, readScheduleTrackStepFromSlider(slider.value, 'timeline'))) {
                    refreshScheduleActiveView();
                }
            }
        }
    });
    document.getElementById('legendContainer')?.addEventListener('click', (event) => {
        const activeClassToggle = event.target.closest('[data-schedule-active-class-toggle]');
        if (activeClassToggle) {
            event.preventDefault();
            event.stopPropagation();
            toggleScheduleActiveClassPopover();
            return;
        }
        const activeClassOption = event.target.closest('[data-schedule-active-class]');
        if (activeClassOption && activeClassOption.closest('.schedule-active-class-popover-host')) {
            event.preventDefault();
            event.stopPropagation();
            setScheduleActiveClassFilter(activeClassOption.getAttribute('data-schedule-active-class') || '');
            return;
        }
        const timeRangeToggle = event.target.closest('[data-schedule-time-range-toggle]');
        if (timeRangeToggle) {
            event.preventDefault();
            event.stopPropagation();
            toggleScheduleTimeRangePopover();
            return;
        }
        const timeRangeApply = event.target.closest('[data-schedule-time-range-apply]');
        if (timeRangeApply) {
            event.preventDefault();
            applyScheduleTimeRangeFromPopover();
            return;
        }
        const timeRangeReset = event.target.closest('[data-schedule-time-range-reset]');
        if (timeRangeReset) {
            event.preventDefault();
            resetScheduleTimeRangeToDefault();
            return;
        }
        const stagedPaddingToggle = event.target.closest('[data-schedule-staged-padding-toggle]');
        if (stagedPaddingToggle) {
            event.preventDefault();
            event.stopPropagation();
            toggleScheduleStagedPaddingPopover();
            return;
        }
        const stagedPaddingApply = event.target.closest('[data-schedule-staged-padding-apply]');
        if (stagedPaddingApply) {
            event.preventDefault();
            void applyScheduleStagedPaddingFromPopover();
            return;
        }
        const stagedPaddingReset = event.target.closest('[data-schedule-staged-padding-reset]');
        if (stagedPaddingReset) {
            event.preventDefault();
            void resetScheduleStagedPaddingToDefault();
            return;
        }
        const daySizeToggle = event.target.closest('[data-schedule-day-size-toggle]');
        if (daySizeToggle) {
            event.preventDefault();
            event.stopPropagation();
            toggleScheduleDaySizePopover();
            return;
        }
        const hideEmptyButton = event.target.closest('[data-schedule-hide-empty-days]');
        if (hideEmptyButton) {
            scheduleState.hideEmptyDays = !scheduleState.hideEmptyDays;
            saveScheduleHideEmptyDays(scheduleState.hideEmptyDays);
            resetScheduleWeekGridUserSizing();
            refreshScheduleActiveView();
            return;
        }
        const legendButton = event.target.closest('[data-schedule-open-legend]');
        if (legendButton) {
            const modalEl = document.getElementById('scheduleLegendModal');
            if (modalEl && window.bootstrap) window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
            return;
        }
        const clearAllSelectedButton = event.target.closest('[data-schedule-clear-all-selected]');
        if (clearAllSelectedButton && !clearAllSelectedButton.disabled) {
            clearAllScheduleSelections();
            return;
        }
        const saveDraftsButton = event.target.closest('[data-schedule-save-drafts]');
        if (saveDraftsButton) {
            event.preventDefault();
            void commitScheduleDraftSessions();
            return;
        }
        const refreshLoadedButton = event.target.closest('[data-schedule-refresh-loaded]');
        const autoDetectToggle = event.target.closest('[data-schedule-auto-detect-toggle]');
        if (autoDetectToggle) {
            event.preventDefault();
            event.stopPropagation();
            const nextEnabled = !isScheduleAutoChangeDetectorEnabled();
            saveScheduleAutoChangeDetector(nextEnabled);
            if (nextEnabled) {
                startScheduleAutoRefresh();
            } else {
                clearRemoteUpdatePending();
            }
            refreshScheduleActiveView();
            return;
        }
        if (refreshLoadedButton) {
            requestScheduleRefresh();
            return;
        }
        const verticalButton = event.target.closest('[data-schedule-view-vertical]');
        const dayButton = event.target.closest('[data-schedule-view-timeline]');
        const monthButton = event.target.closest('[data-schedule-view-month]');
        if (!verticalButton && !dayButton && !monthButton) return;
        saveScheduleViewMode(verticalButton ? 'verticalTimeline' : (dayButton ? 'timeline' : 'calendar'));
        refreshScheduleActiveView();
    });

    function renderSingleDayListView(eventsByDate, container) {
        const scd = window.ScheduleCompletionDisplay;
        container.innerHTML = '';
        const dates = Object.keys(eventsByDate || {}).sort();
        if (!dates.length) {
            container.innerHTML = `<div class="alert alert-light text-center border py-4 text-muted">No schedule items found for this day.</div>`;
            return;
        }

        let html = '<div class="single-day-list">';
        dates.forEach((dateStr) => {
            const dayEvents = (eventsByDate[dateStr] || []).slice().sort((a, b) => {
                const aStart = timeToMinutes(a?.start);
                const bStart = timeToMinutes(b?.start);
                if (aStart !== bStart) return aStart - bStart;
                return String(a?.className || '').localeCompare(String(b?.className || ''));
            });
            const hasConflict = dayEvents.some((ev) => ev?.hasOverlap);
            const daySummary = scd ? scd.summarizeDayCompletion(dayEvents, sessionStatusMetaMap) : null;
            const completionChip = scd && daySummary ? scd.buildDayCompletionChip(daySummary) : '';

            html += `
                <div class="day-card">
                    <div class="day-card-header ${hasConflict ? 'conflict' : ''}">
                        ${formatScheduleDayCardDateHtml(dateStr)}
                        <span class="d-flex align-items-center gap-2 flex-wrap justify-content-end">
                            ${completionChip}
                            <span class="badge ${hasConflict ? 'bg-danger' : 'bg-primary'}">${dayEvents.length} item${dayEvents.length === 1 ? '' : 's'}</span>
                        </span>
                    </div>
            `;

            dayEvents.forEach((ev) => {
                const leaveEvent = isLeaveEvent(ev);
                const eventTitle = getEventTitle(ev);
                const scan = scd ? scd.resolveScheduleCompletionScan(ev, sessionStatusMetaMap) : null;
                const rowClasses = scd
                    ? scd.buildScheduleRowClasses(scan, `event-row ${ev?.hasOverlap ? 'overlap' : ''}`)
                    : `event-row ${ev?.hasOverlap ? 'overlap' : ''} ${leaveEvent ? 'leave-event' : ''}`;
                const selectedClass = buildScheduleSessionSelectedClass(ev);
                const unselectableClass = buildScheduleSessionUnselectableClass(ev);
                const mutedClass = buildScheduleClassFilterMutedClass(ev);
                const selectionControl = buildScheduleSelectionControlHtml(ev);
                const scanIcon = scd ? scd.buildScheduleScanIcon(scan) : '';
                const statusBadge = scd
                    ? scd.buildScheduleStatusBadge(scan, formatStatusLabel(ev?.status), getStatusTagStyle(ev?.status))
                    : `<span class="session-status-tag" style="${getStatusTagStyle(ev?.status)}">${escapeHtml(formatStatusLabel(ev?.status))}</span>`;
                const makeupBadge = scd ? scd.buildMakeupRequiredBadge(ev) : '';
                const detailsUrl = String(ev?.detailsUrl || '').trim();
                const caseBadge = buildSessionCaseBadgeHtml(ev?.caseSummary);
                const coTeacherBadges = buildScheduleCoTeacherBadgesHtml(ev, { inline: true });
                const openButton = detailsUrl
                    ? `<a class="btn btn-sm btn-outline-primary event-open" href="${escapeHtml(detailsUrl)}" target="_blank" rel="noopener">Open</a>`
                    : `<span class="text-muted small">No details</span>`;
                html += `
                    <div class="${rowClasses}${selectedClass}${unselectableClass}${mutedClass}" ${buildScheduleSessionContextDataAttrs(ev)}${scan?.rowStyle ? ` style="${scan.rowStyle}"` : ''}>
                        <div class="schedule-scan-cell">${selectionControl}${scanIcon}</div>
                        <div class="event-time">${escapeHtml(formatScheduleClockRange(ev?.start, ev?.end))}</div>
                        <div>
                            <div class="event-main-title">${buildReportPriorityMarker(ev)}${escapeHtml(eventTitle)}</div>
                            <div class="event-meta-line">
                                <span class="badge ${leaveEvent ? 'bg-warning-subtle text-warning-emphasis border border-warning-subtle' : (String(ev?.role || '').toLowerCase() === 'student' ? 'bg-primary-subtle text-primary border' : 'bg-info-subtle text-info-emphasis border')}">${escapeHtml(leaveEvent ? 'Approved Leave' : (ev?.role || '-'))}</span>
                                ${statusBadge}
                                ${makeupBadge}
                                ${coTeacherBadges}
                                ${caseBadge}
                                <span class="text-muted">${Number(ev?.duration || 0).toFixed(2)} h</span>
                            </div>
                            <div class="event-meta-line">${leaveEvent ? '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">Leave request approved and reserved on schedule</span>' : buildLifecycleInline(ev)}</div>
                        </div>
                        <div class="event-actions">${openButton}</div>
                    </div>
                `;
            });

            html += '</div>';
        });
        html += '</div>';
        container.innerHTML = html;
    }

    function buildScheduleWeekGridRenderOptions(mode) {
        const container = document.getElementById('visualDisplayArea');
        const layout = computeScheduleWeekGridLayout(mode, container, {
            weekCountOverride: estimateScheduleWeekCountForRange(),
            dayCountOverride: 7
        });
        return {
            ...buildScheduleWeekGridOptions(),
            timelineStartHour: getScheduleTimelinePresetBounds().startHour,
            timelineEndHour: getScheduleTimelinePresetBounds().endHour,
            resolveWeekTimelineBounds: (weekStart, weekEnd, weekDays, eventsByDate) => (
                resolveScheduleWeekTimelineBounds(weekStart, weekDays, eventsByDate)
            ),
            buildWeekLabelExtraHtml: (weekStart, weekEnd, weekDays, eventsByDate, effectiveBounds) => (
                buildScheduleWeekTimelineActionHtml(weekStart, weekDays, eventsByDate, effectiveBounds)
            ),
            dayWidth: layout.dayWidth,
            hourHeight: layout.hourHeight,
            timelineTrackStep: layout.trackStep,
            holidayDates: getScheduleHolidayDatesForRender()
        };
    }

    function buildScheduleWeekGridOptions() {
        const range = getScheduleRange();
        return {
            viewRange: {
                startDate: range.startDate,
                endDate: range.endDate,
                preset: 'custom',
                anchorDate: range.startDate
            },
            dayWidth: readScheduleVerticalDayWidth(),
            filterEmptyDays: scheduleState.hideEmptyDays === true && !activePersonHasDraftStagedSessions(),
            enableTimeHover: canDragCreateSessions === true,
            buildPositionedBlockHtml: buildSchedulePositionedBlockHtml,
            buildDayHeaderBadgeHtml: (day, dayEvents, inRange) => {
                if (!inRange) return '';
                const hasConflict = (dayEvents || []).some((ev) => ev && ev.hasOverlap === true);
                if (hasConflict) {
                    return '<i class="bi bi-exclamation-triangle-fill text-danger" aria-label="Conflict"></i>';
                }
                const count = (dayEvents || []).length;
                return count ? `<span class="badge bg-primary">${escapeHtml(String(count))}</span>` : '';
            },
            buildDayExtraClasses: (day, dayEvents, inRange, mode) => {
                if (!inRange) return '';
                const hasConflict = (dayEvents || []).some((ev) => ev && ev.hasOverlap === true);
                if (!hasConflict) return '';
                if (mode === 'vertical-header') return 'conflict';
                return 'border-danger';
            }
        };
    }

    function buildScheduleVerticalBlockInner(ev) {
        const scd = window.ScheduleCompletionDisplay;
                const eventTitle = getEventTitle(ev);
                const cssClass = scheduleEventRoleClass(ev);
                const scan = scd ? scd.resolveScheduleCompletionScan(ev, sessionStatusMetaMap) : null;
                const embeddedReportsClass = buildScheduleEmbeddedReportsClass(ev);
                const blockClasses = scd
            ? scd.buildScheduleBlockClasses(scan, `vertical-event-block ${cssClass} ${ev.hasOverlap ? 'border-danger border-2' : ''}${ev.isDraft ? ' is-schedule-draft' : ''}${embeddedReportsClass}`)
            : `vertical-event-block ${cssClass} ${ev.hasOverlap ? 'border-danger border-2' : ''}${ev.isDraft ? ' is-schedule-draft' : ''}${embeddedReportsClass}`;
                const statusChip = scheduleStatusChip(ev, sessionStatusMetaMap, scan);
                const selectedClass = buildScheduleSessionSelectedClass(ev);
                const unselectableClass = buildScheduleSessionUnselectableClass(ev);
                const mutedClass = buildScheduleClassFilterMutedClass(ev);
                const selectionControl = buildScheduleSelectionControlHtml(ev);
                const makeupBadge = scd ? scd.buildMakeupRequiredBadge(ev, { compact: true }) : '';
                const detailsUrl = getEventDetailsUrl(ev);
                const caseBadge = buildSessionCaseBadgeHtml(ev?.caseSummary);
                const embeddedReportBadges = buildEmbeddedReportBadgesHtml(ev?.embeddedReports);
                const coTeacherBadges = buildScheduleCoTeacherBadgesHtml(ev);
        const clickHandler = buildScheduleSessionBlockClickHandler(ev);
                const tipLabel = buildScheduleEventTooltip(ev, sessionStatusMetaMap, scan);
                const tipStyle = scheduleStatusTipStyle(ev, sessionStatusMetaMap);
                const soloStudentHtml = scheduleSoloStudentHtml(ev);
        const resizeHandles = canDragCreateSessions && isScheduleEventMutableUnderClassFocus(ev) && (ev.isDraft || canScheduleSessionChangeTime(ev))
            ? buildScheduleDraftResizeHandlesHtml()
            : '';
        return `
                        <div class="${blockClasses}${selectedClass}${unselectableClass}${mutedClass}" 
                 style="${mergeScheduleBlockLayoutStyle('position:absolute;inset:2px;', scan)}"
                             ${buildScheduleSessionContextDataAttrs(ev)}
                             data-tip="${escapeHtml(tipLabel)}"
                             data-tip-bg="${escapeHtml(tipStyle.bg)}"
                             data-tip-fg="${escapeHtml(tipStyle.fg)}"
                             data-tip-border="${escapeHtml(tipStyle.border)}"
                             aria-label="${escapeHtml(tipLabel)}"
                             tabindex="0"
                             ${clickHandler}>
                             ${selectionControl}
                             ${statusChip}
                             ${coTeacherBadges}
                             ${buildScheduleDraftBadge(ev)}
                             ${buildScheduleDraftEnrollmentBadge(ev)}
                             <div class="schedule-event-title">${isReportScheduleEvent(ev) ? `${buildReportPriorityMarker(ev)} ` : ''}${escapeHtml(eventTitle)}</div>
                             ${embeddedReportBadges}
                             ${caseBadge ? `<div class="mt-1">${caseBadge}</div>` : ''}
                             <div class="event-meta x-small">
                    <span class="schedule-event-time text-truncate"><i class="bi bi-clock" aria-hidden="true"></i>${escapeHtml(formatScheduleClockRange(ev.start, ev.end))}</span>
                                ${makeupBadge}
                             </div>
                             ${soloStudentHtml}
                             ${resizeHandles}
                    </div>
                `;
    }

    function buildScheduleHorizontalBlockInner(ev) {
        const scd = window.ScheduleCompletionDisplay;
                const eventTitle = getEventTitle(ev);
                const cssClass = scheduleEventRoleClass(ev);
                const scan = scd ? scd.resolveScheduleCompletionScan(ev, sessionStatusMetaMap) : null;
                const embeddedReportsClass = buildScheduleEmbeddedReportsClass(ev);
                const blockClasses = scd
            ? scd.buildScheduleBlockClasses(scan, `event-block ${cssClass} ${ev.hasOverlap ? 'border-danger border-2' : ''}${ev.isDraft ? ' is-schedule-draft' : ''}${embeddedReportsClass}`)
            : `event-block ${cssClass} ${ev.hasOverlap ? 'border-danger border-2' : ''}${ev.isDraft ? ' is-schedule-draft' : ''}${embeddedReportsClass}`;
                const statusChip = scheduleStatusChip(ev, sessionStatusMetaMap, scan);
                const selectedClass = buildScheduleSessionSelectedClass(ev);
                const unselectableClass = buildScheduleSessionUnselectableClass(ev);
                const mutedClass = buildScheduleClassFilterMutedClass(ev);
                const selectionControl = buildScheduleSelectionControlHtml(ev);
                const makeupBadge = scd ? scd.buildMakeupRequiredBadge(ev, { compact: true }) : '';
                const caseBadge = buildSessionCaseBadgeHtml(ev?.caseSummary);
                const embeddedReportBadges = buildEmbeddedReportBadgesHtml(ev?.embeddedReports);
                const coTeacherBadges = buildScheduleCoTeacherBadgesHtml(ev);
                const clickHandler = buildScheduleSessionBlockClickHandler(ev);
                const tipLabel = buildScheduleEventTooltip(ev, sessionStatusMetaMap, scan);
                const tipStyle = scheduleStatusTipStyle(ev, sessionStatusMetaMap);
                const soloStudentHtml = scheduleSoloStudentHtml(ev);
        return `
                    <div class="${blockClasses}${selectedClass}${unselectableClass}${mutedClass}"
                 style="${mergeScheduleBlockLayoutStyle('position:absolute;inset:2px 2px 2px 2px;', scan)}"
                         ${buildScheduleSessionContextDataAttrs(ev)}
                         data-tip="${escapeHtml(tipLabel)}"
                         data-tip-bg="${escapeHtml(tipStyle.bg)}"
                         data-tip-fg="${escapeHtml(tipStyle.fg)}"
                         data-tip-border="${escapeHtml(tipStyle.border)}"
                         aria-label="${escapeHtml(tipLabel)}"
                         tabindex="0"
                         ${clickHandler}>
                         ${selectionControl}
                         ${statusChip}
                         ${coTeacherBadges}
                         ${buildScheduleDraftBadge(ev)}
                         ${buildScheduleDraftEnrollmentBadge(ev)}
                         <div class="schedule-event-title">${isReportScheduleEvent(ev) ? `${buildReportPriorityMarker(ev)} ` : ''}${escapeHtml(eventTitle)}</div>
                         ${embeddedReportBadges}
                         ${caseBadge ? `<div class="mt-1">${caseBadge}</div>` : ''}
                         <div class="event-meta x-small">
                    <span class="schedule-event-time text-truncate"><i class="bi bi-clock" aria-hidden="true"></i>${escapeHtml(formatScheduleClockRange(ev.start, ev.end))}</span>
                            ${makeupBadge}
                         </div>
                         ${soloStudentHtml}
                    </div>
                `;
    }

    function buildSchedulePositionedBlockHtml(ev, layout = {}) {
        const mode = String(layout?.mode || '').trim();
        if (mode === 'timeline') return buildScheduleHorizontalBlockInner(ev);
        return buildScheduleVerticalBlockInner(ev);
    }

    function renderTimelineView(eventsByDate, container) {
        if (!scheduleCalendarCore?.renderHorizontalWeekGrid) {
            container.innerHTML = `<div class="alert alert-warning">Calendar layout is unavailable.</div>`;
            return false;
        }
        applyScheduleWeekGridHostSize(container, estimateScheduleWeekCountForRange());
        const preparedEventsByDate = prepareEventsByDateForTimelineGrid(eventsByDate);
        return scheduleCalendarCore.renderHorizontalWeekGrid(preparedEventsByDate, container, null, buildScheduleWeekGridRenderOptions('timeline'));
    }

    function renderVerticalTimelineView(eventsByDate, container) {
        if (!scheduleCalendarCore?.renderVerticalWeekGrid) {
            container.innerHTML = `<div class="alert alert-warning">Calendar layout is unavailable.</div>`;
            return false;
        }
        applyScheduleWeekGridHostSize(container, estimateScheduleWeekCountForRange());
        const preparedEventsByDate = prepareEventsByDateForTimelineGrid(eventsByDate);
        return scheduleCalendarCore.renderVerticalWeekGrid(preparedEventsByDate, container, null, buildScheduleWeekGridRenderOptions('verticalTimeline'));
    }

    function formatScheduleCompactClock(timeStr) {
        const raw = String(timeStr || '').trim();
        const match = raw.match(/^(\d{1,2}):(\d{2})$/);
        if (!match) return raw || '-';
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (!Number.isFinite(hour) || !Number.isFinite(minute)) return raw;
        const period = hour >= 12 ? 'p' : 'a';
        const h12 = hour % 12 === 0 ? 12 : hour % 12;
        if (minute === 0) return `${h12}${period}`;
        return `${h12}:${String(minute).padStart(2, '0')}${period}`;
    }

    function sortScheduleDayEvents(events) {
        return (Array.isArray(events) ? events : []).slice().sort((a, b) => {
            const startA = String(a?.start || '');
            const startB = String(b?.start || '');
            if (startA !== startB) return startA.localeCompare(startB);
            return getEventTitle(a).localeCompare(getEventTitle(b));
        });
    }

    function buildCalendarSessionChipHtml(event, scd, statusMap) {
        const scan = scd?.resolveScheduleCompletionScan
            ? scd.resolveScheduleCompletionScan(event, statusMap)
            : null;
        const stateClass = event?.hasOverlap
            ? 'is-conflict'
            : (isLeaveEvent(event)
                ? 'is-leave'
                : (scan?.isComplete ? 'is-complete' : 'is-pending'));
        const timeLabel = formatScheduleCompactClock(event?.start);
        const makeupMark = scd?.isMakeupRequiredDisplayEvent && scd.isMakeupRequiredDisplayEvent(event)
            ? '<span class="cal-session-makeup">M</span>'
            : '';
        const tooltip = buildScheduleEventTooltip(event, statusMap, scan);
        const contextAttrs = buildScheduleSessionContextDataAttrs(event);
        const mutedClass = buildScheduleClassFilterMutedClass(event);
        return `<div class="cal-session-chip ${stateClass}${mutedClass}" ${contextAttrs} title="${escapeHtml(tooltip)}"><span class="cal-session-time">${escapeHtml(timeLabel)}${makeupMark}</span></div>`;
    }

    function buildCalendarDaySessionsHtml(dayEvents, scd, statusMap, maxVisible = 4) {
        const sorted = sortScheduleDayEvents(dayEvents);
        if (!sorted.length) return '';
        const visible = sorted.slice(0, maxVisible);
        const overflow = sorted.length - visible.length;
        const chips = visible.map((event) => buildCalendarSessionChipHtml(event, scd, statusMap)).join('');
        const more = overflow > 0 ? `<div class="cal-session-more">+${overflow}</div>` : '';
        return `<div class="cal-day-sessions">${chips}${more}</div>`;
    }

    function renderCalendarView(eventsByDate, startStr, endStr, container) {
        const scd = window.ScheduleCompletionDisplay;
        let current = new Date(startStr + 'T00:00:00');
        current.setDate(1); 
        
        const end = new Date(endStr + 'T00:00:00');
        end.setMonth(end.getMonth() + 1);
        end.setDate(0); 

        let html = '<div class="schedule-month-stack">';
        while (current <= end) {
            const year = current.getFullYear();
            const month = current.getMonth();
            const monthName = current.toLocaleString('default', { month: 'long', year: 'numeric' });
            const firstDayIndex = new Date(year, month, 1).getDay(); 
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            html += `
                <div class="schedule-month-card">
                    <div class="card shadow-sm border-0 h-100">
                        <div class="card-header text-white text-center fw-bold py-2">${escapeHtml(monthName)}</div>
                        <div class="card-body p-2 p-md-3">
                            <div class="cal-grid">
            `;
            ['S','M','T','W','T','F','S'].forEach(d => html += `<div class="text-center x-small fw-bold text-muted mb-1">${d}</div>`);
            for(let i=0; i<firstDayIndex; i++) html += `<div class="cal-day empty"></div>`;
            
            for(let d=1; d<=daysInMonth; d++) {
                const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                const dayEvents = eventsByDate[dateStr] || [];
                const hasConflict = dayEvents.some(e => e.hasOverlap);
                const hasLeave = dayEvents.some(e => isLeaveEvent(e));
                const count = dayEvents.length;
                const reportMarker = dayEvents.some(isReportScheduleEvent) ? buildReportPriorityMarker(dayEvents.find(isReportScheduleEvent)) : '';
                let classes = 'cal-day ';
                
                if (hasConflict) {
                    classes += 'conflict';
                } else if (hasLeave) {
                    classes += 'leave';
                } else if (count > 0) {
                    classes += 'active';
                } else {
                    classes += 'empty';
                }
                if (isScheduleHolidayDate(dateStr)) {
                    classes += ' holiday';
                }

                const sessionsHtml = count > 0
                    ? buildCalendarDaySessionsHtml(dayEvents, scd, sessionStatusMetaMap)
                    : '';

                html += `<div class="${classes}" data-date="${dateStr}" title="${count} session${count === 1 ? '' : 's'} scheduled">
                            <div class="cal-day-head">
                                ${reportMarker}<span class="cal-day-number">${d}</span>
                            </div>
                            ${sessionsHtml}
                         </div>`;
            }

            html += `</div></div></div></div>`;
            current.setMonth(current.getMonth() + 1);
        }
        
        html += '</div>';
        container.innerHTML = html;
    }

    document.getElementById('visualDisplayArea').addEventListener('click', (e) => {
        const expandWeekTime = e.target.closest('[data-schedule-week-expand-time]');
        if (expandWeekTime) {
            e.preventDefault();
            e.stopPropagation();
            const weekStart = expandWeekTime.getAttribute('data-week-start') || '';
            if (weekStart) expandScheduleWeekTimelineOverride(weekStart);
            return;
        }
        const resetWeekTime = e.target.closest('[data-schedule-week-reset-time]');
        if (resetWeekTime) {
            e.preventDefault();
            e.stopPropagation();
            const weekStart = resetWeekTime.getAttribute('data-week-start') || '';
            if (weekStart) resetScheduleWeekTimelineOverride(weekStart);
            return;
        }
        if (scheduleState.suppressGridClick) {
            scheduleState.suppressGridClick = false;
            return;
        }
        if (e.target.closest('.event-block, .vertical-event-block')) return; 

        const dayEl = e.target.closest('.cal-day.active, .cal-day.conflict, .cal-day.leave');
        if (dayEl) {
            const dateStr = dayEl.getAttribute('data-date');
            if (dateStr) {
                document.getElementById('sch_startDate').value = dateStr;
                document.getElementById('sch_endDate').value = dateStr;
                clearLoadedSchedules();
                scheduleState.viewMode = 'verticalTimeline';
                loadActiveSchedulePerson();
            }
        }
    });

    const scheduleTipEl = document.createElement('div');
    scheduleTipEl.className = 'sch-event-tip';
    scheduleTipEl.setAttribute('role', 'tooltip');
    scheduleTipEl.hidden = true;
    document.body.appendChild(scheduleTipEl);

    const hideScheduleTip = () => {
        scheduleTipEl.classList.remove('is-visible', 'is-below');
        scheduleTipEl.hidden = true;
    };
    const showScheduleTip = (target) => {
        if (document.body.classList.contains('is-schedule-draft-moving')) {
            hideScheduleTip();
            return;
        }
        const label = String(target?.getAttribute('data-tip') || '').trim();
        if (!label) {
            hideScheduleTip();
            return;
        }
        const tipBg = target.getAttribute('data-tip-bg') || '#0f172a';
        const tipFg = target.getAttribute('data-tip-fg') || '#ffffff';
        const tipBorder = target.getAttribute('data-tip-border') || tipBg;
        const parts = (label.includes('\n') ? label.split('\n') : label.split(' | '))
            .map((part) => String(part || '').trim())
            .filter(Boolean);
        scheduleTipEl.innerHTML = parts.map((part, index) => {
            const isDate = /^Date:/i.test(part);
            return `<span class="sch-tip-line${index > 0 ? ' sch-tip-sub' : ''}${isDate ? ' sch-tip-date' : ''}">${escapeHtml(part)}</span>`;
        }).join('');
        scheduleTipEl.style.background = tipBg;
        scheduleTipEl.style.color = tipFg;
        scheduleTipEl.style.borderColor = tipBorder;
        scheduleTipEl.style.setProperty('--sch-tip-arrow', tipBg);
        scheduleTipEl.hidden = false;
        scheduleTipEl.classList.remove('is-below');
        const rect = target.getBoundingClientRect();
        let left = rect.left + (rect.width / 2);
        const tipWidth = scheduleTipEl.offsetWidth || 160;
        const tipHeight = scheduleTipEl.offsetHeight || 80;
        const pad = 10;
        left = Math.max(pad + tipWidth / 2, Math.min(left, window.innerWidth - pad - tipWidth / 2));
        scheduleTipEl.style.left = `${left}px`;
        if ((rect.top - tipHeight - 14) < pad) {
            scheduleTipEl.classList.add('is-below');
            scheduleTipEl.style.top = `${Math.min(window.innerHeight - pad - tipHeight, rect.bottom)}px`;
        } else {
            scheduleTipEl.style.top = `${Math.max(8, rect.top)}px`;
        }
        scheduleTipEl.classList.add('is-visible');
    };

    const visualArea = document.getElementById('visualDisplayArea');
    visualArea.addEventListener('click', (event) => {
        const draftInput = event.target.closest('[data-schedule-draft-select]');
        const draftLabel = event.target.closest('.schedule-draft-select');
        if (draftInput || draftLabel) {
            if (!canDragCreateSessions) return;
            event.preventDefault();
            event.stopPropagation();
            const checkbox = draftInput || draftLabel?.querySelector('[data-schedule-draft-select]');
            const sessionId = String(checkbox?.getAttribute('data-draft-session-id') || '').trim();
            if (!sessionId) return;
            toggleDraftSessionSelection(sessionId);
            return;
        }
        if (!canSelectAnyPerson) {
            const savedEvent = resolveScheduleContextEventFromTarget(event.target)
                || resolveWorkSessionEventFromTarget(event.target);
            if (!savedEvent) return;
            const manageUrl = buildSessionManagerUrlForEvent(savedEvent);
            if (!manageUrl) return;
            event.preventDefault();
            event.stopPropagation();
            window.open(manageUrl, '_blank', 'noopener');
            return;
        }
        const input = event.target.closest('[data-schedule-session-select]');
        const label = event.target.closest('.schedule-session-select:not(.schedule-draft-select)');
        const card = event.target.closest('[data-schedule-session-key]');
        const selectedClassId = activeScheduleSelectedClassId();
        if (!input && !label && !card) return;
        if (countActiveDraftSelectedSessions() > 0) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof uiAlert === 'function') {
                uiAlert('Clear staged session selections before selecting saved sessions.', 'Saved session selection', { icon: 'info' });
            }
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const checkbox = input || label?.querySelector('[data-schedule-session-select]') || card?.querySelector('[data-schedule-session-select]');
        const key = String((checkbox?.getAttribute('data-session-key') || card?.getAttribute('data-schedule-session-key') || '')).trim();
        const classId = String(checkbox?.getAttribute('data-session-class-id') || scheduleSessionClassIdFromKey(key)).trim();
        const selectionSet = getActiveScheduleSelectionSet();
        if (!key || checkbox?.disabled) return;
        if (!selectionSet.has(key) && selectedClassId && selectedClassId !== classId) return;
        const nextChecked = !selectionSet.has(key);
        if (nextChecked) selectionSet.add(key);
        else selectionSet.delete(key);
        refreshScheduleActiveView();
    }, true);
    visualArea.addEventListener('pointerover', (event) => {
        const target = event.target.closest('.event-block[data-tip], .vertical-event-block[data-tip]');
        if (!target || !visualArea.contains(target)) return;
        showScheduleTip(target);
    });
    visualArea.addEventListener('pointerout', (event) => {
        const target = event.target.closest('.event-block[data-tip], .vertical-event-block[data-tip]');
        if (!target) return;
        const next = event.relatedTarget;
        if (next && target.contains(next)) return;
        hideScheduleTip();
    });
    visualArea.addEventListener('focusin', (event) => {
        const target = event.target.closest('.event-block[data-tip], .vertical-event-block[data-tip]');
        if (target) showScheduleTip(target);
    });
    visualArea.addEventListener('focusout', (event) => {
        const target = event.target.closest('.event-block[data-tip], .vertical-event-block[data-tip]');
        if (!target) return;
        const next = event.relatedTarget;
        if (next && target.contains(next)) return;
        hideScheduleTip();
    });
    bindScheduleSessionContextMenu();
    bindScheduleDraftSessionContextMenu();
    window.addEventListener('scroll', hideScheduleTip, true);
    window.addEventListener('resize', hideScheduleTip);
    bindScheduleGridResizeObserver();

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            stopScheduleAutoRefresh();
            return;
        }
        markScheduleDataStaleAfterReturn();
        if (scheduleState.loadedPersonIds.has(scheduleState.activePersonId || '')) {
            startScheduleAutoRefresh();
            pollScheduleVersionForActivePerson();
            if (scheduleState.remoteUpdatePending && !scheduleState.remoteUpdateModalDismissed) {
                void promptScheduleRemoteUpdateIfNeeded();
            }
        }
    });
    window.addEventListener('pageshow', (event) => {
        if (!event.persisted) return;
        markScheduleDataStaleAfterReturn();
        if (scheduleState.loadedPersonIds.has(scheduleState.activePersonId || '')) {
            startScheduleAutoRefresh();
            pollScheduleVersionForActivePerson();
            if (scheduleState.remoteUpdatePending && !scheduleState.remoteUpdateModalDismissed) {
                void promptScheduleRemoteUpdateIfNeeded();
            }
        }
    });
    window.addEventListener('beforeunload', stopScheduleAutoRefresh);

    // --- 3. Deep Link / Saved Workspace Auto-Loader ---
    async function initializeScheduleViewer() {
        migrateScheduleAutoChangeDetectorFromLocalStorage();
        if (typeof restoreScheduleDraftBackup === 'function') restoreScheduleDraftBackup();

        const urlParams = new URLSearchParams(window.location.search);
        const prefillId = canSelectAnyPerson ? urlParams.get('personId') : document.getElementById('sch_personId').value;
        const prefillName = canSelectAnyPerson ? urlParams.get('personName') : document.getElementById('sch_personName').value;
        const prefillDate = urlParams.get('date');
        const prefillStartDate = urlParams.get('startDate');
        const prefillEndDate = urlParams.get('endDate');
        const prefillRole = urlParams.get('role');
        const initialRoleEl = document.getElementById('sch_role');
        if (canSelectAnyPerson && prefillRole && initialRoleEl && Array.from(initialRoleEl.options).some((option) => option.value === prefillRole)) {
            initialRoleEl.value = prefillRole;
        }

        const hasUrlPerson = Boolean(String(prefillId || '').trim());
        const hasUrlDateRange = Boolean((prefillStartDate && prefillEndDate) || prefillDate);

        if (hasUrlPerson) {
            addSchedulePerson({
                id: prefillId,
                personId: prefillId,
                displayName: prefillName || initialLockedPersonName || prefillId,
                availableRoles: canSelectAnyPerson ? [] : initialScheduleRoles
            }, { activate: true, selectedRole: selectedScheduleRole() || prefillRole || initialDefaultRole });

            if (prefillStartDate && prefillEndDate) {
                document.getElementById('sch_startDate').value = prefillStartDate;
                document.getElementById('sch_endDate').value = prefillEndDate;
            } else if (prefillDate) {
                const targetDate = new Date(`${prefillDate}T00:00:00`);
                const day = targetDate.getDay() || 7;
                const start = new Date(targetDate);
                start.setHours(-24 * (day - 1));
                const end = new Date(start);
                end.setDate(start.getDate() + 6);

                setDateRange(start, end);
            } else {
                applyDefaultWeekRange();
            }
            refreshScheduleViewWithHolidays();
            await loadActiveSchedulePerson();
            return;
        }

        const savedPrefs = (initialScheduleViewerPrefs && typeof initialScheduleViewerPrefs === 'object')
            ? initialScheduleViewerPrefs
            : null;
        const hasSavedWorkspace = Boolean(
            savedPrefs
            && (
                (Array.isArray(savedPrefs.persons) && savedPrefs.persons.length)
                || (savedPrefs.startDate && savedPrefs.endDate)
            )
        );

        if (hasSavedWorkspace && !hasUrlDateRange) {
            beginSuppressWorkspaceAutoPersist();
            try {
                if (savedPrefs.startDate && savedPrefs.endDate) {
                    document.getElementById('sch_startDate').value = savedPrefs.startDate;
                    document.getElementById('sch_endDate').value = savedPrefs.endDate;
                } else {
                    applyDefaultWeekRange();
                }
                if (typeof savedPrefs.autoChangeDetector === 'boolean') {
                    applyScheduleAutoChangeDetector(savedPrefs.autoChangeDetector);
                }
                scheduleState.timelinePreset = readTimelinePresetFromPrefs(savedPrefs);

                const savedPersons = Array.isArray(savedPrefs.persons) ? savedPrefs.persons : [];
                if (savedPersons.length) {
                    savedPersons.forEach((entry) => {
                        addSchedulePerson({
                            id: entry.id,
                            personId: entry.id,
                            displayName: entry.name || entry.id,
                            selectedRole: entry.selectedRole || '',
                            chipBgColor: entry.chipBgColor || '',
                            chipTextColor: entry.chipTextColor || ''
                        }, {
                            selectedRole: entry.selectedRole || '',
                            activate: entry.id === savedPrefs.activePersonId,
                            suppressWorkspaceAutoPersist: true
                        });
                    });
                } else if (!canSelectAnyPerson && initialLockedPersonId) {
                    addSchedulePerson({
                        id: initialLockedPersonId,
                        personId: initialLockedPersonId,
                        displayName: initialLockedPersonName || initialLockedPersonId,
                        availableRoles: initialScheduleRoles
                    }, { activate: true, selectedRole: initialDefaultRole, suppressWorkspaceAutoPersist: true });
                }

                if (savedPrefs.activePersonId && scheduleState.persons.some((person) => person.id === savedPrefs.activePersonId)) {
                    scheduleState.activePersonId = savedPrefs.activePersonId;
                } else if (scheduleState.persons.length) {
                    scheduleState.activePersonId = scheduleState.persons[0].id;
                }

                renderSchedulePersonTabs();
                refreshScheduleViewWithHolidays();
                if (scheduleState.persons.length) {
                    await loadAllSavedSchedulePersons();
                }
            } finally {
                endSuppressWorkspaceAutoPersist();
            }
            return;
        }

        applyDefaultWeekRange();
        if (!canSelectAnyPerson && initialLockedPersonId) {
            addSchedulePerson({
                id: initialLockedPersonId,
                personId: initialLockedPersonId,
                displayName: initialLockedPersonName || initialLockedPersonId,
                availableRoles: initialScheduleRoles
            }, { activate: true, selectedRole: initialDefaultRole });
            refreshScheduleActiveView();
            await loadActiveSchedulePerson();
        } else {
            refreshScheduleActiveView();
        }
    }

    function syncScheduleViewbarStickyTop() {
        const header = document.getElementById('main-header');
        if (!header) return;
        let topPx = Math.max(0, header.getBoundingClientRect().bottom);
        const notice = document.querySelector('.notice-bar');
        if (notice && !notice.classList.contains('hidden')) {
            const noticeBottom = notice.getBoundingClientRect().bottom;
            if (Number.isFinite(noticeBottom) && noticeBottom > topPx) {
                topPx = noticeBottom;
            }
        }
        document.documentElement.style.setProperty('--schedule-viewbar-sticky-top', `${topPx.toFixed(2)}px`);
        syncScheduleAdminWeekRailStickyTop();
    }

    function bindScheduleViewbarStickyOffset() {
        const header = document.getElementById('main-header');
        if (!header) return;
        let stickyRaf = 0;
        const scheduleSync = () => {
            if (stickyRaf) return;
            stickyRaf = requestAnimationFrame(() => {
                stickyRaf = 0;
                syncScheduleViewbarStickyTop();
            });
        };
        syncScheduleViewbarStickyTop();
        window.addEventListener('resize', scheduleSync, { passive: true });
        window.addEventListener('scroll', scheduleSync, { passive: true });
        header.addEventListener('transitionend', scheduleSync);
        document.getElementById('headerCompactToggle')?.addEventListener('click', scheduleSync);
        if (typeof ResizeObserver === 'function') {
            const observer = new ResizeObserver(scheduleSync);
            observer.observe(header);
            const notice = document.querySelector('.notice-bar');
            if (notice) observer.observe(notice);
        }
    }

    if (canDragCreateSessions && typeof global.MasterScheduleDraftSaveOrchestrator?.install === 'function') {
        const draftSaveOrchestratorExports = global.MasterScheduleDraftSaveOrchestrator.install({
            fetchWithScheduleTimeout,
            SCHEDULE_COMMIT_STAGED_API,
            SCHEDULE_COMMIT_STAGED_PRECHECK_API,
            SCHEDULE_VALIDATE_PENDING_ENROLL_API,
            SCHEDULE_EXECUTE_PENDING_ENROLL_API,
            scheduleState,
            uiAlert,
            uiConfirm,
            escapeHtml,
            activeSchedulePerson,
            getScheduleRange,
            selectedScheduleRole,
            appendSavedClassSessionsToState,
            acknowledgeLocalScheduleMutation,
            getActiveDraftSelectionSet,
            schedulePersistDraftBackup: () => { if (canDragCreateSessions) schedulePersistDraftBackup(); },
            clearScheduleDraftBackup,
            countAllPendingDraftSessions,
            getPendingEnrollStudentsForClass,
            replacePendingEnrollStudentsForClass
        });
        if (draftSaveOrchestratorExports?.runSelectedDraftSave) {
            global.MasterScheduleDraftSaveOrchestrator.runSelectedDraftSave = draftSaveOrchestratorExports.runSelectedDraftSave;
        }
    }
    if (canDragCreateSessions && typeof global.MasterScheduleDraftSaveWork?.install === 'function') {
        global.MasterScheduleDraftSaveWork.install({
            scheduleState,
            uiAlert,
            uiConfirm,
            escapeHtml,
            showBootstrapModal: showScheduleBootstrapModal,
            hideBootstrapModal: hideScheduleBootstrapModal,
            activeSchedulePerson,
            getPendingEnrollStudentsForClass,
            getPendingEnrollMetaForClass,
            removePendingEnrollStudentAt,
            refreshScheduleViewWithHolidays,
            syncPartialModalFromTimelineDrafts,
            runSelectedDraftSave: global.MasterScheduleDraftSaveOrchestrator?.runSelectedDraftSave
        });
    }
    if (canSelectAnyPerson && typeof global.installMasterScheduleEnrollStudents === 'function') {
        global.installMasterScheduleEnrollStudents({
            uiAlert,
            uiConfirm,
            escapeHtml,
            showBootstrapModal: showScheduleBootstrapModal,
            hideBootstrapModal: hideScheduleBootstrapModal,
            bindEnrollStudentsRail,
            bindClaimNumbersRail,
            countActiveScheduleSelectedSessions,
            countActiveDraftSelectedSessions,
            getSelectedSavedClassSessionEvents,
            getSelectedDraftEvents,
            setPendingEnrollStudentsForClass: appendPendingEnrollStudentForClass,
            setPendingEnrollMetaForClass,
            getPendingEnrollStudentsForClass,
            getPendingEnrollMetaForClass,
            replacePendingEnrollStudentsForClass,
            removePendingEnrollStudentAt,
            clearPendingEnrollStudentsForClass,
            refreshScheduleViewWithHolidays,
            syncPartialModalFromTimelineDrafts,
            schedulePersistDraftBackup: () => { if (canDragCreateSessions) schedulePersistDraftBackup(); },
            applyScheduleSessionChangesInView
        });
    }
    if (canSelectAnyPerson && typeof global.installMasterScheduleMoveSessions === 'function') {
        global.installMasterScheduleMoveSessions({
            uiAlert,
            escapeHtml,
            showBootstrapModal: showScheduleBootstrapModal,
            hideBootstrapModal: hideScheduleBootstrapModal,
            bindMoveSessionsRail,
            countActiveScheduleSelectedSessions,
            countActiveDraftSelectedSessions,
            getSelectedSavedClassSessionEvents,
            refreshScheduleViewWithHolidays,
            applyScheduleSessionChangesInView,
            reloadLoadedSchedulePersons
        });
    }
    if (canSelectAnyPerson && typeof global.installMasterScheduleMergeSessions === 'function') {
        global.installMasterScheduleMergeSessions({
            uiAlert,
            escapeHtml,
            showBootstrapModal: showScheduleBootstrapModal,
            hideBootstrapModal: hideScheduleBootstrapModal,
            bindMergeSessionsRail,
            countActiveScheduleSelectedSessions,
            countActiveDraftSelectedSessions,
            getSelectedSavedClassSessionEvents,
            refreshScheduleViewWithHolidays
        });
    }
    if (canSelectAnyPerson && typeof global.installMasterScheduleTakeOverSessions === 'function') {
        global.installMasterScheduleTakeOverSessions({
            uiAlert,
            escapeHtml,
            showBootstrapModal: showScheduleBootstrapModal,
            hideBootstrapModal: hideScheduleBootstrapModal,
            bindTakeOverSessionsRail,
            countActiveScheduleSelectedSessions,
            countActiveDraftSelectedSessions,
            getSelectedSavedClassSessionEvents,
            refreshScheduleViewWithHolidays
        });
    }
    if (canSelectAnyPerson && typeof global.installMasterScheduleAddCoTeacher === 'function') {
        global.installMasterScheduleAddCoTeacher({
            uiAlert,
            escapeHtml,
            showBootstrapModal: showScheduleBootstrapModal,
            hideBootstrapModal: hideScheduleBootstrapModal,
            bindAddCoTeacherRail,
            countActiveScheduleSelectedSessions,
            countActiveDraftSelectedSessions,
            getSelectedSavedClassSessionEvents,
            refreshScheduleViewWithHolidays,
            applyClassSessionCoTeacherChangesInView
        });
    }
    if (canSelectAnyPerson && typeof global.installMasterSchedulePersonNote === 'function') {
        global.installMasterSchedulePersonNote({
            uiAlert,
            escapeHtml,
            showBootstrapModal: showScheduleBootstrapModal,
            hideBootstrapModal: hideScheduleBootstrapModal,
            bindPersonScheduleNoteRail,
            bindActiveSchedulePersonChangeListener,
            activeSchedulePerson
        });
    }
    bindScheduleAdminWeekRail();
    if (typeof bindScheduleDraftUnloadGuard === 'function') bindScheduleDraftUnloadGuard();
    void initializeScheduleViewer();


  });
})(typeof window !== 'undefined' ? window : globalThis);
