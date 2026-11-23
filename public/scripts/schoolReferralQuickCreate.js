(function (global) {
  'use strict';

  let deps = {
    requestJson: null,
    showMsg: null,
    mountModal: null,
    showModal: null,
    getModalEl: null
  };

  let referringOrganizations = [];
  let context = { onCreated: null };
  let wired = false;

  function qs(id) {
    return document.getElementById(id);
  }

  function stack() {
    return global.SchoolModalStack || null;
  }

  function setAlert(text) {
    const el = qs('quickReferral_alert');
    if (!el) return;
    if (!text) {
      el.textContent = '';
      el.classList.add('d-none');
      return;
    }
    el.textContent = text;
    el.classList.remove('d-none');
  }

  function renderOrganizations() {
    const wrap = qs('quickReferral_orgs');
    if (!wrap) return;
    const rows = Array.isArray(referringOrganizations) ? referringOrganizations : [];
    if (!rows.length) {
      wrap.innerHTML = '<div class="col-12 text-muted small">No organization options loaded.</div>';
      return;
    }
    wrap.innerHTML = rows.map((org) => {
      const id = String(org?.id || '').trim();
      const label = String(org?.label || id).trim();
      return `<div class="col-md-6"><div class="form-check">
        <input class="form-check-input quick-referral-org" type="checkbox" value="${id}" id="quick_ref_org_${id}">
        <label class="form-check-label small" for="quick_ref_org_${id}">${label}</label>
      </div></div>`;
    }).join('');
  }

  function resetForm() {
    [
      'quickReferral_firstName', 'quickReferral_middleName', 'quickReferral_lastName',
      'quickReferral_email', 'quickReferral_phone', 'quickReferral_notes',
      'quickReferral_addrLine1', 'quickReferral_addrCity', 'quickReferral_addrProvince', 'quickReferral_addrPostal'
    ].forEach((id) => {
      const el = qs(id);
      if (el) el.value = '';
    });
    if (qs('quickReferral_gender')) qs('quickReferral_gender').value = '';
    if (qs('quickReferral_dob')) qs('quickReferral_dob').value = '2000-01-01';
    if (qs('quickReferral_personMode')) qs('quickReferral_personMode').value = 'new';
    document.querySelectorAll('.quick-referral-org').forEach((el) => { el.checked = false; });
    setAlert('');
  }

  async function loadOrganizations() {
    if (!deps.requestJson) return;
    try {
      const result = await deps.requestJson('/school/students/api/referral-link-options');
      referringOrganizations = Array.isArray(result?.data?.referringOrganizations)
        ? result.data.referringOrganizations
        : [];
    } catch (_) {
      referringOrganizations = [];
    }
    renderOrganizations();
  }

  async function saveReferral() {
    setAlert('');
    const organizationIds = Array.from(document.querySelectorAll('.quick-referral-org:checked'))
      .map((el) => String(el.value || '').trim())
      .filter(Boolean);
    if (!organizationIds.length) {
      setAlert('Select at least one organization.');
      return;
    }

    const first = String(qs('quickReferral_firstName')?.value || '').trim();
    const middle = String(qs('quickReferral_middleName')?.value || '').trim();
    const last = String(qs('quickReferral_lastName')?.value || '').trim();
    const gender = String(qs('quickReferral_gender')?.value || '').trim();
    const dateOfBirth = String(qs('quickReferral_dob')?.value || '').trim() || '2000-01-01';
    const email = String(qs('quickReferral_email')?.value || '').trim();
    const phone = String(qs('quickReferral_phone')?.value || '').trim();
    const line1 = String(qs('quickReferral_addrLine1')?.value || '').trim();
    const city = String(qs('quickReferral_addrCity')?.value || '').trim();
    const province = String(qs('quickReferral_addrProvince')?.value || '').trim();
    const postalCode = String(qs('quickReferral_addrPostal')?.value || '').trim();

    if (!first || !last) {
      setAlert('First and last name are required.');
      return;
    }
    if (!gender) {
      setAlert('Gender is required.');
      return;
    }
    if (!email) {
      setAlert('Email address is required.');
      return;
    }

    const hasAddress = line1 || city || province || postalCode;
    const payload = {
      personMode: 'new',
      status: 'Active',
      notes: String(qs('quickReferral_notes')?.value || '').trim(),
      organizationIdsJson: JSON.stringify(organizationIds),
      newPersonActive: 'true',
      newPersonFirstName: first,
      newPersonMiddleName: middle,
      newPersonLastName: last,
      newPersonGender: gender,
      newPersonDateOfBirth: dateOfBirth,
      newPersonEmails: JSON.stringify([{ type: 'primary', email, isPrimary: true }]),
      newPersonPhones: phone
        ? JSON.stringify([{ type: 'mobile', number: phone }])
        : '[]',
      newPersonAddresses: hasAddress
        ? JSON.stringify([{ type: 'home', line1, city, province, postalCode }])
        : '[]'
    };

    const btn = qs('btn_quickReferralSave');
    const original = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';
    }
    try {
      const response = await fetch('/school/referrals/api/quick-create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-AJAX-Request': 'true',
          'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || String(result.status || '').toLowerCase() !== 'success') {
        const detail = String(result?.message || '').trim()
          || (response.status === 403 ? 'Permission or security token rejected. You may need referral create access.' : '');
        throw new Error(detail || `Unable to save referral (${response.status}).`);
      }
      const modalEl = typeof deps.getModalEl === 'function' ? deps.getModalEl() : qs('referralQuickCreateModal');
      if (global.bootstrap?.Modal && modalEl) {
        global.bootstrap.Modal.getInstance(modalEl)?.hide();
      }
      if (typeof context.onCreated === 'function') {
        await context.onCreated(result.referral || { id: result.referralId, label: '' });
      }
    } catch (error) {
      setAlert(error.message || 'Unable to save referral.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = original;
      }
    }
  }

  function defaultShowModal(modalEl) {
    if (!modalEl) return;
    const mount = deps.mountModal || stack()?.mountModalToBody;
    if (typeof mount === 'function') mount(modalEl);
    if (global.bootstrap?.Modal) {
      global.bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  }

  function wireEventsOnce() {
    if (wired) return;
    wired = true;
    qs('btn_quickReferralSave')?.addEventListener('click', () => { void saveReferral(); });
    const modalEl = typeof deps.getModalEl === 'function' ? deps.getModalEl() : qs('referralQuickCreateModal');
    modalEl?.addEventListener('shown.bs.modal', () => {
      const raise = stack()?.raiseAboveOpenModals;
      if (raise) raise(modalEl);
    });
    modalEl?.addEventListener('hidden.bs.modal', () => {
      stack()?.clearRaise?.(modalEl);
      resetForm();
      context = { onCreated: null };
    });
  }

  async function open(options = {}) {
    wireEventsOnce();
    context = { onCreated: typeof options.onCreated === 'function' ? options.onCreated : null };
    resetForm();
    await loadOrganizations();
    const modalEl = typeof deps.getModalEl === 'function' ? deps.getModalEl() : qs('referralQuickCreateModal');
    if (typeof deps.showModal === 'function') {
      deps.showModal();
    } else {
      defaultShowModal(modalEl);
    }
  }

  function configure(nextDeps = {}) {
    deps = { ...deps, ...nextDeps };
    wireEventsOnce();
  }

  global.SchoolReferralQuickCreate = {
    configure,
    open
  };
})(typeof window !== 'undefined' ? window : global);