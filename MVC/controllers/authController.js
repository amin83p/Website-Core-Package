// MVC/controllers/authController.js
const crypto = require('crypto');
const authService = require('../services/authService');
const { idsEqual } = require('../utils/idAdapter');
const bcrypt = require('bcryptjs');

const dataService = require('../services/dataService');
const sessionService = require('../services/SessionService'); // ✅ Import Session Service
const { SYSTEM_CONTEXT } = require('../../config/constants');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
const startupLogger = require('../utils/startupLogger');
const passwordResetService = require('../services/passwordResetService');
const emailManagementService = require('../services/emailManagementService');
const resendEmailService = require('../services/resendEmailService');
const smsProviderService = require('../services/sms/smsProviderService');
const settingService = require('../services/settingService');
const appBrandingService = require('../services/appBrandingService');
const userRepository = require('../repositories/userRepository');
const microsoftAuthService = require('../services/microsoftAuthService');
const adminCheckersService = require('../services/adminChekersService');
const { normalizePhoneE164, validateSmsPhoneE164, maskPhone } = require('../utils/phoneUtils');

const DEFAULT_DASHBOARD_URL = '/dashboard';
const PTE_USER_DASHBOARD_URL = '/pte/dashboard';
const MICROSOFT_PENDING_LOGIN_TTL_MS = 10 * 60 * 1000;

function cleanString(value, { max = 600, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeEmail(value = '') {
  return cleanString(value, { max: 320, allowEmpty: true }).toLowerCase();
}

function normalizeDeliveryMethod(value = '') {
  return cleanString(value, { max: 20, allowEmpty: true }).toLowerCase() === 'sms' ? 'sms' : 'email';
}

function digitsOnly(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function extractLastFourDigits(value = '') {
  const digits = digitsOnly(value);
  if (digits.length < 4) return '';
  return digits.slice(-4);
}

function isMobilePhoneType(value = '') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  return token.includes('mobile') || token === 'cell' || token === 'cellphone' || token === 'phone_mobile';
}

function createOpaqueToken() {
  return crypto.randomBytes(12).toString('hex');
}

function maskEmailForLog(value = '') {
  const token = normalizeEmail(value);
  if (!token || !token.includes('@')) return token || '';
  const [local, domain] = token.split('@');
  if (!local) return `***@${domain || ''}`;
  if (local.length <= 2) return `${local[0] || '*'}*@${domain || ''}`;
  return `${local.slice(0, 2)}***@${domain || ''}`;
}

function pickPrimaryPhone(rawPhones = []) {
  const rows = Array.isArray(rawPhones) ? rawPhones : [];
  const primary = rows.find((item) => Boolean(item?.isPrimary));
  return primary || rows[0] || null;
}

async function resolveUserPhoneE164(user = null) {
  if (!user) return '';

  const directCandidates = [
    user?.phoneE164,
    user?.phone,
    user?.mobile,
    user?.contact?.phone,
    user?.contact?.mobile
  ];
  for (const candidate of directCandidates) {
    const normalized = normalizePhoneE164(candidate || '');
    if (normalized) return normalized;
  }

  const personId = cleanString(user?.personId || '', { max: 120, allowEmpty: true });
  if (!personId || personId === 'NO_PERSONID') return '';
  try {
    const person = await dataService.getDataById('persons', personId, SYSTEM_CONTEXT);
    const primaryPhone = pickPrimaryPhone(person?.contact?.phones || []);
    const normalized = normalizePhoneE164(primaryPhone?.number || '');
    if (normalized) return normalized;
  } catch (_) {
    return '';
  }
  return '';
}

async function resolveUserMobilePhonesE164(user = null) {
  if (!user) return [];
  const personId = cleanString(user?.personId || '', { max: 120, allowEmpty: true });
  if (!personId || personId === 'NO_PERSONID') return [];

  try {
    const person = await dataService.getDataById('persons', personId, SYSTEM_CONTEXT);
    const phones = Array.isArray(person?.contact?.phones) ? person.contact.phones : [];
    const out = [];
    const seen = new Set();
    for (const row of phones) {
      if (!isMobilePhoneType(row?.type || '')) continue;
      const normalized = normalizePhoneE164(row?.number || '');
      if (!normalized) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  } catch (_) {
    return [];
  }
}

function getSmsSelectionStore(req) {
  if (!req?.session) return {};
  if (!req.session.passwordResetSmsSelections || typeof req.session.passwordResetSmsSelections !== 'object') {
    req.session.passwordResetSmsSelections = {};
  }
  return req.session.passwordResetSmsSelections;
}

function pruneSmsSelectionStore(store = {}, maxAgeMs = 30 * 60 * 1000) {
  const now = Date.now();
  Object.keys(store || {}).forEach((key) => {
    const row = store[key];
    const ts = Number(row?.createdAt || 0) || 0;
    if (!ts || (now - ts) > maxAgeMs) {
      delete store[key];
    }
  });
}

async function writeSmsSelectionOptions(req, email = '', phoneList = []) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !req?.session) return [];
  const safePhones = Array.isArray(phoneList) ? phoneList : [];
  const options = safePhones.map((phoneE164) => {
    const last4 = extractLastFourDigits(phoneE164);
    return {
      token: createOpaqueToken(),
      phoneE164,
      label: maskPhone(phoneE164),
      last4
    };
  });

  const store = getSmsSelectionStore(req);
  pruneSmsSelectionStore(store);
  store[normalizedEmail] = {
    createdAt: Date.now(),
    options: options.map((item) => ({
      token: item.token,
      phoneE164: item.phoneE164,
      label: item.label,
      last4: item.last4
    }))
  };
  await saveSession(req);

  return options.map((item) => ({
    token: item.token,
    label: item.label,
    last4: item.last4
  }));
}

function readSmsSelectionOptions(req, email = '') {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !req?.session) return [];
  const store = getSmsSelectionStore(req);
  pruneSmsSelectionStore(store);
  const row = store[normalizedEmail];
  if (!row || !Array.isArray(row.options)) return [];
  return row.options.map((item) => ({
    token: cleanString(item?.token || '', { max: 64, allowEmpty: true }) || '',
    phoneE164: normalizePhoneE164(item?.phoneE164 || ''),
    label: cleanString(item?.label || '', { max: 80, allowEmpty: true }) || '',
    last4: cleanString(item?.last4 || '', { max: 4, allowEmpty: true }) || ''
  })).filter((item) => item.token && item.phoneE164);
}

function maskSecretForLog(value = '') {
  const token = String(value || '').trim();
  if (!token) return '';
  if (token.length <= 8) return `${token.slice(0, 2)}***`;
  return `${token.slice(0, 4)}***${token.slice(-3)}`;
}

