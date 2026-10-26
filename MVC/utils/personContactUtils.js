'use strict';

function readPersonEmail(person = {}) {
  const emails = Array.isArray(person?.contact?.emails) ? person.contact.emails : [];
  const primary = emails.find((row) => row?.isPrimary) || emails[0] || null;
  return String(
    person?.contact?.email
    || person?.contact?.primaryEmail
    || person?.email
    || primary?.email
    || ''
  ).trim();
}

function formatPersonDisplayName(person = {}, fallback = '') {
  const preferred = String(person?.preferredName || person?.name?.preferred || '').trim();
  if (preferred) return preferred;
  const first = String(person?.firstName || person?.name?.first || '').trim();
  const middle = String(person?.middleName || person?.name?.middle || '').trim();
  const last = String(person?.lastName || person?.name?.last || '').trim();
  return [first, middle, last].filter(Boolean).join(' ')
    || String(person?.displayName || (typeof person?.name === 'string' ? person.name : '') || fallback).trim();
}

function isValidEmailAddress(value = '') {
  const token = String(value || '').trim();
  if (!token || token.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token);
}

module.exports = {
  readPersonEmail,
  formatPersonDisplayName,
  isValidEmailAddress
};
