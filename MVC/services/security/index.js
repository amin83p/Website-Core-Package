const accessControl = require('./accessControl');
const delegation = require('./delegation');

module.exports = {
    // Runtime Checks
    evaluateAccess: accessControl.evaluateAccess,
    
    // Admin Checks
    validateDelegation: delegation.validateDelegation
};