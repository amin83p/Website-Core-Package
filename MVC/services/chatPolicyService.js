'use strict';

const fs = require('fs');
const path = require('path');
const systemSettingsModel = require('../models/systemSettingsModel');
const chatRepository = require('../repositories/chatRepository');
const coreFilesService = require('../services/coreFilesService');
const uploadStorage = require('../services/uploadStorageService');
const uploadStoragePolicy = require('../services/uploadStoragePolicyService');
const uploadFolderSettingsService = require('../services/uploadFolderSettingsService');
const { idsEqual, toPublicId } = require('../utils/idAdapter');

const DEFAULT_CHAT_POLICY = Object.freeze({
  attachmentsEnabled: true,
  maxFileSizeKb: null,
  allowedExtensions: '',
  blockedExtensions: '',
  maxConversationSizeMb: null,
  maxUserTotalSizeMb: null,
  storageWarnPercent: 85,
  specialUsers: []
});

const DEFAULT_BUILTIN_EXTENSIONS = Object.freeze([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.rtf',
  '.zip', '.rar', '.7z', '.tar', '.gz'
]);

const DEFAULT_BUILTIN_MIME_TYPES = Object.freeze([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/rtf',
  'application/zip',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/gzip'
]);

const VALID_SPECIAL_MODES = new Set(['custom', 'banned', 'deactivated']);

function cleanText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function parseOptionalPositiveInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.floor(num);
}

function parseOptionalPositiveMb(value) {
  const parsed = parseOptionalPositiveInt(value);
  if (parsed === null) return null;
  return parsed;
}

