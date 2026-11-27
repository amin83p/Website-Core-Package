(function (global) {
  'use strict';

  /**
   * Apply server-mapped AI fields to a form using optional binding metadata.
   * WoD v1: `fields` keys match resultKeys; hooks handle list/radio/checkbox UX.
   */
  function applyMappedFields(fields, bindings, hooks = {}) {
    const data = fields && typeof fields === 'object' ? fields : {};
    const bindingRows = Array.isArray(bindings) ? bindings : [];
    const bindingByKey = new Map(bindingRows.map((row) => [String(row?.resultKey || ''), row]));

    Object.entries(data).forEach(([resultKey, value]) => {
      const binding = bindingByKey.get(resultKey) || null;
      const target = String(binding?.target || 'dom').toLowerCase();
      if (target === 'hook' && typeof hooks[binding.hook] === 'function') {
        hooks[binding.hook](value, resultKey, binding);
        return;
      }
      const selector = String(binding?.selector || '').trim();
      if (!selector) return;
      if (resultKey === 'wordTypes' && Array.isArray(value)) {
        const typeSet = new Set(value);
        document.querySelectorAll(selector).forEach((el) => {
          el.checked = typeSet.has(el.value);
        });
        if (typeof hooks.syncWordTypes === 'function') hooks.syncWordTypes();
        return;
      }
      if (resultKey === 'difficulty') {
        document.querySelectorAll(selector).forEach((radio) => {
          radio.checked = radio.value === String(value || '');
        });
        return;
      }
      const el = document.querySelector(selector);
      if (!el) return;
      el.value = Array.isArray(value) ? value.join('\n') : String(value == null ? '' : value);
    });
  }

  global.SchoolAiFormAutofill = {
    applyMappedFields
  };
}(window));