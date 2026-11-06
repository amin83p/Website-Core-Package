(function initSchoolRollingEnrollmentDeepLink(global) {
  'use strict';

  const MENU_ID = 'schoolRollingEnrollmentContextMenu';

  /**
   * @param {string} classId
   * @param {{ studentName?: string }} [opts]
   * @returns {string}
   */
  function buildRollingEnrollmentUrl(classId, opts = {}) {
    const id = String(classId || '').trim();
    if (!id) return '';
    const base = `/school/classes/${encodeURIComponent(id)}/rolling-enrollment`;
    const name = String(opts.studentName || '').trim();
    if (!name) return base;
    const params = new URLSearchParams();
    params.set('q', name);
    params.set('searchFields', 'studentLabel');
    params.set('type', 'contains');
    return `${base}?${params.toString()}`;
  }

  function readAccessFlag() {
    const bag = global.__schoolRollingEnrollmentAccess;
    if (bag && typeof bag.canOpen === 'boolean') return bag.canOpen;
    return false;
  }

  function ensureMenu() {
    let menu = document.getElementById(MENU_ID);
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.setAttribute('role', 'menu');
    menu.className = 'dropdown-menu shadow py-1 show position-fixed d-none';
    menu.style.zIndex = '1080';
    menu.style.minWidth = '220px';
    menu.innerHTML = ''
      + '<button type="button" class="dropdown-item" data-action="student">Rolling enrollment for this student</button>'
      + '<button type="button" class="dropdown-item" data-action="class">Open rolling enrollment</button>';
    document.body.appendChild(menu);

    document.addEventListener('click', (ev) => {
      if (!menu.classList.contains('d-none') && !menu.contains(ev.target)) {
        menu.classList.add('d-none');
      }
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') menu.classList.add('d-none');
    });
    global.addEventListener('scroll', () => menu.classList.add('d-none'), true);

    return menu;
  }

  function positionMenu(menu, clientX, clientY) {
    const pad = 8;
    const vw = global.innerWidth || 1024;
    const vh = global.innerHeight || 768;
    menu.style.visibility = 'hidden';
    menu.classList.remove('d-none');
    const rect = menu.getBoundingClientRect();
    let left = clientX;
    let top = clientY;
    if (left + rect.width > vw - pad) left = Math.max(pad, vw - rect.width - pad);
    if (top + rect.height > vh - pad) top = Math.max(pad, vh - rect.height - pad);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.visibility = '';
  }

  /**
   * @param {{
   *   root?: Document|Element,
   *   canOpenRollingEnrollment?: boolean,
   *   resolveContext: (event: MouseEvent) => null | { classId: string, registrationMode: string, studentName?: string }
   * }} options
   */
  function initRollingEnrollmentContextMenu(options = {}) {
    const root = options.root || document;
    const canOpen = typeof options.canOpenRollingEnrollment === 'boolean'
      ? options.canOpenRollingEnrollment
      : readAccessFlag();
    const resolveContext = options.resolveContext;
    if (!canOpen || typeof resolveContext !== 'function') return;

    const menu = ensureMenu();
    const btnStudent = menu.querySelector('[data-action="student"]');
    const btnClass = menu.querySelector('[data-action="class"]');

    root.addEventListener('contextmenu', (event) => {
      const tag = String(event.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || event.target?.isContentEditable) return;

      let ctx;
      try {
        ctx = resolveContext(event);
      } catch (_) {
        ctx = null;
      }
      if (!ctx || !ctx.classId) return;
      const mode = String(ctx.registrationMode || '').trim().toLowerCase();
      if (mode !== 'rolling') return;

      event.preventDefault();
      const studentName = String(ctx.studentName || '').trim();
      const showStudent = Boolean(studentName);
      if (btnStudent) btnStudent.classList.toggle('d-none', !showStudent);

      const openClass = () => {
        const url = buildRollingEnrollmentUrl(ctx.classId);
        if (url) global.open(url, '_blank', 'noopener,noreferrer');
        menu.classList.add('d-none');
      };
      const openStudent = () => {
        const url = buildRollingEnrollmentUrl(ctx.classId, { studentName });
        if (url) global.open(url, '_blank', 'noopener,noreferrer');
        menu.classList.add('d-none');
      };

      if (btnClass) {
        btnClass.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          openClass();
        };
      }
      if (btnStudent) {
        btnStudent.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!showStudent) return;
          openStudent();
        };
      }

      positionMenu(menu, event.clientX, event.clientY);
    });
  }

  global.SchoolRollingEnrollmentDeepLink = {
    buildRollingEnrollmentUrl,
    initRollingEnrollmentContextMenu
  };
}(typeof window !== 'undefined' ? window : globalThis));
