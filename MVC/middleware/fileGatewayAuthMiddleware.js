const { verifySignedRequest } = require('../services/fileGatewayAuthService');

function fileGatewayAuth(expectedRoutePath = '') {
  return (req, res, next) => {
    const result = verifySignedRequest(req, expectedRoutePath);
    if (!result.ok) {
      return res.status(401).json({ status: 'error', message: result.message || 'Unauthorized gateway request.' });
    }
    return next();
  };
}

module.exports = fileGatewayAuth;
