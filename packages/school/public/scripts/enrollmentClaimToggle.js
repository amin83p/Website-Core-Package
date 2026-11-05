(function initEnrollmentClaimToggle(global) {
  'use strict';

  const DEFAULT_BUTTON_ID = 'btn_toggleEnrollmentClaims';

  let config = {
    page: '',
    buttonId: DEFAULT_BUTTON_ID,
    getWindow: null
  };
  let ready = false;
  let visible = false;
  let fetched = false;
  let claimsByKey = {};
  let fetchPromise = null;
  let lastWindowKey = '';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function wrapNameHtml(nameHtml, ids = {}) {
    const personId = String(ids.personId || '').trim();
    const studentRecordId = String(ids.studentRecordId || '').trim();
    return `<div class="js-enrollment-claim-host" data-person-id="${escapeHtml(personId)}" data-student-record-id="${escapeHtml(studentRecordId)}">${nameHtml}<div class="js-enrollment-claim-line x-small text-muted mt-1" hidden></div></div>`;
  }

  function currentWindow() {
    if (typeof config.getWindow === 'function') {
      const win = config.getWindow() || {};
      return {
        classId: String(win.classId || '').trim(),
        startDate: String(win.startDate || '').trim(),
        endDate: String(win.endDate || '').trim()
      };
    }
    return { classId: '', startDate: '', endDate: '' };
  }

  function windowKey(win) {
    return [config.page, win.classId || '', win.startDate || '', win.endDate || ''].join('|');
  }

  function resetCache() {
    fetched = false;
    visible = false;
    claimsByKey = {};
    fetchPromise = null;
  }

  function collectStudentsFromHosts() {
    const hosts = document.querySelectorAll('.js-enrollment-claim-host');
    const seen = new Set();
    const students = [];
    hosts.forEach((el) => {
      const personId = String(el.getAttribute('data-person-id') || '').trim();
      const studentRecordId = String(el.getAttribute('data-student-record-id') || '').trim();
      if (!personId && !studentRecordId) return;
      const key = `${personId}|${studentRecordId}`;
      if (seen.has(key)) return;
      seen.add(key);
      students.push({ personId, studentRecordId });
    });
    return students;
  }

  function lookupClaim(host) {
    const personId = String(host.getAttribute('data-person-id') || '').trim();
    const studentRecordId = String(host.getAttribute('data-student-record-id') || '').trim();
    if (personId && claimsByKey[personId]) return claimsByKey[personId];
    if (studentRecordId && claimsByKey[studentRecordId]) return claimsByKey[studentRecordId];
    return null;
  }

  function applyClaimsToHosts() {
    document.querySelectorAll('.js-enrollment-claim-host').forEach((host) => {
      const line = host.querySelector('.js-enrollment-claim-line');
      if (!line) return;
      const displayLine = String(lookupClaim(host)?.displayLine || '').trim();
      if (!displayLine) {
        line.textContent = '';
        line.hidden = true;
        return;
      }
      line.textContent = displayLine;
      line.hidden = !visible;
    });
  }

  function notReadyLabel() {
    return String(config.page || '').includes('matrix') ? 'Load the matrix first' : 'Load the report first';
  }

  function setButtonState() {
    const btn = document.getElementById(config.buttonId);
    if (!btn) return;
    btn.disabled = !ready;
    const label = ready
      ? (visible ? 'Hide claim numbers' : 'Show claim numbers')
      : notReadyLabel();
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = '<i class="bi bi-card-text" aria-hidden="true"></i>';
  }

  function mergeClaims(nextClaims) {
    const incoming = nextClaims && typeof nextClaims === 'object' ? nextClaims : {};
    Object.keys(incoming).forEach((key) => {
      claimsByKey[key] = incoming[key];
    });
  }

  function studentNeedsFetch(student) {
    const personId = String(student.personId || '').trim();
    const studentRecordId = String(student.studentRecordId || '').trim();
    if (personId && Object.prototype.hasOwnProperty.call(claimsByKey, personId)) return false;
    if (studentRecordId && Object.prototype.hasOwnProperty.call(claimsByKey, studentRecordId)) return false;
    return true;
  }

  async function fetchClaims(students) {
    const win = currentWindow();
    const body = {
      page: config.page,
      classId: win.classId,
      startDate: win.startDate,
      endDate: win.endDate,
      students
    };
    const res = await fetch('/school/enrollment-claims/api/window', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-AJAX-Request': 'true'
      },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.status !== 'success') {
      throw new Error(result.message || 'Could not load claim numbers.');
    }
    mergeClaims(result.claims);
    fetched = true;
  }

  async function showError(message) {
    const text = String(message || 'Could not load claim numbers.');
    if (typeof global.showMessageModal === 'function') {
      await global.showMessageModal({
        title: 'Claim Numbers',
        icon: 'error',
        message: text,
        buttons: [{ text: 'OK', class: 'btn-secondary' }]
      });
      return;
    }
    alert(text);
  }

  async function ensureFetched() {
    const students = collectStudentsFromHosts();
    const needed = fetched ? students.filter(studentNeedsFetch) : students;
    if (!needed.length) {
      fetched = true;
      return;
    }
    if (!fetchPromise) {
      fetchPromise = fetchClaims(needed).finally(() => {
        fetchPromise = null;
      });
    }
    await fetchPromise;
  }

  async function onClick() {
    if (!ready) return;
    if (!fetched) {
      const btn = document.getElementById(config.buttonId);
      if (btn) btn.disabled = true;
      try {
        await ensureFetched();
        visible = true;
        applyClaimsToHosts();
      } catch (error) {
        fetched = false;
        await showError(error.message);
      } finally {
        setButtonState();
      }
      return;
    }
    visible = !visible;
    applyClaimsToHosts();
    setButtonState();
  }

  function setReady(isReady) {
    const win = currentWindow();
    const key = windowKey(win);
    if (key !== lastWindowKey) {
      resetCache();
      lastWindowKey = key;
    }
    ready = Boolean(isReady);
    if (ready && fetched) {
      applyClaimsToHosts();
      if (visible) {
        ensureFetched().then(applyClaimsToHosts).catch(() => null);
      }
    }
    setButtonState();
  }

  function afterRender() {
    if (!ready) return;
    applyClaimsToHosts();
    if (fetched) {
      ensureFetched().then(applyClaimsToHosts).catch(() => null);
    }
  }

  function init(options = {}) {
    config = {
      page: String(options.page || config.page || '').trim(),
      buttonId: String(options.buttonId || config.buttonId || DEFAULT_BUTTON_ID).trim(),
      getWindow: typeof options.getWindow === 'function' ? options.getWindow : config.getWindow
    };
    const btn = document.getElementById(config.buttonId);
    if (btn && btn.dataset.enrollmentClaimBound !== '1') {
      btn.dataset.enrollmentClaimBound = '1';
      btn.addEventListener('click', () => {
        onClick().catch(() => null);
      });
    }
    setButtonState();
  }

  global.EnrollmentClaimToggle = {
    init,
    setReady,
    wrapNameHtml,
    afterRender
  };
}(typeof window !== 'undefined' ? window : globalThis));
