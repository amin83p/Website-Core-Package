(function (global) {
  'use strict';

  const cfg = global.PackageEvolutionTimelineConfig || {};
  let activePackage = '';

  function qs(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function typeBadge(type) {
    const token = String(type || 'update').toLowerCase();
    if (token === 'bug') return '<span class="badge bg-danger-subtle text-danger-emphasis border">Bug</span>';
    if (token === 'new') return '<span class="badge bg-success-subtle text-success-emphasis border">New</span>';
    return '<span class="badge bg-info-subtle text-info-emphasis border">Update</span>';
  }

  function formatDuration(d) {
    const row = d && typeof d === 'object' ? d : {};
    const parts = [];
    if (row.days) parts.push(`${row.days}d`);
    if (row.hours) parts.push(`${row.hours}h`);
    if (row.minutes) parts.push(`${row.minutes}m`);
    return parts.length ? parts.join(' ') : '—';
  }

  function formatBudget(b) {
    const row = b && typeof b === 'object' ? b : {};
    if (row.amount === null || row.amount === undefined || row.amount === '') return row.note ? escapeHtml(row.note) : '—';
    const cur = escapeHtml(row.currency || 'CAD');
    return `${cur} ${Number(row.amount).toFixed(2)}${row.note ? ` · ${escapeHtml(row.note)}` : ''}`;
  }

  function formatTeam(team) {
    const row = team && typeof team === 'object' ? team : {};
    const members = Array.isArray(row.members) ? row.members.map((m) => escapeHtml(m.name || m.userId || '')).filter(Boolean) : [];
    const approval = row.approval && (row.approval.name || row.approval.userId)
      ? escapeHtml(row.approval.name || row.approval.userId)
      : '';
    const parts = [];
    if (members.length) parts.push(`Team: ${members.join(', ')}`);
    if (approval) parts.push(`Approval: ${approval}`);
    return parts.join(' · ') || '—';
  }

  function renderItem(item) {
    const committed = escapeHtml(item.committedAt || '');
    const tech = item.technical && typeof item.technical === 'object' ? item.technical : {};
    const files = Array.isArray(tech.files) ? tech.files : [];
    const collections = Array.isArray(tech.collections) ? tech.collections : [];
    const other = Array.isArray(tech.other) ? tech.other : [];
    const techId = `pevolTech_${escapeHtml(item.id || Math.random().toString(36).slice(2))}`;
    return [
      '<article class="package-evolution-card card border-0 shadow-sm mb-3">',
      '<div class="card-body">',
      '<div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2">',
      `<div><div class="d-flex flex-wrap align-items-center gap-2 mb-1">${typeBadge(item.changeType)}`,
      `<span class="badge bg-light text-dark border">${escapeHtml(item.packageName || '')}</span>`,
      item.commitShortHash ? `<code class="small">${escapeHtml(item.commitShortHash)}</code>` : '',
      '</div>',
      `<h2 class="h5 fw-bold mb-1">${escapeHtml(item.title || 'Untitled')}</h2>`,
      `<div class="text-muted small">${committed}</div></div>`,
      '</div>',
      item.purpose ? `<p class="mb-2"><span class="fw-semibold">Purpose:</span> ${escapeHtml(item.purpose)}</p>` : '',
      item.description ? `<p class="mb-2 text-muted">${escapeHtml(item.description)}</p>` : '',
      `<div class="small text-muted mb-2">${formatTeam(item.team)}</div>`,
      '<div class="row g-2 small mb-2">',
      `<div class="col-md-4"><span class="text-muted">Duration</span><div>${formatDuration(item.taskDuration)}</div></div>`,
      `<div class="col-md-8"><span class="text-muted">Budget</span><div>${formatBudget(item.budget)}</div></div>`,
      '</div>',
      (files.length || collections.length || other.length) ? [
        `<button class="btn btn-link btn-sm px-0" type="button" data-bs-toggle="collapse" data-bs-target="#${techId}">Technical details</button>`,
        `<div class="collapse" id="${techId}"><div class="small border-top pt-2 mt-1">`,
        files.length ? `<div class="mb-1"><span class="fw-semibold">Files</span><ul class="mb-0 ps-3">${files.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join('')}</ul></div>` : '',
        collections.length ? `<div class="mb-1"><span class="fw-semibold">Collections</span><ul class="mb-0 ps-3">${collections.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join('')}</ul></div>` : '',
        other.length ? `<div><span class="fw-semibold">Other</span><ul class="mb-0 ps-3">${other.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join('')}</ul></div>` : '',
        '</div></div>'
      ].join('') : '',
      '</div></article>'
    ].join('');
  }

  function setLoading(active) {
    qs('pevolLoading')?.classList.toggle('d-none', !active);
  }

  function setEmpty(active) {
    qs('pevolEmpty')?.classList.toggle('d-none', !active);
  }

  async function loadTimeline() {
    const host = qs('pevolTimeline');
    if (!host) return;
    const params = new URLSearchParams();
    if (activePackage) params.set('packageName', activePackage);
    const start = qs('pevolStartDate')?.value;
    const end = qs('pevolEndDate')?.value;
    if (start) params.set('startDate', start);
    if (end) params.set('endDate', end);
    setLoading(true);
    setEmpty(false);
    host.innerHTML = '';
    try {
      const res = await fetch(`${cfg.apiUrl || '/package-evolution/api/timeline'}?${params}`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin'
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.status !== 'success') throw new Error(payload.message || 'Load failed.');
      const items = Array.isArray(payload.items) ? payload.items : [];
      if (!items.length) {
        setEmpty(true);
        return;
      }
      host.innerHTML = items.map(renderItem).join('');
    } catch (error) {
      host.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message || 'Unable to load timeline.')}</div>`;
    } finally {
      setLoading(false);
    }
  }

  function bindChips() {
    document.getElementById('pevolPackageChips')?.addEventListener('click', (event) => {
      const btn = event.target.closest('.pevol-chip[data-package]');
      if (!btn) return;
      document.querySelectorAll('.pevol-chip').forEach((el) => {
        el.classList.remove('active', 'btn-primary');
        el.classList.add('btn-outline-primary');
      });
      btn.classList.add('active', 'btn-primary');
      btn.classList.remove('btn-outline-primary');
      activePackage = String(btn.getAttribute('data-package') || '').trim();
      loadTimeline();
    });
  }

  function init() {
    bindChips();
    qs('pevolLoadBtn')?.addEventListener('click', () => loadTimeline().catch(() => {}));
    loadTimeline().catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);