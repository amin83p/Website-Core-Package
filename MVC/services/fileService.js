const fs = require('fs').promises;
const uploadPathUtils = require('../utils/uploadPathUtils');
const { isRailwayProxyMode } = require('../utils/uploadModeUtils');
const { gatewayDeleteByUploadUrl } = require('./fileGatewayClientService');

/**
 * Deletes a physical file given its web URL.
 * @param {string} fileUrl - Stored URL/path (for example: /uploads/tasks/img.png)
 * @returns {Promise<boolean>} True when deleted (or already missing)
 */
async function deleteFile(fileUrl) {
  if (!fileUrl) return false;

  try {
    if (isRailwayProxyMode()) {
      await gatewayDeleteByUploadUrl(fileUrl);
      return true;
    }

    const uploadsRoot = uploadPathUtils.getUploadRootAbsolute();
    const absolutePath = uploadPathUtils.fromUploadsUrlToDiskPath(fileUrl, uploadsRoot);

    if (!absolutePath || !uploadPathUtils.isInsideUploadRoot(absolutePath, uploadsRoot)) {
      console.error(`[FileService] Security Warning: Blocked deletion outside uploads root: ${absolutePath}`);
      return false;
    }

    await fs.unlink(absolutePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    console.warn(`[FileService] Delete Failed for ${fileUrl}: ${error.message}`);
    return false;
  }
}

module.exports = {
  deleteFile
};
