'use strict';

const {
  resolveWrapperPlaceholderValues
} = require('./sessionNotificationEmailPlaceholderMappingService');

function mapNotificationContextToEmailPlaceholders(context = {}, options = {}) {
  const emailChannel = options?.emailChannel || {};
  const customMappings = Array.isArray(emailChannel?.wrapperPlaceholderMappings)
    ? emailChannel.wrapperPlaceholderMappings
    : (Array.isArray(options?.customMappings) ? options.customMappings : []);
  return resolveWrapperPlaceholderValues({
    context,
    emailChannel,
    customMappings,
    bodyContent: options?.bodyContent,
    teacher: options?.teacher || null
  });
}

module.exports = {
  mapNotificationContextToEmailPlaceholders
};
