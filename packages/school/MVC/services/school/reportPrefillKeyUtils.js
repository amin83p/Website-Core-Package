function normalizePrefillKey(rawKey = '') {
  let key = String(rawKey || '').trim();
  if (!key) return '';
  const wrapped = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(key);
  if (wrapped) key = String(wrapped[1] || '').trim();
  return key;
}

function getPrefillValue(prefill = {}, rawKey = '') {
  const key = normalizePrefillKey(rawKey);
  if (!key || !prefill || typeof prefill !== 'object') {
    return { found: false, value: undefined, key };
  }
  if (!Object.prototype.hasOwnProperty.call(prefill, key)) {
    return { found: false, value: undefined, key };
  }
  return { found: true, value: prefill[key], key };
}

module.exports = {
  normalizePrefillKey,
  getPrefillValue
};
