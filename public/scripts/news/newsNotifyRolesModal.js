(function initNewsNotifyRolesModal(global) {
  if (!global) return;

  function asString(value) {
    return String(value == null ? '' : value);
  }

  function groupRolesByPackage(roles) {
    const groups = new Map();
    (Array.isArray(roles) ? roles : []).forEach((role) => {
      const key = asString(role?.key).trim();
      if (!key) return;
      const packageName = asString(role?.packageName || role?.domain || 'CORE').trim().toUpperCase() || 'CORE';
      if (!groups.has(packageName)) groups.set(packageName, []);
      groups.get(packageName).push({
        key,
        label: asString(role?.label || key).trim() || key,
        memberCount: Number(role?.memberCount) || 0
      });
    });
    return [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([packageName, items]) => ({
        packageName,
        roles: items.sort((a, b) => a.label.localeCompare(b.label))
      }));
  }

  function createNewsNotifyRolesModalController(options = {}) {
    const modalEl = options.modalEl;
    const bodyEl = options.bodyEl;
    const emptyEl = options.emptyEl;
    const searchInput = options.searchInput;
    const summaryEl = options.summaryEl;
    const selectionCountEl = options.selectionCountEl;
    const manageBtn = options.manageBtn;
    const saveBtn = options.saveBtn;
    const roleKeysHidden = options.roleKeysHidden;
    const csrfToken = asString(options.csrfToken);

    let catalog = Array.isArray(options.initialRoles) ? options.initialRoles.slice() : [];
    let selectedKeys = new Set(
      (Array.isArray(options.initialSelectedKeys) ? options.initialSelectedKeys : [])
        .map((key) => asString(key).trim())
        .filter(Boolean)
    );
    let draftKeys = new Set(selectedKeys);
    let modalInstance = null;

    function getModal() {
      if (!modalEl || !global.bootstrap?.Modal) return null;
      if (!modalInstance) modalInstance = global.bootstrap.Modal.getOrCreateInstance(modalEl);
      return modalInstance;
    }

    function roleByKey(key) {
      return catalog.find((row) => row.key === key);
    }

    function renderSummary() {
      if (!summaryEl) return;
      summaryEl.innerHTML = '';
      const keys = [...selectedKeys];
      if (!keys.length) {
        summaryEl.innerHTML = '<span class="small text-muted">No roles selected.</span>';
        return;
      }
      keys.forEach((key) => {
        const meta = roleByKey(key);
        const label = meta?.label || key;
        const badge = document.createElement('span');
        badge.className = 'badge rounded-pill text-bg-light border';
        badge.textContent = label;
        summaryEl.appendChild(badge);
      });
    }

    function updateSelectionCount() {
      if (!selectionCountEl) return;
      const count = draftKeys.size;
      selectionCountEl.textContent = count
        ? `${count} role${count === 1 ? '' : 's'} selected`
        : 'No roles selected';
    }

    function matchesSearch(role, packageName, query) {
      if (!query) return true;
      const haystack = `${packageName} ${role.label} ${role.key}`.toLowerCase();
      return haystack.includes(query);
    }

    function renderModalBody() {
      if (!bodyEl) return;
      const query = asString(searchInput?.value).trim().toLowerCase();
      bodyEl.innerHTML = '';
      let visibleCount = 0;
      const groups = groupRolesByPackage(catalog);

      groups.forEach((group) => {
        const visibleRoles = group.roles.filter((role) => matchesSearch(role, group.packageName, query));
        if (!visibleRoles.length) return;
        visibleCount += visibleRoles.length;

        const section = document.createElement('div');
        section.className = 'mb-3';
        section.innerHTML = `<div class="fw-semibold small text-uppercase text-muted mb-2">${group.packageName}</div>`;

        const list = document.createElement('div');
        list.className = 'list-group list-group-flush border rounded';

        visibleRoles.forEach((role) => {
          const item = document.createElement('label');
          item.className = 'list-group-item list-group-item-action d-flex align-items-center gap-2 mb-0';
          const checked = draftKeys.has(role.key);
          const countLabel = role.memberCount
            ? `<span class="badge text-bg-secondary ms-auto">${role.memberCount}</span>`
            : '';
          item.innerHTML = `
            <input class="form-check-input flex-shrink-0 notify-role-key" type="checkbox" name="notifyRoleKeys" value="${role.key.replace(/"/g, '&quot;')}" ${checked ? 'checked' : ''}>
            <span class="flex-grow-1">
              <span class="fw-medium">${role.label.replace(/</g, '&lt;')}</span>
              <span class="d-block small text-muted font-monospace">${role.key.replace(/</g, '&lt;')}</span>
            </span>
            ${countLabel}
          `;
          item.querySelector('input')?.addEventListener('change', (event) => {
            const input = event.target;
            if (!input) return;
            if (input.checked) draftKeys.add(role.key);
            else draftKeys.delete(role.key);
            updateSelectionCount();
          });
          list.appendChild(item);
        });

        section.appendChild(list);
        bodyEl.appendChild(section);
      });

      if (emptyEl) {
        emptyEl.classList.toggle('d-none', visibleCount > 0);
      }
      updateSelectionCount();
    }

    async function refreshCatalog() {
      const response = await fetch('/news/api/notify/roles', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {})
        }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.status !== 'success') {
        throw new Error(payload.message || 'Unable to load roles.');
      }
      catalog = Array.isArray(payload.roles) ? payload.roles : [];
      if (manageBtn) manageBtn.disabled = catalog.length === 0;
      const validKeys = new Set(catalog.map((row) => row.key));
      selectedKeys = new Set([...selectedKeys].filter((key) => validKeys.has(key)));
      draftKeys = new Set([...draftKeys].filter((key) => validKeys.has(key)));
    }

    function applySelection() {
      selectedKeys = new Set(draftKeys);
      renderSummary();
      if (typeof options.onSelectionChange === 'function') {
        options.onSelectionChange();
      }
    }

    function openModal() {
      draftKeys = new Set(selectedKeys);
      renderModalBody();
      getModal()?.show();
    }

    if (manageBtn) {
      manageBtn.addEventListener('click', () => {
        refreshCatalog()
          .then(() => {
            openModal();
          })
          .catch((error) => {
            if (typeof global.showMessageModal === 'function') {
              global.showMessageModal({
                title: 'Roles',
                icon: 'error',
                message: error.message || 'Unable to load roles.',
                buttons: [{ text: 'OK', class: 'btn-primary', value: 'ok' }]
              });
            }
          });
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        applySelection();
        getModal()?.hide();
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', renderModalBody);
    }

    if (modalEl) {
      modalEl.addEventListener('hidden.bs.modal', () => {
        draftKeys = new Set(selectedKeys);
        if (searchInput) searchInput.value = '';
      });
    }

    renderSummary();

    return {
      getSelectedKeys: () => [...selectedKeys],
      refreshCatalog,
      openModal
    };
  }

  global.NewsNotifyRolesModal = {
    createNewsNotifyRolesModalController,
    groupRolesByPackage
  };
}(typeof window !== 'undefined' ? window : null));
