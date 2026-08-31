'use strict';

const PLACEHOLDER_TOKEN_REGEX = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

const WRAPPER_PLACEHOLDER_DEFINITIONS = Object.freeze([
  { token: 'BODY_CONTENT', description: 'Composed notification body from School Settings (injected into the Email Management wrapper).' },
  { token: 'TEACHER_NAME', description: 'Recipient teacher display name.' },
  { token: 'TEACHER_EMAIL', description: 'Recipient teacher email address.' },
  { token: 'USER_EMAIL', description: 'Alias for teacher email (for event-style templates).' },
  { token: 'ORG_NAME', description: 'Active organization name.' },
  { token: 'SESSION_COUNT', description: 'Number of uncompleted sessions in the digest.' },
  { token: 'SESSION_LIST', description: 'Plain-text list of uncompleted sessions.' },
  { token: 'CLASS_NAME', description: 'Class title for single-session context.' },
  { token: 'CLASS_ID', description: 'Class identifier.' },
  { token: 'SESSION_NAME', description: 'Session label (date, time, room).' },
  { token: 'SESSION_ID', description: 'Session identifier.' },
  { token: 'SESSION_DATE', description: 'Session date.' },
  { token: 'SESSION_TIME', description: 'Session start/end time.' },
  { token: 'SESSION_MANAGER_URL', description: 'Relative URL to the session manager page.' }
]);

const WRAPPER_PLACEHOLDER_TOKENS = Object.freeze(
  WRAPPER_PLACEHOLDER_DEFINITIONS.map((row) => row.token)
);

function cleanToken(value = '') {
  return String(value || '').trim().toUpperCase();
}

function extractPlaceholders(...chunks) {
  const found = new Set();
  (Array.isArray(chunks) ? chunks : []).forEach((chunk) => {
    const text = String(chunk || '');
    if (!text) return;
    let match = PLACEHOLDER_TOKEN_REGEX.exec(text);
    while (match) {
      const token = cleanToken(match[1]);
      if (token) found.add(token);
      match = PLACEHOLDER_TOKEN_REGEX.exec(text);
    }
    PLACEHOLDER_TOKEN_REGEX.lastIndex = 0;
  });
  return Array.from(found);
}

function extractPlaceholdersFromTemplate(template = {}) {
  return extractPlaceholders(
    template.senderTemplate,
    template.recipientTemplate,
    template.subjectTemplate,
    template.bodyTemplate
  );
}

function templateHasBodyContentSlot(template = {}) {
  return /\{\{\s*BODY_CONTENT\s*\}\}/i.test(String(template?.bodyTemplate || ''));
}

function buildAllowedWrapperTokens(customMappings = []) {
  const allowed = new Set(WRAPPER_PLACEHOLDER_TOKENS);
  (Array.isArray(customMappings) ? customMappings : []).forEach((row) => {
    const token = cleanToken(row?.token);
    if (token) allowed.add(token);
  });
  return allowed;
}

function validateSessionNotificationEmailWrapperTemplate(template = {}, options = {}) {
  const customMappings = Array.isArray(options?.customMappings) ? options.customMappings : [];
  const usedPlaceholders = extractPlaceholdersFromTemplate(template);
  const suppliedSet = buildAllowedWrapperTokens(customMappings);
  const unsupportedTokens = usedPlaceholders.filter((token) => !suppliedSet.has(token));
  const hasBodyContentSlot = templateHasBodyContentSlot(template);
  const warnings = [];

  if (!hasBodyContentSlot) {
    warnings.push(
      'The selected email template does not include {{BODY_CONTENT}}. Add that placeholder to the template body in Email Management so school message content can appear inside the template wrapper.'
    );
  }
  if (unsupportedTokens.length) {
    warnings.push(
      `Template uses placeholders School does not supply at send time: ${unsupportedTokens.join(', ')}.`
    );
  }

  return {
    usedPlaceholders,
    hasBodyContentSlot,
    unsupportedTokens,
    warnings
  };
}

module.exports = {
  WRAPPER_PLACEHOLDER_DEFINITIONS,
  WRAPPER_PLACEHOLDER_TOKENS,
  extractPlaceholdersFromTemplate,
  templateHasBodyContentSlot,
  buildAllowedWrapperTokens,
  validateSessionNotificationEmailWrapperTemplate
};
