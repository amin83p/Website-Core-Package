(function initReportInstanceStudentContextMenu(global) {
  'use strict';

  const MENU_ID = 'reportInstanceStudentContextMenu';

  function readToolsBag() {
    const bag = global.__reportInstanceStudentTools;
    return bag && typeof bag === 'object' ? bag : null;
  }

  function normalizeYmd(value) {
    const raw = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
  }

  function resolveReportPeriod(bag) {
    const start = normalizeYmd(bag?.reportPeriodStart);
    const end = normalizeYmd(bag?.reportPeriodEnd);
    if (start && end) return { startDate: start, endDate: end };
    return { startDate: '', endDate: '' };
  }

  function appendPeriodParams(params, period) {
    if (period.startDate && period.endDate) {
      params.set('startDate', period.startDate);
      params.set('endDate', period.endDate);
    }
  }

  function buildAttendanceMatrixUrl(bag) {
    const classId = String(bag?.classId || '').trim();
    const personId = String(bag?.studentPersonId || '').trim();
    if (!classId || !personId) return '';
    const params = new URLSearchParams();
    params.set('classId', classId);
    params.set('studentId', personId);
    appendPeriodParams(params, resolveReportPeriod(bag));
    return `/school/attendances?${params.toString()}`;
  }

  function buildStudentAttendanceReportUrl(bag) {
    const recordId = String(bag?.studentRecordId || '').trim();
    if (!recordId) return '';
    const params = new URLSearchParams();
    params.set('studentIds', recordId);
    appendPeriodParams(params, resolveReportPeriod(bag));
    return `/school/attendances/report?${params.toString()}`;
  }

  function buildGradesMatrixUrl(bag) {
    const classId = String(bag?.classId || '').trim();
    if (!classId) return '';
    const params = new URLSearchParams();
    params.set('classId', classId);
    appendPeriodParams(params, resolveReportPeriod(bag));
    return `/school/grades-matrix?${params.toString()}`;
  }

  function buildConductMatrixUrl(bag) {
    const classId = String(bag?.classId || '').trim();
    if (!classId) return '';
    const params = new URLSearchParams();
    params.set('classId', classId);
    appendPeriodParams(params, resolveReportPeriod(bag));
    return `/school/conduct-matrix?${params.toString()}`;
  }

  function buildClassConductReportUrl(bag) {
    const recordId = String(bag?.studentRecordId || '').trim();
    if (!recordId) return '';
    const params = new URLSearchParams();
    params.set('studentIds', recordId);
    appendPeriodParams(params, resolveReportPeriod(bag));
    return `/school/class-conduct-report?${params.toString()}`;
  }

  function buildRollingEnrollmentUrl(bag) {
    const classId = String(bag?.classId || '').trim();
    if (!classId) return '';
    const link = global.SchoolRollingEnrollmentDeepLink;
    if (!link || typeof link.buildRollingEnrollmentUrl !== 'function') return '';
    const studentName = String(bag?.studentName || '').trim();
    return link.buildRollingEnrollmentUrl(classId, studentName ? { studentName } : {});
  }

  function buildStudentProfileUrl(bag) {
    const recordId = String(bag?.studentRecordId || '').trim();
    if (!recordId) return '';
    return `/school/students/edit/${encodeURIComponent(recordId)}`;
  }

  function hideMenu(menu) {
    if (!menu) return;
    menu.classList.add('d-none');
    menu.setAttribute('aria-hidden', 'true');
  }

  function showMenu(menu, clientX, clientY) {
    const pad = 8;
    const vw = global.innerWidth || 1024;
    const vh = global.innerHeight || 768;
    menu.style.visibility = 'hidden';
    menu.classList.remove('d-none');
    menu.setAttribute('aria-hidden', 'false');
    const rect = menu.getBoundingClientRect();
    let left = clientX;
    let top = clientY;
    if (left + rect.width > vw - pad) left = Math.max(pad, vw - rect.width - pad);
    if (top + rect.height > vh - pad) top = Math.max(pad, vh - rect.height - pad);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.visibility = '';
  }

  function formatPeriodSubtitle(bag) {
    const { startDate, endDate } = resolveReportPeriod(bag);
    if (!startDate || !endDate) return '';
    return `${startDate} – ${endDate}`;
  }

  function bindMenuItem(menu, action, { enabled, url }) {
    const btn = menu.querySelector(`[data-action="${action}"]`);
    if (!btn) return;
    btn.disabled = !enabled || !url;
    btn.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!enabled || !url) return;
      hideMenu(menu);
      global.open(url, '_blank', 'noopener,noreferrer');
    };
  }

  function initReportInstanceStudentContextMenu() {
    const bag = readToolsBag();
    if (!bag || !String(bag.studentRecordId || '').trim()) return;

    const menu = document.getElementById(MENU_ID);
    if (!menu) return;

    const targets = document.querySelectorAll('.js-report-instance-student-context-target');
    if (!targets.length) return;

    const header = menu.querySelector('[data-role="header"]');
    const subtitle = menu.querySelector('[data-role="subtitle"]');
    const studentName = String(bag.studentName || 'Student').trim() || 'Student';
    if (header) header.textContent = studentName;
    if (subtitle) {
      const periodText = formatPeriodSubtitle(bag);
      subtitle.textContent = periodText;
      subtitle.classList.toggle('d-none', !periodText);
    }

    const rollingAllowed = bag.canOpenRollingEnrollment === true
      && String(bag.registrationMode || '').trim().toLowerCase() === 'rolling';

    bindMenuItem(menu, 'attendance-matrix', {
      enabled: bag.canOpenAttendanceMatrix === true,
      url: buildAttendanceMatrixUrl(bag)
    });
    bindMenuItem(menu, 'attendance-report', {
      enabled: bag.canOpenStudentAttendanceReport === true,
      url: buildStudentAttendanceReportUrl(bag)
    });
    bindMenuItem(menu, 'grades-matrix', {
      enabled: bag.canOpenGradesMatrix === true,
      url: buildGradesMatrixUrl(bag)
    });
    bindMenuItem(menu, 'conduct-matrix', {
      enabled: bag.canOpenConductMatrix === true,
      url: buildConductMatrixUrl(bag)
    });
    bindMenuItem(menu, 'class-conduct-report', {
      enabled: bag.canOpenClassConductReport === true,
      url: buildClassConductReportUrl(bag)
    });

    const rollingBtn = menu.querySelector('[data-action="rolling-enrollment"]');
    const rollingDivider = menu.querySelector('[data-role="rolling-divider"]');
    if (rollingBtn) {
      const showRolling = rollingAllowed;
      rollingBtn.classList.toggle('d-none', !showRolling);
      if (rollingDivider) rollingDivider.classList.toggle('d-none', !showRolling);
      bindMenuItem(menu, 'rolling-enrollment', {
        enabled: showRolling,
        url: buildRollingEnrollmentUrl(bag)
      });
    }

    const profileBtn = menu.querySelector('[data-action="student-profile"]');
    const profileDivider = menu.querySelector('[data-role="profile-divider"]');
    const showProfile = bag.canOpenStudentProfile === true;
    if (profileBtn) {
      profileBtn.classList.toggle('d-none', !showProfile);
      if (profileDivider) profileDivider.classList.toggle('d-none', !showProfile);
      bindMenuItem(menu, 'student-profile', {
        enabled: showProfile,
        url: buildStudentProfileUrl(bag)
      });
    }

    targets.forEach((target) => {
      target.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showMenu(menu, event.clientX, event.clientY);
      });
    });

    document.addEventListener('click', (ev) => {
      if (!menu.classList.contains('d-none') && !menu.contains(ev.target)) hideMenu(menu);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') hideMenu(menu);
    });
    global.addEventListener('scroll', () => hideMenu(menu), true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReportInstanceStudentContextMenu);
  } else {
    initReportInstanceStudentContextMenu();
  }

  global.ReportInstanceStudentContextMenu = {
    buildAttendanceMatrixUrl,
    buildStudentAttendanceReportUrl,
    buildGradesMatrixUrl,
    buildConductMatrixUrl,
    buildClassConductReportUrl,
    initReportInstanceStudentContextMenu
  };
}(typeof window !== 'undefined' ? window : globalThis));