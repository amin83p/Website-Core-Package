(function (global) {
  'use strict';

  const SECTION_NAV_DASHBOARD_KEY_RE = /^section-[A-Za-z0-9_-]+$/;
  const SAVE_DEBOUNCE_MS = 1500;

  function getModuleKey(module) {
    if (!module || typeof module !== 'object') return '';
    return String(module.id || module.href || module.title || '').trim();
  }

  function applyModuleOrder(modules, savedOrder) {
    const list = Array.isArray(modules) ? modules.slice() : [];
    const order = Array.isArray(savedOrder)
      ? savedOrder.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    if (!order.length) return list;

    const byKey = new Map();
    list.forEach((module) => {
      const key = getModuleKey(module);
      if (key && !byKey.has(key)) byKey.set(key, module);
    });

    const ordered = [];
    const used = new Set();

    order.forEach((key) => {
      const module = byKey.get(key);
      if (!module || used.has(key)) return;
      ordered.push(module);
      used.add(key);
    });

    list.forEach((module) => {
      const key = getModuleKey(module);
      if (!key || used.has(key)) return;
      ordered.push(module);
      used.add(key);
    });

    return ordered;
  }

  function isSectionNavDashboardKey(key) {
    return SECTION_NAV_DASHBOARD_KEY_RE.test(String(key || '').trim());
  }

  async function fetchModuleOrder(dashboardKey) {
    const response = await fetch(`/dashboard/api/module-order/${encodeURIComponent(dashboardKey)}`, {
      headers: { 'x-ajax-request': 'true' }
    });
    if (!response.ok) throw new Error('Failed to load module order.');
    const data = await response.json();
    if (data.status !== 'success') throw new Error(data.message || 'Failed to load module order.');
    return Array.isArray(data.moduleOrder) ? data.moduleOrder : null;
  }

  async function saveModuleOrder(dashboardKey, moduleOrder) {
    const response = await fetch(`/dashboard/api/module-order/${encodeURIComponent(dashboardKey)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-ajax-request': 'true'
      },
      body: JSON.stringify({ moduleOrder })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to save module order.');
    }
    return response.json();
  }

  async function resetModuleOrderOnServer(dashboardKey) {
    const response = await fetch(`/dashboard/api/module-order/${encodeURIComponent(dashboardKey)}`, {
      method: 'DELETE',
      headers: { 'x-ajax-request': 'true' }
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to reset module order.');
    }
    return response.json();
  }

  function createReorderManager(options) {
    const {
      dashboardKey,
      container,
      keyPrefix,
      getModules,
      setModules,
      getDefaultModules,
      onChange,
      canReorder
    } = options;

    let saveTimer = null;
    let dragSrcEl = null;

    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        saveTimer = null;
        try {
          const moduleOrder = getModules().map(getModuleKey).filter(Boolean);
          if (!moduleOrder.length) return;
          await saveModuleOrder(dashboardKey, moduleOrder);
        } catch (error) {
          console.error('Module order auto-save failed:', error);
        }
      }, SAVE_DEBOUNCE_MS);
    }

    function reorderByKeys(sourceKey, targetKey) {
      if (!sourceKey || !targetKey || sourceKey === targetKey) return false;
      const modules = getModules().slice();
      const sourceIndex = modules.findIndex((m) => getModuleKey(m) === sourceKey);
      const targetIndex = modules.findIndex((m) => getModuleKey(m) === targetKey);
      if (sourceIndex < 0 || targetIndex < 0) return false;
      const [item] = modules.splice(sourceIndex, 1);
      modules.splice(targetIndex, 0, item);
      setModules(modules);
      if (typeof onChange === 'function') onChange();
      scheduleSave();
      return true;
    }

    function bindDragAndDrop() {
      if (!container || container.dataset.moduleReorderBound === '1') return;
      container.dataset.moduleReorderBound = '1';

      container.addEventListener('dragstart', (event) => {
        const handle = event.target instanceof Element
          ? event.target.closest(`.${keyPrefix}-module-drag-handle`)
          : null;
        if (!handle || !container.contains(handle)) return;
        if (!canReorder()) {
          event.preventDefault();
          return;
        }
        const item = handle.closest(`.${keyPrefix}-module-reorder-item`);
        if (!item) return;
        dragSrcEl = item;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item.getAttribute('data-module-key') || '');
        item.classList.add(`${keyPrefix}-module-dragging`);
      });

      container.addEventListener('dragend', (event) => {
        const handle = event.target instanceof Element
          ? event.target.closest(`.${keyPrefix}-module-drag-handle`)
          : null;
        if (!handle || !container.contains(handle)) return;
        const item = handle.closest(`.${keyPrefix}-module-reorder-item`);
        if (item) item.classList.remove(`${keyPrefix}-module-dragging`);
        container.querySelectorAll(`.${keyPrefix}-module-drop-target`).forEach((el) => {
          el.classList.remove(`${keyPrefix}-module-drop-target`);
        });
        dragSrcEl = null;
      });

      container.addEventListener('dragover', (event) => {
        if (!canReorder() || !dragSrcEl) return;
        const item = event.target instanceof Element
          ? event.target.closest(`.${keyPrefix}-module-reorder-item`)
          : null;
        if (!item || !container.contains(item)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (dragSrcEl !== item) item.classList.add(`${keyPrefix}-module-drop-target`);
      });

      container.addEventListener('dragleave', (event) => {
        const item = event.target instanceof Element
          ? event.target.closest(`.${keyPrefix}-module-reorder-item`)
          : null;
        if (!item || !container.contains(item)) return;
        const related = event.relatedTarget;
        if (related instanceof Node && item.contains(related)) return;
        item.classList.remove(`${keyPrefix}-module-drop-target`);
      });

      container.addEventListener('drop', (event) => {
        if (!canReorder() || !dragSrcEl) return;
        const item = event.target instanceof Element
          ? event.target.closest(`.${keyPrefix}-module-reorder-item`)
          : null;
        if (!item || !container.contains(item)) return;
        event.preventDefault();
        event.stopPropagation();
        item.classList.remove(`${keyPrefix}-module-drop-target`);
        const sourceKey = dragSrcEl.getAttribute('data-module-key');
        const targetKey = item.getAttribute('data-module-key');
        reorderByKeys(sourceKey, targetKey);
      });
    }

    function syncDragHandleState() {
      if (!container) return;
      const disabled = !canReorder();
      container.querySelectorAll(`.${keyPrefix}-module-drag-handle`).forEach((handle) => {
        handle.setAttribute('draggable', disabled ? 'false' : 'true');
        handle.classList.toggle('is-disabled', disabled);
        handle.setAttribute(
          'title',
          disabled ? 'Clear search to reorder modules' : 'Drag to reorder this module'
        );
      });
    }

    async function resetOrder() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      await resetModuleOrderOnServer(dashboardKey);
      setModules(getDefaultModules().slice());
      if (typeof onChange === 'function') onChange();
    }

    return {
      bindDragAndDrop,
      syncDragHandleState,
      resetOrder,
      scheduleSave
    };
  }

  global.UnifiedDashboardModuleOrder = {
    SAVE_DEBOUNCE_MS,
    getModuleKey,
    applyModuleOrder,
    isSectionNavDashboardKey,
    fetchModuleOrder,
    saveModuleOrder,
    resetModuleOrderOnServer,
    createReorderManager
  };
})(typeof window !== 'undefined' ? window : global);
