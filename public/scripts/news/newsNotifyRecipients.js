(function initNewsNotifyRecipients(global) {
  if (!global) return;

  function asString(value) {
    return String(value == null ? '' : value);
  }

  function isValidEmail(value) {
    const token = asString(value).trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token);
  }

  function readSelectedRoleKeys(roleKeysHidden, roleContainer) {
    if (roleKeysHidden) {
      return asString(roleKeysHidden.value)
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);
    }
    if (!roleContainer) return [];
    return [...roleContainer.querySelectorAll('input[name="notifyRoleKeys"]:checked')]
      .map((input) => asString(input.value).trim())
      .filter(Boolean);
  }

  function renderRecipientsTable(tbody, recipients, onChange) {
    if (!tbody) return;
    tbody.innerHTML = '';
    (Array.isArray(recipients) ? recipients : []).forEach((row, index) => {
      const tr = document.createElement('tr');
      tr.dataset.email = asString(row.email).toLowerCase();
      if (row.manual) tr.dataset.manual = '1';
      tr.innerHTML = `
        <td><input type="checkbox" class="form-check-input notify-include" ${row.included !== false ? 'checked' : ''}></td>
        <td><input type="text" class="form-control form-control-sm notify-name" value="${asString(row.displayName).replace(/"/g, '&quot;')}"></td>
        <td><input type="email" class="form-control form-control-sm notify-email" value="${asString(row.email).replace(/"/g, '&quot;')}"></td>
        <td class="small text-muted notify-roles">${asString((row.roles || []).join(', '))}</td>
        <td class="text-end">
          <button type="button" class="btn btn-sm btn-outline-danger notify-remove" title="Remove">&times;</button>
        </td>
      `;
      tr.querySelector('.notify-include')?.addEventListener('change', onChange);
      tr.querySelector('.notify-name')?.addEventListener('input', onChange);
      tr.querySelector('.notify-email')?.addEventListener('input', onChange);
      tr.querySelector('.notify-remove')?.addEventListener('click', () => {
        tr.remove();
        onChange();
      });
      tbody.appendChild(tr);
    });
    onChange();
  }

  function collectRecipientsFromTable(tbody) {
    if (!tbody) return [];
    return [...tbody.querySelectorAll('tr')].map((tr) => {
      const email = asString(tr.querySelector('.notify-email')?.value).trim();
      const displayName = asString(tr.querySelector('.notify-name')?.value).trim();
      const roles = asString(tr.querySelector('.notify-roles')?.textContent)
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);
      const manual = tr.dataset.manual === '1';
      return {
        email,
        displayName,
        roles,
        manual,
        included: tr.querySelector('.notify-include')?.checked !== false
      };
    }).filter((row) => row.email && isValidEmail(row.email));
  }

  function mergeRecipients(existing, incoming) {
    const map = new Map();
    (Array.isArray(existing) ? existing : []).forEach((row) => {
      const key = asString(row.email).toLowerCase();
      if (key) map.set(key, row);
    });
    (Array.isArray(incoming) ? incoming : []).forEach((row) => {
      const key = asString(row.email).toLowerCase();
      if (!key) return;
      const prior = map.get(key);
      map.set(key, {
        ...row,
        displayName: prior?.displayName || row.displayName,
        included: prior ? prior.included !== false : row.included !== false,
        manual: prior?.manual || row.manual
      });
    });
    return [...map.values()];
  }

  function createNewsNotifyRecipientsController(options = {}) {
    const roleKeysHidden = options.roleKeysHidden;
    const roleContainer = options.roleContainer;
    const loadBtn = options.loadBtn;
    const addBtn = options.addBtn;
    const tbody = options.tbody;
    const hiddenInput = options.hiddenInput;
    const countEl = options.countEl;
    const csrfToken = asString(options.csrfToken);

    let recipients = Array.isArray(options.initialRecipients) ? options.initialRecipients : [];

    function syncHidden() {
      const rows = collectRecipientsFromTable(tbody);
      recipients = rows;
      if (hiddenInput) {
        hiddenInput.value = JSON.stringify(rows);
      }
      if (countEl) {
        const included = rows.filter((row) => row.included !== false).length;
        countEl.textContent = `${included} recipient(s)`;
      }
      if (typeof options.onRecipientsChange === 'function') {
        options.onRecipientsChange();
      }
    }

    function paint() {
      renderRecipientsTable(tbody, recipients, syncHidden);
    }

    async function loadFromApi() {
      const roleKeys = readSelectedRoleKeys(roleKeysHidden, roleContainer);
      if (!roleKeys.length) {
        throw new Error('Select at least one role.');
      }
      const response = await fetch('/news/api/notify/recipients', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {})
        },
        body: JSON.stringify({ roleKeys })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.status !== 'success') {
        throw new Error(payload.message || 'Unable to load recipients.');
      }
      recipients = mergeRecipients(collectRecipientsFromTable(tbody), payload.recipients || []);
      paint();
    }

    if (loadBtn) {
      loadBtn.addEventListener('click', () => {
        loadFromApi().catch((error) => {
          if (typeof global.showMessageModal === 'function') {
            global.showMessageModal({
              title: 'Recipients',
              icon: 'error',
              message: error.message || 'Unable to load recipients.',
              buttons: [{ text: 'OK', class: 'btn-primary', value: 'ok' }]
            });
          }
        });
      });
    }

    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const email = asString(global.prompt('Email address to add:')).trim();
        if (!email) return;
        if (!isValidEmail(email)) {
          global.alert('Enter a valid email address.');
          return;
        }
        recipients = mergeRecipients(collectRecipientsFromTable(tbody), [{
          email,
          displayName: '',
          roles: ['Manual'],
          manual: true,
          included: true
        }]);
        paint();
      });
    }

    paint();

    return {
      syncHidden,
      loadFromApi
    };
  }

  global.NewsNotifyRecipients = {
    createNewsNotifyRecipientsController,
    collectRecipientsFromTable,
    dedupeByEmail: mergeRecipients
  };
}(typeof window !== 'undefined' ? window : null));
