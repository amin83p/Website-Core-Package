function parseEnvValue(rawValue = '') {
  let value = String(rawValue ?? '');
  if (value.charCodeAt(0) === 0xfeff) value = value.slice(1);
  value = value.trim();
  if (!value) return '';

  if (value.startsWith('"')) {
    let out = '';
    for (let i = 1; i < value.length; i += 1) {
      const ch = value[i];
      if (ch === '\\' && i + 1 < value.length) {
        out += value[i + 1];
        i += 1;
        continue;
      }
      if (ch === '"') return out;
      out += ch;
    }
    return out;
  }

  if (value.startsWith("'")) {
    const end = value.indexOf("'", 1);
    if (end > 0) return value.slice(1, end);
    return value.slice(1);
  }

  const commentIdx = value.search(/\s+#/);
  if (commentIdx >= 0) value = value.slice(0, commentIdx);
  return value.trim();
}

function parseEnvLine(line = '') {
  let trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  if (trimmed.toLowerCase().startsWith('export ')) {
    trimmed = trimmed.slice(7).trim();
  }
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx <= 0) return null;
  const key = trimmed.slice(0, eqIdx).trim();
  if (!key) return null;
  const value = parseEnvValue(trimmed.slice(eqIdx + 1));
  return { key, value };
}

function loadEnvFileIntoProcessEnv(filePath = '', { fsModule = require('fs') } = {}) {
  if (!filePath || !fsModule.existsSync(filePath)) return { loaded: 0, skipped: 0 };
  let raw = fsModule.readFileSync(filePath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  let loaded = 0;
  let skipped = 0;
  raw.split(/\r?\n/).forEach((line) => {
    const parsed = parseEnvLine(line);
    if (!parsed) return;
    const existing = process.env[parsed.key];
    if (existing !== undefined && String(existing).trim() !== '') {
      skipped += 1;
      return;
    }
    process.env[parsed.key] = parsed.value;
    loaded += 1;
  });
  return { loaded, skipped };
}

module.exports = {
  parseEnvValue,
  parseEnvLine,
  loadEnvFileIntoProcessEnv
};
