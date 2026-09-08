const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const chatAttachmentAccessService = require('../MVC/services/chatAttachmentAccessService');

test('chat attachment URLs are routed through the guarded chat endpoint', () => {
  const url = chatAttachmentAccessService.getSecureAttachmentUrl(
    'CONV 1',
    '/uploads/GLOBAL/chat/CONV%201/final report.pdf'
  );

  assert.equal(url, '/chat/attachments/CONV%201/final%20report.pdf');
});

test('direct static reads are blocked only for chat upload folders', () => {
  assert.equal(chatAttachmentAccessService.isProtectedChatUploadPath('/GLOBAL/chat/CONV-1/file.pdf'), true);
  assert.equal(chatAttachmentAccessService.isProtectedChatUploadPath('/uploads/GLOBAL/chat/CONV-1/file.pdf'), true);
  assert.equal(chatAttachmentAccessService.isProtectedChatUploadPath('/ORG_900000/chat/CONV-1/file.pdf'), true);
  assert.equal(chatAttachmentAccessService.isProtectedChatUploadPath('/GLOBAL/symbols/logo.png'), false);
  assert.equal(chatAttachmentAccessService.isProtectedChatUploadPath('/GLOBAL/chat-assets/logo.png'), false);
});

test('chat routes declare separate READ inbox, READ_ALL history, and scoped list gates', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'MVC/routes/chatRoutes.js'), 'utf8');

  assert.match(source, /router\.get\('\/conversations',\s*requireChatAccessAny\(OPERATIONS\.READ,\s*OPERATIONS\.READ\)/);
  assert.match(source, /router\.get\('\/messages\/:convId',\s*requireChatAccessAny\(OPERATIONS\.READ_ALL,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(source, /router\.get\('\/list',\s*requireChatAccessAny\(\[OPERATIONS\.READ,\s*OPERATIONS\.READ_ALL\],\s*OPERATIONS\.READ\)/);
  assert.match(source, /router\.get\('\/attachments\/:convId\/:fileName',\s*requireChatAccessAny\(OPERATIONS\.DOWNLOAD_FILE\)/);
});

test('app static uploads route delegates chat folder detection before serving files', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'app.js'), 'utf8');

  assert.match(source, /chatAttachmentAccessService\.isProtectedChatUploadPath/);
  assert.match(source, /res\.status\(404\)\.send\('Not found'\)/);
});
