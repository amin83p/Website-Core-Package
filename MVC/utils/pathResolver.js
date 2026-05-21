// MVC/utils/pathResolver.js
const path = require('path');
const fs = require('fs');
const uploadPathUtils = require('./uploadPathUtils');

const pathResolver = {
  // 1. Get the physical root for a specific scope.
  getRootPath: (scopeId) => {
    const uploadRoot = uploadPathUtils.getUploadRootAbsolute();
    if (!scopeId || scopeId === 'GLOBAL') {
      return path.join(uploadRoot, 'GLOBAL');
    }
    return path.join(uploadRoot, `ORG_${scopeId}`);
  },

  // 2. Security: validate and resolve a relative path.
  resolveSafePath: (basePath, relativePath) => {
    const safeBase = path.normalize(basePath);
    const requested = path.join(safeBase, relativePath || '');
    const normalized = path.normalize(requested);

    if (!normalized.startsWith(safeBase)) {
      throw new Error('Security Violation: Path traversal attempt blocked.');
    }

    return normalized;
  },

  // 3. Ensure directory exists.
  ensureDir: (dirPath) => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  },

  getWebUrlForUpload: (dirPath) => uploadPathUtils.fromDiskPathToUploadsUrl(dirPath)
};

module.exports = pathResolver;
