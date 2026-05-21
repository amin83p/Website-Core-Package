const chatAccessService = require('../services/chatAccessService');

function shouldEvaluateForView(req) {
  if (!req?.user) return false;
  if (req.method !== 'GET') return false;
  const accept = String(req.headers?.accept || '');
  return !accept || accept.includes('text/html');
}

module.exports = async function chatAccessLocals(req, res, next) {
  res.locals.chatAccess = { ...chatAccessService.EMPTY_CHAT_ACCESS };

  if (!shouldEvaluateForView(req)) return next();

  try {
    res.locals.chatAccess = await chatAccessService.buildChatAccess(req.user, req.ip);
  } catch (error) {
    console.warn(`[ChatAccess] Unable to build chat view access: ${error.message}`);
  }

  return next();
};
