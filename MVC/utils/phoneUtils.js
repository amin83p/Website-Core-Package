function cleanString(value, { max = 120, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function normalizePhoneE164(value = '') {
  const raw = cleanString(value, { max: 64, allowEmpty: true });
  if (!raw) return '';

  let token = raw.replace(/[^\d+]/g, '');
  if (!token) return '';

  if (token.startsWith('00')) token = `+${token.slice(2)}`;

  if (token.startsWith('+')) {
    const digits = token.slice(1).replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) return '';
    // NANP guardrail (US/Canada): country code 1 must be followed by exactly 10 digits.
    if (digits.startsWith('1') && digits.length !== 11) return '';
    return `+${digits}`;
  }

  const digitsOnly = token.replace(/\D/g, '');
  if (!digitsOnly) return '';
  if (digitsOnly.length === 10) return `+1${digitsOnly}`;
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) return `+${digitsOnly}`;
  if (digitsOnly.length >= 10 && digitsOnly.length <= 15) return `+${digitsOnly}`;
  return '';
}

function validateSmsPhoneE164(value = '') {
  const normalized = normalizePhoneE164(value);
  if (!normalized) {
    return { ok: false, reason: 'invalid_format', phoneE164: '' };
  }

  const digits = normalized.slice(1);
  if (digits.startsWith('1')) {
    if (digits.length !== 11) {
      return { ok: false, reason: 'nanp_length', phoneE164: '' };
    }

    const areaCode = digits.slice(1, 4);
    const exchangeCode = digits.slice(4, 7);
    if (!/^[2-9]\d{2}$/.test(areaCode) || !/^[2-9]\d{2}$/.test(exchangeCode)) {
      return { ok: false, reason: 'nanp_pattern', phoneE164: '' };
    }
  }

  return { ok: true, reason: '', phoneE164: normalized };
}

function maskPhone(value = '') {
  const token = normalizePhoneE164(value);
  if (!token) return '';
  const digits = token.replace(/\D/g, '');
  if (digits.length <= 4) return `+**${digits}`;
  return `+${digits.slice(0, 2)}***${digits.slice(-2)}`;
}

module.exports = {
  normalizePhoneE164,
  validateSmsPhoneE164,
  maskPhone
};
