(function (global) {
  'use strict';

  const TIP_BG = '#ffffff';
  const TIP_FG = '#212529';
  const TIP_BORDER = 'rgba(0, 0, 0, 0.12)';
  const COMMENT_PREVIEW_MAX = 220;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function flagIsTrue(value) {
    return value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true';
  }

  function isAbsentLikeStatus(status) {
    const att = String(status || '').trim().toLowerCase();
    return att === 'absent' || att === 'acf';
  }

  function absenceIsExcused(record) {
    return flagIsTrue(record && record.absenceExcused);
  }

  function defaultFieldVisibility() {
    return {
      showStudentNote: false,
      showExcuseRef: false,
      showExcuseAttachment: false,
      showAdminDiscussion: false,
      showExcuseMarks: false,
      showLateEarly: true
    };
  }

  function normalizeFieldVisibility(fieldVisibility) {
    return { ...defaultFieldVisibility(), ...(fieldVisibility && typeof fieldVisibility === 'object' ? fieldVisibility : {}) };
  }

  function resolveStatusLabel(record) {
    const status = String(record && record.status || '').trim().toLowerCase();
    if (!status) return 'Not marked yet';
    if (status === 'present') return 'Present';
    if (status === 'late') return 'Late';
    if (status === 'excused' || (isAbsentLikeStatus(status) && absenceIsExcused(record))) return 'Excused absence';
    if (status === 'absent') return 'Absent';
    if (status === 'acf') return absenceIsExcused(record) ? 'Excused ACF' : 'Absent Camera Off';
    if (status === 'not_applicable') {
      if (record && record.withinEnrollmentWindow === false) return 'N/A - not enrolled for this session';
      if (record && record.applicability === 'approved_leave') return 'N/A - approved leave';
      if (record && record.applicability === 'makeup_required') return 'N/A - make-up session required';
      return 'N/A';
    }
    return status;
  }

  function formatMinutes(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? String(Math.floor(n)) : '0';
  }

  function formatTimeOrDash(value) {
    const text = String(value || '').trim();
    return text || '—';
  }

  function truncateComment(text, maxLen) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    if (raw.length <= maxLen) return raw;
    return `${raw.slice(0, maxLen - 1)}…`;
  }

  function summarizeComments(comments) {
    const list = Array.isArray(comments) ? comments : [];
    return list.map((comment) => {
      if (!comment || typeof comment !== 'object') return '';
      const author = String(comment.authorName || comment.author || '').trim();
      const body = String(comment.text || comment.body || comment.message || '').trim();
      const line = author && body ? `${author}: ${body}` : (body || author);
      return truncateComment(line, COMMENT_PREVIEW_MAX);
    }).filter(Boolean);
  }

  function cellRosterEditBlocked(record, context) {
    const rec = record || {};
    const ctx = context || {};
    if (ctx.canEditRoster !== true) return true;
    if (rec.withinEnrollmentWindow === false) return true;
    if (rec.applicability === 'makeup_required') return true;
    if (rec.attendanceEditLocked === true) return true;
    const sessionLocked = rec.sessionLocked === true;
    const enrollmentNaLock = rec.enrollmentNaLock === true
      && String(rec.status || '').trim() === 'not_applicable';
    const canOverride = ctx.canOverrideSessionLock === true;
    if (sessionLocked && !canOverride) return true;
    if (enrollmentNaLock && !canOverride) return true;
    return false;
  }

  function cellEditBlocked(record, context) {
    if (cellRosterEditBlocked(record, context)) return true;
    if (context?.canMarkExcused !== true) return true;
    return false;
  }

  const QUICK_MARK_STATUSES = ['present', 'absent', 'acf'];

  const QUICK_STATUS_LABELS = {
    present: 'Mark present',
    absent: 'Mark absent',
    acf: 'Mark ACF'
  };

  function resolveCurrentQuickStatusKey(record) {
    const status = String(record?.status || '').trim().toLowerCase();
    if (!status) return '';
    if (status === 'excused') return 'absent';
    return status;
  }

  function resolveQuickStatusLabel(code) {
    const key = String(code || '').trim().toLowerCase();
    if (typeof global !== 'undefined' && global.AttendanceMarkAppearance?.getMark) {
      const mark = global.AttendanceMarkAppearance.getMark(key);
      const label = String(mark?.label || '').trim();
      if (label) return `Mark ${label}`;
    }
    return QUICK_STATUS_LABELS[key] || `Mark ${key}`;
  }

  /**
   * @param {object} record
   * @param {string[]} enabledStatuses
   * @param {object} context
   * @returns {{ type: 'status', status: string, label: string }[]}
   */
  function buildQuickStatusMenuItems(record, enabledStatuses, context) {
    if (cellRosterEditBlocked(record, context)) return [];
    const enabled = new Set(
      (Array.isArray(enabledStatuses) ? enabledStatuses : QUICK_MARK_STATUSES)
        .map((s) => String(s || '').trim().toLowerCase())
        .filter((s) => QUICK_MARK_STATUSES.includes(s))
    );
    const current = resolveCurrentQuickStatusKey(record);
    return QUICK_MARK_STATUSES
      .filter((code) => enabled.has(code) && code !== current)
      .map((code) => ({
        type: 'status',
        status: code,
        label: resolveQuickStatusLabel(code)
      }));
  }

  function excuseToggleLabel(kind, isExcused) {
    if (kind === 'late') {
      return isExcused ? 'Unmark late excused' : 'Mark late excused';
    }
    if (kind === 'earlyLeave') {
      return isExcused ? 'Unmark early leave excused' : 'Mark early leave excused';
    }
    if (kind === 'absence') {
      return isExcused ? 'Unmark absence excused' : 'Mark absence excused';
    }
    return isExcused ? 'Unmark excused' : 'Mark excused';
  }

  /**
   * @param {object} record
   * @param {object} context
   * @param {'late'|'earlyLeave'|'absence'} kind
   */
  function canShowExcuseToggle(record, context, kind) {
    if (cellEditBlocked(record, context)) return false;
    const rec = record || {};
    const late = Number(rec.lateMinutes) || 0;
    const early = Number(rec.earlyLeaveMinutes) || 0;
    const status = String(rec.status || '').trim().toLowerCase();
    if (kind === 'late') return late > 0;
    if (kind === 'earlyLeave') return early > 0;
    if (kind === 'absence') {
      return isAbsentLikeStatus(status) || status === 'excused';
    }
    return false;
  }

  function buildLateSectionRows(rec, late) {
    const rows = [];
    const arrival = String(rec.attendanceArrivalTime || '').trim();
    const breakLate = Number(rec.breakLateMinutes) || 0;
    if (arrival) {
      rows.push({ label: 'Late Arrival At:', value: arrival });
    }
    if (breakLate > 0) {
      rows.push({ label: 'Late:', value: `${formatMinutes(breakLate)} min` });
    }
    if (late > 0) {
      const totalLabel = rows.length ? 'Total:' : 'Late:';
      rows.push({ label: totalLabel, value: `${formatMinutes(late)} min` });
    }
    return rows;
  }

  function buildEarlySectionRows(rec, early) {
    const rows = [];
    const leaveTime = String(rec.attendanceLeaveTime || '').trim();
    const breakEarly = Number(rec.breakEarlyLeaveMinutes) || 0;
    if (leaveTime) {
      rows.push({ label: 'Left Early At:', value: leaveTime });
    }
    if (breakEarly > 0) {
      rows.push({ label: 'Left Early:', value: `${formatMinutes(breakEarly)} min` });
    }
    if (early > 0) {
      const totalLabel = rows.length ? 'Total:' : 'Left Early:';
      rows.push({ label: totalLabel, value: `${formatMinutes(early)} min` });
    }
    return rows;
  }

  function buildAttendanceCellTipModel(record, context) {
    const rec = record && typeof record === 'object' ? record : {};
    const ctx = context && typeof context === 'object' ? context : {};
    const fv = normalizeFieldVisibility(ctx.fieldVisibility);
    const sections = [];
    const buttons = [];
    const commentBlocks = [];

    const late = Number(rec.lateMinutes) || 0;
    const early = Number(rec.earlyLeaveMinutes) || 0;
    const showLateSection = late > 0
      || String(rec.attendanceArrivalTime || '').trim()
      || Number(rec.breakLateMinutes) > 0;
    const showEarlySection = early > 0
      || String(rec.attendanceLeaveTime || '').trim()
      || Number(rec.breakEarlyLeaveMinutes) > 0;

    if (showLateSection) {
      const rows = buildLateSectionRows(rec, late);
      if (rows.length) {
        sections.push({
          id: 'late',
          title: String(rec.attendanceArrivalTime || '').trim() ? 'Late Arrival:' : 'Late:',
          rows
        });
      }
      if (canShowExcuseToggle(rec, ctx, 'late')) {
        const lateExcused = flagIsTrue(rec.lateExcused);
        buttons.push({
          kind: 'late',
          label: excuseToggleLabel('late', lateExcused),
          excused: lateExcused
        });
      }
    }

    if (showEarlySection) {
      const rows = buildEarlySectionRows(rec, early);
      if (rows.length) {
        sections.push({
          id: 'earlyLeave',
          title: String(rec.attendanceLeaveTime || '').trim() ? 'Left Early At:' : 'Left Early:',
          rows
        });
      }
      if (canShowExcuseToggle(rec, ctx, 'earlyLeave')) {
        const earlyLeaveExcused = flagIsTrue(rec.earlyLeaveExcused);
        buttons.push({
          kind: 'earlyLeave',
          label: excuseToggleLabel('earlyLeave', earlyLeaveExcused),
          excused: earlyLeaveExcused
        });
      }
    }

    if (canShowExcuseToggle(rec, ctx, 'absence')) {
      const absenceExcused = absenceIsExcused(rec) || String(rec.status || '').trim() === 'excused';
      buttons.push({
        kind: 'absence',
        label: excuseToggleLabel('absence', absenceExcused),
        excused: absenceExcused
      });
    }

    if (fv.showExcuseRef && String(rec.excuseRef || '').trim()) {
      commentBlocks.push({
        title: 'Excuse / reference',
        text: truncateComment(rec.excuseRef, COMMENT_PREVIEW_MAX)
      });
    }
    if (fv.showStudentNote && String(rec.rosterStudentNotes || rec.notes || '').trim()) {
      commentBlocks.push({
        title: 'Student note',
        text: truncateComment(rec.rosterStudentNotes || rec.notes, COMMENT_PREVIEW_MAX)
      });
    }
    if (fv.showAdminDiscussion) {
      summarizeComments(rec.comments).forEach((line, index) => {
        commentBlocks.push({
          title: index === 0 ? 'Admin discussion' : '',
          text: line
        });
      });
    }
    if (fv.showExcuseAttachment && rec.excuseAttachment && typeof rec.excuseAttachment === 'object') {
      const name = String(rec.excuseAttachment.name || rec.excuseAttachment.originalName || '').trim();
      commentBlocks.push({
        title: 'Attachment',
        text: name ? `Attachment on file: ${name}` : 'Attachment on file'
      });
    }

    const hasLongThread = (Array.isArray(rec.comments) ? rec.comments : []).length > 1
      || String(rec.excuseRef || '').trim().length > COMMENT_PREVIEW_MAX
      || String(rec.rosterStudentNotes || rec.notes || '').trim().length > COMMENT_PREVIEW_MAX;

    const status = String(rec.status || '').trim().toLowerCase();
    const statusAbsenceExcused = absenceIsExcused(rec) || status === 'excused';

    return {
      statusLabel: resolveStatusLabel(rec),
      statusAbsenceExcused,
      sections,
      buttons,
      commentBlocks,
      hasInteractive: false,
      hintOpenCell: hasLongThread
    };
  }

  function buildExcuseContextMenuItems(model) {
    return Array.isArray(model?.buttons) ? model.buttons : [];
  }

  function buildTipHtmlFromModel(model) {
    const m = model || {};
    const parts = [];
    const statusClass = m.statusAbsenceExcused ? ' att-tip-status-excused' : '';
    parts.push(`<span class="sch-tip-line${statusClass}">${escapeHtml(m.statusLabel || '')}</span>`);
    (m.sections || []).forEach((section) => {
      if (section.title) {
        parts.push(`<span class="sch-tip-line att-tip-section-title">${escapeHtml(section.title)}</span>`);
      }
      (section.rows || []).forEach((row) => {
        parts.push(`<span class="sch-tip-line sch-tip-sub"><span class="att-tip-row-label">${escapeHtml(row.label || '')}</span> <span class="att-tip-row-value">${escapeHtml(row.value || '')}</span></span>`);
      });
    });
    if ((m.commentBlocks || []).length) {
      parts.push('<span class="att-tip-divider"></span>');
      m.commentBlocks.forEach((block) => {
        if (block.title) {
          parts.push(`<span class="sch-tip-line att-tip-section-title">${escapeHtml(block.title)}</span>`);
        }
        parts.push(`<span class="sch-tip-line att-tip-comment">${escapeHtml(block.text || '')}</span>`);
      });
    }
    if (m.hintOpenCell) {
      parts.push(`<span class="sch-tip-line sch-tip-sub">Open cell for full detail.</span>`);
    }
    return parts.join('');
  }

  function buildContextMenuItemHtml(btn) {
    const kind = escapeHtml(btn.kind || '');
    const label = escapeHtml(btn.label || '');
    let extraClass = ' att-cell-context-menu-item';
    if (btn.kind === 'absence' && btn.excused) extraClass += ' att-cell-context-menu-item--absence-excused';
    else if (btn.excused) extraClass += ' att-cell-context-menu-item--excused';
    return `<button type="button" class="${extraClass.trim()}" role="menuitem" data-att-excuse-kind="${kind}">${label}</button>`;
  }

  function buildQuickStatusMenuItemHtml(item) {
    const status = escapeHtml(item.status || '');
    const label = escapeHtml(item.label || '');
    return `<button type="button" class="att-cell-context-menu-item att-cell-context-menu-item--status att-cell-context-menu-item--status-${status}" role="menuitem" data-att-quick-status="${status}">${label}</button>`;
  }

  function buildContextMenuAccessContext(ctx) {
    const access = resolveAccessFlags();
    return {
      fieldVisibility: ctx?.fieldVisibility,
      canMarkExcused: access.canMarkExcused === true,
      canEditRoster: access.canEditRoster === true,
      canOverrideSessionLock: access.canOverrideSessionLock === true
    };
  }

  function buildContextMenuHtml(model, ctx) {
    const menuAccess = buildContextMenuAccessContext(ctx);
    const enabledStatuses = typeof initOptions?.resolveEnabledStatuses === 'function'
      ? initOptions.resolveEnabledStatuses(ctx)
      : QUICK_MARK_STATUSES;
    const quickItems = buildQuickStatusMenuItems(ctx?.record, enabledStatuses, menuAccess);
    const excuseItems = buildExcuseContextMenuItems(model);
    const parts = [];
    quickItems.forEach((item) => parts.push(buildQuickStatusMenuItemHtml(item)));
    if (quickItems.length && excuseItems.length) {
      parts.push('<div class="att-cell-context-menu-divider" role="separator" aria-hidden="true"></div>');
    }
    if (excuseItems.length) {
      excuseItems.forEach((btn) => parts.push(buildContextMenuItemHtml(btn)));
    }
    if (parts.length) {
      parts.push('<div class="att-cell-context-menu-divider" role="separator" aria-hidden="true"></div>');
      parts.push('<button type="button" class="att-cell-context-menu-item att-cell-context-menu-item--muted" role="menuitem" data-att-open-details="1">Open details…</button>');
      return parts.join('');
    }
    return '<button type="button" class="att-cell-context-menu-item" role="menuitem" data-att-open-details="1">Open details…</button>';
  }

  let tipEl = null;
  let tipAnchor = null;
  let hideTimer = null;
  let initOptions = null;
  let boundRoot = null;
  let contextMenuEl = null;
  let contextMenuAnchor = null;
  let contextMenuContext = null;
  let contextMenuDismissBound = false;

  function hideTip() {
    if (!tipEl) return;
    tipEl.classList.remove('is-visible', 'is-below');
    tipEl.hidden = true;
    tipEl.innerHTML = '';
    tipAnchor = null;
  }

  function resolveAccessFlags() {
    return typeof initOptions.resolveAccess === 'function'
      ? initOptions.resolveAccess()
      : {};
  }

  function buildModelForContext(ctx) {
    const access = resolveAccessFlags();
    return buildAttendanceCellTipModel(ctx.record, {
      fieldVisibility: ctx.fieldVisibility,
      canMarkExcused: access.canMarkExcused === true,
      canEditRoster: access.canEditRoster === true,
      canOverrideSessionLock: access.canOverrideSessionLock === true
    });
  }

  function hideContextMenu() {
    if (!contextMenuEl) return;
    contextMenuEl.classList.add('d-none');
    contextMenuEl.setAttribute('aria-hidden', 'true');
    contextMenuEl.innerHTML = '';
    contextMenuAnchor = null;
    contextMenuContext = null;
  }

  function positionContextMenu(clientX, clientY) {
    if (!contextMenuEl) return;
    contextMenuEl.classList.remove('d-none');
    contextMenuEl.setAttribute('aria-hidden', 'false');
    const pad = 8;
    const rect = contextMenuEl.getBoundingClientRect();
    const width = rect.width || 200;
    const height = rect.height || 80;
    let left = clientX;
    let top = clientY;
    left = Math.max(pad, Math.min(left, window.innerWidth - width - pad));
    top = Math.max(pad, Math.min(top, window.innerHeight - height - pad));
    contextMenuEl.style.left = `${left}px`;
    contextMenuEl.style.top = `${top}px`;
  }

  function showContextMenuForCell(cellEl, clientX, clientY) {
    if (!initOptions || typeof initOptions.resolveContext !== 'function') return;
    const ctx = initOptions.resolveContext(cellEl);
    if (!ctx || !ctx.record) return;
    hideTip();
    const model = buildModelForContext(ctx);
    if (!contextMenuEl) {
      contextMenuEl = document.createElement('div');
      contextMenuEl.className = 'att-cell-context-menu d-none';
      contextMenuEl.setAttribute('role', 'menu');
      contextMenuEl.setAttribute('aria-hidden', 'true');
      contextMenuEl.addEventListener('click', onContextMenuClick);
      document.body.appendChild(contextMenuEl);
    }
    contextMenuAnchor = cellEl;
    contextMenuContext = ctx;
    contextMenuEl.innerHTML = buildContextMenuHtml(model, ctx);
    positionContextMenu(clientX, clientY);
  }

  function bindContextMenuDismiss() {
    if (contextMenuDismissBound) return;
    contextMenuDismissBound = true;
    document.addEventListener('mousedown', (event) => {
      if (!contextMenuEl || contextMenuEl.classList.contains('d-none')) return;
      if (contextMenuEl.contains(event.target)) return;
      hideContextMenu();
    });
    document.addEventListener('scroll', hideContextMenu, true);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hideContextMenu();
    });
  }

  function onContextMenuClick(event) {
    const openBtn = event.target.closest('[data-att-open-details]');
    if (openBtn) {
      event.preventDefault();
      event.stopPropagation();
      const anchor = contextMenuAnchor;
      const ctx = contextMenuContext;
      hideContextMenu();
      if (typeof initOptions.onOpenCellDetails === 'function' && anchor && ctx) {
        initOptions.onOpenCellDetails({ anchorEl: anchor, context: ctx });
      }
      return;
    }
    const statusBtn = event.target.closest('[data-att-quick-status]');
    if (statusBtn) {
      event.preventDefault();
      event.stopPropagation();
      const nextStatus = String(statusBtn.getAttribute('data-att-quick-status') || '').trim().toLowerCase();
      const anchor = contextMenuAnchor;
      if (!nextStatus || !anchor) return;
      void setStatusFromContextMenu(nextStatus, anchor, contextMenuContext);
      return;
    }
    const btn = event.target.closest('[data-att-excuse-kind]');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    const kind = String(btn.getAttribute('data-att-excuse-kind') || '').trim();
    const anchor = contextMenuAnchor;
    if (!kind || !anchor) return;
    void toggleExcuseFromTip(kind, anchor, contextMenuContext);
  }

  function onRootContextMenu(event) {
    if (!initOptions?.cellSelector) return;
    const cell = event.target.closest(initOptions.cellSelector);
    if (!cell) return;
    event.preventDefault();
    event.stopPropagation();
    showContextMenuForCell(cell, event.clientX, event.clientY);
  }

  function positionTip(target) {
    if (!tipEl || !target) return;
    tipEl.classList.remove('is-below');
    const rect = target.getBoundingClientRect();
    let left = rect.left + (rect.width / 2);
    const tipWidth = tipEl.offsetWidth || 160;
    const tipHeight = tipEl.offsetHeight || 80;
    const pad = 10;
    left = Math.max(pad + tipWidth / 2, Math.min(left, window.innerWidth - pad - tipWidth / 2));
    tipEl.style.left = `${left}px`;
    if ((rect.top - tipHeight - 14) < pad) {
      tipEl.classList.add('is-below');
      tipEl.style.top = `${Math.min(window.innerHeight - pad - tipHeight, rect.bottom)}px`;
    } else {
      tipEl.style.top = `${Math.max(8, rect.top)}px`;
    }
    tipEl.classList.add('is-visible');
  }

  function showTipForTarget(target) {
    if (!initOptions || typeof initOptions.resolveContext !== 'function') return;
    const ctx = initOptions.resolveContext(target);
    if (!ctx || !ctx.record) {
      hideTip();
      return;
    }
    const access = resolveAccessFlags();
    const model = buildAttendanceCellTipModel(ctx.record, {
      fieldVisibility: ctx.fieldVisibility,
      canMarkExcused: access.canMarkExcused === true,
      canEditRoster: access.canEditRoster === true,
      canOverrideSessionLock: access.canOverrideSessionLock === true
    });
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'sch-event-tip attendance-cell-tip';
      tipEl.setAttribute('role', 'tooltip');
      tipEl.hidden = true;
      document.body.appendChild(tipEl);
    }
    tipEl.style.background = TIP_BG;
    tipEl.style.color = TIP_FG;
    tipEl.style.borderColor = TIP_BORDER;
    tipEl.style.setProperty('--sch-tip-arrow', TIP_BG);
    tipEl.style.setProperty('--sch-tip-arrow-border', TIP_BORDER);
    tipEl.innerHTML = buildTipHtmlFromModel(model);
    tipEl.hidden = false;
    tipAnchor = target;
    positionTip(target);
  }

  function shouldUseHoverTips() {
    if (typeof window !== 'undefined' && window.matchMedia) {
      if (window.matchMedia('(hover: none)').matches) return false;
      if (window.matchMedia('(max-width: 767.98px)').matches) return false;
    }
    return true;
  }

  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      hideTip();
    }, 120);
  }

  function cancelHide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  async function setStatusFromContextMenu(nextStatus, anchorEl, ctxOverride) {
    if (!initOptions) return;
    const ctx = ctxOverride || contextMenuContext;
    if (!ctx || !ctx.record) return;
    const menuAccess = buildContextMenuAccessContext(ctx);
    if (cellRosterEditBlocked(ctx.record, menuAccess)) return;
    const attendance = String(nextStatus || '').trim().toLowerCase();
    if (!QUICK_MARK_STATUSES.includes(attendance)) return;
    const payload = {
      classId: String(ctx.classId || '').trim(),
      sessionId: String(ctx.record.sessionId || ctx.sessionId || '').trim(),
      studentPersonId: String(ctx.personId || '').trim(),
      attendance
    };
    if (typeof initOptions.resolveActionStateId === 'function') {
      const actionStateId = initOptions.resolveActionStateId();
      if (actionStateId) payload.actionStateId = actionStateId;
    }
    try {
      const res = await fetch('/school/attendances/api/update-roster-cell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AJAX-Request': 'true' },
        body: JSON.stringify(payload)
      });
      const result = await res.json().catch(() => null);
      if (typeof initOptions.onApiResult === 'function') {
        initOptions.onApiResult(res, result);
      }
      if (!result || result.status !== 'success') {
        if (typeof initOptions.onApiError === 'function') {
          initOptions.onApiError(result);
        }
        hideContextMenu();
        return;
      }
      if (typeof initOptions.onPatched === 'function') {
        initOptions.onPatched({
          anchorEl,
          context: ctx,
          payload,
          serverRecord: result.record || null
        });
      }
      hideContextMenu();
      hideTip();
    } catch (error) {
      if (typeof initOptions.onApiError === 'function') {
        initOptions.onApiError({ message: error && error.message ? error.message : 'Save failed.' });
      }
    }
  }

  async function toggleExcuseFromTip(kind, anchorEl, ctxOverride) {
    if (!initOptions) return;
    const ctx = ctxOverride || contextMenuContext;
    if (!ctx || !ctx.record) return;
    const access = resolveAccessFlags();
    if (!canShowExcuseToggle(ctx.record, {
      fieldVisibility: ctx.fieldVisibility,
      canMarkExcused: access.canMarkExcused === true,
      canEditRoster: access.canEditRoster === true,
      canOverrideSessionLock: access.canOverrideSessionLock === true
    }, kind)) {
      return;
    }
    const record = ctx.record;
    const attendance = String(record.status || '').trim().toLowerCase() || 'absent';
    const payload = {
      classId: String(ctx.classId || '').trim(),
      sessionId: String(record.sessionId || ctx.sessionId || '').trim(),
      studentPersonId: String(ctx.personId || '').trim(),
      attendance
    };
    if (kind === 'late') {
      payload.lateExcused = !flagIsTrue(record.lateExcused);
      payload.lateMinutes = Math.max(0, Math.floor(Number(record.lateMinutes) || 0));
    } else if (kind === 'earlyLeave') {
      payload.earlyLeaveExcused = !flagIsTrue(record.earlyLeaveExcused);
      payload.earlyLeaveMinutes = Math.max(0, Math.floor(Number(record.earlyLeaveMinutes) || 0));
    } else if (kind === 'absence') {
      payload.absenceExcused = !(absenceIsExcused(record) || attendance === 'excused');
    }
    if (typeof initOptions.resolveActionStateId === 'function') {
      const actionStateId = initOptions.resolveActionStateId();
      if (actionStateId) payload.actionStateId = actionStateId;
    }
    try {
      const res = await fetch('/school/attendances/api/update-roster-cell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AJAX-Request': 'true' },
        body: JSON.stringify(payload)
      });
      const result = await res.json().catch(() => null);
      if (typeof initOptions.onApiResult === 'function') {
        initOptions.onApiResult(res, result);
      }
      if (!result || result.status !== 'success') {
        if (typeof initOptions.onApiError === 'function') {
          initOptions.onApiError(result);
        }
        hideContextMenu();
        return;
      }
      if (typeof initOptions.onPatched === 'function') {
        initOptions.onPatched({
          anchorEl,
          context: ctx,
          payload,
          serverRecord: result.record || null
        });
      }
      hideContextMenu();
      hideTip();
    } catch (error) {
      if (typeof initOptions.onApiError === 'function') {
        initOptions.onApiError({ message: error && error.message ? error.message : 'Save failed.' });
      }
    }
  }

  function onRootPointerOver(event) {
    if (!shouldUseHoverTips()) return;
    const target = event.target.closest(initOptions.cellSelector);
    if (!target) return;
    cancelHide();
    showTipForTarget(target);
  }

  function onRootPointerOut(event) {
    if (!shouldUseHoverTips()) return;
    if (event.target.closest(initOptions.cellSelector)) {
      scheduleHide();
    }
  }

  function onRootFocusIn(event) {
    if (!shouldUseHoverTips()) return;
    const target = event.target.closest(initOptions.cellSelector);
    if (!target) return;
    cancelHide();
    showTipForTarget(target);
  }

  function onRootFocusOut(event) {
    if (!shouldUseHoverTips()) return;
    const target = event.target.closest(initOptions.cellSelector);
    if (!target) return;
    scheduleHide();
  }

  function bindHoverTipRoot(root) {
    if (!initOptions || !initOptions.cellSelector) return;
    const resolvedRoot = root || document;
    if (boundRoot && boundRoot !== resolvedRoot) {
      boundRoot.removeEventListener('mouseover', onRootPointerOver);
      boundRoot.removeEventListener('mouseout', onRootPointerOut);
      boundRoot.removeEventListener('focusin', onRootFocusIn);
      boundRoot.removeEventListener('focusout', onRootFocusOut);
      boundRoot.removeEventListener('contextmenu', onRootContextMenu);
    }
    boundRoot = resolvedRoot;
    boundRoot.addEventListener('mouseover', onRootPointerOver);
    boundRoot.addEventListener('mouseout', onRootPointerOut);
    boundRoot.addEventListener('focusin', onRootFocusIn);
    boundRoot.addEventListener('focusout', onRootFocusOut);
    boundRoot.addEventListener('contextmenu', onRootContextMenu);
    bindContextMenuDismiss();
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'sch-event-tip attendance-cell-tip';
      tipEl.setAttribute('role', 'tooltip');
      tipEl.hidden = true;
      document.body.appendChild(tipEl);
    }
  }

  function initAttendanceCellHoverTip(options) {
    initOptions = options || {};
    if (!initOptions.cellSelector) return;
    bindHoverTipRoot(initOptions.root || document);
  }

  function setAttendanceCellHoverTipRoot(rootEl) {
    bindHoverTipRoot(rootEl || document);
  }

  const api = {
    initAttendanceCellHoverTip,
    setAttendanceCellHoverTipRoot,
    buildAttendanceCellTipModel,
    buildTipHtmlFromModel,
    buildExcuseContextMenuItems,
    buildQuickStatusMenuItems,
    canShowExcuseToggle,
    cellEditBlocked,
    cellRosterEditBlocked,
    escapeHtml,
    flagIsTrue,
    isAbsentLikeStatus
  };

  global.AttendanceCellHoverTip = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
