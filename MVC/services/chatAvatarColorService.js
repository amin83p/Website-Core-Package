'use strict';

const userSettingsService = require('./userSettingsService');
const { toPublicId } = require('../utils/idAdapter');

const AVATAR_COLOR_SETTING_KEY = 'chat.avatarColor';

const AVATAR_COLOR_PALETTE = Object.freeze([
  { background: '#6366f1', foreground: '#ffffff' },
  { background: '#0ea5e9', foreground: '#ffffff' },
  { background: '#14b8a6', foreground: '#ffffff' },
  { background: '#22c55e', foreground: '#ffffff' },
  { background: '#eab308', foreground: '#1f2937' },
  { background: '#f97316', foreground: '#ffffff' },
  { background: '#ef4444', foreground: '#ffffff' },
  { background: '#ec4899', foreground: '#ffffff' },
  { background: '#a855f7', foreground: '#ffffff' },
  { background: '#64748b', foreground: '#ffffff' },
  { background: '#0891b2', foreground: '#ffffff' },
  { background: '#7c3aed', foreground: '#ffffff' }
]);

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function initialsFromDisplayName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

function hashUserId(userId) {
  const token = String(userId || '');
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = ((hash << 5) - hash) + token.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function pickDefaultColor(userId) {
  const index = hashUserId(toPublicId(userId)) % AVATAR_COLOR_PALETTE.length;
  return { ...AVATAR_COLOR_PALETTE[index] };
}

function normalizeAvatarColor(value) {
  if (!value || typeof value !== 'object') return null;
  const background = String(value.background || '').trim();
  const foreground = String(value.foreground || '').trim();
  if (!HEX_COLOR.test(background) || !HEX_COLOR.test(foreground)) return null;
  return { background, foreground };
}

async function getAvatarColor(userId, options = {}) {
  const id = toPublicId(userId);
  if (!id) return null;
  const stored = await userSettingsService.getSetting(id, AVATAR_COLOR_SETTING_KEY, null, options);
  return normalizeAvatarColor(stored);
}

async function ensureAvatarColor(userId, options = {}) {
  const id = toPublicId(userId);
  if (!id) return pickDefaultColor('');
  const existing = await getAvatarColor(id, options);
  if (existing) return existing;
  const picked = pickDefaultColor(id);
  await userSettingsService.setSetting(id, AVATAR_COLOR_SETTING_KEY, picked, 'system', options);
  return picked;
}

async function ensureAvatarColorsForUserIds(userIds = [], options = {}) {
  const ids = [...new Set(
    (Array.isArray(userIds) ? userIds : [])
      .map((row) => toPublicId(row))
      .filter(Boolean)
  )];
  const map = new Map();
  await Promise.all(ids.map(async (id) => {
    const color = await ensureAvatarColor(id, options);
    map.set(id, color);
  }));
  return map;
}

function attachAvatarPresentation(contact = {}, { name, avatar, userId, avatarColor = null } = {}) {
  const displayName = String(name ?? contact.name ?? '').trim();
  const id = toPublicId(userId ?? contact.id);
  const normalizedColor = normalizeAvatarColor(avatarColor)
    || normalizeAvatarColor(contact.avatarColor)
    || null;
  return {
    ...contact,
    id: id || contact.id,
    name: displayName || contact.name || 'Unknown',
    avatar: avatar !== undefined ? avatar : contact.avatar,
    initials: initialsFromDisplayName(displayName || contact.name),
    avatarColor: normalizedColor
  };
}

async function enrichContactsWithAvatarPresentation(contacts = [], options = {}) {
  const rows = Array.isArray(contacts) ? contacts : [];
  const colorById = await ensureAvatarColorsForUserIds(rows.map((row) => row.id), options);
  return rows.map((row) => attachAvatarPresentation(row, {
    name: row.name,
    avatar: row.avatar,
    userId: row.id,
    avatarColor: colorById.get(toPublicId(row.id)) || null
  }));
}

module.exports = {
  AVATAR_COLOR_PALETTE,
  AVATAR_COLOR_SETTING_KEY,
  initialsFromDisplayName,
  pickDefaultColor,
  normalizeAvatarColor,
  getAvatarColor,
  ensureAvatarColor,
  ensureAvatarColorsForUserIds,
  attachAvatarPresentation,
  enrichContactsWithAvatarPresentation
};
