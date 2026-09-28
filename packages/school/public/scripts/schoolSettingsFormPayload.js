(function (global) {
  'use strict';

  /**
   * Encode School Settings AJAX payloads for application/x-www-form-urlencoded POST.
   * Nested objects/arrays must be JSON strings — URLSearchParams otherwise sends "[object Object]".
   */
  function encodeSchoolSettingsFormPayload(payload) {
    const out = {};
    Object.entries(payload || {}).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        out[key] = '';
        return;
      }
      if (typeof value === 'object') {
        out[key] = JSON.stringify(value);
        return;
      }
      out[key] = String(value);
    });
    return out;
  }

  global.encodeSchoolSettingsFormPayload = encodeSchoolSettingsFormPayload;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { encodeSchoolSettingsFormPayload };
  }
})(typeof window !== 'undefined' ? window : globalThis);