function getResetTtlMinutes() {
  const configured = Number.parseInt(
    String(settingService.getValue('auth', 'passwordResetTtlMinutes') || '15'),
    10
  );
  if (Number.isFinite(configured) && configured >= 5 && configured <= 180) return configured;
  return 15;
}

function getResetMaxAttempts() {
  const configured = Number.parseInt(
    String(settingService.getValue('auth', 'passwordResetMaxVerifyAttempts') || '8'),
    10
  );
  if (Number.isFinite(configured) && configured >= 1 && configured <= 20) return configured;
  return 8;
}

async function resolveUserByEmail(email = '') {
  const token = normalizeEmail(email);
  if (!token) return null;

  const rows = await dataService.fetchData('users', {
    email__eq: token,
    page: 1,
    limit: 20
  }, SYSTEM_CONTEXT);

  const match = (Array.isArray(rows) ? rows : []).find((row) => normalizeEmail(row?.email || '') === token);
  if (match) return match;

  // Keep parity with password login: repository username lookup also matches email.
  const fallback = await userRepository.getByUsername(token).catch(() => null);
  return normalizeEmail(fallback?.email || '') === token ? fallback : null;
}

async function resolveOrganizationName(orgId = '') {
  const token = cleanString(orgId, { max: 120, allowEmpty: true });
  if (!token) return '';
  try {
    const row = await dataService.getDataById('organizations', token, SYSTEM_CONTEXT);
    return cleanString(
      row?.identity?.displayName || row?.name || row?.identity?.legalName || '',
      { max: 220, allowEmpty: true }
    );
  } catch (_) {
    return '';
  }
}

async function sendResetCodeEmail({ user = null, orgId = '', code = '', ttlMinutes = 15 } = {}) {
  const email = normalizeEmail(user?.email || '');
  if (!email || !orgId || !code) {
    startupLogger.warn('AUTH', 'PASSWORD_RESET_EMAIL', 'Skipping send due to missing required inputs.', {
      hasEmail: Boolean(email),
      hasOrgId: Boolean(orgId),
      hasCode: Boolean(code)
    });
    return;
  }
  if (!resendEmailService.isConfigured({ requireFrom: false })) {
    const cfg = resendEmailService.getConfig();
    startupLogger.warn('AUTH', 'PASSWORD_RESET_EMAIL', 'Resend API key is missing. Skipping reset email delivery.', {
      hasApiKey: Boolean(cfg?.apiKey),
      apiKeyPreview: maskSecretForLog(cfg?.apiKey || ''),
      fromEmail: cfg?.from || '',
      hasDefaultSender: Boolean(cfg?.from)
    });
    return;
  }

  startupLogger.info('AUTH', 'PASSWORD_RESET_EMAIL', 'Preparing reset email payload.', {
    email: maskEmailForLog(email),
    orgId: String(orgId || ''),
    ttlMinutes: Number(ttlMinutes || 0)
  });

  const templateKey = emailManagementService.getResetTemplateKey();
  const orgName = await resolveOrganizationName(orgId);
  const rendered = await emailManagementService.resolveTemplateForRuntime({
    orgId,
    sectionId: templateKey.sectionId,
    operationId: templateKey.operationId,
    context: {
      userEmail: email,
      email,
      resetCode: code,
      resetTtlMinutes: ttlMinutes,
      orgName,
      appName: appBrandingService.getBrand().appName || process.env.APP_NAME || 'Application'
    }
  });

  startupLogger.info('AUTH', 'PASSWORD_RESET_EMAIL', 'Template rendered; dispatching email via Resend.', {
    templateSection: String(templateKey?.sectionId || ''),
    templateOperation: String(templateKey?.operationId || ''),
    recipientCount: Array.isArray(rendered?.to) ? rendered.to.length : 0,
    sender: String(rendered?.from || resendEmailService.getConfig()?.from || ''),
    usedFallbackTemplate: Boolean(rendered?.usedFallback)
  });

  const sendResult = await resendEmailService.sendEmail({
    from: rendered.from || undefined,
    to: rendered.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    meta: {
      orgId: cleanString(orgId, { max: 120, allowEmpty: true }) || '',
      sectionId: String(templateKey?.sectionId || SECTIONS.USERS),
      operationId: String(templateKey?.operationId || OPERATIONS.UPDATE),
      eventKey: cleanString(rendered?.eventKey, { max: 120, allowEmpty: true }) || 'AUTH_PASSWORD_RESET_CODE',
      actor: {
        userId: cleanString(user?.id, { max: 120, allowEmpty: true }) || '',
        username: cleanString(user?.username, { max: 120, allowEmpty: true }) || '',
        displayName: cleanString(user?.name, { max: 180, allowEmpty: true }) || '',
        email: cleanString(user?.email, { max: 220, allowEmpty: true }) || ''
      },
      templateId: cleanString(rendered?.templateId, { max: 120, allowEmpty: true }) || '',
      usedFallbackTemplate: Boolean(rendered?.usedFallback)
    }
  });

  startupLogger.success('AUTH', 'PASSWORD_RESET_EMAIL', 'Reset email sent successfully.', {
    email: maskEmailForLog(email),
    resendMessageId: String(sendResult?.id || sendResult?.message_id || '')
  });
}

function buildDeviceInfo(req, provider = 'password') {
  return {
    ip: req.ip,
    browser: req.headers['user-agent'] || 'Unknown',
    authProvider: provider
  };
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session || typeof req.session.save !== 'function') return resolve();
    return req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function sanitizeMicrosoftProviderAccount(account = {}) {
  return {
    email: normalizeEmail(account.email || ''),
    tenantId: cleanString(account.tenantId || '', { max: 120, allowEmpty: true }),
    objectId: cleanString(account.objectId || '', { max: 120, allowEmpty: true }),
    name: cleanString(account.name || '', { max: 220, allowEmpty: true }),
    username: cleanString(account.username || account.email || '', { max: 320, allowEmpty: true })
  };
}

function buildSessionLimitPayload(sessionPayload = {}, provider = 'password') {
  return {
    status: 'session_limit_exceeded',
    provider,
    message: cleanString(sessionPayload.message || 'Maximum active sessions reached.', { max: 500, allowEmpty: true }),
    maxSessions: Number(sessionPayload.maxSessions || 0) || null,
    activeSessions: Array.isArray(sessionPayload.activeSessions) ? sessionPayload.activeSessions : []
  };
}