function parseWarnPercent(value, fallback = 85) {
  const num = Number.parseInt(String(value ?? fallback).trim(), 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(50, Math.min(99, num));
}

function parseExtensionList(raw = '') {
  return String(raw || '')
    .split(/[\s,;|]+/)
    .map((token) => {
      const trimmed = token.trim().toLowerCase();
      if (!trimmed) return '';
      return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
    })
    .filter(Boolean);
}

function mbToBytes(mb) {
  if (mb === null || mb === undefined) return null;
  const num = Number(mb);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.floor(num * 1024 * 1024);
}

function formatBytes(bytes, decimals = 1) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(value) / Math.log(k)));
  return `${parseFloat((value / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function normalizeSpecialUserRow(raw = {}) {
  const userId = toPublicId(raw.userId || raw.id);
  if (!userId) return null;
  const mode = VALID_SPECIAL_MODES.has(String(raw.mode || '').trim().toLowerCase())
    ? String(raw.mode).trim().toLowerCase()
    : 'custom';
  return {
    userId,
    label: cleanText(raw.label || raw.displayName || raw.name, 200),
    mode,
    exemptFromStorageLimits: raw.exemptFromStorageLimits === true
      || String(raw.exemptFromStorageLimits || '').trim().toLowerCase() === 'true',
    exemptFromFileRules: raw.exemptFromFileRules === true
      || String(raw.exemptFromFileRules || '').trim().toLowerCase() === 'true',
    attachmentsEnabled: raw.attachmentsEnabled === null || raw.attachmentsEnabled === undefined || raw.attachmentsEnabled === ''
      ? null
      : (raw.attachmentsEnabled === true || String(raw.attachmentsEnabled).trim().toLowerCase() === 'true'),
    maxFileSizeKb: parseOptionalPositiveInt(raw.maxFileSizeKb),
    allowedExtensions: cleanText(raw.allowedExtensions, 2000),
    blockedExtensions: cleanText(raw.blockedExtensions, 2000),
    maxConversationSizeMb: parseOptionalPositiveMb(raw.maxConversationSizeMb),
    maxUserTotalSizeMb: parseOptionalPositiveMb(raw.maxUserTotalSizeMb)
  };
}

function normalizePolicyFromStored(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const specialUsers = (Array.isArray(source.specialUsers) ? source.specialUsers : [])
    .map((row) => normalizeSpecialUserRow(row))
    .filter(Boolean);
  return {
    attachmentsEnabled: source.attachmentsEnabled !== false,
    maxFileSizeKb: parseOptionalPositiveInt(source.maxFileSizeKb),
    allowedExtensions: cleanText(source.allowedExtensions, 2000),
    blockedExtensions: cleanText(source.blockedExtensions, 2000),
    maxConversationSizeMb: parseOptionalPositiveMb(source.maxConversationSizeMb),
    maxUserTotalSizeMb: parseOptionalPositiveMb(source.maxUserTotalSizeMb),
    storageWarnPercent: parseWarnPercent(source.storageWarnPercent, 85),
    specialUsers
  };
}

function getGlobalPolicy() {
  const settings = systemSettingsModel.getSettingsSync();
  const appPolicy = settings?.app?.chatPolicy;
  return normalizePolicyFromStored({
    ...DEFAULT_CHAT_POLICY,
    ...(appPolicy && typeof appPolicy === 'object' ? appPolicy : {})
  });
}

function findSpecialUserRow(policy, userId) {
  const id = toPublicId(userId);
  if (!id) return null;
  return (policy.specialUsers || []).find((row) => idsEqual(row.userId, id)) || null;
}

function mergeNullableBool(globalValue, overrideValue) {
  if (overrideValue === null || overrideValue === undefined) return globalValue !== false;
  return overrideValue === true;
}

function mergeNullableNumber(globalValue, overrideValue) {
  if (overrideValue === null || overrideValue === undefined) return globalValue;
  return overrideValue;
}

function mergeNullableString(globalValue, overrideValue) {
  const token = cleanText(overrideValue, 2000);
  return token || cleanText(globalValue, 2000);
}

function resolveForUser(userId) {
  const global = getGlobalPolicy();
  const special = findSpecialUserRow(global, userId);
  const mode = special?.mode || null;

  if (mode === 'deactivated') {
    return {
      deactivated: true,
      banned: false,
      mode: 'deactivated',
      reason: 'Chat has been deactivated for your account.',
      exemptFromStorageLimits: true,
      exemptFromFileRules: true,
      attachmentsEnabled: false,
      maxFileSizeKb: 0,
      allowedExtensions: '',
      blockedExtensions: '',
      maxConversationSizeMb: null,
      maxUserTotalSizeMb: null,
      storageWarnPercent: global.storageWarnPercent,
      specialUser: special
    };
  }

  const useOverrides = mode === 'custom' && special;
  const exemptFromStorageLimits = Boolean(special?.exemptFromStorageLimits);
  const exemptFromFileRules = Boolean(special?.exemptFromFileRules);

  return {
    deactivated: false,
    banned: mode === 'banned',
    mode: mode || 'default',
    reason: mode === 'banned' ? 'Your account is restricted from sending chat messages.' : '',
    exemptFromStorageLimits,
    exemptFromFileRules,
    attachmentsEnabled: useOverrides
      ? mergeNullableBool(global.attachmentsEnabled, special.attachmentsEnabled)
      : global.attachmentsEnabled !== false,
    maxFileSizeKb: useOverrides
      ? mergeNullableNumber(global.maxFileSizeKb, special.maxFileSizeKb)
      : global.maxFileSizeKb,
    allowedExtensions: useOverrides
      ? mergeNullableString(global.allowedExtensions, special.allowedExtensions)
      : global.allowedExtensions,
    blockedExtensions: useOverrides
      ? mergeNullableString(global.blockedExtensions, special.blockedExtensions)
      : global.blockedExtensions,
    maxConversationSizeMb: useOverrides
      ? mergeNullableNumber(global.maxConversationSizeMb, special.maxConversationSizeMb)
      : global.maxConversationSizeMb,
    maxUserTotalSizeMb: useOverrides
      ? mergeNullableNumber(global.maxUserTotalSizeMb, special.maxUserTotalSizeMb)
      : global.maxUserTotalSizeMb,
    storageWarnPercent: global.storageWarnPercent,
    specialUser: special
  };
}

function buildClientPolicyPayload(resolved) {
  return {
    attachmentsEnabled: resolved.attachmentsEnabled !== false && !resolved.deactivated,
    maxFileSizeKb: resolved.maxFileSizeKb,
    allowedExtensions: resolved.allowedExtensions,
    blockedExtensions: resolved.blockedExtensions,
    deactivated: resolved.deactivated === true,
    banned: resolved.banned === true,
    reason: resolved.reason || ''
  };
}

function getEffectiveExtensionSet(resolved) {
  if (resolved.exemptFromFileRules) {
    return new Set(DEFAULT_BUILTIN_EXTENSIONS);
  }
  const allowedRaw = cleanText(resolved.allowedExtensions, 2000);
  const base = allowedRaw
    ? parseExtensionList(allowedRaw)
    : [...DEFAULT_BUILTIN_EXTENSIONS];
  const blocked = new Set(parseExtensionList(resolved.blockedExtensions));
  return new Set(base.filter((ext) => !blocked.has(ext)));
}

function getEffectiveMimeSet(resolved) {
  if (resolved.exemptFromFileRules) {
    return new Set(DEFAULT_BUILTIN_MIME_TYPES);
  }
  return new Set(DEFAULT_BUILTIN_MIME_TYPES);
}

function mergeEffectiveMaxFileSizeKb(resolved, profileMaxFileSizeKB = null) {
  const candidates = [];
  if (resolved.maxFileSizeKb != null && !resolved.exemptFromFileRules) {
    candidates.push(Number(resolved.maxFileSizeKb));
  }
  const profile = Number(profileMaxFileSizeKB);
  if (Number.isFinite(profile) && profile > 0) {
    candidates.push(Math.floor(profile));
  }
  if (!candidates.length) return null;
  return Math.min(...candidates);
}

function validateAttachmentFile({
  user = null,
  originalName = '',
  mimeType = '',
  sizeBytes = 0,
  profileMaxFileSizeKB = null
} = {}) {
  const resolved = resolveForUser(user?.id);
  if (resolved.deactivated) {
    return { allowed: false, reason: resolved.reason || 'Chat is deactivated for your account.' };
  }
  if (resolved.banned) {
    return { allowed: false, reason: resolved.reason || 'You cannot send attachments.' };
  }
  if (resolved.attachmentsEnabled === false) {
    return { allowed: false, reason: 'File attachments are disabled by chat policy.' };
  }

  const ext = path.extname(String(originalName || '')).toLowerCase();
  const mime = String(mimeType || '').trim().toLowerCase();
  const allowedExt = getEffectiveExtensionSet(resolved);
  const allowedMime = getEffectiveMimeSet(resolved);
  if (!allowedExt.has(ext) || !allowedMime.has(mime)) {
    return { allowed: false, reason: `File type not allowed: ${ext || 'unknown'} (${mime || 'unknown type'}).` };
  }

  const maxKb = mergeEffectiveMaxFileSizeKb(resolved, profileMaxFileSizeKB);
  if (maxKb != null && Number(sizeBytes) > maxKb * 1024) {
    return {
      allowed: false,
      reason: `Attachment exceeds the ${maxKb} KB limit.`
    };
  }

  return { allowed: true, resolved, maxFileSizeKb: maxKb };
}

function getFolderSize(directoryPath) {
  if (!uploadStoragePolicy.allowLocalUploadFallback()) {
    return 0;
  }
  let totalSize = 0;
  try {
    if (fs.existsSync(directoryPath)) {
      const files = fs.readdirSync(directoryPath);
      for (const file of files) {
        const filePath = path.join(directoryPath, file);
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          totalSize += getFolderSize(filePath);
        } else {
          totalSize += stats.size;
        }
      }
    }
  } catch (_) {
    /* ignore */
  }
  return totalSize;
}

async function sumUploadDirectoryBytes(scopeKey, relativeDir = '') {
  let total = 0;
  try {
    const entries = await uploadStorage.listDirectory({ scopeKey, relativeDir });
    for (const entry of (Array.isArray(entries) ? entries : [])) {
      const name = String(entry?.name || '').trim();
      if (!name) continue;
      const childRelative = [relativeDir, name].filter(Boolean).join('/').replace(/\\/g, '/');
      if (entry.isDir) {
        total += await sumUploadDirectoryBytes(scopeKey, childRelative);
      } else {
        total += Number(entry?.size || 0);
      }
    }
  } catch (_) {
    /* missing folder */
  }
  return total;
}

async function getChatAttachmentBytes(convId) {
  const context = { conversationId: convId };
  const folders = [...new Set([
    uploadFolderSettingsService.resolveUploadFolder('core.chat', context),
    uploadFolderSettingsService.resolveDefaultUploadFolder('core.chat', context)
  ].filter(Boolean))];
  let total = 0;
  for (const relativePath of folders) {
    total += await sumUploadDirectoryBytes('GLOBAL', relativePath);
  }
  if (uploadStoragePolicy.allowLocalUploadFallback()) {
    try {
      const root = coreFilesService.getRootPath('GLOBAL');
      const chatDir = coreFilesService.resolveSafePath(root, `chat/${convId}`);
      total += getFolderSize(chatDir);
    } catch (_) {
      /* legacy path missing */
    }
  }
  return total;
}

async function getConversationStorageBytes(convId) {
  const id = String(convId || '').trim();
  if (!id) return 0;
  let totalBytes = 0;
  const msgFile = path.join(__dirname, '../../data/messages/', `${id}.json`);
  if (fs.existsSync(msgFile)) {
    try {
      totalBytes += fs.statSync(msgFile).size;
    } catch (_) {
      /* ignore */
    }
  }
  totalBytes += await getChatAttachmentBytes(id);
  return totalBytes;
}

async function getUserStorageBytes(userId) {
  const id = toPublicId(userId);
  if (!id) return 0;
  const conversations = await chatRepository.getConversationsForUser(id);
  const rows = Array.isArray(conversations) ? conversations : [];
  let total = 0;
  for (const row of rows) {
    const convId = String(row?.id || '').trim();
    if (!convId) continue;
    total += await getConversationStorageBytes(convId);
  }
  return total;
}

function buildLimitStatus(usedBytes, limitMb, warnPercent, label) {
  const limitBytes = mbToBytes(limitMb);
  if (limitBytes === null) {
    return {
      usedBytes,
      limitBytes: null,
      warn: false,
      blockAttachments: false,
      message: '',
      usedLabel: formatBytes(usedBytes),
      limitLabel: ''
    };
  }
  const ratio = limitBytes > 0 ? usedBytes / limitBytes : 0;
  const warnThreshold = Math.max(0.5, Math.min(0.99, Number(warnPercent || 85) / 100));
  const warn = ratio >= warnThreshold && ratio < 1;
  const blockAttachments = ratio >= 1;
  let message = '';
  if (blockAttachments) {
    message = `${label} storage limit reached (${formatBytes(usedBytes)} of ${formatBytes(limitBytes)}). Attachments are blocked; text messages are still allowed.`;
  } else if (warn) {
    message = `${label} storage is nearly full (${formatBytes(usedBytes)} of ${formatBytes(limitBytes)}).`;
  }
  return {
    usedBytes,
    limitBytes,
    warn,
    blockAttachments,
    message,
    usedLabel: formatBytes(usedBytes),
    limitLabel: formatBytes(limitBytes)
  };
}

async function buildStorageStatus({ userId, convId = null } = {}) {
  const resolved = resolveForUser(userId);
  const result = { user: null, conversation: null };
  if (resolved.exemptFromStorageLimits) {
    return result;
  }

  if (userId) {
    const used = await getUserStorageBytes(userId);
    result.user = buildLimitStatus(
      used,
      resolved.maxUserTotalSizeMb,
      resolved.storageWarnPercent,
      'Your chat'
    );
  }

  if (convId) {
    const used = await getConversationStorageBytes(convId);
    result.conversation = buildLimitStatus(
      used,
      resolved.maxConversationSizeMb,
      resolved.storageWarnPercent,
      'This conversation'
    );
  }

  return result;
}

async function assertAttachmentAllowedAtStorageCap({ userId, convId } = {}) {
  const resolved = resolveForUser(userId);
  if (resolved.exemptFromStorageLimits) {
    return { allowed: true };
  }
  const status = await buildStorageStatus({ userId, convId });
  if (status.conversation?.blockAttachments) {
    return { allowed: false, reason: status.conversation.message || 'Conversation storage limit reached.' };
  }
  if (status.user?.blockAttachments) {
    return { allowed: false, reason: status.user.message || 'Your chat storage limit reached.' };
  }
  return { allowed: true };
}

function normalizePolicyFromForm(body = {}) {
  let specialUsers = [];
  const jsonRaw = cleanText(body.chatPolicySpecialUsersJson, 500000);
  if (jsonRaw) {
    try {
      const parsed = JSON.parse(jsonRaw);
      if (Array.isArray(parsed)) {
        specialUsers = parsed.map((row) => normalizeSpecialUserRow(row)).filter(Boolean);
      }
    } catch (_) {
      throw new Error('Special chat users JSON is invalid.');
    }
  }

  return normalizePolicyFromStored({
    attachmentsEnabled: body.chatAttachmentsEnabled === 'true',
    maxFileSizeKb: parseOptionalPositiveInt(body.chatMaxFileSizeKb),
    allowedExtensions: cleanText(body.chatAllowedExtensions, 2000),
    blockedExtensions: cleanText(body.chatBlockedExtensions, 2000),
    maxConversationSizeMb: parseOptionalPositiveMb(body.chatMaxConversationSizeMb),
    maxUserTotalSizeMb: parseOptionalPositiveMb(body.chatMaxUserTotalSizeMb),
    storageWarnPercent: parseWarnPercent(body.chatStorageWarnPercent, 85),
    specialUsers
  });
}

function validatePolicyInput(policy = {}) {
  const normalized = normalizePolicyFromStored(policy);
  if (normalized.maxFileSizeKb != null && normalized.maxFileSizeKb > 512000) {
    throw new Error('Chat max file size cannot exceed 512000 KB.');
  }
  if (normalized.maxConversationSizeMb != null && normalized.maxConversationSizeMb > 10240) {
    throw new Error('Max conversation size cannot exceed 10240 MB.');
  }
  if (normalized.maxUserTotalSizeMb != null && normalized.maxUserTotalSizeMb > 102400) {
    throw new Error('Max user total size cannot exceed 102400 MB.');
  }
  return normalized;
}

function enrichPolicyForDisplay(policy = {}) {
  const normalized = normalizePolicyFromStored(policy);
  return {
    ...normalized,
    specialUsersJson: JSON.stringify(normalized.specialUsers || [])
  };
}

module.exports = {
  DEFAULT_CHAT_POLICY,
  DEFAULT_BUILTIN_EXTENSIONS,
  DEFAULT_BUILTIN_MIME_TYPES,
  normalizePolicyFromStored,
  normalizePolicyFromForm,
  validatePolicyInput,
  enrichPolicyForDisplay,
  getGlobalPolicy,
  resolveForUser,
  buildClientPolicyPayload,
  validateAttachmentFile,
  mergeEffectiveMaxFileSizeKb,
  getConversationStorageBytes,
  getUserStorageBytes,
  getChatAttachmentBytes,
  buildStorageStatus,
  assertAttachmentAllowedAtStorageCap,
  formatBytes
};
