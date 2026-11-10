'use strict';

/**
 * Browser hook for snapshot prepare. Full in-browser engine port can replace this module.
 * Today prepare uses snapshot POST body only (no attendance matrix reload).
 */
const { prepareVirtualBundleFromSnapshot } = require('./sarSnapshotLocalPrepareService');

module.exports = {
  prepareVirtualBundleFromSnapshot(snapshot, targets, options = {}) {
    return prepareVirtualBundleFromSnapshot(snapshot, targets, {
      docxTemplates: options.docxTemplates || {},
      mergeMode: options.mergeMode || '',
      reqUser: options.reqUser || {
        activeOrgId: snapshot?.manifest?.orgId
      }
    });
  }
};
