'use strict';
(function (global) {
  const API_BASE = '/school/student-management/api';
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function formatHubDateKey(dateValue, options) {
    options = options || {};
    const raw = String(dateValue || '').trim();
    if (!raw) return '-';
    if (global.AppOrgDateTime && typeof global.AppOrgDateTime.formatDateKey === 'function') {
      return global.AppOrgDateTime.formatDateKey(raw, options);
    }
    return raw;
  }

  const HUB_STUDENTS_MIN_SEARCH = 3;
  const HUB_STUDENTS_RECENT_KEY = 'schoolStudentManagementRecent';
  const HUB_STUDENTS_RECENT_MAX = 5;
  let hubStudentsSelectedId = '';
  let hubStudentsSearchTimer = null;
  let hubStudentsSearchAbort = null;
  let hubStudentsProfileAbort = null;
  let hubStudentsSuggestActiveIndex = -1;
  let hubStudentsDocCloseBound = false;
  let hubStudentsBorderLightsRaf = 0;
  let hubStudentsBorderLightsState = null;

  const HUB_STUDENTS_BORDER_LIGHT_COLORS = [
    { core: 'rgba(56, 189, 248, 0.95)', glow: 'rgba(56, 189, 248, 0.55)' },
    { core: 'rgba(34, 197, 94, 0.95)', glow: 'rgba(34, 197, 94, 0.5)' },
    { core: 'rgba(167, 139, 250, 0.95)', glow: 'rgba(167, 139, 250, 0.52)' },
    { core: 'rgba(251, 191, 36, 0.95)', glow: 'rgba(251, 191, 36, 0.5)' },
    { core: 'rgba(244, 114, 182, 0.95)', glow: 'rgba(244, 114, 182, 0.48)' },
    { core: 'rgba(34, 211, 238, 0.95)', glow: 'rgba(34, 211, 238, 0.5)' },
    { core: 'rgba(251, 146, 60, 0.95)', glow: 'rgba(251, 146, 60, 0.5)' }
  ];
  let hubStudentsActiveProfile = null;
  let hubStudentsManagersConfigured = false;

  function hubStudentsCanEditClb() {
    return global.__HUB_STUDENTS_CAN_EDIT_CLB__ === true;
  }

  function hubStudentsSideBtnLink(href, label, iconClass) {
    const icon = iconClass ? '<i class="bi ' + iconClass + ' me-1"></i>' : '';
    return '<a class="btn btn-sm btn-outline-secondary hub-students-side-action" href="' + escapeHtml(href)
      + '" target="_blank" rel="noopener noreferrer">' + icon + escapeHtml(label) + '</a>';
  }

  function hubStudentsSideBtnAction(label, attrs, variant) {
    const tone = variant === 'primary' ? 'btn-outline-primary' : 'btn-outline-secondary';
    return '<button type="button" class="btn btn-sm ' + tone + ' hub-students-side-action" ' + attrs + '>'
      + escapeHtml(label) + '</button>';
  }

  function hubStudentsFormatField(value, fallback) {
    const text = String(value == null ? '' : value).trim();
    return text || (fallback || '—');
  }

  function hubStudentsNormalizeList(values, fallbackSingle) {
    const fromArray = Array.isArray(values) ? values : [];
    const cleaned = fromArray.map(function (value) { return String(value == null ? '' : value).trim(); }).filter(Boolean);
    if (cleaned.length) return cleaned;
    const single = String(fallbackSingle == null ? '' : fallbackSingle).trim();
    return single ? [single] : [];
  }

  function hubStudentsFieldManageButtonHtml(label, personFocus) {
    if (!hubStudentsCanEditClb() || !personFocus) return '';
    return [
      '<button type="button" class="btn btn-sm btn-outline-secondary hub-students-field-manage"',
      ' data-hub-students-person-focus="' + escapeHtml(personFocus) + '"',
      ' title="Manage ' + escapeHtml(label) + '">',
      '<i class="bi bi-pencil-square me-1"></i>Manage</button>'
    ].join('');
  }

  function hubStudentsFieldLabelHtml(label, personFocus) {
    return [
      '<div class="hub-students-field-label hub-students-field-label--row">',
      '<span class="hub-students-field-label-text">' + escapeHtml(label) + '</span>',
      hubStudentsFieldManageButtonHtml(label, personFocus),
      '</div>'
    ].join('');
  }

  function hubStudentsFieldBlock(label, values, fallbackSingle, gridClass, layoutMode, personFocus) {
    const items = hubStudentsNormalizeList(values, fallbackSingle);
    const useInline = layoutMode === 'inline' && items.length > 0 && items.length <= 3;
    const valueHtml = !items.length
      ? '<div class="hub-students-field-value">' + escapeHtml('—') + '</div>'
      : (useInline
        ? '<div class="hub-students-inline-values">' + escapeHtml(items.join(' · ')) + '</div>'
        : '<ul class="hub-students-value-list">' + items.map(function (item) {
          return '<li>' + escapeHtml(item) + '</li>';
        }).join('') + '</ul>');
    const extraClass = gridClass ? ' ' + gridClass : '';
    return [
      '<div class="hub-students-field' + extraClass + '">',
      hubStudentsFieldLabelHtml(label, personFocus),
      valueHtml,
      '</div>'
    ].join('');
  }

  function hubStudentsScalarField(label, value, gridClass, personFocus) {
    const extraClass = gridClass ? ' ' + gridClass : '';
    return [
      '<div class="hub-students-field' + extraClass + '">',
      hubStudentsFieldLabelHtml(label, personFocus),
      '<div class="hub-students-field-value">' + escapeHtml(hubStudentsFormatField(value)) + '</div>',
      '</div>'
    ].join('');
  }

  function hubStudentsReadClbSkill(bucket, skill) {
    const src = bucket && typeof bucket === 'object' ? bucket : {};
    const value = String(src[skill] == null ? '' : src[skill]).trim();
    return value || '—';
  }

  function hubStudentsRenderClbSkillGrid(entry) {
    const skills = ['listening', 'speaking', 'reading', 'writing'];
    const headers = skills.map(function (skill) {
      return '<div class="hub-students-clb-skill-h">' + escapeHtml(skill.charAt(0).toUpperCase()) + '</div>';
    }).join('');
    const row = function (label, bucket) {
      const cells = skills.map(function (skill) {
        return '<div class="hub-students-clb-skill-v">' + escapeHtml(hubStudentsReadClbSkill(bucket, skill)) + '</div>';
      }).join('');
      return '<div class="hub-students-clb-row-label">' + escapeHtml(label) + '</div>' + cells;
    };
    return [
      '<div class="hub-students-clb-grid">',
      '<div></div>',
      headers,
      row('Goal', entry?.goal),
      row('Current', entry?.current),
      row('Result', entry?.result),
      '</div>'
    ].join('');
  }

  function hubStudentsStudentRecordUrl(profile) {
    const fromProfile = String(profile?.editUrl || '').trim();
    if (fromProfile) return fromProfile;
    const id = String(profile?.id || '').trim();
    if (!id) return '';
    return '/school/students/edit/' + encodeURIComponent(id);
  }

  function hubStudentsNameLinkHtml(profile) {
    const label = escapeHtml(profile?.name || profile?.id || '');
    const href = hubStudentsStudentRecordUrl(profile);
    if (!href) return '<span>' + label + '</span>';
    return '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer" class="hub-students-hero-name-link">' + label + '</a>';
  }

  function hubStudentsFormatClbEvaluationType(value) {
    const token = String(value || '').trim().toLowerCase();
    if (!token) return '';
    if (token === 'placement_test') return 'Placement test';
    if (token === 'previous_enrollments') return 'Previous enrollment(s)';
    if (token === 'teacher') return 'Teacher';
    return 'Referral';
  }

  function hubStudentsProgramRegToneClass(status, verificationStatus) {
    const statusToken = String(status || '').trim().toLowerCase();
    const verificationToken = String(verificationStatus || '').trim().toLowerCase();
    if (verificationToken === 'voided' || statusToken === 'void' || statusToken === 'cancelled') {
      return 'hub-students-program-reg--void';
    }
    if (statusToken === 'completed') {
      return 'hub-students-program-reg--completed';
    }
    if (statusToken === 'withdrawn' || statusToken === 'rolled_back'
      || verificationToken === 'reversed' || verificationToken === 'rolled_back') {
      return 'hub-students-program-reg--inactive';
    }
    if (['registered', 'draft', 'error'].includes(statusToken)
      || ['draft', 'partial', 'verified', 'pending'].includes(verificationToken)) {
      return 'hub-students-program-reg--active';
    }
    return 'hub-students-program-reg--other';
  }

  function hubStudentsFormatProgramRegStatus(row) {
    const verification = String(row?.verificationStatus || '').trim();
    const status = String(row?.status || '').trim();
    const label = verification && verification !== 'pending' ? verification : status;
    if (!label) return '—';
    return label.replace(/_/g, ' ').replace(/\b\w/g, function (ch) { return ch.toUpperCase(); });
  }

  function hubStudentsFormatProgramRegDate(value) {
    return formatHubDateKey(value, { year: 'numeric', month: 'short', day: 'numeric' })
      || hubStudentsFormatField(value);
  }

  function renderHubStudentsProgramRegListHtml(rows) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    if (!list.length) {
      return '<div class="text-muted small">No program registrations on file.</div>';
    }
    list.sort(function (a, b) {
      const dateCmp = String(b?.registrationDate || '').localeCompare(String(a?.registrationDate || ''));
      if (dateCmp !== 0) return dateCmp;
      return String(a?.programLabel || '').localeCompare(String(b?.programLabel || ''));
    });
    return [
      '<ul class="hub-students-program-reg-list">',
      list.map(function (row) {
        const tone = hubStudentsProgramRegToneClass(row?.status, row?.verificationStatus);
        const regId = String(row?.id || '').trim();
        const manageLink = regId
          ? hubStudentsSideBtnLink('/school/programs/registrations/' + encodeURIComponent(regId), 'Open', 'bi-box-arrow-up-right')
          : '';
        const regDate = row?.registrationDate ? hubStudentsFormatProgramRegDate(row.registrationDate) : '—';
        return [
          '<li class="hub-students-program-reg-item ' + tone + '">',
          '<div class="hub-students-program-reg-main">',
          '<div class="hub-students-program-reg-title">' + escapeHtml(row?.programLabel || row?.programId || 'Program') + '</div>',
          '<div class="hub-students-program-reg-date-line">' + escapeHtml(regDate) + '</div>',
          '<div class="hub-students-program-reg-meta">',
          '<span class="hub-students-program-reg-status">' + escapeHtml(hubStudentsFormatProgramRegStatus(row)) + '</span>',
          '</div>',
          '</div>',
          '<div class="hub-students-side-card-actions">' + manageLink + '</div>',
          '</li>'
        ].join('');
      }).join(''),
      '</ul>'
    ].join('');
  }

  function renderHubStudentsProgramRegsCard(profile) {
    const body = document.getElementById('hubStudentsProgramRegsBody');
    if (!body) return;
    if (!profile || !profile.id) {
      body.innerHTML = '';
      return;
    }
    body.innerHTML = renderHubStudentsProgramRegListHtml(profile.programRegistrations);
    requestAnimationFrame(function () {
      hubStudentsSyncCardHeights();
    });
  }

  function setHubStudentsProgramRegsCardLoading() {
    const body = document.getElementById('hubStudentsProgramRegsBody');
    if (!body) return;
    body.innerHTML = [
      '<div class="text-muted small d-flex align-items-center">',
      '<span class="spinner-border spinner-border-sm text-primary me-2" role="status"></span>',
      'Loading program registrations…',
      '</div>'
    ].join('');
  }

  function hubStudentsEnrollmentToneClass(status) {
    const token = String(status || '').trim().toLowerCase();
    if (['active', 'planned', 'to_be_confirmed', 'waiting_list', 'draft'].includes(token)) {
      return 'hub-students-enrollment--active';
    }
    if (token === 'completed') return 'hub-students-enrollment--completed';
    if (['withdrawn', 'cancelled', 'archived', 'void'].includes(token)) {
      return 'hub-students-enrollment--closed';
    }
    return 'hub-students-enrollment--other';
  }

  function hubStudentsCanCloseEnrollment(status) {
    const token = String(status || '').trim().toLowerCase();
    return ['active', 'to_be_confirmed', 'waiting_list', 'draft'].includes(token);
  }

  function hubStudentsFormatEnrollmentStatus(status) {
    const token = String(status || '').trim();
    if (!token) return '—';
    return token.replace(/_/g, ' ').replace(/\b\w/g, function (ch) { return ch.toUpperCase(); });
  }

  function hubStudentsFormatEnrollmentDateRange(row) {
    const start = hubStudentsFormatProgramRegDate(row?.startDate);
    const endRaw = String(row?.endDate || '').trim();
  const end = endRaw ? hubStudentsFormatProgramRegDate(endRaw) : 'Open';
    if (start === '—' && end === 'Open') return '—';
    return start + ' → ' + end;
  }

  function hubStudentsNormalizeClockTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return raw;
    return String(match[1]).padStart(2, '0') + ':' + match[2];
  }

  function hubStudentsEnrollmentValidityRank(status) {
    const tone = hubStudentsEnrollmentToneClass(status);
    if (tone === 'hub-students-enrollment--active') return 0;
    if (tone === 'hub-students-enrollment--completed') return 1;
    if (tone === 'hub-students-enrollment--closed') return 2;
    return 3;
  }

  function hubStudentsSortEnrollments(rows) {
    return (Array.isArray(rows) ? rows : []).slice().sort(function (a, b) {
      const rankDiff = hubStudentsEnrollmentValidityRank(a?.status) - hubStudentsEnrollmentValidityRank(b?.status);
      if (rankDiff !== 0) return rankDiff;
      const timeA = hubStudentsNormalizeClockTime(a?.sessionStartTime);
      const timeB = hubStudentsNormalizeClockTime(b?.sessionStartTime);
      if (timeA !== timeB) {
        if (!timeA) return 1;
        if (!timeB) return -1;
        return timeA.localeCompare(timeB);
      }
      const titleA = String(a?.classTitle || a?.classId || '');
      const titleB = String(b?.classTitle || b?.classId || '');
      return titleA.localeCompare(titleB);
    });
  }

  function renderHubStudentsEnrollmentListHtml(rows) {
    const list = hubStudentsSortEnrollments(rows);
    if (!list.length) {
      return '<div class="text-muted small">No class enrollments on file.</div>';
    }
    const canEdit = hubStudentsCanEditClb();
    return [
      '<ul class="hub-students-enrollment-list">',
      list.map(function (row) {
        const tone = hubStudentsEnrollmentToneClass(row?.status);
        const periodId = String(row?.id || '').trim();
        const subParts = [
          row?.programLabel ? escapeHtml(row.programLabel) : '',
          row?.termLabel ? escapeHtml(row.termLabel) : ''
        ].filter(Boolean).join(' · ');
        const closeBtn = (canEdit && hubStudentsCanCloseEnrollment(row?.status))
          ? hubStudentsSideBtnAction('Close', 'data-hub-students-close-enrollment="' + escapeHtml(periodId) + '"', 'secondary')
          : '';
        const openLink = row?.editUrl
          ? hubStudentsSideBtnLink(row.editUrl, 'Open', 'bi-box-arrow-up-right')
          : '';
        const dateRange = hubStudentsFormatEnrollmentDateRange(row);
        const teacherName = String(row?.teacherName || '').trim() || '—';
        return [
          '<li class="hub-students-enrollment-item ' + tone + '">',
          '<div class="hub-students-enrollment-main">',
          '<div class="hub-students-enrollment-title">' + escapeHtml(row?.classTitle || row?.classId || 'Class') + '</div>',
          subParts ? '<div class="hub-students-enrollment-sub">' + subParts + '</div>' : '',
          '<div class="hub-students-enrollment-date-line">' + escapeHtml(dateRange) + '</div>',
          '<div class="hub-students-enrollment-meta">',
          '<span class="hub-students-enrollment-status">' + escapeHtml(hubStudentsFormatEnrollmentStatus(row?.status)) + '</span>',
          row?.subjectLabel ? '<span>' + escapeHtml(row.subjectLabel) + '</span>' : '',
          '</div>',
          '</div>',
          '<div class="hub-students-enrollment-teacher-col">',
          '<div class="hub-students-enrollment-teacher-name">' + escapeHtml(teacherName) + '</div>',
          row?.sessionTimeLabel
            ? '<div class="hub-students-enrollment-session-time">' + escapeHtml(row.sessionTimeLabel) + '</div>'
            : '',
          '</div>',
          '<div class="hub-students-side-card-actions hub-students-enrollment-actions">',
          closeBtn,
          openLink,
          '</div>',
          '</li>'
        ].join('');
      }).join(''),
      '</ul>'
    ].join('');
  }

  function renderHubStudentsEnrollmentsCard(profile) {
    const body = document.getElementById('hubStudentsEnrollmentsBody');
    if (!body) return;
    if (!profile || !profile.id) {
      body.innerHTML = '';
      return;
    }
    body.innerHTML = renderHubStudentsEnrollmentListHtml(profile.classEnrollments);
    requestAnimationFrame(function () {
      hubStudentsSyncCardHeights();
    });
  }

  function setHubStudentsEnrollmentsCardLoading() {
    const body = document.getElementById('hubStudentsEnrollmentsBody');
    if (!body) return;
    body.innerHTML = [
      '<div class="text-muted small d-flex align-items-center">',
      '<span class="spinner-border spinner-border-sm text-primary me-2" role="status"></span>',
      'Loading enrollments…',
      '</div>'
    ].join('');
  }

  function resolveHubStudentsBrandLogoUrl() {
    const cssLogo = global.getComputedStyle
      ? global.getComputedStyle(document.documentElement).getPropertyValue('--app-brand-logo-url').trim()
      : '';
    if (cssLogo) {
      return cssLogo.replace(/^url\((['"]?)(.+)\1\)$/i, '$2');
    }
    return '/uploads/GLOBAL/logo/Logo1.png';
  }

  function hubStudentsBorderRand(min, max) {
    return min + Math.random() * (max - min);
  }

  function hubStudentsBorderRandInt(min, max) {
    return Math.floor(hubStudentsBorderRand(min, max + 0.999));
  }

  const HUB_STUDENTS_LOGO_LIGHT_BOUNDS = { min: 14, max: 86 };
  const HUB_STUDENTS_LOGO_LIGHT_SPEED = 0.92;

  function hubStudentsCreateBorderLightSpot(colorIndex) {
    const bounds = HUB_STUDENTS_LOGO_LIGHT_BOUNDS;
    return {
      colorIndex: colorIndex % HUB_STUDENTS_BORDER_LIGHT_COLORS.length,
      x: hubStudentsBorderRand(bounds.min, bounds.max),
      y: hubStudentsBorderRand(bounds.min, bounds.max),
      vx: hubStudentsBorderRand(-0.022, 0.022),
      vy: hubStudentsBorderRand(-0.022, 0.022),
      wobblePhase: Math.random() * Math.PI * 2,
      wobbleAmp: hubStudentsBorderRand(0.35, 1.4),
      wobbleSpeed: hubStudentsBorderRand(0.00055, 0.0016),
      size: hubStudentsBorderRand(0.65, 1.1)
    };
  }

  function hubStudentsStopBorderLights() {
    if (hubStudentsBorderLightsRaf) {
      cancelAnimationFrame(hubStudentsBorderLightsRaf);
      hubStudentsBorderLightsRaf = 0;
    }
    if (hubStudentsBorderLightsState && hubStudentsBorderLightsState.countTimer) {
      clearTimeout(hubStudentsBorderLightsState.countTimer);
    }
    hubStudentsBorderLightsState = null;
  }

  function hubStudentsBorderLightsScheduleCountTick(state) {
    if (!state) return;
    state.countTimer = setTimeout(function () {
      if (hubStudentsBorderLightsState !== state) return;
      hubStudentsBorderLightsAdjustCount(state);
      hubStudentsBorderLightsScheduleCountTick(state);
    }, hubStudentsBorderRand(1800, 3200));
  }

  function hubStudentsBorderLightsAdjustCount(state) {
    const n = state.spots.length;
    const pickColor = function () {
      return hubStudentsBorderRandInt(0, HUB_STUDENTS_BORDER_LIGHT_COLORS.length - 1);
    };
    const addSpot = function () {
      if (state.spots.length >= 7) return;
      state.spots.push(hubStudentsCreateBorderLightSpot(pickColor()));
      const el = document.createElement('span');
      el.className = 'hub-students-empty-hero-border-light';
      el.style.opacity = '0';
      state.layer.appendChild(el);
      state.spotEls.push(el);
      requestAnimationFrame(function () {
        el.style.opacity = '1';
      });
    };
    const removeSpot = function () {
      if (state.spots.length <= 3) return;
      const idx = hubStudentsBorderRandInt(0, state.spots.length - 1);
      const el = state.spotEls[idx];
      if (el) {
        el.style.opacity = '0';
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 420);
      }
      state.spots.splice(idx, 1);
      state.spotEls.splice(idx, 1);
    };
    if (n < 3) {
      addSpot();
      return;
    }
    const target = hubStudentsBorderRandInt(3, 7);
    if (n < target) addSpot();
    else if (n > target) removeSpot();
    else if (Math.random() < 0.55) {
      if (Math.random() < 0.5 && n > 3) removeSpot();
      else if (n < 7) addSpot();
    }
  }

  function hubStudentsClampLogoLight(spot) {
    const bounds = HUB_STUDENTS_LOGO_LIGHT_BOUNDS;
    if (spot.x < bounds.min) {
      spot.x = bounds.min;
      spot.vx = Math.abs(spot.vx || 0.012) * hubStudentsBorderRand(0.65, 1.05);
    } else if (spot.x > bounds.max) {
      spot.x = bounds.max;
      spot.vx = -Math.abs(spot.vx || 0.012) * hubStudentsBorderRand(0.65, 1.05);
    }
    if (spot.y < bounds.min) {
      spot.y = bounds.min;
      spot.vy = Math.abs(spot.vy || 0.012) * hubStudentsBorderRand(0.65, 1.05);
    } else if (spot.y > bounds.max) {
      spot.y = bounds.max;
      spot.vy = -Math.abs(spot.vy || 0.012) * hubStudentsBorderRand(0.65, 1.05);
    }
  }

  function hubStudentsStartBorderLights(wrap) {
    if (!wrap || wrap.classList.contains('is-loading')) return;
    hubStudentsStopBorderLights();
    const layer = wrap.querySelector('.hub-students-empty-hero-border-lights');
    if (!layer) return;
    layer.innerHTML = '';
    const spots = [];
    const spotEls = [];
    const startCount = hubStudentsBorderRandInt(3, 7);
    for (let i = 0; i < startCount; i++) {
      spots.push(hubStudentsCreateBorderLightSpot(hubStudentsBorderRandInt(0, HUB_STUDENTS_BORDER_LIGHT_COLORS.length - 1)));
      const el = document.createElement('span');
      el.className = 'hub-students-empty-hero-border-light';
      layer.appendChild(el);
      spotEls.push(el);
    }
    const state = {
      wrap: wrap,
      layer: layer,
      spots: spots,
      spotEls: spotEls,
      lastTime: 0,
      countTimer: null
    };
    hubStudentsBorderLightsState = state;
    hubStudentsBorderLightsScheduleCountTick(state);
    const tick = function (now) {
      if (hubStudentsBorderLightsState !== state) return;
      const dt = state.lastTime ? Math.min(now - state.lastTime, 48) : 16;
      state.lastTime = now;
      const moveScale = HUB_STUDENTS_LOGO_LIGHT_SPEED * dt;
      spots.forEach(function (spot, i) {
        if (Math.random() < 0.0045) {
          spot.vx = hubStudentsBorderRand(-0.026, 0.026);
          spot.vy = hubStudentsBorderRand(-0.026, 0.026);
        }
        spot.x += spot.vx * moveScale;
        spot.y += spot.vy * moveScale;
        hubStudentsClampLogoLight(spot);
        const wobbleX = Math.sin(spot.wobblePhase + now * spot.wobbleSpeed) * spot.wobbleAmp;
        const wobbleY = Math.cos((spot.wobblePhase * 1.25) + now * spot.wobbleSpeed) * spot.wobbleAmp;
        spot.wobblePhase += spot.wobbleSpeed * dt;
        const color = HUB_STUDENTS_BORDER_LIGHT_COLORS[spot.colorIndex];
        const el = spotEls[i];
        if (!el) return;
        el.style.left = (spot.x + wobbleX) + '%';
        el.style.top = (spot.y + wobbleY) + '%';
        el.style.setProperty('--hub-light-core', color.core);
        el.style.setProperty('--hub-light-glow', color.glow);
        el.style.transform = 'translate(-50%, -50%) scale(' + spot.size.toFixed(3) + ')';
      });
      hubStudentsBorderLightsRaf = requestAnimationFrame(tick);
    };
    hubStudentsBorderLightsRaf = requestAnimationFrame(tick);
  }

  function hubStudentsSyncEmptyHeroBorderLights() {
    const emptyHero = document.getElementById('hubStudentsEmptyHero');
    if (!emptyHero || emptyHero.classList.contains('d-none')) {
      hubStudentsStopBorderLights();
      return;
    }
    if (emptyHero.classList.contains('hub-students-empty-hero-page--loading')) {
      hubStudentsStopBorderLights();
      return;
    }
    const wrap = emptyHero.querySelector('.hub-students-empty-hero-logo-wrap');
    if (wrap && !wrap.classList.contains('is-loading')) {
      hubStudentsStartBorderLights(wrap);
    }
  }

  function renderHubStudentsEmptyHero() {
    const host = document.getElementById('hubStudentsEmptyHero');
    if (!host) return;
    const logoUrl = resolveHubStudentsBrandLogoUrl();
    host.innerHTML = [
      '<div class="hub-students-empty-hero-logo-wrap" aria-hidden="true">',
      '<span class="hub-students-empty-hero-logo-core">',
      '<div class="hub-students-empty-hero-border-lights" aria-hidden="true"></div>',
      logoUrl
        ? '<img class="hub-students-empty-hero-logo" src="' + escapeHtml(logoUrl) + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling?.classList.remove(\'d-none\');">'
        : '',
      '<i class="bi bi-mortarboard hub-students-empty-hero-fallback' + (logoUrl ? ' d-none' : '') + '"></i>',
      '</span>',
      '<div class="hub-students-empty-hero-loading d-none" aria-live="polite">',
      '<span class="spinner-border spinner-border-sm text-primary hub-students-empty-hero-loading-spinner" role="status" aria-hidden="true"></span>',
      '<span class="hub-students-empty-hero-loading-text">Loading student…</span>',
      '</div>',
      '</div>'
    ].join('');
    hubStudentsSyncEmptyHeroBorderLights();
  }

  function setHubStudentsWorkspaceView(view) {
    const mode = view === 'student' || view === 'logo-loading' || view === 'logo' ? view : (view ? 'student' : 'logo');
    const emptyHero = document.getElementById('hubStudentsEmptyHero');
    const cardStack = document.getElementById('hubStudentsCardStack');
    const programCard = document.getElementById('hubStudentsProgramRegsCard');
    const enrollmentsCard = document.getElementById('hubStudentsEnrollmentsCard');
    const showStudent = mode === 'student';
    const showLogo = mode === 'logo' || mode === 'logo-loading';
    if (emptyHero) {
      emptyHero.classList.toggle('d-none', !showLogo);
      emptyHero.classList.toggle('hub-students-empty-hero-page--loading', mode === 'logo-loading');
      const loadingEl = emptyHero.querySelector('.hub-students-empty-hero-loading');
      if (loadingEl) loadingEl.classList.toggle('d-none', mode !== 'logo-loading');
      const logoWrap = emptyHero.querySelector('.hub-students-empty-hero-logo-wrap');
      if (logoWrap) logoWrap.classList.toggle('is-loading', mode === 'logo-loading');
      hubStudentsSyncEmptyHeroBorderLights();
    } else {
      hubStudentsStopBorderLights();
    }
    if (cardStack) cardStack.classList.toggle('d-none', !showStudent);
    if (programCard) programCard.classList.toggle('d-none', !showStudent);
    if (enrollmentsCard) enrollmentsCard.classList.toggle('d-none', !showStudent);
    requestAnimationFrame(function () {
      hubStudentsSyncCardHeights();
    });
  }

  function setHubStudentsWorkspaceSelectionState(hasStudent) {
    setHubStudentsWorkspaceView(hasStudent ? 'student' : 'logo');
    hubStudentsUpdateQuickActionsState(hasStudent);
  }

  let hubStudentsPendingDateRangeTool = '';
  const HUB_STUDENTS_EMBED_QUERY = 'smEmbed';

  function hubStudentsWithEmbedParams(params) {
    const bag = params instanceof URLSearchParams ? params : new URLSearchParams(params || '');
    bag.set(HUB_STUDENTS_EMBED_QUERY, '1');
    return bag;
  }

  function hubStudentsGetQuickActionButtons() {
    return Array.from(document.querySelectorAll('[data-hub-students-open]'));
  }

  function hubStudentsUpdateQuickActionsState(hasStudent) {
    hubStudentsGetQuickActionButtons().forEach(function (btn) {
      btn.disabled = !hasStudent;
    });
  }

  function hubStudentsRequireSelectedProfile() {
    const profile = hubStudentsActiveProfile;
    if (profile && profile.id) return profile;
    void hubStudentsShowSimpleMsg('Select a student', 'info', 'Search for and select a student before opening this tool.');
    return null;
  }

  function hubStudentsFormatDateLocal(d) {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
    const shortcuts = global.SchoolDateRangeShortcuts;
    if (shortcuts && typeof shortcuts.formatDateLocal === 'function') {
      return shortcuts.formatDateLocal(d);
    }
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function hubStudentsPriorMonthsRange(monthCount) {
    const n = Number(monthCount);
    if (!Number.isFinite(n) || n < 1) return { startDate: '', endDate: '' };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today.getFullYear(), today.getMonth() - n, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return {
      startDate: hubStudentsFormatDateLocal(start),
      endDate: hubStudentsFormatDateLocal(end)
    };
  }

  function hubStudentsDatesFromRangeToken(token) {
    const key = String(token || '').trim();
    if (key === 'last-2-months') return hubStudentsPriorMonthsRange(2);
    if (key === 'last-3-months') return hubStudentsPriorMonthsRange(3);
    if (key === 'last-6-months') return hubStudentsPriorMonthsRange(6);
    const shortcuts = global.SchoolDateRangeShortcuts;
    if (shortcuts && typeof shortcuts.datesFromRangeToken === 'function') {
      const resolved = shortcuts.datesFromRangeToken(key);
      return {
        startDate: String(resolved?.startDate || '').trim(),
        endDate: String(resolved?.endDate || '').trim()
      };
    }
    return { startDate: '', endDate: '' };
  }

  function hubStudentsBuildAttendanceReportUrl(studentRecordId, startDate, endDate) {
    const params = hubStudentsWithEmbedParams();
    params.set('studentIds', String(studentRecordId || '').trim());
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    return '/school/attendances/report?' + params.toString();
  }

  function hubStudentsBuildClassConductReportUrl(studentRecordId, startDate, endDate) {
    const params = hubStudentsWithEmbedParams();
    params.set('studentIds', String(studentRecordId || '').trim());
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    return '/school/class-conduct-report?' + params.toString();
  }

  function hubStudentsBuildGradesMatrixUrl() {
    return '/school/grades-matrix?' + hubStudentsWithEmbedParams().toString();
  }

  function hubStudentsBuildPersonReportsUrl(personId) {
    const params = hubStudentsWithEmbedParams();
    params.set('personId', String(personId || '').trim());
    return '/school/reports/person-reports?' + params.toString();
  }

  function hubStudentsBuildSessionCasesUrl(personId, startDate, endDate) {
    const params = hubStudentsWithEmbedParams();
    const pid = String(personId || '').trim();
    if (pid) params.set('studentPersonId', pid);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    return '/school/session-student-cases?' + params.toString();
  }

  function hubStudentsSetEmbedLoading(visible) {
    const loading = document.getElementById('hubStudentsEmbedLoading');
    if (!loading) return;
    loading.classList.toggle('is-hidden', !visible);
  }

  function hubStudentsOpenEmbedModal(title, url) {
    const modalEl = document.getElementById('hubStudentsEmbedModal');
    const frame = document.getElementById('hubStudentsEmbedFrame');
    const titleEl = document.getElementById('hubStudentsEmbedModalLabel');
    if (!modalEl || !frame || !url) return;
    if (titleEl) titleEl.textContent = String(title || 'School tool').trim() || 'School tool';
    hubStudentsSetEmbedLoading(true);
    frame.onload = function () {
      hubStudentsSetEmbedLoading(false);
    };
    frame.src = url;
    hubStudentsShowModal(modalEl);
  }

  function hubStudentsApplyDateRangeToken(token) {
    const dates = hubStudentsDatesFromRangeToken(token);
    const startEl = document.getElementById('hubStudentsDateRangeStart');
    const endEl = document.getElementById('hubStudentsDateRangeEnd');
    if (startEl) startEl.value = String(dates.startDate || '').trim();
    if (endEl) endEl.value = String(dates.endDate || '').trim();
    const shortcuts = document.getElementById('hubStudentsDateRangeShortcuts');
    if (shortcuts) {
      shortcuts.querySelectorAll('[data-hub-students-range-token]').forEach(function (btn) {
        const isActive = String(btn.getAttribute('data-hub-students-range-token') || '') === String(token || '');
        btn.classList.toggle('active', isActive);
        btn.classList.toggle('btn-secondary', isActive);
        btn.classList.toggle('btn-outline-secondary', !isActive);
      });
    }
  }

  function hubStudentsOpenDateRangePicker(toolKey, modalTitle) {
    hubStudentsPendingDateRangeTool = String(toolKey || '').trim();
    const modalEl = document.getElementById('hubStudentsDateRangeModal');
    const labelEl = document.getElementById('hubStudentsDateRangeModalLabel');
    const errorEl = document.getElementById('hubStudentsDateRangeError');
    if (labelEl) labelEl.textContent = modalTitle || 'Choose date range';
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.classList.add('d-none');
    }
    hubStudentsApplyDateRangeToken('m0-full');
    hubStudentsShowModal(modalEl);
  }

  function hubStudentsReadDateRangeFields() {
    const startEl = document.getElementById('hubStudentsDateRangeStart');
    const endEl = document.getElementById('hubStudentsDateRangeEnd');
    return {
      startDate: String(startEl?.value || '').trim(),
      endDate: String(endEl?.value || '').trim()
    };
  }

  function hubStudentsConfirmDateRangeOpen() {
    const profile = hubStudentsRequireSelectedProfile();
    if (!profile) return;
    const range = hubStudentsReadDateRangeFields();
    const errorEl = document.getElementById('hubStudentsDateRangeError');
    if (!range.startDate || !range.endDate) {
      if (errorEl) {
        errorEl.textContent = 'Choose both a start date and an end date.';
        errorEl.classList.remove('d-none');
      }
      return;
    }
    if (range.startDate > range.endDate) {
      if (errorEl) {
        errorEl.textContent = 'The start date must be on or before the end date.';
        errorEl.classList.remove('d-none');
      }
      return;
    }
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.classList.add('d-none');
    }
    const studentId = String(profile.id || '').trim();
    let url = '';
    let title = '';
    if (hubStudentsPendingDateRangeTool === 'attendance-report') {
      url = hubStudentsBuildAttendanceReportUrl(studentId, range.startDate, range.endDate);
      title = 'Student attendance report';
    } else if (hubStudentsPendingDateRangeTool === 'class-conduct-report') {
      url = hubStudentsBuildClassConductReportUrl(studentId, range.startDate, range.endDate);
      title = 'Class conduct report';
    } else {
      void hubStudentsShowSimpleMsg('Unavailable', 'warning', 'This tool is not configured.');
      return;
    }
    const dateModal = document.getElementById('hubStudentsDateRangeModal');
    if (dateModal && global.bootstrap?.Modal) {
      const inst = global.bootstrap.Modal.getInstance(dateModal);
      if (inst) inst.hide();
    }
    hubStudentsOpenEmbedModal(title, url);
  }

  function hubStudentsHandleQuickOpen(toolKey) {
    const key = String(toolKey || '').trim();
    const profile = hubStudentsRequireSelectedProfile();
    if (!profile) return;
    if (key === 'attendance-report') {
      hubStudentsOpenDateRangePicker('attendance-report', 'Attendance — date range');
      return;
    }
    if (key === 'class-conduct-report') {
      hubStudentsOpenDateRangePicker('class-conduct-report', 'Class conduct — date range');
      return;
    }
    if (key === 'grades-matrix') {
      hubStudentsOpenEmbedModal('Grades matrix', hubStudentsBuildGradesMatrixUrl());
      return;
    }
    if (key === 'person-reports') {
      const personId = String(profile.personId || '').trim();
      if (!personId) {
        void hubStudentsShowSimpleMsg('Unavailable', 'warning', 'This student does not have a linked person profile.');
        return;
      }
      hubStudentsOpenEmbedModal('Reports', hubStudentsBuildPersonReportsUrl(personId));
      return;
    }
    if (key === 'session-cases') {
      const personId = String(profile.personId || '').trim();
      const month = hubStudentsDatesFromRangeToken('m0-full');
      hubStudentsOpenEmbedModal(
        'Student cases',
        hubStudentsBuildSessionCasesUrl(personId, month.startDate, month.endDate)
      );
      return;
    }
    if (key === 'referral-links') {
      const label = String(profile.name || profile.id).trim();
      if (global.StudentReferralLinksManager) {
        global.StudentReferralLinksManager.open({
          studentId: profile.id,
          studentLabel: label,
          onSaved: function () {
            return loadHubStudentProfile(profile.id);
          }
        });
      }
      return;
    }
    if (key === 'timeline') {
      void hubStudentsOpenTimelineModal();
      return;
    }
  }

  let hubStudentsTimelineModalBound = false;

  function hubStudentsHideTimelineModal() {
    const modalEl = document.getElementById('hubStudentsTimelineModal');
    if (!modalEl || !global.bootstrap?.Modal) return;
    const inst = global.bootstrap.Modal.getInstance(modalEl);
    if (inst) inst.hide();
  }

  function hubStudentsTimelineTypeClass(type) {
    const token = String(type || '').trim().toLowerCase();
    if (token.indexOf('class_enrollment') === 0 || token === 'student_enrollment_start') {
      return 'hub-students-timeline-type--enrollment';
    }
    if (token.indexOf('clb') === 0) return 'hub-students-timeline-type--clb';
    if (token.indexOf('referral') === 0) return 'hub-students-timeline-type--referral';
    if (token.indexOf('report') === 0) return 'hub-students-timeline-type--report';
    if (token.indexOf('session_case') === 0 || token.indexOf('case') === 0) {
      return 'hub-students-timeline-type--case';
    }
    if (token.indexOf('activity') === 0) return 'hub-students-timeline-type--activity';
    if (token.indexOf('registration') >= 0) return 'hub-students-timeline-type--registration';
    return 'hub-students-timeline-type--registration';
  }

  function hubStudentsTimelineParseDate(iso) {
    const text = String(iso || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const parts = text.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function hubStudentsTimelinePositionPercent(dateText, minDate, maxDate) {
    const date = hubStudentsTimelineParseDate(dateText);
    const min = hubStudentsTimelineParseDate(minDate);
    const max = hubStudentsTimelineParseDate(maxDate);
    if (!date || !min || !max) return 50;
    if (min.getTime() === max.getTime()) return 50;
    const span = max.getTime() - min.getTime();
    const offset = date.getTime() - min.getTime();
    const pct = (offset / span) * 100;
    return Math.min(100, Math.max(0, pct));
  }

  function hubStudentsEncodeTimelineAction(action) {
    try {
      return escapeHtml(JSON.stringify(action && typeof action === 'object' ? action : {}));
    } catch (error) {
      return escapeHtml('{}');
    }
  }

  function hubStudentsTimelineLoadUi(active) {
    const wrap = document.getElementById('hubStudentsTimelineWrap');
    const track = document.getElementById('hubStudentsTimelineTrack');
    const status = document.getElementById('hubStudentsTimelineLoadStatus');
    const hint = wrap ? wrap.querySelector('.hub-students-timeline-adjust-hint') : null;
    const legend = wrap ? wrap.querySelector('.hub-students-timeline-legend') : null;
    const truncated = document.getElementById('hubStudentsTimelineTruncated');
    if (wrap) wrap.classList.toggle('hub-students-timeline-wrap--loading', active);
    if (track) track.classList.toggle('is-loading', active);
    if (status) status.classList.toggle('d-none', !active);
    if (hint) hint.classList.toggle('d-none', active);
    if (legend) legend.classList.toggle('d-none', active);
    if (truncated && active) truncated.classList.add('d-none');
  }

  function hubStudentsUpdateTimelineAxisProgress(percent, note) {
    const pct = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
    const track = document.getElementById('hubStudentsTimelineTrack');
    const status = document.getElementById('hubStudentsTimelineLoadStatus');
    if (track) track.style.setProperty('--axis-progress', String(pct));
    if (status) status.textContent = String(pct) + '% · ' + String(note || '');
  }

  function hubStudentsSetTimelineLoading(visible) {
    hubStudentsTimelineLoadUi(visible);
    if (visible) hubStudentsUpdateTimelineAxisProgress(0, 'Starting…');
  }

  function hubStudentsTimelineLoadingYield() {
    return new Promise(function (resolve) {
      if (typeof global.requestAnimationFrame === 'function') {
        global.requestAnimationFrame(resolve);
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  function hubStudentsTimelineForcePaint() {
    return hubStudentsTimelineLoadingYield().then(function () {
      return new Promise(function (resolve) {
        setTimeout(resolve, 16);
      });
    });
  }

  async function hubStudentsFetchTimelineWithProgress(studentId) {
    const fetchNotes = [
      'Loading enrollments, CLB, reports, and related events…',
      'Loading referrals, activities, and cases…',
      'Waiting for server response…'
    ];
    let creepPct = 28;
    let noteIdx = 0;
    hubStudentsUpdateTimelineAxisProgress(creepPct, fetchNotes[noteIdx]);
    await hubStudentsTimelineForcePaint();
    const creepTimer = setInterval(function () {
      if (creepPct >= 38) return;
      creepPct += 1;
      noteIdx = (noteIdx + 1) % fetchNotes.length;
      hubStudentsUpdateTimelineAxisProgress(creepPct, fetchNotes[noteIdx]);
    }, 400);
    try {
      return await hubStudentsFetchTimeline(studentId);
    } finally {
      clearInterval(creepTimer);
    }
  }

  function hubStudentsTimelineBucketKey(percent) {
    return Number(percent).toFixed(3);
  }

  const HUB_TIMELINE_STEM_BASE_PX = 56;
  const HUB_TIMELINE_STEM_STEP_PX = 52;
  const HUB_TIMELINE_EVENT_CARD_APPROX_PX = 52;
  const HUB_TIMELINE_ELBOW_BASE_PX = 22;
  const HUB_TIMELINE_ELBOW_STEP_PX = 18;
  const HUB_TIMELINE_ELBOW_LEFT_INDENT_PX = 8;
  const HUB_TIMELINE_ELBOW_CROWD_PX = 10;
  const HUB_TIMELINE_ELBOW_APPROX_PX = 56;
  const HUB_TIMELINE_MAX_BELOW_PER_BUCKET = 2;
  const HUB_TIMELINE_AXIS_WIDTH_RATIO = 0.95;
  const HUB_TIMELINE_AXIS_EDGE_PAD_PCT = 2.5;
  const HUB_TIMELINE_EDGE_RIGHT_PCT = 86;
  const HUB_TIMELINE_EDGE_LEFT_PCT = 14;
  const HUB_TIMELINE_EDGE_MAX_EFFECTIVE_PCT = 95.5;
  const HUB_TIMELINE_CARD_WIDTH_PX = 176;
  const HUB_TIMELINE_CARD_HEIGHT_PX = 58;
  const HUB_TIMELINE_STEM_MIN_PX = 40;
  const HUB_TIMELINE_STEM_MAX_PX = 680;
  const HUB_TIMELINE_ELBOW_MAX_PX = 280;
  const HUB_TIMELINE_ELBOW_MIN_PX = 0;

  function hubStudentsTimelineResolveElbowPx(value, fallbackPx) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.max(HUB_TIMELINE_ELBOW_MIN_PX, n);
    return fallbackPx == null ? HUB_TIMELINE_ELBOW_BASE_PX : fallbackPx;
  }
  const HUB_TIMELINE_LAYOUT_PREFS_PREFIX = 'hubStudentsTimelineLayout:';
  const HUB_TIMELINE_DRAG_CLICK_PX = 8;
  const HUB_TIMELINE_STEM_FIRST_ON_DATE_PX = 48;
  const HUB_TIMELINE_ELBOW_DRAG_SCALE = 0.95;

  let hubStudentsTimelineLiveLayouts = null;
  let hubStudentsTimelineActiveStudentId = '';
  let hubStudentsTimelineDragState = null;

  function hubStudentsTimelineDisplayPercent(percent, nudgePercent) {
    const raw = Math.min(100, Math.max(0, Number(percent) || 0))
      + (Number(nudgePercent) || 0);
    const p = Math.min(100, Math.max(0, raw));
    const pad = HUB_TIMELINE_AXIS_EDGE_PAD_PCT;
    return pad + (p * (100 - pad * 2) / 100);
  }

  function hubStudentsTimelineLayoutEffectivePercent(layout) {
    return Number(layout?.percent) || 0;
  }

  function hubStudentsTimelineMarkerAnchorPercent(layout) {
    return hubStudentsTimelineDisplayPercent(layout?.percent, 0);
  }

  function hubStudentsTimelineSignedElbow(branchSide, elbowPx) {
    const elbow = hubStudentsTimelineResolveElbowPx(elbowPx, 0);
    return branchSide === 'left' ? -elbow : elbow;
  }

  function hubStudentsTimelineApplySignedElbowDrag(layout, startSignedElbow, dx, limits) {
    const cap = limits.elbowMax;
    const signed = startSignedElbow + dx * HUB_TIMELINE_ELBOW_DRAG_SCALE;
    if (signed >= 0) {
      layout.branchSide = 'right';
      layout.elbowWPx = Math.min(cap, Math.max(HUB_TIMELINE_ELBOW_MIN_PX, Math.round(signed)));
    } else {
      layout.branchSide = 'left';
      layout.elbowWPx = Math.min(cap, Math.max(HUB_TIMELINE_ELBOW_MIN_PX, Math.round(-signed)));
    }
  }

  function hubStudentsTimelineSignedStem(side, stemLen) {
    const stem = Math.max(0, Number(stemLen) || 0);
    return side === 'above' ? -stem : stem;
  }

  function hubStudentsTimelineApplySignedStemDrag(layout, drag, dy, limits, clientY) {
    const cap = limits.stemMax;
    const signed = drag.startSignedStem + dy;
    const prevSide = drag.startSide === 'above' ? 'above' : 'below';
    if (signed >= 0) {
      layout.side = 'below';
      layout.stemLen = Math.min(cap, Math.max(0, Math.round(signed)));
    } else {
      layout.side = 'above';
      layout.stemLen = Math.min(cap, Math.max(0, Math.round(-signed)));
    }
    const sideFlipped = layout.side !== prevSide;
    if (sideFlipped) {
      drag.startSide = layout.side;
      drag.startSignedStem = hubStudentsTimelineSignedStem(layout.side, layout.stemLen);
      drag.startStemLen = layout.stemLen;
      drag.startY = clientY;
    }
    return sideFlipped;
  }

  function hubStudentsTimelineDragLimits(track) {
    const scroll = track && track.parentElement;
    const viewH = scroll && scroll.clientHeight > 0 ? scroll.clientHeight : 520;
    const stemMax = Math.min(
      HUB_TIMELINE_STEM_MAX_PX,
      Math.max(360, Math.floor(viewH * 0.48))
    );
    const elbowMax = Math.min(HUB_TIMELINE_ELBOW_MAX_PX, Math.max(220, Math.floor(viewH * 0.22)));
    return { stemMax: stemMax, elbowMax: elbowMax, viewH: viewH };
  }

  function hubStudentsTimelineLayoutPrefsKey(studentId) {
    return HUB_TIMELINE_LAYOUT_PREFS_PREFIX + String(studentId || '').trim();
  }

  function hubStudentsLoadTimelineLayoutPrefs(studentId) {
    try {
      const raw = global.localStorage.getItem(hubStudentsTimelineLayoutPrefsKey(studentId));
      if (!raw) return {};
      const bag = JSON.parse(raw);
      return bag && typeof bag === 'object' ? bag : {};
    } catch (error) {
      return {};
    }
  }

  function hubStudentsSaveTimelineLayoutPref(studentId, eventId, patch) {
    const id = String(eventId || '').trim();
    const sid = String(studentId || '').trim();
    if (!id || !sid || !patch || typeof patch !== 'object') return;
    const bag = hubStudentsLoadTimelineLayoutPrefs(sid);
    bag[id] = Object.assign({}, bag[id] || {}, patch);
    try {
      global.localStorage.setItem(hubStudentsTimelineLayoutPrefsKey(sid), JSON.stringify(bag));
    } catch (error) { /* quota */ }
  }

  function hubStudentsApplyTimelineLayoutPrefs(layouts, studentId) {
    const prefs = hubStudentsLoadTimelineLayoutPrefs(studentId);
    return (Array.isArray(layouts) ? layouts : []).map(function (layout) {
      const eventId = String(layout?.event?.id || '').trim();
      const pref = eventId ? prefs[eventId] : null;
      if (!pref) return layout;
      const next = Object.assign({}, layout);
      if (pref.side === 'above' || pref.side === 'below') next.side = pref.side;
      if (pref.branchSide === 'left' || pref.branchSide === 'right') next.branchSide = pref.branchSide;
      if (Number.isFinite(Number(pref.stemLen))) next.stemLen = Number(pref.stemLen);
      if (Number.isFinite(Number(pref.elbowWPx))) next.elbowWPx = Number(pref.elbowWPx);
      if (pref.manual === true) {
        next.manualLayout = true;
        next.axisNudgePercent = 0;
      } else if (Number.isFinite(Number(pref.axisNudgePercent))) {
        next.axisNudgePercent = Number(pref.axisNudgePercent);
      }
      return next;
    });
  }

  function hubStudentsTimelineOverlapArea(a, b) {
    const left = Math.max(a.x, b.x);
    const right = Math.min(a.x + a.w, b.x + b.w);
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y + a.h, b.y + b.h);
    if (right <= left || bottom <= top) return 0;
    return (right - left) * (bottom - top);
  }

  function hubStudentsTimelineCollectOccupancyRects(layout, trackW) {
    const tw = Math.max(1, Number(trackW) || 960);
    const displayPct = hubStudentsTimelineMarkerAnchorPercent(layout);
    const dotX = (displayPct / 100) * tw;
    const stemLen = Math.max(HUB_TIMELINE_STEM_MIN_PX, Number(layout.stemLen) || HUB_TIMELINE_STEM_BASE_PX);
    const elbowW = hubStudentsTimelineResolveElbowPx(layout.elbowWPx, HUB_TIMELINE_ELBOW_BASE_PX);
    const branchSide = layout.branchSide === 'left' ? 'left' : 'right';
    const side = layout.side === 'above' ? 'above' : 'below';
    const cardW = HUB_TIMELINE_CARD_WIDTH_PX;
    const cardH = HUB_TIMELINE_CARD_HEIGHT_PX;
    const pad = 6;
    const stemRect = {
      x: dotX - 4,
      y: side === 'below' ? 0 : -stemLen,
      w: 8,
      h: stemLen
    };
    let cardX = branchSide === 'right' ? dotX + elbowW - 2 : dotX - elbowW - cardW;
    let cardY = side === 'below' ? stemLen - cardH + 8 : -stemLen - 8;
    const cardRect = { x: cardX, y: cardY, w: cardW, h: cardH + pad };
    return [stemRect, cardRect];
  }

  function hubStudentsTimelineLayoutScore(layout, trackW, placedRects) {
    const rects = hubStudentsTimelineCollectOccupancyRects(layout, trackW);
    let score = 0;
    const bucket = hubStudentsTimelineBucketKey(layout.percent);
    placedRects.forEach(function (placed) {
      rects.forEach(function (rect) {
        const overlap = hubStudentsTimelineOverlapArea(rect, placed);
        score += overlap;
        if (overlap > 0 && placed.bucket === bucket) score += overlap * 1.5;
      });
    });
    const cardRect = rects[1];
    if (cardRect.x < 0) score += Math.abs(cardRect.x) * 12;
    if (cardRect.x + cardRect.w > trackW) score += (cardRect.x + cardRect.w - trackW) * 12;
    score += (Number(layout.stemLen) || 0) * 0.035;
    score += (Number(layout.elbowWPx) || 0) * 0.02;
    return score;
  }

  function hubStudentsTimelineUniqueSortedInts(values, minVal, maxVal) {
    const seen = {};
    const out = [];
    (Array.isArray(values) ? values : []).forEach(function (raw) {
      const n = Math.min(maxVal, Math.max(minVal, Math.round(Number(raw))));
      if (!Number.isFinite(n) || seen[n]) return;
      seen[n] = true;
      out.push(n);
    });
    return out.sort(function (a, b) { return a - b; });
  }

  function hubStudentsTimelineLayoutCandidates(layout) {
    const p = Number(layout.percent) || 0;
    const baseStem = Number(layout.stemLen) || HUB_TIMELINE_STEM_BASE_PX;
    const baseElbow = hubStudentsTimelineResolveElbowPx(layout.elbowWPx, HUB_TIMELINE_ELBOW_BASE_PX);
    const stems = hubStudentsTimelineUniqueSortedInts([
      baseStem,
      baseStem + HUB_TIMELINE_STEM_STEP_PX,
      baseStem + HUB_TIMELINE_STEM_STEP_PX * 2,
      baseStem + HUB_TIMELINE_STEM_STEP_PX * 3,
      baseStem + HUB_TIMELINE_STEM_STEP_PX * 4,
      baseStem - HUB_TIMELINE_STEM_STEP_PX,
      HUB_TIMELINE_STEM_FIRST_ON_DATE_PX,
      HUB_TIMELINE_STEM_BASE_PX + (Number(layout.laneIdx) + 1) * HUB_TIMELINE_STEM_STEP_PX
    ], HUB_TIMELINE_STEM_MIN_PX, HUB_TIMELINE_STEM_MAX_PX);
    const elbows = hubStudentsTimelineUniqueSortedInts([
      0,
      baseElbow,
      baseElbow + HUB_TIMELINE_ELBOW_STEP_PX,
      baseElbow + HUB_TIMELINE_ELBOW_STEP_PX * 2,
      HUB_TIMELINE_ELBOW_BASE_PX,
      HUB_TIMELINE_ELBOW_BASE_PX + (Number(layout.laneIdx) + 1) * HUB_TIMELINE_ELBOW_STEP_PX
    ], HUB_TIMELINE_ELBOW_MIN_PX, HUB_TIMELINE_ELBOW_MAX_PX);
    const preferredBranch = layout.branchSide === 'left' ? 'left' : 'right';
    const altBranch = preferredBranch === 'left' ? 'right' : 'left';
    const branches = [preferredBranch, altBranch];
    const out = [];
    branches.forEach(function (branch) {
      if (p >= HUB_TIMELINE_EDGE_RIGHT_PCT && branch === 'right') return;
      if (p <= HUB_TIMELINE_EDGE_LEFT_PCT && branch === 'left') return;
      stems.forEach(function (stemLen) {
        elbows.forEach(function (elbowWPx) {
          out.push(Object.assign({}, layout, {
            stemLen: stemLen,
            elbowWPx: elbowWPx,
            branchSide: branch,
            axisNudgePercent: 0
          }));
        });
      });
    });
    return out;
  }

  async function hubStudentsOptimizeTimelineLayouts(layouts, trackW, onProgress) {
    const items = (Array.isArray(layouts) ? layouts : []).slice()
      .sort(function (a, b) {
        return Number(a.percent) - Number(b.percent)
          || String(a.event?.id || '').localeCompare(String(b.event?.id || ''));
      });
    const placed = [];
    const tw = Math.max(1, Number(trackW) || 960);
    const total = items.length;
    for (let index = 0; index < items.length; index += 1) {
      const layout = items[index];
      if (layout.manualLayout === true) {
        hubStudentsTimelineCollectOccupancyRects(layout, tw).forEach(function (rect) {
          placed.push(Object.assign({}, rect, {
            bucket: hubStudentsTimelineBucketKey(layout.percent)
          }));
        });
      } else {
        let best = null;
        let bestScore = Infinity;
        hubStudentsTimelineLayoutCandidates(layout).forEach(function (candidate) {
          const score = hubStudentsTimelineLayoutScore(candidate, tw, placed);
          if (score < bestScore) {
            bestScore = score;
            best = candidate;
          }
        });
        const chosen = best || layout;
        Object.assign(layout, {
          stemLen: chosen.stemLen,
          elbowWPx: chosen.elbowWPx,
          branchSide: chosen.branchSide,
          axisNudgePercent: 0
        });
        hubStudentsTimelineCollectOccupancyRects(layout, tw).forEach(function (rect) {
          placed.push(Object.assign({}, rect, {
            bucket: hubStudentsTimelineBucketKey(layout.percent)
          }));
        });
      }
      if (onProgress && (index % 3 === 0 || index === total - 1)) {
        const pct = 80 + Math.round(((index + 1) / Math.max(1, total)) * 10);
        onProgress(pct, 'Organizing cards (stem, indent, and side)…');
        await hubStudentsTimelineForcePaint();
      }
    }
    return hubStudentsClampTimelineEdgeLayouts(items);
  }

  function hubStudentsFindTimelineLayoutByEventId(eventId) {
    const id = String(eventId || '').trim();
    if (!id || !Array.isArray(hubStudentsTimelineLiveLayouts)) return null;
    return hubStudentsTimelineLiveLayouts.find(function (layout) {
      return String(layout?.event?.id || '') === id;
    }) || null;
  }

  function hubStudentsApplyTimelineMarkerLayout(marker, layout) {
    if (!marker || !layout) return;
    const side = layout.side === 'above' ? 'above' : 'below';
    const branchSide = layout.branchSide === 'left' ? 'left' : 'right';
    marker.className = 'hub-students-timeline-marker hub-students-timeline-marker--' + side
      + ' hub-students-timeline-marker--branch-' + branchSide;
    const stemLen = Math.round(Number(layout.stemLen) || HUB_TIMELINE_STEM_BASE_PX);
    const elbowWPx = Math.round(hubStudentsTimelineResolveElbowPx(layout.elbowWPx, HUB_TIMELINE_ELBOW_BASE_PX));
    marker.style.left = String(hubStudentsTimelineMarkerAnchorPercent(layout)) + '%';
    marker.style.setProperty('--stem-len', String(stemLen) + 'px');
    marker.style.setProperty('--elbow-w', String(elbowWPx) + 'px');
    const elbow = marker.querySelector('.hub-students-timeline-elbow');
    if (elbow) {
      elbow.className = 'hub-students-timeline-elbow hub-students-timeline-elbow--' + side
        + ' hub-students-timeline-elbow--branch-' + branchSide;
    }
    const stem = marker.querySelector('.hub-students-timeline-stem');
    if (stem) stem.className = 'hub-students-timeline-stem hub-students-timeline-stem--' + side;
  }

  function hubStudentsTimelineRecalcTrackPadding(track, layouts) {
    if (!track) return;
    let maxBelowPx = 80;
    let maxAbovePx = 80;
    (Array.isArray(layouts) ? layouts : []).forEach(function (layout) {
      const elbowW = hubStudentsTimelineResolveElbowPx(layout.elbowWPx, HUB_TIMELINE_ELBOW_APPROX_PX);
      const totalStem = (Number(layout.stemLen) || 0) + HUB_TIMELINE_EVENT_CARD_APPROX_PX + elbowW;
      if (layout.side === 'above') {
        if (totalStem > maxAbovePx) maxAbovePx = totalStem;
      } else if (totalStem > maxBelowPx) {
        maxBelowPx = totalStem;
      }
    });
    track.style.paddingTop = String(Math.ceil(maxAbovePx) + 32) + 'px';
    track.style.paddingBottom = String(Math.ceil(maxBelowPx) + 32) + 'px';
  }

  function hubStudentsClampTimelineEdgeLayouts(layouts, options) {
    const items = Array.isArray(layouts) ? layouts : [];
    const freezeAxisNudge = Boolean(options && options.freezeAxisNudge);
    const allowBranchChoice = Boolean(options && options.allowBranchChoice);
    items.forEach(function (layout) {
      const p = Number(layout.percent);
      if (p >= HUB_TIMELINE_EDGE_RIGHT_PCT) {
        if (!allowBranchChoice) layout.branchSide = 'left';
        if (!freezeAxisNudge) {
          if ((Number(layout.axisNudgePercent) || 0) > 0) {
            layout.axisNudgePercent = 0;
          }
          const eff = hubStudentsTimelineLayoutEffectivePercent(layout);
          if (eff > HUB_TIMELINE_EDGE_MAX_EFFECTIVE_PCT) {
            layout.axisNudgePercent = (Number(layout.axisNudgePercent) || 0)
              - (eff - HUB_TIMELINE_EDGE_MAX_EFFECTIVE_PCT);
          }
        }
      } else if (p <= HUB_TIMELINE_EDGE_LEFT_PCT) {
        if (!allowBranchChoice) layout.branchSide = 'right';
        if (!freezeAxisNudge) {
          if ((Number(layout.axisNudgePercent) || 0) < 0) {
            layout.axisNudgePercent = 0;
          }
          const eff = hubStudentsTimelineLayoutEffectivePercent(layout);
          if (eff < HUB_TIMELINE_EDGE_LEFT_PCT) {
            layout.axisNudgePercent = (Number(layout.axisNudgePercent) || 0)
              + (HUB_TIMELINE_EDGE_LEFT_PCT - eff);
          }
        }
      }
    });
    return items;
  }

  function hubStudentsResolveTimelineBranchSide(side, sideOrdinal, percent) {
    const p = Number(percent) || 0;
    if (p >= 88) return 'left';
    if (p <= 12) return 'right';
    if (side === 'below') {
      return sideOrdinal % 2 === 0 ? 'right' : 'left';
    }
    return sideOrdinal % 2 === 0 ? 'left' : 'right';
  }

  function hubStudentsApplyTimelineTrackWidth(track) {
    if (!track) return { availW: 0, trackW: 0 };
    const scroll = track.parentElement;
    const availW = scroll && scroll.clientWidth > 0 ? scroll.clientWidth : 0;
    const axisTarget = availW > 0 ? Math.round(availW * HUB_TIMELINE_AXIS_WIDTH_RATIO) : 960;
    track.style.width = String(axisTarget) + 'px';
    track.style.minWidth = '0';
    track.style.maxWidth = availW > 0 ? String(axisTarget) + 'px' : 'none';
    track.style.marginLeft = 'auto';
    track.style.marginRight = 'auto';
    return { availW: availW, trackW: axisTarget, axisTarget: axisTarget };
  }

  function hubStudentsAssignTimelineLayout(events, minDate, maxDate) {
    const rows = Array.isArray(events) ? events : [];
    const positioned = rows.map(function (event) {
      const dateKey = String(event?.date || '').trim();
      return {
        event: event,
        dateKey: dateKey,
        percent: hubStudentsTimelinePositionPercent(dateKey, minDate, maxDate)
      };
    }).sort(function (a, b) {
      return a.percent - b.percent
        || String(a.event?.id || '').localeCompare(String(b.event?.id || ''));
    });

    const belowByBucket = {};
    const aboveByBucket = {};
    const bucketBranchAnchor = {};
    let belowTotal = 0;
    let aboveTotal = 0;

    return positioned.map(function (row, globalIndex) {
      const bucket = row.percent.toFixed(3);
      if (!belowByBucket[bucket]) belowByBucket[bucket] = 0;
      if (!aboveByBucket[bucket]) aboveByBucket[bucket] = 0;

      const bucketCount = belowByBucket[bucket] + aboveByBucket[bucket];
      let side = 'below';
      if (bucketCount > 0) {
        side = bucketCount % 2 === 0 ? 'below' : 'above';
        if (side === 'below' && belowByBucket[bucket] >= HUB_TIMELINE_MAX_BELOW_PER_BUCKET) {
          side = 'above';
        }
      } else if (belowTotal > aboveTotal) {
        side = 'above';
      } else if (globalIndex % 2 === 1) {
        side = 'above';
      }

      let laneIdx = 0;
      if (side === 'below') {
        laneIdx = belowByBucket[bucket];
        belowByBucket[bucket] += 1;
        belowTotal += 1;
      } else {
        laneIdx = aboveByBucket[bucket];
        aboveByBucket[bucket] += 1;
        aboveTotal += 1;
      }

      const sideOrdinal = side === 'below' ? belowTotal : aboveTotal;
      const p = row.percent;
      let stemLen = HUB_TIMELINE_STEM_BASE_PX + (laneIdx + 1) * HUB_TIMELINE_STEM_STEP_PX;
      let branchSide = hubStudentsResolveTimelineBranchSide(side, sideOrdinal, p);
      let elbowWPx = HUB_TIMELINE_ELBOW_BASE_PX + laneIdx * HUB_TIMELINE_ELBOW_STEP_PX;

      if (laneIdx === 0) {
        stemLen = HUB_TIMELINE_STEM_FIRST_ON_DATE_PX;
        elbowWPx = HUB_TIMELINE_ELBOW_MIN_PX;
        bucketBranchAnchor[bucket] = branchSide;
      } else {
        stemLen = HUB_TIMELINE_STEM_FIRST_ON_DATE_PX
          + (laneIdx + 1) * HUB_TIMELINE_STEM_STEP_PX;
        const anchorBranch = bucketBranchAnchor[bucket];
        if (anchorBranch) {
          branchSide = anchorBranch === 'left' ? 'right' : 'left';
          if (p >= HUB_TIMELINE_EDGE_RIGHT_PCT) branchSide = 'left';
          if (p <= HUB_TIMELINE_EDGE_LEFT_PCT) branchSide = 'right';
          const sameBranchAsFirst = branchSide === anchorBranch;
          elbowWPx = sameBranchAsFirst
            ? HUB_TIMELINE_ELBOW_BASE_PX + (laneIdx + 1) * HUB_TIMELINE_ELBOW_STEP_PX
            : HUB_TIMELINE_ELBOW_MIN_PX;
        } else {
          elbowWPx = HUB_TIMELINE_ELBOW_MIN_PX;
        }
      }

      return {
        event: row.event,
        dateKey: row.dateKey,
        percent: row.percent,
        side: side,
        stemLen: stemLen,
        laneIdx: laneIdx,
        branchSide: branchSide,
        elbowWPx: elbowWPx,
        axisNudgePercent: 0
      };
    });
  }

  function hubStudentsFormatTimelineTipText(event) {
    const bag = event && typeof event === 'object' ? event : {};
    const dateRaw = String(bag.date || bag.dateKey || '').trim();
    const dateLine = dateRaw ? ('Date: ' + formatHubDateKey(dateRaw)) : '';
    const tooltipLines = Array.isArray(bag.tooltipLines) ? bag.tooltipLines : [];
    if (tooltipLines.length) {
      return [dateLine]
        .concat(tooltipLines.map(function (line) { return String(line || '').trim(); }).filter(Boolean))
        .filter(Boolean)
        .join('\n');
    }
    const title = String(bag.label || bag.type || 'Event').trim();
    const detail = String(bag.sublabel || '').trim();
    const typeLabel = String(bag.type || '').trim().replace(/_/g, ' ');
    return [dateLine, title, detail, typeLabel].filter(Boolean).join('\n');
  }

  let hubStudentsTimelineTipEl = null;
  let hubStudentsTimelineTipAnchor = null;

  function hubStudentsEnsureTimelineTip() {
    if (hubStudentsTimelineTipEl && hubStudentsTimelineTipEl.isConnected) return hubStudentsTimelineTipEl;
    hubStudentsTimelineTipEl = document.createElement('div');
    hubStudentsTimelineTipEl.className = 'sch-event-tip';
    hubStudentsTimelineTipEl.setAttribute('role', 'tooltip');
    hubStudentsTimelineTipEl.hidden = true;
    document.body.appendChild(hubStudentsTimelineTipEl);
    return hubStudentsTimelineTipEl;
  }

  function hubStudentsHideTimelineTip() {
    const tipEl = hubStudentsTimelineTipEl;
    if (!tipEl) return;
    tipEl.classList.remove('is-visible', 'is-below');
    tipEl.hidden = true;
    tipEl.innerHTML = '';
    hubStudentsTimelineTipAnchor = null;
  }

  function hubStudentsShowTimelineTip(target) {
    if (!target) return;
    const tipEl = hubStudentsEnsureTimelineTip();
    const label = String(target.getAttribute('data-tip') || '').trim();
    if (!label) {
      hubStudentsHideTimelineTip();
      return;
    }
    const tipBg = target.getAttribute('data-tip-bg') || '#0f172a';
    const tipFg = target.getAttribute('data-tip-fg') || '#ffffff';
    const tipBorder = target.getAttribute('data-tip-border') || '#0d6efd';
    const parts = label.split('\n').map(function (part) {
      return String(part || '').trim();
    }).filter(Boolean);
    tipEl.innerHTML = parts.map(function (part, index) {
      const isDate = /^Date:/i.test(part);
      return [
        '<span class="sch-tip-line',
        index > 0 ? ' sch-tip-sub' : '',
        isDate ? ' sch-tip-date' : '',
        '">',
        escapeHtml(part),
        '</span>'
      ].join('');
    }).join('');
    tipEl.style.background = tipBg;
    tipEl.style.color = tipFg;
    tipEl.style.borderColor = tipBorder;
    tipEl.style.setProperty('--sch-tip-arrow', tipBg);
    tipEl.hidden = false;
    tipEl.classList.remove('is-below');
    const rect = target.getBoundingClientRect();
    let left = rect.left + (rect.width / 2);
    const tipWidth = tipEl.offsetWidth || 160;
    const tipHeight = tipEl.offsetHeight || 80;
    const pad = 10;
    left = Math.max(pad + tipWidth / 2, Math.min(left, window.innerWidth - pad - tipWidth / 2));
    tipEl.style.left = String(left) + 'px';
    if ((rect.top - tipHeight - 14) < pad) {
      tipEl.classList.add('is-below');
      tipEl.style.top = String(Math.min(window.innerHeight - pad - tipHeight, rect.bottom)) + 'px';
    } else {
      tipEl.style.top = String(Math.max(8, rect.top)) + 'px';
    }
    tipEl.classList.add('is-visible');
    hubStudentsTimelineTipAnchor = target;
  }

  function hubStudentsRenderTimelineMarker(layout) {
    const event = layout?.event;
    const typeClass = hubStudentsTimelineTypeClass(event?.type);
    const label = escapeHtml(String(event?.label || event?.type || 'Event'));
    const dateRaw = String(layout?.dateKey || event?.date || '').trim();
    const dateLabel = escapeHtml(formatHubDateKey(dateRaw, { year: 'numeric', month: 'short', day: 'numeric' }));
    const tipText = escapeHtml(hubStudentsFormatTimelineTipText(event || {}));
    const actionAttr = hubStudentsEncodeTimelineAction(event?.action);
    const eventId = escapeHtml(String(event?.id || ''));
    const side = layout?.side === 'above' ? 'above' : 'below';
    const stemLen = Number(layout?.stemLen) || HUB_TIMELINE_STEM_BASE_PX;
    const elbowWPx = hubStudentsTimelineResolveElbowPx(layout?.elbowWPx, HUB_TIMELINE_ELBOW_BASE_PX);
    const percent = Number(layout?.percent);
    const branchSide = layout?.branchSide === 'left' ? 'left' : 'right';
    const leftStyle = Number.isFinite(percent)
      ? ('left:' + String(hubStudentsTimelineMarkerAnchorPercent(layout)) + '%;')
      : '';
    const cssVars = '--stem-len:' + String(stemLen) + 'px;--elbow-w:' + String(elbowWPx) + 'px;';
    const cardHtml = [
      '<button type="button" class="hub-students-timeline-event ' + typeClass + '"',
      ' data-hub-timeline-event-id="' + eventId + '"',
      ' data-hub-timeline-draggable="1"',
      ' data-hub-timeline-action="' + actionAttr + '"',
      ' data-tip="' + tipText + '"',
      ' data-tip-bg="#0f172a" data-tip-fg="#ffffff" data-tip-border="#0d6efd"',
      ' aria-describedby="hubStudentsTimelineTip">',
      '<span class="hub-students-timeline-event-date">' + dateLabel + '</span>',
      '<span class="hub-students-timeline-event-label">' + label + '</span>',
      '</button>'
    ].join('');
    const dotWrap = [
      '<div class="hub-students-timeline-dot-wrap">',
      '<span class="hub-students-timeline-dot" aria-hidden="true"></span>',
      '</div>'
    ].join('');
    const elbowHtml = [
      '<div class="hub-students-timeline-elbow hub-students-timeline-elbow--' + side + ' hub-students-timeline-elbow--branch-' + branchSide + '">',
      '<span class="hub-students-timeline-elbow-corner" aria-hidden="true"></span>',
      cardHtml,
      '</div>'
    ].join('');
    return [
      '<div class="hub-students-timeline-marker hub-students-timeline-marker--' + side + ' hub-students-timeline-marker--branch-' + branchSide + '"',
      ' style="' + leftStyle + cssVars + '" role="listitem">',
      '<div class="hub-students-timeline-stem hub-students-timeline-stem--' + side + '">',
      dotWrap,
      elbowHtml,
      '</div>',
      '</div>'
    ].join('');
  }

  async function hubStudentsRenderTimeline(timeline) {
    const wrap = document.getElementById('hubStudentsTimelineWrap');
    const empty = document.getElementById('hubStudentsTimelineEmpty');
    const track = document.getElementById('hubStudentsTimelineTrack');
    const minLabel = document.getElementById('hubStudentsTimelineMinLabel');
    const maxLabel = document.getElementById('hubStudentsTimelineMaxLabel');
    const truncated = document.getElementById('hubStudentsTimelineTruncated');
    const titleEl = document.getElementById('hubStudentsTimelineModalLabel');
    if (!wrap || !empty || !track) return;

    const payload = timeline && typeof timeline === 'object' ? timeline : {};
    const student = payload.student && typeof payload.student === 'object' ? payload.student : {};
    const range = payload.range && typeof payload.range === 'object' ? payload.range : {};
    const events = Array.isArray(payload.events) ? payload.events : [];
    const minDate = String(range.minDate || '').trim();
    const maxDate = String(range.maxDate || '').trim();

    hubStudentsUpdateTimelineAxisProgress(46, 'Reading student profile and date range…');
    await hubStudentsTimelineForcePaint();

    if (titleEl) {
      const name = String(student.name || student.id || 'Student').trim();
      titleEl.textContent = name ? 'Timeline — ' + name : 'Student timeline';
    }
    if (minLabel) minLabel.textContent = minDate || '…';
    if (maxLabel) maxLabel.textContent = maxDate || '…';

    if (!events.length || !minDate || !maxDate) {
      hubStudentsUpdateTimelineAxisProgress(100, 'No dated events to display.');
      await hubStudentsTimelineForcePaint();
      wrap.classList.add('d-none');
      empty.classList.remove('d-none');
      track.innerHTML = '';
      track.classList.remove('is-loading');
      if (truncated) truncated.classList.add('d-none');
      hubStudentsTimelineLoadUi(false);
      return;
    }

    empty.classList.add('d-none');
    if (truncated) truncated.classList.toggle('d-none', payload.truncated !== true);

    const studentId = String(student.id || '').trim();
    hubStudentsTimelineActiveStudentId = studentId;
    hubStudentsApplyTimelineTrackWidth(track);

    hubStudentsUpdateTimelineAxisProgress(56, 'Placing ' + String(events.length) + ' events on the axis…');
    await hubStudentsTimelineForcePaint();
    let layouts = hubStudentsAssignTimelineLayout(events, minDate, maxDate);

    hubStudentsUpdateTimelineAxisProgress(68, 'Applying saved card layout preferences…');
    await hubStudentsTimelineForcePaint();
    layouts = hubStudentsApplyTimelineLayoutPrefs(layouts, studentId);

    const scroll = track.parentElement;
    const estTrackW = scroll && scroll.clientWidth > 0
      ? Math.round(scroll.clientWidth * HUB_TIMELINE_AXIS_WIDTH_RATIO)
      : 960;

    hubStudentsUpdateTimelineAxisProgress(72, 'Organizing cards (stem, indent, and side)…');
    await hubStudentsTimelineForcePaint();
    layouts = await hubStudentsOptimizeTimelineLayouts(layouts, estTrackW, function (pct, note) {
      hubStudentsUpdateTimelineAxisProgress(pct, note);
    });
    hubStudentsTimelineLiveLayouts = layouts;
    hubStudentsTimelineRecalcTrackPadding(track, layouts);

    hubStudentsUpdateTimelineAxisProgress(92, 'Drawing timeline cards and connectors…');
    await hubStudentsTimelineForcePaint();
    track.innerHTML = layouts.map(hubStudentsRenderTimelineMarker).join('');
    track.setAttribute('role', 'list');
    hubStudentsApplyTimelineTrackWidth(track);

    hubStudentsUpdateTimelineAxisProgress(100, 'Timeline ready.');
    await hubStudentsTimelineForcePaint();
    if (typeof global.requestAnimationFrame === 'function') {
      await new Promise(function (resolve) {
        global.requestAnimationFrame(function () {
          hubStudentsApplyTimelineTrackWidth(track);
          resolve();
        });
      });
    }
    hubStudentsTimelineLoadUi(false);
  }

  async function hubStudentsFetchTimeline(studentId) {
    const id = String(studentId || '').trim();
    const response = await fetch('' + API_BASE + '/students/' + encodeURIComponent(id) + '/timeline', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin'
    });
    const payload = await response.json().catch(function () {
      return { status: 'error', message: 'Unable to load timeline.' };
    });
    if (!response.ok || payload.status !== 'success') {
      throw new Error(payload.message || 'Unable to load timeline.');
    }
    return payload.timeline || null;
  }

  function hubStudentsHandleTimelineEventAction(action) {
    const profile = hubStudentsRequireSelectedProfile();
    if (!profile) return;
    const bag = action && typeof action === 'object' ? action : {};
    const kind = String(bag.kind || '').trim();

    if (kind === 'noop') return;

    if (kind === 'enrollment_close') {
      const row = bag.enrollmentRow;
      if (row && global.SchoolStudentManagementEnrollmentClose) {
        hubStudentsHideTimelineModal();
        global.SchoolStudentManagementEnrollmentClose.openForEnrollment(row);
      }
      return;
    }

    if (kind === 'enrollment_edit_embed' || kind === 'embed_url') {
      const url = String(bag.url || '').trim();
      const title = String(bag.title || 'Details').trim();
      if (!url) {
        void hubStudentsShowSimpleMsg('Unavailable', 'warning', 'This item does not have a linked page.');
        return;
      }
      hubStudentsHideTimelineModal();
      hubStudentsOpenEmbedModal(title, url);
      return;
    }

    if (kind === 'manager_clb') {
      const label = String(profile.name || profile.id).trim();
      if (global.RollingStudentClbManager) {
        hubStudentsHideTimelineModal();
        global.RollingStudentClbManager.open({
          studentId: profile.id,
          studentLabel: label,
          onSaved: function () {
            return loadHubStudentProfile(profile.id);
          }
        });
      }
      return;
    }

    if (kind === 'manager_referrals') {
      const label = String(profile.name || profile.id).trim();
      if (global.StudentReferralLinksManager) {
        hubStudentsHideTimelineModal();
        global.StudentReferralLinksManager.open({
          studentId: profile.id,
          studentLabel: label,
          onSaved: function () {
            return loadHubStudentProfile(profile.id);
          }
        });
      }
      return;
    }

    if (kind === 'person_reports') {
      const personId = String(profile.personId || '').trim();
      if (!personId) return;
      hubStudentsHideTimelineModal();
      hubStudentsOpenEmbedModal('Reports', hubStudentsBuildPersonReportsUrl(personId));
      return;
    }

    if (kind === 'session_cases_day') {
      const personId = String(bag.personId || profile.personId || '').trim();
      const day = String(bag.date || '').trim();
      hubStudentsHideTimelineModal();
      hubStudentsOpenEmbedModal(
        'Student cases',
        hubStudentsBuildSessionCasesUrl(personId, day, day)
      );
      return;
    }
  }

  async function hubStudentsOpenTimelineModal() {
    const profile = hubStudentsRequireSelectedProfile();
    if (!profile) return;
    const modalEl = document.getElementById('hubStudentsTimelineModal');
    const empty = document.getElementById('hubStudentsTimelineEmpty');
    const wrap = document.getElementById('hubStudentsTimelineWrap');
    if (!modalEl) return;
    if (empty) empty.classList.add('d-none');
    if (wrap) {
      wrap.classList.remove('d-none');
      const minLabel = document.getElementById('hubStudentsTimelineMinLabel');
      const maxLabel = document.getElementById('hubStudentsTimelineMaxLabel');
      if (minLabel) minLabel.textContent = '…';
      if (maxLabel) maxLabel.textContent = '…';
    }
    const track = document.getElementById('hubStudentsTimelineTrack');
    if (track) track.innerHTML = '';
    hubStudentsSetTimelineLoading(true);
    hubStudentsShowModal(modalEl);
    try {
      await hubStudentsTimelineForcePaint();
      hubStudentsUpdateTimelineAxisProgress(14, 'Opening timeline for the selected student…');
      await hubStudentsTimelineForcePaint();
      const timeline = await hubStudentsFetchTimelineWithProgress(profile.id);
      hubStudentsUpdateTimelineAxisProgress(40, 'Events received — building timeline…');
      await hubStudentsTimelineForcePaint();
      await hubStudentsRenderTimeline(timeline);
    } catch (error) {
      hubStudentsTimelineLoadUi(false);
      if (empty) {
        empty.textContent = String(error?.message || 'Unable to load timeline.');
        empty.classList.remove('d-none');
      }
      if (wrap) wrap.classList.add('d-none');
    }
  }

  function bindHubStudentsTimelineModal() {
    if (hubStudentsTimelineModalBound) return;
    hubStudentsTimelineModalBound = true;
    const track = document.getElementById('hubStudentsTimelineTrack');
    const trackScroll = document.querySelector('#hubStudentsTimelineModal .hub-students-timeline-track-scroll');
    const timelineModal = document.getElementById('hubStudentsTimelineModal');
    if (!track) return;
    track.addEventListener('pointerdown', function (event) {
      const btn = event.target && event.target.closest('[data-hub-timeline-draggable][data-hub-timeline-event-id]');
      if (!btn || !track.contains(btn)) return;
      if (event.button !== 0) return;
      const eventId = btn.getAttribute('data-hub-timeline-event-id') || '';
      const layout = hubStudentsFindTimelineLayoutByEventId(eventId);
      const marker = btn.closest('.hub-students-timeline-marker');
      if (!layout || !marker) return;
      hubStudentsHideTimelineTip();
      hubStudentsTimelineDragState = {
        pointerId: event.pointerId,
        btn: btn,
        marker: marker,
        eventId: eventId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        startStemLen: Number(layout.stemLen) || HUB_TIMELINE_STEM_BASE_PX,
        startElbowWPx: hubStudentsTimelineResolveElbowPx(layout.elbowWPx, HUB_TIMELINE_ELBOW_BASE_PX),
        startBranch: layout.branchSide === 'left' ? 'left' : 'right',
        startSignedElbow: hubStudentsTimelineSignedElbow(
          layout.branchSide === 'left' ? 'left' : 'right',
          layout.elbowWPx
        ),
        side: layout.side === 'above' ? 'above' : 'below',
        startSide: layout.side === 'above' ? 'above' : 'below',
        startSignedStem: hubStudentsTimelineSignedStem(
          layout.side === 'above' ? 'above' : 'below',
          layout.stemLen
        )
      };
      btn.setPointerCapture(event.pointerId);
    });
    track.addEventListener('pointermove', function (event) {
      const drag = hubStudentsTimelineDragState;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved) {
        if (Math.abs(dx) <= HUB_TIMELINE_DRAG_CLICK_PX && Math.abs(dy) <= HUB_TIMELINE_DRAG_CLICK_PX) {
          return;
        }
        drag.moved = true;
        track.classList.add('is-adjusting');
        event.preventDefault();
      }
      const layout = hubStudentsFindTimelineLayoutByEventId(drag.eventId);
      if (!layout) return;
      const limits = hubStudentsTimelineDragLimits(track);
      layout.axisNudgePercent = 0;
      const dyFromAnchor = event.clientY - drag.startY;
      const dxFromAnchor = event.clientX - drag.startX;
      hubStudentsTimelineApplySignedStemDrag(
        layout,
        drag,
        dyFromAnchor,
        limits,
        event.clientY
      );
      hubStudentsTimelineApplySignedElbowDrag(
        layout,
        drag.startSignedElbow,
        dxFromAnchor,
        limits
      );
      hubStudentsClampTimelineEdgeLayouts([layout], {
        freezeAxisNudge: true,
        allowBranchChoice: true
      });
      layout.manualLayout = true;
      hubStudentsApplyTimelineMarkerLayout(drag.marker, layout);
      hubStudentsTimelineRecalcTrackPadding(track, hubStudentsTimelineLiveLayouts);
    });
    function hubStudentsEndTimelineDrag(event) {
      const drag = hubStudentsTimelineDragState;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (drag.moved) {
        if (drag.btn) drag.btn.__hubTimelineDragMoved = true;
        const layout = hubStudentsFindTimelineLayoutByEventId(drag.eventId);
        if (layout && hubStudentsTimelineActiveStudentId) {
          hubStudentsSaveTimelineLayoutPref(hubStudentsTimelineActiveStudentId, drag.eventId, {
            side: layout.side,
            branchSide: layout.branchSide,
            stemLen: layout.stemLen,
            elbowWPx: layout.elbowWPx,
            axisNudgePercent: 0,
            manual: true
          });
        }
      }
      try {
        if (drag.btn && drag.btn.hasPointerCapture(event.pointerId)) {
          drag.btn.releasePointerCapture(event.pointerId);
        }
      } catch (releaseError) { /* */ }
      hubStudentsTimelineDragState = null;
      track.classList.remove('is-adjusting');
    }
    track.addEventListener('pointerup', hubStudentsEndTimelineDrag);
    track.addEventListener('pointercancel', hubStudentsEndTimelineDrag);
    track.addEventListener('click', function (event) {
      if (hubStudentsTimelineDragState) return;
      const btn = event.target && event.target.closest('[data-hub-timeline-action]');
      if (!btn) return;
      if (btn.__hubTimelineDragMoved) {
        btn.__hubTimelineDragMoved = false;
        return;
      }
      const raw = btn.getAttribute('data-hub-timeline-action') || '{}';
      let action = {};
      try {
        action = JSON.parse(raw);
      } catch (parseError) {
        action = {};
      }
      hubStudentsHideTimelineTip();
      hubStudentsHandleTimelineEventAction(action);
    });
    track.addEventListener('pointerover', function (event) {
      const btn = event.target && event.target.closest('[data-hub-timeline-action][data-tip]');
      if (!btn || !track.contains(btn)) return;
      hubStudentsShowTimelineTip(btn);
    });
    track.addEventListener('pointerout', function (event) {
      const btn = event.target && event.target.closest('[data-hub-timeline-action][data-tip]');
      const related = event.relatedTarget;
      if (!btn) return;
      if (related && btn.contains(related)) return;
      if (hubStudentsTimelineTipAnchor === btn) hubStudentsHideTimelineTip();
    });
    if (trackScroll) {
      trackScroll.addEventListener('scroll', hubStudentsHideTimelineTip);
    }
    if (timelineModal) {
      timelineModal.addEventListener('hidden.bs.modal', hubStudentsHideTimelineTip);
    }
    window.addEventListener('scroll', hubStudentsHideTimelineTip, true);
  }

  let hubStudentsEmbedModalBound = false;

  function bindHubStudentsEmbedModals() {
    if (hubStudentsEmbedModalBound) return;
    hubStudentsEmbedModalBound = true;
    const embedModal = document.getElementById('hubStudentsEmbedModal');
    if (embedModal) {
      embedModal.addEventListener('hidden.bs.modal', function () {
        const frame = document.getElementById('hubStudentsEmbedFrame');
        if (frame) {
          frame.onload = null;
          frame.src = 'about:blank';
        }
        hubStudentsSetEmbedLoading(false);
      });
    }
    const shortcuts = document.getElementById('hubStudentsDateRangeShortcuts');
    if (shortcuts) {
      shortcuts.addEventListener('click', function (event) {
        const btn = event.target && event.target.closest('[data-hub-students-range-token]');
        if (!btn) return;
        hubStudentsApplyDateRangeToken(btn.getAttribute('data-hub-students-range-token') || '');
      });
    }
    const confirmBtn = document.getElementById('hubStudentsDateRangeConfirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        hubStudentsConfirmDateRangeOpen();
      });
    }
  }

  function bindHubStudentsQuickActions() {
    bindHubStudentsEmbedModals();
    bindHubStudentsTimelineModal();
    hubStudentsGetQuickActionButtons().forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        hubStudentsHandleQuickOpen(btn.getAttribute('data-hub-students-open') || '');
      });
    });
    hubStudentsUpdateQuickActionsState(Boolean(hubStudentsActiveProfile && hubStudentsActiveProfile.id));
  }

  function hubStudentsFormatClaimLine(claim) {
    const label = String(claim?.label || '').trim();
    const number = String(claim?.number || '').trim();
    if (label && number) return label + ' ' + number;
    return number || label || '—';
  }

  function hubStudentsResolvePrimaryClaim(profile) {
    if (!profile || typeof profile !== 'object') return null;
    const rows = Array.isArray(profile.claimNumbers) ? profile.claimNumbers : [];
    let claim = rows.find(function (row) {
      return row && row.isPrimary === true;
    }) || null;
    if (!claim && rows.length === 1) {
      claim = rows[0];
    }
    if (claim) {
      const number = String(claim.number || '').trim();
      const label = String(claim.label || '').trim();
      if (number || label) return claim;
    }
    const fallbackNumber = String(profile.primaryClaimNumber || '').trim();
    if (fallbackNumber) {
      return { number: fallbackNumber, label: '' };
    }
    return null;
  }

  function hubStudentsHeroPrimaryClaimHtml(profile) {
    const claim = hubStudentsResolvePrimaryClaim(profile);
    if (!claim) return '';
    const line = hubStudentsFormatClaimLine(claim);
    if (!line || line === '—') return '';
    return '<div class="hub-students-hero-claim-line" title="Primary claim number">' + escapeHtml(line) + '</div>';
  }

  function hubStudentsCardHeaderHtml(iconClass, title, cardKey) {
    const actions = hubStudentsCanEditClb()
      ? [
        '<div class="hub-students-card-actions d-flex flex-wrap gap-1">',
        '<button type="button" class="btn btn-sm btn-outline-secondary" data-hub-students-manage="' + escapeHtml(cardKey) + '">',
        '<i class="bi bi-pencil-square me-1"></i>Manage</button>',
        '<button type="button" class="btn btn-sm btn-outline-primary" data-hub-students-add="' + escapeHtml(cardKey) + '">',
        '<i class="bi bi-plus-lg me-1"></i>Add</button>',
        '</div>'
      ].join('')
      : '';
    return [
      '<div class="hub-students-card-header hub-students-card-header--split">',
      '<span><i class="bi ' + iconClass + ' me-2"></i>' + escapeHtml(title) + '</span>',
      actions,
      '</div>'
    ].join('');
  }

  function renderHubStudentsClaimsListHtml(claimNumbers) {
    const rows = Array.isArray(claimNumbers) ? claimNumbers : [];
    if (!rows.length) {
      return '<div class="text-muted small">No claim numbers on file.</div>';
    }
    return [
      '<div class="hub-students-claims-strip">',
      rows.map(function (claim) {
        const label = String(claim?.label || 'Claim').trim();
        const number = String(claim?.number || '').trim();
        const notes = String(claim?.notes || '').trim();
        const primary = claim?.isPrimary === true
          ? '<span class="hub-students-claim-chip-primary">Primary</span>'
          : '';
        return [
          '<div class="hub-students-claim-chip">',
          '<div class="hub-students-claim-chip-label">' + escapeHtml(label || 'Claim') + '</div>',
          '<div class="hub-students-claim-chip-number">' + escapeHtml(number || '—') + '</div>',
          notes ? '<div class="hub-students-claim-chip-notes">' + escapeHtml(notes) + '</div>' : '',
          primary,
          '</div>'
        ].join('');
      }).join(''),
      '</div>'
    ].join('');
  }

  function renderHubStudentsClbListHtml(clbLevelHistory) {
    const entries = Array.isArray(clbLevelHistory) ? clbLevelHistory : [];
    if (!entries.length) {
      return '<div class="text-muted small">No CLB level history on file.</div>';
    }
    return [
      '<div class="hub-students-clb-stack">',
      entries.map(function (entry) {
        const recordedAt = formatHubDateKey(entry?.recordedAt || '', { year: 'numeric', month: 'short', day: 'numeric' })
          || hubStudentsFormatField(entry?.recordedAt);
        const evalLabel = hubStudentsFormatClbEvaluationType(entry?.evaluationType);
        const headParts = [recordedAt, evalLabel].filter(Boolean);
        return [
          '<div class="hub-students-clb-entry">',
          '<div class="hub-students-clb-entry-head">' + escapeHtml(headParts.join(' · ') || 'CLB entry') + '</div>',
          hubStudentsRenderClbSkillGrid(entry),
          '</div>'
        ].join('');
      }).join(''),
      '</div>'
    ].join('');
  }

  function renderHubStudentsReferralsListHtml(referralLinks) {
    const rows = Array.isArray(referralLinks) ? referralLinks : [];
    if (!rows.length) {
      return '<div class="text-muted small">No referral links on file.</div>';
    }
    return [
      '<div class="hub-students-claims-strip">',
      rows.map(function (link) {
        const referralLabel = String(link?.referralLabel || link?.referralId || 'Referral').trim();
        const orgLabel = String(link?.organizationLabel || link?.organizationId || '').trim();
        const programLabel = String(link?.programLabel || link?.programId || '').trim();
        const linkDate = String(link?.linkDate || '').trim();
        const meta = [orgLabel, linkDate, programLabel].filter(Boolean).join(' · ');
        return [
          '<div class="hub-students-claim-chip">',
          '<div class="hub-students-claim-chip-label">' + escapeHtml(referralLabel) + '</div>',
          meta ? '<div class="hub-students-claim-chip-number">' + escapeHtml(meta) + '</div>' : '',
          '</div>'
        ].join('');
      }).join(''),
      '</div>'
    ].join('');
  }

  function renderHubStudentsReferralsCard(profile) {
    const card = document.querySelector('[data-hub-students-card="referrals"]');
    if (!card) return;
    if (!profile || !profile.id) {
      card.innerHTML = [
        hubStudentsCardHeaderHtml('bi-people', 'Referrals', 'referrals'),
        '<div class="hub-students-card-empty">Select a student to view referrals.</div>'
      ].join('');
      return;
    }
    const linkCount = Array.isArray(profile.referralLinks) ? profile.referralLinks.length : 0;
    const title = 'Referrals' + (linkCount ? ' (' + linkCount + ')' : '');
    card.innerHTML = [
      hubStudentsCardHeaderHtml('bi-people', title, 'referrals'),
      '<div class="hub-students-card-body">',
      renderHubStudentsReferralsListHtml(profile.referralLinks),
      '</div>'
    ].join('');
    requestAnimationFrame(function () {
      hubStudentsSyncCardHeights();
    });
  }

  function renderHubStudentsClaimsCard(profile) {
    const card = document.querySelector('[data-hub-students-card="claims"]');
    if (!card) return;
    if (!profile || !profile.id) {
      card.innerHTML = [
        hubStudentsCardHeaderHtml('bi-card-checklist', 'Claim numbers', 'claims'),
        '<div class="hub-students-card-empty">Select a student to view claim numbers.</div>'
      ].join('');
      return;
    }
    const claimCount = Array.isArray(profile.claimNumbers) ? profile.claimNumbers.length : 0;
    const title = 'Claim numbers' + (claimCount ? ' (' + claimCount + ')' : '');
    card.innerHTML = [
      hubStudentsCardHeaderHtml('bi-card-checklist', title, 'claims'),
      '<div class="hub-students-card-body">',
      renderHubStudentsClaimsListHtml(profile.claimNumbers),
      '</div>'
    ].join('');
    requestAnimationFrame(function () {
      hubStudentsSyncCardHeights();
    });
  }

  function renderHubStudentsClbCard(profile) {
    const card = document.querySelector('[data-hub-students-card="clb"]');
    if (!card) return;
    if (!profile || !profile.id) {
      card.innerHTML = [
        hubStudentsCardHeaderHtml('bi-bar-chart-steps', 'CLB entries', 'clb'),
        '<div class="hub-students-card-empty">Select a student to view CLB entries.</div>'
      ].join('');
      return;
    }
    const entryCount = Array.isArray(profile.clbLevelHistory) ? profile.clbLevelHistory.length : 0;
    const title = 'CLB entries' + (entryCount ? ' (' + entryCount + ')' : '');
    card.innerHTML = [
      hubStudentsCardHeaderHtml('bi-bar-chart-steps', title, 'clb'),
      '<div class="hub-students-card-body">',
      renderHubStudentsClbListHtml(profile.clbLevelHistory),
      '</div>'
    ].join('');
  }

  function renderHubStudentsPersonalCard(profile) {
    const card = document.querySelector('[data-hub-students-card="personal"]');
    if (!card) return;
    if (!profile || !profile.id) {
      card.innerHTML = [
        '<div class="hub-students-card-header"><i class="bi bi-person-vcard me-2"></i>Personal information</div>',
        '<div class="hub-students-card-empty" style="color:#000;">Select a student to view personal information.</div>'
      ].join('');
      return;
    }
    const nameHtml = hubStudentsNameLinkHtml(profile);
    const primaryClaimHtml = hubStudentsHeroPrimaryClaimHtml(profile);
    const customId = String(profile.customStudentId == null ? '' : profile.customStudentId).trim();
    const studentNumber = String(profile.studentNumber == null ? '' : profile.studentNumber).trim();
    const metaIds = [
      customId ? '<div class="hub-students-hero-id-meta">' + escapeHtml(customId) + '</div>' : '',
      studentNumber && studentNumber !== customId ? '<div class="hub-students-hero-id-meta">' + escapeHtml(studentNumber) + '</div>' : ''
    ].join('');
    card.innerHTML = [
      '<div class="hub-students-card-header"><i class="bi bi-person-vcard me-2"></i>Personal information</div>',
      '<div class="hub-students-card-body">',
      '<div class="hub-students-hero">',
      '<div class="hub-students-hero-main">',
      '<div class="hub-students-hero-name-row">',
      '<h3 class="hub-students-hero-name">' + nameHtml + '</h3>',
      primaryClaimHtml,
      '</div>',
      '<div class="hub-students-hero-id-under">' + escapeHtml(profile.id) + '</div>',
      metaIds,
      '</div>',
      '</div>',
      '<div class="hub-students-fields">',
      hubStudentsScalarField('Date of birth', profile.dateOfBirth, '', ''),
      hubStudentsScalarField('Gender', profile.gender, '', 'gender'),
      hubStudentsScalarField('Fee category', profile.feeCategory, '', ''),
      hubStudentsFieldBlock('Emails', profile.emails, profile.email, '', 'inline', 'emails'),
      hubStudentsFieldBlock('Phones', profile.phones, profile.phone, '', 'inline', 'phones'),
      hubStudentsFieldBlock('Addresses', profile.addresses, profile.addressOneLine, 'hub-students-field--full', 'inline', 'addresses'),
      '</div>',
      '</div>'
    ].join('');
    requestAnimationFrame(function () {
      hubStudentsSyncCardHeights();
    });
  }

  function setHubStudentsPersonalCardLoading() {
    const card = document.querySelector('[data-hub-students-card="personal"]');
    if (!card) return;
    card.innerHTML = [
      '<div class="hub-students-card-header"><i class="bi bi-person-vcard me-2"></i>Personal information</div>',
      '<div class="hub-students-card-empty"><div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>Loading student...</div>'
    ].join('');
  }

  function setHubStudentsPersonalCardError(message) {
    const card = document.querySelector('[data-hub-students-card="personal"]');
    if (!card) return;
    card.innerHTML = [
      '<div class="hub-students-card-header"><i class="bi bi-person-vcard me-2"></i>Personal information</div>',
      '<div class="hub-students-card-empty text-danger">' + escapeHtml(message || 'Unable to load profile.') + '</div>'
    ].join('');
  }

  async function loadHubStudentProfile(studentId) {
    const id = String(studentId || '').trim();
    hubStudentsSelectedId = id;
    const hidden = document.getElementById('hubStudentsSelectedId');
    if (hidden) hidden.value = id;
    if (!id) {
      if (hubStudentsProfileAbort) {
        try { hubStudentsProfileAbort.abort(); } catch (error) { /* ignore */ }
        hubStudentsProfileAbort = null;
      }
      hubStudentsActiveProfile = null;
      renderHubStudentsEmptyHero();
      setHubStudentsWorkspaceView('logo');
      renderHubStudentsPersonalCard(null);
      renderHubStudentsClaimsCard(null);
      renderHubStudentsClbCard(null);
      renderHubStudentsReferralsCard(null);
      renderHubStudentsProgramRegsCard(null);
      renderHubStudentsEnrollmentsCard(null);
      hubStudentsUpdateQuickActionsState(false);
      return;
    }
    if (hubStudentsProfileAbort) {
      try { hubStudentsProfileAbort.abort(); } catch (error) { /* ignore */ }
    }
    hubStudentsProfileAbort = new AbortController();
    setHubStudentsWorkspaceView('logo-loading');
    setHubStudentsPersonalCardLoading();
    setHubStudentsProgramRegsCardLoading();
    setHubStudentsEnrollmentsCardLoading();
    try {
      const response = await fetch('' + API_BASE + '/students/' + encodeURIComponent(id) + '/profile', {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
        signal: hubStudentsProfileAbort.signal
      });
      const payload = await response.json().catch(function () {
        return { status: 'error', message: 'Unable to load student profile.' };
      });
      if (!response.ok || payload.status !== 'success') {
        throw new Error(payload.message || 'Unable to load student profile.');
      }
      hubStudentsActiveProfile = payload.profile || null;
      setHubStudentsWorkspaceView(hubStudentsActiveProfile && hubStudentsActiveProfile.id ? 'student' : 'logo');
      renderHubStudentsPersonalCard(hubStudentsActiveProfile);
      renderHubStudentsClaimsCard(hubStudentsActiveProfile);
      renderHubStudentsClbCard(hubStudentsActiveProfile);
      renderHubStudentsReferralsCard(hubStudentsActiveProfile);
      renderHubStudentsProgramRegsCard(hubStudentsActiveProfile);
      renderHubStudentsEnrollmentsCard(hubStudentsActiveProfile);
      hubStudentsUpdateQuickActionsState(Boolean(hubStudentsActiveProfile && hubStudentsActiveProfile.id));
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      hubStudentsActiveProfile = null;
      renderHubStudentsEmptyHero();
      setHubStudentsWorkspaceView('logo');
      setHubStudentsPersonalCardError(error.message || 'Unable to load student profile.');
      renderHubStudentsClaimsCard(null);
      renderHubStudentsClbCard(null);
      renderHubStudentsReferralsCard(null);
      renderHubStudentsProgramRegsCard(null);
      renderHubStudentsEnrollmentsCard(null);
      hubStudentsUpdateQuickActionsState(false);
    }
  }

  function clearHubStudentsSuggestList() {
    const list = document.getElementById('hubStudentsSuggestList');
    if (!list) return;
    list.innerHTML = '';
    hubStudentsSuggestActiveIndex = -1;
  }

  function renderHubStudentsSuggestList(results) {
    const list = document.getElementById('hubStudentsSuggestList');
    if (!list) return;
    hubStudentsSuggestActiveIndex = -1;
    const rows = Array.isArray(results) ? results : [];
    if (!rows.length) {
      list.innerHTML = '<li class="px-3 py-2 small text-muted">No students match this search.</li>';
      return;
    }
    list.innerHTML = rows.map(function (row, index) {
      return [
        '<li>',
        '<button type="button" class="hub-students-suggest-item" data-hub-students-pick="' + escapeHtml(row.id) + '" data-hub-students-index="' + String(index) + '">',
        '<div class="fw-semibold">' + escapeHtml(row.name || row.id) + '</div>',
        '<div class="small text-muted">' + escapeHtml(row.subtitle || row.id) + '</div>',
        '</button>',
        '</li>'
      ].join('');
    }).join('');
  }

  function hubStudentsSetActiveSuggestion(index) {
    const list = document.getElementById('hubStudentsSuggestList');
    if (!list) return;
    const buttons = list.querySelectorAll('.hub-students-suggest-item');
    if (!buttons.length) return;
    const max = buttons.length - 1;
    let next = Number(index);
    if (!Number.isFinite(next)) next = -1;
    if (next < 0) next = max;
    if (next > max) next = 0;
    hubStudentsSuggestActiveIndex = next;
    buttons.forEach(function (btn, idx) {
      btn.classList.toggle('is-active', idx === hubStudentsSuggestActiveIndex);
    });
    const active = buttons[hubStudentsSuggestActiveIndex];
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest' });
    }
  }

  function readHubStudentsRecentSearches() {
    try {
      const raw = window.localStorage.getItem(HUB_STUDENTS_RECENT_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return (Array.isArray(parsed) ? parsed : [])
        .map(function (row) {
          const id = String(row?.id || '').trim();
          const name = String(row?.name || '').trim();
          if (!id) return null;
          return { id: id, name: name || id };
        })
        .filter(Boolean)
        .slice(0, HUB_STUDENTS_RECENT_MAX);
    } catch (error) {
      return [];
    }
  }

  function writeHubStudentsRecentSearches(rows) {
    try {
      window.localStorage.setItem(HUB_STUDENTS_RECENT_KEY, JSON.stringify(rows.slice(0, HUB_STUDENTS_RECENT_MAX)));
    } catch (error) {
      // ignore storage errors
    }
  }

  function rememberHubStudentsRecentSearch(row) {
    const id = String(row?.id || '').trim();
    if (!id) return;
    const name = String(row?.name || id).trim();
    const next = [{ id: id, name: name }].concat(
      readHubStudentsRecentSearches().filter(function (item) { return item.id !== id; })
    ).slice(0, HUB_STUDENTS_RECENT_MAX);
    writeHubStudentsRecentSearches(next);
    renderHubStudentsRecentSearches();
  }

  function renderHubStudentsRecentSearches() {
    const host = document.getElementById('hubStudentsRecentList');
    const block = document.getElementById('hubStudentsRecentBlock');
    if (!host) return;
    const rows = readHubStudentsRecentSearches();
    if (block) block.classList.toggle('d-none', !rows.length);
    if (!rows.length) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = rows.map(function (row) {
      const title = row.name + ' (' + row.id + ')';
      return [
        '<li>',
        '<button type="button" class="hub-students-recent-chip" title="' + escapeHtml(title) + '"',
        ' data-hub-students-recent-id="' + escapeHtml(row.id) + '" data-hub-students-recent-name="' + escapeHtml(row.name) + '">',
        escapeHtml(row.name),
        '</button>',
        '</li>'
      ].join('');
    }).join('');
  }

  function hubStudentsRenderCollapsiblePanel(panelKey, title, bodyHtml) {
    return [
      '<div class="hub-students-panel hub-students-collapsible-panel" data-hub-students-panel="' + escapeHtml(panelKey) + '">',
      '<button type="button" class="hub-students-panel-title hub-students-panel-toggle" data-hub-students-panel-toggle="' + escapeHtml(panelKey) + '" aria-expanded="false">',
      '<span class="hub-students-panel-chevron" aria-hidden="true">▸</span>',
      '<span class="flex-grow-1">' + escapeHtml(title) + '</span>',
      '</button>',
      '<div class="hub-students-panel-body is-collapsed" data-hub-students-panel-body="' + escapeHtml(panelKey) + '">',
      bodyHtml,
      '</div>',
      '</div>'
    ].join('');
  }

  function bindHubStudentsCollapsiblePanels() {
    const card = document.querySelector('[data-hub-students-card="personal"]');
    if (!card) return;
    card.querySelectorAll('[data-hub-students-panel-toggle]').forEach(function (button) {
      if (button.dataset.hubStudentsPanelBound === '1') return;
      button.dataset.hubStudentsPanelBound = '1';
      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        const key = button.getAttribute('data-hub-students-panel-toggle') || '';
        const panel = card.querySelector('[data-hub-students-panel="' + key + '"]');
        const body = card.querySelector('[data-hub-students-panel-body="' + key + '"]');
        if (!panel || !body) return;
        const willOpen = !panel.classList.contains('is-open');
        panel.classList.toggle('is-open', willOpen);
        body.classList.toggle('is-collapsed', !willOpen);
        button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      });
    });
  }

  function hubStudentsPickRow(row) {
    if (!row) return;
    const id = String(row.id || '').trim();
    const name = String(row.name || id).trim();
    const input = document.getElementById('hubStudentsSearchInput');
    if (input) input.value = name;
    clearHubStudentsSuggestList();
    rememberHubStudentsRecentSearch({ id: id, name: name });
    void loadHubStudentProfile(id);
  }

  async function runHubStudentsSearch(query) {
    const q = String(query || '').trim();
    if (q.length < HUB_STUDENTS_MIN_SEARCH) {
      clearHubStudentsSuggestList();
      return;
    }
    if (hubStudentsSearchAbort) {
      try { hubStudentsSearchAbort.abort(); } catch (error) { /* ignore */ }
    }
    hubStudentsSearchAbort = new AbortController();
    try {
      const params = new URLSearchParams();
      params.set('q', q);
      params.set('limit', '12');
      const response = await fetch('' + API_BASE + '/students/search?' + params.toString(), {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
        signal: hubStudentsSearchAbort.signal
      });
      const payload = await response.json().catch(function () {
        return { status: 'error', message: 'Search failed.' };
      });
      if (!response.ok || payload.status !== 'success') {
        throw new Error(payload.message || 'Search failed.');
      }
      renderHubStudentsSuggestList(payload.results || []);
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      renderHubStudentsSuggestList([]);
    }
  }

  function bindHubStudentsWorkspaceControls() {
    const input = document.getElementById('hubStudentsSearchInput');
    const list = document.getElementById('hubStudentsSuggestList');
    const clearBtn = document.getElementById('hubStudentsSearchClear');
    if (!input) return;

    input.addEventListener('input', function () {
      const q = String(input.value || '').trim();
      if (hubStudentsSearchTimer) clearTimeout(hubStudentsSearchTimer);
      if (q.length < HUB_STUDENTS_MIN_SEARCH) {
        clearHubStudentsSuggestList();
        return;
      }
      hubStudentsSearchTimer = setTimeout(function () {
        void runHubStudentsSearch(q);
      }, 250);
    });

    input.addEventListener('keydown', function (event) {
      const key = event.key || '';
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        if (!list || !list.querySelector('.hub-students-suggest-item')) return;
        event.preventDefault();
        const delta = key === 'ArrowDown' ? 1 : -1;
        const base = hubStudentsSuggestActiveIndex < 0 ? -1 : hubStudentsSuggestActiveIndex;
        hubStudentsSetActiveSuggestion(base + delta);
        return;
      }
      if (key === 'Enter') {
        const active = list && hubStudentsSuggestActiveIndex >= 0
          ? list.querySelectorAll('.hub-students-suggest-item')[hubStudentsSuggestActiveIndex]
          : null;
        if (active) {
          event.preventDefault();
          const id = active.getAttribute('data-hub-students-pick') || '';
          const nameEl = active.querySelector('.fw-semibold');
          hubStudentsPickRow({ id: id, name: nameEl ? nameEl.textContent : id });
        }
        return;
      }
      if (key === 'Escape') {
        clearHubStudentsSuggestList();
      }
    });

    if (list) {
      list.addEventListener('mousedown', function (event) {
        const btn = event.target && event.target.closest('[data-hub-students-pick]');
        if (!btn) return;
        event.preventDefault();
        const id = btn.getAttribute('data-hub-students-pick') || '';
        const nameEl = btn.querySelector('.fw-semibold');
        hubStudentsPickRow({ id: id, name: nameEl ? nameEl.textContent : id });
      });
    }

    const recentList = document.getElementById('hubStudentsRecentList');
    if (recentList) {
      recentList.addEventListener('click', function (event) {
        const btn = event.target && event.target.closest('[data-hub-students-recent-id]');
        if (!btn) return;
        const id = btn.getAttribute('data-hub-students-recent-id') || '';
        const name = btn.getAttribute('data-hub-students-recent-name') || id;
        hubStudentsPickRow({ id: id, name: name });
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        input.value = '';
        clearHubStudentsSuggestList();
        void loadHubStudentProfile('');
        input.focus();
      });
    }

    if (!hubStudentsDocCloseBound) {
      hubStudentsDocCloseBound = true;
      document.addEventListener('click', function hubStudentsDocClose(event) {
        if (false) return;
        const wrap = document.getElementById('hubStudentsSearchWrap');
        if (wrap && wrap.contains(event.target)) return;
        clearHubStudentsSuggestList();
      });
    }

    if (!hubStudentsCardHeightResizeBound) {
      hubStudentsCardHeightResizeBound = true;
      let resizeTimer = null;
      window.addEventListener('resize', function () {
        if (false) return;
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
          requestAnimationFrame(function () {
            hubStudentsSyncCardHeights();
          });
        }, 120);
      });
    }
  }

  function hubStudentsFormatCount(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return '—';
    return String(n.toLocaleString());
  }

  function hubStudentsPopulationStatHtml(label, value) {
    return [
      '<div class="hub-students-stat-tile">',
      '<div class="hub-students-stat-tile-label">' + escapeHtml(label) + '</div>',
      '<div class="hub-students-stat-tile-value">' + escapeHtml(hubStudentsFormatCount(value)) + '</div>',
      '</div>'
    ].join('');
  }

  let hubStudentsCardHeightResizeBound = false;

  function hubStudentsResetPairedSideCardHeights() {
    ['hubStudentsProgramRegsCard', 'hubStudentsEnrollmentsCard'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.minHeight = '';
      el.style.height = '';
    });
  }

  function hubStudentsMeasurePairedSideCardHeights() {
    const programCard = document.getElementById('hubStudentsProgramRegsCard');
    const enrollmentsCard = document.getElementById('hubStudentsEnrollmentsCard');
    const personalCard = document.querySelector('[data-hub-students-card="personal"]');
    const claimsClbPair = document.getElementById('hubStudentsClaimsClbPair');
    if (programCard && personalCard && !programCard.classList.contains('d-none')) {
      const personalHeight = personalCard.offsetHeight;
      if (personalHeight > 0) programCard.style.minHeight = personalHeight + 'px';
    }
    if (programCard) void programCard.offsetHeight;
    if (enrollmentsCard && claimsClbPair && !enrollmentsCard.classList.contains('d-none')) {
      const pairHeight = claimsClbPair.offsetHeight;
      if (pairHeight > 0) enrollmentsCard.style.minHeight = pairHeight + 'px';
    }
  }

  function hubStudentsSyncCardHeights() {
    const sideColumn = document.querySelector('.hub-students-side-pair-column');
    const mainPanel = document.getElementById('hubStudentsMainPanel');
    hubStudentsResetPairedSideCardHeights();
    if (!sideColumn || !mainPanel) {
      requestAnimationFrame(function () {
        hubStudentsMeasurePairedSideCardHeights();
      });
      return;
    }
    sideColumn.style.minHeight = '';
    const target = Math.max(sideColumn.offsetHeight, mainPanel.offsetHeight);
    if (target > 0) sideColumn.style.minHeight = target + 'px';
    requestAnimationFrame(function () {
      hubStudentsMeasurePairedSideCardHeights();
      requestAnimationFrame(function () {
        hubStudentsMeasurePairedSideCardHeights();
      });
    });
  }

  async function hubStudentsAncillaryRequestJson(url, method, payload) {
    const response = await fetch(url, {
      method: method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-AJAX-Request': 'true',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin',
      body: payload ? JSON.stringify(payload) : undefined
    });
    const result = await response.json().catch(function () {
      return {};
    });
    if (!response.ok || String(result.status || '').toLowerCase() === 'error') {
      throw new Error(result.message || 'Request failed.');
    }
    return result;
  }

  function hubStudentsMountModalToBody(el) {
    if (global.SchoolModalStack && typeof global.SchoolModalStack.mountModalToBody === 'function') {
      return global.SchoolModalStack.mountModalToBody(el);
    }
    if (!el || el.parentElement === document.body) return el;
    document.body.appendChild(el);
    return el;
  }

  function hubStudentsRaiseModalAboveStack(el) {
    if (global.SchoolModalStack && typeof global.SchoolModalStack.raiseAboveOpenModals === 'function') {
      return global.SchoolModalStack.raiseAboveOpenModals(el);
    }
    return null;
  }

  function hubStudentsClearRaisedModal(el) {
    if (global.SchoolModalStack && typeof global.SchoolModalStack.clearRaise === 'function') {
      global.SchoolModalStack.clearRaise(el);
    }
  }

  function hubStudentsShowModal(el) {
    if (!el || !global.bootstrap || !global.bootstrap.Modal) return;
    hubStudentsMountModalToBody(el);
    global.bootstrap.Modal.getOrCreateInstance(el).show();
  }

  async function hubStudentsShowSimpleMsg(title, icon, message) {
    if (global.SchoolMessageUi && typeof global.SchoolMessageUi.showAlert === 'function') {
      await global.SchoolMessageUi.showAlert(title, icon, message);
      return;
    }
    global.alert(String(message || title || 'Notice'));
  }

  function openHubStudentsPersonProfileModal(focus) {
    const profile = hubStudentsActiveProfile;
    if (!profile || !profile.id) return;
    if (!hubStudentsCanEditClb()) {
      void hubStudentsShowSimpleMsg('Permission', 'warning', 'You do not have permission to manage student contact details.');
      return;
    }
    const personId = String(profile.personId || '').trim();
    if (!personId) {
      void hubStudentsShowSimpleMsg('Unavailable', 'warning', 'This student does not have a linked person profile.');
      return;
    }
    if (!global.SchoolPersonProfileModal || typeof global.SchoolPersonProfileModal.open !== 'function') {
      void hubStudentsShowSimpleMsg('Unavailable', 'warning', 'Person profile editor is not loaded on this page.');
      return;
    }
    const studentId = String(profile.id || '').trim();
    global.SchoolPersonProfileModal.open({
      personId: personId,
      linkType: 'student',
      linkId: studentId,
      focus: String(focus || 'full').trim() || 'full',
      onSaved: function () {
        return loadHubStudentProfile(studentId);
      }
    });
  }

  function configureHubStudentsAncillaryManagers() {
    if (hubStudentsManagersConfigured) return;
    hubStudentsManagersConfigured = true;
    const canEdit = hubStudentsCanEditClb();
    const shared = {
      requestJson: hubStudentsAncillaryRequestJson,
      canEdit: canEdit,
      mountModal: hubStudentsMountModalToBody
    };
    const claimEl = document.getElementById('rollingStudentClaimNumbersModal');
    const refLinkEl = document.getElementById('rollingStudentReferralLinksModal');
    const clbEl = document.getElementById('rollingStudentClbModal');
    if (global.StudentClaimNumbersManager) {
      global.StudentClaimNumbersManager.configure({
        requestJson: shared.requestJson,
        canEdit: canEdit,
        mountModal: shared.mountModal,
        raiseModal: hubStudentsRaiseModalAboveStack,
        clearModalStack: hubStudentsClearRaisedModal,
        showModal: function () {
          hubStudentsShowModal(claimEl);
        },
        getModalEl: function () {
          return claimEl;
        }
      });
    }
    const quickReferralEl = document.getElementById('referralQuickCreateModal');
    if (global.SchoolReferralQuickCreate) {
      global.SchoolReferralQuickCreate.configure({
        requestJson: shared.requestJson,
        mountModal: shared.mountModal,
        showModal: function () {
          hubStudentsShowModal(quickReferralEl);
        },
        getModalEl: function () {
          return quickReferralEl;
        }
      });
    }
    if (global.StudentReferralLinksManager) {
      global.StudentReferralLinksManager.configure({
        requestJson: shared.requestJson,
        canEdit: canEdit,
        mountModal: shared.mountModal,
        raiseModal: hubStudentsRaiseModalAboveStack,
        clearModalStack: hubStudentsClearRaisedModal,
        showModal: function () {
          hubStudentsShowModal(refLinkEl);
        },
        getModalEl: function () {
          return refLinkEl;
        }
      });
    }
    if (global.RollingStudentClbManager) {
      global.RollingStudentClbManager.configure({
        requestJson: shared.requestJson,
        canEdit: canEdit,
        mountModal: shared.mountModal,
        raiseModal: hubStudentsRaiseModalAboveStack,
        clearModalStack: hubStudentsClearRaisedModal,
        showModal: function () {
          hubStudentsShowModal(clbEl);
        },
        getModalEl: function () {
          return clbEl;
        }
      });
    }
    if (global.SchoolStudentManagementEnrollmentClose) {
      global.SchoolStudentManagementEnrollmentClose.configure({
        requestJson: function (url, method, payload) {
          return hubStudentsAncillaryRequestJson(url, method, payload);
        },
        showMsg: hubStudentsShowSimpleMsg,
        onClosed: function () {
          const profile = hubStudentsActiveProfile;
          if (profile && profile.id) return loadHubStudentProfile(profile.id);
        }
      });
    }
    if (typeof global.installEnrollmentCloseReasonPicker === 'function') {
      global.installEnrollmentCloseReasonPicker({
        textareaId: 'close_reasonEnd',
        pickButtonId: 'btnPickCloseReasonEnd'
      });
    }
  }

  function bindHubStudentsAncillaryActions() {
    const root = document.querySelector('[data-student-management-root]');
    if (!root || root.dataset.hubStudentsAncillaryBound === '1') return;
    root.dataset.hubStudentsAncillaryBound = '1';
    root.addEventListener('click', function (event) {
      const personFocusBtn = event.target.closest('[data-hub-students-person-focus]');
      if (personFocusBtn) {
        event.preventDefault();
        openHubStudentsPersonProfileModal(personFocusBtn.getAttribute('data-hub-students-person-focus') || 'full');
        return;
      }
      const closeEnrollmentBtn = event.target.closest('[data-hub-students-close-enrollment]');
      if (closeEnrollmentBtn) {
        event.preventDefault();
        const profile = hubStudentsActiveProfile;
        const periodId = String(closeEnrollmentBtn.getAttribute('data-hub-students-close-enrollment') || '').trim();
        if (!hubStudentsCanEditClb()) return;
        if (!profile || !profile.id) return;
        const row = (Array.isArray(profile.classEnrollments) ? profile.classEnrollments : [])
          .find(function (item) { return String(item?.id || '') === periodId; });
        if (row && global.SchoolStudentManagementEnrollmentClose) {
          global.SchoolStudentManagementEnrollmentClose.openForEnrollment(row);
        }
        return;
      }
      const manageBtn = event.target.closest('[data-hub-students-manage]');
      const addBtn = event.target.closest('[data-hub-students-add]');
      const target = manageBtn || addBtn;
      if (!target) return;
      if (!hubStudentsCanEditClb()) return;
      const profile = hubStudentsActiveProfile;
      if (!profile || !profile.id) return;
      const cardKey = String(
        manageBtn ? manageBtn.getAttribute('data-hub-students-manage') : addBtn.getAttribute('data-hub-students-add')
      ).trim();
      const isAdd = Boolean(addBtn);
      const label = String(profile.name || profile.id).trim();
      const onSaved = function () {
        return loadHubStudentProfile(profile.id);
      };
      if (cardKey === 'claims' && global.StudentClaimNumbersManager) {
        global.StudentClaimNumbersManager.open({
          studentId: profile.id,
          studentLabel: label,
          openEditorOnShow: isAdd,
          onSaved: onSaved
        });
      }
      if (cardKey === 'referrals' && global.StudentReferralLinksManager) {
        global.StudentReferralLinksManager.open({
          studentId: profile.id,
          studentLabel: label,
          openEditorOnShow: isAdd,
          onSaved: onSaved
        });
      }
      if (cardKey === 'clb' && global.RollingStudentClbManager) {
        global.RollingStudentClbManager.open({
          studentId: profile.id,
          studentLabel: label,
          openEditorOnShow: isAdd,
          onSaved: onSaved
        });
      }
    });
  }

  function renderHubStudentsPopulationCard(options) {
    const body = document.getElementById('hubStudentsBannerStatsBody');
    if (!body) return;
    if (!options || options === 'loading') {
      body.className = 'text-muted small d-flex align-items-center justify-content-end';
      body.innerHTML = [
        '<span class="spinner-border spinner-border-sm text-primary me-2" role="status" aria-hidden="true"></span>',
        'Loading student counts…'
      ].join('');
      requestAnimationFrame(function () {
        hubStudentsSyncCardHeights();
      });
      return;
    }
    if (options.error) {
      body.className = 'text-danger small d-flex align-items-center justify-content-end';
      body.innerHTML = escapeHtml(options.error);
      requestAnimationFrame(function () {
        hubStudentsSyncCardHeights();
      });
      return;
    }
    const summary = options.summary && typeof options.summary === 'object' ? options.summary : {};
    body.className = 'd-flex justify-content-end';
    body.innerHTML = hubStudentsPopulationStatHtml('Total students', summary.total);
    requestAnimationFrame(function () {
      hubStudentsSyncCardHeights();
    });
  }

  async function loadHubStudentsPopulationSummary() {
    renderHubStudentsPopulationCard('loading');
    try {
      const response = await fetch('' + API_BASE + '/students/summary', {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin'
      });
      const payload = await response.json().catch(function () {
        return { status: 'error', message: 'Unable to load student counts.' };
      });
      if (!response.ok || payload.status !== 'success') {
        throw new Error(payload.message || 'Unable to load student counts.');
      }
      renderHubStudentsPopulationCard({ summary: payload.summary || {} });
    } catch (error) {
      renderHubStudentsPopulationCard({ error: error.message || 'Unable to load student counts.' });
    }
  }

  function mountStudentManagementWorkspace() {
    const workspace = document.getElementById('schoolStudentManagementWorkspace');
    if (!workspace) return;
    workspace.innerHTML = [
      '<div id="hubStudentsEmptyHero" class="hub-students-empty-hero-page" role="presentation"></div>',
      '<div class="hub-workspace-card">',
      '<div class="hub-students-workspace-toolbar">',
      '<div class="hub-students-toolbar-left">',
      '<div class="hub-students-search-wrap" id="hubStudentsSearchWrap">',
      '<div class="input-group">',
      '<span class="input-group-text"><i class="bi bi-search"></i></span>',
      '<input type="search" class="form-control" id="hubStudentsSearchInput" autocomplete="off" spellcheck="false" placeholder="Type at least 3 characters to search by name or ID..." aria-label="Search students" aria-autocomplete="list" aria-controls="hubStudentsSuggestList" aria-expanded="false">',
      '<button type="button" class="btn btn-outline-secondary" id="hubStudentsSearchClear" title="Clear selection"><i class="bi bi-x-lg"></i></button>',
      '</div>',
      '<ul class="hub-students-suggest-list" id="hubStudentsSuggestList" role="listbox"></ul>',
      '</div>',
      '<input type="hidden" id="hubStudentsSelectedId" value="' + escapeHtml(hubStudentsSelectedId) + '">',
      '<div class="hub-students-recent d-none" id="hubStudentsRecentBlock">',
      '<div class="hub-students-recent-label">Recent</div>',
      '<ul class="hub-students-recent-list" id="hubStudentsRecentList"></ul>',
      '</div>',
      '</div>',
      '<div class="hub-students-quick-actions" aria-label="Student tools">',
      '<button type="button" class="btn btn-sm btn-outline-secondary" data-hub-students-open="attendance-report" disabled>Attendance</button>',
      '<button type="button" class="btn btn-sm btn-outline-secondary" data-hub-students-open="grades-matrix" disabled>Grades</button>',
      '<button type="button" class="btn btn-sm btn-outline-secondary" data-hub-students-open="class-conduct-report" disabled>Class Conducts</button>',
      '<button type="button" class="btn btn-sm btn-outline-secondary" data-hub-students-open="person-reports" disabled>Reports</button>',
      '<button type="button" class="btn btn-sm btn-outline-secondary" data-hub-students-open="session-cases" disabled>Cases</button>',
      '<button type="button" class="btn btn-sm btn-outline-secondary" data-hub-students-open="referral-links" disabled>Referrals</button>',
      '<button type="button" class="btn btn-sm btn-outline-secondary" data-hub-students-open="timeline" disabled>Timeline</button>',
      '</div>',
      '</div>',
      '<div class="hub-students-workspace-body">',
      '<div class="hub-students-side-pair-column">',
      '<div class="hub-students-side-pair" id="hubStudentsSidePair">',
      '<section class="hub-students-side-card hub-students-program-regs-card d-none" id="hubStudentsProgramRegsCard">',
      '<div class="hub-students-side-card-header"><i class="bi bi-journal-bookmark me-2"></i>Program registrations</div>',
      '<div class="hub-students-side-card-body" id="hubStudentsProgramRegsBody"></div>',
      '</section>',
      '<section class="hub-students-side-card hub-students-enrollments-card d-none" id="hubStudentsEnrollmentsCard">',
      '<div class="hub-students-side-card-header"><i class="bi bi-collection me-2"></i>Enrollments</div>',
      '<div class="hub-students-side-card-body" id="hubStudentsEnrollmentsBody"></div>',
      '</section>',
      '</div>',
      '</div>',
      '<div class="hub-students-main-panel" id="hubStudentsMainPanel">',
      '<div class="hub-students-card-stack d-none" id="hubStudentsCardStack">',
      '<section class="hub-students-card" data-hub-students-card="personal"></section>',
      '<div class="hub-students-claims-clb-pair" id="hubStudentsClaimsClbPair">',
      '<section class="hub-students-card" data-hub-students-card="claims"></section>',
      '<section class="hub-students-card" data-hub-students-card="clb"></section>',
      '</div>',
      '<section class="hub-students-card" data-hub-students-card="referrals"></section>',
      '</div>',
      '</div>',
      '</div>',
      '</div>'
    ].join('');
    bindHubStudentsWorkspaceControls();
    bindHubStudentsQuickActions();
    configureHubStudentsAncillaryManagers();
    bindHubStudentsAncillaryActions();
    renderHubStudentsRecentSearches();
    renderHubStudentsPersonalCard(null);
    renderHubStudentsClaimsCard(null);
    renderHubStudentsClbCard(null);
    renderHubStudentsReferralsCard(null);
    renderHubStudentsProgramRegsCard(null);
    renderHubStudentsEnrollmentsCard(null);
    renderHubStudentsEmptyHero();
    setHubStudentsWorkspaceSelectionState(Boolean(hubStudentsSelectedId));
    void loadHubStudentsPopulationSummary();
    if (hubStudentsSelectedId) {
      void loadHubStudentProfile(hubStudentsSelectedId);
    }
    requestAnimationFrame(function () {
      const focusInput = document.getElementById('hubStudentsSearchInput');
      if (focusInput) focusInput.focus();
      hubStudentsSyncCardHeights();
    });
  }

  function bootStudentManagementPage() {
    mountStudentManagementWorkspace();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootStudentManagementPage);
  } else {
    bootStudentManagementPage();
  }
})(window);
