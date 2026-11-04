const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('upload folder settings include core.profileAvatars', () => {
  const source = read('MVC/services/uploadFolderSettingsService.js');
  assert.match(source, /core\.profileAvatars/);
  assert.match(source, /profiles\/\{userId\}/);
});

test('profile routes register avatar upload endpoints', () => {
  const routes = read('MVC/routes/profileRoutes.js');
  assert.match(routes, /\/avatar/);
  assert.match(routes, /uploadProfilePhoto/);
  assert.match(routes, /uploadProfileAvatar/);
  assert.match(routes, /removeProfileAvatar/);
});

test('profile view includes photo upload controls and no-person message', () => {
  const view = read('MVC/views/user/profile.ejs');
  assert.match(view, /btnUploadProfileAvatar/);
  assert.match(view, /btnRemoveProfileAvatar/);
  assert.match(view, /profileAvatarFileInput/);
  assert.match(view, /not linked to a person record/);
  assert.match(view, /profileAvatarPasteZone/);
  assert.match(view, /paste a copied or captured image/i);
});

test('compressProfileImageBuffer keeps output under 500KB', async () => {
  const profileAvatarService = require('../MVC/services/profileAvatarService');
  const largePng = await sharp({
    create: {
      width: 1600,
      height: 1200,
      channels: 3,
      background: { r: 120, g: 80, b: 200 }
    }
  }).png().toBuffer();

  const result = await profileAvatarService.compressProfileImageBuffer(largePng);
  assert.ok(result.buffer.length <= profileAvatarService.MAX_OUTPUT_BYTES);
  assert.equal(result.mimeType, 'image/jpeg');
});

test('uploadProfileAvatar requires linked person', async () => {
  const profileAvatarPath = path.join(ROOT_DIR, 'MVC/services/profileAvatarService.js');
  delete require.cache[profileAvatarPath];
  const profileAvatarService = require('../MVC/services/profileAvatarService');

  await assert.rejects(
    () => profileAvatarService.uploadProfileAvatar({
      user: { id: 'USER-1' },
      file: { buffer: Buffer.from('x'), originalname: 'a.jpg', mimetype: 'image/jpeg' }
    }),
    (error) => /linked person/i.test(error.message)
  );
});

test('isManagedProfileUploadUrl detects managed profile paths', () => {
  const profileAvatarService = require('../MVC/services/profileAvatarService');
  assert.equal(profileAvatarService.isManagedProfileUploadUrl('/uploads/GLOBAL/profiles/USER_1/avatar.jpg'), true);
  assert.equal(profileAvatarService.isManagedProfileUploadUrl('https://example.com/a.jpg'), false);
});