async function storePendingMicrosoftLogin(req, user, providerAccount, sessionPayload = {}) {
  if (!req.session) throw new Error('Login session is not available. Please try again.');
  const now = Date.now();
  req.session.pendingMicrosoftLogin = {
    userId: cleanString(user?.id, { max: 120, allowEmpty: true }) || '',
    providerAccount: sanitizeMicrosoftProviderAccount(providerAccount),
    sessionLimit: buildSessionLimitPayload(sessionPayload, 'microsoft'),
    createdAt: now,
    expiresAt: now + MICROSOFT_PENDING_LOGIN_TTL_MS
  };
  await saveSession(req);
}

async function clearPendingMicrosoftLogin(req) {
  if (!req.session) return;
  delete req.session.pendingMicrosoftLogin;
  await saveSession(req);
}

function readPendingMicrosoftLogin(req) {
  const pending = req.session?.pendingMicrosoftLogin || null;
  if (!pending || !pending.userId) return null;
  if (Number(pending.expiresAt || 0) <= Date.now()) return null;
  return pending;
}

function resolvePendingMicrosoftSessionLimit(req) {
  const pending = readPendingMicrosoftLogin(req);
  return pending?.sessionLimit || null;
}

function resolvePostLoginRedirectUrl(user) {
  const isAdminUser = adminCheckersService.isAdmin(user)
    || adminCheckersService.isOrgAdmin(user)
    || Boolean(String(user?.systemAccessProfileId || '').trim());
  return isAdminUser ? DEFAULT_DASHBOARD_URL : PTE_USER_DASHBOARD_URL;
}

async function recordSuccessfulLogin(user, { provider = 'password', providerAccount = null } = {}) {
  if (!user || adminCheckersService.isSuperAdmin(user)) return;

  const now = new Date().toISOString();
  const payload = {
    lastLoginAt: now,
    lastLoginProvider: provider
  };

  if (provider === 'microsoft' && providerAccount) {
    const existingMicrosoft = user.authProviders?.microsoft || {};
    payload.authProviders = {
      ...(user.authProviders || {}),
      microsoft: {
        ...existingMicrosoft,
        email: normalizeEmail(providerAccount.email || user.email || ''),
        tenantId: cleanString(providerAccount.tenantId || '', { max: 120, allowEmpty: true }),
        objectId: cleanString(providerAccount.objectId || '', { max: 120, allowEmpty: true }),
        displayName: cleanString(providerAccount.name || '', { max: 220, allowEmpty: true }),
        linkedAt: existingMicrosoft.linkedAt || now,
        lastLoginAt: now
      }
    };
  }

  try {
    await dataService.updateData('users', user.id, payload, SYSTEM_CONTEXT);
  } catch (error) {
    startupLogger.warn('AUTH', 'LOGIN_AUDIT', 'Last-login audit update skipped.', {
      userId: String(user?.id || ''),
      provider,
      error: error?.message || String(error)
    });
  }
}

async function completeLoginForUser(req, res, user, { provider = 'password', providerAccount = null } = {}) {
  const orgId = user.primaryOrgId || 'SYSTEM';
  const limits = await sessionService.resolvePolicyLimits(user, orgId);
  const maxDurationMins = limits.maxDurationMins || 1440;

  const sessionCheck = await sessionService.checkLoginEligibility(user, orgId);
  if (!sessionCheck.allowed) {
    return {
      success: false,
      statusCode: 403,
      payload: buildSessionLimitPayload({
        message: `Limit reached: ${sessionCheck.maxSessions} sessions.`,
        maxSessions: sessionCheck.maxSessions,
        activeSessions: sessionCheck.activeSessions || []
      }, provider)
    };
  }

  const token = authService.generateToken(user, maxDurationMins);
  const tokenSignature = token.split('.')[2];

  await sessionService.createSession(user, orgId, buildDeviceInfo(req, provider), tokenSignature);
  await recordSuccessfulLogin(user, { provider, providerAccount });

  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: maxDurationMins * 60 * 1000
  });

  let redirectUrl = DEFAULT_DASHBOARD_URL;
  try {
    const hydratedUser = await authService.getUserFromToken(token);
    redirectUrl = resolvePostLoginRedirectUrl(hydratedUser);
  } catch (error) {
    startupLogger.warn('AUTH', 'LOGIN_REDIRECT', 'Could not resolve role-aware post-login redirect; using default dashboard.', {
      userId: String(user?.id || ''),
      error: error?.message || String(error)
    });
  }

  return {
    success: true,
    redirectUrl,
    maxDurationMins
  };
}

function redirectLoginWarning(res, message) {
  const safeMessage = cleanString(message || 'Microsoft login could not be completed.', { max: 500, allowEmpty: true });
  return res.redirect(`/login?warning=${encodeURIComponent(safeMessage)}`);
}

async function showLogin(req, res) {
  const token = req.cookies.auth_token;
  if (token && authService.validateToken(token)) {
    try {
      const tokenUser = await authService.getUserFromToken(token);
      return res.redirect(resolvePostLoginRedirectUrl(tokenUser));
    } catch (_) {
      // Stale but signed token (e.g., user no longer resolvable after backend switch).
      res.clearCookie('auth_token');
    }
  }

  const warningMessage = req.query.warning ? decodeURIComponent(req.query.warning) : null;
  const microsoftSessionLimit = resolvePendingMicrosoftSessionLimit(req);

  res.render('login/login', {
    title: 'Login',
    includeModal: true,
    user: null,
    warning: warningMessage,
    microsoftAuthEnabled: microsoftAuthService.isEnabled(),
    microsoftSessionLimit
  });
}

async function startMicrosoftLogin(req, res) {
  try {
    const authUrl = await microsoftAuthService.createAuthorizationUrl(req);
    return res.redirect(authUrl);
  } catch (error) {
    startupLogger.warn('AUTH', 'MICROSOFT_LOGIN_START', 'Unable to start Microsoft login.', {
      requestId: String(req.requestId || ''),
      error: error?.message || String(error),
      code: error?.code || ''
    });
    return redirectLoginWarning(res, error.message || 'Microsoft login is not available.');
  }
}

