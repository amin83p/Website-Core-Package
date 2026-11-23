'use strict';

function toBoolean(v) {
  return v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
}

function parseJsonSafe(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return fallback;
  }
}

function buildSchoolInlinePersonPayload(body, reqUser, options = {}) {
  const now = new Date().toISOString();
  const firstName = String(body.newPersonFirstName || '').trim();
  const middleName = String(body.newPersonMiddleName || '').trim();
  const lastName = String(body.newPersonLastName || '').trim();
  const preferredName = String(body.newPersonPreferredName || '').trim();
  const notes = String(body.newPersonNotes || '').trim();
  const active = body.newPersonActive === undefined ? true : toBoolean(body.newPersonActive);
  const gender = String(body.newPersonGender || '').trim().toLowerCase();
  let dateOfBirth = String(body.newPersonDateOfBirth || '').trim();
  if (!dateOfBirth && options.defaultDateOfBirth) {
    dateOfBirth = String(options.defaultDateOfBirth).trim();
  }

  const emailsRaw = parseJsonSafe(body.newPersonEmails, []);
  const phonesRaw = parseJsonSafe(body.newPersonPhones, []);
  const addressesRaw = parseJsonSafe(body.newPersonAddresses, []);

  const emails = Array.isArray(emailsRaw)
    ? emailsRaw
      .map((e) => ({
        type: String(e?.type || 'work').trim().toLowerCase(),
        email: String(e?.email || '').trim(),
        isPrimary: Boolean(e?.isPrimary)
      }))
      .filter((e) => !!e.email)
    : [];

  const fallbackEmail = String(body.newPersonEmail || '').trim();
  if (!emails.length && fallbackEmail) emails.push({ type: 'primary', email: fallbackEmail, isPrimary: true });
  if (!emails.length) throw new Error('At least one email is required for new person registration.');
  if (!emails.some((e) => e.isPrimary)) emails[0].isPrimary = true;

  const phones = Array.isArray(phonesRaw)
    ? phonesRaw
      .map((p) => ({ type: String(p?.type || 'mobile').trim().toLowerCase(), number: String(p?.number || '').trim() }))
      .filter((p) => !!p.number)
    : [];

  const fallbackPhone = String(body.newPersonPhone || '').trim();
  if (!phones.length && fallbackPhone) phones.push({ type: 'mobile', number: fallbackPhone });

  const addresses = Array.isArray(addressesRaw)
    ? addressesRaw
      .map((a) => ({
        type: String(a?.type || 'home').trim().toLowerCase(),
        line1: String(a?.line1 || '').trim(),
        city: String(a?.city || '').trim(),
        province: String(a?.province || '').trim(),
        postalCode: String(a?.postalCode || '').trim()
      }))
      .filter((a) => !!(a.line1 || a.city || a.province || a.postalCode))
    : [];

  if (!firstName || !lastName || !gender || !dateOfBirth) {
    throw new Error('New Person fields are incomplete. Please provide first name, last name, gender, and date of birth.');
  }

  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  const allowedOrgs = Array.isArray(reqUser?.allowedOrgs) ? reqUser.allowedOrgs : [];
  const activeOrgMeta = allowedOrgs.find((o) => String(o?.orgId || '') === activeOrgId) || null;
  const initialOrganizations = activeOrgId
    ? [{
      orgId: Number.isFinite(Number(activeOrgId)) ? Number(activeOrgId) : activeOrgId,
      name: String(activeOrgMeta?.name || activeOrgMeta?.orgName || '').trim(),
      roles: ['member'],
      role: 'member',
      memberStatus: 'active',
      joinedAt: now
    }]
    : [];

  return {
    active,
    name: {
      first: firstName,
      middle: middleName || null,
      last: lastName,
      preferred: preferredName || null
    },
    demographics: { gender, dateOfBirth },
    contact: {
      emails,
      phones,
      email: emails.find((e) => e.isPrimary)?.email || emails[0]?.email || null
    },
    addresses,
    address: addresses[0] || {},
    tags: [],
    notes: notes || null,
    avatarUrl: null,
    organizations: initialOrganizations,
    audit: {
      createUser: reqUser?.id || reqUser?.username || 'SYSTEM',
      createDateTime: now,
      lastUpdateUser: reqUser?.id || reqUser?.username || 'SYSTEM',
      lastUpdateDateTime: now
    }
  };
}

module.exports = {
  buildSchoolInlinePersonPayload,
  parseJsonSafe
};