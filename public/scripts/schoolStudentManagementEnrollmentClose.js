(function (global) {
  'use strict';

  let deps = {
    requestJson: null,
    showMsg: null,
    onClosed: null
  };
  let approvedCloseStatusPayload = null;
  let wired = false;
  let pendingRow = null;

  function qs(id) {
    return document.getElementById(id);
  }

  function clean(value) {
    return String(value || '').trim();
  }

  function todayIso() {
    if (global.AppOrgDateTime && global.AppOrgDateTime.today) {
      return String(global.AppOrgDateTime.today);
    }
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }

  function showModal(el) {
    if (!el || !global.bootstrap?.Modal) return;
    if (el.parentElement !== document.body) document.body.appendChild(el);
    global.bootstrap.Modal.getOrCreateInstance(el).show();
  }

  function hideModal(el) {
    if (!el || !global.bootstrap?.Modal) return;
    global.bootstrap.Modal.getOrCreateInstance(el).hide();
  }

  function syncCloseModalUi() {
    const targetStatus = clean(qs('close_status')?.value || 'completed').toLowerCase();
    const isWithdrawn = targetStatus === 'withdrawn';
    const previewBtn = qs('btn_previewClosePeriod');
    const previewPanel = qs('close_statusPreview');
    previewBtn?.classList.toggle('d-none', isWithdrawn);
    previewPanel?.classList.toggle('d-none', isWithdrawn);
    approvedCloseStatusPayload = null;
    if (isWithdrawn) {
      syncCloseModalWithdrawnConfirmState();
    } else if (qs('btn_confirmClosePeriod')) {
      qs('btn_confirmClosePeriod').disabled = true;
      if (previewPanel) {
        previewPanel.className = 'alert alert-light border mt-3 mb-0';
        previewPanel.textContent = 'Preview the financial effect before applying the status change.';
      }
    }
  }

  function syncCloseModalWithdrawnConfirmState() {
    const periodId = clean(qs('close_periodId')?.value);
    const effectiveDate = clean(qs('close_endDate')?.value);
    const reason = clean(qs('close_reasonEnd')?.value);
    const confirmBtn = qs('btn_confirmClosePeriod');
    if (!confirmBtn) return;
    confirmBtn.disabled = !(periodId && effectiveDate && reason);
  }

  function readCloseStatusPayload() {
    return {
      targetStatus: clean(qs('close_status')?.value || 'completed').toLowerCase(),
      effectiveDate: clean(qs('close_endDate')?.value),
      reason: clean(qs('close_reasonEnd')?.value)
    };
  }

  async function previewClosePeriod() {
    const periodId = clean(qs('close_periodId')?.value);
    const payload = readCloseStatusPayload();
    if (!periodId || !payload.effectiveDate || !payload.reason) {
      if (deps.showMsg) await deps.showMsg('Close Enrollment', 'warning', 'Period, effective date, and reason are required.');
      return;
    }
    try {
      const result = await deps.requestJson(
        `/school/classes/api/enrollment-periods/${encodeURIComponent(periodId)}/status/preview`,
        'POST',
        payload
      );
      approvedCloseStatusPayload = payload;
      if (qs('btn_confirmClosePeriod')) qs('btn_confirmClosePeriod').disabled = false;
      const preview = result.preview || {};
      const panel = qs('close_statusPreview');
      if (panel) {
        panel.className = 'alert alert-info mt-3 mb-0';
        panel.textContent = payload.targetStatus === 'cancelled'
          ? `Cancellation will reverse ${(preview.sourceTransactions || []).length} charge transaction(s), total ${Number(preview.adjustmentTotal || 0).toFixed(2)}. Payments will remain unchanged.`
          : (payload.targetStatus === 'archived'
            ? 'Archival will leave financial transactions unchanged.'
            : 'Completion will leave financial transactions unchanged.');
      }
    } catch (error) {
      approvedCloseStatusPayload = null;
      if (qs('btn_confirmClosePeriod')) qs('btn_confirmClosePeriod').disabled = true;
      if (deps.showMsg) await deps.showMsg('Close Enrollment', 'warning', error.message || 'Unable to prepare status preview.');
    }
  }

  async function submitClosePeriod() {
    const periodId = clean(qs('close_periodId')?.value);
    const payload = readCloseStatusPayload();
    try {
      if (payload.targetStatus === 'withdrawn') {
        if (!periodId || !payload.effectiveDate || !payload.reason) {
          if (deps.showMsg) await deps.showMsg('Close Enrollment', 'warning', 'Period, effective date, and reason are required.');
          return;
        }
        await deps.requestJson(`/school/classes/api/enrollment-periods/${encodeURIComponent(periodId)}/close`, 'POST', {
          status: 'withdrawn',
          endDate: payload.effectiveDate,
          reasonEnd: payload.reason
        });
      } else {
        if (!approvedCloseStatusPayload
          || JSON.stringify(payload) !== JSON.stringify(approvedCloseStatusPayload)) {
          if (deps.showMsg) await deps.showMsg('Close Enrollment', 'warning', 'Preview the current status, date, and reason before applying.');
          if (qs('btn_confirmClosePeriod')) qs('btn_confirmClosePeriod').disabled = true;
          return;
        }
        await deps.requestJson(
          `/school/classes/api/enrollment-periods/${encodeURIComponent(periodId)}/status/apply`,
          'POST',
          payload
        );
      }
      hideModal(qs('closePeriodModal'));
      if (deps.showMsg) await deps.showMsg('Close Enrollment', 'success', 'Enrollment status updated.');
      if (typeof deps.onClosed === 'function') {
        await deps.onClosed(pendingRow);
      }
    } catch (error) {
      if (deps.showMsg) await deps.showMsg('Close Enrollment', 'warning', error.message || 'Unable to update enrollment status.');
    }
  }

  function wireEventsOnce() {
    if (wired) return;
    wired = true;
    qs('btn_previewClosePeriod')?.addEventListener('click', function () { void previewClosePeriod(); });
    qs('btn_confirmClosePeriod')?.addEventListener('click', function () { void submitClosePeriod(); });
    qs('close_status')?.addEventListener('change', syncCloseModalUi);
    qs('close_endDate')?.addEventListener('input', function () {
      if (clean(qs('close_status')?.value).toLowerCase() === 'withdrawn') syncCloseModalWithdrawnConfirmState();
      else {
        approvedCloseStatusPayload = null;
        if (qs('btn_confirmClosePeriod')) qs('btn_confirmClosePeriod').disabled = true;
      }
    });
    qs('close_reasonEnd')?.addEventListener('input', function () {
      if (clean(qs('close_status')?.value).toLowerCase() === 'withdrawn') syncCloseModalWithdrawnConfirmState();
      else {
        approvedCloseStatusPayload = null;
        if (qs('btn_confirmClosePeriod')) qs('btn_confirmClosePeriod').disabled = true;
      }
    });
  }

  function configure(nextDeps) {
    deps = { ...deps, ...nextDeps };
    wireEventsOnce();
  }

  function openForEnrollment(row) {
    if (!row || !row.id) return;
    pendingRow = row;
    approvedCloseStatusPayload = null;
    if (qs('close_periodId')) qs('close_periodId').value = clean(row.id);
    if (qs('close_endDate')) qs('close_endDate').value = clean(row.endDate) || todayIso();
    if (qs('close_status')) qs('close_status').value = 'completed';
    if (qs('close_reasonEnd')) qs('close_reasonEnd').value = '';
    syncCloseModalUi();
    showModal(qs('closePeriodModal'));
  }

  global.SchoolStudentManagementEnrollmentClose = {
    configure,
    openForEnrollment
  };
})(typeof window !== 'undefined' ? window : global);