async function microsoftCallback(req, res) {
  try {
    const microsoftAccount = await microsoftAuthService.handleCallback(req);
    const user = await resolveUserByEmail(microsoftAccount.email);

    if (!user) {
      await clearPendingMicrosoftLogin(req);
      startupLogger.warn('AUTH', 'MICROSOFT_LOGIN_CALLBACK', 'Microsoft account has no matching local user.', {
        requestId: String(req.requestId || ''),
        email: maskEmailForLog(microsoftAccount.email)
      });
      return redirectLoginWarning(res, 'Microsoft sign-in succeeded, but no active website account matches this email.');
    }

    if (!user.active || user.status !== 'active') {
      await clearPendingMicrosoftLogin(req);
      return redirectLoginWarning(res, 'Your website account is not active.');
    }

    const loginResult = await completeLoginForUser(req, res, user, {
      provider: 'microsoft',
      providerAccount: microsoftAccount
    });

    if (!loginResult.success) {
      if (loginResult.payload?.status === 'session_limit_exceeded') {
        await storePendingMicrosoftLogin(req, user, microsoftAccount, loginResult.payload);
        return res.redirect('/login?microsoftSessionLimit=1');
      }
      await clearPendingMicrosoftLogin(req);
      return redirectLoginWarning(res, loginResult.payload?.message || 'Session limit reached.');
    }

    await clearPendingMicrosoftLogin(req);

    startupLogger.success('AUTH', 'MICROSOFT_LOGIN_CALLBACK', 'Microsoft login completed successfully.', {
      requestId: String(req.requestId || ''),
      userId: String(user.id || ''),
      email: maskEmailForLog(microsoftAccount.email)
    });
    return res.redirect(loginResult.redirectUrl || '/dashboard');
  } catch (error) {
    try {
      await clearPendingMicrosoftLogin(req);
    } catch (_) {}
    startupLogger.warn('AUTH', 'MICROSOFT_LOGIN_CALLBACK', 'Microsoft login callback failed.', {
      requestId: String(req.requestId || ''),
      error: error?.message || String(error),
      code: error?.code || ''
    });
    return redirectLoginWarning(res, error.message || 'Microsoft login failed. Please try again.');
  }
}

