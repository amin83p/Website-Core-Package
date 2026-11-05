(function initSchoolDateRangeShortcuts(global) {
  'use strict';

  const LEGACY_TOKEN_MAP = Object.freeze({
    first15: 'm0-first',
    second15: 'm0-second',
    month: 'm0-full',
    today: 'day',
    thisweek: 'week',
    thismonth: 'm0-full',
    prevmonth: 'm-1-full',
    lastmonth: 'm-1-full',
    lastmonthfirsthalf: 'm-1-first',
    lastmonthsecondhalf: 'm-1-second'
  });

  function formatDateLocal(d) {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function normalizeRangeToken(range) {
    const key = String(range || '').trim();
    if (!key) return '';
    const lower = key.toLowerCase();
    if (lower === 'alltime' || lower === 'all_time') return 'allTime';
    if (Object.prototype.hasOwnProperty.call(LEGACY_TOKEN_MAP, lower)) {
      return LEGACY_TOKEN_MAP[lower];
    }
    if (Object.prototype.hasOwnProperty.call(LEGACY_TOKEN_MAP, key)) {
      return LEGACY_TOKEN_MAP[key];
    }
    return key;
  }

  function resolveRangeDates(range) {
    const token = normalizeRangeToken(range);
    if (token === 'allTime') return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (token === 'day') {
      return { start: new Date(today), end: new Date(today) };
    }
    if (token === 'week') {
      const start = new Date(today);
      const end = new Date(today);
      const day = today.getDay() || 7;
      if (day !== 1) start.setDate(today.getDate() - (day - 1));
      end.setTime(start.getTime() + (6 * 24 * 60 * 60 * 1000));
      return { start, end };
    }
    const monthMatch = /^m(-?\d+)-(first|second|full)$/.exec(token);
    if (monthMatch) {
      const monthOffset = Number(monthMatch[1]);
      const part = monthMatch[2];
      const anchor = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
      const year = anchor.getFullYear();
      const month = anchor.getMonth();
      if (part === 'first') {
        return { start: new Date(year, month, 1), end: new Date(year, month, 15) };
      }
      if (part === 'second') {
        return { start: new Date(year, month, 16), end: new Date(year, month + 1, 0) };
      }
      return { start: new Date(year, month, 1), end: new Date(year, month + 1, 0) };
    }
    if (token === 'season') {
      const start = new Date(today);
      const end = new Date(today);
      end.setMonth(start.getMonth() + 3);
      return { start, end };
    }
    if (token === 'year') {
      return {
        start: new Date(today.getFullYear(), 0, 1),
        end: new Date(today.getFullYear(), 11, 31)
      };
    }
    return null;
  }

  function datesFromRangeToken(range) {
    const token = normalizeRangeToken(range);
    if (token === 'allTime') {
      return { token, startDate: '', endDate: '' };
    }
    const bounds = resolveRangeDates(token);
    if (!bounds) {
      return { token, startDate: '', endDate: '' };
    }
    return {
      token,
      startDate: formatDateLocal(bounds.start),
      endDate: formatDateLocal(bounds.end)
    };
  }

  function resolveMenuElement(menuElOrId) {
    if (!menuElOrId) return null;
    if (typeof menuElOrId === 'string') return document.getElementById(menuElOrId);
    return menuElOrId;
  }

  function setActiveMenuOption(menuElOrId, range) {
    const menuEl = resolveMenuElement(menuElOrId);
    if (!menuEl) return;
    const token = normalizeRangeToken(range);
    menuEl.querySelectorAll('.schedule-date-range-option').forEach((btn) => {
      const isActive = String(btn.getAttribute('data-range') || '').trim() === token;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  }

  function getActiveRangeToken(menuElOrId) {
    const menuEl = resolveMenuElement(menuElOrId);
    if (!menuEl) return '';
    const active = menuEl.querySelector('.schedule-date-range-option.active');
    return active ? String(active.getAttribute('data-range') || '').trim() : '';
  }

  function clearActiveMenuOption(menuElOrId) {
    setActiveMenuOption(menuElOrId, '__none__');
    const menuEl = resolveMenuElement(menuElOrId);
    if (!menuEl) return;
    menuEl.querySelectorAll('.schedule-date-range-option').forEach((btn) => {
      btn.classList.remove('active');
      btn.setAttribute('aria-checked', 'false');
    });
  }

  function bindDateRangeShortcuts(config = {}) {
    const menuEl = document.getElementById(String(config.menuId || 'scheduleDateRangeMenu'));
    const shortcutsBtn = document.getElementById(String(config.buttonId || 'btn_scheduleDateShortcuts'));
    const startEl = document.getElementById(String(config.startInputId || 'sch_startDate'));
    const endEl = document.getElementById(String(config.endInputId || 'sch_endDate'));
    if (!menuEl) return null;

    let dismissCleanup = null;

    const isMenuTarget = (target) => {
      if (!target || !menuEl) return false;
      if (target === menuEl || menuEl.contains(target)) return true;
      if (shortcutsBtn && (target === shortcutsBtn || shortcutsBtn.contains(target))) return true;
      return false;
    };

    const hideMenu = () => {
      menuEl.hidden = true;
      menuEl.classList.remove('is-open');
      if (shortcutsBtn) shortcutsBtn.setAttribute('aria-expanded', 'false');
      if (typeof dismissCleanup === 'function') {
        dismissCleanup();
        dismissCleanup = null;
      }
    };

    const clampMenuPosition = (left, top) => {
      menuEl.style.left = `${left}px`;
      menuEl.style.top = `${top}px`;
      requestAnimationFrame(() => {
        const rect = menuEl.getBoundingClientRect();
        let nextLeft = left;
        let nextTop = top;
        if (rect.right > window.innerWidth - 8) nextLeft = Math.max(8, window.innerWidth - rect.width - 8);
        if (rect.bottom > window.innerHeight - 8) nextTop = Math.max(8, window.innerHeight - rect.height - 8);
        if (rect.left < 8) nextLeft = 8;
        if (rect.top < 8) nextTop = 8;
        menuEl.style.left = `${nextLeft}px`;
        menuEl.style.top = `${nextTop}px`;
      });
    };

    const showMenuAt = (left, top) => {
      menuEl.hidden = false;
      menuEl.classList.add('is-open');
      clampMenuPosition(left, top);
      if (shortcutsBtn) shortcutsBtn.setAttribute('aria-expanded', 'true');
      if (dismissCleanup) return;
      const onOutside = (event) => {
        if (menuEl.hidden) return;
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        if (path.includes(menuEl) || (shortcutsBtn && path.includes(shortcutsBtn))) return;
        if (isMenuTarget(event.target)) return;
        hideMenu();
      };
      const onKey = (event) => {
        if (event.key === 'Escape') hideMenu();
      };
      const onScroll = (event) => {
        if (menuEl.hidden) return;
        if (isMenuTarget(event.target)) return;
        hideMenu();
      };
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey);
      window.addEventListener('scroll', onScroll, true);
      dismissCleanup = () => {
        document.removeEventListener('pointerdown', onOutside, true);
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('scroll', onScroll, true);
      };
    };

    const applyToken = (rawRange) => {
      const payload = datesFromRangeToken(rawRange);
      setActiveMenuOption(menuEl, payload.token);
      if (startEl) startEl.value = payload.startDate;
      if (endEl) endEl.value = payload.endDate;
      if (typeof config.onApply === 'function') {
        config.onApply(payload);
      }
    };

    menuEl.querySelectorAll('.schedule-date-range-option').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        applyToken(event.currentTarget.getAttribute('data-range') || 'week');
        hideMenu();
      });
    });

    shortcutsBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!menuEl.hidden && menuEl.classList.contains('is-open')) {
        hideMenu();
        return;
      }
      const rect = shortcutsBtn.getBoundingClientRect();
      showMenuAt(rect.left, rect.bottom + 4);
    });

    const onDateContextMenu = (event) => {
      event.preventDefault();
      showMenuAt(event.clientX, event.clientY);
    };
    startEl?.addEventListener('contextmenu', onDateContextMenu);
    endEl?.addEventListener('contextmenu', onDateContextMenu);

    if (config.clearActiveOnManualChange !== false) {
      const onManualDateEdit = () => clearActiveMenuOption(menuEl);
      startEl?.addEventListener('change', onManualDateEdit);
      endEl?.addEventListener('change', onManualDateEdit);
    }

    return {
      applyToken,
      hideMenu,
      menuEl
    };
  }

  global.SchoolDateRangeShortcuts = {
    normalizeRangeToken,
    resolveRangeDates,
    datesFromRangeToken,
    formatDateLocal,
    setActiveMenuOption,
    getActiveRangeToken,
    clearActiveMenuOption,
    bindDateRangeShortcuts
  };
}(window));
