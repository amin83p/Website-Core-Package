const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

test('message action routes, reply payload, and context-menu controls are declared', () => {
  const routes = fs.readFileSync(path.join(ROOT_DIR, 'MVC/routes/chatRoutes.js'), 'utf8');
  const socket = fs.readFileSync(path.join(ROOT_DIR, 'MVC/services/socketService.js'), 'utf8');
  const modal = fs.readFileSync(path.join(ROOT_DIR, 'MVC/views/partials/chatModal.ejs'), 'utf8');

  assert.match(routes, /router\.delete\('\/messages\/:convId\/:messageId'/);
  assert.match(routes, /router\.post\('\/messages\/bulk-delete'/);
  assert.match(socket, /replyToMessageId/);
  assert.match(socket, /message_deleted/);
  assert.match(modal, /chatMessageContextMenu/);
  assert.match(modal, /deleteSelectedMessages/);
  assert.match(modal, /replyToMessage/);
  assert.match(modal, /pointerdown/);
});

test('message models preserve reply metadata and use soft-delete fields', () => {
  const model = fs.readFileSync(path.join(ROOT_DIR, 'MVC/models/chatModel.js'), 'utf8');
  const repository = fs.readFileSync(path.join(ROOT_DIR, 'MVC/repositories/chatRepository.js'), 'utf8');

  assert.match(model, /replyTo: options\?\.replyTo \|\| null/);
  assert.match(model, /deletedAt: now/);
  assert.match(model, /content: 'Message deleted'/);
  assert.match(repository, /softDeleteMessages/);
  assert.match(repository, /getMessage/);
  assert.match(repository, /hasActiveAttachment/);
  assert.match(model, /hasActiveAttachment/);
});

test('scoped deletion and contact policy include package, role, and organization modes', () => {
  const access = fs.readFileSync(path.join(ROOT_DIR, 'MVC/services/chatAccessService.js'), 'utf8');
  const contacts = fs.readFileSync(path.join(ROOT_DIR, 'MVC/services/chatContactScopeService.js'), 'utf8');

  assert.match(access, /getConversationScopeEligibility/);
  assert.match(access, /scopeMode === 'owner' \|\| scopeMode === 'user'/);
  assert.match(contacts, /scopeMode === 'division'/);
  assert.match(contacts, /scopeMode === 'organization' \|\| scopeMode === 'admin'/);
  assert.match(contacts, /!\['department', 'division'\]\.includes\(scopeMode\)/);
});