/* ============================================================
   LOGIN
============================================================ */
async function login(req, res) {
  try {
    const { username, password, captcha } = req.body;
    
    // ✅ SAFETY CHECK: If session middleware is missing, skip CAPTCHA to prevent crash
    if (!req.session) {
        console.warn("⚠️ WARNING: express-session is not configured. Skipping CAPTCHA checks.");
    } 
    else {
        // 1. CAPTCHA ENFORCEMENT
        if (req.session.loginFailures === undefined) req.session.loginFailures = 0;

        if (req.session.loginFailures >= 3) {
            if (!captcha) {
                return res.status(400).json({ status: 'captcha_required', message: 'Security check required.' });
            }
            if (req.session.captcha !== captcha) {
                return res.status(400).json({ status: 'error', message: 'Incorrect CAPTCHA code.' });
            }
        }
    }

    // 2. AUTHENTICATE
    const authResult = await authService.authenticateUser(username, password);
    
    if (!authResult.success) {
      if (req.session) {
          req.session.loginFailures = (req.session.loginFailures || 0) + 1;
          if (req.session.loginFailures >= 3) {
              return res.status(401).json({ status: 'captcha_required', message: 'Too many failed attempts.' });
          }
      }
      return res.status(401).json({ status: 'error', message: authResult.message });
    }

    // 3. SUCCESS PREP
    if (req.session) {
        req.session.loginFailures = 0;
        req.session.captcha = null;
    }

    const loginResult = await completeLoginForUser(req, res, authResult.user, { provider: 'password' });
    if (!loginResult.success) {
      return res.status(loginResult.statusCode || 403).json(loginResult.payload);
    }

    await clearPendingMicrosoftLogin(req);
    return res.json({ status: 'success', message: 'Login successful', redirectUrl: loginResult.redirectUrl || '/dashboard' });

  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal Server Error' });
  }
}
/* ============================================================
   FORCE LOGIN (Kill Session & Enter)
============================================================ */
async function forceLogin(req, res) {
    try {
        const { username, password, sessionIdToKill, authProvider } = req.body;

        if (!sessionIdToKill) return res.status(400).json({ status: 'error', message: 'Target session ID is missing.' });

        if (String(authProvider || '').toLowerCase() === 'microsoft') {
            const pending = readPendingMicrosoftLogin(req);
            if (!pending) {
                return res.status(401).json({ status: 'error', message: 'Microsoft sign-in session expired. Please sign in with Microsoft again.' });
            }

            const user = await dataService.getDataById('users', pending.userId, SYSTEM_CONTEXT);
            if (!user || !user.active || user.status !== 'active') {
                await clearPendingMicrosoftLogin(req);
                return res.status(401).json({ status: 'error', message: 'Your website account is not active.' });
            }

            const targetSession = await dataService.getDataById('sessions', sessionIdToKill, SYSTEM_CONTEXT);
            if (targetSession && idsEqual(targetSession.userId, user.id)) {
                await sessionService.terminateSession(sessionIdToKill);
            } else if (targetSession) {
                return res.status(403).json({ status: 'error', message: 'Invalid session target.' });
            }

            const loginResult = await completeLoginForUser(req, res, user, {
                provider: 'microsoft',
                providerAccount: pending.providerAccount || null
            });
            if (!loginResult.success) {
                await storePendingMicrosoftLogin(req, user, pending.providerAccount || {}, loginResult.payload || {});
                return res.status(loginResult.statusCode || 403).json(loginResult.payload);
            }

            await clearPendingMicrosoftLogin(req);
            return res.json({ status: 'success', message: 'Session terminated. Microsoft login successful.', redirectUrl: loginResult.redirectUrl || '/dashboard' });
        }

        // 1. Re-Authenticate (Must verify credentials again for security)
        const authResult = await authService.authenticateUser(username, password);
        if (!authResult.success) {
            return res.status(401).json({ status: 'error', message: authResult.message });
        }
        
        const user = authResult.user;

        // 2. Verify Ownership & Kill Session
        const targetSession = await dataService.getDataById('sessions', sessionIdToKill, SYSTEM_CONTEXT);
        
        // Only allow if session exists AND belongs to this user
        if (targetSession && idsEqual(targetSession.userId, user.id)) {
            await sessionService.terminateSession(sessionIdToKill);
        } else {
            // If session is already gone, we can proceed (race condition), but if it's another user's, block.
            if (targetSession) return res.status(403).json({ status: 'error', message: 'Invalid session target.' });
        }

        const loginResult = await completeLoginForUser(req, res, user, { provider: 'password_force' });
        if (!loginResult.success) {
            return res.status(loginResult.statusCode || 403).json(loginResult.payload);
        }

        await clearPendingMicrosoftLogin(req);
        return res.json({ status: 'success', message: 'Session terminated. Login successful.', redirectUrl: loginResult.redirectUrl || '/dashboard' });

    } catch (error) {
        console.error('Force Login Error:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
}

/* ============================================================
   LOGOUT
============================================================ */
async function logout(req, res) {
    try {
        const token = req.cookies.auth_token;
        if (token) {
            const parts = token.split('.');
            if (parts.length === 3) {
                const sessionId = parts[2];
                // ✅ Try to delete, but ignore error if it's already gone
                try {
                    await sessionService.terminateSession(sessionId);
                } catch (err) {
                    console.warn(`Logout: Session ${sessionId} was already missing or could not be deleted.`);
                }
            }
        }
    } catch (error) {
        console.error('Logout Unexpected Error:', error);
    } finally {
        // ✅ ALWAYS clear cookie, even if server-side delete failed
        res.clearCookie('auth_token');
        res.redirect('/login');
    }
}

function showUpdates(req, res) {
  res.render('login/updates', {
    title: 'Updates Summary',
    pageCss: 'pages/login/updates.css',
    includeModal: true,
    user: req.user || null
  });
}

function showMembershipStatus(req, res) {
  const entitlement = req.user?.entitlement || null;
  if (!entitlement || entitlement.enforced !== true || entitlement.active === true) {
    return res.redirect('/dashboard');
  }

  const currentOrgId = req.user?.activeOrgId;
  const allowedOrgs = Array.isArray(req.user?.allowedOrgs) ? req.user.allowedOrgs : [];
  const currentOrg = allowedOrgs.find((org) => String(org?.orgId) === String(currentOrgId)) || null;
  const switchableOrgs = allowedOrgs.filter((org) => {
    if (String(org?.orgId || '') === String(currentOrgId || '')) return false;
    if (String(org?.orgId || '') === 'SYSTEM') return true;
    return org?.isSelectable !== false;
  });

  const hasSwitchableOrgs = switchableOrgs.length > 0;
  const blockAppliesAll = entitlement?.appliesToAllOrgs === true;
  const isValidityIssue = ['expired', 'upcoming'].includes(String(entitlement?.status || '').toLowerCase());
  const pageVariant = isValidityIssue ? 'validity' : 'deactivated';
  const pageTitle = isValidityIssue ? 'Membership Period Not Valid' : 'Membership Inactive';
  const pageSubtitle = isValidityIssue
    ? 'Your account is signed in, but the configured membership period is not currently valid for this organization.'
    : 'Your account is signed in, but this organization is currently blocked by membership rules.';

  return res.render('login/membershipStatus', {
    title: 'Membership Status',
    includeModal: true,
    user: req.user || null,
    entitlement,
    currentOrg,
    hasSwitchableOrgs,
    blockAppliesAll,
    pageVariant,
    pageTitle,
    pageSubtitle
  });
}

/* ============================================================
   SWITCH ORGANIZATION
============================================================ */
async function switchOrg(req, res) {
  try {
    if (!req.user || !req.user.id) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
    
    const { orgId } = req.body;
    if (!orgId) return res.status(400).json({ status: 'error', message: 'Organization ID is required.' });

    // ✅ FIND CURRENT SESSION ID (Directly from Token Signature)
    let currentSessionId = null;
    if (req.cookies.auth_token) {
        const parts = req.cookies.auth_token.split('.');
        if (parts.length === 3) {
            // The signature IS the Session ID now. No DB lookup needed.
            currentSessionId = parts[2]; 
        }
    }

    // ✅ Pass Session ID to Service
    const result = await authService.switchOrganization(req.user.id, orgId, currentSessionId);

    if (result.success) {
      let userContext = null;
      try {
        if (req.cookies?.auth_token) {
          userContext = await authService.getUserFromToken(req.cookies.auth_token);
        }
      } catch (e) {
        console.warn('Failed to refresh user context after org switch:', e?.message || e);
      }

      return res.json({ status: 'success', message: 'Context switched.', user: userContext });
    } else {
      // Handle Session Limits specifically
      if (result.status === 'session_limit_exceeded') {
           return res.status(403).json({ 
               status: 'error', 
               message: result.message,
               // Data required for the frontend "Kill Session" modal
               reason: result.reason,
               sessionsToDelete: result.sessionsToDelete
           });
      }
      return res.status(403).json({ status: 'error', message: result.message });
    }

  } catch (error) {
    console.error('Switch Org Error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error.' });
  }
}

/* ============================================================
   SWITCH PROFILE MODE (System/User)
============================================================ */
async function switchProfileMode(req, res) {
    try {
        const userId = req.user.id;
        const { mode } = req.body;

        if (!mode) return res.status(400).json({ status: 'error', message: 'Mode is required.' });

        // ✅ FIND CURRENT SESSION ID
        let currentSessionId = null;
        if (req.cookies.auth_token) {
            const parts = req.cookies.auth_token.split('.');
            if (parts.length === 3) {
                currentSessionId = parts[2];
            }
        }
        // ✅ Pass Session ID so the service can update the Session's "currentOrgId" context
        const result = await authService.switchProfileMode(userId, mode, currentSessionId);

        if (result.success) {
            res.json({ status: 'success', message: result.message });
        } else {
            res.status(400).json({ status: 'error', message: result.message });
        }
    } catch (error) {
        console.error('Profile Mode Switch Error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
}

async function showPasswordReset(req, res) {
  const prefEmail = normalizeEmail(req.query?.email || '');
  res.render('login/passwordReset', {
    title: 'Reset Password',
    includeModal: true,
    user: null,
    prefEmail
  });
}

async function requestPasswordReset(req, res) {
  const email = normalizeEmail(req.body?.email || '');
  const requestedDeliveryMethod = normalizeDeliveryMethod(req.body?.deliveryMethod || 'email');
  const genericEmailMessage = 'If the account exists, a reset code has been sent to the registered email.';
  const genericSmsMessage = 'If the account exists, continue to verify your mobile number to send the reset code.';
  const genericMessage = requestedDeliveryMethod === 'sms' ? genericSmsMessage : genericEmailMessage;
  startupLogger.info('AUTH', 'PASSWORD_RESET_REQUEST', 'Incoming password reset request.', {
    email: maskEmailForLog(email),
    deliveryMethod: requestedDeliveryMethod,
    ip: req.ip || '',
    requestId: String(req.requestId || '')
  });
  if (!email) {
    startupLogger.warn('AUTH', 'PASSWORD_RESET_REQUEST', 'Rejected password reset request due to missing email.', {
      ip: req.ip || '',
      requestId: String(req.requestId || '')
    });
    return res.status(200).json({
      status: 'success',
      message: genericMessage,
      deliveryMethod: requestedDeliveryMethod,
      resolvedDeliveryMethod: requestedDeliveryMethod,
      smsTarget: {
        savedPhoneOptions: [],
        allowManualEntry: true,
        requireLast4: true
      }
    });
  }

  try {
    const user = await resolveUserByEmail(email);
    const userIsActive = Boolean(user && user.active !== false && String(user.status || '').toLowerCase() === 'active');

    if (requestedDeliveryMethod === 'email') {
      if (!userIsActive) {
        startupLogger.warn('AUTH', 'PASSWORD_RESET_REQUEST', 'No active user found for email (generic success returned).', {
          email: maskEmailForLog(email),
          requestId: String(req.requestId || '')
        });
        return res.status(200).json({ status: 'success', message: genericEmailMessage, deliveryMethod: 'email', resolvedDeliveryMethod: 'email' });
      }

      const orgId = cleanString(user.primaryOrgId || user.activeOrgId || '', { max: 120, allowEmpty: true });
      if (!orgId) {
        startupLogger.warn('AUTH', 'PASSWORD_RESET_REQUEST', 'User found but no organization context available.', {
          email: maskEmailForLog(email),
          userId: String(user?.id || ''),
          requestId: String(req.requestId || '')
        });
        return res.status(200).json({ status: 'success', message: genericEmailMessage, deliveryMethod: 'email', resolvedDeliveryMethod: 'email' });
      }

      const issued = await passwordResetService.issueResetCode({
        user,
        orgId,
        ttlMinutes: getResetTtlMinutes(),
        maxAttempts: getResetMaxAttempts()
      });
      startupLogger.info('AUTH', 'PASSWORD_RESET_REQUEST', 'Reset code issued.', {
        email: maskEmailForLog(email),
        userId: String(user?.id || ''),
        orgId: String(orgId || ''),
        codePreview: String(issued?.code || '').slice(0, 2) + '****',
        expiresAt: String(issued?.expiresAt || ''),
        recordId: String(issued?.record?.id || '')
      });

      try {
        await sendResetCodeEmail({
          user,
          orgId,
          code: issued.code,
          ttlMinutes: issued.ttlMinutes
        });
      } catch (mailError) {
        startupLogger.error('AUTH', 'PASSWORD_RESET_REQUEST', 'Reset code issued but email delivery failed.', {
          email: maskEmailForLog(email),
          orgId: String(orgId || ''),
          error: mailError?.message || String(mailError)
        });
      }

      await passwordResetService.markDeliveryContext({
        recordId: issued?.record?.id || '',
        deliveryMethod: 'email',
        deliveryProvider: 'resend',
        deliveryPhoneE164: '',
        deliveryReference: '',
        deliveryFallbackUsed: false
      });

      startupLogger.success('AUTH', 'PASSWORD_RESET_REQUEST', 'Password reset request handled.', {
        email: maskEmailForLog(email),
        requestedDeliveryMethod,
        resolvedDeliveryMethod: 'email',
        requestId: String(req.requestId || '')
      });
      return res.status(200).json({
        status: 'success',
        message: genericEmailMessage,
        deliveryMethod: 'email',
        resolvedDeliveryMethod: 'email'
      });
    }

    // SMS path: no delivery here; user chooses/validates target first in /password-reset/sms/start.
    if (!userIsActive) {
      const emptyOptions = await writeSmsSelectionOptions(req, email, []);
      startupLogger.warn('AUTH', 'PASSWORD_RESET_REQUEST', 'SMS flow requested for unknown/inactive user (generic response).', {
        email: maskEmailForLog(email),
        requestId: String(req.requestId || '')
      });
      return res.status(200).json({
        status: 'success',
        message: genericSmsMessage,
        deliveryMethod: 'sms',
        resolvedDeliveryMethod: 'sms',
        smsTarget: {
          savedPhoneOptions: emptyOptions,
          allowManualEntry: true,
          requireLast4: true
        }
      });
    }

    const orgId = cleanString(user.primaryOrgId || user.activeOrgId || '', { max: 120, allowEmpty: true });
    if (!orgId) {
      const emptyOptions = await writeSmsSelectionOptions(req, email, []);
      startupLogger.warn('AUTH', 'PASSWORD_RESET_REQUEST', 'Active user has no org context for SMS reset (generic response).', {
        email: maskEmailForLog(email),
        userId: String(user?.id || ''),
        requestId: String(req.requestId || '')
      });
      return res.status(200).json({
        status: 'success',
        message: genericSmsMessage,
        deliveryMethod: 'sms',
        resolvedDeliveryMethod: 'sms',
        smsTarget: {
          savedPhoneOptions: emptyOptions,
          allowManualEntry: true,
          requireLast4: true
        }
      });
    }

    const issued = await passwordResetService.issueResetCode({
      user,
      orgId,
      ttlMinutes: getResetTtlMinutes(),
      maxAttempts: getResetMaxAttempts()
    });
    startupLogger.info('AUTH', 'PASSWORD_RESET_REQUEST', 'Reset code record issued for SMS workflow.', {
      email: maskEmailForLog(email),
      userId: String(user?.id || ''),
      orgId: String(orgId || ''),
      expiresAt: String(issued?.expiresAt || ''),
      recordId: String(issued?.record?.id || '')
    });

    const mobilePhones = await resolveUserMobilePhonesE164(user);
    const smsOptions = await writeSmsSelectionOptions(req, email, mobilePhones);

    await passwordResetService.markDeliveryContext({
      recordId: issued?.record?.id || '',
      deliveryMethod: 'sms',
      deliveryProvider: 'twilio_verify',
      deliveryPhoneE164: '',
      deliveryReference: '',
      deliveryFallbackUsed: false
    });

    startupLogger.success('AUTH', 'PASSWORD_RESET_REQUEST', 'Password reset SMS target step prepared.', {
      email: maskEmailForLog(email),
      optionCount: smsOptions.length,
      requestId: String(req.requestId || '')
    });
    return res.status(200).json({
      status: 'success',
      message: genericSmsMessage,
      deliveryMethod: 'sms',
      resolvedDeliveryMethod: 'sms',
      smsTarget: {
        savedPhoneOptions: smsOptions,
        allowManualEntry: true,
        requireLast4: true
      }
    });
  } catch (error) {
    startupLogger.error('AUTH', 'PASSWORD_RESET_REQUEST', 'Unhandled error in password reset request.', {
      email: maskEmailForLog(email),
      requestId: String(req.requestId || ''),
      error: error?.message || String(error),
      stackTop: String(error?.stack || '').split('\n').slice(0, 2).join(' | ')
    });
    return res.status(200).json({ status: 'success', message: genericMessage });
  }
}

async function startPasswordResetSms(req, res) {
  const email = normalizeEmail(req.body?.email || '');
  const selectionMode = cleanString(req.body?.selectionMode || '', { max: 20, allowEmpty: true }).toLowerCase();
  const selectedToken = cleanString(req.body?.selectedToken || '', { max: 120, allowEmpty: true });
  const manualPhone = cleanString(req.body?.manualPhone || '', { max: 40, allowEmpty: true });
  const providedLast4 = extractLastFourDigits(req.body?.last4 || '');
  const genericSmsMessage = 'If the account exists, a verification code has been sent by SMS.';
  const hardFailMessage = 'Unable to send verification code by SMS right now. Please try again later.';

  startupLogger.info('AUTH', 'PASSWORD_RESET_SMS_START', 'Incoming SMS reset delivery request.', {
    email: maskEmailForLog(email),
    selectionMode,
    hasSelectedToken: Boolean(selectedToken),
    hasManualPhone: Boolean(manualPhone),
    hasLast4: Boolean(providedLast4),
    requestId: String(req.requestId || '')
  });

  if (!email || !providedLast4 || providedLast4.length !== 4) {
    return res.status(400).json({ status: 'error', message: 'A valid email and last four digits are required.' });
  }

  if (!smsProviderService.isConfigured()) {
    startupLogger.warn('AUTH', 'PASSWORD_RESET_SMS_START', 'SMS provider is not configured.', {
      requestId: String(req.requestId || '')
    });
    return res.status(503).json({ status: 'error', message: hardFailMessage });
  }

  let selectedPhoneE164 = '';
  if (selectionMode === 'saved') {
    const options = readSmsSelectionOptions(req, email);
    const matched = options.find((item) => item.token && item.token === selectedToken);
    selectedPhoneE164 = normalizePhoneE164(matched?.phoneE164 || '');
  } else if (selectionMode === 'manual') {
    selectedPhoneE164 = normalizePhoneE164(manualPhone || '');
  } else {
    const options = readSmsSelectionOptions(req, email);
    const matched = options.find((item) => item.token && item.token === selectedToken);
    selectedPhoneE164 = normalizePhoneE164(matched?.phoneE164 || manualPhone || '');
  }

  if (!selectedPhoneE164) {
    return res.status(400).json({ status: 'error', message: 'Please choose or enter a valid mobile number.' });
  }
  const smsPhoneValidation = validateSmsPhoneE164(selectedPhoneE164);
  if (!smsPhoneValidation.ok) {
    return res.status(400).json({
      status: 'error',
      message: 'Please enter a complete mobile number in E.164 format (for example, +14376028720).'
    });
  }
  selectedPhoneE164 = smsPhoneValidation.phoneE164;

  const selectedLast4 = extractLastFourDigits(selectedPhoneE164);
  if (!selectedLast4 || selectedLast4 !== providedLast4) {
    return res.status(400).json({ status: 'error', message: 'The last four digits do not match the selected number.' });
  }

  try {
    const activeDeliveryContext = await passwordResetService.getActiveDeliveryContext({ email });
    if (!activeDeliveryContext || !activeDeliveryContext.recordId) {
      startupLogger.warn('AUTH', 'PASSWORD_RESET_SMS_START', 'No active reset record found; returning generic SMS success.', {
        email: maskEmailForLog(email),
        requestId: String(req.requestId || '')
      });
      return res.status(200).json({
        status: 'success',
        message: genericSmsMessage,
        deliveryMethod: 'sms'
      });
    }

    const smsResult = await smsProviderService.startVerification({
      phoneE164: selectedPhoneE164,
      purpose: 'password_reset',
      orgId: cleanString(activeDeliveryContext.orgId || '', { max: 120, allowEmpty: true }) || '',
      userId: cleanString(activeDeliveryContext.userId || '', { max: 120, allowEmpty: true }) || '',
      requestId: String(req.requestId || ''),
      ip: req.ip || ''
    });

    await passwordResetService.markDeliveryContext({
      recordId: activeDeliveryContext.recordId,
      deliveryMethod: 'sms',
      deliveryProvider: 'twilio_verify',
      deliveryPhoneE164: selectedPhoneE164,
      deliveryReference: cleanString(smsResult?.sid || '', { max: 180, allowEmpty: true }) || '',
      deliveryFallbackUsed: false
    });

    startupLogger.success('AUTH', 'PASSWORD_RESET_SMS_START', 'SMS verification code dispatched via Twilio Verify.', {
      email: maskEmailForLog(email),
      phone: maskPhone(selectedPhoneE164),
      requestId: String(req.requestId || '')
    });
    return res.status(200).json({
      status: 'success',
      message: genericSmsMessage,
      deliveryMethod: 'sms'
    });
  } catch (error) {
    const errorText = String(error?.message || '');
    startupLogger.error('AUTH', 'PASSWORD_RESET_SMS_START', 'SMS verification dispatch failed.', {
      email: maskEmailForLog(email),
      phone: maskPhone(selectedPhoneE164),
      requestId: String(req.requestId || ''),
      error: errorText
    });
    if (String(error?.code || '') === 'SMS_PHONE_INVALID' || /invalid parameter\s*`?to`?/i.test(errorText)) {
      return res.status(400).json({
        status: 'error',
        message: 'The selected mobile number is invalid. Please enter a complete E.164 number (for example, +14376028720).'
      });
    }
    return res.status(502).json({ status: 'error', message: hardFailMessage });
  }
}

async function verifyPasswordReset(req, res) {
  try {
    const email = normalizeEmail(req.body?.email || '');
    const code = cleanString(req.body?.code || '', { max: 40, allowEmpty: true });
    const requestedDeliveryMethod = normalizeDeliveryMethod(req.body?.deliveryMethod || '');
    startupLogger.info('AUTH', 'PASSWORD_RESET_VERIFY', 'Incoming reset code verification request.', {
      email: maskEmailForLog(email),
      hasCode: Boolean(code),
      deliveryMethod: requestedDeliveryMethod || 'auto',
      requestId: String(req.requestId || '')
    });
    if (!email || !code) {
      return res.status(400).json({ status: 'error', message: 'Email and code are required.' });
    }

    const activeDeliveryContext = await passwordResetService.getActiveDeliveryContext({ email });
    if (!activeDeliveryContext) {
      startupLogger.warn('AUTH', 'PASSWORD_RESET_VERIFY', 'No active reset challenge found for verification.', {
        email: maskEmailForLog(email),
        requestId: String(req.requestId || '')
      });
      return res.status(400).json({ status: 'error', message: 'Invalid reset code.' });
    }
    const effectiveDeliveryMethod = normalizeDeliveryMethod(
      activeDeliveryContext?.deliveryMethod || requestedDeliveryMethod || 'email'
    );

    let result = null;
    if (effectiveDeliveryMethod === 'sms') {
      const phoneE164 = normalizePhoneE164(activeDeliveryContext?.deliveryPhoneE164 || '');
      if (!phoneE164) {
        startupLogger.warn('AUTH', 'PASSWORD_RESET_VERIFY', 'SMS verification requested but no valid phone was found.', {
          email: maskEmailForLog(email),
          requestId: String(req.requestId || '')
        });
        return res.status(400).json({ status: 'error', message: 'Please send your SMS verification code first.' });
      }

      const smsCheck = await smsProviderService.checkVerification({
        phoneE164,
        code,
        purpose: 'password_reset',
        orgId: cleanString(activeDeliveryContext?.orgId || '', { max: 120, allowEmpty: true }) || '',
        userId: cleanString(activeDeliveryContext?.userId || '', { max: 120, allowEmpty: true }) || '',
        requestId: String(req.requestId || ''),
        ip: req.ip || ''
      });
      if (!smsCheck?.ok) {
        const failedAttempt = await passwordResetService.registerFailedAttempt({ email });
        if (String(failedAttempt?.reason || '') === 'revoked') {
          return res.status(400).json({ status: 'error', message: 'Too many failed attempts. Please request a new code.' });
        }
        if (String(smsCheck?.reason || '') === 'expired') {
          return res.status(400).json({ status: 'error', message: 'Reset code is expired. Please request a new code.' });
        }
        if (String(smsCheck?.reason || '') === 'rate_limited') {
          return res.status(429).json({ status: 'error', message: 'Too many verification attempts. Please wait and try again.' });
        }
        return res.status(400).json({ status: 'error', message: 'Invalid reset code.' });
      }

      result = await passwordResetService.verifyManagedChallenge({
        email,
        deliveryMethod: 'sms',
        provider: 'twilio_verify'
      });
    } else {
      result = await passwordResetService.verifyCode({ email, code });
    }

    if (!result?.ok) {
      const reason = String(result?.reason || 'invalid');
      startupLogger.warn('AUTH', 'PASSWORD_RESET_VERIFY', 'Reset code verification failed.', {
        email: maskEmailForLog(email),
        reason,
        effectiveDeliveryMethod,
        requestId: String(req.requestId || '')
      });
      if (reason === 'expired') {
        return res.status(400).json({ status: 'error', message: 'Reset code is expired. Please request a new code.' });
      }
      if (reason === 'revoked') {
        return res.status(400).json({ status: 'error', message: 'Too many failed attempts. Please request a new code.' });
      }
      return res.status(400).json({ status: 'error', message: 'Invalid reset code.' });
    }

    return res.json({
      status: 'success',
      message: 'Code verified.',
      verificationToken: result.verificationToken,
      expiresAt: result.expiresAt,
      deliveryMethod: effectiveDeliveryMethod
    });
  } catch (error) {
    startupLogger.error('AUTH', 'PASSWORD_RESET_VERIFY', 'Unhandled error while verifying reset code.', {
      requestId: String(req.requestId || ''),
      error: error?.message || String(error)
    });
    return res.status(500).json({ status: 'error', message: error.message || 'Unable to verify reset code.' });
  }
}

async function completePasswordReset(req, res) {
  try {
    const email = normalizeEmail(req.body?.email || '');
    const verificationToken = cleanString(req.body?.verificationToken || '', { max: 220, allowEmpty: true });
    const newPassword = String(req.body?.newPassword || '');
    startupLogger.info('AUTH', 'PASSWORD_RESET_COMPLETE', 'Incoming password reset completion request.', {
      email: maskEmailForLog(email),
      hasVerificationToken: Boolean(verificationToken),
      hasPassword: Boolean(newPassword),
      requestId: String(req.requestId || '')
    });

    if (!email || !verificationToken || !newPassword) {
      return res.status(400).json({ status: 'error', message: 'Email, verification token, and new password are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ status: 'error', message: 'New password must be at least 8 characters.' });
    }

    const verifiedResult = await passwordResetService.peekVerifiedCode({ email, verificationToken });
    if (!verifiedResult?.ok) {
      const reason = String(verifiedResult?.reason || 'invalid');
      if (reason === 'expired') {
        return res.status(400).json({ status: 'error', message: 'Reset session is expired. Please request a new code.' });
      }
      return res.status(400).json({ status: 'error', message: 'Invalid reset verification token.' });
    }

    const userId = cleanString(verifiedResult.userId || '', { max: 120, allowEmpty: true });
    if (!userId) {
      return res.status(400).json({ status: 'error', message: 'Reset token is not linked to a user account.' });
    }

    const targetUser = await userRepository.getById(userId);
    if (!targetUser) {
      return res.status(404).json({ status: 'error', message: 'User account not found.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await dataService.updateData('users', userId, {
      passwordHash,
      password: passwordHash,
      passwordUpdatedAt: new Date().toISOString()
    }, SYSTEM_CONTEXT);

    const consumeResult = await passwordResetService.consumeVerifiedCode({ email, verificationToken });
    if (!consumeResult?.ok) {
      startupLogger.warn('AUTH', 'PASSWORD_RESET_COMPLETE', 'Password updated but reset token consume failed.', {
        email: maskEmailForLog(email),
        reason: String(consumeResult?.reason || 'unknown'),
        requestId: String(req.requestId || '')
      });
    }

    startupLogger.success('AUTH', 'PASSWORD_RESET_COMPLETE', 'Password reset completed successfully.', {
      email: maskEmailForLog(email),
      userId: String(userId || ''),
      requestId: String(req.requestId || '')
    });
    return res.json({
      status: 'success',
      message: 'Password reset completed successfully.'
    });
  } catch (error) {
    startupLogger.error('AUTH', 'PASSWORD_RESET_COMPLETE', 'Unhandled error while completing password reset.', {
      requestId: String(req.requestId || ''),
      error: error?.message || String(error)
    });
    return res.status(500).json({ status: 'error', message: error.message || 'Unable to complete password reset.' });
  }
}

function dashboard(req, res) {
  res.render('dashboard', {
    title: 'Dashboard',
    summary: {sectionCount: "N/A", activeSectionCount: "N/A", operationCount: "N/A", activeOperationCount: "N/A"},
    user: req.user || null,
    // Ensure stats/dashboardSections are passed if your view expects them (as seen in your dashboard.ejs)
    stats: { sections: 0, dashboardSections: 0 },
    dashboardSections: [] 
  });
}

module.exports = { 
  showLogin, 
  startMicrosoftLogin,
  microsoftCallback,
  showPasswordReset,
  login, 
  logout, 
  showMembershipStatus,
  showUpdates, 
  dashboard, 
  switchOrg,
  switchProfileMode,
  forceLogin,
  requestPasswordReset,
  startPasswordResetSms,
  verifyPasswordReset,
  completePasswordReset
};
