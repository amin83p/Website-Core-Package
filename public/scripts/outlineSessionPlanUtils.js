(function initOutlineSessionPlanUtils(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.OutlineSessionPlanUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : null, function buildOutlineSessionPlanUtils() {
  const CANONICAL_PLAN_SECTIONS = Object.freeze([
    { key: 'objectives', title: 'Objectives' },
    { key: 'language_focus', title: 'Language focus' },
    { key: 'activities', title: 'Activities' }
  ]);

  function outlinePlanGroupMeta(sectionKey) {
    const key = String(sectionKey || '').trim().toLowerCase();
    if (key === 'outcomes_general') return { key: 'objectives', title: 'Objectives', order: 1 };
    if (key === 'grammar') return { key: 'language_focus', title: 'Language focus', order: 2 };
    if (key === 'tasks') return { key: 'activities', title: 'Activities', order: 3 };
    return { key: 'additional', title: 'Additional content', order: 9 };
  }

  function getOutlineSectionCoverage(items) {
    const covered = new Set();
    (Array.isArray(items) ? items : []).forEach((item) => {
      const meta = outlinePlanGroupMeta(item?.sectionKey);
      if (CANONICAL_PLAN_SECTIONS.some((section) => section.key === meta.key)) {
        covered.add(meta.key);
      }
    });
    const missing = CANONICAL_PLAN_SECTIONS.filter((section) => !covered.has(section.key));
    return {
      objectives: covered.has('objectives'),
      language_focus: covered.has('language_focus'),
      activities: covered.has('activities'),
      missing,
      complete: missing.length === 0
    };
  }

  function resolveGroupLabel(row, catalogById) {
    const savedGroupLabel = String(row?.groupLabel || '').trim();
    if (savedGroupLabel) return savedGroupLabel;
    const parentId = String(row?.parentId || '').trim();
    if (!parentId || !catalogById) return '';
    const parent = catalogById.get(parentId);
    if (!parent) return '';
    if (String(parent.itemKind || '').toLowerCase() === 'group') {
      return String(parent.label || '').trim();
    }
    return '';
  }

  function buildOutlineItemSnapshot(row, catalogById, levelLookup) {
    if (!row) return null;
    const itemId = String(row.id || row.itemId || '').trim();
    if (!itemId) return null;
    const levelId = String(row.levelId || '').trim();
    const level = typeof levelLookup === 'function' ? levelLookup(levelId) : null;
    const parentId = String(row.parentId || '').trim();
    const groupLabel = resolveGroupLabel(row, catalogById);
    return {
      itemId,
      label: String(row.label || '').trim(),
      sectionKey: String(row.sectionKey || '').trim(),
      levelId,
      levelCode: String(row.levelCode || level?.code || '').trim(),
      levelTitle: String(row.levelTitle || level?.title || level?.code || '').trim(),
      parentId,
      groupLabel
    };
  }

  function buildOutlinePlanGroups(items) {
    const sectionOrder = ['objectives', 'language_focus', 'activities', 'additional'];
    const sections = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      const meta = outlinePlanGroupMeta(item?.sectionKey);
      if (!sections.has(meta.key)) {
        sections.set(meta.key, { ...meta, activityGroups: new Map(), flatItems: [] });
      }
      const section = sections.get(meta.key);
      if (meta.key === 'activities') {
        const groupKey = String(item.groupLabel || item.parentId || '__ungrouped__');
        if (!section.activityGroups.has(groupKey)) {
          section.activityGroups.set(groupKey, {
            groupLabel: String(item.groupLabel || '').trim(),
            items: []
          });
        }
        section.activityGroups.get(groupKey).items.push(item);
      } else {
        section.flatItems.push(item);
      }
    });
    return sectionOrder
      .filter((key) => sections.has(key))
      .map((key) => {
        const section = sections.get(key);
        return {
          ...section,
          activityGroups: [...section.activityGroups.values()]
        };
      });
  }

  function renderOutlinePlanItemLine(item, escapeHtml) {
    const level = item.levelTitle || item.levelCode || '';
    const levelBadge = level ? ` <span class="badge bg-light text-dark border ms-1">${escapeHtml(level)}</span>` : '';
    return `<li class="mb-1">${escapeHtml(item.label)}${levelBadge}</li>`;
  }

  function renderOutlinePlanHtml(items, escapeHtml, options = {}) {
    const listClass = String(options.listClass || 'small mb-2 ps-3 mb-0');
    if (!Array.isArray(items) || !items.length) {
      return '<div class="text-muted small">No instructional items selected.</div>';
    }
    const groups = buildOutlinePlanGroups(items);
    return groups.map((section) => {
      let body = '';
      if (section.key === 'activities') {
        body = section.activityGroups.map((group) => {
          const groupHeader = group.groupLabel
            ? `<div class="small text-muted mb-1 ps-2 border-start border-2">${escapeHtml(group.groupLabel)}</div>`
            : '';
          const bullets = group.items.map((item) => renderOutlinePlanItemLine(item, escapeHtml)).join('');
          return `${groupHeader}<ul class="${listClass}">${bullets}</ul>`;
        }).join('');
      } else {
        body = `<ul class="${listClass}">${section.flatItems.map((item) => renderOutlinePlanItemLine(item, escapeHtml)).join('')}</ul>`;
      }
      return `<div class="outline-selected-group">
        <div class="x-small text-uppercase fw-semibold text-muted">${escapeHtml(section.title)}</div>
        ${body}
      </div>`;
    }).join('');
  }

  function renderOutlineCoverageChips(coverage, escapeHtml) {
    return CANONICAL_PLAN_SECTIONS.map((section) => {
      const covered = coverage[section.key] === true;
      const klass = covered ? 'text-bg-success' : 'bg-light text-muted border';
      const icon = covered ? 'bi-check-circle-fill' : 'bi-circle';
      return `<span class="badge ${klass} me-1 mb-1"><i class="bi ${icon} me-1"></i>${escapeHtml(section.title)}</span>`;
    }).join('');
  }

  function formatIncompletePlanMessage(coverage, escapeHtml) {
    const missing = (coverage.missing || []).map((section) => escapeHtml(section.title)).join(', ');
    return `<p class="mb-2">A complete CLB session plan usually includes selections from <strong>Objectives</strong>, <strong>Language focus</strong>, and <strong>Activities</strong>.</p><p class="mb-0">Missing: <strong>${missing}</strong></p>`;
  }

  return {
    CANONICAL_PLAN_SECTIONS,
    outlinePlanGroupMeta,
    getOutlineSectionCoverage,
    resolveGroupLabel,
    buildOutlineItemSnapshot,
    buildOutlinePlanGroups,
    renderOutlinePlanHtml,
    renderOutlineCoverageChips,
    formatIncompletePlanMessage
  };
});
