(function initSchoolPersonProfileModal(global) {
  'use strict';

  const modalEl = () => document.getElementById('schoolPersonProfileEditModal');
  const formEl = () => document.getElementById('schoolPersonProfileEditForm');
  const loadingEl = () => document.getElementById('schoolPersonProfileEditLoading');
  const alertEl = () => document.getElementById('schoolPersonProfileEditAlert');
  const saveBtn = () => document.getElementById('schoolPersonProfileSaveBtn');

  let modalInstance = null;
  let currentContext = null;
  let emails = [];
  let phones = [];
  let addresses = [];
  let organizations = [];
  let organizationLookup = {};
  let addressDebounceTimer = null;
  let wired = false;

  function safeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizePersonRoles(org) {
    if (global.SchoolRoleDisplay && typeof global.SchoolRoleDisplay.filterSchoolPackageOrgRoles === 'function') {
      return global.SchoolRoleDisplay.filterSchoolPackageOrgRoles(org);
    }
    const roles = [];
    if (Array.isArray(org?.roles)) roles.push(...org.roles);
    else if (org?.role) roles.push(org.role);
    return Array.from(new Set(roles.map((role) => String(role || '').trim().toLowerCase()).filter(Boolean)))
      .filter((role) => /^school_(student|teacher|staff)$/.test(role));
  }

  function formatRoleLabel(role) {
    return String(role || '')
      .replace(/^school_/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  function getOrganizationDisplayName(org) {
    const id = String(org?.orgId || org?.organizationId || org?.id || '').trim();
    const lookupName = id ? String(organizationLookup[id] || '').trim() : '';
    const name = String(org?.name || org?.orgName || lookupName || '').trim();
    return name || id || 'Unknown Organization';
  }

  function renderRoleSummary(container, orgRows, lookup) {
    if (!container) return;
    organizationLookup = (lookup && typeof lookup === 'object') ? lookup : organizationLookup;
    const orgs = Array.isArray(orgRows) ? orgRows : [];
    if (!orgs.length) {
      container.innerHTML = '<div class="text-muted small">No organization role assignments are available for this person yet.</div>';
      return;
    }
    container.innerHTML = orgs.map((org) => {
      const orgLabel = safeHtml(getOrganizationDisplayName(org));
      const roles = normalizePersonRoles(org);
      const roleBadges = roles.length
        ? roles.map((role) => `<span class="badge text-bg-primary-subtle text-primary-emphasis border me-1 mb-1">${safeHtml(formatRoleLabel(role))}</span>`).join('')
        : '<span class="text-muted small">No school roles assigned</span>';
      return (
        '<div class="border rounded p-3 mb-2 bg-white">' +
          `<div class="fw-bold">${orgLabel}</div>` +
          `<div class="small text-muted mb-2">Org ID: ${safeHtml(org?.orgId || '-')}</div>` +
          `<div>${roleBadges}</div>` +
        '</div>'
      );
    }).join('');
  }

  function syncHiddenState() {
    const emailsHidden = document.getElementById('schoolPersonProfileEmailsHidden');
    const phonesHidden = document.getElementById('schoolPersonProfilePhonesHidden');
    const addressesHidden = document.getElementById('schoolPersonProfileAddressesHidden');
    if (emailsHidden) emailsHidden.value = JSON.stringify(emails);
    if (phonesHidden) phonesHidden.value = JSON.stringify(phones);
    if (addressesHidden) addressesHidden.value = JSON.stringify(addresses);
  }

  function renderEmails() {
    const list = document.getElementById('schoolPersonProfileEmailsList');
    if (!list) return;
    list.innerHTML = '';
    emails.forEach((row, index) => {
      const card = document.createElement('div');
      card.className = 'border rounded p-2 mb-2 bg-white';
      card.innerHTML = (
        '<div class="row g-2 align-items-center">' +
          '<div class="col-md-3"><select class="form-select form-select-sm email-type"><option value="primary">Primary</option><option value="work">Work</option><option value="personal">Personal</option><option value="other">Other</option></select></div>' +
          '<div class="col-md-6"><input type="email" class="form-control form-control-sm email-value" placeholder="email@example.com"></div>' +
          '<div class="col-md-2"><div class="form-check"><input class="form-check-input email-primary" type="radio" name="schoolPersonProfilePrimaryEmail"><label class="form-check-label small">Primary</label></div></div>' +
          '<div class="col-md-1 text-end"><button type="button" class="btn btn-sm btn-outline-danger btn-remove-email"><i class="bi bi-trash"></i></button></div>' +
        '</div>'
      );
      const typeEl = card.querySelector('.email-type');
      const valueEl = card.querySelector('.email-value');
      const primaryEl = card.querySelector('.email-primary');
      typeEl.value = row.type || 'primary';
      valueEl.value = row.email || '';
      primaryEl.checked = Boolean(row.isPrimary);
      typeEl.addEventListener('change', () => { emails[index].type = typeEl.value; syncHiddenState(); });
      valueEl.addEventListener('input', () => { emails[index].email = valueEl.value; syncHiddenState(); });
      primaryEl.addEventListener('change', () => {
        if (!primaryEl.checked) return;
        emails = emails.map((item, idx) => ({ ...item, isPrimary: idx === index }));
        renderEmails();
      });
      card.querySelector('.btn-remove-email').addEventListener('click', () => {
        emails.splice(index, 1);
        if (emails.length && !emails.some((item) => item.isPrimary)) emails[0].isPrimary = true;
        renderEmails();
        syncHiddenState();
      });
      list.appendChild(card);
    });
    syncHiddenState();
  }

  function renderPhones() {
    const list = document.getElementById('schoolPersonProfilePhonesList');
    if (!list) return;
    list.innerHTML = '';
    phones.forEach((row, index) => {
      const card = document.createElement('div');
      card.className = 'border rounded p-2 mb-2 bg-white';
      card.innerHTML = (
        '<div class="row g-2 align-items-center">' +
          '<div class="col-md-4"><select class="form-select form-select-sm phone-type"><option value="mobile">Mobile</option><option value="home">Home</option><option value="work">Work</option><option value="other">Other</option></select></div>' +
          '<div class="col-md-7"><input type="text" class="form-control form-control-sm phone-value" placeholder="Phone number"></div>' +
          '<div class="col-md-1 text-end"><button type="button" class="btn btn-sm btn-outline-danger btn-remove-phone"><i class="bi bi-trash"></i></button></div>' +
        '</div>'
      );
      const typeEl = card.querySelector('.phone-type');
      const valueEl = card.querySelector('.phone-value');
      typeEl.value = row.type || 'mobile';
      valueEl.value = row.number || '';
      typeEl.addEventListener('change', () => { phones[index].type = typeEl.value; syncHiddenState(); });
      valueEl.addEventListener('input', () => { phones[index].number = valueEl.value; syncHiddenState(); });
      card.querySelector('.btn-remove-phone').addEventListener('click', () => {
        phones.splice(index, 1);
        renderPhones();
        syncHiddenState();
      });
      list.appendChild(card);
    });
    syncHiddenState();
  }

  function renderAddresses() {
    const list = document.getElementById('schoolPersonProfileAddressesList');
    if (!list) return;
    list.innerHTML = '';
    addresses.forEach((row, index) => {
      const card = document.createElement('div');
      card.className = 'border rounded p-3 mb-2 bg-white';
      card.innerHTML = (
        '<div class="row g-2">' +
          '<div class="col-md-3"><label class="form-label small">Type</label><select class="form-select form-select-sm addr-type"><option value="home">Home</option><option value="mailing">Mailing</option><option value="work">Work</option><option value="other">Other</option></select></div>' +
          '<div class="col-md-9"><label class="form-label small">Line 1</label><input type="text" class="form-control form-control-sm addr-line1"></div>' +
          '<div class="col-md-4"><label class="form-label small">City</label><input type="text" class="form-control form-control-sm addr-city"></div>' +
          '<div class="col-md-4"><label class="form-label small">Province</label><input type="text" class="form-control form-control-sm addr-province"></div>' +
          '<div class="col-md-3"><label class="form-label small">Postal Code</label><input type="text" class="form-control form-control-sm addr-postal"></div>' +
          '<div class="col-md-1 d-flex align-items-end"><button type="button" class="btn btn-sm btn-outline-danger btn-remove-address"><i class="bi bi-trash"></i></button></div>' +
        '</div>'
      );
      const typeEl = card.querySelector('.addr-type');
      const line1El = card.querySelector('.addr-line1');
      const cityEl = card.querySelector('.addr-city');
      const provEl = card.querySelector('.addr-province');
      const postEl = card.querySelector('.addr-postal');
      typeEl.value = row.type || 'home';
      line1El.value = row.line1 || '';
      cityEl.value = row.city || '';
      provEl.value = row.province || '';
      postEl.value = row.postalCode || '';
      typeEl.addEventListener('change', () => { addresses[index].type = typeEl.value; syncHiddenState(); });
      line1El.addEventListener('input', () => { addresses[index].line1 = line1El.value; syncHiddenState(); });
      cityEl.addEventListener('input', () => { addresses[index].city = cityEl.value; syncHiddenState(); });
      provEl.addEventListener('input', () => { addresses[index].province = provEl.value; syncHiddenState(); });
      postEl.addEventListener('input', () => { addresses[index].postalCode = postEl.value; syncHiddenState(); });
      card.querySelector('.btn-remove-address').addEventListener('click', () => {
        addresses.splice(index, 1);
        renderAddresses();
        syncHiddenState();
      });
      list.appendChild(card);
    });
    syncHiddenState();
  }

  function setAlert(message) {
    const alert = alertEl();
    if (!alert) return;
    if (!message) {
      alert.classList.add('d-none');
      alert.textContent = '';
      return;
    }
    alert.textContent = message;
    alert.classList.remove('d-none');
  }

  function setLoading(isLoading) {
    loadingEl()?.classList.toggle('d-none', !isLoading);
    formEl()?.classList.toggle('d-none', isLoading);
    if (saveBtn()) saveBtn().disabled = Boolean(isLoading);
  }

  function syncProfileTypeUi(profileType) {
    const isOrganization = String(profileType || '').trim().toLowerCase() === 'organization';
    const typeEl = document.getElementById('schoolPersonProfileType');
    if (typeEl) typeEl.value = isOrganization ? 'organization' : 'individual';

    document.querySelectorAll('.school-person-organization-fields').forEach((node) => {
      node.style.display = isOrganization ? '' : 'none';
    });
    document.querySelectorAll('.school-person-individual-fields').forEach((node) => {
      node.style.display = isOrganization ? 'none' : '';
    });

    const legalNameEl = document.getElementById('schoolPersonProfileOrganizationLegalName');
    const firstNameEl = document.getElementById('schoolPersonProfileFirstName');
    const lastNameEl = document.getElementById('schoolPersonProfileLastName');
    const genderEl = document.getElementById('schoolPersonProfileGender');
    const dobEl = document.getElementById('schoolPersonProfileDateOfBirth');

    if (legalNameEl) legalNameEl.required = isOrganization;
    if (firstNameEl) firstNameEl.required = !isOrganization;
    if (lastNameEl) lastNameEl.required = !isOrganization;
    if (genderEl) genderEl.required = !isOrganization;
    if (dobEl) dobEl.required = !isOrganization;
  }

  function populateForm(person) {
    const profileType = String(person.personProfileType || '').trim().toLowerCase() === 'organization'
      ? 'organization'
      : 'individual';
    syncProfileTypeUi(profileType);

    const legalNameEl = document.getElementById('schoolPersonProfileOrganizationLegalName');
    if (legalNameEl) legalNameEl.value = person.organizationLegalName || '';

    document.getElementById('schoolPersonProfileFirstName').value = person.firstName || '';
    document.getElementById('schoolPersonProfileMiddleName').value = person.middleName || '';
    document.getElementById('schoolPersonProfileLastName').value = person.lastName || '';
    document.getElementById('schoolPersonProfilePreferredName').value = person.preferredName || '';
    document.getElementById('schoolPersonProfileActive').checked = person.active !== false;
    document.getElementById('schoolPersonProfileGender').value = person.gender || '';
    document.getElementById('schoolPersonProfileDateOfBirth').value = person.dateOfBirth || '';
    document.getElementById('schoolPersonProfileNotes').value = person.notes || '';

    emails = Array.isArray(person.emails) && person.emails.length
      ? person.emails.map((row) => ({ ...row }))
      : [{ type: 'primary', email: '', isPrimary: true }];
    if (!emails.some((row) => row.isPrimary)) emails[0].isPrimary = true;
    phones = Array.isArray(person.phones) ? person.phones.map((row) => ({ ...row })) : [];
    addresses = Array.isArray(person.addresses) ? person.addresses.map((row) => ({ ...row })) : [];
    organizations = Array.isArray(person.organizations) ? person.organizations : [];

    renderEmails();
    renderPhones();
    renderAddresses();
    renderRoleSummary(document.getElementById('schoolPersonProfileRoleSummary'), organizations, organizationLookup);
  }

  function buildPayload() {
    syncHiddenState();
    const profileType = document.getElementById('schoolPersonProfileType')?.value || 'individual';
    const isOrganization = profileType === 'organization';
    return {
      personProfileType: profileType,
      organizationLegalName: document.getElementById('schoolPersonProfileOrganizationLegalName')?.value?.trim() || '',
      firstName: isOrganization ? '' : (document.getElementById('schoolPersonProfileFirstName')?.value?.trim() || ''),
      middleName: isOrganization ? '' : (document.getElementById('schoolPersonProfileMiddleName')?.value?.trim() || ''),
      lastName: isOrganization ? '' : (document.getElementById('schoolPersonProfileLastName')?.value?.trim() || ''),
      preferredName: isOrganization ? '' : (document.getElementById('schoolPersonProfilePreferredName')?.value?.trim() || ''),
      active: document.getElementById('schoolPersonProfileActive')?.checked ? 'true' : 'false',
      gender: isOrganization ? '' : (document.getElementById('schoolPersonProfileGender')?.value?.trim() || ''),
      dateOfBirth: isOrganization ? '' : (document.getElementById('schoolPersonProfileDateOfBirth')?.value?.trim() || ''),
      notes: document.getElementById('schoolPersonProfileNotes')?.value?.trim() || '',
      emails: document.getElementById('schoolPersonProfileEmailsHidden')?.value || '[]',
      phones: document.getElementById('schoolPersonProfilePhonesHidden')?.value || '[]',
      addresses: document.getElementById('schoolPersonProfileAddressesHidden')?.value || '[]',
      linkType: currentContext?.linkType || '',
      linkId: currentContext?.linkId || ''
    };
  }

  function assertClientProfileFields(body) {
    const isOrganization = String(body.personProfileType || '').trim().toLowerCase() === 'organization';
    if (isOrganization) {
      if (!String(body.organizationLegalName || '').trim()) {
        throw new Error('Organization legal name is required.');
      }
      return;
    }
    if (!String(body.firstName || '').trim()) throw new Error('First name is required.');
    if (!String(body.lastName || '').trim()) throw new Error('Last name is required.');
    if (!String(body.gender || '').trim()) throw new Error('Gender is required.');
    if (!String(body.dateOfBirth || '').trim()) throw new Error('Date of birth is required.');
  }

  function buildProfileUrl(personId) {
    const params = new URLSearchParams();
    if (currentContext?.linkType) params.set('linkType', currentContext.linkType);
    if (currentContext?.linkId) params.set('linkId', currentContext.linkId);
    const query = params.toString();
    return `/school/identity/api/linked-person/${encodeURIComponent(personId)}${query ? `?${query}` : ''}`;
  }

  async function loadProfile(personId) {
    setAlert('');
    setLoading(true);
    try {
      const res = await fetch(buildProfileUrl(personId), {
        headers: { Accept: 'application/json' }
      });
      const payload = await res.json();
      if (!res.ok || payload.status !== 'success') {
        throw new Error(payload.message || 'Failed to load person profile.');
      }
      populateForm(payload.data?.person || {});
      organizations = payload.data?.organizations || organizations;
      renderRoleSummary(document.getElementById('schoolPersonProfileRoleSummary'), organizations, organizationLookup);
    } catch (error) {
      setAlert(error.message || 'Failed to load person profile.');
      throw error;
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    if (!currentContext?.personId) return;
    setAlert('');
    if (saveBtn()) saveBtn().disabled = true;
    try {
      const body = buildPayload();
      assertClientProfileFields(body);
      const res = await fetch(buildProfileUrl(currentContext.personId), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-AJAX-Request': 'true',
          'X-Skip-Action-State-Token': 'true'
        },
        body: JSON.stringify(body)
      });
      const payload = await res.json();
      if (!res.ok || payload.status !== 'success') {
        throw new Error(payload.message || 'Failed to save person profile.');
      }
      const data = payload.data || {};
      if (typeof currentContext.onSaved === 'function') {
        currentContext.onSaved({
          displayName: data.displayName || '',
          organizations: data.organizations || []
        });
      }
      modalInstance?.hide();
    } catch (error) {
      setAlert(error.message || 'Failed to save person profile.');
    } finally {
      if (saveBtn()) saveBtn().disabled = false;
    }
  }

  function wireControls() {
    if (wired) return;
    wired = true;

    document.getElementById('schoolPersonProfileBtnAddEmail')?.addEventListener('click', () => {
      emails.push({ type: 'work', email: '', isPrimary: emails.length === 0 });
      renderEmails();
    });
    document.getElementById('schoolPersonProfileBtnAddPhone')?.addEventListener('click', () => {
      phones.push({ type: 'mobile', number: '' });
      renderPhones();
    });
    document.getElementById('schoolPersonProfileBtnAddAddressManual')?.addEventListener('click', () => {
      addresses.push({ type: 'home', line1: '', city: '', province: '', postalCode: '' });
      renderAddresses();
    });

    const searchInput = document.getElementById('schoolPersonProfileAddressSearch');
    const suggestions = document.getElementById('schoolPersonProfileAddressSuggestions');
    if (searchInput && suggestions) {
      searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim();
        clearTimeout(addressDebounceTimer);
        if (!query) {
          suggestions.style.display = 'none';
          return;
        }
        addressDebounceTimer = setTimeout(async () => {
          try {
            suggestions.innerHTML = '<div class="list-group-item text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Searching...</div>';
            suggestions.style.display = 'block';
            const url = 'https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(query) + '&countrycodes=ca&addressdetails=1&limit=5';
            const res = await fetch(url);
            const data = await res.json();
            suggestions.innerHTML = '';
            if (!Array.isArray(data) || !data.length) {
              suggestions.innerHTML = '<div class="list-group-item text-muted">No results found.</div>';
              return;
            }
            data.forEach((item) => {
              const addr = item.address || {};
              const display = item.display_name || '';
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'list-group-item list-group-item-action text-start small';
              btn.innerHTML = '<i class="bi bi-geo-alt me-2 text-primary"></i>' + safeHtml(display);
              btn.addEventListener('click', () => {
                addresses.push({
                  type: 'home',
                  line1: ((addr.house_number || '') + ' ' + (addr.road || '')).trim() || String(display).split(',')[0] || '',
                  city: addr.city || addr.town || addr.village || '',
                  province: addr.state || '',
                  postalCode: addr.postcode || ''
                });
                renderAddresses();
                searchInput.value = '';
                suggestions.style.display = 'none';
              });
              suggestions.appendChild(btn);
            });
          } catch (_) {
            suggestions.style.display = 'none';
          }
        }, 350);
      });
      document.addEventListener('click', (event) => {
        if (!searchInput.contains(event.target) && !suggestions.contains(event.target)) {
          suggestions.style.display = 'none';
        }
      });
    }

    saveBtn()?.addEventListener('click', () => saveProfile());
  }

  function ensureModal() {
    const el = modalEl();
    if (!el || !global.bootstrap?.Modal) return null;
    modalInstance = modalInstance || global.bootstrap.Modal.getOrCreateInstance(el);
    wireControls();
    return modalInstance;
  }

  function open(options = {}) {
    const personId = String(options.personId || '').trim();
    if (!personId) return;
    currentContext = {
      personId,
      linkType: String(options.linkType || '').trim().toLowerCase(),
      linkId: String(options.linkId || '').trim(),
      onSaved: typeof options.onSaved === 'function' ? options.onSaved : null
    };
    organizationLookup = (options.organizationLookup && typeof options.organizationLookup === 'object')
      ? options.organizationLookup
      : {};

    const modal = ensureModal();
    if (!modal) return;
    setAlert('');
    modal.show();
    loadProfile(personId).catch(() => {});
  }

  function updateEditButtonState(button, { personId, personModeExisting = true } = {}) {
    if (!button) return;
    const hasPerson = Boolean(String(personId || '').trim());
    button.disabled = !hasPerson || !personModeExisting;
    button.classList.toggle('d-none', !hasPerson);
  }

  global.SchoolPersonProfileModal = {
    open,
    renderRoleSummary,
    updateEditButtonState
  };
})(window);
