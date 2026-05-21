const crypto = require('crypto');

const MAX_SKEW_MS = 5 * 60 * 1000;
const seenNonces = new Map();

function nowMs() {
  return Date.now();
}

function clean(value) {
  return String(value || '').trim();
}

function getSharedKey() {
  return clean(process.env.FILE_GATEWAY_SHARED_KEY || '');
}

function buildPayload({ method = '', routePath = '', timestamp = '', nonce = '' } = {}) {
  const m = clean(method).toUpperCase();
  const p = clean(routePath);
  const t = clean(timestamp);
  const n = clean(nonce);
  return `${m}\n${p}\n${t}\n${n}`;
}

function signPayload(payload = '', sharedKey = '') {
  return crypto.createHmac('sha256', sharedKey).update(String(payload || ''), 'utf8').digest('hex');
}

function buildSignedHeaders({ method = '', routePath = '', sharedKey = '' } = {}) {
  const key = clean(sharedKey || getSharedKey());
  if (!key) {
    throw new Error('FILE_GATEWAY_SHARED_KEY is not configured.');
  }
  const timestamp = String(nowMs());
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = buildPayload({ method, routePath, timestamp, nonce });
  const signature = signPayload(payload, key);

  return {
    'x-file-gateway-ts': timestamp,
    'x-file-gateway-nonce': nonce,
    'x-file-gateway-signature': signature
  };
}

function consumeNonce(nonce = '') {
  const token = clean(nonce);
  if (!token) return false;
  const now = nowMs();

  for (const [key, expiresAt] of seenNonces.entries()) {
    if (expiresAt <= now) seenNonces.delete(key);
  }

  if (seenNonces.has(token)) return false;
  seenNonces.set(token, now + MAX_SKEW_MS);
  return true;
}

function verifySignedRequest(req, expectedRoutePath = '') {
  const sharedKey = getSharedKey();
  if (!sharedKey) return { ok: false, message: 'Gateway shared key is not configured.' };

  const timestamp = clean(req.headers['x-file-gateway-ts']);
  const nonce = clean(req.headers['x-file-gateway-nonce']);
  const signature = clean(req.headers['x-file-gateway-signature']).toLowerCase();
  if (!timestamp || !nonce || !signature) {
    return { ok: false, message: 'Missing gateway authentication headers.' };
  }

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return { ok: false, message: 'Invalid gateway timestamp header.' };
  if (Math.abs(nowMs() - tsNum) > MAX_SKEW_MS) {
    return { ok: false, message: 'Gateway request timestamp is out of range.' };
  }

  if (!consumeNonce(nonce)) {
    return { ok: false, message: 'Gateway nonce replay detected.' };
  }

  const payload = buildPayload({
    method: req.method,
    routePath: expectedRoutePath,
    timestamp,
    nonce
  });
  const expected = signPayload(payload, sharedKey);
  const providedBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (providedBuffer.length !== expectedBuffer.length) {
    return { ok: false, message: 'Invalid gateway signature.' };
  }
  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return { ok: false, message: 'Invalid gateway signature.' };
  }

  return { ok: true };
}

module.exports = {
  buildSignedHeaders,
  verifySignedRequest
};
