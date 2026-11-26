'use strict';

const CHAT_SYSTEM_USER_ID = 'system';
const CHAT_SYSTEM_DISPLAY_NAME = 'System Admin';

function isChatSystemParticipant(userId) {
  return String(userId || '').trim().toLowerCase() === CHAT_SYSTEM_USER_ID;
}

function projectChatSystemParticipant(userId = CHAT_SYSTEM_USER_ID) {
  return {
    id: String(userId || CHAT_SYSTEM_USER_ID),
    name: CHAT_SYSTEM_DISPLAY_NAME,
    avatar: null,
    email: '',
    org: 'System',
    roles: [],
    roleLabels: ['System Admin'],
    packages: [],
    packageDomains: [],
    plainMember: false
  };
}

module.exports = {
  CHAT_SYSTEM_USER_ID,
  CHAT_SYSTEM_DISPLAY_NAME,
  isChatSystemParticipant,
  projectChatSystemParticipant
};