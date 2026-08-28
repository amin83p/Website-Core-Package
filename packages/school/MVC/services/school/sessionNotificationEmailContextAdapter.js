'use strict';

function cleanText(value) {
  return String(value ?? '').trim();
}

function mapNotificationContextToEmailPlaceholders(context = {}) {
  const sessionList = cleanText(context.sessionList);
  return {
    TEACHER_NAME: cleanText(context.teacherName),
    ORG_NAME: cleanText(context.orgName),
    SESSION_COUNT: cleanText(context.sessionCount),
    SESSION_LIST: sessionList,
    BODY_CONTENT: sessionList,
    CLASS_NAME: cleanText(context.className),
    CLASS_ID: cleanText(context.classId),
    SESSION_NAME: cleanText(context.sessionName),
    SESSION_ID: cleanText(context.sessionId),
    SESSION_DATE: cleanText(context.sessionDate),
    SESSION_TIME: cleanText(context.sessionTime),
    SESSION_MANAGER_URL: cleanText(context.sessionManagerUrl)
  };
}

module.exports = {
  mapNotificationContextToEmailPlaceholders
};
