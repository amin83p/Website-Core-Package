'use strict';

const path = require('path');
const heicConvert = require('heic-convert');
const sharp = require('sharp');
const personRepository = require('../repositories/personRepository');
const uploadStorageService = require('./uploadStorageService');
const uploadFolderSettingsService = require('./uploadFolderSettingsService');
const { idsEqual, toPublicId } = require('../utils/idAdapter');

const MAX_OUTPUT_BYTES = 500 * 1024;
const MAX_EDGE_PX = 512;
const MAX_INGRESS_BYTES = 5 * 1024 * 1024;
const PROFILE_AVATAR_FILE_NAME = 'avatar.jpg';

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]);

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function cleanText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function isManagedProfileUploadUrl(url = '') {
  const token = cleanText(url, 2000);
  if (!token.startsWith('/uploads/')) return false;
  return /\/profiles\//i.test(token);
}

async function deleteManagedAvatarIfPresent(url = '') {
  if (!isManagedProfileUploadUrl(url)) return;
  try {
    await uploadStorageService.deleteByReference(url);
  } catch (_) {
    /* best effort */
  }
}

function validateUploadFile(file = {}) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw createHttpError('Photo file is required.');
  }
  if (file.buffer.length > MAX_INGRESS_BYTES) {
    throw createHttpError('Photo must be 5 MB or smaller before processing.');
  }
  const ext = path.extname(String(file.originalname || '')).toLowerCase();
  const mime = String(file.mimetype || '').trim().toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_MIME_TYPES.has(mime)) {
    throw createHttpError('Unsupported image type. Use JPG, PNG, WebP, or HEIC.');
  }
}

async function normalizeInputBuffer(file = {}) {
  validateUploadFile(file);
  const ext = path.extname(String(file.originalname || '')).toLowerCase();
  const mime = String(file.mimetype || '').trim().toLowerCase();
  if (ext === '.heic' || ext === '.heif' || mime === 'image/heic' || mime === 'image/heif') {
    const converted = await heicConvert({
      buffer: file.buffer,
      format: 'JPEG',
      quality: 0.92
    });
    return Buffer.from(converted);
  }
  return file.buffer;
}

async function compressProfileImageBuffer(inputBuffer) {
  let edge = MAX_EDGE_PX;
  while (edge >= 128) {
    let quality = 86;
    while (quality >= 40) {
      const buffer = await sharp(inputBuffer, { failOn: 'none' })
        .rotate()
        .resize({
          width: edge,
          height: edge,
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (buffer.length <= MAX_OUTPUT_BYTES) {
        const metadata = await sharp(buffer).metadata();
        return {
          buffer,
          bytes: buffer.length,
          width: metadata.width || null,
          height: metadata.height || null,
          mimeType: 'image/jpeg'
        };
      }
      quality -= 8;
    }
    edge = Math.floor(edge * 0.75);
  }
  throw createHttpError('Unable to optimize photo below 500 KB. Try a smaller image.');
}

async function assertLinkedPerson(user = {}) {
  const personId = toPublicId(user?.personId);
  if (!personId) {
    throw createHttpError('A linked person record is required before you can upload a profile photo.', 403);
  }
  const person = await personRepository.getById(personId, { enrichment: { includeSchoolRoles: false } });
  if (!person) {
    throw createHttpError('Linked person record was not found.', 404);
  }
  if (!idsEqual(person.id, personId)) {
    throw createHttpError('Person link mismatch.', 403);
  }
  return { personId, person };
}

async function uploadProfileAvatar({ user, file } = {}) {
  const userId = toPublicId(user?.id);
  if (!userId) throw createHttpError('Authentication required.', 401);

  const { personId, person } = await assertLinkedPerson(user);
  const inputBuffer = await normalizeInputBuffer(file);
  const compressed = await compressProfileImageBuffer(inputBuffer);

  const relativeDir = uploadFolderSettingsService.resolveUploadFolder('core.profileAvatars', {
    userId
  });

  const previousUrl = cleanText(person.avatarUrl, 2000);
  const saved = await uploadStorageService.saveBuffer({
    scopeKey: 'GLOBAL',
    relativeDir,
    fileName: PROFILE_AVATAR_FILE_NAME,
    originalName: PROFILE_AVATAR_FILE_NAME,
    mimeType: compressed.mimeType,
    buffer: compressed.buffer,
    overwrite: true
  });

  const avatarUrl = cleanText(saved.url, 2000);
  if (!avatarUrl) throw createHttpError('Failed to store profile photo.');

  await personRepository.update(personId, {
    avatarUrl,
    audit: {
      lastUpdateUser: userId,
      lastUpdateDateTime: new Date().toISOString()
    }
  });

  if (previousUrl && previousUrl !== avatarUrl) {
    await deleteManagedAvatarIfPresent(previousUrl);
  }

  return {
    avatarUrl,
    bytes: compressed.bytes,
    width: compressed.width,
    height: compressed.height
  };
}

async function removeProfileAvatar({ user } = {}) {
  const userId = toPublicId(user?.id);
  if (!userId) throw createHttpError('Authentication required.', 401);

  const { personId, person } = await assertLinkedPerson(user);
  const previousUrl = cleanText(person.avatarUrl, 2000);

  await personRepository.update(personId, {
    avatarUrl: null,
    audit: {
      lastUpdateUser: userId,
      lastUpdateDateTime: new Date().toISOString()
    }
  });

  await deleteManagedAvatarIfPresent(previousUrl);

  return { avatarUrl: null };
}

module.exports = {
  MAX_OUTPUT_BYTES,
  MAX_INGRESS_BYTES,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  compressProfileImageBuffer,
  uploadProfileAvatar,
  removeProfileAvatar,
  isManagedProfileUploadUrl
};
