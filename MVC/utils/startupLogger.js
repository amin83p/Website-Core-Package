function normalizeToken(value = '', fallback = 'GENERAL') {
  const token = String(value || '').trim();
  if (!token) return fallback;
  return token
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .toUpperCase();
}

function formatMeta(meta = {}) {
  if (!meta || typeof meta !== 'object') return '';
  const parts = Object.entries(meta)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${String(key)}=${String(value)}`);
  return parts.length ? ` | ${parts.join(' | ')}` : '';
}

function log(level, moduleName, submoduleName, message, meta) {
  const lvl = normalizeToken(level, 'INFO');
  const mod = normalizeToken(moduleName, 'APP');
  const sub = normalizeToken(submoduleName, 'GENERAL');
  const body = String(message || '').trim();
  const marker = (lvl === 'SUCCESS')
    ? '✅ '
    : ((lvl === 'ERROR' || lvl === 'WARN' || lvl === 'WARNING') ? '🛑 ' : '');
  const line = `${marker}[${mod}][${sub}][${lvl}] ${body}${formatMeta(meta)}`;
  if (lvl === 'ERROR') {
    console.error(line);
    return;
  }
  if (lvl === 'WARN' || lvl === 'WARNING') {
    console.warn(line);
    return;
  }
  console.log(line);
}

module.exports = {
  log,
  info: (moduleName, submoduleName, message, meta) => log('INFO', moduleName, submoduleName, message, meta),
  warn: (moduleName, submoduleName, message, meta) => log('WARN', moduleName, submoduleName, message, meta),
  error: (moduleName, submoduleName, message, meta) => log('ERROR', moduleName, submoduleName, message, meta),
  success: (moduleName, submoduleName, message, meta) => log('SUCCESS', moduleName, submoduleName, message, meta),
  debug: (moduleName, submoduleName, message, meta) => log('DEBUG', moduleName, submoduleName, message, meta)
};
