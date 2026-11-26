'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const chatSystemParticipantService = require('../MVC/services/chatSystemParticipantService');
const chatContactScopeService = require('../MVC/services/chatContactScopeService');

test('isChatSystemParticipant matches system id case-insensitively', () => {
  assert.equal(chatSystemParticipantService.isChatSystemParticipant('system'), true);
  assert.equal(chatSystemParticipantService.isChatSystemParticipant('SYSTEM'), true);
  assert.equal(chatSystemParticipantService.isChatSystemParticipant('USR-1'), false);
});

test('projectChatSystemParticipant uses System Admin label', () => {
  const row = chatSystemParticipantService.projectChatSystemParticipant();
  assert.equal(row.name, 'System Admin');
  assert.equal(row.id, 'system');
});

test('buildConversationContactStates names system participant in author conversation', async () => {
  const originalLoadUsers = require('../MVC/repositories/userRepository').getById;
  const userRepo = require('../MVC/repositories/userRepository');
  userRepo.getById = async () => null;

  const requestingUser = { id: 'USR-AUTHOR', activeOrgId: '900000', personId: 'P1' };
  const conversations = [{
    id: 'CHAT-WOD',
    participants: [
      { userId: 'USR-AUTHOR', unreadCount: 1 },
      { userId: 'system', unreadCount: 0 }
    ]
  }];

  try {
    const states = await chatContactScopeService.buildConversationContactStates(requestingUser, conversations, {
      scopeId: 'SCP_ORG'
    });
    const state = states.get('CHAT-WOD');
    assert.ok(state);
    const systemRow = state.participants.find((p) => p.userId === 'system');
    assert.ok(systemRow);
    assert.equal(systemRow.display.name, 'System Admin');
    assert.notEqual(systemRow.display.name, 'Unknown User');
  } finally {
    userRepo.getById = originalLoadUsers;
  }
});